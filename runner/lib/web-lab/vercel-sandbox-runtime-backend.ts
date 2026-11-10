import { createHmac, timingSafeEqual } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { compileWebLab } from "./compiler";
import type { ManagedRuntimeObservation, ReconciliableRuntimeBackend, RuntimeInspection } from "./durable-control-plane";
import type { RuntimeBackendContext } from "./control-plane";
import type { WebLabSpec } from "./schema";
import { buildVercelRuntimeBundle } from "./vercel-runtime-bundle";

export const VERCEL_SANDBOX_RUNTIME_VERSION = "phase10-vercel-2";
export const VERCEL_SANDBOX_REGION = "lhr1";
export const VERCEL_SANDBOX_PORT = 8080;
const BUNDLE_DIRECTORY = "amniora-runtime";
const MANAGED_TAG = "amniora-managed";
const MANAGED_VALUE = "phase10";
const INSTANCE_TAG = "amniora-instance";
const BUILD_TAG = "amniora-build";
const GENERATION_TAG = "amniora-generation";
const RUNTIME_TAG = "amniora-runtime";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

type SandboxStatus = "pending" | "running" | "stopping" | "stopped" | "failed" | "aborted" | "snapshotting";
type SandboxListItem = Readonly<{
  name: string;
  persistent: boolean;
  createdAt: number;
  updatedAt: number;
  status: SandboxStatus;
  cwd?: string;
  region?: string;
  vcpus?: number;
  memory?: number;
  image?: string;
  timeout?: number;
  networkPolicy?: unknown;
  totalEgressBytes?: number;
  totalIngressBytes?: number;
  totalActiveCpuDurationMs?: number;
  totalDurationMs?: number;
  expiresAt?: number;
  tags?: Record<string, string>;
}>;
type SandboxHandle = Readonly<{
  name: string;
  persistent: boolean;
  region: string;
  cwd: string;
  vcpus?: number;
  memory?: number;
  image?: string;
  timeout?: number;
  networkPolicy?: unknown;
  status: SandboxStatus;
  createdAt: Date;
  expiresAt?: Date;
  tags?: Record<string, string>;
  totalEgressBytes?: number;
  totalIngressBytes?: number;
  totalActiveCpuDurationMs?: number;
  totalDurationMs?: number;
  activeCpuUsageMs?: number;
  networkTransfer?: { ingress: number; egress: number };
  mkDir(path: string): Promise<void>;
  writeFiles(files: { path: string; content: string | Uint8Array; mode?: number }[]): Promise<void>;
  runCommand(params: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    detached?: boolean;
    timeoutMs?: number;
  }): Promise<{ exitCode?: number; stdout(): Promise<string>; stderr(): Promise<string> }>;
  domain(port: number): string;
  stop(): Promise<unknown>;
  delete(options?: { deleteOrphanSnapshots?: boolean }): Promise<void>;
}>;
type SandboxCreateOptions = Readonly<{
  name: string;
  image: string;
  ports: number[];
  timeout: number;
  resources: { vcpus: number };
  networkPolicy: "deny-all";
  tags: Record<string, string>;
  region: string;
  persistent: false;
}>;
type SandboxApi = Readonly<{
  create(options: SandboxCreateOptions): Promise<SandboxHandle>;
  get(options: { name: string }): Promise<SandboxHandle>;
  list(options: { limit: number; tags: Record<string, string> }): Promise<{ toArray(): Promise<SandboxListItem[]> }>;
}>;

export type VercelSandboxProviderMetadata = Readonly<{
  reference: string;
  sandboxName: string;
  region: string;
  status: SandboxStatus;
  persistent: boolean;
  networkPolicy: "deny-all";
  vcpus: number | null;
  memoryMb: number | null;
  image: string | null;
  rawOrigin: string;
  createdAt: number;
  expiresAt: number | null;
  totalDurationMs: number | null;
  totalActiveCpuDurationMs: number | null;
  ingressBytes: number | null;
  egressBytes: number | null;
}>;

export type VercelSandboxContainmentObservation = Readonly<{
  networkPolicyDenyAll: boolean;
  dnsBlocked: boolean;
  directIpBlocked: boolean;
  arbitraryPublicTcpBlocked: boolean;
}>;

type VercelManagedObservation = ManagedRuntimeObservation & Readonly<{
  sandboxName: string;
  providerStatus: SandboxStatus;
  createdAt: number;
}>;
type RuntimeBackendResolutionContext = Readonly<Pick<RuntimeBackendContext, "instanceId" | "generationVersion"> &
  Partial<Pick<RuntimeBackendContext, "buildFingerprint" | "runtimeVersion">>>;

function denyAll(policy: unknown): boolean {
  return policy === "deny-all" || (!!policy && typeof policy === "object" && "mode" in policy && policy.mode === "deny-all");
}

function validContext(context: RuntimeBackendContext | undefined): context is RuntimeBackendContext {
  return !!context && /^[0-9a-f-]{36}$/.test(context.instanceId) &&
    /^[0-9a-f]{64}$/.test(context.buildFingerprint) &&
    Number.isSafeInteger(context.generationVersion) && context.generationVersion >= 1 &&
    context.runtimeVersion === VERCEL_SANDBOX_RUNTIME_VERSION;
}

function identity(item: SandboxListItem): VercelManagedObservation | null {
  const tags = item.tags ?? {};
  const generationVersion = Number(tags[GENERATION_TAG]);
  const instanceId = tags[INSTANCE_TAG];
  const buildFingerprint = tags[BUILD_TAG];
  const runtimeVersion = tags[RUNTIME_TAG];
  if (tags[MANAGED_TAG] !== MANAGED_VALUE || !/^[0-9a-f-]{36}$/.test(instanceId ?? "") ||
      !/^[0-9a-f]{64}$/.test(buildFingerprint ?? "") || runtimeVersion !== VERCEL_SANDBOX_RUNTIME_VERSION ||
      !Number.isSafeInteger(generationVersion) || generationVersion < 1) return null;
  const secureConfiguration = item.persistent === false && item.region === VERCEL_SANDBOX_REGION &&
    item.vcpus === 1 && item.memory === 2048 && denyAll(item.networkPolicy);
  const state = item.status === "running" && secureConfiguration
    ? "ready"
    : ["failed", "aborted", "stopped"].includes(item.status) || !secureConfiguration ? "failed" : "partial";
  return {
    reference: instanceId!, instanceId: instanceId!, buildFingerprint: buildFingerprint!,
    generationVersion, runtimeVersion: runtimeVersion!, state,
    sandboxName: item.name, providerStatus: item.status, createdAt: item.createdAt,
  };
}

function sameIdentity(observation: ManagedRuntimeObservation, expected: RuntimeBackendContext): boolean {
  return observation.reference === expected.instanceId && observation.instanceId === expected.instanceId &&
    observation.buildFingerprint === expected.buildFingerprint &&
    observation.generationVersion === expected.generationVersion &&
    observation.runtimeVersion === expected.runtimeVersion;
}

function sameResolution(observation: ManagedRuntimeObservation, expected: RuntimeBackendResolutionContext): boolean {
  return observation.instanceId === expected.instanceId && observation.generationVersion === expected.generationVersion &&
    (expected.buildFingerprint === undefined || observation.buildFingerprint === expected.buildFingerprint) &&
    (expected.runtimeVersion === undefined || observation.runtimeVersion === expected.runtimeVersion);
}

function safeSandboxName(context: RuntimeBackendContext): string {
  return `amniora-p10-${context.instanceId.replaceAll("-", "")}-g${context.generationVersion}`;
}

function tagsFor(context: RuntimeBackendContext): Record<string, string> {
  return {
    [MANAGED_TAG]: MANAGED_VALUE,
    [INSTANCE_TAG]: context.instanceId,
    [BUILD_TAG]: context.buildFingerprint,
    [GENERATION_TAG]: String(context.generationVersion),
    [RUNTIME_TAG]: context.runtimeVersion,
  };
}

function constantTimeSame(left: string | undefined, right: string): boolean {
  const candidate = Buffer.from(left ?? "");
  const expected = Buffer.from(right);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export class VercelSandboxRuntimeBackend implements ReconciliableRuntimeBackend {
  private readonly api: SandboxApi;
  private readonly hopSigningKey: Buffer;
  private readonly timeoutMs: number;
  private readonly maximumManaged: number;
  private readonly creationDisabled: () => boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly deletedMetrics = new Map<string, VercelSandboxProviderMetadata>();

  constructor(options: {
    hopSigningKey: Uint8Array;
    timeoutMs?: number;
    maximumManaged?: number;
    creationDisabled?: boolean | (() => boolean);
    sandboxApi?: SandboxApi;
    fetchImpl?: typeof fetch;
  }) {
    this.hopSigningKey = Buffer.from(options.hopSigningKey);
    if (this.hopSigningKey.length < 32) throw new Error("vercel_sandbox_hop_signing_key_too_short");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 60_000 || this.timeoutMs > 15 * 60_000) {
      throw new Error("vercel_sandbox_timeout_out_of_bounds");
    }
    this.maximumManaged = options.maximumManaged ?? 5;
    if (!Number.isSafeInteger(this.maximumManaged) || this.maximumManaged < 1 || this.maximumManaged > 5) {
      throw new Error("vercel_sandbox_concurrency_limit_out_of_bounds");
    }
    this.creationDisabled = typeof options.creationDisabled === "function"
      ? options.creationDisabled : () => options.creationDisabled === true;
    this.api = options.sandboxApi ?? (Sandbox as unknown as SandboxApi);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private hopSecret(context: RuntimeBackendContext): string {
    return createHmac("sha256", this.hopSigningKey)
      .update([context.instanceId, context.buildFingerprint, context.generationVersion, context.runtimeVersion].join("|"))
      .digest("base64url");
  }

  private graderSecret(context: RuntimeBackendContext): string {
    return createHmac("sha256", this.hopSigningKey)
      .update(["trusted-grader", context.instanceId, context.buildFingerprint,
        context.generationVersion, context.runtimeVersion].join("|"))
      .digest("base64url");
  }

  private async rawManaged(): Promise<SandboxListItem[]> {
    return (await this.api.list({ limit: 50, tags: { [MANAGED_TAG]: MANAGED_VALUE } })).toArray();
  }

  private async observations(): Promise<VercelManagedObservation[]> {
    return (await this.rawManaged()).map(identity).filter((item): item is VercelManagedObservation => item !== null);
  }

  private async getExact(observation: VercelManagedObservation): Promise<SandboxHandle | null> {
    try {
      const sandbox = await this.api.get({ name: observation.sandboxName });
      const tags = sandbox.tags ?? {};
      if (!constantTimeSame(tags[INSTANCE_TAG], observation.instanceId) ||
          !constantTimeSame(tags[BUILD_TAG], observation.buildFingerprint) ||
          !constantTimeSame(tags[GENERATION_TAG], String(observation.generationVersion)) ||
          !constantTimeSame(tags[RUNTIME_TAG], observation.runtimeVersion) ||
          !constantTimeSame(tags[MANAGED_TAG], MANAGED_VALUE)) return null;
      return sandbox;
    } catch {
      return null;
    }
  }

  private metadata(reference: string, sandbox: SandboxHandle): VercelSandboxProviderMetadata {
    return {
      reference, sandboxName: sandbox.name, region: sandbox.region, status: sandbox.status,
      persistent: sandbox.persistent, networkPolicy: "deny-all", vcpus: sandbox.vcpus ?? null,
      memoryMb: sandbox.memory ?? null, image: sandbox.image ?? null, rawOrigin: sandbox.domain(VERCEL_SANDBOX_PORT),
      createdAt: sandbox.createdAt.getTime(), expiresAt: sandbox.expiresAt?.getTime() ?? null,
      totalDurationMs: sandbox.totalDurationMs ?? null,
      totalActiveCpuDurationMs: sandbox.totalActiveCpuDurationMs ?? sandbox.activeCpuUsageMs ?? null,
      ingressBytes: sandbox.totalIngressBytes ?? sandbox.networkTransfer?.ingress ?? null,
      egressBytes: sandbox.totalEgressBytes ?? sandbox.networkTransfer?.egress ?? null,
    };
  }

  private async remove(observation: VercelManagedObservation): Promise<void> {
    const sandbox = await this.getExact(observation);
    if (!sandbox) return;
    try {
      if (["pending", "running", "snapshotting"].includes(sandbox.status)) await sandbox.stop();
    } finally {
      this.deletedMetrics.set(observation.reference, this.metadata(observation.reference, sandbox));
      await sandbox.delete({ deleteOrphanSnapshots: true });
    }
  }

  private async provision(spec: WebLabSpec, context: RuntimeBackendContext, enforceAdmission: boolean): Promise<void> {
    if (enforceAdmission && this.creationDisabled()) throw new Error("vercel_sandbox_creation_disabled");
    if (context.generationVersion > 4) throw new Error("vercel_sandbox_reset_limit_exceeded");
    const compiled = compileWebLab(spec);
    if (compiled.manifest.canonicalSpecSha256 !== context.buildFingerprint) throw new Error("managed_runtime_build_mismatch");
    const existing = (await this.observations()).filter(item => item.instanceId === context.instanceId);
    const exact = existing.find(item => sameIdentity(item, context));
    if (exact?.state === "ready") return;
    if (existing.length) throw new Error("managed_runtime_already_exists");
    if (enforceAdmission && (await this.observations()).filter(item => item.state !== "failed").length >= this.maximumManaged) {
      throw new Error("vercel_sandbox_global_limit");
    }

    let sandbox: SandboxHandle | null = null;
    try {
      sandbox = await this.api.create({
        name: safeSandboxName(context), image: "vercel/sandbox/node:24", ports: [VERCEL_SANDBOX_PORT],
        timeout: this.timeoutMs, resources: { vcpus: 1 }, networkPolicy: "deny-all",
        tags: tagsFor(context), region: VERCEL_SANDBOX_REGION, persistent: false,
      });
      if (sandbox.persistent !== false || sandbox.region !== VERCEL_SANDBOX_REGION || sandbox.vcpus !== 1 ||
          sandbox.memory !== 2048 || !denyAll(sandbox.networkPolicy)) throw new Error("vercel_sandbox_security_profile_mismatch");
      if (!/^\/[A-Za-z0-9/_-]+$/.test(sandbox.cwd)) throw new Error("vercel_sandbox_working_directory_invalid");
      const bundleRoot = `${sandbox.cwd.replace(/\/$/, "")}/${BUNDLE_DIRECTORY}`;
      await sandbox.mkDir(bundleRoot);
      await sandbox.writeFiles(buildVercelRuntimeBundle(spec).map(file => ({
        path: `${bundleRoot}/${file.path}`, content: file.content, ...(file.mode ? { mode: file.mode } : {}),
      })));
      await sandbox.runCommand({
        cmd: "node", args: ["challenge-server.cjs"], cwd: bundleRoot,
        detached: true, timeoutMs: this.timeoutMs,
      });
      await sandbox.runCommand({
        cmd: "node", args: ["ingress-shim.cjs"], cwd: bundleRoot,
        env: { AMNIORA_HOP_SECRET: this.hopSecret(context),
          AMNIORA_GRADER_SECRET: this.graderSecret(context) },
        detached: true, timeoutMs: this.timeoutMs,
      });
      const origin = sandbox.domain(VERCEL_SANDBOX_PORT);
      for (let attempt = 0; attempt < 80; attempt++) {
        try {
          const response = await this.fetchImpl(`${origin}/__runtime/health`, {
            headers: { "X-Web-Lab-Proxy-Key": this.hopSecret(context) }, signal: AbortSignal.timeout(2_000),
          });
          if (response.ok) return;
        } catch { /* runtime is still starting */ }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error("vercel_sandbox_runtime_not_ready");
    } catch (error) {
      if (sandbox) {
        try { await sandbox.delete({ deleteOrphanSnapshots: true }); } catch { /* original failure remains authoritative */ }
      }
      throw error;
    }
  }

  async create(spec: WebLabSpec, context?: RuntimeBackendContext): Promise<string> {
    if (!validContext(context)) throw new Error("managed_runtime_context_required");
    await this.provision(spec, context, true);
    return context.instanceId;
  }

  async status(reference: string, context?: RuntimeBackendContext): Promise<"ready" | "expired" | "failed" | "destroyed"> {
    if (!validContext(context) || reference !== context.instanceId) return "failed";
    const inspected = await this.inspect(reference, context);
    if (inspected.state === "ready") return "ready";
    if (inspected.state === "missing") return "destroyed";
    return "failed";
  }

  async reset(reference: string, context?: RuntimeBackendContext, spec?: WebLabSpec): Promise<void> {
    if (!validContext(context) || reference !== context.instanceId || !spec) throw new Error("managed_runtime_reset_context_required");
    const observations = (await this.observations()).filter(item => item.instanceId === context.instanceId);
    const exact = observations.find(item => sameIdentity(item, context));
    if (exact?.state === "ready") return;
    const previous = observations.find(item => item.buildFingerprint === context.buildFingerprint &&
      item.runtimeVersion === context.runtimeVersion && item.generationVersion === context.generationVersion - 1);
    if (!previous) throw new Error("managed_runtime_identity_mismatch");
    for (const item of observations) await this.remove(item);
    await this.provision(spec, context, false);
  }

  async destroy(reference: string, context?: RuntimeBackendContext): Promise<void> {
    for (const item of (await this.observations()).filter(candidate => candidate.reference === reference)) {
      if (context && (item.instanceId !== context.instanceId || item.buildFingerprint !== context.buildFingerprint ||
          item.runtimeVersion !== context.runtimeVersion)) continue;
      await this.remove(item);
    }
  }

  async inspect(reference: string, expected: RuntimeBackendContext): Promise<RuntimeInspection> {
    const found = (await this.observations()).filter(item => item.reference === reference);
    if (!found.length) return { state: "missing", observation: null };
    const exact = found.find(item => sameIdentity(item, expected));
    if (!exact) return { state: "mismatch", observation: found[0] };
    return { state: exact.state === "ready" ? "ready" : "failed", observation: exact };
  }

  async listManaged(): Promise<readonly ManagedRuntimeObservation[]> {
    return this.observations();
  }

  async destroyManaged(observation: ManagedRuntimeObservation): Promise<void> {
    const candidate = observation as VercelManagedObservation;
    if (!candidate.sandboxName || candidate.runtimeVersion !== VERCEL_SANDBOX_RUNTIME_VERSION) {
      throw new Error("invalid_managed_sandbox_observation");
    }
    await this.remove(candidate);
  }

  async resolveBackend(reference: string, expected?: RuntimeBackendResolutionContext): Promise<{
    kind: "vercel-sandbox";
    origin: string;
    proxyKey: string;
    metadata: VercelSandboxProviderMetadata;
  } | null> {
    const found = (await this.observations()).filter(item => item.reference === reference && item.state === "ready");
    const observation = expected ? found.find(item => sameResolution(item, expected)) : found.sort((a, b) => b.generationVersion - a.generationVersion)[0];
    if (!observation) return null;
    const sandbox = await this.getExact(observation);
    if (!sandbox || sandbox.status !== "running" || !denyAll(sandbox.networkPolicy)) return null;
    const context: RuntimeBackendContext = {
      instanceId: observation.instanceId, buildFingerprint: observation.buildFingerprint,
      generationVersion: observation.generationVersion, runtimeVersion: observation.runtimeVersion,
    };
    return {
      kind: "vercel-sandbox", origin: sandbox.domain(VERCEL_SANDBOX_PORT),
      proxyKey: this.hopSecret(context), metadata: this.metadata(reference, sandbox),
    };
  }

  /** Trusted grader only. Never serialize these headers into a learner response. */
  async resolveTrustedGradeTarget(reference: string, expected: RuntimeBackendContext): Promise<{
    kind: "vercel-sandbox";
    origin: string;
    requestHeaders: Readonly<Record<string, string>>;
  } | null> {
    if (!validContext(expected) || reference !== expected.instanceId) return null;
    const target = await this.resolveBackend(reference, expected);
    if (!target) return null;
    return {
      kind: "vercel-sandbox",
      origin: target.origin,
      requestHeaders: Object.freeze({
        "X-Web-Lab-Proxy-Key": target.proxyKey,
        "X-Web-Lab-Grader-Key": this.graderSecret(expected),
      }),
    };
  }

  async providerMetadata(reference: string, expected?: RuntimeBackendResolutionContext): Promise<VercelSandboxProviderMetadata | null> {
    return (await this.resolveBackend(reference, expected))?.metadata ?? this.deletedMetrics.get(reference) ?? null;
  }

  async outboundTcp443Blocked(reference: string, expected: RuntimeBackendContext): Promise<boolean> {
    const found = (await this.observations()).find(item => item.reference === reference && sameIdentity(item, expected));
    if (!found) throw new Error("managed_runtime_unavailable");
    const sandbox = await this.getExact(found);
    if (!sandbox) throw new Error("managed_runtime_unavailable");
    const source = "const net=require('node:net');const s=net.connect({host:'1.1.1.1',port:443});" +
      "const done=c=>{s.destroy();process.exit(c)};s.setTimeout(2500,()=>done(0));s.on('error',()=>done(0));s.on('connect',()=>done(2));";
    const result = await sandbox.runCommand({ cmd: "node", args: ["-e", source], timeoutMs: 5_000 });
    return result.exitCode === 0;
  }

  async observeNetworkContainment(reference: string,
    expected: RuntimeBackendContext): Promise<VercelSandboxContainmentObservation> {
    const found = (await this.observations()).find(item => item.reference === reference && sameIdentity(item, expected));
    if (!found) throw new Error("managed_runtime_unavailable");
    const sandbox = await this.getExact(found);
    if (!sandbox) throw new Error("managed_runtime_unavailable");
    const probe = async (source: string) => (await sandbox.runCommand({
      cmd: "node", args: ["-e", source], timeoutMs: 5_000,
    })).exitCode === 0;
    const tcpProbe = (host: string, port: number) =>
      "const n=require('node:net');const s=n.connect({host:" + JSON.stringify(host) + ",port:" + port + "});" +
      "const done=c=>{s.destroy();process.exit(c)};s.setTimeout(2500,()=>done(0));" +
      "s.on('error',()=>done(0));s.on('connect',()=>done(2));";
    const dnsProbe = "require('node:dns').lookup('example.com',e=>process.exit(e?0:2));";
    return {
      networkPolicyDenyAll: denyAll(sandbox.networkPolicy),
      dnsBlocked: await probe(dnsProbe),
      directIpBlocked: await probe(tcpProbe("93.184.216.34", 80)),
      arbitraryPublicTcpBlocked: await probe(tcpProbe("1.1.1.1", 443)),
    };
  }
}
