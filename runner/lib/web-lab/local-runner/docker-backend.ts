import { execFile } from "node:child_process";
import { mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LocalRunnerPackage } from "./package";
import {
  LOCAL_RUNNER_RUNTIME_VERSION,
  LocalRunnerError,
  requireSafeLoopbackEndpoint,
  type RunnerDoctorCode,
} from "./protocol";

const execFileAsync = promisify(execFile);
const IMAGE = "amniora-local-runner:15a-1";
const LABEL_PREFIX = "com.amniora.local-runner";
const MANAGED_LABEL = `${LABEL_PREFIX}.managed=true`;
const DEFAULT_CONTAINER_CONTEXT = path.join(process.cwd(), "lib/web-lab/local-runner/container");
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

export type DockerDoctorResult = Readonly<{
  commandAvailable: boolean;
  daemonReachable: boolean;
  serverVersion: string | null;
  outcome: RunnerDoctorCode;
}>;

export type LocalRuntimeIdentity = Readonly<{
  sessionId: string;
  buildFingerprint: string;
  generation: number;
}>;

export type BackendReadyRuntime = LocalRuntimeIdentity & Readonly<{
  endpoint: string;
  bundleDir: string;
}>;

export type ManagedDockerResource = Readonly<{
  kind: "container" | "network" | "volume";
  id: string;
  role: "challenge" | "proxy" | "network" | "bundle" | "loader";
  identity: LocalRuntimeIdentity;
  detail: Record<string, unknown>;
}>;

export interface LocalRunnerRuntimeBackend {
  doctor(): Promise<DockerDoctorResult>;
  create(pkg: LocalRunnerPackage, identity: LocalRuntimeIdentity): Promise<BackendReadyRuntime>;
  reset?(pkg: LocalRunnerPackage, previous: LocalRuntimeIdentity, next: LocalRuntimeIdentity): Promise<BackendReadyRuntime>;
  recover(identity: LocalRuntimeIdentity): Promise<BackendReadyRuntime | null>;
  stop(identity: LocalRuntimeIdentity): Promise<void>;
  listManaged(): Promise<readonly ManagedDockerResource[]>;
}

type CommandExecutor = (command: string, args: readonly string[]) => Promise<string>;

export function defaultLocalRunnerStateDirectory(): string {
  const suffix = typeof process.getuid === "function" ? String(process.getuid()) : "user";
  return path.join(tmpdir(), `amniora-local-runner-${suffix}`);
}

async function defaultExecute(command: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(command, [...args], { maxBuffer: 2 * 1024 * 1024, timeout: 120_000 });
  return result.stdout.trim();
}

function labelName(name: string): string {
  return `${LABEL_PREFIX}.${name}`;
}

function names(identity: LocalRuntimeIdentity) {
  const base = `amniora-lr-${identity.sessionId}-g${identity.generation}`;
  return { challenge: `${base}-challenge`, proxy: `${base}-proxy`, network: `${base}-network` };
}

function validIdentity(identity: LocalRuntimeIdentity): boolean {
  return /^[0-9a-f]{32}$/.test(identity.sessionId) && /^[0-9a-f]{64}$/.test(identity.buildFingerprint) &&
    Number.isSafeInteger(identity.generation) && identity.generation >= 1;
}

function labels(identity: LocalRuntimeIdentity, role: ManagedDockerResource["role"]): string[] {
  return Object.entries({
    [labelName("managed")]: "true",
    [labelName("runtime-mode")]: "local-runner",
    [labelName("role")]: role,
    [labelName("session")]: identity.sessionId,
    [labelName("build-fingerprint")]: identity.buildFingerprint,
    [labelName("generation")]: String(identity.generation),
    [labelName("runtime-version")]: LOCAL_RUNNER_RUNTIME_VERSION,
  }).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
}

function detailLabels(detail: Record<string, unknown>): Record<string, string> {
  const config = detail.Config as Record<string, unknown> | undefined;
  const source = (config?.Labels ?? detail.Labels) as Record<string, string> | undefined;
  return source ?? {};
}

function identityFrom(detail: Record<string, unknown>): (LocalRuntimeIdentity & { role: ManagedDockerResource["role"] }) | null {
  const found = detailLabels(detail);
  const identity = {
    sessionId: found[labelName("session")],
    buildFingerprint: found[labelName("build-fingerprint")],
    generation: Number(found[labelName("generation")]),
  };
  const role = found[labelName("role")];
  if (found[labelName("managed")] !== "true" || found[labelName("runtime-mode")] !== "local-runner" ||
      found[labelName("runtime-version")] !== LOCAL_RUNNER_RUNTIME_VERSION || !validIdentity(identity) ||
      !["challenge", "proxy", "network"].includes(role)) return null;
  return { ...identity, role: role as ManagedDockerResource["role"] };
}

function sameIdentity(left: LocalRuntimeIdentity, right: LocalRuntimeIdentity): boolean {
  return left.sessionId === right.sessionId && left.buildFingerprint === right.buildFingerprint && left.generation === right.generation;
}

export class DockerLocalRunnerBackend implements LocalRunnerRuntimeBackend {
  private imageReady = false;

  constructor(
    private readonly execute: CommandExecutor = defaultExecute,
    readonly stateDirectory = defaultLocalRunnerStateDirectory(),
    private readonly containerContext = DEFAULT_CONTAINER_CONTEXT,
    private readonly failureDiagnostic?: (stage: string) => void,
  ) {}

  private async docker(...args: string[]): Promise<string> {
    return this.execute("docker", args);
  }

  async doctor(): Promise<DockerDoctorResult> {
    try { await this.execute("docker", ["--version"]); }
    catch { return { commandAvailable: false, daemonReachable: false, serverVersion: null, outcome: "DOCKER_UNAVAILABLE" }; }
    try {
      const serverVersion = await this.execute("docker", ["version", "--format", "{{.Server.Version}}"]);
      return { commandAvailable: true, daemonReachable: true, serverVersion, outcome: "RUNNER_READY" };
    } catch {
      return { commandAvailable: true, daemonReachable: false, serverVersion: null, outcome: "DOCKER_DAEMON_UNAVAILABLE" };
    }
  }

  private bundleDirectory(identity: LocalRuntimeIdentity): string {
    return path.join(this.stateDirectory, "bundles", `${identity.sessionId}-g${identity.generation}`);
  }

  private async ensureImage(): Promise<void> {
    if (this.imageReady) return;
    await this.docker("build", "--pull=false", "-t", IMAGE, this.containerContext);
    this.imageReady = true;
  }

  private async writeBundle(pkg: LocalRunnerPackage, identity: LocalRuntimeIdentity): Promise<string> {
    const directory = this.bundleDirectory(identity);
    await mkdir(directory, { recursive: true, mode: 0o755 });
    await chmod(directory, 0o755);
    for (const file of pkg.bundle) {
      const filePath = path.join(directory, file.path);
      await writeFile(filePath, file.content, { mode: 0o444, flag: "wx" });
      await chmod(filePath, 0o444);
    }
    return directory;
  }

  private async endpointFor(proxy: string): Promise<string> {
    const binding = await this.docker("port", proxy, "8080/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new LocalRunnerError("INVALID_ENDPOINT");
    return requireSafeLoopbackEndpoint(`http://127.0.0.1:${match[1]}`);
  }

  async create(pkg: LocalRunnerPackage, identity: LocalRuntimeIdentity): Promise<BackendReadyRuntime> {
    if (!validIdentity(identity) || pkg.buildFingerprint !== identity.buildFingerprint) throw new LocalRunnerError("PACKAGE_INVALID");
    const resourceNames = names(identity);
    let bundleDir: string | null = null;
    let stage = "ensure_image";
    try {
      await this.ensureImage();
      stage = "write_bundle";
      bundleDir = await this.writeBundle(pkg, identity);
      stage = "create_network";
      await this.docker("network", "create", "--internal", "--driver", "bridge", ...labels(identity, "network"), resourceNames.network);
      stage = "start_challenge";
      await this.docker(
        "run", "-d", "--name", resourceNames.challenge, "--network", resourceNames.network,
        ...labels(identity, "challenge"), "--read-only", "--user", "1000:1000", "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true", "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5",
        "--env", "WEB_LAB_LOCAL_ONLY=1", "--mount", `type=bind,src=${bundleDir},dst=/bundle,readonly`, IMAGE,
      );
      stage = "start_proxy";
      await this.docker(
        "run", "-d", "--name", resourceNames.proxy, "--network", "bridge", ...labels(identity, "proxy"),
        "--read-only", "--user", "1000:1000", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
        "--pids-limit", "64", "--memory", "128m", "--cpus", "0.5", "--env", `AMNIORA_LOCAL_UPSTREAM=${resourceNames.challenge}`,
        "-p", "127.0.0.1::8080", IMAGE, "node", "/app/ingress-proxy.cjs",
      );
      stage = "connect_proxy";
      await this.docker("network", "connect", resourceNames.network, resourceNames.proxy);
      stage = "resolve_endpoint";
      const endpoint = await this.endpointFor(resourceNames.proxy);
      stage = "wait_ready";
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          const response = await fetch(`${endpoint}/__runtime/health`, { signal: AbortSignal.timeout(500) });
          if (response.ok) return { ...identity, endpoint, bundleDir };
        } catch { /* bounded readiness retry */ }
        await wait(100);
      }
      throw new Error("runtime_not_ready");
    } catch {
      this.failureDiagnostic?.(stage);
      try { await this.stop(identity); } catch { /* retain original safe error */ }
      throw new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500);
    }
  }

  async listManaged(): Promise<readonly ManagedDockerResource[]> {
    const containerIds = (await this.docker("container", "ls", "-aq", "--filter", `label=${MANAGED_LABEL}`)).split("\n").filter(Boolean);
    const networkIds = (await this.docker("network", "ls", "-q", "--filter", `label=${MANAGED_LABEL}`)).split("\n").filter(Boolean);
    const resources: ManagedDockerResource[] = [];
    if (containerIds.length) {
      const details = JSON.parse(await this.docker("inspect", ...containerIds)) as Record<string, unknown>[];
      for (const detail of details) {
        const observed = identityFrom(detail);
        if (!observed || observed.role === "network") continue;
        resources.push({ kind: "container", id: String(detail.Id), role: observed.role, identity: observed, detail });
      }
    }
    if (networkIds.length) {
      const details = JSON.parse(await this.docker("network", "inspect", ...networkIds)) as Record<string, unknown>[];
      for (const detail of details) {
        const observed = identityFrom(detail);
        if (!observed || observed.role !== "network") continue;
        resources.push({ kind: "network", id: String(detail.Id), role: "network", identity: observed, detail });
      }
    }
    return resources;
  }

  async recover(identity: LocalRuntimeIdentity): Promise<BackendReadyRuntime | null> {
    if (!validIdentity(identity)) return null;
    const matching = (await this.listManaged()).filter(resource => sameIdentity(resource.identity, identity));
    if (matching.length !== 3 || new Set(matching.map(resource => resource.role)).size !== 3) return null;
    const challenge = matching.find(resource => resource.role === "challenge");
    const proxy = matching.find(resource => resource.role === "proxy");
    const network = matching.find(resource => resource.role === "network");
    const challengeState = challenge?.detail.State as Record<string, unknown> | undefined;
    const proxyState = proxy?.detail.State as Record<string, unknown> | undefined;
    if (!challenge || !proxy || !network || challengeState?.Running !== true || proxyState?.Running !== true || network.detail.Internal !== true) return null;
    const endpoint = await this.endpointFor(proxy.id);
    const bundleDir = this.bundleDirectory(identity);
    try {
      const response = await fetch(`${endpoint}/__runtime/health`, { signal: AbortSignal.timeout(1_000) });
      if (!response.ok) return null;
    } catch { return null; }
    return { ...identity, endpoint, bundleDir };
  }

  async stop(identity: LocalRuntimeIdentity): Promise<void> {
    if (!validIdentity(identity)) throw new LocalRunnerError("LOCAL_RUNTIME_INCONSISTENT", 500);
    const matching = (await this.listManaged()).filter(resource => sameIdentity(resource.identity, identity));
    for (const resource of matching.filter(item => item.kind === "container")) {
      const current = JSON.parse(await this.docker("inspect", resource.id)) as Record<string, unknown>[];
      const observed = current[0] && identityFrom(current[0]);
      if (observed && sameIdentity(observed, identity) && observed.role === resource.role) await this.docker("rm", "-f", resource.id);
    }
    for (const resource of matching.filter(item => item.kind === "network")) {
      const current = JSON.parse(await this.docker("network", "inspect", resource.id)) as Record<string, unknown>[];
      const observed = current[0] && identityFrom(current[0]);
      if (observed && sameIdentity(observed, identity) && observed.role === "network") await this.docker("network", "rm", resource.id);
    }
    await rm(this.bundleDirectory(identity), { recursive: true, force: true });
  }
}

export const LOCAL_RUNNER_DOCKER_IMAGE = IMAGE;
export const LOCAL_RUNNER_DOCKER_LABEL_PREFIX = LABEL_PREFIX;
