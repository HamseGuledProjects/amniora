import { randomBytes } from "node:crypto";
import {
  LOCAL_FIRST_PRODUCT_AUDIENCE, LOCAL_FIRST_PRODUCT_OPERATIONS, LOCAL_FIRST_PRODUCT_PROTOCOL,
  LOCAL_FIRST_PRODUCT_SCHEME, type AuthoritativeRunnerResult, type ProductOperation,
} from "./contract";
import {
  PRODUCT_MAX_CLOCK_SKEW_MS, PRODUCT_PAIRING_CALLBACK, PRODUCT_PAIRING_TTL_MS, PRODUCT_TICKET_TTL_MS,
  ProductProtocolError, canonicalRunnerKey, digest, exactKeys, installationIdForKey, isRecord,
  pairingProofBytes, pkceChallenge, presenceProofBytes, redeemProofBytes, resultDigest, resultProofBytes, safeEqual,
  unpairProofBytes,
  validCommandId, validContextId, validInstallationId, validOpaque, validOperation, validRequestId,
  validRunnerResult, validSignature, verifyProof,
} from "./protocol";
import type { CommandRecord, LocalFirstProductRepository, PairingRecord } from "./repository";

const PAIRING_ID = /^par_[A-Za-z0-9_-]{43}$/;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,128}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,160}$/;
const DEVICE_NAME = /^[^\r\n\0]{1,80}$/;

function opaque(): string { return randomBytes(32).toString("base64url"); }
function id(prefix: "par" | "req" | "cmd"): string { return `${prefix}_${opaque()}`; }
function account(value: unknown): value is string { return typeof value === "string" && ACCOUNT_ID.test(value); }
function pairingId(value: unknown): value is string { return typeof value === "string" && PAIRING_ID.test(value); }

export type ProductCommand = Readonly<{
  protocolVersion: typeof LOCAL_FIRST_PRODUCT_PROTOCOL;
  audience: typeof LOCAL_FIRST_PRODUCT_AUDIENCE;
  requestId: string;
  commandId: string;
  installationId: string;
  operation: ProductOperation;
  buildId: string | null;
  runtimeId: string | null;
  generation: number | null;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}>;

export class DurableLocalFirstAuthority {
  constructor(
    readonly repository: LocalFirstProductRepository,
    private readonly now: () => number = Date.now,
    private readonly pairingTtl = PRODUCT_PAIRING_TTL_MS,
    private readonly ticketTtl = PRODUCT_TICKET_TTL_MS,
  ) {}

  async beginPairing(input: unknown, approvalOrigin: string): Promise<Readonly<{
    authorizationRequestId: string; approvalUrl: string; expiresAt: number;
  }>> {
    if (!isRecord(input) || !exactKeys(input, ["protocolVersion", "audience", "installationId", "publicKey",
      "deviceName", "codeChallenge", "state", "redirectUri"])) throw new ProductProtocolError("PAIRING_INVALID");
    if (input.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL) throw new ProductProtocolError("PROTOCOL_VERSION_UNSUPPORTED");
    if (input.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE) throw new ProductProtocolError("AUDIENCE_MISMATCH");
    if (!validInstallationId(input.installationId) || typeof input.publicKey !== "string" ||
      installationIdForKey(input.publicKey) !== input.installationId || typeof input.deviceName !== "string" ||
      !DEVICE_NAME.test(input.deviceName) || !validOpaque(input.codeChallenge) || !validOpaque(input.state) ||
      input.redirectUri !== PRODUCT_PAIRING_CALLBACK) throw new ProductProtocolError("PAIRING_INVALID");
    canonicalRunnerKey(input.publicKey);
    const createdAt = this.now();
    const existing = await this.repository.activePairingForInstallation(input.installationId);
    if (existing) {
      if (createdAt < existing.expiresAt) throw new ProductProtocolError("PAIRING_REPLAYED");
      const expired = await this.repository.updatePairing(existing.authorizationRequestId,
        { consumedAt: null, deniedAt: null }, {
          accountId: null, authorizationCodeDigest: null, approvedAt: null, deniedAt: createdAt,
        });
      if (!expired) throw new ProductProtocolError("PAIRING_REPLAYED");
    }
    const authorizationRequestId = id("par");
    const record: PairingRecord = {
      authorizationRequestId, installationId: input.installationId, publicKey: input.publicKey,
      deviceName: input.deviceName, protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
      codeChallenge: input.codeChallenge, stateDigest: digest(input.state), createdAt,
      expiresAt: createdAt + this.pairingTtl, accountId: null, authorizationCodeDigest: null,
      approvedAt: null, deniedAt: null, consumedAt: null,
    };
    await this.repository.createPairing(record);
    const approval = new URL(`/dashboard/runner/connect/${authorizationRequestId}`, approvalOrigin);
    approval.searchParams.set("state", input.state);
    return { authorizationRequestId, approvalUrl: approval.href, expiresAt: record.expiresAt };
  }

  async pairingForApproval(authorizationRequestId: string, state: string): Promise<PairingRecord> {
    if (!pairingId(authorizationRequestId) || !validOpaque(state)) throw new ProductProtocolError("PAIRING_INVALID");
    const record = await this.repository.pairing(authorizationRequestId);
    if (!record || !safeEqual(record.stateDigest, digest(state))) throw new ProductProtocolError("PAIRING_INVALID");
    if (this.now() >= record.expiresAt) throw new ProductProtocolError("PAIRING_EXPIRED");
    if (record.approvedAt !== null || record.deniedAt !== null || record.consumedAt !== null) throw new ProductProtocolError("PAIRING_REPLAYED");
    return record;
  }

  async cancelPairing(authorizationRequestId: string): Promise<boolean> {
    if (!pairingId(authorizationRequestId)) throw new ProductProtocolError("PAIRING_INVALID");
    const record = await this.repository.pairing(authorizationRequestId);
    if (!record) throw new ProductProtocolError("PAIRING_INVALID");
    if (record.deniedAt !== null) return true;
    if (record.approvedAt !== null || record.consumedAt !== null) return false;
    const denied = await this.repository.updatePairing(authorizationRequestId,
      { approvedAt: null, deniedAt: null, consumedAt: null }, { deniedAt: this.now() });
    return !!denied && denied.deniedAt !== null;
  }

  async approvePairing(input: Readonly<{
    authorizationRequestId: string; state: string; authenticatedAccountId: string; approved: boolean;
  }>): Promise<Readonly<{ activationUri: string | null }>> {
    const record = await this.pairingForApproval(input.authorizationRequestId, input.state);
    if (!account(input.authenticatedAccountId) || typeof input.approved !== "boolean") throw new ProductProtocolError("PAIRING_INVALID");
    if (!input.approved) {
      const denied = await this.repository.updatePairing(record.authorizationRequestId,
        { approvedAt: null, deniedAt: null, consumedAt: null }, { deniedAt: this.now(), accountId: input.authenticatedAccountId });
      if (!denied) throw new ProductProtocolError("PAIRING_REPLAYED");
      return { activationUri: null };
    }
    const authorizationCode = opaque();
    const approved = await this.repository.updatePairing(record.authorizationRequestId,
      { approvedAt: null, deniedAt: null, consumedAt: null }, {
        approvedAt: this.now(), accountId: input.authenticatedAccountId,
        authorizationCodeDigest: digest(authorizationCode),
      });
    if (!approved) throw new ProductProtocolError("PAIRING_REPLAYED");
    const callback = new URL(PRODUCT_PAIRING_CALLBACK);
    callback.searchParams.set("request", record.authorizationRequestId);
    callback.searchParams.set("code", authorizationCode);
    callback.searchParams.set("state", input.state);
    return { activationUri: callback.href };
  }

  async completePairing(input: unknown): Promise<Readonly<{ accountId: string; installationId: string }>> {
    if (!isRecord(input) || !exactKeys(input, ["protocolVersion", "audience", "authorizationRequestId",
      "authorizationCode", "installationId", "codeVerifier", "state", "redirectUri", "proof"])) {
      throw new ProductProtocolError("PAIRING_INVALID");
    }
    if (input.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL) throw new ProductProtocolError("PROTOCOL_VERSION_UNSUPPORTED");
    if (input.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE) throw new ProductProtocolError("AUDIENCE_MISMATCH");
    if (!pairingId(input.authorizationRequestId) || !validOpaque(input.authorizationCode) ||
      !validInstallationId(input.installationId) || typeof input.codeVerifier !== "string" ||
      !validOpaque(input.state) || input.redirectUri !== PRODUCT_PAIRING_CALLBACK || !validSignature(input.proof)) {
      throw new ProductProtocolError("PAIRING_INVALID");
    }
    const record = await this.repository.pairing(input.authorizationRequestId);
    if (!record || !record.accountId || !record.authorizationCodeDigest) throw new ProductProtocolError("PAIRING_INVALID");
    if (record.deniedAt !== null) throw new ProductProtocolError("PAIRING_DENIED");
    if (record.consumedAt !== null) throw new ProductProtocolError("PAIRING_REPLAYED");
    if (this.now() >= record.expiresAt) throw new ProductProtocolError("PAIRING_EXPIRED");
    if (record.installationId !== input.installationId || !safeEqual(record.stateDigest, digest(input.state)) ||
      !safeEqual(record.authorizationCodeDigest, digest(input.authorizationCode)) ||
      pkceChallenge(input.codeVerifier) !== record.codeChallenge) throw new ProductProtocolError("PKCE_INVALID");
    if (!verifyProof(canonicalRunnerKey(record.publicKey), pairingProofBytes({
      authorizationRequestId: input.authorizationRequestId, authorizationCode: input.authorizationCode,
      installationId: input.installationId, state: input.state,
    }), input.proof)) throw new ProductProtocolError("PROOF_INVALID");
    const existing = await this.repository.installation(record.installationId);
    if (existing && existing.accountId !== record.accountId) throw new ProductProtocolError("ACCOUNT_MISMATCH");
    const consumedAt = this.now();
    const consumed = await this.repository.updatePairing(record.authorizationRequestId, { consumedAt: null }, { consumedAt });
    if (!consumed) throw new ProductProtocolError("PAIRING_REPLAYED");
    await this.repository.saveInstallation({
      installationId: record.installationId, accountId: record.accountId, publicKey: record.publicKey,
      deviceName: record.deviceName, protocolVersion: record.protocolVersion,
      createdAt: existing?.createdAt ?? consumedAt, lastInteractionAt: consumedAt, revokedAt: null,
    });
    return { accountId: record.accountId, installationId: record.installationId };
  }

  async revoke(accountId: string, installationId: string): Promise<void> {
    if (!await this.repository.revokeIfIdle(accountId, installationId, this.now())) {
      throw new ProductProtocolError("PAIRING_REVOKED");
    }
  }

  async revokeFromRunner(input: unknown): Promise<void> {
    if (!isRecord(input) || !exactKeys(input, ["protocolVersion", "audience", "installationId", "clientNonce",
      "signedAt", "proof"]) || input.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL ||
      input.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE || !validInstallationId(input.installationId) ||
      !validOpaque(input.clientNonce) || !Number.isSafeInteger(input.signedAt) || !validSignature(input.proof)) {
      throw new ProductProtocolError("REQUEST_INVALID");
    }
    const signedAt = Number(input.signedAt);
    if (Math.abs(this.now() - signedAt) > PRODUCT_MAX_CLOCK_SKEW_MS) throw new ProductProtocolError("PROOF_INVALID");
    const installation = await this.repository.installation(input.installationId);
    if (!installation || installation.revokedAt !== null) throw new ProductProtocolError("PAIRING_REVOKED");
    if (!verifyProof(canonicalRunnerKey(installation.publicKey), unpairProofBytes({ installationId: input.installationId,
      clientNonce: input.clientNonce, signedAt }), input.proof)) throw new ProductProtocolError("PROOF_INVALID");
    await this.revoke(installation.accountId, installation.installationId);
  }

  async recordPresence(input: unknown): Promise<void> {
    if (!isRecord(input) || !exactKeys(input, ["protocolVersion", "audience", "installationId", "clientNonce",
      "signedAt", "proof"]) || input.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL ||
      input.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE || !validInstallationId(input.installationId) ||
      !validOpaque(input.clientNonce) || !Number.isSafeInteger(input.signedAt) || !validSignature(input.proof)) {
      throw new ProductProtocolError("REQUEST_INVALID");
    }
    const signedAt = Number(input.signedAt);
    if (Math.abs(this.now() - signedAt) > PRODUCT_MAX_CLOCK_SKEW_MS) throw new ProductProtocolError("PROOF_INVALID");
    const installation = await this.repository.installation(input.installationId);
    if (!installation || installation.revokedAt !== null) throw new ProductProtocolError("PAIRING_REVOKED");
    if (!verifyProof(canonicalRunnerKey(installation.publicKey), presenceProofBytes({ installationId: input.installationId,
      clientNonce: input.clientNonce, signedAt }), input.proof)) throw new ProductProtocolError("PROOF_INVALID");
    const updated = await this.repository.updateInstallation(installation.installationId,
      { accountId: installation.accountId, revokedAt: null }, { lastInteractionAt: this.now() });
    if (!updated) throw new ProductProtocolError("PAIRING_REVOKED");
  }

  async issue(input: Readonly<{
    accountId: string; installationId: string; operation: ProductOperation; buildId: string | null;
    runtimeId: string | null; generation: number | null; idempotencyKey: string;
  }>): Promise<Readonly<{ requestId: string; activationUri: string | null; expiresAt: number;
    state: "issued" | "redeemed" | "completed" }>> {
    if (!account(input.accountId) || !validInstallationId(input.installationId) || !validOperation(input.operation) ||
      (input.buildId !== null && !validContextId(input.buildId)) || (input.runtimeId !== null && !validContextId(input.runtimeId)) ||
      (input.generation !== null && (!Number.isSafeInteger(input.generation) || input.generation < 1)) ||
      !IDEMPOTENCY.test(input.idempotencyKey)) throw new ProductProtocolError("REQUEST_INVALID");
    const installation = await this.repository.installation(input.installationId);
    if (!installation || installation.accountId !== input.accountId || installation.revokedAt !== null) throw new ProductProtocolError("PAIRING_REVOKED");
    const fingerprint = digest(JSON.stringify([input.operation, input.buildId, input.runtimeId, input.generation]));
    const prior = await this.repository.commandByIdempotency(input.accountId, input.installationId, input.idempotencyKey);
    if (prior) {
      if (prior.requestFingerprint !== fingerprint) throw new ProductProtocolError("IDEMPOTENCY_CONFLICT");
      if (prior.state === "cancelled") throw new ProductProtocolError("TICKET_EXPIRED");
      if (prior.state !== "issued") return { requestId: prior.requestId, activationUri: null, expiresAt: prior.expiresAt, state: prior.state };
      const ticket = opaque(); const issuedAt = this.now();
      const rotated = await this.repository.updateCommand(prior.requestId, { state: "issued", ticketDigest: prior.ticketDigest }, {
        ticketDigest: digest(ticket), nonce: opaque(), issuedAt, expiresAt: issuedAt + this.ticketTtl,
      });
      if (!rotated) throw new ProductProtocolError("TICKET_REPLAYED");
      return { requestId: rotated.requestId, activationUri: `${LOCAL_FIRST_PRODUCT_SCHEME}:/activate?ticket=${ticket}`,
        expiresAt: rotated.expiresAt, state: "issued" };
    }
    const issuedAt = this.now(); const ticket = opaque();
    const record: CommandRecord = {
      requestId: id("req"), commandId: null, accountId: input.accountId, installationId: input.installationId,
      operation: input.operation, buildId: input.buildId, runtimeId: input.runtimeId, generation: input.generation,
      nonce: opaque(), idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
      ticketDigest: digest(ticket), state: "issued", issuedAt, expiresAt: issuedAt + this.ticketTtl,
      consumedAt: null, completedAt: null, result: null, resultDigest: null, resultProof: null,
    };
    await this.repository.saveCommand(record);
    return { requestId: record.requestId, activationUri: `${LOCAL_FIRST_PRODUCT_SCHEME}:/activate?ticket=${ticket}`,
      expiresAt: record.expiresAt, state: "issued" };
  }

  async cancelIssued(accountId: string, installationId: string, requestId: string): Promise<boolean> {
    if (!account(accountId) || !validInstallationId(installationId) || !validRequestId(requestId)) {
      throw new ProductProtocolError("REQUEST_INVALID");
    }
    const record = await this.repository.command(requestId);
    if (!record || record.accountId !== accountId || record.installationId !== installationId) {
      throw new ProductProtocolError("REQUEST_INVALID");
    }
    if (record.state === "cancelled") return true;
    if (record.state !== "issued") return false;
    const cancelled = await this.repository.updateCommand(requestId,
      { state: "issued", consumedAt: null }, { state: "cancelled" });
    return cancelled?.state === "cancelled";
  }

  /**
   * Releases a command that was authenticated and consumed, but could not be
   * assembled for delivery to Runner. The ticket remains terminal because the
   * record is cancelled; clearing the transient command identity only restores
   * the database invariant for cancelled requests.
   */
  async cancelRedeemedDispatchFailure(requestId: string, commandId: string): Promise<boolean> {
    if (!validRequestId(requestId) || !validCommandId(commandId)) {
      throw new ProductProtocolError("REQUEST_INVALID");
    }
    const cancelled = await this.repository.updateCommand(requestId,
      { state: "redeemed", commandId, completedAt: null, result: null },
      { state: "cancelled", commandId: null, consumedAt: null });
    return cancelled?.state === "cancelled";
  }

  async redeem(input: unknown): Promise<ProductCommand> {
    if (!isRecord(input) || !exactKeys(input, ["protocolVersion", "audience", "ticket", "installationId",
      "clientNonce", "signedAt", "proof"])) throw new ProductProtocolError("REQUEST_INVALID");
    if (input.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL) throw new ProductProtocolError("PROTOCOL_VERSION_UNSUPPORTED");
    if (input.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE) throw new ProductProtocolError("AUDIENCE_MISMATCH");
    if (!validOpaque(input.ticket) || !validInstallationId(input.installationId) || !validOpaque(input.clientNonce) ||
      !Number.isSafeInteger(input.signedAt) || !validSignature(input.proof)) throw new ProductProtocolError("REQUEST_INVALID");
    const signedAt = Number(input.signedAt);
    const record = await this.repository.commandByTicketDigest(digest(input.ticket));
    if (!record) throw new ProductProtocolError("TICKET_INVALID");
    if (record.state !== "issued" || record.consumedAt !== null) throw new ProductProtocolError("TICKET_REPLAYED");
    if (this.now() >= record.expiresAt) throw new ProductProtocolError("TICKET_EXPIRED");
    if (record.installationId !== input.installationId) throw new ProductProtocolError("RUNNER_MISMATCH");
    if (Math.abs(this.now() - signedAt) > PRODUCT_MAX_CLOCK_SKEW_MS) throw new ProductProtocolError("PROOF_INVALID");
    const installation = await this.repository.installation(record.installationId);
    if (!installation || installation.accountId !== record.accountId || installation.revokedAt !== null) throw new ProductProtocolError("PAIRING_REVOKED");
    if (!verifyProof(canonicalRunnerKey(installation.publicKey), redeemProofBytes({
      ticket: input.ticket, installationId: input.installationId, clientNonce: input.clientNonce, signedAt,
    }), input.proof)) throw new ProductProtocolError("PROOF_INVALID");
    const commandId = id("cmd"); const consumedAt = this.now();
    const redeemed = await this.repository.updateCommand(record.requestId,
      { state: "issued", consumedAt: null, ticketDigest: record.ticketDigest }, { state: "redeemed", consumedAt, commandId });
    if (!redeemed) throw new ProductProtocolError("TICKET_REPLAYED");
    return this.command(redeemed);
  }

  async submitResult(input: unknown): Promise<CommandRecord> {
    if (!isRecord(input) || !exactKeys(input, ["protocolVersion", "audience", "requestId", "commandId",
      "installationId", "operation", "nonce", "completedAt", "result", "proof"]) ||
      input.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL || input.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE ||
      !validRequestId(input.requestId) || !validCommandId(input.commandId) || !validInstallationId(input.installationId) ||
      !validOperation(input.operation) || !validOpaque(input.nonce) || !Number.isSafeInteger(input.completedAt) ||
      !validRunnerResult(input.result) || !validSignature(input.proof)) throw new ProductProtocolError("RESULT_INVALID");
    const completedAt = Number(input.completedAt);
    const record = await this.repository.command(input.requestId);
    if (!record || !record.commandId || record.state === "issued") throw new ProductProtocolError("RESULT_INVALID");
    const result = input.result as AuthoritativeRunnerResult;
    const calculated = resultDigest(result);
    if (record.state === "completed") {
      if (record.resultDigest === calculated && record.resultProof === input.proof) return record;
      throw new ProductProtocolError("RESULT_REPLAYED");
    }
    if (record.commandId !== input.commandId || record.installationId !== input.installationId ||
      record.operation !== input.operation || record.nonce !== input.nonce || completedAt < (record.consumedAt ?? 0) ||
      completedAt > this.now() + PRODUCT_MAX_CLOCK_SKEW_MS) throw new ProductProtocolError("RESULT_INVALID");
    this.validateResultContext(record, result);
    const installation = await this.repository.installation(record.installationId);
    if (!installation || installation.accountId !== record.accountId || installation.revokedAt !== null) throw new ProductProtocolError("PAIRING_REVOKED");
    if (!verifyProof(canonicalRunnerKey(installation.publicKey), resultProofBytes({
      requestId: input.requestId, commandId: input.commandId, installationId: input.installationId,
      operation: input.operation, nonce: input.nonce, completedAt, result,
    }), input.proof)) throw new ProductProtocolError("PROOF_INVALID");
    const completed = await this.repository.updateCommand(record.requestId, { state: "redeemed", completedAt: null }, {
      state: "completed", completedAt, result, resultDigest: calculated, resultProof: input.proof,
    });
    if (!completed) throw new ProductProtocolError("RESULT_REPLAYED");
    await this.repository.updateInstallation(record.installationId, { accountId: record.accountId, revokedAt: null },
      { lastInteractionAt: this.now() });
    return completed;
  }

  private validateResultContext(record: CommandRecord, result: AuthoritativeRunnerResult): void {
    if (!result.ok) return;
    const runtime = result.runtime;
    if (record.operation === "STATUS") return;
    if (!runtime || runtime.buildId !== record.buildId) throw new ProductProtocolError("CONTEXT_MISMATCH");
    if (record.operation === "LAUNCH" && runtime.state === "running" && runtime.generation >= 1) return;
    if (record.operation === "OPEN_LAB" && runtime.runtimeId === record.runtimeId && runtime.generation === record.generation && runtime.state === "running") return;
    if (record.operation === "RESET" && runtime.runtimeId === record.runtimeId && runtime.generation === Number(record.generation) + 1 && runtime.state === "running") return;
    if (record.operation === "STOP" && runtime.runtimeId === record.runtimeId && runtime.generation === record.generation && runtime.state === "stopped") return;
    throw new ProductProtocolError("CONTEXT_MISMATCH");
  }

  private command(record: CommandRecord): ProductCommand {
    return Object.freeze({ protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL, audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
      requestId: record.requestId, commandId: record.commandId!, installationId: record.installationId,
      operation: record.operation, buildId: record.buildId, runtimeId: record.runtimeId,
      generation: record.generation, nonce: record.nonce, issuedAt: record.issuedAt, expiresAt: record.expiresAt });
  }
}

export function operationEnabled(operation: unknown): operation is ProductOperation {
  return typeof operation === "string" && LOCAL_FIRST_PRODUCT_OPERATIONS.includes(operation as ProductOperation);
}
