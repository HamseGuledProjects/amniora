import { createHash, randomBytes } from "node:crypto";
import {
  BYO_RELAY_MAX_HEADER_BYTES,
  BYO_RELAY_MAX_REQUEST_BODY_BYTES,
  BYO_RELAY_REQUEST_HEADER_LIMITS,
  BYO_RELAY_SESSION_TTL_MS,
  ByoRunnerError,
  ByoRunnerOperationError,
  hasExactKeys,
  isPlainObject,
  validOwnerId,
  validRelayHttpResponse,
  validRelayPathQuery,
  validRunnerId,
  validRuntimeId,
  type ByoRelayHttpMethod,
  type ByoRelayHttpRequest,
  type ByoRelayHttpResponse,
  type ByoRunnerRuntimeStatus,
} from "./protocol";

export type ByoBrowserRelayErrorCode =
  | "RELAY_SESSION_INVALID"
  | "RELAY_SESSION_EXPIRED"
  | "RELAY_OWNER_MISMATCH"
  | "RELAY_RUNTIME_NOT_FOUND"
  | "RELAY_RUNTIME_NOT_READY"
  | "RELAY_RUNNER_MISMATCH"
  | "RELAY_GENERATION_STALE"
  | "RELAY_METHOD_NOT_ALLOWED"
  | "RELAY_REQUEST_INVALID"
  | "RELAY_HEADERS_TOO_LARGE"
  | "RELAY_BODY_TOO_LARGE"
  | "RELAY_UPSTREAM_TIMEOUT"
  | "RELAY_UPSTREAM_UNAVAILABLE"
  | "RELAY_RESPONSE_TOO_LARGE";

const STATUS_BY_CODE: Readonly<Record<ByoBrowserRelayErrorCode, number>> = {
  RELAY_SESSION_INVALID: 401,
  RELAY_SESSION_EXPIRED: 401,
  RELAY_OWNER_MISMATCH: 403,
  RELAY_RUNTIME_NOT_FOUND: 404,
  RELAY_RUNTIME_NOT_READY: 410,
  RELAY_RUNNER_MISMATCH: 403,
  RELAY_GENERATION_STALE: 409,
  RELAY_METHOD_NOT_ALLOWED: 405,
  RELAY_REQUEST_INVALID: 400,
  RELAY_HEADERS_TOO_LARGE: 431,
  RELAY_BODY_TOO_LARGE: 413,
  RELAY_UPSTREAM_TIMEOUT: 504,
  RELAY_UPSTREAM_UNAVAILABLE: 502,
  RELAY_RESPONSE_TOO_LARGE: 502,
};

export class ByoBrowserRelayError extends Error {
  readonly status: number;

  constructor(readonly code: ByoBrowserRelayErrorCode) {
    super(code);
    this.name = "ByoBrowserRelayError";
    this.status = STATUS_BY_CODE[code];
  }
}

export type ByoRelayRuntimeTarget = Readonly<{
  runtimeId: string;
  ownerId: string;
  runnerId: string;
}>;

export type ByoBrowserRequest = Readonly<{
  method: string;
  pathQuery: string;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}>;

export type ByoBrowserResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
}>;

export type ByoBrowserRelaySession = Readonly<{
  sessionToken: string;
  runtimeId: string;
  expiresAt: number;
}>;

type StoredSession = Readonly<{
  ownerId: string;
  runtimeId: string;
  runnerId: string;
  generation: number;
  buildFingerprint: string;
  expiresAt: number;
}>;

export interface ByoRelayTransport {
  runtimeStatus(input: Readonly<{ runnerId: string; ownerId: string }>): Promise<ByoRunnerRuntimeStatus>;
  relayHttp(input: Readonly<{
    runnerId: string;
    ownerId: string;
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse>;
}

export type ByoBrowserRelayOptions = Readonly<{
  transport: ByoRelayTransport;
  resolveRuntime: (runtimeId: string) => Promise<ByoRelayRuntimeTarget | null>;
  now?: () => number;
  sessionTtlMs?: number;
}>;

function sessionDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function relayFailure(error: unknown): ByoBrowserRelayError {
  if (error instanceof ByoBrowserRelayError) return error;
  if (error instanceof ByoRunnerError) {
    if (error.code === "OWNER_MISMATCH") return new ByoBrowserRelayError("RELAY_OWNER_MISMATCH");
    if (error.code === "RUNNER_IDENTITY_NOT_FOUND") return new ByoBrowserRelayError("RELAY_RUNNER_MISMATCH");
    if (error.code === "RUNNER_COMMAND_TIMEOUT") return new ByoBrowserRelayError("RELAY_UPSTREAM_TIMEOUT");
    return new ByoBrowserRelayError("RELAY_RUNTIME_NOT_READY");
  }
  if (error instanceof ByoRunnerOperationError) {
    if (error.code === "RELAY_RUNTIME_MISMATCH") return new ByoBrowserRelayError("RELAY_GENERATION_STALE");
    if (["RELAY_RUNTIME_NOT_READY", "LOCAL_RUNTIME_NOT_FOUND", "LOCAL_RUNTIME_EXPIRED"].includes(error.code)) {
      return new ByoBrowserRelayError("RELAY_RUNTIME_NOT_READY");
    }
    if (error.code === "RELAY_UPSTREAM_TIMEOUT") return new ByoBrowserRelayError("RELAY_UPSTREAM_TIMEOUT");
    if (error.code === "RELAY_RESPONSE_TOO_LARGE") return new ByoBrowserRelayError("RELAY_RESPONSE_TOO_LARGE");
  }
  return new ByoBrowserRelayError("RELAY_UPSTREAM_UNAVAILABLE");
}

function normalizeBrowserRequest(input: unknown): ByoRelayHttpRequest {
  if (!isPlainObject(input) || !hasExactKeys(input, ["method", "pathQuery", "headers", "body"])) {
    throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
  }
  if (!["GET", "HEAD", "POST", "PUT"].includes(String(input.method))) {
    throw new ByoBrowserRelayError("RELAY_METHOD_NOT_ALLOWED");
  }
  if (!validRelayPathQuery(input.pathQuery) || !isPlainObject(input.headers) || !(input.body instanceof Uint8Array)) {
    throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
  }
  const body = Buffer.from(input.body);
  if (body.length > BYO_RELAY_MAX_REQUEST_BODY_BYTES) throw new ByoBrowserRelayError("RELAY_BODY_TOO_LARGE");
  if ((input.method === "GET" || input.method === "HEAD") && body.length !== 0) {
    throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
  }

  let totalHeaderBytes = 0;
  const normalized = new Map<string, string>();
  for (const [name, value] of Object.entries(input.headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
    }
    totalHeaderBytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    if (totalHeaderBytes > BYO_RELAY_MAX_HEADER_BYTES) throw new ByoBrowserRelayError("RELAY_HEADERS_TOO_LARGE");
    const lowerName = name.toLowerCase();
    if (normalized.has(lowerName)) throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
    normalized.set(lowerName, value);
  }

  const safeHeaders: Record<string, string> = {};
  for (const [name, limit] of Object.entries(BYO_RELAY_REQUEST_HEADER_LIMITS)) {
    if (name === "content-length") continue;
    const value = normalized.get(name);
    if (value === undefined) continue;
    if (Buffer.byteLength(value) > limit) throw new ByoBrowserRelayError("RELAY_HEADERS_TOO_LARGE");
    safeHeaders[name] = value;
  }
  if (body.length > 0) {
    if (!/^(?:application\/json|application\/x-www-form-urlencoded|text\/plain)(?:\s*;|$)/i.test(safeHeaders["content-type"] ?? "")) {
      throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
    }
    safeHeaders["content-length"] = String(body.length);
  }
  return {
    method: input.method as ByoRelayHttpMethod,
    pathQuery: input.pathQuery,
    headers: safeHeaders,
    bodyBase64: body.toString("base64"),
  };
}

/** Trusted browser-to-BYO relay. Runtime resolution and every network target remain server-side. */
export class ByoVmBrowserRelay {
  private readonly now: () => number;
  private readonly sessionTtlMs: number;
  private readonly sessions = new Map<string, StoredSession>();

  constructor(private readonly options: ByoBrowserRelayOptions) {
    this.now = options.now ?? (() => Date.now());
    this.sessionTtlMs = options.sessionTtlMs ?? BYO_RELAY_SESSION_TTL_MS;
    if (!Number.isSafeInteger(this.sessionTtlMs) || this.sessionTtlMs < 1_000 || this.sessionTtlMs > 5 * 60_000) {
      throw new Error("invalid_byo_relay_session_ttl");
    }
  }

  async createSession(input: Readonly<{ ownerId: string; runtimeId: string }>): Promise<ByoBrowserRelaySession> {
    if (!isPlainObject(input) || !hasExactKeys(input, ["ownerId", "runtimeId"]) ||
        !validOwnerId(input.ownerId) || !validRuntimeId(input.runtimeId)) {
      throw new ByoBrowserRelayError("RELAY_REQUEST_INVALID");
    }
    const target = await this.resolve(input.runtimeId);
    if (target.ownerId !== input.ownerId) throw new ByoBrowserRelayError("RELAY_OWNER_MISMATCH");
    const status = await this.readyStatus(target);
    const now = this.now();
    const expiresAt = Math.min(now + this.sessionTtlMs, status.expiresAt!);
    if (expiresAt <= now) throw new ByoBrowserRelayError("RELAY_RUNTIME_NOT_READY");
    const sessionToken = randomBytes(32).toString("base64url");
    this.sessions.set(sessionDigest(sessionToken), {
      ownerId: target.ownerId,
      runtimeId: target.runtimeId,
      runnerId: target.runnerId,
      generation: status.generation!,
      buildFingerprint: status.buildFingerprint!,
      expiresAt,
    });
    return { sessionToken, runtimeId: target.runtimeId, expiresAt };
  }

  async relay(input: Readonly<{
    sessionToken: string;
    ownerId: string;
    runtimeId: string;
    request: ByoBrowserRequest;
  }>): Promise<ByoBrowserResponse> {
    if (!isPlainObject(input) || !hasExactKeys(input, ["sessionToken", "ownerId", "runtimeId", "request"]) ||
        typeof input.sessionToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.sessionToken) ||
        !validOwnerId(input.ownerId) || !validRuntimeId(input.runtimeId)) {
      throw new ByoBrowserRelayError("RELAY_SESSION_INVALID");
    }
    const digest = sessionDigest(input.sessionToken);
    const session = this.sessions.get(digest);
    if (!session) throw new ByoBrowserRelayError("RELAY_SESSION_INVALID");
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(digest);
      throw new ByoBrowserRelayError("RELAY_SESSION_EXPIRED");
    }
    if (session.ownerId !== input.ownerId) throw new ByoBrowserRelayError("RELAY_OWNER_MISMATCH");
    if (session.runtimeId !== input.runtimeId) throw new ByoBrowserRelayError("RELAY_RUNTIME_NOT_FOUND");

    const target = await this.resolve(input.runtimeId);
    if (target.ownerId !== session.ownerId) throw new ByoBrowserRelayError("RELAY_OWNER_MISMATCH");
    if (target.runnerId !== session.runnerId) throw new ByoBrowserRelayError("RELAY_RUNNER_MISMATCH");
    const status = await this.readyStatus(target);
    if (status.generation !== session.generation || status.buildFingerprint !== session.buildFingerprint) {
      throw new ByoBrowserRelayError("RELAY_GENERATION_STALE");
    }
    const request = normalizeBrowserRequest(input.request);
    try {
      const response = await this.options.transport.relayHttp({
        runnerId: session.runnerId,
        ownerId: session.ownerId,
        runtimeId: session.runtimeId,
        buildFingerprint: session.buildFingerprint,
        generation: session.generation,
        request,
      });
      if (!validRelayHttpResponse(response)) throw new ByoBrowserRelayError("RELAY_UPSTREAM_UNAVAILABLE");
      return { status: response.status, headers: response.headers, body: Buffer.from(response.bodyBase64, "base64") };
    } catch (error) {
      throw relayFailure(error);
    }
  }

  clearSessions(): void {
    this.sessions.clear();
  }

  private async resolve(runtimeId: string): Promise<ByoRelayRuntimeTarget> {
    const target = await this.options.resolveRuntime(runtimeId);
    if (!target || !isPlainObject(target) || !hasExactKeys(target, ["runtimeId", "ownerId", "runnerId"]) ||
        target.runtimeId !== runtimeId || !validRuntimeId(target.runtimeId) || !validOwnerId(target.ownerId) ||
        !validRunnerId(target.runnerId)) throw new ByoBrowserRelayError("RELAY_RUNTIME_NOT_FOUND");
    return target;
  }

  private async readyStatus(target: ByoRelayRuntimeTarget): Promise<ByoRunnerRuntimeStatus> {
    let status: ByoRunnerRuntimeStatus;
    try {
      status = await this.options.transport.runtimeStatus({ runnerId: target.runnerId, ownerId: target.ownerId });
    } catch (error) {
      throw relayFailure(error);
    }
    if (status.runnerId !== target.runnerId || status.runtimeId !== target.runtimeId) {
      throw new ByoBrowserRelayError("RELAY_RUNNER_MISMATCH");
    }
    if (status.state !== "ready" || status.generation === null || status.buildFingerprint === null ||
        status.expiresAt === null || this.now() >= status.expiresAt) {
      throw new ByoBrowserRelayError("RELAY_RUNTIME_NOT_READY");
    }
    return status;
  }
}
