import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DesktopGuestTrustStore } from "../local-first-guest/identity";
import {
  GuestChannelError,
  validGuestRuntimeStatus,
  validGuestStatus,
  type GuestRuntimeStatus,
  type GuestStatus,
} from "../local-first-guest/protocol";
import { RunnerGuestClient } from "../local-first-guest/transport";
import { WindowsDpapiSigningIdentity } from "../local-first-guest/windows-signer";
import { runDesktopLabViewer } from "../local-first-viewer/desktop-process";
import { verifyLocalRunnerPackage } from "../local-runner/package";
import {
  LOCAL_FIRST_PRODUCT_OPERATIONS,
  type AuthoritativeRunnerResult,
  type ProductFailureCode,
  type ProductOperation,
} from "./contract";

const VERSION = "0.7.0-windows-w2";

function paths() {
  const root = process.env.AMNIORA_WINDOWS_STATE_ROOT ??
    path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"), "Amniora/Runner");
  return {
    trust: path.join(root, "phase2-guest-trust.json"),
    helper: process.env.AMNIORA_WINDOWS_IDENTITY_HELPER ??
      path.resolve(__dirname, "../../bin/Amniora.Runner.IdentityHelper.exe"),
  };
}

function object(value: unknown, code = "RUNNER_COMMAND_INVALID"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function command(value: unknown): Record<string, unknown> & { operation: ProductOperation } {
  const input = object(value);
  if (typeof input.operation !== "string" || !LOCAL_FIRST_PRODUCT_OPERATIONS.includes(input.operation as ProductOperation)) {
    throw new Error("RUNNER_COMMAND_INVALID");
  }
  return input as Record<string, unknown> & { operation: ProductOperation };
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
  const manifest = object(object(packageValue, "PACKAGE_INCOMPATIBLE").manifest, "PACKAGE_INCOMPATIBLE");
  return manifest.templateId === "helpdesk" ? "Northline Desk" : "Amniora Web Lab";
}
function launchPackage(input: Record<string, unknown>, architecture: "arm64" | "amd64"):
  { packageValue: unknown; verification: Record<string, unknown> } {
  const candidates = input.packages;
  if (!Array.isArray(candidates)) {
    // Retain compatibility with reviewed single-architecture rehearsal fixtures.
    if (!("package" in input) || !("packageVerificationKey" in input)) throw new Error("PACKAGE_INCOMPATIBLE");
    return { packageValue: input.package, verification: object(input.packageVerificationKey, "PACKAGE_INCOMPATIBLE") };
  }
  const matching = candidates.filter(value => object(value, "PACKAGE_INCOMPATIBLE").architecture === architecture);
  if (matching.length !== 1) throw new Error("PACKAGE_INCOMPATIBLE");
  const selected = object(matching[0], "PACKAGE_INCOMPATIBLE");
  return { packageValue: selected.package,
    verification: object(selected.packageVerificationKey, "PACKAGE_INCOMPATIBLE") };
}

function result(guest: GuestStatus, runtime: GuestRuntimeStatus, name: string,
  ok = true, code: ProductFailureCode | null = null): AuthoritativeRunnerResult {
  return {
    ok,
    code,
    runner: { version: VERSION, platform: "Windows" },
    virtualMachine: {
      name: "Amniora-Windows-Test",
      operatingSystem: "Ubuntu 24.04",
      architecture: guest.guest.architecture,
      state: "ready",
    },
    guestAgent: { state: "ready" },
    docker: { version: guest.docker.version, state: guest.docker.serviceState },
    runtime: runtime.runtimeId && runtime.buildId && runtime.generation ? {
      buildId: runtime.buildId,
      runtimeId: runtime.runtimeId,
      generation: runtime.generation,
      labName: name,
      state: runtimeState(runtime),
    } : null,
  };
}

function unavailable(code: "VM_POWERED_OFF" | "GUEST_AGENT_UNAVAILABLE"): AuthoritativeRunnerResult {
  return {
    ok: false,
    code,
    runner: { version: VERSION, platform: "Windows" },
    virtualMachine: code === "VM_POWERED_OFF" ? null : {
      name: "Amniora-Windows-Test", operatingSystem: "Ubuntu 24.04", architecture: "amd64", state: "unavailable",
    },
    guestAgent: null,
    docker: null,
    runtime: null,
  };
}

function connectionFailure(error: unknown): "VM_POWERED_OFF" | "GUEST_AGENT_UNAVAILABLE" {
  const systemCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
  if (systemCode === "EADDRNOTAVAIL" || error instanceof GuestChannelError &&
      ["TIMEOUT", "TRANSPORT_DENIED"].includes(error.code)) return "VM_POWERED_OFF";
  return "GUEST_AGENT_UNAVAILABLE";
}

function operationFailure(error: unknown, operation: ProductOperation): ProductFailureCode {
  const code = error instanceof Error ? error.message : "";
  if (code === "PACKAGE_INCOMPATIBLE") return "PACKAGE_INCOMPATIBLE";
  if (code === "ANOTHER_LAB_ACTIVE" || code === "RUNTIME_ALREADY_ACTIVE") return "ANOTHER_LAB_ACTIVE";
  if (operation === "RESET") return "LAB_RESET_FAILED";
  if (operation === "STOP") return "LAB_STOPPED";
  if (operation === "LAUNCH" || operation === "OPEN_LAB") return "LAB_LAUNCH_FAILED";
  return "GUEST_AGENT_UNAVAILABLE";
}

async function guestConnectionOnce(): Promise<{ client: RunnerGuestClient; status: GuestStatus; runtime: GuestRuntimeStatus }> {
  const configured = paths();
  const identity = await new WindowsDpapiSigningIdentity(configured.helper).load();
  const trust = await new DesktopGuestTrustStore(configured.trust).load();
  const client = new RunnerGuestClient(identity, trust);
  await client.connect();
  try {
    const statusResponse = await client.request("STATUS");
    const runtimeResponse = await client.request("RUNTIME_STATUS");
    if (!statusResponse.ok || !validGuestStatus(statusResponse.result) ||
        !runtimeResponse.ok || !validGuestRuntimeStatus(runtimeResponse.result)) throw new Error("GUEST_AGENT_UNAVAILABLE");
    return { client, status: statusResponse.result, runtime: runtimeResponse.result };
  } catch (error) {
    client.close();
    throw error;
  }
}

async function guestConnection(): Promise<{ client: RunnerGuestClient; status: GuestStatus; runtime: GuestRuntimeStatus }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await guestConnectionOnce(); }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

function requireContext(value: Record<string, unknown>, current: GuestRuntimeStatus, allowFailed = false): void {
  if (typeof value.runtimeId !== "string" || typeof value.buildId !== "string" || !Number.isSafeInteger(value.generation) ||
      current.runtimeId !== value.runtimeId || current.buildId !== value.buildId || current.generation !== value.generation ||
      (current.state !== "ready" && !(allowFailed && current.state === "failed"))) throw new Error("RUNTIME_NOT_READY");
}

async function spawnIndependentViewer(): Promise<void> {
  const entry = process.argv[1];
  if (!entry || !path.isAbsolute(entry)) throw new Error("VIEWER_PROCESS_FAILED");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, "viewer"], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        WINDIR: process.env.WINDIR ?? "C:\\Windows",
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData/Local"),
        ...(process.env.AMNIORA_WINDOWS_STATE_ROOT ?
          { AMNIORA_WINDOWS_STATE_ROOT: process.env.AMNIORA_WINDOWS_STATE_ROOT } : {}),
        TEMP: process.env.TEMP ?? path.join(os.homedir(), "AppData/Local/Temp"),
        TMP: process.env.TMP ?? path.join(os.homedir(), "AppData/Local/Temp"),
        NODE_ENV: "production",
      },
    });
    let settled = false;
    let output = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.destroy();
      if (error) reject(error);
      else { child.unref(); resolve(); }
    };
    const timeout = setTimeout(() => { child.kill(); finish(new Error("VIEWER_PROCESS_FAILED")); }, 15_000);
    child.once("error", () => finish(new Error("VIEWER_PROCESS_FAILED")));
    child.once("exit", () => finish(new Error("VIEWER_PROCESS_FAILED")));
    child.stdout?.on("data", chunk => {
      output += String(chunk);
      if (output.length > 64) finish(new Error("VIEWER_PROCESS_FAILED"));
      else if (output.includes("\n")) finish(output === "VIEWER_READY\n" ? undefined : new Error("VIEWER_PROCESS_FAILED"));
    });
  });
}

export async function executeWindowsProductCommand(value: unknown): Promise<AuthoritativeRunnerResult> {
  if (process.platform !== "win32") throw new Error("RUNNER_PLATFORM_UNSUPPORTED");
  const input = command(value);
  let connection: Awaited<ReturnType<typeof guestConnection>>;
  try { connection = await guestConnection(); }
  catch (error) { return unavailable(connectionFailure(error)); }
  let current = connection.runtime;
  let name = "Northline Desk";
  try {
    if (input.operation === "LAUNCH") {
      if (current.state !== "idle") throw new Error("ANOTHER_LAB_ACTIVE");
      if (typeof input.buildId !== "string") throw new Error("PACKAGE_INCOMPATIBLE");
      const selected = launchPackage(input, connection.status.guest.architecture);
      const verification = selected.verification;
      if (typeof verification.keyId !== "string" || typeof verification.publicKey !== "string") throw new Error("PACKAGE_INCOMPATIBLE");
      const verified = verifyLocalRunnerPackage(selected.packageValue, new Map([[verification.keyId, verification.publicKey]]),
        { expectedBuildId: input.buildId });
      name = labName(verified);
      const response = await connection.client.request("LAUNCH", { package: verified,
        idempotencyKey: `launch_${String(input.requestId ?? "windows").replace(/^req_/, "")}` });
      if (!response.ok || !validGuestRuntimeStatus(response.result)) throw new Error(response.errorCode ?? "LAB_LAUNCH_FAILED");
      current = response.result;
    } else if (input.operation === "OPEN_LAB") {
      requireContext(input, current);
      await spawnIndependentViewer();
    } else if (input.operation === "RESET" || input.operation === "STOP") {
      requireContext(input, current, input.operation === "STOP");
      if (!current.buildFingerprint) throw new Error("RUNTIME_NOT_READY");
      const response = await connection.client.request(input.operation, {
        runtimeId: current.runtimeId,
        buildFingerprint: current.buildFingerprint,
        generation: current.generation,
        idempotencyKey: `${input.operation.toLowerCase()}_${String(input.requestId ?? "windows").replace(/^req_/, "")}`,
      });
      if (!response.ok || !validGuestRuntimeStatus(response.result)) {
        throw new Error(response.errorCode ?? (input.operation === "RESET" ? "LAB_RESET_FAILED" : "LAB_STOPPED"));
      }
      current = response.result;
    }
    const dockerReady = connection.status.docker.serviceState === "ready";
    return result(connection.status, current, name, dockerReady, dockerReady ? null : "DOCKER_UNAVAILABLE");
  } catch (error) {
    return result(connection.status, current, name, false, operationFailure(error, input.operation));
  } finally {
    connection.client.close();
  }
}

async function readStdin(maximum = 768 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maximum) throw new Error("RUNNER_COMMAND_INVALID");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function runWindowsProductBridge(arguments_: readonly string[] = process.argv.slice(2)): Promise<void> {
  const action = arguments_[0];
  if (process.platform !== "win32" || arguments_.length !== 1 || !["execute", "viewer"].includes(action ?? "")) {
    throw new Error("WINDOWS_PRODUCT_BRIDGE_USAGE_INVALID");
  }
  if (action === "viewer") {
    const connection = await guestConnection();
    try { await runDesktopLabViewer(connection.client, () => process.stdout.write("VIEWER_READY\n")); }
    finally { connection.client.close(); }
    return;
  }
  process.stdout.write(`${JSON.stringify(await executeWindowsProductCommand(await readStdin()))}\n`);
}
