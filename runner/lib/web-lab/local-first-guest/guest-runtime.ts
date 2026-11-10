import { createHash, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import { canonicalPublicKey, hasExactKeys, isPlainObject } from "../byo-runner/protocol";
import {
  BYO_RELAY_MAX_RESPONSE_BODY_BYTES,
  BYO_RELAY_REQUEST_TIMEOUT_MS,
  type ByoRelayHttpRequest,
  type ByoRelayHttpResponse,
} from "../byo-runner/protocol";
import {
  LOCAL_VIEWER_RELAY_RESPONSE_HEADERS,
  validLocalViewerRelayHttpRequest,
  validLocalViewerRelayHttpResponse,
} from "../local-first-viewer/http-protocol";
import { LocalRunnerCore } from "../local-runner/core";
import type { LocalRunnerPackage, LocalRunnerVerificationKeys } from "../local-runner/package";
import { LocalRunnerError, type RunnerPublicStatus } from "../local-runner/protocol";
import { LocalRunnerStateStore } from "../local-runner/state-store";
import { PrivilegedHelperBackend } from "./helper-backend";
import {
  GUEST_VM_ADDRESS,
  GuestChannelError,
  normalizeLinuxArchitecture,
  type GuestRuntimeStatus,
  type SupportedGuestArchitecture,
} from "./protocol";
import { RuntimeHelperClient } from "./runtime-helper-transport";
import type { GuestRuntimeOperationHandler } from "./session";

export const DEFAULT_GUEST_RUNTIME_STATE_DIRECTORY = "/var/lib/amniora-guest-agent/runtime";
export const DEFAULT_GUEST_SIGNING_KEYS_PATH = "/etc/amniora-runner/lab-signing-keys.json";

function safeRedirectLocation(value: string): boolean {
  return Buffer.byteLength(value) <= 8_192 && value.startsWith("/") && !value.startsWith("//") &&
    !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value);
}

function requestRuntime(endpoint: string, request: ByoRelayHttpRequest): Promise<ByoRelayHttpResponse> {
  if (!validLocalViewerRelayHttpRequest(request)) throw new GuestChannelError("RELAY_REQUEST_INVALID");
  const target = new URL(endpoint);
  const port = Number(target.port);
  if (target.protocol !== "http:" || target.username || target.password || target.pathname !== "/" || target.search ||
      target.hash || ![GUEST_VM_ADDRESS, "127.0.0.1"].includes(target.hostname) ||
      !/^[1-9][0-9]{0,4}$/.test(target.port) || !Number.isSafeInteger(port) || port > 65_535) {
    throw new GuestChannelError("RELAY_UPSTREAM_UNAVAILABLE");
  }
  const body = Buffer.from(request.bodyBase64, "base64");
  return new Promise<ByoRelayHttpResponse>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const fail = (code: GuestChannelError["code"]) => {
      if (settled) return;
      settled = true;
      reject(new GuestChannelError(code));
    };
    const outbound = httpRequest({
      hostname: target.hostname,
      port,
      method: request.method,
      path: request.pathQuery,
      headers: request.headers,
      timeout: BYO_RELAY_REQUEST_TIMEOUT_MS,
      agent: false,
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", chunk => {
        if (settled) return;
        const value = Buffer.from(chunk);
        size += value.length;
        if (size > BYO_RELAY_MAX_RESPONSE_BODY_BYTES) {
          fail("RELAY_RESPONSE_TOO_LARGE");
          response.destroy();
          outbound.destroy();
          return;
        }
        chunks.push(value);
      });
      response.on("end", () => {
        if (settled) return;
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (!LOCAL_VIEWER_RELAY_RESPONSE_HEADERS.has(name)) continue;
          if (name === "set-cookie" && Array.isArray(value)) headers[name] = value.join(", ");
          else if (typeof value === "string") headers[name] = value;
        }
        if (headers.location && !safeRedirectLocation(headers.location)) {
          fail("RELAY_REDIRECT_DENIED");
          return;
        }
        const result: ByoRelayHttpResponse = {
          status: response.statusCode ?? 502,
          headers,
          bodyBase64: Buffer.concat(chunks).toString("base64"),
        };
        if (!validLocalViewerRelayHttpResponse(result)) {
          fail("RELAY_UPSTREAM_UNAVAILABLE");
          return;
        }
        settled = true;
        resolve(result);
      });
      response.on("error", () => fail("RELAY_UPSTREAM_UNAVAILABLE"));
    });
    outbound.on("timeout", () => {
      timedOut = true;
      outbound.destroy();
    });
    outbound.on("error", () => fail(timedOut ? "RELAY_UPSTREAM_TIMEOUT" : "RELAY_UPSTREAM_UNAVAILABLE"));
    outbound.end(body);
  });
}

function guestError(error: unknown): GuestChannelError {
  if (!(error instanceof LocalRunnerError)) return new GuestChannelError("RUNTIME_OPERATION_FAILED");
  if (["PACKAGE_INVALID", "PACKAGE_SIGNATURE_INVALID", "PACKAGE_HASH_MISMATCH", "PACKAGE_VERSION_UNSUPPORTED",
    "PACKAGE_EXPIRED", "BUILD_FINGERPRINT_MISMATCH", "RUNTIME_VERSION_UNSUPPORTED", "PROTOCOL_VERSION_UNSUPPORTED"].includes(error.code)) {
    return new GuestChannelError("PACKAGE_INVALID");
  }
  if (error.code === "PACKAGE_PLATFORM_UNSUPPORTED" || error.code === "UNSUPPORTED_PLATFORM") {
    return new GuestChannelError("PACKAGE_PLATFORM_UNSUPPORTED");
  }
  if (error.code === "LOCAL_RUNTIME_ALREADY_ACTIVE") return new GuestChannelError("RUNTIME_ALREADY_ACTIVE");
  if (error.code === "LOCAL_RUNTIME_NOT_FOUND") return new GuestChannelError("RUNTIME_NOT_FOUND");
  if (error.code === "DOCKER_DAEMON_UNAVAILABLE" || error.code === "DOCKER_UNAVAILABLE") {
    return new GuestChannelError("RUNTIME_HELPER_UNAVAILABLE");
  }
  return new GuestChannelError("RUNTIME_OPERATION_FAILED");
}

function publicStatus(status: RunnerPublicStatus, architecture: SupportedGuestArchitecture): GuestRuntimeStatus {
  return Object.freeze({
    state: status.state,
    runtimeId: status.sessionId,
    buildId: status.buildId,
    buildFingerprint: status.buildFingerprint,
    generation: status.generation,
    ready: status.state === "ready",
    labType: status.sessionId ? "web-security" : null,
    architecture,
    ingressReady: status.state === "ready" && status.endpoint !== null,
    startedAt: status.createdAt,
    errorCode: status.errorCode ?? null,
  });
}

export class GuestLabRuntimeController implements GuestRuntimeOperationHandler {
  constructor(
    private readonly core: LocalRunnerCore,
    private readonly architecture: SupportedGuestArchitecture,
  ) {}

  async initialize(): Promise<GuestRuntimeStatus> {
    try {
      await this.core.reconcileOrphans();
      return publicStatus(await this.core.recover(), this.architecture);
    } catch (error) { throw guestError(error); }
  }

  async launch(input: Readonly<{ package: unknown; idempotencyKey: string }>): Promise<GuestRuntimeStatus> {
    try {
      const candidate = input.package as Partial<LocalRunnerPackage>;
      const capability = this.core.authorize({
        operation: "launch",
        buildId: typeof candidate?.buildId === "string" ? candidate.buildId : "",
        buildFingerprint: typeof candidate?.buildFingerprint === "string" ? candidate.buildFingerprint : "",
        idempotencyKey: input.idempotencyKey,
      });
      return publicStatus(await this.core.launch(capability.capability, input.package), this.architecture);
    } catch (error) { throw guestError(error); }
  }

  async status(): Promise<GuestRuntimeStatus> {
    try { return publicStatus(await this.core.status(), this.architecture); }
    catch (error) { throw guestError(error); }
  }

  async reset(input: Readonly<{ runtimeId: string; buildFingerprint: string; generation: number; idempotencyKey: string }>): Promise<GuestRuntimeStatus> {
    try {
      const capability = this.core.authorize({ operation: "reset", sessionId: input.runtimeId,
        buildFingerprint: input.buildFingerprint, generation: input.generation, idempotencyKey: input.idempotencyKey });
      return publicStatus(await this.core.reset(capability.capability), this.architecture);
    } catch (error) { throw guestError(error); }
  }

  async stop(input: Readonly<{ runtimeId: string; buildFingerprint: string; generation: number; idempotencyKey: string }>): Promise<GuestRuntimeStatus> {
    try {
      const capability = this.core.authorize({ operation: "stop", sessionId: input.runtimeId,
        buildFingerprint: input.buildFingerprint, generation: input.generation, idempotencyKey: input.idempotencyKey });
      return publicStatus(await this.core.stop(capability.capability), this.architecture);
    } catch (error) { throw guestError(error); }
  }

  async diagnosticProbe(input: Readonly<{ runtimeId: string; buildFingerprint: string; generation: number }>): Promise<Readonly<{
    status: 200;
    bodySha256: string;
  }>> {
    try {
      const current = await this.core.status();
      if (current.state !== "ready" || !current.endpoint || current.sessionId !== input.runtimeId ||
          current.buildFingerprint !== input.buildFingerprint || current.generation !== input.generation) {
        throw new GuestChannelError("RUNTIME_NOT_FOUND");
      }
      const response = await fetch(current.endpoint, { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
      const contentLength = response.headers.get("content-length");
      if (response.status !== 200 || (contentLength && Number(contentLength) > 512 * 1024)) {
        throw new GuestChannelError("RUNTIME_OPERATION_FAILED");
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 512 * 1024) throw new GuestChannelError("RUNTIME_OPERATION_FAILED");
      return Object.freeze({ status: 200, bodySha256: createHash("sha256").update(body).digest("hex") });
    } catch (error) {
      if (error instanceof GuestChannelError) throw error;
      throw guestError(error);
    }
  }

  async relayHttp(input: Readonly<{
    runtimeId: string;
    buildFingerprint: string;
    generation: number;
    request: ByoRelayHttpRequest;
  }>): Promise<ByoRelayHttpResponse> {
    const current = await this.core.status();
    if (current.state !== "ready" || !current.endpoint) throw new GuestChannelError("RUNTIME_NOT_FOUND");
    if (current.sessionId !== input.runtimeId || current.buildFingerprint !== input.buildFingerprint ||
        current.generation !== input.generation) throw new GuestChannelError("RELAY_RUNTIME_STALE");
    return requestRuntime(current.endpoint, input.request);
  }
}

export async function loadGuestVerificationKeys(file = DEFAULT_GUEST_SIGNING_KEYS_PATH): Promise<LocalRunnerVerificationKeys> {
  let input: unknown;
  try { input = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new GuestChannelError("RUNTIME_HELPER_UNAVAILABLE"); }
  if (!isPlainObject(input) || !hasExactKeys(input, ["schemaVersion", "keys"]) || input.schemaVersion !== 1 ||
      !Array.isArray(input.keys) || input.keys.length < 1 || input.keys.length > 8) {
    throw new GuestChannelError("RUNTIME_HELPER_UNAVAILABLE");
  }
  const keys = new Map<string, string>();
  for (const candidate of input.keys) {
    if (!isPlainObject(candidate) || !hasExactKeys(candidate, ["keyId", "publicKey"]) ||
        typeof candidate.keyId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(candidate.keyId) ||
        typeof candidate.publicKey !== "string" || keys.has(candidate.keyId)) {
      throw new GuestChannelError("RUNTIME_HELPER_UNAVAILABLE");
    }
    try {
      const key = createPublicKey(candidate.publicKey);
      if (key.asymmetricKeyType !== "ed25519" || canonicalPublicKey(key) !== candidate.publicKey) throw new Error("invalid");
    } catch { throw new GuestChannelError("RUNTIME_HELPER_UNAVAILABLE"); }
    keys.set(candidate.keyId, candidate.publicKey);
  }
  return keys;
}

export async function createGuestLabRuntimeController(input: Readonly<{
  verificationKeys?: LocalRunnerVerificationKeys;
  stateDirectory?: string;
  helperClient?: RuntimeHelperClient;
  architecture?: SupportedGuestArchitecture;
}> = {}): Promise<GuestLabRuntimeController> {
  const architecture = input.architecture ?? normalizeLinuxArchitecture(os.arch());
  const keys = input.verificationKeys ?? await loadGuestVerificationKeys();
  const backend = new PrivilegedHelperBackend(input.helperClient);
  const core = new LocalRunnerCore({
    verificationKeys: keys,
    backend,
    stateStore: new LocalRunnerStateStore(input.stateDirectory ?? DEFAULT_GUEST_RUNTIME_STATE_DIRECTORY),
    platform: "linux",
    architecture,
    supportedPlatforms: [{ platform: "linux", architecture: "arm64" }, { platform: "linux", architecture: "amd64" }],
    runtimeEndpointHosts: [GUEST_VM_ADDRESS, "127.0.0.1"],
    recreateMissingRuntimeOnRecover: false,
  });
  return new GuestLabRuntimeController(core, architecture);
}
