import { createHash, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import {
  canonicalPublicKey,
  hasExactKeys,
  isPlainObject,
  requireEd25519PublicKey,
  validIdempotencyKey,
} from "../byo-runner/protocol";

export const LOCAL_FIRST_PROTOCOL_VERSION = "1.0" as const;
export const LOCAL_FIRST_AUDIENCE = "com.amniora.runner.command.v1" as const;
export const LOCAL_FIRST_ACTIVATION_SCHEME = "com.amniora.runner" as const;
export const LOCAL_FIRST_TICKET_TTL_MS = 45_000;
export const LOCAL_FIRST_PAIRING_TTL_MS = 120_000;
export const LOCAL_FIRST_MAX_CLOCK_SKEW_MS = 10_000;
export const LOCAL_FIRST_MAX_URI_BYTES = 256;

export const LOCAL_FIRST_OPERATIONS = ["STATUS", "LAUNCH", "RESET", "STOP", "OPEN_LAB"] as const;
export type LocalFirstOperation = typeof LOCAL_FIRST_OPERATIONS[number];

export type LocalFirstStatusResult = Readonly<{
  status: "AVAILABLE";
  runnerVersion: string;
  platform: "macOS" | "Windows";
}>;

export type LocalFirstCommandBinding = Readonly<{
  accountId: string;
  installationId: string;
  operation: LocalFirstOperation;
  buildId: string | null;
  runtimeId: string | null;
  generation: number | null;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  idempotencyKey: string;
  protocolVersion: typeof LOCAL_FIRST_PROTOCOL_VERSION;
  audience: typeof LOCAL_FIRST_AUDIENCE;
}>;

export type LocalFirstRedeemRequest = Readonly<{
  protocolVersion: typeof LOCAL_FIRST_PROTOCOL_VERSION;
  audience: typeof LOCAL_FIRST_AUDIENCE;
  ticket: string;
  installationId: string;
  clientNonce: string;
  signedAt: number;
  proof: string;
}>;

export type LocalFirstCommand = Readonly<{
  protocolVersion: typeof LOCAL_FIRST_PROTOCOL_VERSION;
  audience: typeof LOCAL_FIRST_AUDIENCE;
  requestId: string;
  commandId: string;
  installationId: string;
  operation: LocalFirstOperation;
  buildId: string | null;
  runtimeId: string | null;
  generation: number | null;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}>;

export type LocalFirstResultRequest = Readonly<{
  protocolVersion: typeof LOCAL_FIRST_PROTOCOL_VERSION;
  audience: typeof LOCAL_FIRST_AUDIENCE;
  requestId: string;
  commandId: string;
  installationId: string;
  operation: LocalFirstOperation;
  nonce: string;
  completedAt: number;
  result: LocalFirstStatusResult;
  proof: string;
}>;

export type LocalFirstErrorCode =
  | "PAIRING_INVALID"
  | "PAIRING_EXPIRED"
  | "PAIRING_REPLAYED"
  | "PAIRING_DENIED"
  | "PAIRING_REVOKED"
  | "PKCE_INVALID"
  | "ACCOUNT_MISMATCH"
  | "RUNNER_MISMATCH"
  | "TICKET_INVALID"
  | "TICKET_EXPIRED"
  | "TICKET_REPLAYED"
  | "PROOF_INVALID"
  | "RESULT_INVALID"
  | "RESULT_REPLAYED"
  | "IDEMPOTENCY_CONFLICT"
  | "OPERATION_NOT_ENABLED"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "AUDIENCE_MISMATCH"
  | "REQUEST_INVALID";

export class LocalFirstError extends Error {
  constructor(readonly code: LocalFirstErrorCode) {
    super(code);
    this.name = "LocalFirstError";
  }
}

const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SAFE_CONTEXT_ID = /^[A-Za-z0-9_:-]{8,128}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[A-Za-z0-9.-]{1,32})?$/;

export function validAccountId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

export function validInstallationId(value: unknown): value is string {
  return typeof value === "string" && /^ins_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^req_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validCommandId(value: unknown): value is string {
  return typeof value === "string" && /^cmd_[A-Za-z0-9_-]{43}$/.test(value);
}

export function validOpaqueValue(value: unknown): value is string {
  return typeof value === "string" && BASE64URL_32.test(value);
}

export function validSignature(value: unknown): value is string {
  return typeof value === "string" && BASE64URL_SIGNATURE.test(value);
}

export function validContextId(value: unknown): value is string {
  return typeof value === "string" && SAFE_CONTEXT_ID.test(value);
}

export function validOperation(value: unknown): value is LocalFirstOperation {
  return typeof value === "string" && LOCAL_FIRST_OPERATIONS.includes(value as LocalFirstOperation);
}

export function validStatusResult(value: unknown): value is LocalFirstStatusResult {
  return isPlainObject(value) && hasExactKeys(value, ["status", "runnerVersion", "platform"]) &&
    value.status === "AVAILABLE" && (value.platform === "macOS" || value.platform === "Windows") && typeof value.runnerVersion === "string" &&
    VERSION.test(value.runnerVersion);
}

export function requireCanonicalRunnerPublicKey(value: unknown): KeyObject {
  try {
    const key = requireEd25519PublicKey(value);
    if (canonicalPublicKey(key) !== value) throw new Error("non_canonical_public_key");
    return key;
  } catch {
    throw new LocalFirstError("PAIRING_INVALID");
  }
}

export function installationIdForPublicKey(value: string): string {
  const key = requireCanonicalRunnerPublicKey(value);
  const der = key.export({ type: "spki", format: "der" });
  return `ins_${createHash("sha256").update(der).digest("base64url")}`;
}

export function opaqueDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function signedBytes(label: string, fields: Readonly<Record<string, string>>): Buffer {
  const entries = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
  if (entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || /[\r\n]/.test(value))) {
    throw new LocalFirstError("REQUEST_INVALID");
  }
  return Buffer.from(`AMNIORA_LOCAL_FIRST_${label}_V1\n${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
}

export function redeemProofBytes(input: Readonly<{
  ticket: string;
  installationId: string;
  clientNonce: string;
  signedAt: number;
  protocolVersion?: string;
  audience?: string;
}>): Buffer {
  return signedBytes("REDEEM", {
    audience: input.audience ?? LOCAL_FIRST_AUDIENCE,
    clientNonce: input.clientNonce,
    installationId: input.installationId,
    protocolVersion: input.protocolVersion ?? LOCAL_FIRST_PROTOCOL_VERSION,
    signedAt: String(input.signedAt),
    ticketDigest: opaqueDigest(input.ticket),
  });
}

function canonicalResult(result: LocalFirstStatusResult): string {
  return JSON.stringify({ platform: result.platform, runnerVersion: result.runnerVersion, status: result.status });
}

export function resultDigest(result: LocalFirstStatusResult): string {
  return createHash("sha256").update(canonicalResult(result), "utf8").digest("base64url");
}

export function resultProofBytes(input: Readonly<{
  requestId: string;
  commandId: string;
  installationId: string;
  operation: LocalFirstOperation;
  nonce: string;
  completedAt: number;
  result: LocalFirstStatusResult;
  protocolVersion?: string;
  audience?: string;
}>): Buffer {
  return signedBytes("RESULT", {
    audience: input.audience ?? LOCAL_FIRST_AUDIENCE,
    commandId: input.commandId,
    completedAt: String(input.completedAt),
    installationId: input.installationId,
    nonce: input.nonce,
    operation: input.operation,
    protocolVersion: input.protocolVersion ?? LOCAL_FIRST_PROTOCOL_VERSION,
    requestId: input.requestId,
    resultDigest: resultDigest(input.result),
  });
}

function equalSignature(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyRunnerProof(publicKey: KeyObject, bytes: Buffer, proof: string): boolean {
  if (!validSignature(proof)) return false;
  const signature = Buffer.from(proof, "base64url");
  if (signature.length !== 64) return false;
  // Verify once through Node, then compare the canonical decoded representation in constant time.
  return equalSignature(signature, Buffer.from(signature.toString("base64url"), "base64url")) &&
    verify(null, bytes, publicKey, signature);
}

export function validRedeemRequest(value: unknown): value is LocalFirstRedeemRequest {
  return isPlainObject(value) && hasExactKeys(value, [
    "protocolVersion", "audience", "ticket", "installationId", "clientNonce", "signedAt", "proof",
  ]) && value.protocolVersion === LOCAL_FIRST_PROTOCOL_VERSION && value.audience === LOCAL_FIRST_AUDIENCE &&
    validOpaqueValue(value.ticket) && validInstallationId(value.installationId) &&
    validOpaqueValue(value.clientNonce) && Number.isSafeInteger(value.signedAt) && validSignature(value.proof);
}

export function validResultRequest(value: unknown): value is LocalFirstResultRequest {
  return isPlainObject(value) && hasExactKeys(value, [
    "protocolVersion", "audience", "requestId", "commandId", "installationId", "operation", "nonce",
    "completedAt", "result", "proof",
  ]) && value.protocolVersion === LOCAL_FIRST_PROTOCOL_VERSION && value.audience === LOCAL_FIRST_AUDIENCE &&
    validRequestId(value.requestId) && validCommandId(value.commandId) &&
    validInstallationId(value.installationId) && validOperation(value.operation) && validOpaqueValue(value.nonce) &&
    Number.isSafeInteger(value.completedAt) && validStatusResult(value.result) && validSignature(value.proof);
}

export function validCommandIssueInput(value: unknown): value is Readonly<{
  accountId: string;
  installationId: string;
  operation: LocalFirstOperation;
  buildId: string | null;
  runtimeId: string | null;
  generation: number | null;
  idempotencyKey: string;
}> {
  return isPlainObject(value) && hasExactKeys(value, [
    "accountId", "installationId", "operation", "buildId", "runtimeId", "generation", "idempotencyKey",
  ]) && validAccountId(value.accountId) && validInstallationId(value.installationId) &&
    validOperation(value.operation) && (value.buildId === null || validContextId(value.buildId)) &&
    (value.runtimeId === null || validContextId(value.runtimeId)) &&
    (value.generation === null || (Number.isSafeInteger(value.generation) && Number(value.generation) >= 1)) &&
    validIdempotencyKey(value.idempotencyKey);
}

export { hasExactKeys, isPlainObject, validIdempotencyKey };
