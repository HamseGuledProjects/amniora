import { createHash, createPublicKey, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import {
  LOCAL_FIRST_PRODUCT_AUDIENCE,
  LOCAL_FIRST_PRODUCT_OPERATIONS,
  LOCAL_FIRST_PRODUCT_PROTOCOL,
  type ProductFailureCode,
  type AuthoritativeRunnerResult,
  type ProductOperation,
} from "./contract";

export const PRODUCT_PAIRING_CALLBACK = "com.amniora.runner:/pair" as const;
export const PRODUCT_PAIRING_TTL_MS = 120_000;
export const PRODUCT_TICKET_TTL_MS = 45_000;
export const PRODUCT_STATUS_FRESH_MS = 90_000;
export const PRODUCT_PRESENCE_FRESH_MS = 35_000;
export const PRODUCT_MAX_CLOCK_SKEW_MS = 10_000;

const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const INSTALLATION = /^ins_[A-Za-z0-9_-]{43}$/;
const REQUEST = /^req_[A-Za-z0-9_-]{43}$/;
const COMMAND = /^cmd_[A-Za-z0-9_-]{43}$/;
const CONTEXT = /^[A-Za-z0-9_:-]{8,128}$/;
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]{1,32})?$/;
const FAILURE_CODES = new Set<ProductFailureCode>(["RUNNER_NOT_INSTALLED", "RUNNER_UNPAIRED", "RUNNER_DID_NOT_RESPOND",
  "VM_NOT_CONFIGURED", "VM_POWERED_OFF", "GUEST_AGENT_UNAVAILABLE", "DOCKER_UNAVAILABLE", "PACKAGE_INCOMPATIBLE", "LAB_LAUNCH_FAILED",
  "LAB_RESET_FAILED", "LAB_STOPPED", "STATUS_STALE", "ANOTHER_LAB_ACTIVE", "PAIRING_REVOKED"]);

export type ProductProtocolErrorCode =
  | "REQUEST_INVALID" | "PAIRING_INVALID" | "PAIRING_EXPIRED" | "PAIRING_REPLAYED"
  | "PAIRING_DENIED" | "PAIRING_REVOKED" | "PKCE_INVALID" | "ACCOUNT_MISMATCH"
  | "RUNNER_MISMATCH" | "TICKET_INVALID" | "TICKET_EXPIRED" | "TICKET_REPLAYED"
  | "PROOF_INVALID" | "RESULT_INVALID" | "RESULT_REPLAYED" | "IDEMPOTENCY_CONFLICT"
  | "CONTEXT_MISMATCH" | "RUNTIME_CONFLICT" | "OPERATION_IN_PROGRESS"
  | "PROTOCOL_VERSION_UNSUPPORTED" | "AUDIENCE_MISMATCH";

export class ProductProtocolError extends Error {
  constructor(readonly code: ProductProtocolErrorCode) { super(code); this.name = "ProductProtocolError"; }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

export const validOpaque = (value: unknown): value is string => typeof value === "string" && OPAQUE.test(value);
export const validInstallationId = (value: unknown): value is string => typeof value === "string" && INSTALLATION.test(value);
export const validRequestId = (value: unknown): value is string => typeof value === "string" && REQUEST.test(value);
export const validCommandId = (value: unknown): value is string => typeof value === "string" && COMMAND.test(value);
export const validContextId = (value: unknown): value is string => typeof value === "string" && CONTEXT.test(value);
export const validSignature = (value: unknown): value is string => typeof value === "string" && SIGNATURE.test(value);
export const validOperation = (value: unknown): value is ProductOperation =>
  typeof value === "string" && LOCAL_FIRST_PRODUCT_OPERATIONS.includes(value as ProductOperation);

export function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pkceChallenge(verifier: string): string {
  if (!PKCE.test(verifier)) throw new ProductProtocolError("PKCE_INVALID");
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function canonicalRunnerKey(value: unknown): KeyObject {
  if (typeof value !== "string" || value.length < 80 || value.length > 256) throw new ProductProtocolError("PAIRING_INVALID");
  try {
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519" || key.export({ type: "spki", format: "pem" }).toString() !== value) {
      throw new Error("non_canonical");
    }
    return key;
  } catch { throw new ProductProtocolError("PAIRING_INVALID"); }
}

export function installationIdForKey(value: string): string {
  const der = canonicalRunnerKey(value).export({ type: "spki", format: "der" });
  return `ins_${createHash("sha256").update(der).digest("base64url")}`;
}

export function shortFingerprint(value: string): string {
  const encoded = createHash("sha256").update(canonicalRunnerKey(value).export({ type: "spki", format: "der" })).digest("hex").toUpperCase();
  return `${encoded.slice(0, 4)} ${encoded.slice(4, 8)} ${encoded.slice(8, 12)} ${encoded.slice(12, 16)}`;
}

function canonicalBytes(label: string, fields: Record<string, string>): Buffer {
  const entries = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || /[\r\n]/.test(value))) {
    throw new ProductProtocolError("REQUEST_INVALID");
  }
  return Buffer.from(`AMNIORA_LOCAL_FIRST_${label}_V1\n${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
}

export function pairingProofBytes(input: Readonly<{
  authorizationRequestId: string; authorizationCode: string; installationId: string; state: string;
}>): Buffer {
  return canonicalBytes("PAIR", {
    authorizationCodeDigest: digest(input.authorizationCode),
    authorizationRequestId: input.authorizationRequestId,
    audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    installationId: input.installationId,
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
    stateDigest: digest(input.state),
  });
}

export function redeemProofBytes(input: Readonly<{
  ticket: string; installationId: string; clientNonce: string; signedAt: number;
}>): Buffer {
  return canonicalBytes("REDEEM", {
    audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    clientNonce: input.clientNonce,
    installationId: input.installationId,
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
    signedAt: String(input.signedAt),
    ticketDigest: digest(input.ticket),
  });
}

export function unpairProofBytes(input: Readonly<{
  installationId: string; clientNonce: string; signedAt: number;
}>): Buffer {
  return canonicalBytes("UNPAIR", {
    audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    clientNonce: input.clientNonce,
    installationId: input.installationId,
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
    signedAt: String(input.signedAt),
  });
}

export function presenceProofBytes(input: Readonly<{
  installationId: string; clientNonce: string; signedAt: number;
}>): Buffer {
  return canonicalBytes("PRESENCE", {
    audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    clientNonce: input.clientNonce,
    installationId: input.installationId,
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
    signedAt: String(input.signedAt),
  });
}

function canonicalResult(result: AuthoritativeRunnerResult): string {
  return JSON.stringify({
    code: result.code,
    docker: result.docker ? { state: result.docker.state, version: result.docker.version } : null,
    guestAgent: result.guestAgent ? { state: result.guestAgent.state } : null,
    ok: result.ok,
    runner: { platform: result.runner.platform, version: result.runner.version },
    runtime: result.runtime ? { buildId: result.runtime.buildId, generation: result.runtime.generation,
      labName: result.runtime.labName, runtimeId: result.runtime.runtimeId, state: result.runtime.state } : null,
    virtualMachine: result.virtualMachine ? { architecture: result.virtualMachine.architecture, name: result.virtualMachine.name,
      operatingSystem: result.virtualMachine.operatingSystem, state: result.virtualMachine.state } : null,
  });
}

export function resultDigest(result: AuthoritativeRunnerResult): string { return digest(canonicalResult(result)); }

export function resultProofBytes(input: Readonly<{
  requestId: string; commandId: string; installationId: string; operation: ProductOperation;
  nonce: string; completedAt: number; result: AuthoritativeRunnerResult;
}>): Buffer {
  return canonicalBytes("RESULT", {
    audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    commandId: input.commandId,
    completedAt: String(input.completedAt),
    installationId: input.installationId,
    nonce: input.nonce,
    operation: input.operation,
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
    requestId: input.requestId,
    resultDigest: resultDigest(input.result),
  });
}

export function verifyProof(key: KeyObject, bytes: Buffer, proof: string): boolean {
  if (!validSignature(proof)) return false;
  return verify(null, bytes, key, Buffer.from(proof, "base64url"));
}

function readiness(value: unknown): boolean { return value === "ready" || value === "unavailable" || value === "unknown"; }
function safeText(value: unknown, max = 120): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max && !/[\r\n\0]/.test(value);
}

export function validRunnerResult(value: unknown): value is AuthoritativeRunnerResult {
  if (!isRecord(value) || !exactKeys(value, ["ok", "code", "runner", "virtualMachine", "guestAgent", "docker", "runtime"]) ||
      typeof value.ok !== "boolean" || (value.code !== null && !FAILURE_CODES.has(value.code as ProductFailureCode)) ||
      !isRecord(value.runner) || !exactKeys(value.runner, ["version", "platform"]) ||
      (value.runner.platform !== "macOS" && value.runner.platform !== "Windows") ||
      typeof value.runner.version !== "string" || !VERSION.test(value.runner.version) ||
      (value.virtualMachine !== null && (!isRecord(value.virtualMachine) || !exactKeys(value.virtualMachine, ["name", "operatingSystem", "architecture", "state"]) ||
        !safeText(value.virtualMachine.name, 80) || value.virtualMachine.operatingSystem !== "Ubuntu 24.04" ||
        !["arm64", "amd64"].includes(String(value.virtualMachine.architecture)) || !readiness(value.virtualMachine.state))) ||
      (value.guestAgent !== null && (!isRecord(value.guestAgent) || !exactKeys(value.guestAgent, ["state"]) || !readiness(value.guestAgent.state))) ||
      (value.docker !== null && (!isRecord(value.docker) || !exactKeys(value.docker, ["version", "state"]) || !readiness(value.docker.state) ||
        (value.docker.version !== null && (typeof value.docker.version !== "string" || !VERSION.test(value.docker.version)))))) return false;
  if (value.ok && (!value.virtualMachine || !value.guestAgent || !value.docker || value.code !== null)) return false;
  if (!value.ok && value.code === null) return false;
  if (value.runtime === null) return true;
  return isRecord(value.runtime) && exactKeys(value.runtime, ["buildId", "runtimeId", "generation", "labName", "state"]) &&
    validContextId(value.runtime.buildId) && validContextId(value.runtime.runtimeId) &&
    Number.isSafeInteger(value.runtime.generation) && Number(value.runtime.generation) >= 1 &&
    safeText(value.runtime.labName, 120) && ["stopped", "starting", "running", "resetting", "stopping", "failed"].includes(String(value.runtime.state));
}
