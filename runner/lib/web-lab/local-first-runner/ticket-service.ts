import { randomBytes, sign, type KeyObject } from "node:crypto";
import type { InMemoryPairingService, PairedInstallation } from "./pairing-service";
import {
  LOCAL_FIRST_ACTIVATION_SCHEME,
  LOCAL_FIRST_AUDIENCE,
  LOCAL_FIRST_MAX_CLOCK_SKEW_MS,
  LOCAL_FIRST_PROTOCOL_VERSION,
  LOCAL_FIRST_TICKET_TTL_MS,
  LocalFirstError,
  opaqueDigest,
  redeemProofBytes,
  requireCanonicalRunnerPublicKey,
  resultDigest,
  resultProofBytes,
  validCommandIssueInput,
  validRedeemRequest,
  validResultRequest,
  verifyRunnerProof,
  type LocalFirstCommand,
  type LocalFirstCommandBinding,
  type LocalFirstOperation,
  type LocalFirstResultRequest,
  type LocalFirstStatusResult,
} from "./protocol";

type TicketState = "issued" | "redeemed" | "completed";

type TicketRecord = {
  requestId: string;
  commandId: string | null;
  ticketDigest: string;
  state: TicketState;
  binding: LocalFirstCommandBinding;
  requestFingerprint: string;
  consumedAt: number | null;
  completedAt: number | null;
  result: LocalFirstStatusResult | null;
  resultDigest: string | null;
  resultProof: string | null;
};

export type TicketIssue = Readonly<{
  requestId: string;
  activationUri: string | null;
  expiresAt: number;
  state: TicketState;
}>;

export type ObservedCommandResult = Readonly<{
  requestId: string;
  state: TicketState;
  operation: LocalFirstOperation;
  result: LocalFirstStatusResult | null;
  completedAt: number | null;
}>;

function randomId(prefix: "req" | "cmd"): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function requestFingerprint(input: Readonly<{
  operation: LocalFirstOperation;
  buildId: string | null;
  runtimeId: string | null;
  generation: number | null;
}>): string {
  return opaqueDigest(JSON.stringify([
    input.operation, input.buildId, input.runtimeId, input.generation,
  ]));
}

function idempotencyIndex(accountId: string, installationId: string, idempotencyKey: string): string {
  return `${accountId}:${installationId}:${idempotencyKey}`;
}

/** Race-safe disposable ticket authority. Raw ticket values are returned once and never retained. */
export class InMemoryCommandTicketService {
  private readonly records = new Map<string, TicketRecord>();
  private readonly ticketIndex = new Map<string, string>();
  private readonly idempotency = new Map<string, string>();
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly pairings: InMemoryPairingService,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LOCAL_FIRST_TICKET_TTL_MS,
    private readonly allowedOperations: ReadonlySet<LocalFirstOperation> = new Set(["STATUS"]),
  ) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60_000) {
      throw new Error("invalid_local_first_ticket_ttl");
    }
  }

  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const prior = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }

  async issue(input: unknown): Promise<TicketIssue> {
    return this.exclusive(() => {
      if (!validCommandIssueInput(input)) throw new LocalFirstError("REQUEST_INVALID");
      if (!this.allowedOperations.has(input.operation)) throw new LocalFirstError("OPERATION_NOT_ENABLED");
      if (!this.pairings.active(input.accountId, input.installationId)) throw new LocalFirstError("PAIRING_REVOKED");
      const fingerprint = requestFingerprint(input);
      const index = idempotencyIndex(input.accountId, input.installationId, input.idempotencyKey);
      const priorRequestId = this.idempotency.get(index);
      if (priorRequestId) {
        const prior = this.records.get(priorRequestId)!;
        if (prior.requestFingerprint !== fingerprint) throw new LocalFirstError("IDEMPOTENCY_CONFLICT");
        if (prior.state !== "issued") {
          return { requestId: prior.requestId, activationUri: null, expiresAt: prior.binding.expiresAt, state: prior.state };
        }
        this.ticketIndex.delete(prior.ticketDigest);
        const replacement = randomBytes(32).toString("base64url");
        prior.ticketDigest = opaqueDigest(replacement);
        prior.binding = { ...prior.binding, nonce: randomBytes(32).toString("base64url"),
          issuedAt: this.now(), expiresAt: this.now() + this.ttlMs };
        this.ticketIndex.set(prior.ticketDigest, prior.requestId);
        return { requestId: prior.requestId,
          activationUri: `${LOCAL_FIRST_ACTIVATION_SCHEME}:/activate?ticket=${replacement}`,
          expiresAt: prior.binding.expiresAt, state: prior.state };
      }
      const issuedAt = this.now();
      const ticket = randomBytes(32).toString("base64url");
      const requestId = randomId("req");
      const binding: LocalFirstCommandBinding = Object.freeze({
        accountId: input.accountId,
        installationId: input.installationId,
        operation: input.operation,
        buildId: input.buildId,
        runtimeId: input.runtimeId,
        generation: input.generation,
        nonce: randomBytes(32).toString("base64url"),
        issuedAt,
        expiresAt: issuedAt + this.ttlMs,
        idempotencyKey: input.idempotencyKey,
        protocolVersion: LOCAL_FIRST_PROTOCOL_VERSION,
        audience: LOCAL_FIRST_AUDIENCE,
      });
      const record: TicketRecord = {
        requestId,
        commandId: null,
        ticketDigest: opaqueDigest(ticket),
        state: "issued",
        binding,
        requestFingerprint: fingerprint,
        consumedAt: null,
        completedAt: null,
        result: null,
        resultDigest: null,
        resultProof: null,
      };
      this.records.set(requestId, record);
      this.ticketIndex.set(record.ticketDigest, requestId);
      this.idempotency.set(index, requestId);
      return { requestId, activationUri: `${LOCAL_FIRST_ACTIVATION_SCHEME}:/activate?ticket=${ticket}`,
        expiresAt: binding.expiresAt, state: record.state };
    });
  }

  async redeem(input: unknown): Promise<LocalFirstCommand> {
    return this.exclusive(() => {
      if (!validRedeemRequest(input)) {
        if (typeof (input as { protocolVersion?: unknown })?.protocolVersion === "string" &&
            (input as { protocolVersion: string }).protocolVersion !== LOCAL_FIRST_PROTOCOL_VERSION) {
          throw new LocalFirstError("PROTOCOL_VERSION_UNSUPPORTED");
        }
        if (typeof (input as { audience?: unknown })?.audience === "string" &&
            (input as { audience: string }).audience !== LOCAL_FIRST_AUDIENCE) {
          throw new LocalFirstError("AUDIENCE_MISMATCH");
        }
        throw new LocalFirstError("REQUEST_INVALID");
      }
      const digest = opaqueDigest(input.ticket);
      const requestId = this.ticketIndex.get(digest);
      const record = requestId ? this.records.get(requestId) : null;
      if (!record || record.ticketDigest !== digest) throw new LocalFirstError("TICKET_INVALID");
      if (record.state !== "issued" || record.consumedAt !== null) throw new LocalFirstError("TICKET_REPLAYED");
      if (this.now() >= record.binding.expiresAt) throw new LocalFirstError("TICKET_EXPIRED");
      if (input.installationId !== record.binding.installationId) throw new LocalFirstError("RUNNER_MISMATCH");
      if (Math.abs(this.now() - input.signedAt) > LOCAL_FIRST_MAX_CLOCK_SKEW_MS) throw new LocalFirstError("PROOF_INVALID");
      const paired = this.pairings.active(record.binding.accountId, record.binding.installationId);
      if (!paired) throw new LocalFirstError("PAIRING_REVOKED");
      const publicKey = requireCanonicalRunnerPublicKey(paired.publicKey);
      if (!verifyRunnerProof(publicKey, redeemProofBytes(input), input.proof)) throw new LocalFirstError("PROOF_INVALID");
      record.commandId = randomId("cmd");
      record.consumedAt = this.now();
      record.state = "redeemed";
      return this.command(record);
    });
  }

  async submitResult(input: unknown): Promise<ObservedCommandResult> {
    return this.exclusive(() => {
      if (!validResultRequest(input)) throw new LocalFirstError("RESULT_INVALID");
      const record = this.records.get(input.requestId);
      if (!record || record.commandId === null || record.state === "issued") throw new LocalFirstError("RESULT_INVALID");
      const digest = resultDigest(input.result);
      if (record.state === "completed") {
        if (record.resultDigest === digest && record.resultProof === input.proof) return this.observed(record);
        throw new LocalFirstError("RESULT_REPLAYED");
      }
      if (input.commandId !== record.commandId || input.installationId !== record.binding.installationId ||
          input.operation !== record.binding.operation || input.nonce !== record.binding.nonce ||
          input.completedAt < (record.consumedAt ?? 0) || input.completedAt > this.now() + LOCAL_FIRST_MAX_CLOCK_SKEW_MS) {
        throw new LocalFirstError("RESULT_INVALID");
      }
      const paired = this.pairings.active(record.binding.accountId, record.binding.installationId);
      if (!paired) throw new LocalFirstError("PAIRING_REVOKED");
      if (!verifyRunnerProof(requireCanonicalRunnerPublicKey(paired.publicKey), resultProofBytes(input), input.proof)) {
        throw new LocalFirstError("PROOF_INVALID");
      }
      record.completedAt = input.completedAt;
      record.result = Object.freeze({ ...input.result });
      record.resultDigest = digest;
      record.resultProof = input.proof;
      record.state = "completed";
      return this.observed(record);
    });
  }

  observe(accountId: string, requestId: string): ObservedCommandResult {
    const record = this.records.get(requestId);
    if (!record || record.binding.accountId !== accountId) throw new LocalFirstError("ACCOUNT_MISMATCH");
    return this.observed(record);
  }

  private command(record: TicketRecord): LocalFirstCommand {
    return Object.freeze({
      protocolVersion: LOCAL_FIRST_PROTOCOL_VERSION,
      audience: LOCAL_FIRST_AUDIENCE,
      requestId: record.requestId,
      commandId: record.commandId!,
      installationId: record.binding.installationId,
      operation: record.binding.operation,
      buildId: record.binding.buildId,
      runtimeId: record.binding.runtimeId,
      generation: record.binding.generation,
      nonce: record.binding.nonce,
      issuedAt: record.binding.issuedAt,
      expiresAt: record.binding.expiresAt,
    });
  }

  private observed(record: TicketRecord): ObservedCommandResult {
    return Object.freeze({ requestId: record.requestId, state: record.state, operation: record.binding.operation,
      result: record.result, completedAt: record.completedAt });
  }
}

export function signRedeemRequest(privateKey: KeyObject, input: Readonly<{
  ticket: string;
  installationId: string;
  clientNonce: string;
  signedAt: number;
}>): string {
  return sign(null, redeemProofBytes(input), privateKey).toString("base64url");
}

export function signCommandResult(privateKey: KeyObject, input: Omit<LocalFirstResultRequest, "proof">): string {
  return sign(null, resultProofBytes(input), privateKey).toString("base64url");
}

export function pairedPublicKey(pairing: PairedInstallation): KeyObject {
  return requireCanonicalRunnerPublicKey(pairing.publicKey);
}
