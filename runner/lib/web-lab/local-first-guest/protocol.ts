import { createHash, createPublicKey, timingSafeEqual, verify, X509Certificate, type KeyObject } from "node:crypto";
import {
  canonicalPublicKey,
  hasExactKeys,
  isPlainObject,
} from "../byo-runner/protocol";
import { validLocalViewerRelayHttpRequest } from "../local-first-viewer/http-protocol";

export const GUEST_PROTOCOL_VERSION = "1.0" as const;
export const GUEST_AGENT_VERSION = "0.3.0-phase3" as const;
export const GUEST_CHANNEL_AUDIENCE = "com.amniora.runner.guest-channel.v1" as const;
export const GUEST_PAIRING_TTL_MS = 120_000;
export const GUEST_AUTH_TTL_MS = 10_000;
export const GUEST_MESSAGE_TTL_MS = 30_000;
export const GUEST_MAX_CLOCK_SKEW_MS = 5_000;
export const GUEST_MAX_FRAME_BYTES = 640 * 1024;
export const GUEST_HANDSHAKE_TIMEOUT_MS = 8_000;
// Launch/reset include bounded Docker creation and health checks (up to 30s),
// so the authenticated transport deadline must leave room for that work.
export const GUEST_REQUEST_TIMEOUT_MS = 60_000;
export const GUEST_PAIRING_CIPHER = "DHE-PSK-AES256-GCM-SHA384" as const;
export const GUEST_CHANNEL_PORT = 47_832;
export const GUEST_PAIRING_PORT = 47_831;
export const GUEST_HOST_ADDRESS = "192.168.63.1" as const;
export const GUEST_VM_ADDRESS = "192.168.63.2" as const;

export const PHASE2_OPERATIONS = ["PING", "STATUS", "GUEST_INFO", "DOCKER_STATUS"] as const;
export const PHASE3_OPERATIONS = ["LAUNCH", "RUNTIME_STATUS", "RESET", "STOP", "DIAGNOSTIC_PROBE"] as const;
export const PHASE4_OPERATIONS = ["RELAY_HTTP"] as const;
export const GUEST_OPERATIONS = [...PHASE2_OPERATIONS, ...PHASE3_OPERATIONS, ...PHASE4_OPERATIONS] as const;
export const FUTURE_DISABLED_OPERATIONS = [] as const;
export type Phase2Operation = typeof PHASE2_OPERATIONS[number];
export type Phase3Operation = typeof PHASE3_OPERATIONS[number];
export type Phase4Operation = typeof PHASE4_OPERATIONS[number];
export type GuestOperation = typeof GUEST_OPERATIONS[number];
export type SupportedGuestArchitecture = "arm64" | "amd64";

export type GuestInfo = Readonly<{
  os: "Ubuntu";
  osVersion: "24.04";
  architecture: SupportedGuestArchitecture;
  agentVersion: typeof GUEST_AGENT_VERSION;
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
}>;

export type DockerStatus = Readonly<{
  installed: boolean;
  version: string | null;
  architecture: SupportedGuestArchitecture | null;
  serviceState: "ready" | "unavailable";
}>;

export type GuestStatus = Readonly<{
  state: "READY";
  protocolCompatible: true;
  guest: GuestInfo;
  docker: DockerStatus;
}>;

export type PairingRequest = Readonly<{
  type: "PAIR_REQUEST";
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
  audience: typeof GUEST_CHANNEL_AUDIENCE;
  pairingId: string;
  expiresAt: number;
  desktopNonce: string;
  guestNonce: string;
  guestPublicKey: string;
  guestCertificate: string;
  proof: string;
}>;

export type PairingAccept = Readonly<{
  type: "PAIR_ACCEPT";
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
  audience: typeof GUEST_CHANNEL_AUDIENCE;
  pairingId: string;
  desktopNonce: string;
  guestNonce: string;
  desktopPublicKey: string;
  pairedAt: number;
  proof: string;
}>;

export type ServerChallenge = Readonly<{
  type: "SERVER_CHALLENGE";
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
  audience: typeof GUEST_CHANNEL_AUDIENCE;
  sessionId: string;
  generation: number;
  serverNonce: string;
  issuedAt: number;
  expiresAt: number;
  proof: string;
}>;

export type ClientProof = Readonly<{
  type: "CLIENT_PROOF";
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
  audience: typeof GUEST_CHANNEL_AUDIENCE;
  sessionId: string;
  generation: number;
  serverNonce: string;
  clientNonce: string;
  desktopId: string;
  signedAt: number;
  proof: string;
}>;

export type GuestRequest = Readonly<{
  type: "REQUEST";
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
  sessionId: string;
  generation: number;
  sequence: number;
  requestId: string;
  operation: GuestOperation;
  sentAt: number;
}> & Readonly<{ input?: unknown }>;

export type GuestResponse = Readonly<{
  type: "RESPONSE";
  protocolVersion: typeof GUEST_PROTOCOL_VERSION;
  sessionId: string;
  generation: number;
  sequence: number;
  requestId: string;
  operation: GuestOperation;
  ok: boolean;
  result: unknown;
  errorCode: GuestChannelErrorCode | null;
  completedAt: number;
}>;

export type GuestChannelErrorCode =
  | "PAIRING_INVALID"
  | "PAIRING_EXPIRED"
  | "PAIRING_REPLAYED"
  | "PROOF_INVALID"
  | "PEER_NOT_PAIRED"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "DOWNGRADE_REJECTED"
  | "MESSAGE_INVALID"
  | "OPERATION_NOT_ENABLED"
  | "FRAME_TOO_LARGE"
  | "SESSION_STALE"
  | "SESSION_SUPERSEDED"
  | "MESSAGE_REPLAYED"
  | "IDEMPOTENCY_CONFLICT"
  | "ARCHITECTURE_UNSUPPORTED"
  | "PACKAGE_INVALID"
  | "PACKAGE_PLATFORM_UNSUPPORTED"
  | "RUNTIME_NOT_FOUND"
  | "RUNTIME_ALREADY_ACTIVE"
  | "RUNTIME_HELPER_UNAVAILABLE"
  | "RUNTIME_OPERATION_FAILED"
  | "RELAY_RUNTIME_STALE"
  | "RELAY_REQUEST_INVALID"
  | "RELAY_REDIRECT_DENIED"
  | "RELAY_UPSTREAM_TIMEOUT"
  | "RELAY_UPSTREAM_UNAVAILABLE"
  | "RELAY_RESPONSE_TOO_LARGE"
  | "TIMEOUT"
  | "TRANSPORT_DENIED"
  | "INTERNAL_ERROR";

export class GuestChannelError extends Error {
  constructor(readonly code: GuestChannelErrorCode) {
    super(code);
    this.name = "GuestChannelError";
  }
}

const OPAQUE_32 = /^[A-Za-z0-9_-]{43}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const PAIRING_ID = /^pair_[A-Za-z0-9_-]{43}$/;
const SESSION_ID = /^ses_[A-Za-z0-9_-]{43}$/;
const REQUEST_ID = /^greq_[A-Za-z0-9_-]{43}$/;
const DESKTOP_ID = /^ins_[A-Za-z0-9_-]{43}$/;
const SAFE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:[-+][A-Za-z0-9.-]{1,32})?$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const RUNTIME_ID = /^[0-9a-f]{32}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

export type GuestRuntimeStatus = Readonly<{
  state: "idle" | "starting" | "ready" | "resetting" | "stopping" | "failed" | "expired";
  runtimeId: string | null;
  buildId: string | null;
  buildFingerprint: string | null;
  generation: number | null;
  ready: boolean;
  labType: "web-security" | null;
  architecture: SupportedGuestArchitecture;
  ingressReady: boolean;
  startedAt: number | null;
  errorCode: string | null;
}>;

export function validSupportedArchitecture(value: unknown): value is SupportedGuestArchitecture {
  return value === "arm64" || value === "amd64";
}

export function normalizeLinuxArchitecture(value: string): SupportedGuestArchitecture {
  if (value === "arm64" || value === "aarch64") return "arm64";
  if (value === "x64" || value === "x86_64" || value === "amd64") return "amd64";
  throw new GuestChannelError("ARCHITECTURE_UNSUPPORTED");
}

export function validGuestInfo(value: unknown): value is GuestInfo {
  return isPlainObject(value) && hasExactKeys(value, ["os", "osVersion", "architecture", "agentVersion", "protocolVersion"]) &&
    value.os === "Ubuntu" && value.osVersion === "24.04" && validSupportedArchitecture(value.architecture) &&
    value.agentVersion === GUEST_AGENT_VERSION && value.protocolVersion === GUEST_PROTOCOL_VERSION;
}

export function validDockerStatus(value: unknown): value is DockerStatus {
  return isPlainObject(value) && hasExactKeys(value, ["installed", "version", "architecture", "serviceState"]) &&
    typeof value.installed === "boolean" && (value.version === null || (typeof value.version === "string" && SAFE_VERSION.test(value.version))) &&
    (value.architecture === null || validSupportedArchitecture(value.architecture)) &&
    (value.serviceState === "ready" || value.serviceState === "unavailable") &&
    (value.installed || (value.version === null && value.architecture === null && value.serviceState === "unavailable"));
}

export function validGuestStatus(value: unknown): value is GuestStatus {
  return isPlainObject(value) && hasExactKeys(value, ["state", "protocolCompatible", "guest", "docker"]) &&
    value.state === "READY" && value.protocolCompatible === true && validGuestInfo(value.guest) && validDockerStatus(value.docker);
}

export function requireEd25519(value: unknown): KeyObject {
  try {
    if (typeof value !== "string") throw new Error("invalid");
    const key = createPublicKey(value);
    if (key.asymmetricKeyType !== "ed25519" || canonicalPublicKey(key) !== value) throw new Error("invalid");
    return key;
  } catch {
    throw new GuestChannelError("PAIRING_INVALID");
  }
}

export function publicKeyFingerprint(value: string): string {
  const key = requireEd25519(value);
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

export function certificateFingerprint(value: string | Buffer): string {
  try { return createHash("sha256").update(new X509Certificate(value).raw).digest("hex"); }
  catch { throw new GuestChannelError("PAIRING_INVALID"); }
}

export function canonicalGuestBytes(label: string, fields: Readonly<Record<string, string | number>>): Buffer {
  const entries = Object.entries(fields).sort(([left], [right]) => left.localeCompare(right));
  if (!/^[A-Z][A-Z0-9_]{2,48}$/.test(label) || entries.some(([key, value]) =>
    !/^[A-Za-z][A-Za-z0-9]*$/.test(key) || /[\r\n]/.test(String(value)))) {
    throw new GuestChannelError("MESSAGE_INVALID");
  }
  return Buffer.from(`AMNIORA_GUEST_${label}_V1\n${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`, "utf8");
}

function validProof(value: unknown): value is string {
  return typeof value === "string" && SIGNATURE.test(value);
}

export function verifyGuestProof(publicKey: string | KeyObject, bytes: Buffer, proof: string): boolean {
  if (!validProof(proof)) return false;
  const decoded = Buffer.from(proof, "base64url");
  const canonical = Buffer.from(decoded.toString("base64url"), "base64url");
  return decoded.length === 64 && timingSafeEqual(decoded, canonical) &&
    verify(null, bytes, typeof publicKey === "string" ? requireEd25519(publicKey) : publicKey, decoded);
}

export function pairingProofBytes(input: Omit<PairingRequest, "type" | "proof" | "guestCertificate"> & Readonly<{ guestCertificateFingerprint: string }>): Buffer {
  return canonicalGuestBytes("PAIR_REQUEST", {
    audience: input.audience,
    desktopNonce: input.desktopNonce,
    expiresAt: input.expiresAt,
    guestCertificateFingerprint: input.guestCertificateFingerprint,
    guestNonce: input.guestNonce,
    guestPublicKeyFingerprint: publicKeyFingerprint(input.guestPublicKey),
    pairingId: input.pairingId,
    protocolVersion: input.protocolVersion,
  });
}

export function pairingAcceptProofBytes(input: Omit<PairingAccept, "type" | "proof"> & Readonly<{ guestPublicKeyFingerprint: string }>): Buffer {
  return canonicalGuestBytes("PAIR_ACCEPT", {
    audience: input.audience,
    desktopNonce: input.desktopNonce,
    desktopPublicKeyFingerprint: publicKeyFingerprint(input.desktopPublicKey),
    guestNonce: input.guestNonce,
    guestPublicKeyFingerprint: input.guestPublicKeyFingerprint,
    pairedAt: input.pairedAt,
    pairingId: input.pairingId,
    protocolVersion: input.protocolVersion,
  });
}

export function serverChallengeProofBytes(input: Omit<ServerChallenge, "type" | "proof">): Buffer {
  return canonicalGuestBytes("SERVER_CHALLENGE", input);
}

export function clientProofBytes(input: Omit<ClientProof, "type" | "proof">): Buffer {
  return canonicalGuestBytes("CLIENT_PROOF", input);
}

export function validPairingRequest(value: unknown): value is PairingRequest {
  if (!isPlainObject(value) || !hasExactKeys(value, ["type", "protocolVersion", "audience", "pairingId", "expiresAt",
    "desktopNonce", "guestNonce", "guestPublicKey", "guestCertificate", "proof"])) return false;
  try { requireEd25519(value.guestPublicKey); } catch { return false; }
  return value.type === "PAIR_REQUEST" && value.protocolVersion === GUEST_PROTOCOL_VERSION &&
    value.audience === GUEST_CHANNEL_AUDIENCE && typeof value.pairingId === "string" && PAIRING_ID.test(value.pairingId) &&
    Number.isSafeInteger(value.expiresAt) && typeof value.desktopNonce === "string" && OPAQUE_32.test(value.desktopNonce) &&
    typeof value.guestNonce === "string" && OPAQUE_32.test(value.guestNonce) &&
    typeof value.guestCertificate === "string" && value.guestCertificate.length <= 4096 &&
    value.guestCertificate.includes("BEGIN CERTIFICATE") && validProof(value.proof);
}

export function validPairingAccept(value: unknown): value is PairingAccept {
  if (!isPlainObject(value) || !hasExactKeys(value, ["type", "protocolVersion", "audience", "pairingId", "desktopNonce",
    "guestNonce", "desktopPublicKey", "pairedAt", "proof"])) return false;
  try { requireEd25519(value.desktopPublicKey); } catch { return false; }
  return value.type === "PAIR_ACCEPT" && value.protocolVersion === GUEST_PROTOCOL_VERSION &&
    value.audience === GUEST_CHANNEL_AUDIENCE && typeof value.pairingId === "string" && PAIRING_ID.test(value.pairingId) &&
    typeof value.desktopNonce === "string" && OPAQUE_32.test(value.desktopNonce) &&
    typeof value.guestNonce === "string" && OPAQUE_32.test(value.guestNonce) && Number.isSafeInteger(value.pairedAt) &&
    validProof(value.proof);
}

export function validClientProof(value: unknown): value is ClientProof {
  return isPlainObject(value) && hasExactKeys(value, ["type", "protocolVersion", "audience", "sessionId", "generation",
    "serverNonce", "clientNonce", "desktopId", "signedAt", "proof"]) && value.type === "CLIENT_PROOF" &&
    value.protocolVersion === GUEST_PROTOCOL_VERSION && value.audience === GUEST_CHANNEL_AUDIENCE &&
    typeof value.sessionId === "string" && SESSION_ID.test(value.sessionId) && Number.isSafeInteger(value.generation) &&
    Number(value.generation) >= 1 && typeof value.serverNonce === "string" && OPAQUE_32.test(value.serverNonce) &&
    typeof value.clientNonce === "string" && OPAQUE_32.test(value.clientNonce) && typeof value.desktopId === "string" &&
    DESKTOP_ID.test(value.desktopId) && Number.isSafeInteger(value.signedAt) && validProof(value.proof);
}

export function requireGuestRequest(value: unknown, phase3Enabled = false): GuestRequest {
  if (!isPlainObject(value)) throw new GuestChannelError("MESSAGE_INVALID");
  const baseKeys = ["type", "protocolVersion", "sessionId", "generation", "sequence", "requestId", "operation", "sentAt"];
  const inputKeys = [...baseKeys, "input"];
  if (!hasExactKeys(value, baseKeys) && !hasExactKeys(value, inputKeys)) throw new GuestChannelError("MESSAGE_INVALID");
  if (value.protocolVersion !== GUEST_PROTOCOL_VERSION) throw new GuestChannelError(
    typeof value.protocolVersion === "string" && /^0\./.test(value.protocolVersion) ? "DOWNGRADE_REJECTED" : "PROTOCOL_VERSION_UNSUPPORTED",
  );
  const enabledOperations: readonly string[] = phase3Enabled ? GUEST_OPERATIONS : PHASE2_OPERATIONS;
  if (typeof value.operation !== "string" || !enabledOperations.includes(value.operation)) {
    throw new GuestChannelError("OPERATION_NOT_ENABLED");
  }
  const phase3 = PHASE3_OPERATIONS.includes(value.operation as Phase3Operation);
  const expectsInput = ["LAUNCH", "RESET", "STOP", "DIAGNOSTIC_PROBE", "RELAY_HTTP"].includes(value.operation);
  const keys = expectsInput ? inputKeys : baseKeys;
  if (!hasExactKeys(value, keys)) throw new GuestChannelError("MESSAGE_INVALID");
  if (value.type !== "REQUEST" || typeof value.sessionId !== "string" || !SESSION_ID.test(value.sessionId) ||
      !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 || !Number.isSafeInteger(value.sequence) ||
      Number(value.sequence) < 1 || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId) ||
      !Number.isSafeInteger(value.sentAt)) throw new GuestChannelError("MESSAGE_INVALID");
  if ((phase3 || value.operation === "RELAY_HTTP") && expectsInput) {
    if (!isPlainObject(value.input)) throw new GuestChannelError("MESSAGE_INVALID");
    if (value.operation === "LAUNCH") {
      if (!hasExactKeys(value.input, ["package", "idempotencyKey"]) || !isPlainObject(value.input.package) ||
          typeof value.input.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(value.input.idempotencyKey)) {
        throw new GuestChannelError("MESSAGE_INVALID");
      }
    } else if (value.operation === "RELAY_HTTP") {
      if (!hasExactKeys(value.input, ["runtimeId", "buildFingerprint", "generation", "request"]) ||
          typeof value.input.runtimeId !== "string" || !RUNTIME_ID.test(value.input.runtimeId) ||
          typeof value.input.buildFingerprint !== "string" || !FINGERPRINT.test(value.input.buildFingerprint) ||
          !Number.isSafeInteger(value.input.generation) || Number(value.input.generation) < 1 ||
          !validLocalViewerRelayHttpRequest(value.input.request)) throw new GuestChannelError("MESSAGE_INVALID");
    } else {
      if (!hasExactKeys(value.input, value.operation === "DIAGNOSTIC_PROBE"
        ? ["runtimeId", "buildFingerprint", "generation"]
        : ["runtimeId", "buildFingerprint", "generation", "idempotencyKey"]) ||
          typeof value.input.runtimeId !== "string" || !RUNTIME_ID.test(value.input.runtimeId) ||
          typeof value.input.buildFingerprint !== "string" || !FINGERPRINT.test(value.input.buildFingerprint) ||
          !Number.isSafeInteger(value.input.generation) || Number(value.input.generation) < 1 ||
          (value.operation !== "DIAGNOSTIC_PROBE" && (typeof value.input.idempotencyKey !== "string" ||
            !IDEMPOTENCY_KEY.test(value.input.idempotencyKey)))) throw new GuestChannelError("MESSAGE_INVALID");
    }
  }
  return value as GuestRequest;
}

export function validPairingSecret(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_32.test(value);
}

export function validHostOnlyAddress(value: unknown, role: "host" | "guest"): value is string {
  return value === (role === "host" ? GUEST_HOST_ADDRESS : GUEST_VM_ADDRESS);
}

export function validGuestResponse(value: unknown): value is GuestResponse {
  return isPlainObject(value) && hasExactKeys(value, ["type", "protocolVersion", "sessionId", "generation", "sequence",
    "requestId", "operation", "ok", "result", "errorCode", "completedAt"]) && value.type === "RESPONSE" &&
    value.protocolVersion === GUEST_PROTOCOL_VERSION && typeof value.sessionId === "string" && SESSION_ID.test(value.sessionId) &&
    Number.isSafeInteger(value.generation) && Number(value.generation) >= 1 && Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 1 && typeof value.requestId === "string" && REQUEST_ID.test(value.requestId) &&
    typeof value.operation === "string" && GUEST_OPERATIONS.includes(value.operation as GuestOperation) &&
    typeof value.ok === "boolean" && (value.errorCode === null || typeof value.errorCode === "string") &&
    Number.isSafeInteger(value.completedAt);
}

export function validGuestRuntimeStatus(value: unknown): value is GuestRuntimeStatus {
  if (!isPlainObject(value) || !hasExactKeys(value, ["state", "runtimeId", "buildId", "buildFingerprint", "generation",
    "ready", "labType", "architecture", "ingressReady", "startedAt", "errorCode"])) return false;
  const active = value.runtimeId !== null;
  return ["idle", "starting", "ready", "resetting", "stopping", "failed", "expired"].includes(String(value.state)) &&
    (value.runtimeId === null || (typeof value.runtimeId === "string" && RUNTIME_ID.test(value.runtimeId))) &&
    (value.buildId === null || (typeof value.buildId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value.buildId))) &&
    (value.buildFingerprint === null || (typeof value.buildFingerprint === "string" && FINGERPRINT.test(value.buildFingerprint))) &&
    (value.generation === null || (Number.isSafeInteger(value.generation) && Number(value.generation) >= 1)) &&
    typeof value.ready === "boolean" && (value.labType === null || value.labType === "web-security") &&
    validSupportedArchitecture(value.architecture) && typeof value.ingressReady === "boolean" &&
    (value.startedAt === null || Number.isSafeInteger(value.startedAt)) &&
    (value.errorCode === null || (typeof value.errorCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(value.errorCode))) &&
    (active || (value.buildId === null && value.buildFingerprint === null && value.generation === null && value.labType === null));
}

export { hasExactKeys, isPlainObject };
