import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { LocalRunnerPackage, LocalRunnerVerificationKeys } from "../local-runner/package";
import { packageSupportsPlatform, verifyLocalRunnerPackage } from "../local-runner/package";
import { GUEST_VM_ADDRESS, normalizeLinuxArchitecture, type SupportedGuestArchitecture } from "./protocol";
import {
  RUNTIME_HELPER_PROTOCOL_VERSION,
  RuntimeHelperError,
  sameHelperRuntime,
  validHelperRuntimeIdentity,
  type HelperRuntimeIdentity,
  type HelperRuntimeState,
  type HelperRuntimeStatus,
  type RuntimeHelperErrorCode,
} from "./runtime-helper-protocol";

const execFileAsync = promisify(execFile);
const LABEL_PREFIX = "com.amniora.runtime-helper";
const MANAGED_LABEL = `${LABEL_PREFIX}.managed=true`;
const STATE_KEYS = ["schemaVersion", "state", "runtime", "endpoint", "errorCode"] as const;
const WAIT_STEP_MS = 100;

type Execute = (command: string, args: readonly string[]) => Promise<string>;
type ReadinessProbe = (endpoint: string, pkg: LocalRunnerPackage) => Promise<boolean>;
type PersistedHelperState = Readonly<{
  schemaVersion: 1;
  state: HelperRuntimeState;
  runtime: HelperRuntimeIdentity | null;
  endpoint: string | null;
  errorCode: RuntimeHelperErrorCode | null;
}>;
type ObservedResource = Readonly<{
  kind: "container" | "network" | "volume";
  id: string;
  role: "challenge" | "proxy" | "network" | "bundle" | "loader";
  runtime: HelperRuntimeIdentity;
  detail: Record<string, unknown>;
}>;

const EMPTY_STATE: PersistedHelperState = Object.freeze({
  schemaVersion: 1,
  state: "idle",
  runtime: null,
  endpoint: null,
  errorCode: null,
});

async function defaultExecute(command: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync(command, [...args], {
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", NODE_ENV: "production" },
    });
    return result.stdout.trim();
  } catch {
    throw new RuntimeHelperError("HELPER_DOCKER_UNAVAILABLE");
  }
}

async function defaultReadinessProbe(endpoint: string, pkg: LocalRunnerPackage): Promise<boolean> {
  try {
    const response = await fetch(new URL(pkg.healthCheck.path, endpoint), {
      method: "GET",
      signal: AbortSignal.timeout(750),
      redirect: "error",
    });
    return response.status === pkg.healthCheck.expectedStatus;
  } catch {
    return false;
  }
}

function labelName(name: string): string { return `${LABEL_PREFIX}.${name}`; }

function resourceNames(runtime: HelperRuntimeIdentity) {
  const base = `amniora-p3-${runtime.runtimeId}-g${runtime.generation}`;
  return { challenge: `${base}-challenge`, proxy: `${base}-proxy`, loader: `${base}-loader`,
    network: `${base}-network`, bundle: `${base}-bundle` };
}

function runtimeLabels(runtime: HelperRuntimeIdentity, role: ObservedResource["role"]): string[] {
  return Object.entries({
    [labelName("managed")]: "true",
    [labelName("role")]: role,
    [labelName("runtime-id")]: runtime.runtimeId,
    [labelName("build-id")]: runtime.buildId,
    [labelName("build-fingerprint")]: runtime.buildFingerprint,
    [labelName("package-hash")]: runtime.packageHash,
    [labelName("generation")]: String(runtime.generation),
    [labelName("helper-protocol")]: RUNTIME_HELPER_PROTOCOL_VERSION,
  }).flatMap(([name, value]) => ["--label", `${name}=${value}`]);
}

function detailLabels(detail: Record<string, unknown>): Record<string, string> {
  const config = detail.Config as Record<string, unknown> | undefined;
  return (config?.Labels ?? detail.Labels ?? {}) as Record<string, string>;
}

function observedIdentity(detail: Record<string, unknown>): (HelperRuntimeIdentity & { role: ObservedResource["role"] }) | null {
  const labels = detailLabels(detail);
  const generation = Number(labels[labelName("generation")]);
  const runtime: HelperRuntimeIdentity = {
    runtimeId: labels[labelName("runtime-id")],
    buildId: labels[labelName("build-id")],
    buildFingerprint: labels[labelName("build-fingerprint")],
    packageHash: labels[labelName("package-hash")],
    generation,
  };
  const role = labels[labelName("role")];
  if (labels[labelName("managed")] !== "true" || labels[labelName("helper-protocol")] !== RUNTIME_HELPER_PROTOCOL_VERSION ||
      !/^[0-9a-f]{32}$/.test(runtime.runtimeId) || !/^[A-Za-z0-9_-]{8,128}$/.test(runtime.buildId) ||
      !/^[0-9a-f]{64}$/.test(runtime.buildFingerprint) || !/^[0-9a-f]{64}$/.test(runtime.packageHash) ||
      !Number.isSafeInteger(generation) || generation < 1 ||
      !["challenge", "proxy", "network", "bundle", "loader"].includes(role)) return null;
  return { ...runtime, role: role as ObservedResource["role"] };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function validState(value: unknown): value is PersistedHelperState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, STATE_KEYS) || candidate.schemaVersion !== 1 ||
      !["idle", "prepared", "launching", "ready", "resetting", "stopping", "failed", "stopped"].includes(String(candidate.state)) ||
      !(candidate.runtime === null || validHelperRuntimeIdentity(candidate.runtime)) ||
      !(candidate.endpoint === null || typeof candidate.endpoint === "string") ||
      !(candidate.errorCode === null || typeof candidate.errorCode === "string")) return false;
  return true;
}

class RuntimeHelperStateStore {
  private readonly statePath: string;

  constructor(private readonly directory: string) {
    this.statePath = path.join(directory, "runtime-state.json");
  }

  async read(): Promise<PersistedHelperState> {
    try {
      const value: unknown = JSON.parse(await readFile(this.statePath, "utf8"));
      if (!validState(value)) throw new RuntimeHelperError("HELPER_INTERNAL_ERROR");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
      throw error;
    }
  }

  async write(value: PersistedHelperState): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const detail = await lstat(this.directory);
    if (!detail.isDirectory() || detail.isSymbolicLink()) throw new RuntimeHelperError("HELPER_INTERNAL_ERROR");
    await chmod(this.directory, 0o700);
    const temporary = path.join(this.directory, `runtime-state-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temporary, this.statePath);
    await chmod(this.statePath, 0o600);
  }
}

export class PrivilegedDockerRuntimeManager {
  private readonly store: RuntimeHelperStateStore;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly verificationKeys: LocalRunnerVerificationKeys,
    readonly stateDirectory = "/var/lib/amniora-runtime-helper",
    private readonly architecture: SupportedGuestArchitecture = normalizeLinuxArchitecture(os.arch()),
    private readonly execute: Execute = defaultExecute,
    private readonly readinessProbe: ReadinessProbe = defaultReadinessProbe,
    private readonly ingressAddress = GUEST_VM_ADDRESS,
    private readonly failureDiagnostic?: (stage: string) => void,
  ) {
    this.store = new RuntimeHelperStateStore(stateDirectory);
    if (ingressAddress !== GUEST_VM_ADDRESS && ingressAddress !== "127.0.0.1") throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }

  private async docker(...args: string[]): Promise<string> { return this.execute("/usr/bin/docker", args); }

  private verifyPackage(pkg: unknown, runtime: HelperRuntimeIdentity, allowExpired = false): LocalRunnerPackage {
    try {
      const verified = verifyLocalRunnerPackage(pkg, this.verificationKeys, {
        expectedBuildId: runtime.buildId,
        expectedBuildFingerprint: runtime.buildFingerprint,
        allowExpired,
      });
      if (verified.packageHash !== runtime.packageHash) throw new RuntimeHelperError("HELPER_PACKAGE_INVALID");
      if (!packageSupportsPlatform(verified, "linux", this.architecture)) {
        throw new RuntimeHelperError("HELPER_PLATFORM_UNSUPPORTED");
      }
      return verified;
    } catch (error) {
      if (error instanceof RuntimeHelperError) throw error;
      throw new RuntimeHelperError("HELPER_PACKAGE_INVALID");
    }
  }

  private async verifyImage(pkg: LocalRunnerPackage): Promise<void> {
    let detail: Record<string, unknown>;
    try { detail = JSON.parse(await this.docker("image", "inspect", pkg.image.digest))[0] as Record<string, unknown>; }
    catch (error) {
      if (error instanceof RuntimeHelperError && error.code === "HELPER_DOCKER_UNAVAILABLE") throw new RuntimeHelperError("HELPER_IMAGE_MISSING");
      throw error;
    }
    if (!detail || detail.Id !== pkg.image.digest) throw new RuntimeHelperError("HELPER_IMAGE_DIGEST_MISMATCH");
    const observedArchitecture = normalizeLinuxArchitecture(String(detail.Architecture));
    if (detail.Os !== "linux" || observedArchitecture !== this.architecture) throw new RuntimeHelperError("HELPER_PLATFORM_UNSUPPORTED");
  }

  private bundleDirectory(runtime: HelperRuntimeIdentity): string {
    return path.join(this.stateDirectory, "bundles", `${runtime.runtimeId}-g${runtime.generation}`);
  }

  private async writeBundle(pkg: LocalRunnerPackage, runtime: HelperRuntimeIdentity): Promise<string> {
    const directory = this.bundleDirectory(runtime);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true, mode: 0o755 });
    await chmod(directory, 0o755);
    for (const file of pkg.bundle) {
      const filePath = path.join(directory, file.path);
      await writeFile(filePath, file.content, { mode: 0o444, flag: "wx" });
      // systemd deliberately applies UMask=0077 to the root helper. Restore the
      // exact read-only mode required by the uid 1000 challenge container.
      await chmod(filePath, 0o444);
    }
    return directory;
  }

  private async observedResources(): Promise<ObservedResource[]> {
    const containers = (await this.docker("container", "ls", "-aq", "--filter", `label=${MANAGED_LABEL}`)).split("\n").filter(Boolean);
    const networks = (await this.docker("network", "ls", "-q", "--filter", `label=${MANAGED_LABEL}`)).split("\n").filter(Boolean);
    const volumes = (await this.docker("volume", "ls", "-q", "--filter", `label=${MANAGED_LABEL}`)).split("\n").filter(Boolean);
    const result: ObservedResource[] = [];
    if (containers.length) {
      const details = JSON.parse(await this.docker("inspect", ...containers)) as Record<string, unknown>[];
      for (const detail of details) {
        const identity = observedIdentity(detail);
        if (identity && ["challenge", "proxy", "loader"].includes(identity.role)) result.push({ kind: "container", id: String(detail.Id), role: identity.role,
          runtime: identity, detail });
      }
    }
    if (volumes.length) {
      const details = JSON.parse(await this.docker("volume", "inspect", ...volumes)) as Record<string, unknown>[];
      for (const detail of details) {
        const identity = observedIdentity(detail);
        if (identity?.role === "bundle") result.push({ kind: "volume", id: String(detail.Name), role: "bundle",
          runtime: identity, detail });
      }
    }
    if (networks.length) {
      const details = JSON.parse(await this.docker("network", "inspect", ...networks)) as Record<string, unknown>[];
      for (const detail of details) {
        const identity = observedIdentity(detail);
        if (identity?.role === "network") result.push({ kind: "network", id: String(detail.Id), role: "network",
          runtime: identity, detail });
      }
    }
    return result;
  }

  private async resourcesFor(runtime: HelperRuntimeIdentity): Promise<ObservedResource[]> {
    return (await this.observedResources()).filter(resource => sameHelperRuntime(resource.runtime, runtime));
  }

  private async removeResources(runtime: HelperRuntimeIdentity): Promise<void> {
    const authoritative = await this.store.read();
    if (!authoritative.runtime || !sameHelperRuntime(authoritative.runtime, runtime)) {
      throw new RuntimeHelperError("HELPER_RUNTIME_NOT_FOUND");
    }
    const resources = await this.resourcesFor(runtime);
    for (const resource of resources.filter(item => item.kind === "container")) {
      const current = JSON.parse(await this.docker("inspect", resource.id))[0] as Record<string, unknown> | undefined;
      const observed = current && observedIdentity(current);
      if (observed && observed.role === resource.role && sameHelperRuntime(observed, authoritative.runtime)) {
        await this.docker("rm", "-f", resource.id);
      }
    }
    for (const resource of resources.filter(item => item.kind === "network")) {
      const current = JSON.parse(await this.docker("network", "inspect", resource.id))[0] as Record<string, unknown> | undefined;
      const observed = current && observedIdentity(current);
      if (observed?.role === "network" && sameHelperRuntime(observed, authoritative.runtime)) {
        await this.docker("network", "rm", resource.id);
      }
    }
    for (const resource of resources.filter(item => item.kind === "volume")) {
      const current = JSON.parse(await this.docker("volume", "inspect", resource.id))[0] as Record<string, unknown> | undefined;
      const observed = current && observedIdentity(current);
      if (observed?.role === "bundle" && sameHelperRuntime(observed, authoritative.runtime)) {
        await this.docker("volume", "rm", resource.id);
      }
    }
    await rm(this.bundleDirectory(runtime), { recursive: true, force: true });
  }

  private async endpointFor(proxy: string): Promise<string> {
    const binding = await this.docker("port", proxy, "8080/tcp");
    const escaped = this.ingressAddress.replaceAll(".", "\\.");
    const match = new RegExp(`^${escaped}:(\\d+)$`).exec(binding);
    if (!match || Number(match[1]) < 1024 || Number(match[1]) > 65535) throw new RuntimeHelperError("HELPER_LAUNCH_FAILED");
    return `http://${this.ingressAddress}:${match[1]}/`;
  }

  private async launchResources(pkg: LocalRunnerPackage, runtime: HelperRuntimeIdentity): Promise<string> {
    const names = resourceNames(runtime);
    const bundleDirectory = await this.writeBundle(pkg, runtime);
    const policy = pkg.resourcePolicy;
    const common = ["--read-only", "--user", "1000:1000", "--cap-drop", policy.dropCapabilities,
      "--security-opt", "no-new-privileges:true", "--pids-limit", String(policy.pidsLimit),
      "--memory", String(policy.memoryBytes), "--cpus", String(policy.nanoCpus / 1_000_000_000),
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16777216"];
    let stage = "create_network";
    try {
      await this.docker("network", "create", "--internal", "--driver", "bridge", ...runtimeLabels(runtime, "network"), names.network);
      stage = "create_bundle_volume";
      await this.docker("volume", "create", ...runtimeLabels(runtime, "bundle"), names.bundle);
      stage = "create_bundle_loader";
      await this.docker("create", "--name", names.loader, "--network", "none", ...runtimeLabels(runtime, "loader"),
        ...common, "--mount", `type=volume,src=${names.bundle},dst=/bundle`, pkg.image.digest);
      stage = "copy_bundle";
      await this.docker("cp", `${bundleDirectory}/.`, `${names.loader}:/bundle`);
      await this.docker("rm", "-f", names.loader);
      stage = "create_challenge";
      await this.docker("create", "--name", names.challenge, "--network", names.network,
        ...runtimeLabels(runtime, "challenge"), ...common,
        "--mount", `type=volume,src=${names.bundle},dst=/bundle,readonly`, pkg.image.digest);
      stage = "start_challenge";
      await this.docker("start", names.challenge);
      stage = "create_proxy";
      await this.docker("create", "--name", names.proxy, "--network", "bridge", ...runtimeLabels(runtime, "proxy"),
        ...common, "--env", `AMNIORA_LOCAL_UPSTREAM=${names.challenge}`, "-p", `${this.ingressAddress}::8080`,
        pkg.image.digest, "node", "/app/ingress-proxy.cjs");
      stage = "connect_proxy";
      await this.docker("network", "connect", names.network, names.proxy);
      stage = "start_proxy";
      await this.docker("start", names.proxy);
      stage = "resolve_endpoint";
      const endpoint = await this.endpointFor(names.proxy);
      stage = "wait_ready";
      const attempts = Math.ceil(pkg.healthCheck.timeoutMs / WAIT_STEP_MS);
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (await this.readinessProbe(endpoint, pkg)) {
          await rm(bundleDirectory, { recursive: true, force: true });
          return endpoint;
        }
        await new Promise(resolve => setTimeout(resolve, WAIT_STEP_MS));
      }
      throw new RuntimeHelperError("HELPER_LAUNCH_FAILED");
    } catch (error) {
      this.failureDiagnostic?.(stage);
      try { await this.removeResources(runtime); } catch { /* Preserve the bounded launch error. */ }
      throw error instanceof RuntimeHelperError ? error : new RuntimeHelperError("HELPER_LAUNCH_FAILED");
    }
  }

  private async statusUnlocked(expected: HelperRuntimeIdentity | null = null): Promise<HelperRuntimeStatus> {
    const state = await this.store.read();
    if (expected && (!state.runtime || !sameHelperRuntime(state.runtime, expected))) throw new RuntimeHelperError("HELPER_RUNTIME_NOT_FOUND");
    const resources = state.runtime ? await this.resourcesFor(state.runtime) : [];
    const roles = new Set(resources.map(resource => resource.role));
    const challengeState = resources.find(resource => resource.role === "challenge")?.detail.State as Record<string, unknown> | undefined;
    const proxyState = resources.find(resource => resource.role === "proxy")?.detail.State as Record<string, unknown> | undefined;
    const network = resources.find(resource => resource.role === "network")?.detail;
    const complete = roles.size === 4 && roles.has("challenge") && roles.has("proxy") && roles.has("network") && roles.has("bundle") &&
      challengeState?.Running === true && proxyState?.Running === true && network?.Internal === true;
    return Object.freeze({
      state: state.state,
      runtime: state.runtime,
      endpoint: state.state === "ready" && complete ? state.endpoint : null,
      ready: state.state === "ready" && complete && state.endpoint !== null,
      architecture: this.architecture,
      resources: resources.map(resource => Object.freeze({ kind: resource.kind, role: resource.role })),
      errorCode: state.errorCode,
    });
  }

  async prepare(pkgInput: unknown, runtime: HelperRuntimeIdentity): Promise<HelperRuntimeStatus> {
    return this.exclusive(async () => {
      const pkg = this.verifyPackage(pkgInput, runtime);
      const state = await this.store.read();
      if (state.runtime && !sameHelperRuntime(state.runtime, runtime) && !["idle", "stopped", "failed"].includes(state.state)) {
        throw new RuntimeHelperError("HELPER_RUNTIME_CONFLICT");
      }
      if (state.runtime && !sameHelperRuntime(state.runtime, runtime) &&
          (await this.resourcesFor(state.runtime)).length > 0) throw new RuntimeHelperError("HELPER_RUNTIME_CONFLICT");
      if (state.runtime && sameHelperRuntime(state.runtime, runtime) && state.state === "ready") return this.statusUnlocked(runtime);
      await this.verifyImage(pkg);
      await this.store.write({ schemaVersion: 1, state: "prepared", runtime, endpoint: null, errorCode: null });
      return this.statusUnlocked(runtime);
    });
  }

  async launch(pkgInput: unknown, runtime: HelperRuntimeIdentity): Promise<HelperRuntimeStatus> {
    return this.exclusive(async () => {
      const pkg = this.verifyPackage(pkgInput, runtime);
      const state = await this.store.read();
      if (state.runtime && sameHelperRuntime(state.runtime, runtime) && state.state === "ready") return this.statusUnlocked(runtime);
      if (!state.runtime || !sameHelperRuntime(state.runtime, runtime) || state.state !== "prepared") {
        throw new RuntimeHelperError("HELPER_RUNTIME_CONFLICT");
      }
      await this.verifyImage(pkg);
      await this.store.write({ schemaVersion: 1, state: "launching", runtime, endpoint: null, errorCode: null });
      try {
        const endpoint = await this.launchResources(pkg, runtime);
        await this.store.write({ schemaVersion: 1, state: "ready", runtime, endpoint, errorCode: null });
        return this.statusUnlocked(runtime);
      } catch (error) {
        const code = error instanceof RuntimeHelperError ? error.code : "HELPER_LAUNCH_FAILED";
        await this.store.write({ schemaVersion: 1, state: "failed", runtime, endpoint: null, errorCode: code });
        throw error;
      }
    });
  }

  async reset(pkgInput: unknown, previous: HelperRuntimeIdentity, next: HelperRuntimeIdentity): Promise<HelperRuntimeStatus> {
    return this.exclusive(async () => {
      if (previous.runtimeId !== next.runtimeId || previous.buildId !== next.buildId ||
          previous.buildFingerprint !== next.buildFingerprint || previous.packageHash !== next.packageHash ||
          next.generation !== previous.generation + 1) throw new RuntimeHelperError("HELPER_MESSAGE_INVALID");
      const pkg = this.verifyPackage(pkgInput, next, true);
      const state = await this.store.read();
      if (!state.runtime || !sameHelperRuntime(state.runtime, previous) || state.state !== "ready") {
        throw new RuntimeHelperError("HELPER_RUNTIME_NOT_FOUND");
      }
      await this.verifyImage(pkg);
      await this.store.write({ ...state, state: "resetting", endpoint: null });
      await this.removeResources(previous);
      await this.store.write({ schemaVersion: 1, state: "launching", runtime: next, endpoint: null, errorCode: null });
      try {
        const endpoint = await this.launchResources(pkg, next);
        await this.store.write({ schemaVersion: 1, state: "ready", runtime: next, endpoint, errorCode: null });
        return this.statusUnlocked(next);
      } catch (error) {
        const code = error instanceof RuntimeHelperError ? error.code : "HELPER_LAUNCH_FAILED";
        await this.store.write({ schemaVersion: 1, state: "failed", runtime: next, endpoint: null, errorCode: code });
        throw error;
      }
    });
  }

  async status(runtime: HelperRuntimeIdentity | null): Promise<HelperRuntimeStatus> {
    return this.exclusive(() => this.statusUnlocked(runtime));
  }

  async stop(runtime: HelperRuntimeIdentity): Promise<HelperRuntimeStatus> {
    return this.exclusive(async () => {
      const state = await this.store.read();
      if (state.runtime && sameHelperRuntime(state.runtime, runtime) && state.state === "stopped") return this.statusUnlocked(runtime);
      if (!state.runtime || !sameHelperRuntime(state.runtime, runtime)) throw new RuntimeHelperError("HELPER_RUNTIME_NOT_FOUND");
      await this.store.write({ ...state, state: "stopping", endpoint: null });
      try {
        await this.removeResources(runtime);
        await this.store.write({ schemaVersion: 1, state: "stopped", runtime, endpoint: null, errorCode: null });
        return this.statusUnlocked(runtime);
      } catch {
        await this.store.write({ schemaVersion: 1, state: "failed", runtime, endpoint: null, errorCode: "HELPER_CLEANUP_FAILED" });
        throw new RuntimeHelperError("HELPER_CLEANUP_FAILED");
      }
    });
  }

  async clean(authoritativeRuntime: HelperRuntimeIdentity | null): Promise<HelperRuntimeStatus> {
    return this.exclusive(async () => {
      const state = await this.store.read();
      if (!state.runtime || (authoritativeRuntime && sameHelperRuntime(state.runtime, authoritativeRuntime))) {
        return this.statusUnlocked(authoritativeRuntime);
      }
      if (authoritativeRuntime) throw new RuntimeHelperError("HELPER_RUNTIME_CONFLICT");
      await this.store.write({ ...state, state: "stopping", endpoint: null });
      await this.removeResources(state.runtime);
      await this.store.write(EMPTY_STATE);
      return this.statusUnlocked(null);
    });
  }
}

export const PHASE3_DOCKER_LABEL_PREFIX = LABEL_PREFIX;
