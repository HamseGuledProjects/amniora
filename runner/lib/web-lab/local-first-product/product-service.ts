import type { AuthenticatedWebLabActor } from "../production-control-service";
import { DurableLocalFirstAuthority } from "./authority";
import { PRODUCT_PRESENCE_FRESH_MS, PRODUCT_STATUS_FRESH_MS, ProductProtocolError, shortFingerprint } from "./protocol";
import type { ProductAction, ProductCommandStatus, ProductFailureCode, ProductOperation, ProductRuntimeState, ProductSnapshot } from "./contract";

const SAFE_ID = /^[A-Za-z0-9_:-]{8,128}$/;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{16,160}$/;

function projectedRuntimeState(activity: Awaited<ReturnType<DurableLocalFirstAuthority["repository"]["ownerActivity"]>>,
  now: number): ProductRuntimeState {
  if (activity.pending) {
    if (activity.pending.state === "redeemed" && now > activity.pending.expiresAt + 30_000) return "recovery_required";
    if (activity.pending.operation === "LAUNCH") return "launching";
    if (activity.pending.operation === "RESET") return "resetting";
    if (activity.pending.operation === "STOP") return "stopping";
  }
  const state = activity.runtime?.result?.runtime?.state;
  if (state === "starting") return "launching";
  return state === "running" || state === "resetting" || state === "stopping" || state === "failed" ? state : "idle";
}

export type ExecutableProductBuild = Readonly<{
  buildId: string;
  savedLabId: string;
  ownerId: string;
  labName: string;
  supportedArchitectures: readonly ("arm64" | "amd64")[];
}>;

export interface LocalFirstBuildRepository {
  ownedExecutableBuild(savedLabId: string, ownerId: string): Promise<ExecutableProductBuild | null>;
  ownedExecutableBuildById(buildId: string, ownerId: string): Promise<ExecutableProductBuild | null>;
}

export type LocalFirstProductErrorCode =
  | "UNAUTHENTICATED" | "LAB_NOT_FOUND" | "OWNER_ACCESS_REQUIRED" | "RUNNER_UNPAIRED"
  | "RUNNER_STATUS_REQUIRED" | "RUNNER_NOT_READY" | "RUNTIME_NOT_READY" | "ARCHITECTURE_UNAVAILABLE"
  | "ANOTHER_LAB_ACTIVE" | "OPERATION_IN_PROGRESS"
  | "COMMAND_EXPIRED"
  | "INVALID_REQUEST" | "CSRF_REJECTED" | "REQUEST_TOO_LARGE" | "UNAVAILABLE";

export class LocalFirstProductError extends Error {
  constructor(readonly code: LocalFirstProductErrorCode) { super(code); this.name = "LocalFirstProductError"; }
}

export class LocalFirstProductService {
  constructor(
    readonly authority: DurableLocalFirstAuthority,
    private readonly builds: LocalFirstBuildRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private async build(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<ExecutableProductBuild> {
    if (!SAFE_ID.test(savedLabId)) throw new LocalFirstProductError("LAB_NOT_FOUND");
    const build = await this.builds.ownedExecutableBuild(savedLabId, actor.userId);
    if (!build || build.savedLabId !== savedLabId || build.ownerId !== actor.userId || !SAFE_ID.test(build.buildId)) {
      throw new LocalFirstProductError("LAB_NOT_FOUND");
    }
    return build;
  }

  async snapshot(actor: AuthenticatedWebLabActor, savedLabId: string): Promise<ProductSnapshot> {
    const build = await this.build(actor, savedLabId);
    const installation = await this.authority.repository.activeInstallationForAccount(actor.userId);
    if (!installation) return {
      enabled: true, eligible: true, paired: false, runner: null, virtualMachine: null,
      guestAgent: null, docker: null, lab: { name: build.labName, state: "stopped", generation: null },
      runtime: { state: "idle", generation: null, lastVerifiedAt: null },
      otherActiveLab: null, pendingCommand: null,
      lastCompletedCommand: null, gradingAvailable: false, failure: "RUNNER_UNPAIRED",
    };
    const latest = await this.authority.repository.latestCompleted(actor.userId, installation.installationId);
    const activity = await this.authority.repository.ownerActivity(actor.userId, this.now());
    const active = activity.runtime?.result?.runtime ?? null;
    const another = active && active.buildId !== build.buildId
      ? await this.builds.ownedExecutableBuildById(active.buildId, actor.userId) : null;
    // Every lifecycle operation performs the same local VM/Guest Agent/Docker preflight and returns
    // the same signed safe result shape. Readiness therefore comes from the newest signed command,
    // not only from a manually requested STATUS command.
    const readinessFresh = !!latest?.result && !!latest.completedAt && this.now() - latest.completedAt <= PRODUCT_STATUS_FRESH_MS;
    const readinessResult = latest?.result ?? null;
    const presenceAge = installation.lastInteractionAt === null ? null : this.now() - installation.lastInteractionAt;
    const presenceFresh = presenceAge !== null && presenceAge <= PRODUCT_PRESENCE_FRESH_MS;
    const presence = presenceAge === null ? "unknown" : presenceFresh ? "online" :
      presenceAge <= PRODUCT_PRESENCE_FRESH_MS * 2 ? "stale" : "offline";
    const matchingRuntime = active?.buildId === build.buildId ? active : null;
    const failure = (another ? "ANOTHER_LAB_ACTIVE" : readinessResult?.ok === false ? readinessResult.code :
      matchingRuntime?.state === "stopped" ? "LAB_STOPPED" : !readinessFresh ? "STATUS_STALE" : null) as ProductFailureCode | null;
    return {
      enabled: true, eligible: true, paired: true,
      runner: {
        name: installation.deviceName, fingerprint: shortFingerprint(installation.publicKey),
        presence,
        readiness: !readinessFresh ? "unknown" : readinessResult?.ok ? "ready" : "unavailable",
        readinessVerifiedAt: latest?.completedAt ? new Date(latest.completedAt).toISOString() : null,
        version: readinessResult?.runner.version ?? null,
        lastInteractionAt: installation.lastInteractionAt ? new Date(installation.lastInteractionAt).toISOString() : null,
        presenceExpiresAt: installation.lastInteractionAt ? new Date(installation.lastInteractionAt + PRODUCT_PRESENCE_FRESH_MS).toISOString() : null,
        readinessExpiresAt: latest?.completedAt ? new Date(latest.completedAt + PRODUCT_STATUS_FRESH_MS).toISOString() : null,
      },
      virtualMachine: readinessResult?.virtualMachine ? { ...readinessResult.virtualMachine } : null,
      guestAgent: readinessResult?.guestAgent ? { ...readinessResult.guestAgent } : null,
      docker: readinessResult?.docker ? { ...readinessResult.docker } : null,
      runtime: { state: projectedRuntimeState(activity, this.now()), generation: matchingRuntime?.generation ?? null,
        lastVerifiedAt: latest?.completedAt ? new Date(latest.completedAt).toISOString() : null },
      lab: { name: build.labName, state: matchingRuntime?.state ?? "stopped", generation: matchingRuntime?.generation ?? null },
      otherActiveLab: another ? { savedLabId: another.savedLabId, name: another.labName } : null,
      pendingCommand: activity.pending ? { operation: activity.pending.operation,
        state: activity.pending.state as "issued" | "redeemed",
        expiresAt: new Date(activity.pending.expiresAt).toISOString() } : null,
      lastCompletedCommand: latest?.completedAt && latest.result && (latest.buildId === build.buildId || latest.operation === "STATUS") ? {
        requestId: latest.requestId, operation: latest.operation,
        completedAt: new Date(latest.completedAt).toISOString(), ok: latest.result.ok,
      } : null,
      gradingAvailable: false,
      failure,
    };
  }

  async action(actor: AuthenticatedWebLabActor, savedLabId: string, operation: ProductOperation,
    idempotencyKey: string): Promise<ProductAction> {
    if (!IDEMPOTENCY.test(idempotencyKey)) throw new LocalFirstProductError("INVALID_REQUEST");
    const build = await this.build(actor, savedLabId);
    const installation = await this.authority.repository.activeInstallationForAccount(actor.userId);
    if (!installation) throw new LocalFirstProductError("RUNNER_UNPAIRED");
    const prior = await this.authority.repository.commandByIdempotency(actor.userId, installation.installationId, idempotencyKey);
    if (prior) {
      if (prior.state === "cancelled") throw new LocalFirstProductError("COMMAND_EXPIRED");
      if (prior.operation !== operation || prior.buildId !== (operation === "STATUS" ? null : build.buildId)) {
        throw new LocalFirstProductError("INVALID_REQUEST");
      }
      const replay = await this.authority.issue({ accountId: actor.userId, installationId: installation.installationId,
        operation, buildId: prior.buildId, runtimeId: prior.runtimeId, generation: prior.generation, idempotencyKey });
      return { requestId: replay.requestId, activationUri: replay.activationUri,
        expiresAt: new Date(replay.expiresAt).toISOString(), operation,
        state: replay.state };
    }
    let runtimeId: string | null = null;
    let generation: number | null = null;
    if (operation !== "STATUS") {
      const activity = await this.authority.repository.ownerActivity(actor.userId, this.now());
      if (activity.pending) throw new LocalFirstProductError("OPERATION_IN_PROGRESS");
      const active = activity.runtime?.result?.runtime;
      if (operation === "LAUNCH" && active) throw new LocalFirstProductError("ANOTHER_LAB_ACTIVE");
      // Readiness is deliberately not an issuance gate. Runner cold-launches from the
      // activation URI, preflights the local VM/Guest Agent/Docker, and returns a signed
      // result. Server-owned runtime identity and generation remain mandatory below.
      if (operation !== "LAUNCH") {
        const runtime = active?.buildId === build.buildId ? active : null;
        if (!runtime || runtime.state !== "running") throw new LocalFirstProductError("RUNTIME_NOT_READY");
        runtimeId = runtime.runtimeId;
        generation = runtime.generation;
      }
    }
    try {
      const issued = await this.authority.issue({
        accountId: actor.userId, installationId: installation.installationId, operation,
        buildId: operation === "STATUS" ? null : build.buildId, runtimeId, generation, idempotencyKey,
      });
      return { requestId: issued.requestId, activationUri: issued.activationUri,
        expiresAt: new Date(issued.expiresAt).toISOString(), operation,
        state: issued.state };
    } catch (error) {
      if (error instanceof LocalFirstProductError) throw error;
      if (error instanceof ProductProtocolError && error.code === "PAIRING_REVOKED") throw new LocalFirstProductError("RUNNER_UNPAIRED");
      if (error instanceof ProductProtocolError && error.code === "TICKET_EXPIRED") throw new LocalFirstProductError("COMMAND_EXPIRED");
      if (error instanceof ProductProtocolError && error.code === "RUNTIME_CONFLICT") throw new LocalFirstProductError("ANOTHER_LAB_ACTIVE");
      if (error instanceof ProductProtocolError && error.code === "OPERATION_IN_PROGRESS") throw new LocalFirstProductError("OPERATION_IN_PROGRESS");
      if (error instanceof ProductProtocolError && error.code === "CONTEXT_MISMATCH") throw new LocalFirstProductError("RUNTIME_NOT_READY");
      throw new LocalFirstProductError("UNAVAILABLE");
    }
  }

  async unpair(actor: AuthenticatedWebLabActor): Promise<void> {
    const installation = await this.authority.repository.activeInstallationForAccount(actor.userId);
    if (!installation) throw new LocalFirstProductError("RUNNER_UNPAIRED");
    const activity = await this.authority.repository.ownerActivity(actor.userId, this.now());
    if (activity.runtime || activity.pending) throw new LocalFirstProductError("OPERATION_IN_PROGRESS");
    try { await this.authority.revoke(actor.userId, installation.installationId); }
    catch (error) {
      if (error instanceof ProductProtocolError && error.code === "OPERATION_IN_PROGRESS") {
        throw new LocalFirstProductError("OPERATION_IN_PROGRESS");
      }
      throw new LocalFirstProductError("UNAVAILABLE");
    }
  }

  async commandStatus(actor: AuthenticatedWebLabActor, savedLabId: string, requestId: string): Promise<ProductCommandStatus> {
    const build = await this.build(actor, savedLabId);
    if (!/^req_[A-Za-z0-9_-]{43}$/.test(requestId)) throw new LocalFirstProductError("INVALID_REQUEST");
    const record = await this.authority.repository.command(requestId);
    if (!record || record.accountId !== actor.userId || (record.buildId !== null && record.buildId !== build.buildId)) {
      throw new LocalFirstProductError("LAB_NOT_FOUND");
    }
    return { state: record.state, operation: record.operation, expiresAt: new Date(record.expiresAt).toISOString(),
      ok: record.result?.ok ?? null, code: record.result?.code ?? null };
  }

  async cancelCommand(actor: AuthenticatedWebLabActor, savedLabId: string, requestId: string): Promise<void> {
    const build = await this.build(actor, savedLabId);
    if (!/^req_[A-Za-z0-9_-]{43}$/.test(requestId)) throw new LocalFirstProductError("INVALID_REQUEST");
    const record = await this.authority.repository.command(requestId);
    if (!record || record.accountId !== actor.userId || (record.buildId !== null && record.buildId !== build.buildId)) {
      throw new LocalFirstProductError("LAB_NOT_FOUND");
    }
    if (!await this.authority.cancelIssued(actor.userId, record.installationId, requestId)) {
      throw new LocalFirstProductError("OPERATION_IN_PROGRESS");
    }
  }
}
