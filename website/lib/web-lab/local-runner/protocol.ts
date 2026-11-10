export const LOCAL_RUNNER_VERSION = "15.0.0-alpha.1";
export const LOCAL_RUNNER_PROTOCOL_VERSION = "1.0";
export const LOCAL_RUNNER_PACKAGE_VERSION = 1 as const;
export const LOCAL_RUNNER_RUNTIME_VERSION = "web-lab-local-1";
export const LOCAL_RUNNER_CONTROL_HOST = "127.0.0.1";
export const LOCAL_RUNNER_CONTROL_PORT = 43127;
export const LOCAL_RUNNER_DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;
export const LOCAL_RUNNER_CAPABILITY_TTL_MS = 30_000;
export const LOCAL_RUNNER_MAX_BODY_BYTES = 512 * 1024;

export type RunnerErrorCode =
  | "RUNNER_ALREADY_RUNNING"
  | "RUNNER_NOT_READY"
  | "DOCKER_UNAVAILABLE"
  | "DOCKER_DAEMON_UNAVAILABLE"
  | "UNSUPPORTED_PLATFORM"
  | "RUNNER_VERSION_UNSUPPORTED"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "PACKAGE_INVALID"
  | "PACKAGE_SIGNATURE_INVALID"
  | "PACKAGE_EXPIRED"
  | "PACKAGE_VERSION_UNSUPPORTED"
  | "BUILD_FINGERPRINT_MISMATCH"
  | "RUNTIME_VERSION_UNSUPPORTED"
  | "LOCAL_RUNTIME_ALREADY_ACTIVE"
  | "LOCAL_RUNTIME_NOT_FOUND"
  | "LOCAL_RUNTIME_EXPIRED"
  | "ORIGIN_DENIED"
  | "HOST_DENIED"
  | "CAPABILITY_INVALID"
  | "CAPABILITY_EXPIRED"
  | "CAPABILITY_REPLAYED"
  | "LOCAL_RUNTIME_START_FAILED"
  | "LOCAL_RUNTIME_INCONSISTENT"
  | "INVALID_ENDPOINT"
  | "MALFORMED_REQUEST"
  | "REQUEST_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Readonly<Partial<Record<RunnerErrorCode, number>>> = {
  ORIGIN_DENIED: 403,
  HOST_DENIED: 403,
  CAPABILITY_INVALID: 403,
  CAPABILITY_EXPIRED: 403,
  CAPABILITY_REPLAYED: 409,
  PACKAGE_SIGNATURE_INVALID: 403,
  PACKAGE_EXPIRED: 410,
  LOCAL_RUNTIME_EXPIRED: 410,
  LOCAL_RUNTIME_ALREADY_ACTIVE: 409,
  RUNNER_ALREADY_RUNNING: 409,
  LOCAL_RUNTIME_NOT_FOUND: 404,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_CONTENT_TYPE: 415,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
};

export class LocalRunnerError extends Error {
  readonly code: RunnerErrorCode;
  readonly status: number;

  constructor(code: RunnerErrorCode, status = STATUS_BY_CODE[code] ?? 400) {
    super(code);
    this.name = "LocalRunnerError";
    this.code = code;
    this.status = status;
  }
}

export type RunnerLifecycleState =
  | "idle"
  | "starting"
  | "ready"
  | "resetting"
  | "stopping"
  | "failed"
  | "expired";

export type RunnerDoctorCode =
  | "RUNNER_READY"
  | "DOCKER_UNAVAILABLE"
  | "DOCKER_DAEMON_UNAVAILABLE"
  | "UNSUPPORTED_PLATFORM"
  | "RUNNER_VERSION_UNSUPPORTED";

export type RunnerProtocolCompatibility = "compatible" | "incompatible" | "not-requested";

export type RunnerCapabilities = Readonly<{
  runnerVersion: typeof LOCAL_RUNNER_VERSION;
  protocolVersion: typeof LOCAL_RUNNER_PROTOCOL_VERSION;
  platform: NodeJS.Platform;
  architecture: string;
  testedPlatform: boolean;
  docker: Readonly<{ commandAvailable: boolean; daemonReachable: boolean; serverVersion: string | null }>;
  supportedRuntimeVersions: readonly [typeof LOCAL_RUNNER_RUNTIME_VERSION];
  activeLocalRuntimeState: RunnerLifecycleState;
  protocolCompatibility: RunnerProtocolCompatibility;
  outcome: RunnerDoctorCode;
}>;

export type RunnerPublicStatus = Readonly<{
  state: RunnerLifecycleState;
  sessionId: string | null;
  buildId: string | null;
  buildFingerprint: string | null;
  generation: number | null;
  endpoint: string | null;
  createdAt: number | null;
  expiresAt: number | null;
  trustLevel: "local_self_hosted";
  errorCode?: RunnerErrorCode;
}>;

export type RunnerOperation = "launch" | "reset" | "stop";

export type LaunchCapabilityScope = Readonly<{
  operation: "launch";
  buildId: string;
  buildFingerprint: string;
  idempotencyKey: string;
}>;

export type ResetCapabilityScope = Readonly<{
  operation: "reset";
  sessionId: string;
  buildFingerprint: string;
  generation: number;
  idempotencyKey: string;
}>;

export type StopCapabilityScope = Readonly<{
  operation: "stop";
  sessionId: string;
  buildFingerprint: string;
  generation: number;
  idempotencyKey: string;
}>;

export type RunnerCapabilityScope = LaunchCapabilityScope | ResetCapabilityScope | StopCapabilityScope;

export type RunnerCapabilityResponse = Readonly<{
  capability: string;
  operation: RunnerOperation;
  expiresAt: number;
}>;

export function protocolCompatibility(requested?: string): RunnerProtocolCompatibility {
  if (requested === undefined) return "not-requested";
  return requested === LOCAL_RUNNER_PROTOCOL_VERSION ? "compatible" : "incompatible";
}

export function isSafeLoopbackEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  let parsed: URL;
  try { parsed = new URL(value); } catch { return false; }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash || !/^\d+$/.test(parsed.port)) return false;
  const port = Number(parsed.port);
  return Number.isSafeInteger(port) && port >= 1024 && port <= 65535;
}

export function requireSafeLoopbackEndpoint(value: unknown): string {
  if (!isSafeLoopbackEndpoint(value)) throw new LocalRunnerError("INVALID_ENDPOINT");
  return value;
}

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

export function validOpaqueId(value: unknown, maximum = 128): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= maximum && /^[A-Za-z0-9_-]+$/.test(value);
}

export function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}
