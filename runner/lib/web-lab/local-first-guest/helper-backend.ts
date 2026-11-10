import type { LocalRunnerPackage } from "../local-runner/package";
import type {
  BackendReadyRuntime,
  DockerDoctorResult,
  LocalRunnerRuntimeBackend,
  LocalRuntimeIdentity,
  ManagedDockerResource,
} from "../local-runner/docker-backend";
import { LocalRunnerError } from "../local-runner/protocol";
import { GUEST_VM_ADDRESS } from "./protocol";
import { RuntimeHelperClient } from "./runtime-helper-transport";
import {
  helperIdentityForPackage,
  sameHelperRuntime,
  type HelperRuntimeIdentity,
  type HelperRuntimeStatus,
} from "./runtime-helper-protocol";

function localIdentity(runtime: HelperRuntimeIdentity): LocalRuntimeIdentity {
  return { sessionId: runtime.runtimeId, buildFingerprint: runtime.buildFingerprint, generation: runtime.generation };
}

function matchesLocal(runtime: HelperRuntimeIdentity, identity: LocalRuntimeIdentity): boolean {
  return runtime.runtimeId === identity.sessionId && runtime.buildFingerprint === identity.buildFingerprint &&
    runtime.generation === identity.generation;
}

function readyRuntime(status: HelperRuntimeStatus): BackendReadyRuntime {
  if (!status.ready || !status.runtime || !status.endpoint || !status.endpoint.startsWith(`http://${GUEST_VM_ADDRESS}:`) &&
      !status.endpoint.startsWith("http://127.0.0.1:")) throw new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500);
  return { ...localIdentity(status.runtime), endpoint: status.endpoint, bundleDir: "helper-managed" };
}

export class PrivilegedHelperBackend implements LocalRunnerRuntimeBackend {
  constructor(private readonly client: RuntimeHelperClient = new RuntimeHelperClient()) {}

  private async current(): Promise<HelperRuntimeStatus> {
    try { return await this.client.request("RUNTIME_STATUS", { runtime: null }); }
    catch { throw new LocalRunnerError("DOCKER_DAEMON_UNAVAILABLE"); }
  }

  private async resolve(identity: LocalRuntimeIdentity): Promise<HelperRuntimeIdentity> {
    const status = await this.current();
    if (!status.runtime || !matchesLocal(status.runtime, identity)) throw new LocalRunnerError("LOCAL_RUNTIME_NOT_FOUND");
    return status.runtime;
  }

  async doctor(): Promise<DockerDoctorResult> {
    try {
      await this.current();
      return { commandAvailable: true, daemonReachable: true, serverVersion: "privileged-helper-v1", outcome: "RUNNER_READY" };
    } catch {
      return { commandAvailable: true, daemonReachable: false, serverVersion: null, outcome: "DOCKER_DAEMON_UNAVAILABLE" };
    }
  }

  async create(pkg: LocalRunnerPackage, identity: LocalRuntimeIdentity): Promise<BackendReadyRuntime> {
    const runtime = helperIdentityForPackage(identity.sessionId, identity.generation, pkg);
    try {
      await this.client.request("PREPARE_RUNTIME", { runtime, package: pkg });
      return readyRuntime(await this.client.request("LAUNCH_RUNTIME", { runtime, package: pkg }));
    } catch {
      throw new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500);
    }
  }

  async reset(pkg: LocalRunnerPackage, previous: LocalRuntimeIdentity, next: LocalRuntimeIdentity): Promise<BackendReadyRuntime> {
    const previousRuntime = await this.resolve(previous);
    const nextRuntime = helperIdentityForPackage(next.sessionId, next.generation, pkg);
    if (!sameHelperRuntime({ ...previousRuntime, generation: nextRuntime.generation }, nextRuntime)) {
      throw new LocalRunnerError("LOCAL_RUNTIME_NOT_FOUND");
    }
    try { return readyRuntime(await this.client.request("RESET_RUNTIME", { previous: previousRuntime, next: nextRuntime, package: pkg })); }
    catch { throw new LocalRunnerError("LOCAL_RUNTIME_START_FAILED", 500); }
  }

  async recover(identity: LocalRuntimeIdentity): Promise<BackendReadyRuntime | null> {
    const status = await this.current();
    if (!status.runtime || !matchesLocal(status.runtime, identity) || !status.ready) return null;
    return readyRuntime(status);
  }

  async stop(identity: LocalRuntimeIdentity): Promise<void> {
    const status = await this.current();
    if (!status.runtime) return;
    if (!matchesLocal(status.runtime, identity)) {
      if (status.resources.length === 0 && ["idle", "stopped", "failed"].includes(status.state)) return;
      throw new LocalRunnerError("LOCAL_RUNTIME_NOT_FOUND");
    }
    try { await this.client.request("STOP_RUNTIME", { runtime: status.runtime }); }
    catch { throw new LocalRunnerError("LOCAL_RUNTIME_INCONSISTENT", 500); }
  }

  async listManaged(): Promise<readonly ManagedDockerResource[]> {
    const status = await this.current();
    if (!status.runtime) return [];
    return status.resources.map((resource, index) => ({
      kind: resource.kind,
      id: `helper-resource-${index}`,
      role: resource.role,
      identity: localIdentity(status.runtime!),
      detail: {},
    }));
  }
}
