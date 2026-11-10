// Browser-safe transport only. Ownership, compilation and signing stay on the server.
import {
  hasExactKeys, isPlainObject, LOCAL_RUNNER_CONTROL_HOST, LOCAL_RUNNER_CONTROL_PORT,
  LOCAL_RUNNER_PROTOCOL_VERSION, LOCAL_RUNNER_RUNTIME_VERSION, validFingerprint,
  validIdempotencyKey, validOpaqueId,
  type RunnerPublicStatus, type RunnerCapabilityScope,
} from "./protocol";

export type BrowserBuild = Readonly<{ buildId: string; buildFingerprint: string; runtimeVersion: string }>;
export type BrowserEligibility = Readonly<{ enabled: boolean; eligible: boolean; build: BrowserBuild | null }>;
export class RunnerBrowserError extends Error {
  constructor(readonly code: string) { super(code); this.name = "RunnerBrowserError"; }
}
const CONTROL_ORIGIN = `http://${LOCAL_RUNNER_CONTROL_HOST}:${LOCAL_RUNNER_CONTROL_PORT}`;
const STATUS_KEYS = ["state", "sessionId", "buildId", "buildFingerprint", "generation", "endpoint", "createdAt", "expiresAt", "trustLevel"];
const STATES = ["idle", "starting", "ready", "resetting", "stopping", "failed", "expired"];
const PACKAGE_KEYS = ["packageVersion", "protocolVersion", "buildId", "buildFingerprint", "schemaVersion", "templateId", "templateVersion", "vulnerabilityModuleId", "vulnerabilityModuleVersion", "runtimeVersion", "seed", "issuedAt", "expiresAt", "signatureAlgorithm", "keyId", "manifest", "bundle", "signature"];
const MANIFEST_KEYS = ["schemaVersion", "templateId", "templateVersion", "vulnerabilityId", "vulnerabilityVersion", "seed", "difficulty", "durationMinutes", "canonicalSpecSha256", "learnerBundleSha256"];
const fail = (code = "RUNNER_INCOMPATIBLE"): never => { throw new RunnerBrowserError(code); };

export function validateBrowserEndpoint(value: unknown): string {
  // Check the spelling BEFORE URL parsing, which normalises non-numeric hosts and dot paths.
  if (typeof value !== "string") return fail("INVALID_ENDPOINT");
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})\/?$/.exec(value);
  if (!match || match[0] !== value) return fail("INVALID_ENDPOINT");
  const port = Number(match[1]);
  if (port < 1024 || port > 65535 || port === LOCAL_RUNNER_CONTROL_PORT) return fail("INVALID_ENDPOINT");
  return value;
}

async function request(path: string, local: boolean, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  // Mutations can include Docker startup, but every request remains bounded.
  const timer = setTimeout(abort, body === undefined ? 5_000 : 30_000);
  try {
    const response = await fetch(local ? CONTROL_ORIGIN + path : path, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      credentials: local ? "omit" : "same-origin", signal: controller.signal,
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) return fail("INVALID_RESPONSE");
    if (!response.headers.get("content-type")?.includes("application/json")) return fail("INVALID_RESPONSE");
    const reader = response.body?.getReader();
    if (!reader) return fail("INVALID_RESPONSE");
    const decoder = new TextDecoder();
    let raw = "";
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 600_000) { await reader.cancel(); return fail("INVALID_RESPONSE"); }
        raw += decoder.decode(value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    let envelope: unknown;
    try { envelope = JSON.parse(raw); } catch { return fail("INVALID_RESPONSE"); }
    if (!isPlainObject(envelope) || !hasExactKeys(envelope, ["data", "error"])) return fail("INVALID_RESPONSE");
    if (!response.ok || envelope.error !== null) {
      if (envelope.data !== null || !isPlainObject(envelope.error) || !hasExactKeys(envelope.error, ["code"]) ||
          typeof envelope.error.code !== "string" || !/^[A-Z_]{3,64}$/.test(envelope.error.code)) return fail("INVALID_RESPONSE");
      return fail(envelope.error.code);
    }
    return envelope.data;
  } catch (error) {
    if (signal?.aborted) throw new RunnerBrowserError("CANCELLED");
    if (error instanceof RunnerBrowserError) throw error;
    throw new RunnerBrowserError(local ? "RUNNER_OFFLINE" : "LOCAL_RUNNER_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function validBuild(value: unknown): value is BrowserBuild {
  return isPlainObject(value) && hasExactKeys(value, ["buildId", "buildFingerprint", "runtimeVersion"]) &&
    validOpaqueId(value.buildId) && validFingerprint(value.buildFingerprint) && value.runtimeVersion === LOCAL_RUNNER_RUNTIME_VERSION;
}
function savedPath(id: string): string {
  if (!validOpaqueId(id)) return fail("INVALID_REQUEST");
  return `/api/web-labs/local-runner/${encodeURIComponent(id)}`;
}
export async function getEligibility(savedLabId: string, signal?: AbortSignal): Promise<BrowserEligibility> {
  const value = await request(savedPath(savedLabId), false, undefined, signal);
  if (!isPlainObject(value) || !hasExactKeys(value, ["enabled", "eligible", "build"]) ||
      typeof value.enabled !== "boolean" || typeof value.eligible !== "boolean") return fail("INVALID_RESPONSE");
  if (value.enabled && value.eligible && validBuild(value.build)) return value as BrowserEligibility;
  if (!value.eligible && value.build === null) return value as BrowserEligibility;
  return fail("INVALID_RESPONSE");
}

function statusValue(value: unknown, build: BrowserBuild): RunnerPublicStatus {
  if (!validBuild(build) || !isPlainObject(value) ||
      !hasExactKeys(value, value.errorCode === undefined ? STATUS_KEYS : [...STATUS_KEYS, "errorCode"]) ||
      !STATES.includes(String(value.state)) || value.trustLevel !== "local_self_hosted" ||
      (value.errorCode !== undefined && (typeof value.errorCode !== "string" || !/^[A-Z_]{3,64}$/.test(value.errorCode)))) return fail();
  const hasIdentity = value.sessionId !== null;
  if (hasIdentity) {
    if (typeof value.sessionId !== "string" || !/^[0-9a-f]{32}$/.test(value.sessionId) || !validOpaqueId(value.buildId) ||
        !validFingerprint(value.buildFingerprint) || !Number.isSafeInteger(value.generation) || Number(value.generation) < 1 ||
        !Number.isSafeInteger(value.createdAt) || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= Number(value.createdAt)) return fail();
  } else if (value.state !== "idle" || [value.buildId, value.buildFingerprint, value.generation, value.createdAt, value.expiresAt].some(item => item !== null)) return fail();
  if (value.state === "ready") validateBrowserEndpoint(value.endpoint);
  else if (value.endpoint !== null) return fail("INVALID_ENDPOINT");
  if (!["idle", "expired", "failed"].includes(String(value.state))) {
    if (value.buildId !== build.buildId) return fail("LOCAL_RUNTIME_ALREADY_ACTIVE");
    if (value.buildFingerprint !== build.buildFingerprint) return fail("BUILD_FINGERPRINT_MISMATCH");
  }
  // Never leave a stale Open Lab link live beyond the Runner's expiry.
  if (value.state === "ready" && Number(value.expiresAt) <= Date.now()) return { ...value, state: "expired", endpoint: null } as RunnerPublicStatus;
  return value as RunnerPublicStatus;
}
export async function getRunnerStatus(build: BrowserBuild, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  return statusValue(await request("/v1/status", true, undefined, signal), build);
}
export async function detectRunner(build: BrowserBuild, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  if (!validBuild(build)) return fail();
  const caps = await request(`/v1/capabilities?protocolVersion=${LOCAL_RUNNER_PROTOCOL_VERSION}`, true, undefined, signal);
  if (!isPlainObject(caps) || !hasExactKeys(caps, ["runnerVersion", "protocolVersion", "platform", "architecture", "testedPlatform", "docker", "supportedRuntimeVersions", "activeLocalRuntimeState", "protocolCompatibility", "outcome"])) return fail();
  if (caps.protocolVersion !== LOCAL_RUNNER_PROTOCOL_VERSION || caps.protocolCompatibility !== "compatible") return fail("PROTOCOL_VERSION_UNSUPPORTED");
  if (!Array.isArray(caps.supportedRuntimeVersions) || !caps.supportedRuntimeVersions.includes(build.runtimeVersion)) return fail("RUNTIME_VERSION_UNSUPPORTED");
  if (caps.outcome !== "RUNNER_READY") {
    return fail(["DOCKER_UNAVAILABLE", "DOCKER_DAEMON_UNAVAILABLE", "UNSUPPORTED_PLATFORM", "RUNNER_VERSION_UNSUPPORTED"].includes(String(caps.outcome)) ? String(caps.outcome) : "RUNNER_INCOMPATIBLE");
  }
  if (!isPlainObject(caps.docker) || !hasExactKeys(caps.docker, ["commandAvailable", "daemonReachable", "serverVersion"])) return fail();
  if (caps.docker.commandAvailable !== true) return fail("DOCKER_UNAVAILABLE");
  if (caps.docker.daemonReachable !== true) return fail("DOCKER_DAEMON_UNAVAILABLE");
  if (caps.testedPlatform !== true) return fail("UNSUPPORTED_PLATFORM");
  return getRunnerStatus(build, signal);
}

function safePackage(value: unknown, build: BrowserBuild): Record<string, unknown> {
  if (!isPlainObject(value) || !hasExactKeys(value, PACKAGE_KEYS) || value.packageVersion !== 1 ||
      value.protocolVersion !== LOCAL_RUNNER_PROTOCOL_VERSION || value.runtimeVersion !== build.runtimeVersion ||
      value.buildId !== build.buildId || value.buildFingerprint !== build.buildFingerprint || value.schemaVersion !== 1 ||
      value.signatureAlgorithm !== "Ed25519" || !validOpaqueId(value.keyId, 64) ||
      typeof value.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(value.signature) ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= Date.now() ||
      Number(value.issuedAt) > Date.now() + 60_000 || !isPlainObject(value.manifest) || !hasExactKeys(value.manifest, MANIFEST_KEYS) ||
      value.manifest.canonicalSpecSha256 !== build.buildFingerprint || !Array.isArray(value.bundle) || value.bundle.length !== 3) return fail("PACKAGE_INVALID");
  const paths = ["index.html", "initial-state.json", "runtime-config.json"];
  if (!value.bundle.every((file, i) => isPlainObject(file) && hasExactKeys(file, ["path", "content", "sha256"]) &&
      file.path === paths[i] && typeof file.content === "string" && validFingerprint(file.sha256))) return fail("PACKAGE_INVALID");
  // Cryptographic verification remains authoritative in the Runner, never in React.
  return value;
}
async function capability(scope: RunnerCapabilityScope, signal?: AbortSignal): Promise<string> {
  if (!validIdempotencyKey(scope.idempotencyKey)) return fail("INVALID_REQUEST");
  const value = await request("/v1/authorize", true, scope, signal);
  if (!isPlainObject(value) || !hasExactKeys(value, ["capability", "operation", "expiresAt"]) ||
      typeof value.capability !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value.capability) ||
      value.operation !== scope.operation || !Number.isSafeInteger(value.expiresAt) ||
      Number(value.expiresAt) <= Date.now() || Number(value.expiresAt) > Date.now() + 31_000) return fail("CAPABILITY_INVALID");
  return value.capability;
}
async function mutate(operation: "launch" | "reset" | "stop", build: BrowserBuild, body: unknown, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  try { return statusValue(await request(`/v1/${operation}`, true, body, signal), build); }
  catch (error) {
    // A dropped response is not permission to create a second runtime or replay a token.
    if (error instanceof RunnerBrowserError && error.code === "RUNNER_OFFLINE") return getRunnerStatus(build, signal);
    throw error;
  }
}
export async function launchLab(savedLabId: string, build: BrowserBuild, idempotencyKey: string, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  const current = await detectRunner(build, signal);
  if (["ready", "starting", "resetting", "stopping"].includes(current.state)) return current;
  const data = await request(`${savedPath(savedLabId)}/package`, false, { idempotencyKey }, signal);
  if (!isPlainObject(data) || !hasExactKeys(data, ["package"])) return fail("PACKAGE_INVALID");
  const pkg = safePackage(data.package, build);
  const token = await capability({ operation: "launch", buildId: build.buildId, buildFingerprint: build.buildFingerprint, idempotencyKey }, signal);
  return mutate("launch", build, { capability: token, package: pkg }, signal);
}
async function lifecycle(operation: "reset" | "stop", build: BrowserBuild, status: RunnerPublicStatus, idempotencyKey: string, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  const verified = statusValue(status, build);
  if (verified.buildId !== build.buildId || verified.buildFingerprint !== build.buildFingerprint ||
      !verified.sessionId || !verified.generation || (operation === "reset" && verified.state !== "ready")) return fail("LOCAL_RUNTIME_NOT_FOUND");
  const token = await capability({ operation, sessionId: verified.sessionId, buildFingerprint: build.buildFingerprint, generation: verified.generation, idempotencyKey }, signal);
  return mutate(operation, build, { capability: token }, signal);
}
export function resetLab(build: BrowserBuild, status: RunnerPublicStatus, idempotencyKey: string, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  return lifecycle("reset", build, status, idempotencyKey, signal);
}
export function stopLab(build: BrowserBuild, status: RunnerPublicStatus, idempotencyKey: string, signal?: AbortSignal): Promise<RunnerPublicStatus> {
  return lifecycle("stop", build, status, idempotencyKey, signal);
}

export function runnerMessage(code: string): string {
  const messages: Record<string, string> = {
    RUNNER_OFFLINE: "Amniora Runner isn't available. Start Amniora Runner, make sure Docker Desktop is running, then check again. Runner download coming soon.",
    DOCKER_UNAVAILABLE: "Docker Desktop is required. Install and start Docker Desktop, then check again.",
    DOCKER_DAEMON_UNAVAILABLE: "Docker Desktop isn't running. Start it, then check again.",
    UNSUPPORTED_PLATFORM: "Runner execution isn't supported on this computer yet. Windows runtime validation and Runner distribution are coming soon.",
    RUNNER_VERSION_UNSUPPORTED: "Runner update required. This version isn't supported.",
    PROTOCOL_VERSION_UNSUPPORTED: "Runner update required. This version isn't compatible with Amniora.",
    RUNTIME_VERSION_UNSUPPORTED: "Runner update required to run this lab.",
    RUNNER_INCOMPATIBLE: "Runner update required. The Runner response wasn't compatible.",
    LOCAL_RUNTIME_ALREADY_ACTIVE: "Another lab is already running. Open its Saved Lab to manage it, then check again here.",
    LOCAL_RUNTIME_EXPIRED: "This local session has expired. Check again to start a new session.",
    LOCAL_RUNTIME_NOT_FOUND: "The local session is no longer running. Check again.",
    LOCAL_RUNNER_UNAVAILABLE: "Local launch is temporarily unavailable. Check again later.",
    UNAUTHENTICATED: "Sign in again to run this saved lab.",
    ORIGIN_DENIED: "Runner hasn't approved this Amniora site address. Check its local setup.",
    INVALID_ENDPOINT: "The Runner returned an unsafe lab address. The address was blocked.",
    LOCAL_RUNTIME_INCONSISTENT: "Runner couldn't confirm the local session. Check its status before trying again.",
    CAPABILITY_REPLAYED: "That operation was already used. Refresh the local session status.",
    CAPABILITY_EXPIRED: "The operation expired. Refresh the local session status before trying again.",
    LOCAL_RUNTIME_START_FAILED: "The local lab couldn't start. Check Runner and Docker Desktop, then check again.",
  };
  return messages[code] ?? "The local operation couldn't be completed safely. Check the Runner status before trying again.";
}
