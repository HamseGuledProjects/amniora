import { execFile, spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import {
  validGuestRuntimeStatus,
  type GuestOperation,
  type GuestResponse,
} from "../local-first-guest/protocol";
import type { RunnerGuestClient } from "../local-first-guest/transport";
import {
  LAB_VIEWER_MAX_BRIDGE_FRAME_BYTES,
  LAB_VIEWER_MAX_CONCURRENT_REQUESTS,
  LabViewerError,
  viewerFailure,
  type LabViewerControlFrame,
} from "./protocol";
import { LocalFirstViewerSession, type LocalFirstViewerTransport } from "./session";
import { validLocalViewerRelayHttpResponse } from "./http-protocol";

function viewerExecutable(): string {
  if (process.platform === "win32") return path.resolve(__dirname, "../../../Amniora.Viewer.exe");
  return path.resolve(__dirname, "../../bin/AmnioraLabViewer.app/Contents/MacOS/AmnioraLabViewer");
}

const execFileAsync = promisify(execFile);

export function existingViewerPid(processes: string, executable: string, authority: string): number | null {
  const expected = `${executable} --authority ${authority}`;
  for (const line of processes.split("\n")) {
    const match = /^\s*([1-9]\d*)\s+(\S+)\s+(.+)$/.exec(line);
    if (match && !match[2].startsWith("Z") && match[3] === expected) return Number(match[1]);
  }
  return null;
}

async function reuseExistingMacViewer(executable: string, authority: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const { stdout: processes } = await execFileAsync("/bin/ps", ["-axww", "-o", "pid=,stat=,command="],
    { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
  if (existingViewerPid(processes, executable, authority) === null) return false;
  const viewerApp = path.dirname(path.dirname(path.dirname(executable)));
  await execFileAsync("/usr/bin/open", ["-a", viewerApp], { timeout: 5_000 }).catch(() => undefined);
  return true;
}

function guestFailure(response: GuestResponse): LabViewerError {
  const code = response.errorCode ?? "VIEWER_RELAY_FAILED";
  if (["RUNTIME_NOT_FOUND", "RELAY_RUNTIME_STALE"].includes(code)) return new LabViewerError(code, 410, true);
  if (["MESSAGE_INVALID", "RELAY_REQUEST_INVALID", "RELAY_REDIRECT_DENIED"].includes(code)) {
    return new LabViewerError(code, 400, false);
  }
  if (code === "RELAY_RESPONSE_TOO_LARGE") return new LabViewerError(code, 502, false);
  if (code === "RELAY_UPSTREAM_TIMEOUT") return new LabViewerError(code, 504, false);
  return new LabViewerError(code, 502, true);
}

class SerializedGuestTransport implements LocalFirstViewerTransport {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly client: RunnerGuestClient) {}

  private run(operation: GuestOperation, input?: unknown): Promise<GuestResponse> {
    const task = this.tail.then(() => this.client.request(operation, input));
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }

  async runtimeStatus() {
    const response = await this.run("RUNTIME_STATUS");
    if (!response.ok) throw guestFailure(response);
    if (!validGuestRuntimeStatus(response.result)) throw new LabViewerError("VIEWER_STATUS_INVALID", 502, true);
    return response.result;
  }

  async relayHttp(input: Parameters<LocalFirstViewerTransport["relayHttp"]>[0]) {
    const response = await this.run("RELAY_HTTP", input);
    if (!response.ok) throw guestFailure(response);
    if (!validLocalViewerRelayHttpResponse(response.result)) throw new LabViewerError("VIEWER_RESPONSE_INVALID", 502, true);
    return response.result;
  }
}

function writeFrame(stream: NodeJS.WritableStream, frame: unknown): void {
  const line = `${JSON.stringify(frame)}\n`;
  if (Buffer.byteLength(line) > LAB_VIEWER_MAX_BRIDGE_FRAME_BYTES) throw new LabViewerError("VIEWER_RESPONSE_INVALID", 502, true);
  stream.write(line);
}

export async function runDesktopLabViewer(client: RunnerGuestClient, onReady?: () => void): Promise<void> {
  if (!['darwin', 'win32'].includes(process.platform)) throw new Error("VIEWER_PLATFORM_UNSUPPORTED");
  const executable = viewerExecutable();
  const detail = await lstat(executable);
  if (!detail.isFile() || detail.isSymbolicLink() || (process.platform !== "win32" && (detail.mode & 0o111) === 0)) {
    throw new Error("VIEWER_BINARY_INVALID");
  }
  const transport = new SerializedGuestTransport(client);
  const session = await LocalFirstViewerSession.create(transport);
  const childEnvironment: NodeJS.ProcessEnv = process.platform === "win32"
    ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", WINDIR: process.env.WINDIR ?? "C:\\Windows",
      TEMP: process.env.TEMP ?? path.join(os.homedir(), "AppData/Local/Temp"),
      TMP: process.env.TMP ?? path.join(os.homedir(), "AppData/Local/Temp"), NODE_ENV: "production", LANG: "en_US.UTF-8" }
    : { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", NODE_ENV: "production" };
  // The website may issue Open Lab again after a viewer is already open. The Runner
  // serializes command helpers, but each viewer relay lives in a detached process.
  // Reuse only this exact signed generation; another generation must get a new viewer.
  if (await reuseExistingMacViewer(executable, session.binding.authority)) {
    onReady?.();
    return;
  }
  const child = spawn(executable, ["--authority", session.binding.authority], {
    stdio: ["pipe", "pipe", "inherit"] as const,
    env: childEnvironment,
  });
  if (!child.stdin || !child.stdout) throw new Error("VIEWER_PROCESS_FAILED");
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  onReady?.();

  let active = 0;
  let invalidated = false;
  const seen = new Set<string>();
  const invalidate = (reason: LabViewerControlFrame["reason"]) => {
    if (invalidated) return;
    invalidated = true;
    try { writeFrame(child.stdin!, { type: "viewer-control", action: "invalidate", reason } satisfies LabViewerControlFrame); }
    catch { /* Closing the process is the fail-closed fallback. */ }
    setTimeout(() => { if (!child.killed) child.kill("SIGTERM"); }, 500).unref();
  };

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity, terminal: false });
  lines.on("line", line => {
    void (async () => {
      let requestId = "vrq_invalid_request_0001";
      if (Buffer.byteLength(line) > LAB_VIEWER_MAX_BRIDGE_FRAME_BYTES || invalidated) {
        writeFrame(child.stdin!, viewerFailure(requestId, new LabViewerError("VIEWER_REQUEST_INVALID", 400)));
        return;
      }
      let value: unknown;
      try { value = JSON.parse(line); }
      catch {
        writeFrame(child.stdin!, viewerFailure(requestId, new LabViewerError("VIEWER_REQUEST_INVALID", 400)));
        return;
      }
      if (typeof value === "object" && value !== null && "requestId" in value && typeof value.requestId === "string") {
        requestId = value.requestId;
      }
      if (seen.has(requestId) || seen.size >= 4_096) {
        writeFrame(child.stdin!, viewerFailure(requestId, new LabViewerError("VIEWER_REQUEST_REPLAYED", 409)));
        return;
      }
      seen.add(requestId);
      if (active >= LAB_VIEWER_MAX_CONCURRENT_REQUESTS) {
        writeFrame(child.stdin!, viewerFailure(requestId, new LabViewerError("VIEWER_CONCURRENCY_LIMIT", 429)));
        return;
      }
      active += 1;
      try {
        writeFrame(child.stdin!, await session.relay(value));
      } catch (error) {
        const failure = viewerFailure(requestId, error);
        writeFrame(child.stdin!, failure);
        if (failure.terminal) invalidate("generation-changed");
      } finally { active -= 1; }
    })().catch(() => invalidate("runner-disconnected"));
  });

  const monitor = setInterval(() => {
    void session.current().then(current => { if (!current) invalidate("runtime-stopped"); }, () => invalidate("runner-disconnected"));
  }, 1_000);
  monitor.unref();

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0 || signal === "SIGTERM") resolve();
      else reject(new Error("VIEWER_PROCESS_FAILED"));
    });
  }).finally(() => {
    clearInterval(monitor);
    lines.close();
    if (!child.killed) child.kill("SIGTERM");
  });
}

export const runMacLabViewer = runDesktopLabViewer;
