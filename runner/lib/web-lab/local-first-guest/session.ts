import { createHash, randomBytes } from "node:crypto";
import type { GuestPairingRecord, SigningIdentity } from "./identity";
import {
  GUEST_AUTH_TTL_MS,
  GUEST_CHANNEL_AUDIENCE,
  GUEST_MAX_CLOCK_SKEW_MS,
  GUEST_MESSAGE_TTL_MS,
  GUEST_PROTOCOL_VERSION,
  GuestChannelError,
  clientProofBytes,
  isPlainObject,
  publicKeyFingerprint,
  requireGuestRequest,
  serverChallengeProofBytes,
  validClientProof,
  verifyGuestProof,
  type ClientProof,
  type GuestRequest,
  type GuestResponse,
  type GuestRuntimeStatus,
  type ServerChallenge,
} from "./protocol";
import type { ByoRelayHttpRequest, ByoRelayHttpResponse } from "../byo-runner/protocol";
import type { GuestStatusProvider } from "./status";

type ChallengeState = Readonly<{
  challenge: ServerChallenge;
  state: "pending" | "used";
}>;

export type AuthenticatedGuestSession = {
  readonly sessionId: string;
  readonly generation: number;
  readonly desktopId: string;
  state: "active" | "closed";
  nextSequence: number;
  readonly responses: Map<string, Readonly<{ digest: string; response: GuestResponse }>>;
};

function opaque(prefix = ""): string { return `${prefix}${randomBytes(32).toString("base64url")}`; }

function desktopIdFor(publicKey: string): string {
  return `ins_${Buffer.from(publicKeyFingerprint(publicKey), "hex").toString("base64url")}`;
}

function requestDigest(value: GuestRequest): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export interface GuestRuntimeOperationHandler {
  launch(input: Readonly<{ package: unknown; idempotencyKey: string }>): Promise<GuestRuntimeStatus>;
  status(): Promise<GuestRuntimeStatus>;
  reset(input: Readonly<{ runtimeId: string; buildFingerprint: string; generation: number; idempotencyKey: string }>): Promise<GuestRuntimeStatus>;
  stop(input: Readonly<{ runtimeId: string; buildFingerprint: string; generation: number; idempotencyKey: string }>): Promise<GuestRuntimeStatus>;
  diagnosticProbe(input: Readonly<{ runtimeId: string; buildFingerprint: string; generation: number }>): Promise<Readonly<{
    status: 200;
    bodySha256: string;
  }>>;
  relayHttp(input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse>;
}

export class GuestSessionAuthority {
  private generation = 0;
  // The paired desktop may keep a viewer open while issuing short status or lifecycle commands.
  // Bound concurrent sessions so a leaked connection cannot grow guest-side state without limit.
  private readonly active = new Set<AuthenticatedGuestSession>();
  private static readonly maxActiveSessions = 8;
  private readonly challenges = new Map<string, ChallengeState>();

  constructor(
    private readonly guestIdentity: SigningIdentity,
    private readonly pairing: GuestPairingRecord,
    private readonly statusProvider: GuestStatusProvider,
    private readonly now: () => number = Date.now,
    private readonly runtimeController?: GuestRuntimeOperationHandler,
  ) {}

  async challenge(): Promise<ServerChallenge> {
    const issuedAt = this.now();
    const base = {
      protocolVersion: GUEST_PROTOCOL_VERSION,
      audience: GUEST_CHANNEL_AUDIENCE,
      sessionId: opaque("ses_"),
      generation: ++this.generation,
      serverNonce: opaque(),
      issuedAt,
      expiresAt: issuedAt + GUEST_AUTH_TTL_MS,
    } as const;
    const challenge = Object.freeze({ type: "SERVER_CHALLENGE", ...base,
      proof: await this.guestIdentity.sign(serverChallengeProofBytes(base)) } as ServerChallenge);
    this.challenges.set(challenge.sessionId, { challenge, state: "pending" });
    return challenge;
  }

  authenticate(value: unknown): AuthenticatedGuestSession {
    if (!validClientProof(value)) throw new GuestChannelError("PROOF_INVALID");
    const saved = this.challenges.get(value.sessionId);
    if (!saved || saved.state !== "pending") throw new GuestChannelError("MESSAGE_REPLAYED");
    const challenge = saved.challenge;
    if (this.now() >= challenge.expiresAt || Math.abs(this.now() - value.signedAt) > GUEST_AUTH_TTL_MS + GUEST_MAX_CLOCK_SKEW_MS) {
      this.challenges.delete(value.sessionId);
      throw new GuestChannelError("TIMEOUT");
    }
    if (value.protocolVersion !== challenge.protocolVersion || value.audience !== challenge.audience ||
        value.generation !== challenge.generation || value.serverNonce !== challenge.serverNonce ||
        value.desktopId !== this.pairing.desktopId || value.desktopId !== desktopIdFor(this.pairing.desktopPublicKey)) {
      throw new GuestChannelError("PEER_NOT_PAIRED");
    }
    if (!verifyGuestProof(this.pairing.desktopPublicKey, clientProofBytes({
      protocolVersion: value.protocolVersion,
      audience: value.audience,
      sessionId: value.sessionId,
      generation: value.generation,
      serverNonce: value.serverNonce,
      clientNonce: value.clientNonce,
      desktopId: value.desktopId,
      signedAt: value.signedAt,
    }), value.proof)) throw new GuestChannelError("PROOF_INVALID");
    this.challenges.set(value.sessionId, { challenge, state: "used" });
    if (this.active.size >= GuestSessionAuthority.maxActiveSessions) throw new GuestChannelError("TRANSPORT_DENIED");
    const session: AuthenticatedGuestSession = {
      sessionId: value.sessionId,
      generation: value.generation,
      desktopId: value.desktopId,
      state: "active",
      nextSequence: 1,
      responses: new Map(),
    };
    this.active.add(session);
    return session;
  }

  async execute(session: AuthenticatedGuestSession, input: unknown): Promise<GuestResponse> {
    const request = requireGuestRequest(input, this.runtimeController !== undefined);
    if (session.state !== "active" || !this.active.has(session) ||
        request.sessionId !== session.sessionId || request.generation !== session.generation) {
      throw new GuestChannelError("SESSION_STALE");
    }
    if (Math.abs(this.now() - request.sentAt) > GUEST_MESSAGE_TTL_MS + GUEST_MAX_CLOCK_SKEW_MS) {
      throw new GuestChannelError("SESSION_STALE");
    }
    const digest = requestDigest(request);
    const cached = session.responses.get(request.requestId);
    if (cached) {
      if (cached.digest !== digest) throw new GuestChannelError("IDEMPOTENCY_CONFLICT");
      return cached.response;
    }
    if (request.sequence !== session.nextSequence) throw new GuestChannelError("MESSAGE_REPLAYED");

    let result: unknown = null;
    let errorCode: GuestResponse["errorCode"] = null;
    try {
      if (request.operation === "PING") result = Object.freeze({ pong: true });
      else if (request.operation === "STATUS") result = await this.statusProvider.status();
      else if (request.operation === "GUEST_INFO") result = await this.statusProvider.guestInfo();
      else if (request.operation === "DOCKER_STATUS") result = await this.statusProvider.dockerStatus();
      else if (!this.runtimeController) throw new GuestChannelError("OPERATION_NOT_ENABLED");
      else if (request.operation === "LAUNCH") result = await this.runtimeController.launch(request.input as never);
      else if (request.operation === "RUNTIME_STATUS") result = await this.runtimeController.status();
      else if (request.operation === "RESET") result = await this.runtimeController.reset(request.input as never);
      else if (request.operation === "STOP") result = await this.runtimeController.stop(request.input as never);
      else if (request.operation === "DIAGNOSTIC_PROBE") result = await this.runtimeController.diagnosticProbe(request.input as never);
      else if (request.operation === "RELAY_HTTP") result = await this.runtimeController.relayHttp(request.input as never);
      else throw new GuestChannelError("OPERATION_NOT_ENABLED");
    } catch (error) {
      errorCode = error instanceof GuestChannelError ? error.code : "RUNTIME_OPERATION_FAILED";
    }

    const response: GuestResponse = Object.freeze({
      type: "RESPONSE",
      protocolVersion: GUEST_PROTOCOL_VERSION,
      sessionId: session.sessionId,
      generation: session.generation,
      sequence: request.sequence,
      requestId: request.requestId,
      operation: request.operation,
      ok: errorCode === null,
      result,
      errorCode,
      completedAt: this.now(),
    });
    session.responses.set(request.requestId, { digest, response });
    session.nextSequence += 1;
    return response;
  }

  close(session: AuthenticatedGuestSession): void {
    if (session.state === "active") session.state = "closed";
    this.active.delete(session);
  }
}

export function verifyServerChallenge(value: unknown, guestPublicKey: string, now = Date.now()): ServerChallenge {
  if (!isPlainObject(value) || Object.keys(value).sort().join(",") !==
    ["audience", "expiresAt", "generation", "issuedAt", "proof", "protocolVersion", "serverNonce", "sessionId", "type"].sort().join(",") ||
      value.type !== "SERVER_CHALLENGE" || value.protocolVersion !== GUEST_PROTOCOL_VERSION ||
      value.audience !== GUEST_CHANNEL_AUDIENCE || typeof value.sessionId !== "string" || !/^ses_[A-Za-z0-9_-]{43}$/.test(value.sessionId) ||
      !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 || typeof value.serverNonce !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.serverNonce) || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
      typeof value.proof !== "string") throw new GuestChannelError("PROOF_INVALID");
  const challenge = value as unknown as ServerChallenge;
  if (now >= challenge.expiresAt || challenge.expiresAt - challenge.issuedAt !== GUEST_AUTH_TTL_MS ||
      Math.abs(now - challenge.issuedAt) > GUEST_AUTH_TTL_MS + GUEST_MAX_CLOCK_SKEW_MS ||
      !verifyGuestProof(guestPublicKey, serverChallengeProofBytes({
        protocolVersion: challenge.protocolVersion,
        audience: challenge.audience,
        sessionId: challenge.sessionId,
        generation: challenge.generation,
        serverNonce: challenge.serverNonce,
        issuedAt: challenge.issuedAt,
        expiresAt: challenge.expiresAt,
      }), challenge.proof)) throw new GuestChannelError("PROOF_INVALID");
  return challenge;
}

export async function createClientProof(identity: SigningIdentity, challenge: ServerChallenge, now = Date.now()): Promise<ClientProof> {
  const base = {
    protocolVersion: GUEST_PROTOCOL_VERSION,
    audience: GUEST_CHANNEL_AUDIENCE,
    sessionId: challenge.sessionId,
    generation: challenge.generation,
    serverNonce: challenge.serverNonce,
    clientNonce: opaque(),
    desktopId: desktopIdFor(identity.publicKey),
    signedAt: now,
  } as const;
  return Object.freeze({ type: "CLIENT_PROOF", ...base, proof: await identity.sign(clientProofBytes(base)) });
}
