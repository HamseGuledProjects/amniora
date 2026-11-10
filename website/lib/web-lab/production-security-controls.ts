/** Early Access server-only security controls. Never import from a client component. */
import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import type {
  AuthenticatedWebLabActor,
  WebLabControlPlaneService,
  WebLabEntitlementPolicy,
  WebLabRatePolicy,
} from "./production-control-service";
import type { RuntimeMode } from "./postgres-control-repository";

type Sql = ReturnType<typeof postgres>;

export const EARLY_ACCESS_SECURITY_SURFACES = [
  "runner_package",
  "my_vm_enrollment",
  "runtime_launch",
  "runtime_reset",
  "runtime_grade",
  "launch_exchange",
] as const;
export type EarlyAccessSecuritySurface = typeof EARLY_ACCESS_SECURITY_SURFACES[number];

export type EarlyAccessRateRule = Readonly<{ limit: number; windowMs: number }>;
export type EarlyAccessRateRules = Readonly<Partial<Record<EarlyAccessSecuritySurface, EarlyAccessRateRule>>>;

const ONE_MINUTE_MS = 60_000;

/** Product/security-approved initial production abuse policy for Early Access. */
export const EARLY_ACCESS_PRODUCTION_RATE_RULES: Readonly<
  Record<EarlyAccessSecuritySurface, EarlyAccessRateRule>
> = Object.freeze({
  runner_package: Object.freeze({ limit: 20, windowMs: 60 * ONE_MINUTE_MS }),
  my_vm_enrollment: Object.freeze({ limit: 5, windowMs: 60 * ONE_MINUTE_MS }),
  runtime_launch: Object.freeze({ limit: 4, windowMs: 60 * ONE_MINUTE_MS }),
  runtime_reset: Object.freeze({ limit: 6, windowMs: 60 * ONE_MINUTE_MS }),
  runtime_grade: Object.freeze({ limit: 30, windowMs: 10 * ONE_MINUTE_MS }),
  launch_exchange: Object.freeze({ limit: 30, windowMs: 10 * ONE_MINUTE_MS }),
});

export class EarlyAccessSecurityError extends Error {
  constructor(readonly code: "RATE_LIMITED" | "CONTROL_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT") {
    super(code);
    this.name = "EarlyAccessSecurityError";
  }
}

export interface DistributedAbusePolicy {
  readonly production?: boolean;
  assertAllowed(input: Readonly<{
    ownerId: string;
    surface: EarlyAccessSecuritySurface;
    idempotencyKey: string;
    requestFingerprint: string;
  }>): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{1,160}$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;

function validateRule(rule: EarlyAccessRateRule | undefined): EarlyAccessRateRule {
  if (!rule || !Number.isSafeInteger(rule.limit) || rule.limit < 1 || rule.limit > 10_000 ||
      !Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1_000 || rule.windowMs > 24 * 60 * 60_000) {
    throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
  }
  return rule;
}

function validateRequest(input: {
  ownerId: string; surface: EarlyAccessSecuritySurface; idempotencyKey: string; requestFingerprint: string;
}): void {
  if (!UUID.test(input.ownerId) || !EARLY_ACCESS_SECURITY_SURFACES.includes(input.surface) ||
      !KEY.test(input.idempotencyKey) || !FINGERPRINT.test(input.requestFingerprint)) {
    throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
  }
}

/**
 * Database-backed, race-safe bounded-window decisions. The request row is the
 * serialization point for retries, so one idempotency key consumes at most one
 * unit even when workers race.
 */
export class PostgresDistributedAbusePolicy implements DistributedAbusePolicy {
  readonly production = true as const;
  constructor(private readonly db: Sql, private readonly rules: EarlyAccessRateRules,
    private readonly now: () => number = Date.now) {}

  async assertAllowed(input: Readonly<{
    ownerId: string; surface: EarlyAccessSecuritySurface; idempotencyKey: string; requestFingerprint: string;
  }>): Promise<void> {
    validateRequest(input);
    const rule = validateRule(this.rules[input.surface]);
    const windowStartedAt = new Date(Math.floor(this.now() / rule.windowMs) * rule.windowMs);
    let allowed: boolean;
    try {
      allowed = await this.db.begin(async tx => {
        const inserted = await tx`
          insert into web_lab_control.security_rate_limit_requests (
            owner_id, surface, idempotency_key, request_hash, window_started_at, allowed
          ) values (
            ${input.ownerId}, ${input.surface}, ${input.idempotencyKey},
            ${input.requestFingerprint}, ${windowStartedAt}, false
          )
          on conflict (owner_id, surface, idempotency_key) do nothing
          returning allowed
        `;
        if (!inserted.length) {
          const existing = await tx`
            select request_hash, allowed
            from web_lab_control.security_rate_limit_requests
            where owner_id = ${input.ownerId} and surface = ${input.surface}
              and idempotency_key = ${input.idempotencyKey}
          `;
          if (!existing.length) throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
          if (existing[0].request_hash !== input.requestFingerprint) {
            throw new EarlyAccessSecurityError("IDEMPOTENCY_CONFLICT");
          }
          return existing[0].allowed === true;
        }
        const bucket = await tx`
          insert into web_lab_control.security_rate_limit_windows (
            owner_id, surface, window_started_at, request_limit, used_count
          ) values (${input.ownerId}, ${input.surface}, ${windowStartedAt}, ${rule.limit}, 1)
          on conflict (owner_id, surface, window_started_at) do update
          set used_count = web_lab_control.security_rate_limit_windows.used_count + 1,
              updated_at = now()
          where web_lab_control.security_rate_limit_windows.request_limit = excluded.request_limit
            and web_lab_control.security_rate_limit_windows.used_count < excluded.request_limit
          returning used_count
        `;
        const decision = bucket.length === 1;
        await tx`
          update web_lab_control.security_rate_limit_requests
          set allowed = ${decision}
          where owner_id = ${input.ownerId} and surface = ${input.surface}
            and idempotency_key = ${input.idempotencyKey}
        `;
        return decision;
      });
    } catch (error) {
      if (error instanceof EarlyAccessSecurityError) throw error;
      throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
    }
    if (!allowed) throw new EarlyAccessSecurityError("RATE_LIMITED");
  }
}

/** Deterministic process-local test adapter; production composition rejects it. */
export class InMemoryDistributedAbusePolicy implements DistributedAbusePolicy {
  readonly production = false as const;
  private readonly requests = new Map<string, { fingerprint: string; allowed: boolean }>();
  private readonly windows = new Map<string, number>();

  constructor(private readonly rules: EarlyAccessRateRules, private readonly now: () => number = Date.now) {}

  async assertAllowed(input: Readonly<{
    ownerId: string; surface: EarlyAccessSecuritySurface; idempotencyKey: string; requestFingerprint: string;
  }>): Promise<void> {
    validateRequest(input);
    const rule = validateRule(this.rules[input.surface]);
    const requestKey = `${input.ownerId}:${input.surface}:${input.idempotencyKey}`;
    const existing = this.requests.get(requestKey);
    if (existing) {
      if (existing.fingerprint !== input.requestFingerprint) throw new EarlyAccessSecurityError("IDEMPOTENCY_CONFLICT");
      if (!existing.allowed) throw new EarlyAccessSecurityError("RATE_LIMITED");
      return;
    }
    const window = Math.floor(this.now() / rule.windowMs) * rule.windowMs;
    const bucketKey = `${input.ownerId}:${input.surface}:${window}`;
    const used = this.windows.get(bucketKey) ?? 0;
    const allowed = used < rule.limit;
    if (allowed) this.windows.set(bucketKey, used + 1);
    this.requests.set(requestKey, { fingerprint: input.requestFingerprint, allowed });
    if (!allowed) throw new EarlyAccessSecurityError("RATE_LIMITED");
  }
}

export const EARLY_ACCESS_SECURITY_EVENT_CODES = [
  "GENERATION_FAILED",
  "RECONCILIATION_FAILED",
  "PACKAGE_ISSUANCE_DENIED",
  "ENROLLMENT_ISSUANCE_DENIED",
  "RUNNER_OFFLINE",
  "LAUNCH_GRANT_INVALID",
  "LAUNCH_GRANT_EXPIRED",
  "LAUNCH_GRANT_REPLAYED",
  "RUNTIME_OPERATION_OUTCOME",
  "RUNTIME_CLEANUP_FAILED",
  "CAPACITY_DENIED",
  "BUDGET_DENIED",
  "SECURITY_CONTROL_UNAVAILABLE",
] as const;
export type EarlyAccessSecurityEventCode = typeof EARLY_ACCESS_SECURITY_EVENT_CODES[number];
export type EarlyAccessSecurityEvent = Readonly<{
  code: EarlyAccessSecurityEventCode;
  stage: "generation" | "reconciliation" | "runner" | "launch_exchange" | "runtime" | "admission" | "security_control";
  surface?: EarlyAccessSecuritySurface;
  runtimeMode?: "local_runner" | "byo_runtime" | "amniora_hosted";
}>;

export interface WebLabAlertSink {
  readonly production?: boolean;
  notify(event: EarlyAccessSecurityEvent): Promise<void>;
}

export class InMemoryWebLabAlertSink implements WebLabAlertSink {
  readonly production = false as const;
  readonly events: EarlyAccessSecurityEvent[] = [];
  async notify(event: EarlyAccessSecurityEvent): Promise<void> { this.events.push(structuredClone(event)); }
}

export function safeRequestFingerprint(value: Readonly<Record<string, string>>): string {
  return createHash("sha256").update(JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))).digest("hex");
}

/** Reads the authoritative account plan from the server-side profile row. */
export class PostgresProfileEntitlementPolicy implements WebLabEntitlementPolicy {
  readonly production = true as const;
  constructor(private readonly db: Sql) {}
  async planFor(actor: AuthenticatedWebLabActor): Promise<"free" | "pro"> {
    if (!UUID.test(actor.userId)) throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
    try {
      const rows = await this.db`
        select plan from public.profiles where id = ${actor.userId} limit 1
      `;
      if (rows.length !== 1 || !["free", "pro"].includes(String(rows[0].plan))) {
        throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
      }
      return rows[0].plan === "pro" ? "pro" : "free";
    } catch (error) {
      if (error instanceof EarlyAccessSecurityError) throw error;
      throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
    }
  }
}

/** Maps runtime service operations onto the shared distributed surface policy. */
export class DistributedWebLabRatePolicy implements WebLabRatePolicy {
  readonly production = true as const;
  constructor(private readonly policy: DistributedAbusePolicy) {
    if (policy.production !== true) throw new EarlyAccessSecurityError("CONTROL_UNAVAILABLE");
  }
  async assertAllowed(actor: AuthenticatedWebLabActor,
    operation: "launch" | "reset" | "grade" | "exchange", mode: RuntimeMode,
    idempotencyKey: string): Promise<void> {
    const surface = ({ launch: "runtime_launch", reset: "runtime_reset",
      grade: "runtime_grade", exchange: "launch_exchange" } as const)[operation];
    try {
      await this.policy.assertAllowed({ ownerId: actor.userId, surface, idempotencyKey,
        requestFingerprint: safeRequestFingerprint({ mode, operation }) });
    } catch (error) {
      if (error instanceof EarlyAccessSecurityError && error.code === "RATE_LIMITED") {
        const { WebLabControlError } = await import("./production-control-service");
        throw new WebLabControlError("RATE_LIMITED");
      }
      if (error instanceof EarlyAccessSecurityError && error.code === "IDEMPOTENCY_CONFLICT") {
        const { WebLabControlError } = await import("./production-control-service");
        throw new WebLabControlError("IDEMPOTENCY_CONFLICT");
      }
      const { WebLabControlError } = await import("./production-control-service");
      throw new WebLabControlError("INTERNAL_ERROR");
    }
  }
}

/** Trusted scheduler/provider entrypoint. A provider scheduler still has to call it explicitly. */
export class WebLabReconciliationAdapter {
  readonly production = true as const;
  constructor(private readonly service: WebLabControlPlaneService, private readonly alerts: WebLabAlertSink) {}
  async run(olderThan: Date) {
    if (!(olderThan instanceof Date) || !Number.isFinite(olderThan.getTime())) {
      throw new Error("reconciliation_input_invalid");
    }
    try {
      return await this.service.reconcile(olderThan);
    } catch {
      try { await this.alerts.notify({ code: "RECONCILIATION_FAILED", stage: "reconciliation" }); }
      catch { /* The scheduled operation still fails closed below. */ }
      throw new Error("reconciliation_failed");
    }
  }
}

export interface WebLabReconciliationScheduler {
  readonly production?: boolean;
  register(task: (olderThan: Date) => Promise<unknown>): void;
}

/** Explicit test adapter: registering never starts a timer or background process. */
export class ManualWebLabReconciliationScheduler implements WebLabReconciliationScheduler {
  readonly production = false as const;
  private task: ((olderThan: Date) => Promise<unknown>) | null = null;
  register(task: (olderThan: Date) => Promise<unknown>): void { this.task = task; }
  async run(olderThan: Date): Promise<unknown> {
    if (!this.task) throw new Error("reconciliation_not_registered");
    return this.task(olderThan);
  }
}
