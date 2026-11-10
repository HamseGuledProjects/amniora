/** Phase 6 local contract prototype. No public route or production credentials. */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { compileWebLab } from "./compiler";
import type { WebLabSpec, WebModuleId, WebTemplateId } from "./schema";

export type RuntimeStatus = "requested" | "provisioning" | "ready" | "resetting" | "expiring" | "destroying" | "expired" | "failed" | "destroyed";
export type RuntimeOperation = "create" | "status" | "reset" | "grade" | "destroy";
export type RuntimeOwnership = Readonly<{ ownerId: string; savedLabId: string; canonicalLabId: string }>;
export type RuntimeLease = Readonly<{ createdAt: number; expiresAt: number; lastActivityAt: number }>;
export type RuntimeInstance = RuntimeOwnership & RuntimeLease & Readonly<{
  instanceId: string;
  buildFingerprint: string;
  templateId: WebTemplateId;
  templateVersion: string;
  vulnerabilityId: WebModuleId;
  vulnerabilityVersion: string;
  generationVersion: number;
  runtimeVersion: string;
  status: RuntimeStatus;
  routeKey: string;
  backendReference: string | null;
  destroyedAt: number | null;
}>;
export type RuntimeCommand = Readonly<{
  audience: "web-lab-control";
  operation: RuntimeOperation;
  ownerId: string;
  sessionId: string;
  resourceId: string;
  requestId: string;
  idempotencyKey: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}>;
export type RuntimeLaunchGrant = Readonly<{ token: string; routeKey: string; expiresAt: number }>;
export type RuntimeGradeResult = Readonly<{ completed: boolean; gradedAt: number }>;
/** Trusted gateway lookup only. Never serialize this into a learner response. */
export type RuntimeDataPlaneTarget = Readonly<{
  instanceId: string;
  backendReference: string;
  routeKey: string;
  generationVersion: number;
  expiresAt: number;
}>;
export type LearnerRuntimeStatus = Readonly<{
  instanceId: string;
  status: RuntimeStatus;
  expiresAt: number;
  launchAvailable: boolean;
  launchGrant: RuntimeLaunchGrant | null;
}>;
export type RuntimeAuditEvent = Readonly<{
  instanceId: string;
  ownerId: string;
  at: number;
  action: "instance_requested" | "instance_ready" | "instance_reset" | "instance_graded" | "instance_expired" | "instance_destroyed" | "instance_failed";
  result: "ok" | "failed";
}>;
export type SavedWebLab = Readonly<{ savedLabId: string; ownerId: string; spec: WebLabSpec }>;
export interface SavedWebLabResolver { find(savedLabId: string): Promise<SavedWebLab | null> }
export interface RuntimeBackend {
  create(spec: WebLabSpec, context?: RuntimeBackendContext): Promise<string>;
  status(reference: string, context?: RuntimeBackendContext): Promise<"ready" | "expired" | "failed" | "destroyed">;
  reset(reference: string, context?: RuntimeBackendContext, spec?: WebLabSpec): Promise<void>;
  destroy(reference: string, context?: RuntimeBackendContext): Promise<void>;
}
export type RuntimeBackendContext = Readonly<{
  instanceId: string;
  buildFingerprint: string;
  generationVersion: number;
  runtimeVersion: string;
}>;
export interface RuntimeGraderBackend { grade(reference: string, spec?: WebLabSpec): Promise<{ status: "pass" | "not-complete" }> }

const transitions: Record<RuntimeStatus, readonly RuntimeStatus[]> = {
  requested: ["provisioning", "expiring", "failed", "destroying", "destroyed"],
  provisioning: ["ready", "expiring", "failed", "destroying", "destroyed"],
  ready: ["resetting", "expiring", "failed", "destroying", "destroyed"],
  resetting: ["ready", "expiring", "failed", "destroying", "destroyed"],
  expiring: ["expired", "failed", "destroying"],
  destroying: ["destroyed", "failed"],
  expired: ["destroying", "destroyed"],
  failed: ["destroying", "destroyed"],
  destroyed: [],
};

export function assertRuntimeTransition(from: RuntimeStatus, to: RuntimeStatus): void {
  if (!transitions[from]?.includes(to)) throw new Error(`invalid_transition:${from}:${to}`);
}

type MutableInstance = { -readonly [K in keyof RuntimeInstance]: RuntimeInstance[K] };
type IdempotentResult = { ownerId: string; resourceId: string; operation: RuntimeOperation; value: unknown; generationVersion?: number };
type LaunchClaims = { audience: "web-lab-data"; purpose: "launch"; grantId: string; instanceId: string; ownerId: string; sessionId: string; routeKey: string; generationVersion: number; expiresAt: number };

export class LocalWebLabControlService {
  private readonly instances = new Map<string, MutableInstance>();
  private readonly idempotency = new Map<string, IdempotentResult>();
  private readonly signingKey = randomBytes(32);
  private tail: Promise<void> = Promise.resolve();
  readonly auditEvents: RuntimeAuditEvent[] = [];

  constructor(private readonly options: {
    verifyCommand: (command: RuntimeCommand) => boolean;
    savedLabs: SavedWebLabResolver;
    backend: RuntimeBackend;
    grader: RuntimeGraderBackend;
    now?: () => number;
    ttlMs?: number;
    grantMs?: number;
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
      command.expiresAt - command.issuedAt > 60_000 ||
      !this.options.verifyCommand(command)) throw new Error("unauthorized_control_request");
  }

  private owned(instanceId: string, ownerId: string): MutableInstance {
    const record = this.instances.get(instanceId);
    if (!record || record.ownerId !== ownerId) throw new Error("runtime_not_found");
    return record;
  }

  private transition(record: MutableInstance, to: RuntimeStatus): void {
    assertRuntimeTransition(record.status, to);
    record.status = to;
  }

  private audit(record: MutableInstance, action: RuntimeAuditEvent["action"], result: RuntimeAuditEvent["result"] = "ok"): void {
    this.auditEvents.push({ instanceId: record.instanceId, ownerId: record.ownerId, at: this.now(), action, result });
  }

  private markFailed(record: MutableInstance): void {
    if (record.status === "failed") return;
    this.transition(record, "failed");
    this.audit(record, "instance_failed", "failed");
  }

  private previous<T>(command: RuntimeCommand, generationVersion?: number): T | undefined {
    const entry = this.idempotency.get(`${command.ownerId}:${command.operation}:${command.idempotencyKey}`);
    if (!entry) return undefined;
    if (entry.resourceId !== command.resourceId || entry.operation !== command.operation || entry.ownerId !== command.ownerId)
      throw new Error("idempotency_conflict");
    if (generationVersion !== undefined && entry.generationVersion !== generationVersion)
      throw new Error("stale_idempotency_key");
    return entry.value as T;
  }

  private remember(command: RuntimeCommand, value: unknown, generationVersion?: number): void {
    this.idempotency.set(`${command.ownerId}:${command.operation}:${command.idempotencyKey}`, {
      ownerId: command.ownerId, resourceId: command.resourceId, operation: command.operation, value, generationVersion,
    });
  }

  private async expireIfDue(record: MutableInstance): Promise<void> {
    if (record.status !== "ready" && record.status !== "resetting") return;
    if (this.now() < record.expiresAt) {
      if (record.status === "ready" && record.backendReference) {
        const backendStatus = await this.options.backend.status(record.backendReference);
        if (backendStatus === "ready") return;
        if (backendStatus === "failed") {
          try { await this.options.backend.destroy(record.backendReference); }
          catch (error) { this.markFailed(record); throw error; }
          this.markFailed(record);
          return;
        }
      } else return;
    }
    this.transition(record, "expiring");
    try {
      if (record.backendReference) await this.options.backend.destroy(record.backendReference);
      this.transition(record, "expired");
      this.audit(record, "instance_expired");
    } catch (error) {
      this.markFailed(record);
      throw error;
    }
  }

  private launchGrant(record: MutableInstance, sessionId: string): RuntimeLaunchGrant {
    const claims: LaunchClaims = {
      audience: "web-lab-data", purpose: "launch", grantId: randomBytes(16).toString("base64url"), instanceId: record.instanceId,
      ownerId: record.ownerId, sessionId, routeKey: record.routeKey,
      generationVersion: record.generationVersion,
      expiresAt: Math.min(this.now() + this.grantMs(), record.expiresAt),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", this.signingKey).update(payload).digest("base64url");
    return { token: `${payload}.${signature}`, routeKey: record.routeKey, expiresAt: claims.expiresAt };
  }

  private view(record: MutableInstance, sessionId: string): LearnerRuntimeStatus {
    const ready = record.status === "ready" && this.now() < record.expiresAt;
    return {
      instanceId: record.instanceId, status: record.status, expiresAt: record.expiresAt,
      launchAvailable: ready, launchGrant: ready ? this.launchGrant(record, sessionId) : null,
    };
  }

  /** Only a data-plane gateway should call this. It never authorizes control operations. */
  validateLaunchGrant(token: string, context: { instanceId: string; ownerId: string; sessionId: string }): boolean {
    if (typeof token !== "string") return false;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
    const expected = createHmac("sha256", this.signingKey).update(parts[0]).digest();
    const provided = Buffer.from(parts[1], "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
    try {
      const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as LaunchClaims;
      const record = this.instances.get(context.instanceId);
      return !!record && record.status === "ready" && this.now() < record.expiresAt &&
        claims.audience === "web-lab-data" && claims.purpose === "launch" &&
        typeof claims.grantId === "string" && /^[A-Za-z0-9_-]{22}$/.test(claims.grantId) &&
        claims.instanceId === context.instanceId && claims.ownerId === context.ownerId &&
        claims.ownerId === record.ownerId && claims.sessionId === context.sessionId &&
        claims.routeKey === record.routeKey && claims.generationVersion === record.generationVersion &&
        Number.isSafeInteger(claims.expiresAt) && this.now() < claims.expiresAt &&
        claims.expiresAt <= record.expiresAt;
    } catch { return false; }
  }

  /** Exchanges launch authority for a trusted target description without exposing token claims to the learner. */
  async authorizeDataPlaneLaunch(token: string, identity: {
    ownerId: string; sessionId: string;
  }): Promise<RuntimeDataPlaneTarget | null> {
    if (typeof token !== "string") return null;
    try {
      const parts = token.split(".");
      if (parts.length !== 2 || parts[0].length > 2048 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
      const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as LaunchClaims;
      if (!this.validateLaunchGrant(token, {
        instanceId: claims.instanceId, ownerId: identity.ownerId, sessionId: identity.sessionId,
      })) return null;
      return this.resolveDataPlaneTarget({
        instanceId: claims.instanceId, ownerId: identity.ownerId,
        routeKey: claims.routeKey, generationVersion: claims.generationVersion,
      });
    } catch { return null; }
  }

  /** In-process trusted gateway lookup; no HTTP control endpoint is exposed. */
  async resolveDataPlaneTarget(context: {
    instanceId: string; ownerId: string; routeKey: string; generationVersion?: number;
  }): Promise<RuntimeDataPlaneTarget | null> {
    return this.exclusive(async () => {
      const record = this.instances.get(context.instanceId);
      if (!record || record.ownerId !== context.ownerId || record.routeKey !== context.routeKey) return null;
      await this.expireIfDue(record);
      if (record.status !== "ready" || !record.backendReference ||
        (context.generationVersion !== undefined && context.generationVersion !== record.generationVersion)) return null;
      return {
        instanceId: record.instanceId, backendReference: record.backendReference,
        routeKey: record.routeKey, generationVersion: record.generationVersion,
        expiresAt: record.expiresAt,
      };
    });
  }

  async create(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "create");
      const saved = await this.options.savedLabs.find(command.resourceId);
      if (!saved || saved.ownerId !== command.ownerId || saved.savedLabId !== command.resourceId)
        throw new Error("saved_lab_not_found");
      const prior = this.previous<string>(command);
      if (prior) {
        const record = this.owned(prior, command.ownerId);
        await this.expireIfDue(record);
        return this.view(record, command.sessionId);
      }
      for (const item of this.instances.values()) {
        if (item.ownerId === command.ownerId) await this.expireIfDue(item);
      }
      if ([...this.instances.values()].some(item => item.ownerId === command.ownerId &&
        ["requested", "provisioning", "ready", "resetting", "expiring"].includes(item.status)))
        throw new Error("active_instance_limit");
      const manifest = compileWebLab(saved.spec).manifest;
      const now = this.now();
      const record: MutableInstance = {
        instanceId: randomUUID(), ownerId: command.ownerId, savedLabId: saved.savedLabId,
        canonicalLabId: saved.spec.labId, buildFingerprint: manifest.canonicalSpecSha256,
        templateId: manifest.templateId, templateVersion: manifest.templateVersion,
        vulnerabilityId: manifest.vulnerabilityId, vulnerabilityVersion: manifest.vulnerabilityVersion,
        generationVersion: 1, runtimeVersion: "phase6-local-1", status: "requested",
        createdAt: now, expiresAt: now + this.ttlMs(), lastActivityAt: now,
        routeKey: randomBytes(24).toString("base64url"), backendReference: null, destroyedAt: null,
      };
      this.instances.set(record.instanceId, record);
      this.remember(command, record.instanceId);
      this.audit(record, "instance_requested");
      this.transition(record, "provisioning");
      try {
        record.backendReference = await this.options.backend.create(saved.spec);
        this.transition(record, "ready");
        this.audit(record, "instance_ready");
        await this.expireIfDue(record);
      } catch (error) {
        this.markFailed(record);
        throw error;
      }
      return this.view(record, command.sessionId);
    });
  }

  async status(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "status");
      const record = this.owned(command.resourceId, command.ownerId);
      await this.expireIfDue(record);
      return this.view(record, command.sessionId);
    });
  }

  async reset(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "reset");
      const record = this.owned(command.resourceId, command.ownerId);
      await this.expireIfDue(record);
      if (record.status !== "ready" || !record.backendReference) throw new Error("instance_not_resettable");
      if (this.previous<boolean>(command)) return this.view(record, command.sessionId);
      this.transition(record, "resetting");
      try {
        await this.options.backend.reset(record.backendReference);
        if (this.now() >= record.expiresAt) {
          await this.expireIfDue(record);
        } else {
          record.generationVersion++;
          record.lastActivityAt = this.now();
          this.transition(record, "ready");
          this.audit(record, "instance_reset");
        }
        this.remember(command, true);
        return this.view(record, command.sessionId);
      } catch (error) {
        this.markFailed(record);
        throw error;
      }
    });
  }

  async grade(command: RuntimeCommand): Promise<RuntimeGradeResult> {
    return this.exclusive(async () => {
      this.authenticate(command, "grade");
      const record = this.owned(command.resourceId, command.ownerId);
      await this.expireIfDue(record);
      if (record.status !== "ready" || !record.backendReference) throw new Error("instance_not_gradable");
      const prior = this.previous<RuntimeGradeResult>(command, record.generationVersion);
      if (prior) return prior;
      const observed = await this.options.grader.grade(record.backendReference);
      await this.expireIfDue(record);
      if (record.status !== "ready") throw new Error("instance_not_gradable");
      const result = { completed: observed.status === "pass", gradedAt: this.now() };
      record.lastActivityAt = result.gradedAt;
      this.remember(command, result, record.generationVersion);
      this.audit(record, "instance_graded");
      return result;
    });
  }

  async destroy(command: RuntimeCommand): Promise<LearnerRuntimeStatus> {
    return this.exclusive(async () => {
      this.authenticate(command, "destroy");
      const record = this.owned(command.resourceId, command.ownerId);
      this.previous<boolean>(command);
      if (record.status === "destroyed") return this.view(record, command.sessionId);
      try {
        if (record.backendReference) await this.options.backend.destroy(record.backendReference);
      } catch (error) {
        if (record.status !== "expired") this.markFailed(record);
        throw error;
      }
      this.transition(record, "destroyed");
      record.destroyedAt = this.now();
      this.remember(command, true);
      this.audit(record, "instance_destroyed");
      return this.view(record, command.sessionId);
    });
  }
}
