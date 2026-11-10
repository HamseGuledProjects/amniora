import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { compileWebLab } from "./compiler";
import {
  assertRuntimeTransition,
  type LearnerRuntimeStatus,
  type RuntimeBackend,
  type RuntimeBackendContext,
  type RuntimeCommand,
  type RuntimeDataPlaneTarget,
  type RuntimeGradeResult,
  type RuntimeGraderBackend,
  type RuntimeLaunchGrant,
  type RuntimeOperation,
  type RuntimeStatus,
  type SavedWebLabResolver,
} from "./control-plane";
import type { WebLabSpec } from "./schema";
import {
  activeRuntimeStatuses,
  type RuntimeAuditInput,
  type RuntimeAuditType,
  type RuntimeStateStore,
  type StoredRuntimeCommand,
  type StoredRuntimeInstance,
} from "./runtime-state-store";

export type ManagedRuntimeObservation = Readonly<{
  reference: string;
  instanceId: string;
  buildFingerprint: string;
  generationVersion: number;
  runtimeVersion: string;
  state: "ready" | "partial" | "failed";
}>;

export type RuntimeInspection = Readonly<{
  state: "ready" | "missing" | "mismatch" | "failed";
  observation: ManagedRuntimeObservation | null;
}>;

export interface ReconciliableRuntimeBackend extends RuntimeBackend {
  inspect(reference: string, expected: RuntimeBackendContext): Promise<RuntimeInspection>;
  listManaged(): Promise<readonly ManagedRuntimeObservation[]>;
  destroyManaged(observation: ManagedRuntimeObservation): Promise<void>;
}

type LaunchClaims = Readonly<{
  audience: "web-lab-data";
  purpose: "launch";
  grantId: string;
  instanceId: string;
  ownerId: string;
  sessionId: string;
  routeKey: string;
  generationVersion: number;
  expiresAt: number;
}>;

function context(record: StoredRuntimeInstance): RuntimeBackendContext {
  return {
    instanceId: record.instanceId,
    buildFingerprint: record.buildFingerprint,
    generationVersion: record.generationVersion,
    runtimeVersion: record.runtimeVersion,
  };
}

export class DurableWebLabControlService {
  private readonly launchSigningKey = randomBytes(32);
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: {
    verifyCommand: (command: RuntimeCommand) => boolean;
    savedLabs: SavedWebLabResolver;
    backend: ReconciliableRuntimeBackend;
    grader: RuntimeGraderBackend;
    stateStore: RuntimeStateStore;
    now?: () => number;
    ttlMs?: number;
    grantMs?: number;
    runtimeVersion?: string;
  }) {}

  private now(): number { return (this.options.now ?? Date.now)(); }
  private ttlMs(): number { return this.options.ttlMs ?? 15 * 60_000; }
  private grantMs(): number { return this.options.grantMs ?? 60_000; }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private authenticate(command: RuntimeCommand, operation: RuntimeOperation): void {
    const now = this.now();
    if (command?.audience !== "web-lab-control" || command.operation !== operation ||
      !command.ownerId || !command.sessionId || !command.resourceId || !command.requestId ||
      !command.idempotencyKey || command.idempotencyKey.length > 128 ||
      !Number.isSafeInteger(command.issuedAt) || !Number.isSafeInteger(command.expiresAt) ||
      command.issuedAt > now + 5_000 || command.expiresAt <= now ||
      command.expiresAt - command.issuedAt > 60_000 || !this.options.verifyCommand(command)) {
      throw new Error("unauthorized_control_request");
    }
  }

  private audit(record: StoredRuntimeInstance, eventType: RuntimeAuditType, result: "ok" | "failed" = "ok", code: string | null = null): RuntimeAuditInput {
    return {
      instanceId: record.instanceId, ownerId: record.ownerId, eventType, at: this.now(),
      generationVersion: record.generationVersion, result, code,
    };
  }

  private async owned(instanceId: string, ownerId: string): Promise<StoredRuntimeInstance> {
    const record = await this.options.stateStore.getInstance(instanceId);
    if (!record || record.ownerId !== ownerId) throw new Error("runtime_not_found");
    return record;
  }

  private async transition(record: StoredRuntimeInstance, to: RuntimeStatus, patch: Partial<StoredRuntimeInstance>, eventType: RuntimeAuditType, result: "ok" | "failed" = "ok", code: string | null = null): Promise<StoredRuntimeInstance> {
    assertRuntimeTransition(record.status, to);
    const nextGeneration = patch.generationVersion ?? record.generationVersion;
    return this.options.stateStore.updateLifecycle(record.instanceId, record.version, {
      ...patch, status: to, updatedAt: this.now(),
    }, [{ ...this.audit({ ...record, generationVersion: nextGeneration }, eventType, result, code) }]);
  }

  private async update(record: StoredRuntimeInstance, patch: Partial<StoredRuntimeInstance>, eventType: RuntimeAuditType, result: "ok" | "failed" = "ok", code: string | null = null): Promise<StoredRuntimeInstance> {
    const nextGeneration = patch.generationVersion ?? record.generationVersion;
    return this.options.stateStore.updateLifecycle(record.instanceId, record.version, {
      ...patch, updatedAt: this.now(),
    }, [{ ...this.audit({ ...record, generationVersion: nextGeneration }, eventType, result, code) }]);
  }

  private async fail(record: StoredRuntimeInstance, code: string, eventType: RuntimeAuditType = "instance_failed"): Promise<StoredRuntimeInstance> {
    if (record.status === "failed") return this.update(record, { failureCode: code, lastReconciledAt: this.now() }, eventType, "failed", code);
    return this.transition(record, "failed", { failureCode: code, lastReconciledAt: this.now() }, eventType, "failed", code);
  }

  private async command(command: RuntimeCommand): Promise<StoredRuntimeCommand | null> {
    const existing = await this.options.stateStore.getIdempotencyResult(command.ownerId, command.operation, command.idempotencyKey);
    if (!existing) return null;
    if (existing.resourceId !== command.resourceId || existing.ownerId !== command.ownerId || existing.operation !== command.operation) {
      throw new Error("idempotency_conflict");
    }
    return existing;
  }

  private view(record: StoredRuntimeInstance, sessionId: string): LearnerRuntimeStatus {
    const ready = record.status === "ready" && this.now() < record.expiresAt;
    return {
      instanceId: record.instanceId, status: record.status, expiresAt: record.expiresAt,
      launchAvailable: ready, launchGrant: ready ? this.launchGrant(record, sessionId) : null,
    };
  }

  private launchGrant(record: StoredRuntimeInstance, sessionId: string): RuntimeLaunchGrant {
    const claims: LaunchClaims = {
      audience: "web-lab-data", purpose: "launch", grantId: randomBytes(16).toString("base64url"),
      instanceId: record.instanceId, ownerId: record.ownerId, sessionId, routeKey: record.routeKey,
      generationVersion: record.generationVersion,
      expiresAt: Math.min(this.now() + this.grantMs(), record.expiresAt),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.launchSigningKey).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, routeKey: record.routeKey, expiresAt: claims.expiresAt };
  }

  private launchClaims(token: string): LaunchClaims | null {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || parts[0].length > 2048 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
    const expected = createHmac("sha256", this.launchSigningKey).update(parts[0]).digest();
    const provided = Buffer.from(parts[1], "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    try { return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as LaunchClaims; }
    catch { return null; }
  }

  private async trustedSpec(record: StoredRuntimeInstance): Promise<WebLabSpec> {
    const saved = await this.options.savedLabs.find(record.savedLabId);
    if (!saved || saved.ownerId !== record.ownerId || saved.spec.labId !== record.canonicalLabId ||
      compileWebLab(saved.spec).manifest.canonicalSpecSha256 !== record.buildFingerprint) {
      throw new Error("trusted_lab_identity_mismatch");
    }
    return saved.spec;
  }

  private async expireIfDue(record: StoredRuntimeInstance): Promise<StoredRuntimeInstance> {
    if (record.status === "destroying" || !activeRuntimeStatuses.includes(record.status) || this.now() < record.expiresAt) return record;
    let expiring = record.status === "expiring" ? record : await this.transition(record, "expiring", {}, "instance_expired");
    try {
      if (expiring.backendReference) await this.options.backend.destroy(expiring.backendReference, context(expiring));
      expiring = await this.transition(expiring, "expired", { lastReconciledAt: this.now() }, "instance_expired");
      return expiring;
    } catch (error) {
      await this.fail(expiring, "expiry_cleanup_failed");
      throw error;
    }
  }

  async create(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "create");
      const previous = await this.command(command);
      if (previous) {
        const record = await this.options.stateStore.getInstance(previous.instanceId);
        if (!record) throw new Error("idempotency_result_missing");
        return this.view(await this.expireIfDue(record), command.sessionId);
      }
      const saved = await this.options.savedLabs.find(command.resourceId);
      if (!saved || saved.ownerId !== command.ownerId || saved.savedLabId !== command.resourceId) throw new Error("saved_lab_not_found");
      const active = await this.options.stateStore.listActiveInstances(command.ownerId);
      for (const candidate of active) await this.expireIfDue(candidate);
      if ((await this.options.stateStore.listActiveInstances(command.ownerId)).length) throw new Error("active_instance_limit");
      const manifest = compileWebLab(saved.spec).manifest;
      const now = this.now();
      const record: StoredRuntimeInstance = {
        instanceId: randomUUID(), ownerId: command.ownerId, savedLabId: saved.savedLabId,
        canonicalLabId: saved.spec.labId, buildFingerprint: manifest.canonicalSpecSha256,
        templateId: manifest.templateId, templateVersion: manifest.templateVersion,
        vulnerabilityId: manifest.vulnerabilityId, vulnerabilityVersion: manifest.vulnerabilityVersion,
        status: "requested", createdAt: now, updatedAt: now, expiresAt: now + this.ttlMs(),
        lastActivityAt: now, destroyedAt: null, backendReference: null,
        runtimeVersion: this.options.runtimeVersion ?? "phase8-local-1", generationVersion: 1,
        routeKey: randomBytes(24).toString("base64url"), lastReconciledAt: null,
        failureCode: null, version: 1,
      };
      const journal: StoredRuntimeCommand = {
        ownerId: command.ownerId, operation: "create", idempotencyKey: command.idempotencyKey,
        resourceId: command.resourceId, requestId: command.requestId, instanceId: record.instanceId,
        state: "in-progress", generationVersion: 1, resultJson: null, createdAt: now, completedAt: null,
      };
      try {
        await this.options.stateStore.createInstanceWithCommand(record, journal, [this.audit(record, "instance_requested")]);
      } catch (error) {
        const raced = await this.command(command);
        if (raced) {
          const existing = await this.options.stateStore.getInstance(raced.instanceId);
          if (existing) return this.view(existing, command.sessionId);
        }
        throw error;
      }
      let current = await this.transition(record, "provisioning", {}, "instance_provisioning");
      try {
        const reference = await this.options.backend.create(saved.spec, context(current));
        current = await this.transition(current, "ready", {
          backendReference: reference, lastReconciledAt: this.now(), failureCode: null,
        }, "instance_ready");
        await this.options.stateStore.completeIdempotency(command.ownerId, "create", command.idempotencyKey,
          JSON.stringify({ instanceId: current.instanceId }), current.generationVersion, this.now());
        return this.view(current, command.sessionId);
      } catch (error) {
        current = await this.fail(current, "provision_failed");
        await this.options.stateStore.completeIdempotency(command.ownerId, "create", command.idempotencyKey,
          JSON.stringify({ instanceId: current.instanceId }), current.generationVersion, this.now());
        throw error;
      }
    });
  }

  async status(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "status");
      const record = await this.owned(command.resourceId, command.ownerId);
      return this.view(await this.expireIfDue(record), command.sessionId);
    });
  }

  async reset(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "reset");
      let record = await this.expireIfDue(await this.owned(command.resourceId, command.ownerId));
      const previous = await this.command(command);
      if (previous) {
        if (previous.state === "in-progress") throw new Error("command_in_progress");
        return this.view(record, command.sessionId);
      }
      if (record.status !== "ready" || !record.backendReference) throw new Error("instance_not_resettable");
      const started: StoredRuntimeCommand = {
        ownerId: command.ownerId, operation: "reset", idempotencyKey: command.idempotencyKey,
        resourceId: command.resourceId, requestId: command.requestId, instanceId: record.instanceId,
        state: "in-progress", generationVersion: record.generationVersion + 1,
        resultJson: null, createdAt: this.now(), completedAt: null,
      };
      if (!await this.options.stateStore.recordIdempotency(started)) {
        const raced = await this.command(command);
        if (raced?.state === "completed") return this.view(record, command.sessionId);
        throw new Error("command_in_progress");
      }
      const backendReference = record.backendReference;
      const spec = await this.trustedSpec(record);
      record = await this.transition(record, "resetting", { generationVersion: record.generationVersion + 1 }, "instance_reset_started");
      try {
        await this.options.backend.reset(backendReference, context(record), spec);
        record = await this.transition(record, "ready", {
          lastActivityAt: this.now(), lastReconciledAt: this.now(), failureCode: null,
        }, "instance_reset_completed");
        await this.options.stateStore.completeIdempotency(command.ownerId, "reset", command.idempotencyKey,
          JSON.stringify({ instanceId: record.instanceId }), record.generationVersion, this.now());
        return this.view(record, command.sessionId);
      } catch (error) {
        record = await this.fail(record, "reset_failed");
        await this.options.stateStore.completeIdempotency(command.ownerId, "reset", command.idempotencyKey,
          JSON.stringify({ instanceId: record.instanceId }), record.generationVersion, this.now());
        throw error;
      }
    });
  }

  async grade(command: RuntimeCommand): Promise<RuntimeGradeResult> {
    return this.exclusive(async () => {
      this.authenticate(command, "grade");
      let record = await this.expireIfDue(await this.owned(command.resourceId, command.ownerId));
      if (record.status !== "ready" || !record.backendReference) throw new Error("instance_not_gradable");
      const spec = await this.trustedSpec(record);
      const observed = await this.options.grader.grade(record.backendReference, spec);
      record = await this.expireIfDue(await this.owned(record.instanceId, record.ownerId));
      if (record.status !== "ready") throw new Error("instance_not_gradable");
      await this.options.stateStore.updateLifecycle(record.instanceId, record.version, { lastActivityAt: this.now(), updatedAt: this.now() });
      return { completed: observed.status === "pass", gradedAt: this.now() };
    });
  }

  async destroy(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "destroy");
      let record = await this.owned(command.resourceId, command.ownerId);
      const previous = await this.command(command);
      if (previous?.state === "completed") return this.view(record, command.sessionId);
      if (previous?.state === "in-progress") throw new Error("command_in_progress");
      const started: StoredRuntimeCommand = {
        ownerId: command.ownerId, operation: "destroy", idempotencyKey: command.idempotencyKey,
        resourceId: command.resourceId, requestId: command.requestId, instanceId: record.instanceId,
        state: "in-progress", generationVersion: record.generationVersion,
        resultJson: null, createdAt: this.now(), completedAt: null,
      };
      if (!await this.options.stateStore.recordIdempotency(started)) {
        const raced = await this.command(command);
        if (raced?.state === "completed") return this.view(record, command.sessionId);
        throw new Error("command_in_progress");
      }
      if (record.status !== "destroyed") {
        record = await this.transition(record, "destroying", {}, "instance_destroy_started");
        try {
          if (record.backendReference) await this.options.backend.destroy(record.backendReference, context(record));
          record = await this.transition(record, "destroyed", {
            destroyedAt: this.now(), lastReconciledAt: this.now(), failureCode: null,
          }, "instance_destroyed");
        } catch (error) {
          record = await this.fail(record, "destroy_failed");
          throw error;
        }
      }
      await this.options.stateStore.completeIdempotency(command.ownerId, "destroy", command.idempotencyKey,
        JSON.stringify({ instanceId: record.instanceId }), record.generationVersion, this.now());
      return this.view(record, command.sessionId);
    });
  }

  async authorizeDataPlaneLaunch(token: string, identity: { ownerId: string; sessionId: string }): Promise<RuntimeDataPlaneTarget | null> {
    const claims = this.launchClaims(token);
    if (!claims || claims.audience !== "web-lab-data" || claims.purpose !== "launch" ||
      !/^[A-Za-z0-9_-]{22}$/.test(claims.grantId) || claims.ownerId !== identity.ownerId ||
      claims.sessionId !== identity.sessionId || !Number.isSafeInteger(claims.expiresAt) || this.now() >= claims.expiresAt) return null;
    return this.resolveDataPlaneTarget({
      instanceId: claims.instanceId, ownerId: identity.ownerId, routeKey: claims.routeKey,
      generationVersion: claims.generationVersion,
    });
  }

  async resolveDataPlaneTarget(input: { instanceId: string; ownerId: string; routeKey: string; generationVersion?: number }): Promise<RuntimeDataPlaneTarget | null> {
    return this.exclusive(async () => {
      let record = await this.options.stateStore.getInstance(input.instanceId);
      if (!record || record.ownerId !== input.ownerId || record.routeKey !== input.routeKey) return null;
      record = await this.expireIfDue(record);
      if (record.status !== "ready" || !record.backendReference ||
        (input.generationVersion !== undefined && input.generationVersion !== record.generationVersion)) return null;
      return {
        instanceId: record.instanceId, backendReference: record.backendReference,
        routeKey: record.routeKey, generationVersion: record.generationVersion, expiresAt: record.expiresAt,
      };
    });
  }

  async sweepExpired(): Promise<number> {
    return this.exclusive(async () => {
      const expired = await this.options.stateStore.listExpiredInstances(this.now());
      for (const record of expired) await this.expireIfDue(record);
      return expired.length;
    });
  }

  async reconcile(): Promise<{ healthy: number; failed: number; expired: number; orphansRemoved: number }> {
    return this.exclusive(async () => {
      const summary = { healthy: 0, failed: 0, expired: 0, orphansRemoved: 0 };
      const observations = await this.options.backend.listManaged();
      const records = await this.options.stateStore.listInstances();
      const knownIds = new Set(records.map(record => record.instanceId));
      const matching = (record: StoredRuntimeInstance) => observations.filter(item => item.instanceId === record.instanceId);

      for (const original of records) {
        let record = await this.options.stateStore.getInstance(original.instanceId) ?? original;
        try {
          if (activeRuntimeStatuses.includes(record.status) && this.now() >= record.expiresAt) {
            if (!record.backendReference) {
              for (const item of matching(record)) await this.options.backend.destroyManaged(item);
            }
            record = await this.expireIfDue(record);
            summary.expired++;
            await this.completeRecoveredCommands(record);
            continue;
          }
          if (record.status === "requested") {
            for (const item of matching(record)) await this.options.backend.destroyManaged(item);
            record = await this.fail(record, "requested_interrupted");
            summary.failed++;
          } else if (record.status === "provisioning") {
            const candidate = matching(record).find(item => item.state === "ready" && item.buildFingerprint === record.buildFingerprint && item.generationVersion === record.generationVersion && item.runtimeVersion === record.runtimeVersion);
            if (candidate) {
              record = await this.transition(record, "ready", { backendReference: candidate.reference, lastReconciledAt: this.now() }, "instance_reconciled");
              summary.healthy++;
            } else {
              for (const item of matching(record)) await this.options.backend.destroyManaged(item);
              record = await this.fail(record, "provisioning_interrupted");
              summary.failed++;
            }
          } else if (record.status === "ready" || record.status === "resetting") {
            if (!record.backendReference) {
              record = await this.fail(record, "backend_reference_missing", "instance_runtime_lost");
              summary.failed++;
            } else {
              const inspected = await this.options.backend.inspect(record.backendReference, context(record));
              if (inspected.state === "ready") {
                if (record.status === "resetting") {
                  record = await this.transition(record, "ready", { lastReconciledAt: this.now(), failureCode: null }, "instance_reset_completed");
                } else {
                  record = await this.update(record, { lastReconciledAt: this.now(), failureCode: null }, "instance_reconciled");
                }
                summary.healthy++;
              } else {
                for (const item of matching(record)) await this.options.backend.destroyManaged(item);
                const code = inspected.state === "mismatch" ? "backend_identity_mismatch" :
                  record.status === "resetting" ? "reset_recovery_failed" : "runtime_lost";
                record = await this.fail(record, code, code === "runtime_lost" ? "instance_runtime_lost" : "instance_failed");
                summary.failed++;
              }
            }
          } else if (record.status === "destroying" || record.status === "expiring") {
            if (record.backendReference) await this.options.backend.destroy(record.backendReference, context(record));
            for (const item of matching(record)) await this.options.backend.destroyManaged(item);
            const terminal = record.status === "destroying" ? "destroyed" : "expired";
            record = await this.transition(record, terminal, {
              ...(terminal === "destroyed" ? { destroyedAt: this.now() } : {}), lastReconciledAt: this.now(),
            }, terminal === "destroyed" ? "instance_destroyed" : "instance_expired");
            if (terminal === "expired") summary.expired++; else summary.healthy++;
          } else if (["destroyed", "expired", "failed"].includes(record.status)) {
            for (const item of matching(record)) await this.options.backend.destroyManaged(item);
            record = await this.update(record, { lastReconciledAt: this.now() }, "instance_reconciled");
          }
          await this.completeRecoveredCommands(record);
        } catch {
          const fresh = await this.options.stateStore.getInstance(record.instanceId);
          if (fresh && fresh.status !== "failed" && fresh.status !== "destroyed") await this.fail(fresh, "reconciliation_failed");
          summary.failed++;
        }
      }

      for (const observation of observations) {
        if (knownIds.has(observation.instanceId)) continue;
        await this.options.stateStore.recordAuditEvent({
          instanceId: observation.instanceId, ownerId: null, eventType: "orphan_detected",
          at: this.now(), generationVersion: observation.generationVersion, result: "ok", code: null,
        });
        await this.options.backend.destroyManaged(observation);
        await this.options.stateStore.recordAuditEvent({
          instanceId: observation.instanceId, ownerId: null, eventType: "orphan_removed",
          at: this.now(), generationVersion: observation.generationVersion, result: "ok", code: null,
        });
        summary.orphansRemoved++;
      }
      return summary;
    });
  }

  private async completeRecoveredCommands(record: StoredRuntimeInstance): Promise<void> {
    const pending = await this.options.stateStore.listPendingCommands(record.instanceId);
    for (const entry of pending) {
      const terminal = entry.operation === "create" ? ["ready", "failed", "expired", "destroyed"].includes(record.status) :
        entry.operation === "reset" ? ["ready", "failed", "expired", "destroyed"].includes(record.status) :
        entry.operation === "destroy" ? ["destroyed", "failed"].includes(record.status) : false;
      if (terminal) await this.options.stateStore.completeIdempotency(entry.ownerId, entry.operation, entry.idempotencyKey,
        JSON.stringify({ instanceId: record.instanceId }), record.generationVersion, this.now());
    }
  }
}
