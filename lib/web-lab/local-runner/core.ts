import { randomUUID } from "node:crypto";
import type { LocalRunnerVerificationKeys } from "./package";
import { packageSupportsPlatform, verifyLocalRunnerPackage } from "./package";
import { LocalRunnerCapabilityStore } from "./capability";
import type { LocalRunnerRuntimeBackend, LocalRuntimeIdentity } from "./docker-backend";
import { DockerLocalRunnerBackend } from "./docker-backend";
import {
  hasExactKeys,
  isPlainObject,
  LOCAL_RUNNER_DEFAULT_TTL_MS,
  LOCAL_RUNNER_PROTOCOL_VERSION,
  LOCAL_RUNNER_RUNTIME_VERSION,
  LOCAL_RUNNER_VERSION,
  LocalRunnerError,
  protocolCompatibility,
  requireSafeRuntimeEndpoint,
  validFingerprint,
  validIdempotencyKey,
  validOpaqueId,
  type RunnerCapabilities,
  type RunnerCapabilityResponse,
  type RunnerCapabilityScope,
  type RunnerPublicStatus,
} from "./protocol";
import {
  EMPTY_LOCAL_RUNNER_STATE,
  LocalRunnerStateStore,
  type PersistedLocalRunnerState,
} from "./state-store";

const STATE_KEYS = [
  "stateVersion", "state", "sessionId", "buildId", "buildFingerprint", "generation", "endpoint", "createdAt",
  "expiresAt", "acceptedPackage", "launchIdempotencyKey", "lastReset", "lastStopIdempotencyKey", "errorCode",
] as const;

export type LocalRunnerCoreOptions = Readonly<{
  verificationKeys: LocalRunnerVerificationKeys;
  backend?: LocalRunnerRuntimeBackend;
  stateStore: LocalRunnerStateStore;
  capabilityStore?: LocalRunnerCapabilityStore;
  now?: () => number;
  ttlMs?: number;
  platform?: NodeJS.Platform;
  architecture?: string;
  supportedPlatforms?: readonly Readonly<{ platform: NodeJS.Platform; architecture: string }>[];
  recreateMissingRuntimeOnRecover?: boolean;
  runtimeEndpointHosts?: readonly string[];
}>;

function identity(state: PersistedLocalRunnerState): LocalRuntimeIdentity {
  if (!state.sessionId || !state.buildFingerprint || !state.generation) throw new LocalRunnerError("LOCAL_RUNTIME_INCONSISTENT", 500);
  return { sessionId: state.sessionId, buildFingerprint: state.buildFingerprint, generation: state.generation };
}

function validPersistedState(input: unknown): input is PersistedLocalRunnerState {
  if (!isPlainObject(input) || !hasExactKeys(input, STATE_KEYS) || input.stateVersion !== 1 ||
      !["idle", "starting", "ready", "resetting", "stopping", "failed", "expired"].includes(String(input.state))) return false;
  const nullableString = (value: unknown) => value === null || typeof value === "string";
  if (!nullableString(input.sessionId) || !nullableString(input.buildId) || !nullableString(input.buildFingerprint) ||
      !(input.generation === null || (Number.isSafeInteger(input.generation) && Number(input.generation) >= 1)) ||
      !nullableString(input.endpoint) || !(input.createdAt === null || Number.isSafeInteger(input.createdAt)) ||
      !(input.expiresAt === null || Number.isSafeInteger(input.expiresAt)) || !nullableString(input.launchIdempotencyKey) ||
      !nullableString(input.lastStopIdempotencyKey) || !nullableString(input.errorCode)) return false;
  if (input.lastReset !== null && (!isPlainObject(input.lastReset) ||
      !hasExactKeys(input.lastReset, ["idempotencyKey", "fromGeneration", "toGeneration"]) ||
      !validIdempotencyKey(input.lastReset.idempotencyKey) || !Number.isSafeInteger(input.lastReset.fromGeneration) ||
      !Number.isSafeInteger(input.lastReset.toGeneration))) return false;
  return input.acceptedPackage === null || isPlainObject(input.acceptedPackage);
}

export class LocalRunnerCore {
  private readonly backend: LocalRunnerRuntimeBackend;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly capabilityStore: LocalRunnerCapabilityStore;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly supportedPlatforms: readonly Readonly<{ platform: NodeJS.Platform; architecture: string }>[];
  private readonly recreateMissingRuntimeOnRecover: boolean;
  private readonly runtimeEndpointHosts: readonly string[];
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: LocalRunnerCoreOptions) {
    this.backend = options.backend ?? new DockerLocalRunnerBackend();
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? LOCAL_RUNNER_DEFAULT_TTL_MS;
    this.capabilityStore = options.capabilityStore ?? new LocalRunnerCapabilityStore(this.now);
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    this.supportedPlatforms = options.supportedPlatforms ?? [{ platform: "darwin", architecture: "arm64" }];
    this.recreateMissingRuntimeOnRecover = options.recreateMissingRuntimeOnRecover ?? false;
    this.runtimeEndpointHosts = options.runtimeEndpointHosts ?? ["127.0.0.1"];
    if (!this.supportedPlatforms.length || this.supportedPlatforms.some(candidate =>
      !candidate.platform || !candidate.architecture || Object.keys(candidate).length !== 2)) {
      throw new Error("invalid_local_runner_supported_platforms");
    }
    if (!this.runtimeEndpointHosts.length || this.runtimeEndpointHosts.some(host =>
      !/^(?:127\.0\.0\.1|192\.168\.63\.2)$/.test(host))) throw new Error("invalid_local_runner_endpoint_hosts");
  }

  private supportedPlatform(): boolean {
    return this.supportedPlatforms.some(candidate =>
      candidate.platform === this.platform && candidate.architecture === this.architecture);
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.operationQueue;
    let release!: () => void;
    this.operationQueue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }

  private async state(): Promise<PersistedLocalRunnerState> {
    const value = await this.options.stateStore.read();
    if (value === null) return EMPTY_LOCAL_RUNNER_STATE;
    if (!validPersistedState(value)) throw new LocalRunnerError("LOCAL_RUNTIME_INCONSISTENT", 500);
    return value;
  }

  private publicState(state: PersistedLocalRunnerState): RunnerPublicStatus {
    return {
      state: state.state,
      sessionId: state.sessionId,
      buildId: state.buildId,
      buildFingerprint: state.buildFingerprint,
      generation: state.generation,
      endpoint: state.state === "ready" && state.endpoint ? requireSafeRuntimeEndpoint(state.endpoint, this.runtimeEndpointHosts) : null,
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
      trustLevel: "local_self_hosted",
      ...(state.errorCode ? { errorCode: state.errorCode } : {}),
    };
  }

  async capabilities(requestedProtocolVersion?: string): Promise<RunnerCapabilities> {
    const testedPlatform = this.supportedPlatform();
    const docker = await this.backend.doctor();
    const state = await this.status();
    return {
      runnerVersion: LOCAL_RUNNER_VERSION,
      protocolVersion: LOCAL_RUNNER_PROTOCOL_VERSION,
      platform: this.platform,
      architecture: this.architecture,
      testedPlatform,
      docker: { commandAvailable: docker.commandAvailable, daemonReachable: docker.daemonReachable, serverVersion: docker.serverVersion },
      supportedRuntimeVersions: [LOCAL_RUNNER_RUNTIME_VERSION],
      activeLocalRuntimeState: state.state,
      protocolCompatibility: protocolCompatibility(requestedProtocolVersion),
      outcome: testedPlatform ? docker.outcome : "UNSUPPORTED_PLATFORM",
    };
  }

  authorize(scope: RunnerCapabilityScope): RunnerCapabilityResponse {
    if (scope.operation === "launch") {
      if (!validOpaqueId(scope.buildId) || !validFingerprint(scope.buildFingerprint) || !validIdempotencyKey(scope.idempotencyKey)) {
        throw new LocalRunnerError("CAPABILITY_INVALID");
      }
    } else if (!/^[0-9a-f]{32}$/.test(scope.sessionId) || !validFingerprint(scope.buildFingerprint) ||
        !Number.isSafeInteger(scope.generation) || scope.generation < 1 || !validIdempotencyKey(scope.idempotencyKey)) {
      throw new LocalRunnerError("CAPABILITY_INVALID");
    }
    return this.capabilityStore.issue(scope);
  }

  private async assertReadyEnvironment(): Promise<void> {
    if (!this.supportedPlatform()) throw new LocalRunnerError("UNSUPPORTED_PLATFORM");
    const doctor = await this.backend.doctor();
    if (!doctor.commandAvailable) throw new LocalRunnerError("DOCKER_UNAVAILABLE");
    if (!doctor.daemonReachable) throw new LocalRunnerError("DOCKER_DAEMON_UNAVAILABLE");
  }

  async launch(capability: unknown, packageInput: unknown): Promise<RunnerPublicStatus> {
    return this.exclusive(async () => {
      const scope = this.capabilityStore.consume(capability, "launch");
      if (scope.operation !== "launch") throw new LocalRunnerError("CAPABILITY_INVALID");
      const pkg = verifyLocalRunnerPackage(packageInput, this.options.verificationKeys, {
        now: this.now,
        expectedBuildId: scope.buildId,
        expectedBuildFingerprint: scope.buildFingerprint,
      });
      if (!packageSupportsPlatform(pkg, this.platform, this.architecture)) throw new LocalRunnerError("PACKAGE_PLATFORM_UNSUPPORTED");
      await this.assertReadyEnvironment();
      let current = await this.expireIfDue(await this.state());
      if (["starting", "ready", "resetting", "stopping"].includes(current.state)) {
        if (current.buildId === pkg.buildId && current.buildFingerprint === pkg.buildFingerprint &&
            current.launchIdempotencyKey === scope.idempotencyKey) return this.publicState(current);
        throw new LocalRunnerError("LOCAL_RUNTIME_ALREADY_ACTIVE");
      }
      const createdAt = this.now();
      const next: PersistedLocalRunnerState = {
        stateVersion: 1,
        state: "starting",
        sessionId: randomUUID().replaceAll("-", ""),
        buildId: pkg.buildId,
        buildFingerprint: pkg.buildFingerprint,
        generation: 1,
        endpoint: null,
        createdAt,
        expiresAt: createdAt + this.ttlMs,
        acceptedPackage: pkg,
        launchIdempotencyKey: scope.idempotencyKey,
        lastReset: null,
        lastStopIdempotencyKey: null,
        errorCode: null,
      };
      await this.options.stateStore.write(next);
      try {
        const runtime = await this.backend.create(pkg, identity(next));
        current = { ...next, state: "ready", endpoint: requireSafeRuntimeEndpoint(runtime.endpoint, this.runtimeEndpointHosts) };
        await this.options.stateStore.write(current);
        return this.publicState(current);
      } catch (error) {
        const code = error instanceof LocalRunnerError ? error.code : "LOCAL_RUNTIME_START_FAILED";
        current = { ...next, state: "failed", endpoint: null, errorCode: code };
        await this.options.stateStore.write(current);
        throw error instanceof LocalRunnerError ? error : new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500);
      }
    });
  }

  async status(): Promise<RunnerPublicStatus> {
    return this.exclusive(async () => {
      const current = await this.expireIfDue(await this.state());
      if (current.state === "ready") {
        const verified = await this.backend.recover(identity(current));
        if (!verified) return this.publicState({ ...current, state: "failed", endpoint: null,
          errorCode: "LOCAL_RUNTIME_INCONSISTENT" });
      }
      return this.publicState(current);
    });
  }

  async reset(capability: unknown): Promise<RunnerPublicStatus> {
    return this.exclusive(async () => {
      const scope = this.capabilityStore.consume(capability, "reset");
      if (scope.operation !== "reset") throw new LocalRunnerError("CAPABILITY_INVALID");
      let current = await this.expireIfDue(await this.state());
      if (current.lastReset?.idempotencyKey === scope.idempotencyKey && current.lastReset.fromGeneration === scope.generation &&
          current.sessionId === scope.sessionId && current.buildFingerprint === scope.buildFingerprint) return this.publicState(current);
      if (current.state !== "ready" || current.sessionId !== scope.sessionId || current.buildFingerprint !== scope.buildFingerprint ||
          current.generation !== scope.generation || !current.acceptedPackage) throw new LocalRunnerError("LOCAL_RUNTIME_NOT_FOUND");
      await this.assertReadyEnvironment();
      const pkg = verifyLocalRunnerPackage(current.acceptedPackage, this.options.verificationKeys, {
        now: this.now,
        expectedBuildId: current.buildId ?? undefined,
        expectedBuildFingerprint: current.buildFingerprint,
        allowExpired: true,
      });
      if (!packageSupportsPlatform(pkg, this.platform, this.architecture)) throw new LocalRunnerError("PACKAGE_PLATFORM_UNSUPPORTED");
      const previous = identity(current);
      const nextGeneration = current.generation + 1;
      current = {
        ...current,
        state: "resetting",
        endpoint: null,
        generation: nextGeneration,
        lastReset: { idempotencyKey: scope.idempotencyKey, fromGeneration: scope.generation, toGeneration: nextGeneration },
      };
      await this.options.stateStore.write(current);
      try {
        const nextIdentity = identity(current);
        const runtime = this.backend.reset
          ? await this.backend.reset(pkg, previous, nextIdentity)
          : (await this.backend.stop(previous), await this.backend.create(pkg, nextIdentity));
        current = { ...current, state: "ready", endpoint: requireSafeRuntimeEndpoint(runtime.endpoint, this.runtimeEndpointHosts), errorCode: null };
        await this.options.stateStore.write(current);
        return this.publicState(current);
      } catch (error) {
        current = { ...current, state: "failed", endpoint: null, errorCode: "LOCAL_RUNTIME_START_FAILED" };
        await this.options.stateStore.write(current);
        throw error instanceof LocalRunnerError ? error : new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500);
      }
    });
  }

  async stop(capability: unknown): Promise<RunnerPublicStatus> {
    return this.exclusive(async () => {
      const scope = this.capabilityStore.consume(capability, "stop");
      if (scope.operation !== "stop") throw new LocalRunnerError("CAPABILITY_INVALID");
      let current = await this.state();
      if (current.state === "idle" && current.sessionId === scope.sessionId && current.buildFingerprint === scope.buildFingerprint &&
          current.lastStopIdempotencyKey === scope.idempotencyKey) return this.publicState(current);
      if (!current.sessionId || !current.buildFingerprint || !current.generation || current.sessionId !== scope.sessionId ||
          current.buildFingerprint !== scope.buildFingerprint || current.generation !== scope.generation) {
        throw new LocalRunnerError("LOCAL_RUNTIME_NOT_FOUND");
      }
      const runtimeIdentity = identity(current);
      current = { ...current, state: "stopping", endpoint: null, lastStopIdempotencyKey: scope.idempotencyKey };
      await this.options.stateStore.write(current);
      try {
        await this.backend.stop(runtimeIdentity);
        current = { ...current, state: "idle", acceptedPackage: null, endpoint: null, errorCode: null };
        await this.options.stateStore.write(current);
        return this.publicState(current);
      } catch (error) {
        current = { ...current, state: "failed", endpoint: null, errorCode: "LOCAL_RUNTIME_INCONSISTENT" };
        await this.options.stateStore.write(current);
        throw error instanceof LocalRunnerError ? error : new LocalRunnerError("LOCAL_RUNTIME_INCONSISTENT", 500);
      }
    });
  }

  async recover(): Promise<RunnerPublicStatus> {
    return this.exclusive(async () => {
      let current = await this.state();
      if (current.state === "idle" || current.state === "expired") return this.publicState(current);
      if (!current.acceptedPackage) throw new LocalRunnerError("LOCAL_RUNTIME_INCONSISTENT", 500);
      const acceptedPackage = current.acceptedPackage;
      try {
        verifyLocalRunnerPackage(acceptedPackage, this.options.verificationKeys, {
          now: this.now,
          expectedBuildId: current.buildId ?? undefined,
          expectedBuildFingerprint: current.buildFingerprint ?? undefined,
          allowExpired: true,
        });
      } catch {
        if (current.sessionId && current.buildFingerprint && current.generation) await this.backend.stop(identity(current));
        current = { ...current, state: "failed", endpoint: null, acceptedPackage: null, errorCode: "PACKAGE_SIGNATURE_INVALID" };
        await this.options.stateStore.write(current);
        return this.publicState(current);
      }
      current = await this.expireIfDue(current);
      if (current.state === "expired") return this.publicState(current);
      const recovered = await this.backend.recover(identity(current));
      if (recovered) {
        current = { ...current, state: "ready", endpoint: requireSafeRuntimeEndpoint(recovered.endpoint, this.runtimeEndpointHosts), errorCode: null };
        await this.options.stateStore.write(current);
        return this.publicState(current);
      }
      if (this.recreateMissingRuntimeOnRecover) {
        await this.assertReadyEnvironment();
        await this.backend.stop(identity(current));
        if (current.state === "resetting" && current.generation && current.generation > 1) {
          await this.backend.stop({ ...identity(current), generation: current.generation - 1 });
        }
        try {
          const recreated = await this.backend.create(acceptedPackage, identity(current));
          current = { ...current, state: "ready", endpoint: requireSafeRuntimeEndpoint(recreated.endpoint, this.runtimeEndpointHosts), errorCode: null };
          await this.options.stateStore.write(current);
          return this.publicState(current);
        } catch (error) {
          current = { ...current, state: "failed", endpoint: null, errorCode: "LOCAL_RUNTIME_START_FAILED" };
          await this.options.stateStore.write(current);
          throw error instanceof LocalRunnerError ? error : new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500);
        }
      }
      await this.backend.stop(identity(current));
      if (current.state === "resetting" && current.generation && current.generation > 1) {
        await this.backend.stop({ ...identity(current), generation: current.generation - 1 });
      }
      current = { ...current, state: "failed", endpoint: null, acceptedPackage: null, errorCode: "LOCAL_RUNTIME_INCONSISTENT" };
      await this.options.stateStore.write(current);
      return this.publicState(current);
    });
  }

  async reconcileOrphans(): Promise<number> {
    return this.exclusive(async () => {
      const current = await this.state();
      const active = current.sessionId && current.buildFingerprint && current.generation ? identity(current) : null;
      const resources = await this.backend.listManaged();
      const unique = new Map<string, LocalRuntimeIdentity>();
      for (const resource of resources) {
        const key = `${resource.identity.sessionId}:${resource.identity.buildFingerprint}:${resource.identity.generation}`;
        if (!active || key !== `${active.sessionId}:${active.buildFingerprint}:${active.generation}`) unique.set(key, resource.identity);
      }
      for (const orphan of unique.values()) await this.backend.stop(orphan);
      return unique.size;
    });
  }

  private async expireIfDue(current: PersistedLocalRunnerState): Promise<PersistedLocalRunnerState> {
    if (current.state !== "ready" || !current.expiresAt || this.now() < current.expiresAt) return current;
    await this.backend.stop(identity(current));
    const expired: PersistedLocalRunnerState = {
      ...current,
      state: "expired",
      endpoint: null,
      acceptedPackage: null,
      errorCode: "LOCAL_RUNTIME_EXPIRED",
    };
    await this.options.stateStore.write(expired);
    return expired;
  }
}
