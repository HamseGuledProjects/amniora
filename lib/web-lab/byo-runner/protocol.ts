import { createHash, createPublicKey, type KeyObject } from "node:crypto";

export const BYO_RUNNER_PROTOCOL_VERSION = "1.0" as const;
export const BYO_RUNNER_AUDIENCE = "amniora-byo-broker" as const;
export const BYO_RUNNER_ENROLLMENT_TTL_MS = 5 * 60 * 1_000;
export const BYO_RUNNER_HEARTBEAT_INTERVAL_MS = 15_000;
export const BYO_RUNNER_LIVENESS_TIMEOUT_MS = 45_000;
export const BYO_RUNNER_HANDSHAKE_TIMEOUT_MS = 10_000;
export const BYO_RUNNER_MAX_MESSAGE_BYTES = 640 * 1_024;
export const BYO_RUNNER_COMMAND_TIMEOUT_MS = 120_000;
export const BYO_RELAY_SESSION_TTL_MS = 30_000;
export const BYO_RELAY_MAX_HEADER_BYTES = 8_192;
export const BYO_RELAY_MAX_PATH_QUERY_BYTES = 8_192;
export const BYO_RELAY_MAX_REQUEST_BODY_BYTES = 65_536;
export const BYO_RELAY_MAX_RESPONSE_BODY_BYTES = 256 * 1_024;
export const BYO_RELAY_REQUEST_TIMEOUT_MS = 5_000;

export type ByoRunnerErrorCode =
  | "ENROLLMENT_INVALID"
  | "ENROLLMENT_EXPIRED"
  | "ENROLLMENT_REPLAYED"
  | "OWNER_MISMATCH"
  | "AUDIENCE_MISMATCH"
  | "RUNNER_IDENTITY_INVALID"
  | "RUNNER_IDENTITY_NOT_FOUND"
  | "RUNNER_IDENTITY_CONFLICT"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "PROTOCOL_MESSAGE_INVALID"
  | "PROOF_INVALID"
  | "TLS_REQUIRED"
  | "CONNECTION_FAILED"
  | "BROKER_NOT_READY"
  | "RUNNER_NOT_CONNECTED"
  | "RUNNER_COMMAND_TIMEOUT"
  | "INTERNAL_ERROR";

export type ByoRunnerOperationErrorCode =
  | "DOCKER_UNAVAILABLE"
  | "DOCKER_DAEMON_UNAVAILABLE"
  | "UNSUPPORTED_PLATFORM"
  | "PACKAGE_INVALID"
  | "PACKAGE_SIGNATURE_INVALID"
  | "PACKAGE_EXPIRED"
  | "PACKAGE_VERSION_UNSUPPORTED"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "BUILD_FINGERPRINT_MISMATCH"
  | "RUNTIME_VERSION_UNSUPPORTED"
  | "LOCAL_RUNTIME_ALREADY_ACTIVE"
  | "LOCAL_RUNTIME_NOT_FOUND"
  | "LOCAL_RUNTIME_EXPIRED"
  | "LOCAL_RUNTIME_START_FAILED"
  | "LOCAL_RUNTIME_INCONSISTENT"
  | "RELAY_RUNTIME_MISMATCH"
  | "RELAY_RUNTIME_NOT_READY"
  | "RELAY_REQUEST_INVALID"
  | "RELAY_UPSTREAM_TIMEOUT"
  | "RELAY_UPSTREAM_UNAVAILABLE"
  | "RELAY_RESPONSE_TOO_LARGE"
  | "INTERNAL_ERROR";

const OPERATION_ERROR_CODES = new Set<ByoRunnerOperationErrorCode>([
  "DOCKER_UNAVAILABLE", "DOCKER_DAEMON_UNAVAILABLE", "UNSUPPORTED_PLATFORM", "PACKAGE_INVALID",
  "PACKAGE_SIGNATURE_INVALID", "PACKAGE_EXPIRED", "PACKAGE_VERSION_UNSUPPORTED", "PROTOCOL_VERSION_UNSUPPORTED",
  "BUILD_FINGERPRINT_MISMATCH",
  "RUNTIME_VERSION_UNSUPPORTED", "LOCAL_RUNTIME_ALREADY_ACTIVE", "LOCAL_RUNTIME_NOT_FOUND",
  "LOCAL_RUNTIME_EXPIRED", "LOCAL_RUNTIME_START_FAILED", "LOCAL_RUNTIME_INCONSISTENT",
  "RELAY_RUNTIME_MISMATCH", "RELAY_RUNTIME_NOT_READY", "RELAY_REQUEST_INVALID", "RELAY_UPSTREAM_TIMEOUT",
  "RELAY_UPSTREAM_UNAVAILABLE", "RELAY_RESPONSE_TOO_LARGE", "INTERNAL_ERROR",
]);

export class ByoRunnerOperationError extends Error {
  constructor(readonly code: ByoRunnerOperationErrorCode) {
    super(code);
    this.name = "ByoRunnerOperationError";
  }
}

export class ByoRunnerError extends Error {
  constructor(readonly code: ByoRunnerErrorCode) {
    super(code);
    this.name = "ByoRunnerError";
  }
}

export type EnrollmentCapability = Readonly<{
  token: string;
  ownerId: string;
  audience: typeof BYO_RUNNER_AUDIENCE;
  expiresAt: number;
}>;

export type BrokerRunnerIdentity = Readonly<{
  runnerId: string;
  ownerId: string;
  audience: typeof BYO_RUNNER_AUDIENCE;
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  publicKey: string;
  createdAt: number;
  lastSeenAt: number;
}>;

export type RunnerIdentity = Readonly<{
  stateVersion: 1;
  runnerId: string;
  ownerId: string;
  audience: typeof BYO_RUNNER_AUDIENCE;
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  publicKey: string;
  privateKey: string;
  enrolledAt: number;
}>;

export type ByoRunnerPublicStatus = Readonly<{
  runnerId: string;
  ownerId: string;
  connected: boolean;
  connectionCount: number;
  lastConnectedAt: number | null;
  lastHeartbeatAt: number | null;
  lastDisconnectedAt: number | null;
}>;

export type ByoRunnerRuntimeOperation = "launch" | "status" | "reset" | "stop";
export type ByoRunnerOperation = ByoRunnerRuntimeOperation | "relay_http";

export type ByoRelayHttpMethod = "GET" | "HEAD" | "POST" | "PUT";

export type ByoRelayHttpRequest = Readonly<{
  method: ByoRelayHttpMethod;
  pathQuery: string;
  headers: Readonly<Record<string, string>>;
  bodyBase64: string;
}>;

export type ByoRelayHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  bodyBase64: string;
}>;

export type ByoRunnerRuntimeStatus = Readonly<{
  runnerId: string;
  runtimeId: string | null;
  state: "idle" | "starting" | "ready" | "resetting" | "stopping" | "failed" | "expired";
  generation: number | null;
  buildFingerprint: string | null;
  expiresAt: number | null;
  trustLevel: "byo_self_hosted";
}>;

type ServerCommandBase = Readonly<{
  type: "command";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  ownerId: string;
  commandId: string;
}>;

export type ServerLaunchCommand = ServerCommandBase & Readonly<{
  operation: "launch";
  idempotencyKey: string;
  package: unknown;
}>;

export type ServerStatusCommand = ServerCommandBase & Readonly<{ operation: "status" }>;

export type ServerLifecycleCommand = ServerCommandBase & Readonly<{
  operation: "reset" | "stop";
  runtimeId: string;
  buildFingerprint: string;
  generation: number;
  idempotencyKey: string;
}>;

export type ServerRelayHttpCommand = ServerCommandBase & Readonly<{
  operation: "relay_http";
  runtimeId: string;
  buildFingerprint: string;
  generation: number;
  request: ByoRelayHttpRequest;
}>;

export type ServerCommandMessage = ServerLaunchCommand | ServerStatusCommand | ServerLifecycleCommand | ServerRelayHttpCommand;

export type ClientOperationResultMessage = Readonly<{
  type: "operation_result";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  commandId: string;
  operation: ByoRunnerRuntimeOperation;
  ok: boolean;
  status: ByoRunnerRuntimeStatus | null;
  errorCode: ByoRunnerOperationErrorCode | null;
}>;

export type ClientRelayHttpResultMessage = Readonly<{
  type: "relay_result";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  commandId: string;
  operation: "relay_http";
  ok: boolean;
  response: ByoRelayHttpResponse | null;
  errorCode: ByoRunnerOperationErrorCode | null;
}>;

export interface ByoRunnerOperationHandler {
  initialize(runnerId: string): Promise<ByoRunnerRuntimeStatus>;
  launch(runnerId: string, packageInput: unknown, idempotencyKey: string): Promise<ByoRunnerRuntimeStatus>;
  status(runnerId: string): Promise<ByoRunnerRuntimeStatus>;
  reset(runnerId: string, input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus>;
  stop(runnerId: string, input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    idempotencyKey: string;
  }>): Promise<ByoRunnerRuntimeStatus>;
  relayHttp(runnerId: string, input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse>;
}

export type ClientEnrollmentMessage = Readonly<{
  type: "enroll";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  audience: typeof BYO_RUNNER_AUDIENCE;
  ownerId: string;
  enrollmentToken: string;
  publicKey: string;
  proofNonce: string;
  proof: string;
}>;

export type ClientReconnectMessage = Readonly<{
  type: "reconnect";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  audience: typeof BYO_RUNNER_AUDIENCE;
  ownerId: string;
  runnerId: string;
}>;

export type ClientProofMessage = Readonly<{
  type: "proof";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  nonce: string;
  proof: string;
}>;

export type ClientHeartbeatMessage = Readonly<{
  type: "heartbeat";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  sequence: number;
  sentAt: number;
}>;

export type ClientMessage = ClientEnrollmentMessage | ClientReconnectMessage | ClientProofMessage | ClientHeartbeatMessage |
  ClientOperationResultMessage | ClientRelayHttpResultMessage;

export type ServerChallengeMessage = Readonly<{
  type: "challenge";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  nonce: string;
  expiresAt: number;
}>;

export type ServerReadyMessage = Readonly<{
  type: "ready";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  ownerId: string;
  heartbeatIntervalMs: number;
}>;

export type ServerHeartbeatAckMessage = Readonly<{
  type: "heartbeat_ack";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  runnerId: string;
  sequence: number;
  receivedAt: number;
}>;

export type ServerErrorMessage = Readonly<{
  type: "error";
  protocolVersion: typeof BYO_RUNNER_PROTOCOL_VERSION;
  code: ByoRunnerErrorCode;
}>;

export type ServerMessage = ServerChallengeMessage | ServerReadyMessage | ServerHeartbeatAckMessage | ServerErrorMessage |
  ServerCommandMessage;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function validOwnerId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function validRunnerId(value: unknown): value is string {
  return typeof value === "string" && /^rnr_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function validNonce(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22,43}$/.test(value);
}

export function validProof(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{86}$/.test(value);
}

export function validCommandId(value: unknown): value is string {
  return typeof value === "string" && /^cmd_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validRuntimeId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function validOperation(value: unknown): value is ByoRunnerOperation {
  return value === "launch" || value === "status" || value === "reset" || value === "stop" || value === "relay_http";
}

export function validRuntimeOperation(value: unknown): value is ByoRunnerRuntimeOperation {
  return value === "launch" || value === "status" || value === "reset" || value === "stop";
}

export function validOperationErrorCode(value: unknown): value is ByoRunnerOperationErrorCode {
  return typeof value === "string" && OPERATION_ERROR_CODES.has(value as ByoRunnerOperationErrorCode);
}

export function validRuntimeStatus(value: unknown): value is ByoRunnerRuntimeStatus {
  if (!isPlainObject(value) || !hasExactKeys(value, [
    "runnerId", "runtimeId", "state", "generation", "buildFingerprint", "expiresAt", "trustLevel",
  ]) || !validRunnerId(value.runnerId) ||
      !(value.runtimeId === null || validRuntimeId(value.runtimeId)) ||
      !["idle", "starting", "ready", "resetting", "stopping", "failed", "expired"].includes(String(value.state)) ||
      !(value.generation === null || (Number.isSafeInteger(value.generation) && Number(value.generation) >= 1)) ||
      !(value.buildFingerprint === null || validFingerprint(value.buildFingerprint)) ||
      !(value.expiresAt === null || Number.isSafeInteger(value.expiresAt)) || value.trustLevel !== "byo_self_hosted") return false;
  if (value.runtimeId === null) return value.generation === null && value.buildFingerprint === null;
  return value.generation !== null && value.buildFingerprint !== null;
}

export const BYO_RELAY_REQUEST_HEADER_LIMITS: Readonly<Record<string, number>> = {
  accept: 512,
  "accept-language": 256,
  "content-type": 128,
  "content-length": 16,
  "x-web-lab-field": 256,
  "x-web-lab-route": 256,
};

export const BYO_RELAY_RESPONSE_HEADERS = new Set(["cache-control", "content-type", "x-content-type-options"]);

function validCanonicalBase64(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(maximumBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length <= maximumBytes && decoded.toString("base64") === value;
}

export function validRelayPathQuery(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= BYO_RELAY_MAX_PATH_QUERY_BYTES &&
    value.startsWith("/") && !value.startsWith("//") && !value.includes("#") && !value.includes("\\") &&
    /^[\x21-\x7e]+$/.test(value);
}

function validRelayHeaders(value: unknown, limits: Readonly<Record<string, number>> | Set<string>): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  let total = 0;
  for (const [name, headerValue] of Object.entries(value)) {
    const limit = limits instanceof Set ? (limits.has(name) ? 1_024 : 0) : limits[name] ?? 0;
    if (!limit || name !== name.toLowerCase() || !/^[a-z0-9-]+$/.test(name) || typeof headerValue !== "string" ||
        Buffer.byteLength(headerValue) > limit || /[\u0000-\u001f\u007f]/.test(headerValue)) return false;
    total += Buffer.byteLength(name) + Buffer.byteLength(headerValue) + 4;
  }
  return total <= BYO_RELAY_MAX_HEADER_BYTES;
}

export function validRelayHttpRequest(value: unknown): value is ByoRelayHttpRequest {
  if (!isPlainObject(value) || !hasExactKeys(value, ["method", "pathQuery", "headers", "bodyBase64"]) ||
      !["GET", "HEAD", "POST", "PUT"].includes(String(value.method)) || !validRelayPathQuery(value.pathQuery) ||
      !validRelayHeaders(value.headers, BYO_RELAY_REQUEST_HEADER_LIMITS) ||
      !validCanonicalBase64(value.bodyBase64, BYO_RELAY_MAX_REQUEST_BODY_BYTES)) return false;
  const bodyLength = Buffer.from(value.bodyBase64 as string, "base64").length;
  const headers = value.headers as Record<string, string>;
  if ((value.method === "GET" || value.method === "HEAD") && bodyLength !== 0) return false;
  if (headers["content-length"] !== undefined && headers["content-length"] !== String(bodyLength)) return false;
  if (bodyLength > 0 && !/^(?:application\/json|application\/x-www-form-urlencoded|text\/plain)(?:\s*;|$)/i.test(headers["content-type"] ?? "")) return false;
  return true;
}

export function validRelayHttpResponse(value: unknown): value is ByoRelayHttpResponse {
  return isPlainObject(value) && hasExactKeys(value, ["status", "headers", "bodyBase64"]) &&
    Number.isSafeInteger(value.status) && Number(value.status) >= 100 && Number(value.status) <= 599 &&
    validRelayHeaders(value.headers, BYO_RELAY_RESPONSE_HEADERS) &&
    validCanonicalBase64(value.bodyBase64, BYO_RELAY_MAX_RESPONSE_BODY_BYTES);
}

export function requireEd25519PublicKey(pem: unknown): KeyObject {
  if (typeof pem !== "string" || pem.length < 80 || pem.length > 256) throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
    return key;
  } catch (error) {
    if (error instanceof ByoRunnerError) throw error;
    throw new ByoRunnerError("RUNNER_IDENTITY_INVALID");
  }
}

export function canonicalPublicKey(key: KeyObject): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

export function enrollmentTokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function proofBytes(label: string, value: Record<string, string>): Buffer {
  const fields = Object.keys(value).sort().map(key => `${key}=${value[key]}`).join("\n");
  return Buffer.from(`AMNIORA_BYO_${label}_V1\n${fields}\n`, "utf8");
}

export function enrollmentProofBytes(input: Readonly<{
  audience: string;
  ownerId: string;
  protocolVersion: string;
  publicKey: string;
  proofNonce: string;
  enrollmentDigest: string;
}>): Buffer {
  return proofBytes("ENROLL", input);
}

export function reconnectProofBytes(input: Readonly<{
  audience: string;
  ownerId: string;
  protocolVersion: string;
  runnerId: string;
  nonce: string;
}>): Buffer {
  return proofBytes("RECONNECT", input);
}

export function parseJsonLine(line: Buffer): unknown {
  if (line.length === 0 || line.length > BYO_RUNNER_MAX_MESSAGE_BYTES) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
  try { return JSON.parse(line.toString("utf8")); }
  catch { throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID"); }
}

export function encodeJsonLine(message: unknown): Buffer {
  const encoded = Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
  if (encoded.length > BYO_RUNNER_MAX_MESSAGE_BYTES) throw new ByoRunnerError("PROTOCOL_MESSAGE_INVALID");
  return encoded;
}
