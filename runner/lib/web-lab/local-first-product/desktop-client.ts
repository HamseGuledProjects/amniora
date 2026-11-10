import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DesktopGuestTrustStore } from "../local-first-guest/identity";
import { MacKeychainSigningIdentity } from "../local-first-guest/keychain-signer";
import { GuestChannelError, validGuestRuntimeStatus, validGuestStatus, type GuestRuntimeStatus, type GuestStatus } from "../local-first-guest/protocol";
import { RunnerGuestClient } from "../local-first-guest/transport";
import { runMacLabViewer } from "../local-first-viewer/desktop-process";
import { verifyLocalRunnerPackage } from "../local-runner/package";
import {
  LOCAL_FIRST_PRODUCT_AUDIENCE, LOCAL_FIRST_PRODUCT_OPERATIONS, LOCAL_FIRST_PRODUCT_PROTOCOL,
  type AuthoritativeRunnerResult, type ProductFailureCode, type ProductOperation,
} from "./contract";
import { pairingProofBytes, presenceProofBytes, redeemProofBytes, resultProofBytes, unpairProofBytes, validContextId, validOpaque } from "./protocol";

const execFileAsync = promisify(execFile);
const VERSION = "0.5.0";
const CALLBACK = "com.amniora.runner:/pair";
const DEVICE_NAME = "MacBook Air";
type PendingPairing = { requestId: string; state: string; verifier: string; expiresAt: number; origin: string };

function paths(originText?: string) {
  const sharedRoot = path.join(os.homedir(), "Library/Application Support/Amniora Runner");
  const origin = originText ? validOrigin(originText) : null;
  const localTest = origin?.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
  const productRoot = localTest ? path.join(os.homedir(), "Library/Application Support/Amniora Runner Local Test") : sharedRoot;
  return { pending: path.join(productRoot, "product-pairing.json"),
    connected: path.join(productRoot, "product-connection.json"),
    trust: path.join(sharedRoot, "phase2-guest-trust.json"), helper: path.resolve(__dirname, "../../bin/amniora-keychain-signer") };
}
function randomValue(): string { return randomBytes(32).toString("base64url"); }
function validOrigin(value: string): URL {
  const url = new URL(value);
  if (url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))) {
    throw new Error("RUNNER_CONFIGURATION_INVALID");
  }
  return url;
}
async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600); await rename(temporary, file);
}
async function readJson(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")); }

class ProductHttpClient {
  constructor(private readonly origin: URL) {}
  async post(pathname: string, body: unknown): Promise<unknown> {
    const target = new URL(pathname, this.origin);
    if (target.origin !== this.origin.origin) throw new Error("RUNNER_CONFIGURATION_INVALID");
    const response = await fetch(target, { method: "POST", redirect: "error", signal: AbortSignal.timeout(65_000),
      headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || !("data" in value) || !("error" in value)) throw new Error("RUNNER_SERVER_INVALID");
    const envelope = value as { data: unknown; error: null | { code?: unknown } };
    if (!response.ok || envelope.error) throw new Error(typeof envelope.error?.code === "string" ? envelope.error.code : "RUNNER_SERVER_UNAVAILABLE");
    return envelope.data;
  }
}

function parsePairCallback(value: string): { requestId: string; code: string; state: string } {
  const url = new URL(value);
  const keys = [...url.searchParams.keys()].sort();
  const requestId = url.searchParams.get("request") ?? ""; const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (url.protocol !== "com.amniora.runner:" || url.hostname || url.pathname !== "/pair" || url.hash ||
      keys.join(",") !== "code,request,state" || !/^par_[A-Za-z0-9_-]{43}$/.test(requestId) ||
      !validOpaque(code) || !validOpaque(state)) throw new Error("PAIRING_INVALID");
  return { requestId, code, state };
}
function parseActivation(value: string): string {
  if (Buffer.byteLength(value, "utf8") > 256) throw new Error("TICKET_INVALID");
  const url = new URL(value); const ticket = url.searchParams.get("ticket") ?? "";
  if (url.protocol !== "com.amniora.runner:" || url.hostname || url.pathname !== "/activate" || url.hash ||
      [...url.searchParams.keys()].join(",") !== "ticket" || !validOpaque(ticket)) throw new Error("TICKET_INVALID");
  return ticket;
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RUNNER_SERVER_INVALID");
  return value as Record<string, unknown>;
}
function requireCommand(value: unknown): Record<string, unknown> {
  const command = requireObject(value);
  if (command.protocolVersion !== LOCAL_FIRST_PRODUCT_PROTOCOL || command.audience !== LOCAL_FIRST_PRODUCT_AUDIENCE ||
      typeof command.requestId !== "string" || !/^req_[A-Za-z0-9_-]{43}$/.test(command.requestId) ||
      typeof command.commandId !== "string" || !/^cmd_[A-Za-z0-9_-]{43}$/.test(command.commandId) ||
      typeof command.installationId !== "string" || !/^ins_[A-Za-z0-9_-]{43}$/.test(command.installationId) ||
      typeof command.operation !== "string" || !LOCAL_FIRST_PRODUCT_OPERATIONS.includes(command.operation as ProductOperation) ||
      typeof command.nonce !== "string" || !validOpaque(command.nonce) || !Number.isSafeInteger(command.issuedAt) ||
      !Number.isSafeInteger(command.expiresAt) || Number(command.expiresAt) <= Date.now()) throw new Error("RUNNER_SERVER_INVALID");
  if ((command.buildId !== null && !validContextId(command.buildId)) ||
      (command.runtimeId !== null && !validContextId(command.runtimeId)) ||
      (command.generation !== null && (!Number.isSafeInteger(command.generation) || Number(command.generation) < 1))) {
    throw new Error("RUNNER_SERVER_INVALID");
  }
  return command;
}

function runtimeState(status: GuestRuntimeStatus): "stopped" | "starting" | "running" | "resetting" | "stopping" | "failed" {
  if (status.state === "ready") return status.ready && status.ingressReady ? "running" : "failed";
  if (status.state === "starting") return "starting";
  if (status.state === "resetting") return "resetting";
  if (status.state === "stopping") return "stopping";
  if (status.state === "failed") return "failed";
  return "stopped";
}
function labName(packageValue: unknown): string {
  const manifest = requireObject(requireObject(packageValue).manifest);
  return manifest.templateId === "helpdesk" ? "Northline Desk" : "Amniora Web Lab";
}
function launchPackage(command: Record<string, unknown>, architecture: "arm64" | "amd64"):
  { packageValue: unknown; verification: Record<string, unknown> } {
  const candidates = command.packages;
  if (!Array.isArray(candidates)) {
    // Retain compatibility with reviewed single-architecture rehearsal fixtures.
    if (!("package" in command) || !("packageVerificationKey" in command)) throw new Error("PACKAGE_INCOMPATIBLE");
    return { packageValue: command.package, verification: requireObject(command.packageVerificationKey) };
  }
  const matching = candidates.filter(value => {
    const candidate = requireObject(value);
    return candidate.architecture === architecture;
  });
  if (matching.length !== 1) throw new Error("PACKAGE_INCOMPATIBLE");
  const selected = requireObject(matching[0]);
  return { packageValue: selected.package, verification: requireObject(selected.packageVerificationKey) };
}
function result(guest: GuestStatus, runtime: GuestRuntimeStatus, name: string,
  ok = true, code: ProductFailureCode | null = null): AuthoritativeRunnerResult {
  return { ok, code, runner: { version: VERSION, platform: "macOS" },
    virtualMachine: { name: "Amniora-BYO-Test", operatingSystem: "Ubuntu 24.04", architecture: guest.guest.architecture,
      state: "ready" }, guestAgent: { state: "ready" },
    docker: { version: guest.docker.version, state: guest.docker.serviceState },
    runtime: runtime.runtimeId && runtime.buildId && runtime.generation ? { buildId: runtime.buildId,
      runtimeId: runtime.runtimeId, generation: runtime.generation, labName: name, state: runtimeState(runtime) } : null };
}
function unavailableResult(code: ProductFailureCode): AuthoritativeRunnerResult {
  return { ok: false, code, runner: { version: VERSION, platform: "macOS" }, virtualMachine: null,
    guestAgent: null, docker: null, runtime: null };
}
function operationFailure(error: unknown, operation: ProductOperation): ProductFailureCode {
  const code = error instanceof Error ? error.message : "";
  if (code === "PACKAGE_INCOMPATIBLE") return "PACKAGE_INCOMPATIBLE";
  if (code === "ANOTHER_LAB_ACTIVE") return "ANOTHER_LAB_ACTIVE";
  if (operation === "LAUNCH") return "LAB_LAUNCH_FAILED";
  if (operation === "RESET") return "LAB_RESET_FAILED";
  if (operation === "STOP") return "LAB_STOPPED";
  return "GUEST_AGENT_UNAVAILABLE";
}

function networkErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export function guestConnectionFailure(error: unknown): Readonly<{
  code: "VM_POWERED_OFF" | "GUEST_AGENT_UNAVAILABLE";
  vm: "Reachable" | "Unavailable";
}> {
  const code = networkErrorCode(error);
  if (code === "EADDRNOTAVAIL" || error instanceof GuestChannelError &&
      ["TIMEOUT", "TRANSPORT_DENIED"].includes(error.code)) {
    return { code: "VM_POWERED_OFF", vm: "Unavailable" };
  }
  return { code: "GUEST_AGENT_UNAVAILABLE",
    vm: code === "ECONNREFUSED" || error instanceof GuestChannelError ? "Reachable" : "Unavailable" };
}

async function guestConnection(): Promise<{ client: RunnerGuestClient; status: GuestStatus; runtime: GuestRuntimeStatus }> {
  const configured = paths();
  const identity = await new MacKeychainSigningIdentity(configured.helper).load();
  const trust = await new DesktopGuestTrustStore(configured.trust).load();
  const client = new RunnerGuestClient(identity, trust);
  await client.connect();
  const statusResponse = await client.request("STATUS");
  const runtimeResponse = await client.request("RUNTIME_STATUS");
  if (!statusResponse.ok || !validGuestStatus(statusResponse.result) || !runtimeResponse.ok || !validGuestRuntimeStatus(runtimeResponse.result)) {
    client.close(); throw new Error("GUEST_AGENT_UNAVAILABLE");
  }
  return { client, status: statusResponse.result, runtime: runtimeResponse.result };
}

export async function beginDesktopPairing(originText: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("RUNNER_PLATFORM_UNSUPPORTED");
  const configured = paths(originText); const origin = validOrigin(originText); const http = new ProductHttpClient(origin);
  const identity = await new MacKeychainSigningIdentity(configured.helper).load();
  const verifier = randomValue(); const state = randomValue();
  const { createHash } = await import("node:crypto");
  const codeChallenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const started = requireObject(await http.post("/api/web-labs/local-first/runner/pairing-begin", {
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL, audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    installationId: identity.id, publicKey: identity.publicKey, deviceName: DEVICE_NAME,
    codeChallenge, state, redirectUri: CALLBACK,
  }));
  if (typeof started.authorizationRequestId !== "string" || typeof started.approvalUrl !== "string" ||
      !Number.isSafeInteger(started.expiresAt)) throw new Error("RUNNER_SERVER_INVALID");
  const expiresAt = Number(started.expiresAt);
  const approval = new URL(started.approvalUrl);
  if (approval.origin !== origin.origin) throw new Error("RUNNER_SERVER_INVALID");
  await atomicJson(configured.pending, { requestId: started.authorizationRequestId, state, verifier,
    expiresAt, origin: origin.origin } satisfies PendingPairing);
  await execFileAsync("/usr/bin/open", [approval.href], { timeout: 5_000,
    env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" } });
}

export async function completeDesktopPairing(originText: string, callbackValue: string): Promise<void> {
  const configured = paths(originText); const callback = parsePairCallback(callbackValue);
  const pending = requireObject(await readJson(configured.pending)) as PendingPairing;
  if (pending.requestId !== callback.requestId || pending.state !== callback.state || Date.now() >= pending.expiresAt) {
    throw new Error("PAIRING_INVALID");
  }
  if (pending.origin !== validOrigin(originText).origin) throw new Error("PAIRING_INVALID");
  const identity = await new MacKeychainSigningIdentity(configured.helper).load();
  const http = new ProductHttpClient(validOrigin(pending.origin));
  const proof = await identity.sign(pairingProofBytes({ authorizationRequestId: callback.requestId,
    authorizationCode: callback.code, installationId: identity.id, state: callback.state }));
  const completed = requireObject(await http.post("/api/web-labs/local-first/runner/pairing-complete", {
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL, audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    authorizationRequestId: callback.requestId, authorizationCode: callback.code, installationId: identity.id,
    codeVerifier: pending.verifier, state: callback.state, redirectUri: CALLBACK, proof,
  }));
  if (completed.installationId !== identity.id) throw new Error("RUNNER_SERVER_INVALID");
  await atomicJson(configured.connected, { installationId: identity.id, origin: pending.origin, connectedAt: Date.now() });
  await rm(configured.pending, { force: true });
}

export async function handleDesktopActivation(originText: string, activationValue: string): Promise<void> {
  const origin = validOrigin(originText); const ticket = parseActivation(activationValue); const http = new ProductHttpClient(origin);
  const identity = await new MacKeychainSigningIdentity(paths().helper).load(); const signedAt = Date.now(); const clientNonce = randomValue();
  const proof = await identity.sign(redeemProofBytes({ ticket, installationId: identity.id, clientNonce, signedAt }));
  const command = requireCommand(await http.post("/api/web-labs/local-first/runner/redeem", {
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL, audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    ticket, installationId: identity.id, clientNonce, signedAt, proof,
  }));
  if (command.installationId !== identity.id) throw new Error("RUNNER_MISMATCH");
  const operation = command.operation as ProductOperation;
  async function submit(authoritative: AuthoritativeRunnerResult): Promise<void> {
    const completedAt = Date.now();
    const resultProof = await identity.sign(resultProofBytes({ requestId: String(command.requestId), commandId: String(command.commandId),
      installationId: identity.id, operation, nonce: String(command.nonce), completedAt, result: authoritative }));
    await http.post("/api/web-labs/local-first/runner/result", { protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL,
      audience: LOCAL_FIRST_PRODUCT_AUDIENCE, requestId: command.requestId, commandId: command.commandId,
      installationId: identity.id, operation, nonce: command.nonce, completedAt, result: authoritative, proof: resultProof });
  }
  let connection: Awaited<ReturnType<typeof guestConnection>>;
  try { connection = await guestConnection(); }
  catch (error) {
    await submit(unavailableResult(guestConnectionFailure(error).code)); throw error;
  }
  let current = connection.runtime; let name = "Northline Desk";
  try {
    if (operation === "LAUNCH") {
      // Enforce the installation's one-runtime slot before asking the guest to create anything.
      // Failed/expired states remain occupied until the guest reports an idle, empty slot.
      // A successful Stop leaves the prior runtime ID in the guest's idle status for idempotent Stop replay.
      // Occupancy is determined by lifecycle state; the guest/helper still reject any surviving resources.
      if (current.state !== "idle") throw new Error("ANOTHER_LAB_ACTIVE");
      const selected = launchPackage(command, connection.status.guest.architecture);
      const verification = selected.verification;
      if (typeof verification.keyId !== "string" || typeof verification.publicKey !== "string") throw new Error("PACKAGE_INCOMPATIBLE");
      const verifiedPackage = verifyLocalRunnerPackage(selected.packageValue, new Map([[verification.keyId, verification.publicKey]]),
        { expectedBuildId: String(command.buildId) });
      name = labName(verifiedPackage);
      const response = await connection.client.request("LAUNCH", { package: verifiedPackage,
        idempotencyKey: `launch_${String(command.requestId).slice(4)}` });
      if (!response.ok) throw new Error(response.errorCode ?? "LAB_LAUNCH_FAILED");
      if (!validGuestRuntimeStatus(response.result)) throw new Error("LAB_LAUNCH_FAILED");
      current = response.result;
    } else if (["OPEN_LAB", "RESET", "STOP"].includes(operation)) {
      if (current.runtimeId !== command.runtimeId || current.buildId !== command.buildId || current.generation !== command.generation ||
          current.state !== "ready") throw new Error("RUNTIME_NOT_READY");
      if (operation === "RESET" || operation === "STOP") {
        if (!current.buildFingerprint) throw new Error("RUNTIME_NOT_READY");
        const response = await connection.client.request(operation, { runtimeId: current.runtimeId,
          buildFingerprint: current.buildFingerprint, generation: current.generation,
          idempotencyKey: `${operation.toLowerCase()}_${String(command.requestId).slice(4)}` });
        if (!response.ok) throw new Error(response.errorCode ?? (operation === "RESET" ? "LAB_RESET_FAILED" : "LAB_STOPPED"));
        if (!validGuestRuntimeStatus(response.result)) throw new Error(operation === "RESET" ? "LAB_RESET_FAILED" : "LAB_STOPPED");
        current = response.result;
      }
    }
    const dockerReady = connection.status.docker.serviceState === "ready";
    if (operation === "OPEN_LAB") await spawnIndependentViewer(origin.origin);
    await submit(result(connection.status, current, name, dockerReady, dockerReady ? null : "DOCKER_UNAVAILABLE"));
  } catch (error) {
    await submit(result(connection.status, current, name, false, operationFailure(error, operation))).catch(() => undefined);
    throw error;
  } finally { connection.client.close(); }
}

/** The viewer owns a separate guest connection, so keeping it open cannot block Stop/Reset or heartbeats. */
async function spawnIndependentViewer(origin: string): Promise<void> {
  const entry = process.argv[1];
  if (process.platform !== "darwin" || !entry || !path.isAbsolute(entry)) throw new Error("VIEWER_PROCESS_FAILED");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "viewer", origin], { detached: true, stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "production", LANG: "en_US.UTF-8" } });
    let complete = false;
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGTERM"); finish(new Error("VIEWER_PROCESS_FAILED")); }, 15_000);
    const finish = (error?: Error) => {
      if (complete) return;
      complete = true; clearTimeout(timeout);
      child.stdout?.destroy();
      if (error) reject(error); else { child.unref(); resolve(); }
    };
    child.once("error", () => finish(new Error("VIEWER_PROCESS_FAILED")));
    child.once("exit", () => finish(new Error("VIEWER_PROCESS_FAILED")));
    child.stdout?.on("data", chunk => {
      output += String(chunk);
      if (output.length > 64) finish(new Error("VIEWER_PROCESS_FAILED"));
      else if (output.includes("\n")) finish(output === "VIEWER_READY\n" ? undefined : new Error("VIEWER_PROCESS_FAILED"));
    });
  });
}

export async function sendDesktopPresence(originText: string): Promise<void> {
  const origin = validOrigin(originText);
  const connected = requireObject(await readJson(paths(originText).connected));
  const identity = await new MacKeychainSigningIdentity(paths().helper).load();
  if (connected.origin !== origin.origin || connected.installationId !== identity.id) throw new Error("PAIRING_REVOKED");
  const clientNonce = randomValue(); const signedAt = Date.now();
  const proof = await identity.sign(presenceProofBytes({ installationId: identity.id, clientNonce, signedAt }));
  await new ProductHttpClient(origin).post("/api/web-labs/local-first/runner/presence", {
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL, audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    installationId: identity.id, clientNonce, signedAt, proof,
  });
}

export async function desktopRunnerSummary(originText: string): Promise<Record<string, unknown>> {
  let connected = false;
  try { const state = requireObject(await readJson(paths(originText).connected)); connected = typeof state.installationId === "string" && state.origin === validOrigin(originText).origin; }
  catch { /* Unpaired is a normal state. */ }
  if (!connected) return { connected: false, vm: "Unknown", guest: "Unknown", docker: "Unknown", lab: "Stopped" };
  try {
    const value = await guestConnection();
    try { return { connected: true, vm: `${value.status.guest.os} ${value.status.guest.osVersion} ${value.status.guest.architecture}`,
      guest: "Ready", docker: value.status.docker.serviceState === "ready" ? `${value.status.docker.version ?? "Installed"} · Ready` : "Unavailable",
      lab: value.runtime.state === "ready" ? `Running · Generation ${value.runtime.generation}` :
        value.runtime.state === "idle" ? "Stopped" : value.runtime.state }; }
    finally { value.client.close(); }
  } catch (error) { return { connected: true, vm: guestConnectionFailure(error).vm,
    guest: "Unavailable", docker: "Unavailable", lab: "Stopped" }; }
}

export async function openCurrentLab(onReady?: () => void): Promise<void> {
  const value = await guestConnection();
  try {
    if (value.runtime.state !== "ready" || !value.runtime.runtimeId || !value.runtime.generation) throw new Error("RUNTIME_NOT_READY");
    await runMacLabViewer(value.client, onReady);
  } finally { value.client.close(); }
}

export async function unpairDesktopRunner(originText: string): Promise<void> {
  const identity = await new MacKeychainSigningIdentity(paths().helper).load();
  const clientNonce = randomValue(); const signedAt = Date.now();
  const proof = await identity.sign(unpairProofBytes({ installationId: identity.id, clientNonce, signedAt }));
  await new ProductHttpClient(validOrigin(originText)).post("/api/web-labs/local-first/runner/unpair", {
    protocolVersion: LOCAL_FIRST_PRODUCT_PROTOCOL, audience: LOCAL_FIRST_PRODUCT_AUDIENCE,
    installationId: identity.id, clientNonce, signedAt, proof,
  });
  await rm(paths(originText).connected, { force: true });
}

export async function runDesktopProductCli(arguments_: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [action, origin, value] = arguments_;
  if (!action || !origin || !["pair", "pair-callback", "activate", "summary", "viewer", "presence", "unpair"].includes(action) ||
      (["pair-callback", "activate"].includes(action) ? !value || arguments_.length !== 3 : arguments_.length !== 2)) {
    throw new Error("USAGE: amniora-runner pair|summary <origin> | pair-callback|activate <origin> <uri>");
  }
  if (action === "pair") await beginDesktopPairing(origin);
  else if (action === "pair-callback") await completeDesktopPairing(origin, value!);
  else if (action === "activate") await handleDesktopActivation(origin, value!);
  else if (action === "viewer") await openCurrentLab(() => process.stdout.write("VIEWER_READY\n"));
  else if (action === "presence") await sendDesktopPresence(origin);
  else if (action === "unpair") await unpairDesktopRunner(origin);
  else process.stdout.write(`${JSON.stringify(await desktopRunnerSummary(origin))}\n`);
}
