import type { LocalRunnerPackage } from "../local-runner/package";
import { hasExactKeys, isPlainObject } from "../local-runner/protocol";

export const RUNTIME_HELPER_PROTOCOL_VERSION = "1.0" as const;
export const RUNTIME_HELPER_MAX_FRAME_BYTES = 640 * 1024;
export const RUNTIME_HELPER_OPERATIONS = [
  "PREPARE_RUNTIME",
  "LAUNCH_RUNTIME",
  "RUNTIME_STATUS",
  "RESET_RUNTIME",
  "STOP_RUNTIME",
  "CLEAN_RUNTIME",
] as const;
export type RuntimeHelperOperation = typeof RUNTIME_HELPER_OPERATIONS[number];

export type HelperRuntimeIdentity = Readonly<{
  runtimeId: string;
  buildId: string;
  buildFingerprint: string;
  packageHash: string;
  generation: number;
}>;

export type RuntimeHelperRequest = Readonly<{
  type: "HELPER_REQUEST";
  protocolVersion: typeof RUNTIME_HELPER_PROTOCOL_VERSION;
  requestId: string;
  operation: RuntimeHelperOperation;
  input: unknown;
}>;

export type RuntimeHelperErrorCode =
  | "HELPER_UNAUTHORIZED"
  | "HELPER_MESSAGE_INVALID"
  | "HELPER_PROTOCOL_UNSUPPORTED"
  | "HELPER_OPERATION_UNSUPPORTED"
  | "HELPER_RUNTIME_CONFLICT"
  | "HELPER_RUNTIME_NOT_FOUND"
  | "HELPER_PACKAGE_INVALID"
  | "HELPER_PLATFORM_UNSUPPORTED"
  | "HELPER_IMAGE_MISSING"
  | "HELPER_IMAGE_DIGEST_MISMATCH"
  | "HELPER_DOCKER_UNAVAILABLE"
  | "HELPER_LAUNCH_FAILED"
  | "HELPER_CLEANUP_FAILED"
  | "HELPER_INTERNAL_ERROR";

export type RuntimeHelperResponse = Readonly<{
  type: "HELPER_RESPONSE";
  protocolVersion: typeof RUNTIME_HELPER_PROTOCOL_VERSION;
  requestId: string;
  operation: RuntimeHelperOperation;
  ok: boolean;
  result: unknown;
  errorCode: RuntimeHelperErrorCode | null;
}>;

export type HelperRuntimeState = "idle" | "prepared" | "launching" | "ready" | "resetting" | "stopping" | "failed" | "stopped";
export type HelperRuntimeStatus = Readonly<{
  state: HelperRuntimeState;
  runtime: HelperRuntimeIdentity | null;
  endpoint: string | null;
  ready: boolean;
  architecture: "arm64" | "amd64";
  resources: readonly Readonly<{
    kind: "container" | "network" | "volume";
    role: "challenge" | "proxy" | "network" | "bundle" | "loader";
  }>[];
  errorCode: RuntimeHelperErrorCode | null;
}>;

export class RuntimeHelperError extends Error {
  constructor(readonly code: RuntimeHelperErrorCode) {
    super(code);
    this.name = "RuntimeHelperError";
  }
}

const REQUEST_KEYS = ["type", "protocolVersion", "requestId", "operation", "input"] as const;
const RESPONSE_KEYS = ["type", "protocolVersion", "requestId", "operation", "ok", "result", "errorCode"] as const;
const IDENTITY_KEYS = ["runtimeId", "buildId", "buildFingerprint", "packageHash", "generation"] as const;
const REQUEST_ID = /^hrq_[A-Za-z0-9_-]{43}$/;
const RUNTIME_ID = /^[0-9a-f]{32}$/;
const BUILD_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HASH = /^[0-9a-f]{64}$/;

export function validHelperRuntimeIdentity(value: unknown): value is HelperRuntimeIdentity {
  return isPlainObject(value) && hasExactKeys(value, IDENTITY_KEYS) && typeof value.runtimeId === "string" &&
    RUNTIME_ID.test(value.runtimeId) && typeof value.buildId === "string" && BUILD_ID.test(value.buildId) &&
    typeof value.buildFingerprint === "string" && HASH.test(value.buildFingerprint) &&
    typeof value.packageHash === "string" && HASH.test(value.packageHash) &&
    Number.isSafeInteger(value.generation) && Number(value.generation) >= 1;
}

function validRequestInput(operation: RuntimeHelperOperation, input: unknown): boolean {
  if (!isPlainObject(input)) return false;
  if (operation === "PREPARE_RUNTIME" || operation === "LAUNCH_RUNTIME") {
    return hasExactKeys(input, ["runtime", "package"]) && validHelperRuntimeIdentity(input.runtime) &&
      isPlainObject(input.package);
  }
  if (operation === "RESET_RUNTIME") {
    return hasExactKeys(input, ["previous", "next", "package"]) && validHelperRuntimeIdentity(input.previous) &&
      validHelperRuntimeIdentity(input.next) && isPlainObject(input.package);
  }
  if (operation === "RUNTIME_STATUS") {
    return hasExactKeys(input, ["runtime"]) && (input.runtime === null || validHelperRuntimeIdentity(input.runtime));
  }
  if (operation === "STOP_RUNTIME") {
    return hasExactKeys(input, ["runtime"]) && validHelperRuntimeIdentity(input.runtime);
  }
  return hasExactKeys(input, ["authoritativeRuntime"]) &&
    (input.authoritativeRuntime === null || validHelperRuntimeIdentity(input.authoritativeRuntime));
}

export function requireRuntimeHelperRequest(value: unknown): RuntimeHelperRequest {
  if (!isPlainObject(value) || !hasExactKeys(value, REQUEST_KEYS)) throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  if (value.protocolVersion !== RUNTIME_HELPER_PROTOCOL_VERSION) throw new RuntimeHelperError("HELPER_PROTOCOL_UNSUPPORTED");
  if (value.type !== "HELPER_REQUEST" || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) {
    throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  }
  if (typeof value.operation !== "string" || !RUNTIME_HELPER_OPERATIONS.includes(value.operation as RuntimeHelperOperation)) {
    throw new RuntimeHelperError("HELPER_OPERATION_UNSUPPORTED");
  }
  if (!validRequestInput(value.operation as RuntimeHelperOperation, value.input)) {
    throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  }
  return value as RuntimeHelperRequest;
}

export function validRuntimeHelperResponse(value: unknown): value is RuntimeHelperResponse {
  return isPlainObject(value) && hasExactKeys(value, RESPONSE_KEYS) && value.type === "HELPER_RESPONSE" &&
    value.protocolVersion === RUNTIME_HELPER_PROTOCOL_VERSION && typeof value.requestId === "string" &&
    REQUEST_ID.test(value.requestId) && typeof value.operation === "string" &&
    RUNTIME_HELPER_OPERATIONS.includes(value.operation as RuntimeHelperOperation) && typeof value.ok === "boolean" &&
    (value.errorCode === null || typeof value.errorCode === "string");
}

export function helperIdentityForPackage(
  runtimeId: string,
  generation: number,
  pkg: Pick<LocalRunnerPackage, "buildId" | "buildFingerprint" | "packageHash">,
): HelperRuntimeIdentity {
  const value = { runtimeId, generation, buildId: pkg.buildId, buildFingerprint: pkg.buildFingerprint, packageHash: pkg.packageHash };
  if (!validHelperRuntimeIdentity(value)) throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  return value;
}

export function sameHelperRuntime(left: HelperRuntimeIdentity, right: HelperRuntimeIdentity): boolean {
  return left.runtimeId === right.runtimeId && left.buildId === right.buildId &&
    left.buildFingerprint === right.buildFingerprint && left.packageHash === right.packageHash &&
    left.generation === right.generation;
}
