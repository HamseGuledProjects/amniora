/** Phase 13 server-side orchestration core. Never import this module from a client component. */
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RuntimeBackendContext } from "./control-plane";
import type { ReconciliableRuntimeBackend, ManagedRuntimeObservation } from "./durable-control-plane";
import { WEB_LAB_COMPILER_VERSION, WebLabPersistenceError } from "./postgres-control-repository";
import type {
  CommandLease, InternalRuntimeState, OwnedHostedRuntimeStatus, PostgresWebLabControlRepository,
  RuntimeMode, SafeBuildMetadata, SafeRuntimeStatus,
} from "./postgres-control-repository";
import { LOCAL_RUNNER_RUNTIME_VERSION } from "./local-runner/protocol";
import type { WebLabSpec } from "./schema";
import type { EarlyAccessSecurityEvent, WebLabAlertSink } from "./production-security-controls";

export type AuthenticatedWebLabActor = Readonly<{ userId: string; sessionId: string }>;
export type CompatibilityVerdict = "SUPPORTED" | "MIGRATABLE" | "LEGACY_READ_ONLY" | "UNSUPPORTED";
export type WebLabControlErrorCode =
  | "UNAUTHENTICATED" | "INVALID_REQUEST" | "LAB_NOT_FOUND" | "LAB_INCOMPATIBLE"
  | "HOSTED_PLAN_REQUIRED" | "HOSTED_CAPACITY_FULL" | "HOSTED_DISABLED"
  | "HOSTED_BUDGET_RESTRICTED" | "HOSTED_BUDGET_EXCEEDED" |
    "HOSTED_QUOTA_EXCEEDED" | "RUNTIME_ALREADY_ACTIVE"
  | "RUNTIME_PROVISIONING_FAILED" | "RUNTIME_EXPIRED" | "RUNTIME_NOT_FOUND"
  | "RUNTIME_NOT_READY" | "RESET_LIMIT_EXCEEDED" | "GRADE_RATE_LIMITED"
  | "GRADE_IN_PROGRESS" | "GRADE_UNAVAILABLE"
  | "INVALID_LAUNCH_GRANT" | "LAUNCH_GRANT_EXPIRED" | "LAUNCH_GRANT_REPLAYED"
  | "RUNNER_UNAVAILABLE" | "STALE_RUNTIME_VERSION" | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMITED" | "INTERNAL_ERROR" | "CSRF_REJECTED";

export class WebLabControlError extends Error {
  constructor(readonly code: WebLabControlErrorCode, readonly compatibility?: CompatibilityVerdict) {
    super(code);
  }
}

export type LearnerRuntimeDto = Readonly<{
  instanceId: string;
  buildId: string;
  mode: RuntimeMode;
  status: SafeRuntimeStatus["status"];
  createdAt: string;
  expiresAt: string;
  generationVersion: number;
  remainingResets: number;
  availableActions: readonly ("open" | "reset" | "destroy" | "grade")[];
  launchGrant?: Readonly<{ token: string; expiresAt: string }>;
}>;

export type GatewaySessionDto = Readonly<{
  token: string;
  instanceId: string;
  expiresAt: string;
}>;

export type TrustedGatewayTarget = Readonly<{
  instanceId: string;
  ownerId: string;
  backendReference: string;
  context: RuntimeBackendContext;
  expiresAt: string;
}>;

type Repo = Pick<PostgresWebLabControlRepository,
  "getBuildMetadata" | "getBuildMetadataById" | "getTrustedBuild" | "admitHosted" | "getRuntimeForOwner" |
  "getLatestHostedRuntimeForSavedLab" | "getActiveHostedRuntimeForOwner" | "hasAvailableHostedSlot" |
  "getRuntimeControl" | "getRuntimeForReconciliation" | "getHostedBudgetPolicy" |
  "claimCommandById" | "findPendingCommand" | "transitionRuntime" | "markRuntimeObservedReady" |
  "requestReset" | "requestDestroy" | "releaseAdmissionAfterProviderAbsence" |
  "requestGrade" | "completeCommand" | "recordGradeCommand" |
  "recordUsage" | "appendAudit" |
  "listReconciliationCandidates" | "consumeLaunchGrant">;

export type HostedLaunchAvailability = "available" | "plan_required" | "capacity_full" |
  "active_elsewhere" | "budget_unavailable" | "service_disabled" | "unavailable";

/** Server-only product state. CloudProductService removes logical identifiers before serialization. */
export type HostedProductState = Readonly<{
  plan: "free" | "pro";
  eligible: boolean;
  availability: HostedLaunchAvailability;
  runtime: LearnerRuntimeDto | null;
}>;

export interface WebLabEntitlementPolicy {
  readonly production?: boolean;
  planFor(actor: AuthenticatedWebLabActor): Promise<"free" | "pro">;
}

export interface WebLabRatePolicy {
  readonly production?: boolean;
  assertAllowed(actor: AuthenticatedWebLabActor, operation: "launch" | "reset" | "grade" | "exchange",
    mode: RuntimeMode, idempotencyKey: string): Promise<void>;
}

export interface WebLabCompatibilityPolicy {
  verdict(build: SafeBuildMetadata, mode: RuntimeMode, runtimeVersion: string): CompatibilityVerdict;
}

export interface WebLabTrustedGrader {
  readonly production?: boolean;
  grade(input: { spec: WebLabSpec; runtime: InternalRuntimeState;
    backend: ReconciliableRuntimeBackend; context: RuntimeBackendContext }): Promise<{
    outcome: "pass" | "not_complete" | "error";
    observationFingerprint?: string;
    graderVersion: string;
  }>;
}

export type RuntimeBackendRegistration = Readonly<{
  production?: boolean;
  mode: RuntimeMode;
  providerKind: string;
  runtimeVersion: string;
  backend: ReconciliableRuntimeBackend;
}>;

export class ExactWebLabCompatibilityPolicy implements WebLabCompatibilityPolicy {
  verdict(build: SafeBuildMetadata, _mode: RuntimeMode, runtimeVersion: string): CompatibilityVerdict {
    if (build.compilerVersion !== WEB_LAB_COMPILER_VERSION) return "LEGACY_READ_ONLY";
    if (build.runtimeVersion !== runtimeVersion) return "LEGACY_READ_ONLY";
    return "SUPPORTED";
  }
}

/**
 * Phase 15C persists the executable bundle ABI used by Local Runner. Hosted
 * backends have their own provider implementation version, but consume that
 * same immutable compiler output. Keep this cross-runtime allowance explicit
 * so an arbitrary or retired runtime version can never become compatible by
 * accident.
 */
export class GeneratedExecutableHostedCompatibilityPolicy implements WebLabCompatibilityPolicy {
  constructor(private readonly hostedRuntimeVersion: string) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(hostedRuntimeVersion)) {
      throw new Error("invalid_hosted_runtime_version");
    }
  }

  verdict(build: SafeBuildMetadata, mode: RuntimeMode, runtimeVersion: string): CompatibilityVerdict {
    if (build.compilerVersion !== WEB_LAB_COMPILER_VERSION) return "LEGACY_READ_ONLY";
    if (mode !== "amniora_hosted" || runtimeVersion !== this.hostedRuntimeVersion ||
        build.runtimeVersion !== LOCAL_RUNNER_RUNTIME_VERSION) return "LEGACY_READ_ONLY";
    return "SUPPORTED";
  }
}

type TokenClaims = Readonly<{
  audience: "web-lab-launch" | "web-lab-gateway-session";
  grantId: string;
  instanceId: string;
  ownerId: string;
  sessionId: string;
  generationVersion: number;
  expiresAt: number;
}>;

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function context(runtime: InternalRuntimeState, buildFingerprint: string): RuntimeBackendContext {
  return { instanceId: runtime.instanceId, buildFingerprint,
    generationVersion: runtime.generationVersion, runtimeVersion: runtime.runtimeVersion };
}

function normalize(error: unknown): WebLabControlError {
  if (error instanceof WebLabControlError) return error;
  if (error instanceof WebLabPersistenceError) {
    const allowed: readonly WebLabControlErrorCode[] = ["LAB_NOT_FOUND", "LAB_INCOMPATIBLE",
      "HOSTED_CAPACITY_FULL", "HOSTED_DISABLED", "HOSTED_BUDGET_RESTRICTED",
      "HOSTED_BUDGET_EXCEEDED",
      "RUNTIME_ALREADY_ACTIVE", "RUNTIME_NOT_FOUND", "RUNTIME_NOT_READY",
      "RESET_LIMIT_EXCEEDED", "STALE_RUNTIME_VERSION", "IDEMPOTENCY_CONFLICT"];
    return new WebLabControlError(allowed.includes(error.code as WebLabControlErrorCode)
      ? error.code as WebLabControlErrorCode : "INTERNAL_ERROR");
  }
  return new WebLabControlError("INTERNAL_ERROR");
}

function trustedGradeResult(value: unknown): value is Awaited<ReturnType<WebLabTrustedGrader["grade"]>> {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<Awaited<ReturnType<WebLabTrustedGrader["grade"]>>>;
  return ["pass", "not_complete", "error"].includes(result.outcome ?? "") &&
    typeof result.graderVersion === "string" &&
    /^[a-z0-9][a-z0-9._-]{0,79}$/.test(result.graderVersion) &&
    ((result.outcome === "pass" && /^[0-9a-f]{64}$/.test(result.observationFingerprint ?? "")) ||
      (result.outcome !== "pass" && result.observationFingerprint === undefined));
}

export class WebLabControlPlaneService {
  private readonly backends: Map<RuntimeMode, RuntimeBackendRegistration>;
  private readonly now: () => number;
  private readonly signingKey: Buffer;
  private readonly resetLimit: number;
  private readonly ttlMinutes: number;
  private readonly reservedCostGbpPence: number;
  private readonly grantMs: number;
  private readonly gatewaySessionMs: number;

  constructor(private readonly dependencies: {
    repository: Repo;
    entitlement: WebLabEntitlementPolicy;
    ratePolicy: WebLabRatePolicy;
    compatibility: WebLabCompatibilityPolicy;
    grader: WebLabTrustedGrader;
    backends: readonly RuntimeBackendRegistration[];
    alerts?: WebLabAlertSink;
    signingKey: Buffer;
    now?: () => number;
    resetLimit?: number;
    ttlMinutes?: number;
    reservedCostGbpPence?: number;
    grantMs?: number;
    gatewaySessionMs?: number;
  }) {
    if (dependencies.signingKey.length < 32) throw new Error("launch_signing_key_too_short");
    this.signingKey = dependencies.signingKey;
    this.now = dependencies.now ?? Date.now;
    this.resetLimit = dependencies.resetLimit ?? 3;
    this.ttlMinutes = dependencies.ttlMinutes ?? 30;
    this.reservedCostGbpPence = dependencies.reservedCostGbpPence ?? 100;
    this.grantMs = dependencies.grantMs ?? 30_000;
    this.gatewaySessionMs = dependencies.gatewaySessionMs ?? 120_000;
    if (!Number.isInteger(this.resetLimit) || this.resetLimit < 0 || this.resetLimit > 3 ||
        !Number.isInteger(this.ttlMinutes) || this.ttlMinutes < 1 || this.ttlMinutes > 60 ||
        !Number.isSafeInteger(this.reservedCostGbpPence) || this.reservedCostGbpPence < 0 ||
        this.grantMs < 1000 || this.grantMs > 60_000 ||
        this.gatewaySessionMs < 1000 || this.gatewaySessionMs > 300_000) {
      throw new Error("invalid_web_lab_control_policy");
    }
    this.backends = new Map(dependencies.backends.map(item => [item.mode, item]));
  }

  private actor(actor: AuthenticatedWebLabActor): void {
    if (!actor || !ID_PATTERN.test(actor.userId) ||
        typeof actor.sessionId !== "string" || actor.sessionId.length < 1 || actor.sessionId.length > 160) {
      throw new WebLabControlError("UNAUTHENTICATED");
    }
  }

  private async alert(event: EarlyAccessSecurityEvent): Promise<void> {
    try { await this.dependencies.alerts?.notify(event); }
    catch { /* Security decisions and cleanup failures remain authoritative. */ }
  }

  private backend(mode: RuntimeMode): RuntimeBackendRegistration {
    const item = this.backends.get(mode);
    if (!item) throw new WebLabControlError("RUNNER_UNAVAILABLE");
    return item;
  }

  private async build(actor: AuthenticatedWebLabActor, savedLabId: string,
    mode: RuntimeMode, runtimeVersion: string) {
    const metadata = await this.dependencies.repository.getBuildMetadata(savedLabId, actor.userId);
    if (!metadata) throw new WebLabControlError("LAB_NOT_FOUND");
    const verdict = this.dependencies.compatibility.verdict(metadata, mode, runtimeVersion);
    if (verdict !== "SUPPORTED") throw new WebLabControlError("LAB_INCOMPATIBLE", verdict);
    const trusted = await this.dependencies.repository.getTrustedBuild(metadata.id, actor.userId);
    if (!trusted) throw new WebLabControlError("LAB_NOT_FOUND");
    return trusted;
  }

  private dto(runtime: SafeRuntimeStatus, grant?: { token: string; expiresAt: string }): LearnerRuntimeDto {
    const live = this.now() < new Date(runtime.expiresAt).getTime();
    const ready = runtime.status === "ready" && live;
    const actions: ("open" | "reset" | "destroy" | "grade")[] = [];
    if (ready) {
      actions.push("open", "grade");
      if (runtime.runtimeMode !== "amniora_hosted" || runtime.generationVersion <= this.resetLimit) actions.push("reset");
    }
    if (!["destroyed", "expired", "failed"].includes(runtime.status)) actions.push("destroy");
    return { instanceId: runtime.instanceId, buildId: runtime.buildId, mode: runtime.runtimeMode,
      status: runtime.status, createdAt: runtime.createdAt, expiresAt: runtime.expiresAt,
      generationVersion: runtime.generationVersion,
      remainingResets: runtime.runtimeMode === "amniora_hosted"
        ? Math.max(0, this.resetLimit - (runtime.generationVersion - 1)) : 0,
      availableActions: actions,
      ...(grant ? { launchGrant: grant } : {}) };
  }

  private async owned(actor: AuthenticatedWebLabActor, instanceId: string): Promise<InternalRuntimeState> {
    this.actor(actor);
    if (!ID_PATTERN.test(instanceId)) throw new WebLabControlError("RUNTIME_NOT_FOUND");
    const runtime = await this.dependencies.repository.getRuntimeControl(instanceId, actor.userId);
    if (!runtime) throw new WebLabControlError("RUNTIME_NOT_FOUND");
    return runtime;
  }

  private sign(claims: TokenClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.signingKey).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private verify(token: string, audience: TokenClaims["audience"]): TokenClaims {
    if (typeof token !== "string" || token.length > 2048) throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    const parts = token.split(".");
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const expected = createHmac("sha256", this.signingKey).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    let claims: TokenClaims;
    try { claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as TokenClaims; }
    catch { throw new WebLabControlError("INVALID_LAUNCH_GRANT"); }
    if (claims.audience !== audience || !KEY_PATTERN.test(claims.grantId) ||
        !ID_PATTERN.test(claims.instanceId) || !ID_PATTERN.test(claims.ownerId) ||
        typeof claims.sessionId !== "string" || claims.sessionId.length < 1 ||
        !Number.isSafeInteger(claims.generationVersion) || claims.generationVersion < 1 ||
        !Number.isSafeInteger(claims.expiresAt)) throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    if (this.now() >= claims.expiresAt) throw new WebLabControlError("LAUNCH_GRANT_EXPIRED");
    return claims;
  }

  private grant(runtime: InternalRuntimeState, actor: AuthenticatedWebLabActor) {
    if (runtime.status !== "ready" || this.now() >= new Date(runtime.expiresAt).getTime()) {
      throw new WebLabControlError("RUNTIME_NOT_READY");
    }
    const expiresAt = Math.min(this.now() + this.grantMs, new Date(runtime.expiresAt).getTime());
    return { token: this.sign({ audience: "web-lab-launch",
      grantId: randomBytes(24).toString("base64url"), instanceId: runtime.instanceId,
      ownerId: actor.userId, sessionId: actor.sessionId,
      generationVersion: runtime.generationVersion, expiresAt }),
    expiresAt: new Date(expiresAt).toISOString() };
  }

  async launch(actor: AuthenticatedWebLabActor, input: {
    savedLabId: string; mode: RuntimeMode; idempotencyKey: string;
  }): Promise<LearnerRuntimeDto> {
    this.actor(actor);
    if (!ID_PATTERN.test(input.savedLabId) || !KEY_PATTERN.test(input.idempotencyKey) ||
        !["amniora_hosted", "local_runner", "byo_runtime"].includes(input.mode)) {
      throw new WebLabControlError("INVALID_REQUEST");
    }
    const registration = this.backend(input.mode);
    const trusted = await this.build(actor, input.savedLabId, input.mode, registration.runtimeVersion);
    const plan = await this.dependencies.entitlement.planFor(actor);
    if (input.mode === "amniora_hosted" && plan !== "pro") {
      throw new WebLabControlError("HOSTED_PLAN_REQUIRED");
    }
    await this.dependencies.ratePolicy.assertAllowed(actor, "launch", input.mode, input.idempotencyKey);
    if (input.mode !== "amniora_hosted") {
      // Future runner transport/capability protocol is not implemented in Phase 13.
      throw new WebLabControlError("RUNNER_UNAVAILABLE");
    }
    let admission;
    try {
      admission = await this.dependencies.repository.admitHosted({ ownerId: actor.userId,
        savedLabId: input.savedLabId, idempotencyKey: input.idempotencyKey,
        providerKind: registration.providerKind, runtimeVersion: registration.runtimeVersion,
        ttlMinutes: this.ttlMinutes, reservedCostGbpPence: this.reservedCostGbpPence });
    } catch (error) {
      const failure = normalize(error);
      if (failure.code === "HOSTED_CAPACITY_FULL") {
        await this.alert({ code: "CAPACITY_DENIED", stage: "admission", runtimeMode: input.mode });
      } else if (["HOSTED_BUDGET_RESTRICTED", "HOSTED_BUDGET_EXCEEDED", "HOSTED_DISABLED"].includes(failure.code)) {
        await this.alert({ code: "BUDGET_DENIED", stage: "admission", runtimeMode: input.mode });
      }
      throw failure;
    }
    const policy = await this.dependencies.repository.getHostedBudgetPolicy();
    if (policy.state === "WARNING" && !admission.replayed) {
      await this.dependencies.repository.appendAudit({ instanceId: admission.instanceId,
        ownerId: actor.userId, commandId: admission.commandId,
        eventType: "budget_warning_launch", generationVersion: 1, result: "ok" });
    }
    let lease: CommandLease | null;
    try { lease = await this.dependencies.repository.claimCommandById(admission.commandId,
      `create-${randomBytes(12).toString("hex")}`); }
    catch { throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED"); }
    if (lease) {
      try { await this.provision(actor, admission.instanceId, trusted.spec, trusted.metadata.buildFingerprint,
        registration, lease); }
      catch (error) { if (error instanceof WebLabControlError) throw error;
        throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED"); }
    }
    const current = await this.owned(actor, admission.instanceId);
    return this.dto(current, current.status === "ready" ? this.grant(current, actor) : undefined);
  }

  private async provision(actor: AuthenticatedWebLabActor, instanceId: string, spec: WebLabSpec,
    fingerprint: string, registration: RuntimeBackendRegistration, lease: CommandLease): Promise<void> {
    let runtime = await this.owned(actor, instanceId);
    if (runtime.status === "ready") {
      await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
        workerId: lease.workerId, fenceToken: lease.fenceToken, outcome: "completed", resultCode: "ready" });
      return;
    }
    if (runtime.status === "requested") {
      await this.dependencies.repository.transitionRuntime({ instanceId, ownerId: actor.userId,
        expectedVersion: runtime.version, status: "provisioning",
        auditEvent: "provider_create_started", commandLease: lease });
      runtime = await this.owned(actor, instanceId);
    }
    if (runtime.status !== "provisioning") return;
    const expected = context(runtime, fingerprint);
    try {
      let observed = await registration.backend.inspect(instanceId, expected);
      if (observed.state === "missing") {
        const reference = await registration.backend.create(spec, expected);
        runtime = await this.owned(actor, instanceId);
        await this.dependencies.repository.transitionRuntime({ instanceId, ownerId: actor.userId,
          expectedVersion: runtime.version, status: "provisioning", backendReference: reference,
          auditEvent: "provider_reference_persisted", commandLease: lease });
        observed = await registration.backend.inspect(reference, expected);
      }
      if (observed.state !== "ready" || !observed.observation) {
        throw new Error("provider_not_ready");
      }
      runtime = await this.owned(actor, instanceId);
      await this.dependencies.repository.transitionRuntime({ instanceId, ownerId: actor.userId,
        expectedVersion: runtime.version, status: "ready",
        backendReference: observed.observation.reference, auditEvent: "instance_ready", commandLease: lease });
      await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
        workerId: lease.workerId, fenceToken: lease.fenceToken, outcome: "completed", resultCode: "ready" });
    } catch {
      // A create error can be ambiguous. Release only after an exact managed inspection proves absence.
      let inspection;
      try { inspection = await registration.backend.inspect(instanceId, expected); }
      catch { throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED"); }
      if (inspection.state === "missing") {
        runtime = await this.owned(actor, instanceId);
        if (runtime.status === "provisioning") {
          await this.dependencies.repository.transitionRuntime({ instanceId, ownerId: actor.userId,
            expectedVersion: runtime.version, status: "failed", failureCode: "provider_create_failed",
            auditEvent: "instance_failed", commandLease: lease });
          await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
            workerId: lease.workerId, fenceToken: lease.fenceToken, outcome: "failed",
            resultCode: "provider_create_failed" });
          await this.dependencies.repository.releaseAdmissionAfterProviderAbsence({ instanceId,
            ownerId: actor.userId, providerAbsentConfirmed: true });
          await this.recordTerminalUsage(instanceId, actor.userId, registration.providerKind);
        }
      } else {
        await this.dependencies.repository.appendAudit({ instanceId, ownerId: actor.userId,
          commandId: lease.commandId, eventType: "provider_create_uncertain",
          generationVersion: runtime.generationVersion, result: "failed", safeCode: "reconcile_required" });
      }
      throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED");
    }
  }

  async getRuntimeStatus(actor: AuthenticatedWebLabActor, instanceId: string): Promise<LearnerRuntimeDto> {
    let runtime = await this.owned(actor, instanceId);
    if (runtime.status === "ready" && this.now() >= new Date(runtime.expiresAt).getTime()) {
      await this.expireRuntime(actor, instanceId);
      runtime = await this.owned(actor, instanceId);
    }
    return this.dto(runtime);
  }

  async getHostedProductState(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<HostedProductState> {
    this.actor(actor);
    if (!ID_PATTERN.test(savedLabId)) throw new WebLabControlError("INVALID_REQUEST");
    const plan = await this.dependencies.entitlement.planFor(actor);
    const metadata = await this.dependencies.repository.getBuildMetadata(savedLabId, actor.userId);
    const registration = this.backends.get("amniora_hosted");
    if (!metadata || !registration ||
        this.dependencies.compatibility.verdict(metadata, "amniora_hosted", registration.runtimeVersion) !== "SUPPORTED") {
      return { plan, eligible: false, availability: "unavailable", runtime: null };
    }
    let latest = await this.dependencies.repository.getLatestHostedRuntimeForSavedLab(actor.userId, savedLabId);
    if (latest?.status === "ready" && this.now() >= new Date(latest.expiresAt).getTime()) {
      await this.expireRuntime(actor, latest.instanceId);
      latest = await this.dependencies.repository.getLatestHostedRuntimeForSavedLab(actor.userId, savedLabId);
    }
    const active: OwnedHostedRuntimeStatus | null =
      await this.dependencies.repository.getActiveHostedRuntimeForOwner(actor.userId);
    const runtime = latest && latest.status !== "destroyed" ? this.dto(latest) : null;
    if (plan !== "pro") return { plan, eligible: true, availability: "plan_required", runtime };
    if (active && active.savedLabId !== savedLabId) {
      return { plan, eligible: true, availability: "active_elsewhere", runtime: null };
    }

    const policy = await this.dependencies.repository.getHostedBudgetPolicy();
    const metricsFresh = policy.metricsObservedAt !== null &&
      this.now() - new Date(policy.metricsObservedAt).getTime() <= 24 * 60 * 60_000;
    if (!policy.enabled || policy.state === "DISABLED" || !metricsFresh) {
      return { plan, eligible: true, availability: "service_disabled", runtime };
    }
    if (policy.state === "RESTRICTED") {
      return { plan, eligible: true, availability: "budget_unavailable", runtime };
    }
    if (!active && !(await this.dependencies.repository.hasAvailableHostedSlot())) {
      return { plan, eligible: true, availability: "capacity_full", runtime };
    }
    return { plan, eligible: true, availability: "available", runtime };
  }

  async issueLaunchGrant(actor: AuthenticatedWebLabActor, instanceId: string) {
    const runtime = await this.owned(actor, instanceId);
    return this.grant(runtime, actor);
  }

  async reset(actor: AuthenticatedWebLabActor, input: {
    instanceId: string; idempotencyKey: string;
  }): Promise<LearnerRuntimeDto> {
    const initial = await this.owned(actor, input.instanceId);
    if (!KEY_PATTERN.test(input.idempotencyKey)) throw new WebLabControlError("INVALID_REQUEST");
    if (this.now() >= new Date(initial.expiresAt).getTime()) throw new WebLabControlError("RUNTIME_EXPIRED");
    await this.dependencies.ratePolicy.assertAllowed(actor, "reset", initial.runtimeMode, input.idempotencyKey);
    const registration = this.backend(initial.runtimeMode);
    let command;
    try { command = await this.dependencies.repository.requestReset({ instanceId: input.instanceId,
      ownerId: actor.userId, idempotencyKey: input.idempotencyKey,
      expectedVersion: initial.version, maxResets: this.resetLimit }); }
    catch (error) { throw normalize(error); }
    const lease = await this.dependencies.repository.claimCommandById(command.commandId,
      `reset-${randomBytes(12).toString("hex")}`);
    if (lease) {
      const runtime = await this.owned(actor, input.instanceId);
      const trusted = await this.dependencies.repository.getTrustedBuild(runtime.buildId, actor.userId);
      if (!trusted) throw new WebLabControlError("LAB_NOT_FOUND");
      const expected = context(runtime, trusted.metadata.buildFingerprint);
      try {
        let observed = await registration.backend.inspect(input.instanceId, expected);
        const previousGeneration = observed.state === "mismatch" &&
          observed.observation?.instanceId === expected.instanceId &&
          observed.observation.buildFingerprint === expected.buildFingerprint &&
          observed.observation.runtimeVersion === expected.runtimeVersion &&
          observed.observation.generationVersion === expected.generationVersion - 1;
        if (observed.state === "missing" || previousGeneration) {
          await registration.backend.reset(runtime.backendReference ?? input.instanceId, expected, trusted.spec);
          observed = await registration.backend.inspect(input.instanceId, expected);
        }
        if (observed.state !== "ready" || !observed.observation) throw new Error("reset_not_ready");
        const current = await this.owned(actor, input.instanceId);
        await this.dependencies.repository.transitionRuntime({ instanceId: input.instanceId,
          ownerId: actor.userId, expectedVersion: current.version, status: "ready",
          backendReference: observed.observation.reference, auditEvent: "reset_completed", commandLease: lease });
        await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
          workerId: lease.workerId, fenceToken: lease.fenceToken, outcome: "completed", resultCode: "ready" });
      } catch { throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED"); }
    }
    return this.dto(await this.owned(actor, input.instanceId));
  }

  async destroy(actor: AuthenticatedWebLabActor, input: {
    instanceId: string; idempotencyKey: string;
  }): Promise<LearnerRuntimeDto> {
    const initial = await this.owned(actor, input.instanceId);
    if (!KEY_PATTERN.test(input.idempotencyKey)) throw new WebLabControlError("INVALID_REQUEST");
    let command;
    try { command = await this.dependencies.repository.requestDestroy({ instanceId: input.instanceId,
      ownerId: actor.userId, idempotencyKey: input.idempotencyKey, expectedVersion: initial.version }); }
    catch (error) { throw normalize(error); }
    if (command.status === "destroyed") return this.dto(await this.owned(actor, input.instanceId));
    const lease = await this.dependencies.repository.claimCommandById(command.commandId,
      `destroy-${randomBytes(12).toString("hex")}`);
    if (lease) {
      const runtime = await this.owned(actor, input.instanceId);
      const build = await this.dependencies.repository.getBuildMetadataById(runtime.buildId, actor.userId);
      if (!build) throw new WebLabControlError("LAB_NOT_FOUND");
      const registration = this.backend(runtime.runtimeMode);
      const expected = context(runtime, build.buildFingerprint);
      try {
        await registration.backend.destroy(runtime.backendReference ?? runtime.instanceId, expected);
        const observation = await registration.backend.inspect(runtime.instanceId, expected);
        if (observation.state !== "missing") throw new Error("provider_still_present");
        const current = await this.owned(actor, input.instanceId);
        await this.dependencies.repository.transitionRuntime({ instanceId: input.instanceId,
          ownerId: actor.userId, expectedVersion: current.version, status: "destroyed",
          auditEvent: "destroyed", commandLease: lease });
        await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
          workerId: lease.workerId, fenceToken: lease.fenceToken, outcome: "completed", resultCode: "destroyed" });
        if (runtime.runtimeMode === "amniora_hosted") {
          await this.dependencies.repository.releaseAdmissionAfterProviderAbsence({ instanceId: input.instanceId,
            ownerId: actor.userId, providerAbsentConfirmed: true });
        }
        await this.recordTerminalUsage(input.instanceId, actor.userId, registration.providerKind);
      } catch { throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED"); }
    }
    return this.dto(await this.owned(actor, input.instanceId));
  }

  async expireRuntime(actor: AuthenticatedWebLabActor, instanceId: string): Promise<LearnerRuntimeDto> {
    let runtime = await this.owned(actor, instanceId);
    if (this.now() < new Date(runtime.expiresAt).getTime()) return this.dto(runtime);
    if (["destroyed", "expired", "failed"].includes(runtime.status)) return this.dto(runtime);
    const registration = this.backend(runtime.runtimeMode);
    const build = await this.dependencies.repository.getBuildMetadataById(runtime.buildId, actor.userId);
    if (!build) throw new WebLabControlError("LAB_NOT_FOUND");
    if (runtime.status !== "expiring") {
      await this.dependencies.repository.transitionRuntime({ instanceId, ownerId: actor.userId,
        expectedVersion: runtime.version, status: "expiring", auditEvent: "instance_expiring" });
      runtime = await this.owned(actor, instanceId);
    }
    const expected = context(runtime, build.buildFingerprint);
    await registration.backend.destroy(runtime.backendReference ?? runtime.instanceId, expected);
    const observation = await registration.backend.inspect(runtime.instanceId, expected);
    if (observation.state !== "missing") throw new WebLabControlError("RUNTIME_PROVISIONING_FAILED");
    await this.dependencies.repository.transitionRuntime({ instanceId, ownerId: actor.userId,
      expectedVersion: runtime.version, status: "expired", auditEvent: "expired" });
    if (runtime.runtimeMode === "amniora_hosted") {
      await this.dependencies.repository.releaseAdmissionAfterProviderAbsence({ instanceId,
        ownerId: actor.userId, providerAbsentConfirmed: true });
    }
    await this.recordTerminalUsage(instanceId, actor.userId, registration.providerKind);
    return this.dto(await this.owned(actor, instanceId));
  }

  async grade(actor: AuthenticatedWebLabActor, instanceId: string,
    idempotencyKey: string, runtimeSessionToken: string): Promise<Readonly<{
    completed: boolean; completionId: string | null; trustLevel: string;
  }>> {
    const runtime = await this.owned(actor, instanceId);
    if (!KEY_PATTERN.test(idempotencyKey) || typeof runtimeSessionToken !== "string" ||
        runtimeSessionToken.length < 1 || runtimeSessionToken.length > 2048) {
      throw new WebLabControlError("INVALID_REQUEST");
    }
    if (runtime.status !== "ready") throw new WebLabControlError("RUNTIME_NOT_READY");
    if (this.now() >= new Date(runtime.expiresAt).getTime()) throw new WebLabControlError("RUNTIME_EXPIRED");
    const gradeTarget = await this.authorizeGatewaySession(runtimeSessionToken, actor);
    if (gradeTarget.instanceId !== runtime.instanceId || gradeTarget.context.generationVersion !== runtime.generationVersion) {
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const plan = await this.dependencies.entitlement.planFor(actor);
    if (runtime.runtimeMode === "amniora_hosted" && plan !== "pro") {
      throw new WebLabControlError("HOSTED_PLAN_REQUIRED");
    }
    await this.dependencies.ratePolicy.assertAllowed(actor, "grade", runtime.runtimeMode, idempotencyKey);
    const trusted = await this.dependencies.repository.getTrustedBuild(runtime.buildId, actor.userId);
    if (!trusted) throw new WebLabControlError("LAB_NOT_FOUND");
    const registration = this.backend(runtime.runtimeMode);
    let command;
    try {
      command = await this.dependencies.repository.requestGrade({ instanceId,
        ownerId: actor.userId, idempotencyKey });
    } catch (error) { throw normalize(error); }
    if (command.replayed) {
      if (command.state === "failed" || command.resultCode === "error") {
        throw new WebLabControlError("GRADE_UNAVAILABLE");
      }
      if (command.state === "completed" &&
          !(["pass", "not_complete"] as const).includes(command.resultCode as "pass" | "not_complete")) {
        throw new WebLabControlError("INTERNAL_ERROR");
      }
      if (command.state === "completed") {
        return { completed: command.resultCode === "pass", completionId: command.completionId,
          trustLevel: command.trustLevel };
      }
    }
    let lease;
    try {
      lease = await this.dependencies.repository.claimCommandById(command.commandId,
        `grade-${randomBytes(12).toString("hex")}`, 45);
    } catch { throw new WebLabControlError("GRADE_UNAVAILABLE"); }
    if (!lease) throw new WebLabControlError("GRADE_IN_PROGRESS");
    let observedResult: unknown;
    try {
      observedResult = await this.dependencies.grader.grade({ spec: trusted.spec, runtime,
        backend: registration.backend, context: context(runtime, trusted.metadata.buildFingerprint) });
    } catch {
      try {
        await this.dependencies.repository.recordGradeCommand({ commandLease: lease, instanceId,
          ownerId: actor.userId, outcome: "error", graderVersion: "trusted-grader-failure-v1" });
      } catch { /* The protected operation still fails closed. */ }
      throw new WebLabControlError("GRADE_UNAVAILABLE");
    }
    if (!trustedGradeResult(observedResult)) {
      try {
        await this.dependencies.repository.recordGradeCommand({ commandLease: lease, instanceId,
          ownerId: actor.userId, outcome: "error", graderVersion: "invalid-grader-result-v1" });
      } catch { /* The protected operation still fails closed. */ }
      throw new WebLabControlError("GRADE_UNAVAILABLE");
    }
    const result = observedResult;
    // Revalidate session, generation, runtime expiry, and entitlement after observer work.
    try {
      const currentTarget = await this.authorizeGatewaySession(runtimeSessionToken, actor);
      if (currentTarget.instanceId !== runtime.instanceId ||
          currentTarget.context.generationVersion !== runtime.generationVersion ||
          (runtime.runtimeMode === "amniora_hosted" &&
            await this.dependencies.entitlement.planFor(actor) !== "pro")) {
        throw new WebLabControlError("GRADE_UNAVAILABLE");
      }
    } catch (error) {
      try {
        await this.dependencies.repository.recordGradeCommand({ commandLease: lease, instanceId,
          ownerId: actor.userId, outcome: "error", graderVersion: "stale-grade-session-v1" });
      } catch { /* The protected operation still fails closed. */ }
      throw error instanceof WebLabControlError ? error : new WebLabControlError("GRADE_UNAVAILABLE");
    }
    const persisted = await this.dependencies.repository.recordGradeCommand({ commandLease: lease,
      instanceId, ownerId: actor.userId, outcome: result.outcome,
      graderVersion: result.graderVersion, observationFingerprint: result.observationFingerprint });
    if (result.outcome === "error") throw new WebLabControlError("GRADE_UNAVAILABLE");
    return { completed: result.outcome === "pass", completionId: persisted.completionId,
      trustLevel: persisted.trustLevel };
  }

  async exchangeLaunchGrant(actor: AuthenticatedWebLabActor, token: string): Promise<GatewaySessionDto> {
    this.actor(actor);
    await this.dependencies.ratePolicy.assertAllowed(actor, "exchange", "amniora_hosted", digest(token));
    let claims: TokenClaims;
    try { claims = this.verify(token, "web-lab-launch"); }
    catch (error) {
      await this.alert({ code: error instanceof WebLabControlError && error.code === "LAUNCH_GRANT_EXPIRED"
        ? "LAUNCH_GRANT_EXPIRED" : "LAUNCH_GRANT_INVALID", stage: "launch_exchange",
        surface: "launch_exchange", runtimeMode: "amniora_hosted" });
      throw error;
    }
    if (claims.ownerId !== actor.userId || claims.sessionId !== actor.sessionId) {
      await this.alert({ code: "LAUNCH_GRANT_INVALID", stage: "launch_exchange",
        surface: "launch_exchange", runtimeMode: "amniora_hosted" });
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const runtime = await this.owned(actor, claims.instanceId);
    if (runtime.status !== "ready" || runtime.generationVersion !== claims.generationVersion ||
        this.now() >= new Date(runtime.expiresAt).getTime()) {
      await this.alert({ code: this.now() >= new Date(runtime.expiresAt).getTime()
        ? "LAUNCH_GRANT_EXPIRED" : "LAUNCH_GRANT_INVALID", stage: "launch_exchange",
        surface: "launch_exchange", runtimeMode: runtime.runtimeMode });
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const consumed = await this.dependencies.repository.consumeLaunchGrant({
      grantIdHash: digest(claims.grantId), instanceId: claims.instanceId,
      ownerId: actor.userId, generationVersion: claims.generationVersion,
      expiresAt: new Date(claims.expiresAt) });
    if (consumed === "replayed") {
      await this.alert({ code: "LAUNCH_GRANT_REPLAYED", stage: "launch_exchange",
        surface: "launch_exchange", runtimeMode: runtime.runtimeMode });
      throw new WebLabControlError("LAUNCH_GRANT_REPLAYED");
    }
    if (consumed !== "consumed") {
      await this.alert({ code: "LAUNCH_GRANT_INVALID", stage: "launch_exchange",
        surface: "launch_exchange", runtimeMode: runtime.runtimeMode });
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const expiresAt = Math.min(this.now() + this.gatewaySessionMs,
      new Date(runtime.expiresAt).getTime());
    return { token: this.sign({ audience: "web-lab-gateway-session",
      grantId: randomBytes(24).toString("base64url"), instanceId: runtime.instanceId,
      ownerId: actor.userId, sessionId: actor.sessionId,
      generationVersion: runtime.generationVersion, expiresAt }),
    instanceId: runtime.instanceId, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Trusted gateway only; its backend reference must never be returned from an API handler. */
  async authorizeGatewaySession(token: string, actor: AuthenticatedWebLabActor): Promise<TrustedGatewayTarget> {
    this.actor(actor);
    const claims = this.verify(token, "web-lab-gateway-session");
    if (claims.ownerId !== actor.userId || claims.sessionId !== actor.sessionId) {
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const runtime = await this.owned(actor, claims.instanceId);
    if (runtime.status !== "ready" || runtime.generationVersion !== claims.generationVersion ||
        !runtime.backendReference || this.now() >= new Date(runtime.expiresAt).getTime()) {
      throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    }
    const build = await this.dependencies.repository.getBuildMetadataById(runtime.buildId, actor.userId);
    if (!build) throw new WebLabControlError("INVALID_LAUNCH_GRANT");
    return { instanceId: runtime.instanceId, ownerId: actor.userId,
      backendReference: runtime.backendReference,
      context: context(runtime, build.buildFingerprint), expiresAt: runtime.expiresAt };
  }

  private async recordTerminalUsage(instanceId: string, ownerId: string, providerKind: string): Promise<void> {
    const runtime = await this.dependencies.repository.getRuntimeControl(instanceId, ownerId);
    if (!runtime) return;
    const endedAt = new Date(Math.max(this.now(), new Date(runtime.createdAt).getTime()));
    try {
      await this.dependencies.repository.recordUsage({ instanceId, providerKind,
        generationVersion: runtime.generationVersion, windowStartedAt: new Date(runtime.createdAt),
        windowEndedAt: endedAt,
        provisionedSeconds: Math.floor((endedAt.getTime() - new Date(runtime.createdAt).getTime()) / 1000),
        activeCpuMs: 0, memoryMbSeconds: 0, ingressBytes: 0, egressBytes: 0, graderMs: 0,
        measurementSource: "control_plane_terminal", externalSampleId: `terminal:${instanceId}` });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "23505")) throw error;
    }
  }

  private async terminalAfterConfirmedAbsence(runtime: InternalRuntimeState,
    status: "failed" | "expired" | "destroyed", auditEvent: string,
    providerKind: string, lease?: CommandLease): Promise<void> {
    const current = await this.dependencies.repository.getRuntimeControl(runtime.instanceId, runtime.ownerId);
    if (!current) return;
    if (current.status !== status) {
      await this.dependencies.repository.transitionRuntime({ instanceId: current.instanceId,
        ownerId: current.ownerId, expectedVersion: current.version,
        status, failureCode: status === "failed" ? "runtime_lost" : undefined,
        auditEvent, commandLease: lease });
    }
    if (current.runtimeMode === "amniora_hosted" && current.admissionState !== "released") {
      try {
        await this.dependencies.repository.releaseAdmissionAfterProviderAbsence({
          instanceId: current.instanceId, ownerId: current.ownerId, providerAbsentConfirmed: true });
      } catch (error) {
        await this.alert({ code: "RUNTIME_CLEANUP_FAILED", stage: "runtime",
          runtimeMode: current.runtimeMode });
        throw error;
      }
    }
    await this.recordTerminalUsage(current.instanceId, current.ownerId, providerKind);
  }

  /** Callable trusted worker entrypoint. No scheduler is registered in Phase 13. */
  async reconcile(olderThan: Date): Promise<Readonly<{
    inspected: number; recovered: number; failed: number; released: number; orphansRemoved: number;
  }>> {
    let inspected = 0, recovered = 0, failed = 0, released = 0, orphansRemoved = 0;
    const candidates = await this.dependencies.repository.listReconciliationCandidates(olderThan);
    for (const runtime of candidates) {
      const registration = this.backends.get(runtime.runtimeMode);
      if (!registration) continue;
      const build = await this.dependencies.repository.getBuildMetadataById(runtime.buildId, runtime.ownerId);
      if (!build) continue;
      const expected = context(runtime, build.buildFingerprint);
      let observation;
      try { observation = await registration.backend.inspect(runtime.backendReference ?? runtime.instanceId, expected); }
      catch {
        await this.alert({ code: "RECONCILIATION_FAILED", stage: "reconciliation",
          runtimeMode: runtime.runtimeMode });
        continue;
      }
      inspected++;
      if (runtime.status === "ready" && this.now() >= new Date(runtime.expiresAt).getTime()) {
        try { await this.expireRuntime({ userId: runtime.ownerId, sessionId: "trusted-reconciler" }, runtime.instanceId);
          released++; } catch {
          await this.alert({ code: "RUNTIME_CLEANUP_FAILED", stage: "runtime",
            runtimeMode: runtime.runtimeMode });
        }
      } else if (runtime.status === "ready" && observation.state === "missing") {
        await this.terminalAfterConfirmedAbsence(runtime, "failed", "runtime_lost", registration.providerKind);
        failed++; released++;
      } else if (runtime.status === "ready" && observation.state === "ready") {
        await this.dependencies.repository.markRuntimeObservedReady({ instanceId: runtime.instanceId,
          ownerId: runtime.ownerId, expectedVersion: runtime.version });
        recovered++;
      } else if (["requested", "provisioning", "resetting"].includes(runtime.status)) {
        const operation = runtime.status === "resetting" ? "reset" : "create";
        const commandId = await this.dependencies.repository.findPendingCommand(runtime.instanceId, operation);
        const lease = commandId ? await this.dependencies.repository.claimCommandById(commandId,
          `reconcile-${randomBytes(10).toString("hex")}`) : null;
        if (!lease) continue;
        const previousGeneration = runtime.status === "resetting" && observation.state === "mismatch" &&
          observation.observation?.instanceId === expected.instanceId &&
          observation.observation.buildFingerprint === expected.buildFingerprint &&
          observation.observation.runtimeVersion === expected.runtimeVersion &&
          observation.observation.generationVersion === expected.generationVersion - 1;
        if (previousGeneration) {
          let trusted: Awaited<ReturnType<Repo["getTrustedBuild"]>> = null;
          try { trusted = await this.dependencies.repository.getTrustedBuild(runtime.buildId, runtime.ownerId); }
          catch { /* retired or corrupt build cannot be used for replacement */ }
          if (!trusted) {
            await registration.backend.destroy(runtime.backendReference ?? runtime.instanceId, expected);
            const after = await registration.backend.inspect(runtime.instanceId, expected);
            if (after.state !== "missing") continue;
            await this.terminalAfterConfirmedAbsence(runtime, "failed", "runtime_lost",
              registration.providerKind, lease);
            await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
              workerId: lease.workerId, fenceToken: lease.fenceToken,
              outcome: "failed", resultCode: "build_incompatible" });
            failed++; released++;
            continue;
          }
          try {
            await registration.backend.reset(runtime.backendReference ?? runtime.instanceId,
              expected, trusted.spec);
            observation = await registration.backend.inspect(runtime.instanceId, expected);
          } catch { continue; }
        }
        if (observation.state === "ready" && observation.observation) {
          let current = await this.dependencies.repository.getRuntimeControl(runtime.instanceId, runtime.ownerId);
          if (!current) continue;
          if (current.status === "requested") {
            await this.dependencies.repository.transitionRuntime({ instanceId: current.instanceId,
              ownerId: current.ownerId, expectedVersion: current.version, status: "provisioning",
              auditEvent: "reconciled", commandLease: lease });
            current = await this.dependencies.repository.getRuntimeControl(runtime.instanceId, runtime.ownerId);
          }
          if (!current) continue;
          await this.dependencies.repository.transitionRuntime({ instanceId: current.instanceId,
            ownerId: current.ownerId, expectedVersion: current.version, status: "ready",
            backendReference: observation.observation.reference,
            auditEvent: "instance_recovered", commandLease: lease });
          await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
            workerId: lease.workerId, fenceToken: lease.fenceToken,
            outcome: "completed", resultCode: "recovered" });
          recovered++;
        } else if (observation.state === "missing") {
          if (runtime.status === "resetting") {
            await registration.backend.destroy(runtime.backendReference ?? runtime.instanceId, expected);
            const after = await registration.backend.inspect(runtime.instanceId, expected);
            if (after.state !== "missing") continue;
          }
          await this.terminalAfterConfirmedAbsence(runtime, "failed", "runtime_lost",
            registration.providerKind, lease);
          await this.dependencies.repository.completeCommand({ commandId: lease.commandId,
            workerId: lease.workerId, fenceToken: lease.fenceToken,
            outcome: "failed", resultCode: "runtime_missing" });
          failed++; released++;
        }
      } else if (["destroying", "expiring", "failed", "expired", "destroyed"].includes(runtime.status)) {
        if (observation.state !== "missing") {
          await registration.backend.destroy(runtime.backendReference ?? runtime.instanceId, expected);
          const after = await registration.backend.inspect(runtime.instanceId, expected);
          if (after.state !== "missing") continue;
        }
        const target = runtime.status === "expiring" ? "expired" :
          runtime.status === "destroying" ? "destroyed" : runtime.status as "failed" | "expired" | "destroyed";
        await this.terminalAfterConfirmedAbsence(runtime, target,
          target === "failed" ? "runtime_lost" : target,
          registration.providerKind);
        released++;
      }
    }
    // Backends promise listManaged() excludes all unrelated resources.
    for (const registration of this.backends.values()) {
      let managed: readonly ManagedRuntimeObservation[];
      try { managed = await registration.backend.listManaged(); }
      catch { continue; }
      for (const observation of managed) {
        if (!ID_PATTERN.test(observation.instanceId) ||
            observation.runtimeVersion !== registration.runtimeVersion ||
            !/^[0-9a-f]{64}$/.test(observation.buildFingerprint)) continue;
        const runtime = await this.dependencies.repository.getRuntimeForReconciliation(observation.instanceId);
        if (runtime) {
          const build = await this.dependencies.repository.getBuildMetadataById(runtime.buildId, runtime.ownerId);
          if (!build || observation.buildFingerprint !== build.buildFingerprint ||
              observation.runtimeVersion !== runtime.runtimeVersion) continue;
          if (observation.generationVersion === runtime.generationVersion &&
              !["failed", "expired", "destroyed"].includes(runtime.status)) continue;
        }
        try { await registration.backend.destroyManaged(observation); }
        catch (error) {
          await this.alert({ code: "RUNTIME_CLEANUP_FAILED", stage: "runtime",
            runtimeMode: registration.mode });
          throw error;
        }
        orphansRemoved++;
      }
    }
    return { inspected, recovered, failed, released, orphansRemoved };
  }
}
