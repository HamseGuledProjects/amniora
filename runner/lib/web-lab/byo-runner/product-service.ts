import "server-only";
import type { MyVmEnrollment, MyVmOpen, MyVmRunner, MyVmSnapshot } from "./product-contract";
import { validToken } from "./protocol";
import {
  createMyVmInstallCommand,
  createMyVmUpdateCommand,
  MY_VM_UNINSTALL_COMMAND,
  validateMyVmInstallerRelease,
  type MyVmInstallerRelease,
} from "./installer-release";
import {
  EarlyAccessSecurityError,
  safeRequestFingerprint,
  type DistributedAbusePolicy,
  type WebLabAlertSink,
} from "../production-security-controls";

export type MyVmActor = Readonly<{ userId: string; sessionId: string }>;
export type TrustedRunnerRecord = MyVmRunner & Readonly<{ ownerId: string }>;

export class MyVmProductError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "LAB_NOT_FOUND" | "RUNNER_NOT_FOUND" |
    "RUNNER_OFFLINE" | "RUNNER_INCOMPATIBLE" | "RUNTIME_NOT_READY" | "UNAVAILABLE") {
    super(code); this.name = "MyVmProductError";
  }
}

export interface MyVmProductBackend {
  readonly production?: boolean;
  eligibility(ownerId: string, savedLabId: string): Promise<boolean>;
  list(ownerId: string, savedLabId: string): Promise<readonly TrustedRunnerRecord[]>;
  issueEnrollment(ownerId: string): Promise<{ token: string; expiresAt: number }>;
  launch(input: { ownerId: string; savedLabId: string; runnerKey: string; idempotencyKey: string }): Promise<void>;
  reset(input: { ownerId: string; savedLabId: string; runnerKey: string; idempotencyKey: string }): Promise<void>;
  stop(input: { ownerId: string; savedLabId: string; runnerKey: string; idempotencyKey: string }): Promise<void>;
  disconnect(input: { ownerId: string; savedLabId: string; runnerKey: string; idempotencyKey: string }): Promise<void>;
  open(input: { ownerId: string; savedLabId: string; runnerKey: string }): Promise<MyVmOpen>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{1,160}$/;

export class MyVmProductService {
  private readonly gatewayOrigin: string;
  private readonly installerRelease: MyVmInstallerRelease;
  constructor(private readonly backend: MyVmProductBackend, enrollmentEndpoint: string, gatewayOrigin: string,
    installerRelease: MyVmInstallerRelease, private readonly security?: Readonly<{
      abusePolicy: DistributedAbusePolicy; alerts: WebLabAlertSink;
    }>) {
    let endpoint: URL; let gateway: URL;
    const trustedRelease = validateMyVmInstallerRelease(installerRelease);
    try { endpoint = new URL(enrollmentEndpoint); gateway = new URL(gatewayOrigin); } catch { throw new Error("invalid_runner_product_origin"); }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("invalid_runner_enrollment_endpoint");
    }
    if (gateway.protocol !== "https:" || gateway.origin !== gatewayOrigin || gateway.pathname !== "/" || gateway.search || gateway.hash) {
      throw new Error("invalid_runner_gateway_origin");
    }
    if (endpoint.href !== new URL(trustedRelease.brokerEndpoint).href) throw new Error("runner_installer_endpoint_mismatch");
    this.gatewayOrigin = gateway.origin;
    this.installerRelease = trustedRelease;
  }

  private actor(actor: MyVmActor): void {
    if (!actor || !UUID.test(actor.userId) || !actor.sessionId) throw new MyVmProductError("INVALID_REQUEST");
  }
  private id(value: string): void { if (!UUID.test(value)) throw new MyVmProductError("LAB_NOT_FOUND"); }
  private key(value: string): void { if (!KEY.test(value)) throw new MyVmProductError("INVALID_REQUEST"); }

  private async backendCall<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code === "RUNNER_OFFLINE" || code === "RUNNER_NOT_CONNECTED" || code === "RUNNER_COMMAND_TIMEOUT") {
        try { await this.security?.alerts.notify({ code: "RUNNER_OFFLINE", stage: "runner",
          runtimeMode: "byo_runtime" }); } catch { /* Preserve the original fixed error. */ }
      }
      throw error;
    }
  }

  async snapshot(actor: MyVmActor, savedLabId: string): Promise<MyVmSnapshot> {
    this.actor(actor); this.id(savedLabId);
    const eligible = await this.backendCall(() => this.backend.eligibility(actor.userId, savedLabId));
    const distribution = {
      currentVersion: this.installerRelease.runnerVersion,
      minimumCompatibleVersion: this.installerRelease.minimumCompatibleVersion,
      protocolVersion: this.installerRelease.protocolVersion,
      updateCommand: createMyVmUpdateCommand(this.installerRelease),
      uninstallCommand: MY_VM_UNINSTALL_COMMAND,
    };
    if (!eligible) return { enabled: true, eligible: false, runners: [], distribution };
    const rows = await this.backendCall(() => this.backend.list(actor.userId, savedLabId));
    const runners = rows.filter(row => row.ownerId === actor.userId).map(row => ({
      runnerKey: row.runnerKey, displayName: row.displayName, platform: row.platform,
      architecture: row.architecture, version: row.version, state: row.state,
      lastSeenAt: row.lastSeenAt, dockerAvailable: row.dockerAvailable,
      labState: row.labState, generation: row.generation,
    }));
    return { enabled: true, eligible: true, runners, distribution };
  }

  async enroll(actor: MyVmActor, idempotencyKey?: string): Promise<MyVmEnrollment> {
    this.actor(actor);
    if (this.security) {
      if (!idempotencyKey || !KEY.test(idempotencyKey)) throw new MyVmProductError("INVALID_REQUEST");
      try {
        await this.security.abusePolicy.assertAllowed({ ownerId: actor.userId,
          surface: "my_vm_enrollment", idempotencyKey,
          requestFingerprint: safeRequestFingerprint({ audience: "amniora-byo-broker" }) });
      } catch (error) {
        if (error instanceof EarlyAccessSecurityError && error.code === "RATE_LIMITED") {
          try { await this.security.alerts.notify({ code: "ENROLLMENT_ISSUANCE_DENIED",
            stage: "runner", surface: "my_vm_enrollment", runtimeMode: "byo_runtime" }); }
          catch { /* Enrollment remains denied. */ }
          throw new MyVmProductError("UNAVAILABLE");
        }
        try { await this.security.alerts.notify({ code: "SECURITY_CONTROL_UNAVAILABLE",
          stage: "security_control", surface: "my_vm_enrollment", runtimeMode: "byo_runtime" }); }
        catch { /* Enrollment remains unavailable. */ }
        throw new MyVmProductError("UNAVAILABLE");
      }
    }
    const capability = await this.backendCall(() => this.backend.issueEnrollment(actor.userId));
    if (!validToken(capability.token) || !Number.isSafeInteger(capability.expiresAt) || capability.expiresAt <= Date.now()) {
      throw new MyVmProductError("UNAVAILABLE");
    }
    const command = createMyVmInstallCommand(this.installerRelease, actor.userId, capability.token);
    return { command, expiresAt: new Date(capability.expiresAt).toISOString() };
  }

  async mutate(actor: MyVmActor, operation: "launch" | "reset" | "stop" | "disconnect", input: {
    savedLabId: string; runnerKey: string; idempotencyKey: string;
  }): Promise<void> {
    this.actor(actor); this.id(input.savedLabId); this.key(input.runnerKey); this.key(input.idempotencyKey);
    const owned = (await this.backendCall(() => this.backend.list(actor.userId, input.savedLabId)))
      .some(row => row.ownerId === actor.userId && row.runnerKey === input.runnerKey);
    if (!owned) throw new MyVmProductError("RUNNER_NOT_FOUND");
    await this.backendCall(() => this.backend[operation]({ ownerId: actor.userId, ...input }));
  }

  async open(actor: MyVmActor, input: { savedLabId: string; runnerKey: string }): Promise<MyVmOpen> {
    this.actor(actor); this.id(input.savedLabId); this.key(input.runnerKey);
    const runner = (await this.backendCall(() => this.backend.list(actor.userId, input.savedLabId)))
      .find(row => row.ownerId === actor.userId && row.runnerKey === input.runnerKey);
    if (!runner) throw new MyVmProductError("RUNNER_NOT_FOUND");
    if (runner.state !== "connected" || runner.labState !== "ready") throw new MyVmProductError("RUNTIME_NOT_READY");
    const opened = await this.backendCall(() => this.backend.open({ ownerId: actor.userId, ...input }));
    if (opened.action !== `${this.gatewayOrigin}/__amniora/byo/launch` || !/^[A-Za-z0-9_-]{43}$/.test(opened.grant) ||
        !Number.isFinite(new Date(opened.expiresAt).getTime()) || new Date(opened.expiresAt).getTime() <= Date.now()) {
      throw new MyVmProductError("UNAVAILABLE");
    }
    return opened;
  }
}
