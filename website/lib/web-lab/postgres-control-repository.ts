/** Phase 12 trusted persistence. Inject a direct Postgres connection; never import in client code. */
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { compileWebLab } from "./compiler";
import { canonicalSpecBytes, sha256 } from "./manifest";
import type { RuntimeStatus } from "./control-plane";
import type { WebLabSpec } from "./schema";

type Sql = ReturnType<typeof postgres>;
export const WEB_LAB_COMPILER_VERSION = "phase12-web-1";
export type RuntimeMode = "local_runner" | "byo_runtime" | "amniora_hosted";
export type CompletionTrust = "hosted_verified" | "local_self_hosted" | "byo_self_hosted";

export class WebLabPersistenceError extends Error {
  constructor(readonly code: string) { super(code); }
}

export type SafeBuildMetadata = Readonly<{
  id: string;
  /** Null only for retained history after its learner-facing Saved Investigation was deleted. */
  savedLabId: string | null;
  canonicalLabId: string;
  templateId: string;
  templateVersion: string;
  vulnerabilityModuleId: string;
  vulnerabilityModuleVersion: string;
  schemaVersion: number;
  compilerVersion: string;
  runtimeVersion: string;
  buildFingerprint: string;
  createdAt: string;
}>;

export type SafeRuntimeStatus = Readonly<{
  instanceId: string;
  buildId: string;
  runtimeMode: RuntimeMode;
  status: RuntimeStatus;
  generationVersion: number;
  createdAt: string;
  expiresAt: string;
  version: number;
}>;

export type OwnedHostedRuntimeStatus = SafeRuntimeStatus & Readonly<{
  savedLabId: string | null;
}>;

/** Trusted server-only view; never serialize this into an API response. */
export type InternalRuntimeState = SafeRuntimeStatus & Readonly<{
  ownerId: string;
  providerKind: string;
  runtimeVersion: string;
  backendReference: string | null;
  updatedAt: string;
  admissionState?: "reserved" | "occupied" | "releasing" | "released" | null;
  createCommandId?: string | null;
}>;

export type HostedBudgetPolicy = Readonly<{
  enabled: boolean;
  state: "NORMAL" | "WARNING" | "RESTRICTED" | "DISABLED";
  metricsObservedAt: string | null;
}>;

export type CommandLease = Readonly<{
  commandId: string;
  workerId: string;
  fenceToken: number;
  leaseUntil: string;
}>;

export type AdmissionResult = Readonly<{
  instanceId: string;
  commandId: string;
  slotNo: number;
  status: RuntimeStatus;
  replayed: boolean;
}>;

export type CommandResult = Readonly<{
  instanceId: string;
  commandId: string;
  status: RuntimeStatus;
  generationVersion: number;
  replayed: boolean;
}>;

export type GradeCommandResult = Readonly<{
  commandId: string;
  generationVersion: number;
  state: "in_progress" | "completed" | "failed";
  resultCode: string | null;
  replayed: boolean;
  completionId: string | null;
  trustLevel: CompletionTrust;
}>;

type BuildRow = {
  id: string; saved_lab_id: string | null; canonical_lab_id: string;
  seed: string;
  template_id: string; template_version: string; vulnerability_module_id: string;
  vulnerability_module_version: string; schema_version: number; compiler_version: string;
  runtime_version: string; build_fingerprint: string; learner_bundle_fingerprint: string;
  canonical_spec?: string; created_at: Date;
};

function safeBuild(row: BuildRow): SafeBuildMetadata {
  return {
    id: row.id, savedLabId: row.saved_lab_id, canonicalLabId: row.canonical_lab_id,
    templateId: row.template_id, templateVersion: row.template_version,
    vulnerabilityModuleId: row.vulnerability_module_id,
    vulnerabilityModuleVersion: row.vulnerability_module_version,
    schemaVersion: row.schema_version, compilerVersion: row.compiler_version,
    runtimeVersion: row.runtime_version, buildFingerprint: row.build_fingerprint,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function safeRuntime(row: Record<string, unknown>): SafeRuntimeStatus {
  return {
    instanceId: String(row.id), buildId: String(row.web_lab_build_id),
    runtimeMode: row.runtime_mode as RuntimeMode, status: row.lifecycle_state as RuntimeStatus,
    generationVersion: Number(row.generation_version),
    createdAt: new Date(row.created_at as Date).toISOString(),
    expiresAt: new Date(row.expires_at as Date).toISOString(), version: Number(row.version),
  };
}

function internalRuntime(row: Record<string, unknown>): InternalRuntimeState {
  return {
    ...safeRuntime(row), ownerId: String(row.owner_id), providerKind: String(row.provider_kind),
    runtimeVersion: String(row.runtime_version),
    backendReference: row.backend_reference === null ? null : String(row.backend_reference),
    updatedAt: new Date(row.updated_at as Date).toISOString(),
    admissionState: (row.admission_state ?? null) as InternalRuntimeState["admissionState"],
    createCommandId: row.create_command_id ? String(row.create_command_id) : null,
  };
}

function requireKey(value: string): void {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) {
    throw new WebLabPersistenceError("INVALID_IDEMPOTENCY_KEY");
  }
}

function activeOwnerConflict(error: unknown): boolean {
  return !!error && typeof error === "object" && "constraint_name" in error &&
    error.constraint_name === "runtime_instances_one_active_hosted_owner_idx";
}

function completionTrust(runtimeMode: RuntimeMode): CompletionTrust {
  return runtimeMode === "amniora_hosted" ? "hosted_verified"
    : runtimeMode === "local_runner" ? "local_self_hosted" : "byo_self_hosted";
}

/** No learner-facing method returns canonical_spec, backend_reference, or route_key. */
export class PostgresWebLabControlRepository {
  constructor(private readonly db: Sql) {}

  async createBuild(input: { savedLabId: string; ownerId: string; spec: WebLabSpec; runtimeVersion: string }): Promise<SafeBuildMetadata> {
    const compiled = compileWebLab(input.spec);
    const manifest = compiled.manifest;
    const bytes = canonicalSpecBytes(input.spec);
    const rows = await this.db`
      insert into web_lab_control.web_lab_builds (
        saved_lab_id, owner_id, canonical_lab_id, schema_version,
        template_id, template_version, vulnerability_module_id, vulnerability_module_version,
        seed, compiler_version, runtime_version, build_fingerprint,
        learner_bundle_fingerprint, canonical_spec
      ) values (
        ${input.savedLabId}, ${input.ownerId}, ${input.spec.labId}, ${manifest.schemaVersion},
        ${manifest.templateId}, ${manifest.templateVersion}, ${manifest.vulnerabilityId}, ${manifest.vulnerabilityVersion},
        ${manifest.seed}, ${WEB_LAB_COMPILER_VERSION}, ${input.runtimeVersion}, ${manifest.canonicalSpecSha256},
        ${manifest.learnerBundleSha256}, ${bytes}
      ) returning id, saved_lab_id, canonical_lab_id, template_id, template_version,
        vulnerability_module_id, vulnerability_module_version, schema_version,
        compiler_version, runtime_version, build_fingerprint, learner_bundle_fingerprint, created_at
    `;
    return safeBuild(rows[0] as unknown as BuildRow);
  }

  async getBuildMetadata(savedLabId: string, ownerId: string): Promise<SafeBuildMetadata | null> {
    const rows = await this.db`
      select id, saved_lab_id, canonical_lab_id, seed, template_id, template_version,
        vulnerability_module_id, vulnerability_module_version, schema_version,
        compiler_version, runtime_version, build_fingerprint, learner_bundle_fingerprint, created_at
      from web_lab_control.web_lab_builds
      where saved_lab_id = ${savedLabId} and owner_id = ${ownerId}
    `;
    return rows.length ? safeBuild(rows[0] as unknown as BuildRow) : null;
  }

  /** Safe identity for cleanup even if historical compiler artifacts are retired. */
  async getBuildMetadataById(buildId: string, ownerId: string): Promise<SafeBuildMetadata | null> {
    const rows = await this.db`
      select id, saved_lab_id, canonical_lab_id, seed, template_id, template_version,
        vulnerability_module_id, vulnerability_module_version, schema_version,
        compiler_version, runtime_version, build_fingerprint, learner_bundle_fingerprint, created_at
      from web_lab_control.web_lab_builds
      where id = ${buildId} and owner_id = ${ownerId}
    `;
    return rows.length ? safeBuild(rows[0] as unknown as BuildRow) : null;
  }

  /** Trusted control/grader only. Revalidates exact bytes and current compiler compatibility. */
  async getTrustedBuild(buildId: string, ownerId: string): Promise<{ metadata: SafeBuildMetadata; spec: WebLabSpec } | null> {
    const rows = await this.db`
      select id, saved_lab_id, canonical_lab_id, seed, template_id, template_version,
        vulnerability_module_id, vulnerability_module_version, schema_version,
        compiler_version, runtime_version, build_fingerprint, learner_bundle_fingerprint,
        canonical_spec, created_at
      from web_lab_control.web_lab_builds
      where id = ${buildId} and owner_id = ${ownerId}
    `;
    if (!rows.length) return null;
    const row = rows[0] as unknown as BuildRow;
    if (!row.canonical_spec || sha256(row.canonical_spec) !== row.build_fingerprint ||
        row.compiler_version !== WEB_LAB_COMPILER_VERSION) {
      throw new WebLabPersistenceError("LAB_INCOMPATIBLE");
    }
    let spec: WebLabSpec;
    try {
      spec = JSON.parse(row.canonical_spec) as WebLabSpec;
      const manifest = compileWebLab(spec).manifest;
      if (canonicalSpecBytes(spec) !== row.canonical_spec ||
          manifest.canonicalSpecSha256 !== row.build_fingerprint ||
          manifest.learnerBundleSha256 !== row.learner_bundle_fingerprint ||
          manifest.templateId !== row.template_id ||
          manifest.templateVersion !== row.template_version ||
          manifest.vulnerabilityId !== row.vulnerability_module_id ||
          manifest.vulnerabilityVersion !== row.vulnerability_module_version ||
          manifest.schemaVersion !== row.schema_version || spec.labId !== row.canonical_lab_id ||
          spec.seed !== row.seed) {
        throw new Error("build_identity_mismatch");
      }
    } catch {
      throw new WebLabPersistenceError("LAB_INCOMPATIBLE");
    }
    return { metadata: safeBuild(row), spec };
  }

  async admitHosted(input: {
    ownerId: string; savedLabId: string; idempotencyKey: string;
    providerKind: string; runtimeVersion: string; ttlMinutes: number;
    reservedCostGbpPence: number;
  }): Promise<AdmissionResult> {
    requireKey(input.idempotencyKey);
    if (!Number.isInteger(input.ttlMinutes) || input.ttlMinutes < 1 || input.ttlMinutes > 60 ||
        !Number.isSafeInteger(input.reservedCostGbpPence) || input.reservedCostGbpPence < 0 ||
        !/^[a-z0-9_-]{1,80}$/.test(input.providerKind)) {
      throw new WebLabPersistenceError("INVALID_ADMISSION_REQUEST");
    }
    const requestHash = sha256(JSON.stringify({ savedLabId: input.savedLabId, providerKind: input.providerKind,
      runtimeVersion: input.runtimeVersion, ttlMinutes: input.ttlMinutes,
      reservedCostGbpPence: input.reservedCostGbpPence }));
    try {
      return await this.db.begin(async tx => {
        // This row serializes idempotency and budget decisions across all workers.
        const [policy] = await tx`
          select * from web_lab_control.runtime_budget_policy where singleton_id = 1 for update
        `;
        if (!policy) throw new WebLabPersistenceError("HOSTED_DISABLED");
        const existing = await tx`
          select c.id as command_id, c.instance_id, c.request_hash,
            i.lifecycle_state, a.slot_no
          from web_lab_control.runtime_commands c
          join web_lab_control.runtime_instances i on i.id = c.instance_id
          join web_lab_control.runtime_admission a on a.command_id = c.id
          where c.owner_id = ${input.ownerId} and c.operation = 'create'
            and c.idempotency_key = ${input.idempotencyKey}
        `;
        if (existing.length) {
          if (existing[0].request_hash !== requestHash) throw new WebLabPersistenceError("IDEMPOTENCY_CONFLICT");
          return { instanceId: String(existing[0].instance_id), commandId: String(existing[0].command_id),
            slotNo: Number(existing[0].slot_no), status: existing[0].lifecycle_state as RuntimeStatus,
            replayed: true };
        }
        if (policy.budget_state === "RESTRICTED") {
          throw new WebLabPersistenceError("HOSTED_BUDGET_RESTRICTED");
        }
        if (!policy.hosted_runtime_enabled || policy.budget_state === "DISABLED" ||
            !policy.metrics_observed_at ||
            Date.now() - new Date(policy.metrics_observed_at).getTime() > 24 * 60 * 60_000) {
          throw new WebLabPersistenceError("HOSTED_DISABLED");
        }
        if (Number(policy.observed_spend_gbp_pence) + Number(policy.reserved_spend_gbp_pence) +
            input.reservedCostGbpPence >= Number(policy.disable_gbp_pence)) {
          throw new WebLabPersistenceError("HOSTED_BUDGET_EXCEEDED");
        }
        const [build] = await tx`
          select id from web_lab_control.web_lab_builds
          where saved_lab_id = ${input.savedLabId} and owner_id = ${input.ownerId}
        `;
        if (!build) throw new WebLabPersistenceError("LAB_NOT_FOUND");
        // The service has already verified the immutable build through its
        // explicit compatibility policy. runtime_version below identifies the
        // selected backend implementation, not the build's portable bundle ABI.
        const active = await tx`
          select id from web_lab_control.runtime_instances
          where owner_id = ${input.ownerId} and runtime_mode = 'amniora_hosted'
            and lifecycle_state in ('requested','provisioning','ready','resetting','expiring','destroying')
          limit 1
        `;
        if (active.length) throw new WebLabPersistenceError("RUNTIME_ALREADY_ACTIVE");
        const [slot] = await tx`
          select slot_no from web_lab_control.runtime_admission_slots
          where instance_id is null order by slot_no limit 1 for update skip locked
        `;
        if (!slot) throw new WebLabPersistenceError("HOSTED_CAPACITY_FULL");
        const routeKey = randomBytes(24).toString("base64url");
        const [instance] = await tx`
          insert into web_lab_control.runtime_instances (
            owner_id, web_lab_build_id, runtime_mode, provider_kind, runtime_version,
            lifecycle_state, route_key, expires_at
          ) values (
            ${input.ownerId}, ${build.id}, 'amniora_hosted', ${input.providerKind}, ${input.runtimeVersion},
            'requested', ${routeKey}, now() + ${input.ttlMinutes} * interval '1 minute'
          ) returning id
        `;
        const [command] = await tx`
          insert into web_lab_control.runtime_commands (
            instance_id, owner_id, operation, idempotency_key, request_hash, generation_version
          ) values (${instance.id}, ${input.ownerId}, 'create', ${input.idempotencyKey}, ${requestHash}, 1)
          returning id
        `;
        await tx`
          update web_lab_control.runtime_admission_slots
          set instance_id = ${instance.id}, reserved_at = now(), updated_at = now()
          where slot_no = ${slot.slot_no} and instance_id is null
        `;
        await tx`
          insert into web_lab_control.runtime_admission (
            instance_id, owner_id, web_lab_build_id, command_id, slot_no,
            reserved_cost_gbp_pence, reserved_minutes, expires_at
          ) values (
            ${instance.id}, ${input.ownerId}, ${build.id}, ${command.id}, ${slot.slot_no},
            ${input.reservedCostGbpPence}, ${input.ttlMinutes}, now() + ${input.ttlMinutes} * interval '1 minute'
          )
        `;
        await tx`
          update web_lab_control.runtime_budget_policy
          set reserved_spend_gbp_pence = reserved_spend_gbp_pence + ${input.reservedCostGbpPence},
            version = version + 1, updated_at = now()
          where singleton_id = 1
        `;
        await tx`
          insert into web_lab_control.runtime_audit_events
            (instance_id, command_id, owner_id, event_type, generation_version, result)
          values (${instance.id}, ${command.id}, ${input.ownerId}, 'admission_reserved', 1, 'ok')
        `;
        return { instanceId: String(instance.id), commandId: String(command.id),
          slotNo: Number(slot.slot_no), status: "requested" as const, replayed: false };
      });
    } catch (error) {
      if (activeOwnerConflict(error)) throw new WebLabPersistenceError("RUNTIME_ALREADY_ACTIVE");
      throw error;
    }
  }

  async getRuntimeForOwner(instanceId: string, ownerId: string): Promise<SafeRuntimeStatus | null> {
    const rows = await this.db`
      select id, web_lab_build_id, runtime_mode, lifecycle_state,
        generation_version, created_at, expires_at, version
      from web_lab_control.runtime_instances
      where id = ${instanceId} and owner_id = ${ownerId}
    `;
    return rows.length ? safeRuntime(rows[0]) : null;
  }

  /** Product recovery lookup. Provider identity and references never leave this repository boundary. */
  async getLatestHostedRuntimeForSavedLab(ownerId: string, savedLabId: string): Promise<SafeRuntimeStatus | null> {
    const rows = await this.db`
      select i.id, i.web_lab_build_id, i.runtime_mode, i.lifecycle_state,
        i.generation_version, i.created_at, i.expires_at, i.version
      from web_lab_control.runtime_instances i
      join web_lab_control.web_lab_builds b on b.id = i.web_lab_build_id
      where i.owner_id = ${ownerId} and b.owner_id = ${ownerId}
        and b.saved_lab_id = ${savedLabId} and i.runtime_mode = 'amniora_hosted'
      order by i.created_at desc
      limit 1
    `;
    return rows.length ? safeRuntime(rows[0]) : null;
  }

  /** Enforces the one-active-hosted-lab product state without exposing another Saved Lab to the browser. */
  async getActiveHostedRuntimeForOwner(ownerId: string): Promise<OwnedHostedRuntimeStatus | null> {
    const rows = await this.db`
      select i.id, i.web_lab_build_id, i.runtime_mode, i.lifecycle_state,
        i.generation_version, i.created_at, i.expires_at, i.version,
        b.saved_lab_id
      from web_lab_control.runtime_instances i
      join web_lab_control.web_lab_builds b on b.id = i.web_lab_build_id
      where i.owner_id = ${ownerId} and b.owner_id = ${ownerId}
        and i.runtime_mode = 'amniora_hosted'
        and i.lifecycle_state in ('requested','provisioning','ready','resetting','expiring','destroying')
      order by i.created_at desc
      limit 1
    `;
    return rows.length ? { ...safeRuntime(rows[0]),
      savedLabId: rows[0].saved_lab_id === null ? null : String(rows[0].saved_lab_id) } : null;
  }

  async hasAvailableHostedSlot(): Promise<boolean> {
    const rows = await this.db`
      select slot_no from web_lab_control.runtime_admission_slots
      where instance_id is null
      limit 1
    `;
    return rows.length > 0;
  }

  async getRuntimeControl(instanceId: string, ownerId: string): Promise<InternalRuntimeState | null> {
    const rows = await this.db`
      select i.id, i.owner_id, i.web_lab_build_id, i.runtime_mode, i.provider_kind,
        i.runtime_version, i.lifecycle_state, i.backend_reference,
        i.generation_version, i.created_at, i.updated_at, i.expires_at, i.version,
        a.state as admission_state, a.command_id as create_command_id
      from web_lab_control.runtime_instances i
      left join web_lab_control.runtime_admission a on a.instance_id = i.id
      where i.id = ${instanceId} and i.owner_id = ${ownerId}
    `;
    return rows.length ? internalRuntime(rows[0]) : null;
  }

  async getRuntimeForReconciliation(instanceId: string): Promise<InternalRuntimeState | null> {
    const rows = await this.db`
      select i.id, i.owner_id, i.web_lab_build_id, i.runtime_mode, i.provider_kind,
        i.runtime_version, i.lifecycle_state, i.backend_reference,
        i.generation_version, i.created_at, i.updated_at, i.expires_at, i.version,
        a.state as admission_state, a.command_id as create_command_id
      from web_lab_control.runtime_instances i
      left join web_lab_control.runtime_admission a on a.instance_id = i.id
      where i.id = ${instanceId}
    `;
    return rows.length ? internalRuntime(rows[0]) : null;
  }

  async getHostedBudgetPolicy(): Promise<HostedBudgetPolicy> {
    const [row] = await this.db`
      select hosted_runtime_enabled, budget_state, metrics_observed_at
      from web_lab_control.runtime_budget_policy where singleton_id = 1
    `;
    if (!row) throw new WebLabPersistenceError("HOSTED_DISABLED");
    return { enabled: Boolean(row.hosted_runtime_enabled), state: row.budget_state as HostedBudgetPolicy["state"],
      metricsObservedAt: row.metrics_observed_at ? new Date(row.metrics_observed_at as Date).toISOString() : null };
  }

  /** Persists a future Local/BYO instance; this does not provision a runner or tunnel. */
  async createSelfHostedRuntime(input: {
    ownerId: string; savedLabId: string; runtimeMode: "local_runner" | "byo_runtime";
    providerKind: string; runtimeVersion: string; ttlMinutes: number;
  }): Promise<SafeRuntimeStatus> {
    if (!(["local_runner", "byo_runtime"] as const).includes(input.runtimeMode) ||
        !/^[a-z0-9_-]{1,80}$/.test(input.providerKind) ||
        !Number.isInteger(input.ttlMinutes) || input.ttlMinutes < 1 || input.ttlMinutes > 1440) {
      throw new WebLabPersistenceError("INVALID_RUNTIME_REQUEST");
    }
    const rows = await this.db`
      insert into web_lab_control.runtime_instances (
        owner_id, web_lab_build_id, runtime_mode, provider_kind, runtime_version,
        lifecycle_state, route_key, expires_at
      )
      select ${input.ownerId}, b.id, ${input.runtimeMode}, ${input.providerKind},
        ${input.runtimeVersion}, 'requested', ${randomBytes(24).toString("base64url")},
        now() + ${input.ttlMinutes} * interval '1 minute'
      from web_lab_control.web_lab_builds b
      where b.saved_lab_id = ${input.savedLabId} and b.owner_id = ${input.ownerId}
        and b.runtime_version = ${input.runtimeVersion}
      returning id, web_lab_build_id, runtime_mode, lifecycle_state,
        generation_version, created_at, expires_at, version
    `;
    if (!rows.length) throw new WebLabPersistenceError("LAB_NOT_FOUND_OR_INCOMPATIBLE");
    return safeRuntime(rows[0]);
  }

  /** Trusted reconciliation query; includes internal backend identity. */
  async listReconciliationCandidates(olderThan: Date): Promise<readonly InternalRuntimeState[]> {
    const rows = await this.db`
      select i.id, i.owner_id, i.web_lab_build_id, i.runtime_mode, i.provider_kind,
        i.lifecycle_state, i.backend_reference, i.generation_version, i.created_at,
        i.runtime_version, i.version, i.expires_at, i.updated_at,
        a.state as admission_state, a.command_id as create_command_id
      from web_lab_control.runtime_instances i
      left join web_lab_control.runtime_admission a on a.instance_id = i.id
      where (i.lifecycle_state in ('requested','provisioning','resetting','expiring','destroying')
             and i.updated_at <= ${olderThan})
         or (i.lifecycle_state = 'ready' and
             (i.expires_at <= now() or coalesce(i.last_reconciled_at, i.updated_at) <= ${olderThan}))
         or (i.lifecycle_state in ('failed','expired','destroyed')
             and a.state in ('reserved','occupied','releasing'))
      order by i.updated_at, i.id
    `;
    return rows.map(internalRuntime);
  }

  async transitionRuntime(input: {
    instanceId: string; ownerId: string; expectedVersion: number; status: RuntimeStatus;
    backendReference?: string | null; failureCode?: string | null;
    generationVersion?: number; auditEvent: string; commandLease?: CommandLease;
  }): Promise<SafeRuntimeStatus> {
    const hasBackendReference = Object.hasOwn(input, "backendReference");
    const hasFailureCode = Object.hasOwn(input, "failureCode");
    return this.db.begin(async tx => {
      const rows = await tx`
        update web_lab_control.runtime_instances
        set lifecycle_state = ${input.status},
          backend_reference = case when ${hasBackendReference} then ${input.backendReference ?? null} else backend_reference end,
          failure_code = case when ${hasFailureCode} then ${input.failureCode ?? null} else failure_code end,
          generation_version = coalesce(${input.generationVersion ?? null}, generation_version),
          ready_at = case when ${input.status} = 'ready' then now() else ready_at end,
          destroyed_at = case when ${input.status} = 'destroyed' then now() else destroyed_at end,
          last_reconciled_at = now(), version = version + 1
        where id = ${input.instanceId} and owner_id = ${input.ownerId} and version = ${input.expectedVersion}
          and (${!input.commandLease} or exists (
            select 1 from web_lab_control.runtime_commands c
            where c.id = ${input.commandLease?.commandId ?? null}
              and c.instance_id = ${input.instanceId} and c.owner_id = ${input.ownerId}
              and c.state = 'in_progress' and c.lease_owner = ${input.commandLease?.workerId ?? null}
              and c.fence_token = ${input.commandLease?.fenceToken ?? null}
              and c.lease_until > now()
          ))
        returning id, web_lab_build_id, runtime_mode, lifecycle_state,
          generation_version, created_at, expires_at, version
      `;
      if (!rows.length) throw new WebLabPersistenceError("STALE_RUNTIME_VERSION");
      if (input.status === "ready") {
        await tx`
          update web_lab_control.runtime_admission set state = 'occupied'
          where instance_id = ${input.instanceId} and state in ('reserved', 'occupied')
        `;
      } else if (input.status === "destroying" || input.status === "expiring") {
        await tx`
          update web_lab_control.runtime_admission set state = 'releasing'
          where instance_id = ${input.instanceId} and state in ('reserved', 'occupied', 'releasing')
        `;
      }
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, owner_id, event_type, generation_version, result)
        values (${input.instanceId}, ${input.ownerId}, ${input.auditEvent},
          ${rows[0].generation_version}, 'ok')
      `;
      return safeRuntime(rows[0]);
    });
  }

  async markRuntimeObservedReady(input: {
    instanceId: string; ownerId: string; expectedVersion: number;
  }): Promise<SafeRuntimeStatus> {
    const rows = await this.db`
      update web_lab_control.runtime_instances
      set last_reconciled_at = now(), version = version + 1
      where id = ${input.instanceId} and owner_id = ${input.ownerId}
        and version = ${input.expectedVersion} and lifecycle_state = 'ready'
      returning id, web_lab_build_id, runtime_mode, lifecycle_state,
        generation_version, created_at, expires_at, version
    `;
    if (!rows.length) throw new WebLabPersistenceError("STALE_RUNTIME_VERSION");
    return safeRuntime(rows[0]);
  }

  async requestReset(input: { instanceId: string; ownerId: string; idempotencyKey: string; expectedVersion: number; maxResets?: number }): Promise<CommandResult> {
    requireKey(input.idempotencyKey);
    const maxResets = input.maxResets ?? 3;
    if (!Number.isInteger(maxResets) || maxResets < 0 || maxResets > 3) {
      throw new WebLabPersistenceError("INVALID_RESET_LIMIT");
    }
    const requestHash = sha256(JSON.stringify({ instanceId: input.instanceId, operation: "reset" }));
    return this.db.begin(async tx => {
      const [instance] = await tx`
        select * from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId} for update
      `;
      if (!instance) throw new WebLabPersistenceError("RUNTIME_NOT_FOUND");
      const [existing] = await tx`
        select id, request_hash, generation_version from web_lab_control.runtime_commands
        where owner_id = ${input.ownerId} and operation = 'reset'
          and idempotency_key = ${input.idempotencyKey}
      `;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new WebLabPersistenceError("IDEMPOTENCY_CONFLICT");
        return { instanceId: input.instanceId, commandId: String(existing.id),
          status: instance.lifecycle_state as RuntimeStatus,
          generationVersion: Number(existing.generation_version), replayed: true };
      }
      if (Number(instance.version) !== input.expectedVersion) throw new WebLabPersistenceError("STALE_RUNTIME_VERSION");
      if (instance.lifecycle_state !== "ready") throw new WebLabPersistenceError("RUNTIME_NOT_READY");
      if (instance.runtime_mode === "amniora_hosted" && Number(instance.generation_version) > maxResets) {
        throw new WebLabPersistenceError("RESET_LIMIT_EXCEEDED");
      }
      const nextGeneration = Number(instance.generation_version) + 1;
      await tx`
        update web_lab_control.runtime_instances
        set lifecycle_state = 'resetting', generation_version = ${nextGeneration}, version = version + 1
        where id = ${input.instanceId} and owner_id = ${input.ownerId} and version = ${input.expectedVersion}
      `;
      const [command] = await tx`
        insert into web_lab_control.runtime_commands (
          instance_id, owner_id, operation, idempotency_key, request_hash, generation_version
        ) values (${input.instanceId}, ${input.ownerId}, 'reset', ${input.idempotencyKey}, ${requestHash}, ${nextGeneration})
        returning id
      `;
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, command_id, owner_id, event_type, generation_version, result)
        values (${input.instanceId}, ${command.id}, ${input.ownerId}, 'reset_requested', ${nextGeneration}, 'ok')
      `;
      return { instanceId: input.instanceId, commandId: String(command.id),
        status: "resetting" as const, generationVersion: nextGeneration, replayed: false };
    });
  }

  async requestDestroy(input: { instanceId: string; ownerId: string; idempotencyKey: string; expectedVersion: number }): Promise<CommandResult> {
    requireKey(input.idempotencyKey);
    const requestHash = sha256(JSON.stringify({ instanceId: input.instanceId, operation: "destroy" }));
    return this.db.begin(async tx => {
      const [instance] = await tx`
        select * from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId} for update
      `;
      if (!instance) throw new WebLabPersistenceError("RUNTIME_NOT_FOUND");
      const [existing] = await tx`
        select id, request_hash, generation_version from web_lab_control.runtime_commands
        where owner_id = ${input.ownerId} and operation = 'destroy'
          and idempotency_key = ${input.idempotencyKey}
      `;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new WebLabPersistenceError("IDEMPOTENCY_CONFLICT");
        return { instanceId: input.instanceId, commandId: String(existing.id),
          status: instance.lifecycle_state as RuntimeStatus,
          generationVersion: Number(existing.generation_version), replayed: true };
      }
      if (Number(instance.version) !== input.expectedVersion) throw new WebLabPersistenceError("STALE_RUNTIME_VERSION");
      const alreadyDestroyed = instance.lifecycle_state === "destroyed";
      if (instance.lifecycle_state === "destroying") throw new WebLabPersistenceError("COMMAND_IN_PROGRESS");
      if (!alreadyDestroyed) {
        await tx`
          update web_lab_control.runtime_instances
          set lifecycle_state = 'destroying', version = version + 1
          where id = ${input.instanceId} and owner_id = ${input.ownerId} and version = ${input.expectedVersion}
        `;
        await tx`
          update web_lab_control.runtime_admission set state = 'releasing'
          where instance_id = ${input.instanceId} and state in ('reserved', 'occupied', 'releasing')
        `;
      }
      const [command] = await tx`
        insert into web_lab_control.runtime_commands (
          instance_id, owner_id, operation, idempotency_key, request_hash,
          generation_version, state, result_code, completed_at
        ) values (${input.instanceId}, ${input.ownerId}, 'destroy', ${input.idempotencyKey}, ${requestHash},
          ${instance.generation_version}, ${alreadyDestroyed ? "completed" : "in_progress"},
          ${alreadyDestroyed ? "already_destroyed" : null}, ${alreadyDestroyed ? new Date() : null})
        returning id
      `;
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, command_id, owner_id, event_type, generation_version, result)
        values (${input.instanceId}, ${command.id}, ${input.ownerId}, 'destroy_requested',
          ${instance.generation_version}, 'ok')
      `;
      return { instanceId: input.instanceId, commandId: String(command.id),
        status: alreadyDestroyed ? "destroyed" as const : "destroying" as const,
        generationVersion: Number(instance.generation_version), replayed: false };
    });
  }

  /** Reserves one owner/runtime/generation-bound grade command before observer work. */
  async requestGrade(input: { instanceId: string; ownerId: string;
    idempotencyKey: string }): Promise<GradeCommandResult> {
    requireKey(input.idempotencyKey);
    return this.db.begin(async tx => {
      const [instance] = await tx`
        select id, owner_id, web_lab_build_id, runtime_mode, lifecycle_state,
          generation_version, expires_at > now() as unexpired
        from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId}
        for update
      `;
      if (!instance) throw new WebLabPersistenceError("RUNTIME_NOT_FOUND");
      const requestHash = sha256(JSON.stringify({ instanceId: input.instanceId,
        buildId: instance.web_lab_build_id, generationVersion: Number(instance.generation_version),
        operation: "grade" }));
      const [existing] = await tx`
        select id, instance_id, request_hash, generation_version, state, result_code
        from web_lab_control.runtime_commands
        where owner_id = ${input.ownerId} and operation = 'grade'
          and idempotency_key = ${input.idempotencyKey}
      `;
      const trustLevel = completionTrust(instance.runtime_mode as RuntimeMode);
      if (existing) {
        if (existing.request_hash !== requestHash || existing.instance_id !== input.instanceId ||
            Number(existing.generation_version) !== Number(instance.generation_version)) {
          throw new WebLabPersistenceError("IDEMPOTENCY_CONFLICT");
        }
        let completionId: string | null = null;
        if (existing.state === "completed" && existing.result_code === "pass") {
          const [completion] = await tx`
            select id from web_lab_control.web_lab_completions
            where owner_id = ${input.ownerId} and web_lab_build_id = ${instance.web_lab_build_id}
              and trust_level = ${trustLevel}
          `;
          if (!completion) throw new WebLabPersistenceError("GRADE_RESULT_MISSING");
          completionId = String(completion.id);
        }
        return { commandId: String(existing.id),
          generationVersion: Number(existing.generation_version),
          state: existing.state as GradeCommandResult["state"],
          resultCode: existing.result_code ? String(existing.result_code) : null,
          replayed: true, completionId, trustLevel };
      }
      if (instance.lifecycle_state !== "ready" || instance.unexpired !== true) {
        throw new WebLabPersistenceError("RUNTIME_NOT_READY");
      }
      const [command] = await tx`
        insert into web_lab_control.runtime_commands (
          instance_id, owner_id, operation, idempotency_key, request_hash, generation_version
        ) values (${input.instanceId}, ${input.ownerId}, 'grade', ${input.idempotencyKey},
          ${requestHash}, ${instance.generation_version})
        returning id
      `;
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, command_id, owner_id, event_type, generation_version, result)
        values (${input.instanceId}, ${command.id}, ${input.ownerId}, 'grade_requested',
          ${instance.generation_version}, 'ok')
      `;
      return { commandId: String(command.id), generationVersion: Number(instance.generation_version),
        state: "in_progress" as const, resultCode: null, replayed: false,
        completionId: null, trustLevel };
    });
  }

  /** Atomically records the attempt/completion/audit and closes its grade command. */
  async recordGradeCommand(input: {
    commandLease: CommandLease; instanceId: string; ownerId: string;
    outcome: "pass" | "not_complete" | "error";
    graderVersion: string; observationFingerprint?: string;
  }): Promise<{ attemptId: string; completionId: string | null; trustLevel: CompletionTrust }> {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.graderVersion) ||
        (input.outcome === "pass") !== /^[0-9a-f]{64}$/.test(input.observationFingerprint ?? "")) {
      throw new WebLabPersistenceError("INVALID_GRADE_RESULT");
    }
    return this.db.begin(async tx => {
      const [command] = await tx`
        select id, instance_id, owner_id, operation, state, generation_version,
          lease_owner, lease_until > now() as lease_valid, fence_token
        from web_lab_control.runtime_commands
        where id = ${input.commandLease.commandId} for update
      `;
      if (!command || command.instance_id !== input.instanceId || command.owner_id !== input.ownerId ||
          command.operation !== "grade" || command.state !== "in_progress" ||
          command.lease_owner !== input.commandLease.workerId ||
          Number(command.fence_token) !== input.commandLease.fenceToken ||
          command.lease_valid !== true) {
        throw new WebLabPersistenceError("STALE_COMMAND_LEASE");
      }
      const [instance] = await tx`
        select id, web_lab_build_id, runtime_mode, lifecycle_state, generation_version,
          expires_at > now() as unexpired
        from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId} for update
      `;
      if (!instance) throw new WebLabPersistenceError("RUNTIME_NOT_FOUND");
      if (instance.lifecycle_state !== "ready" ||
          Number(instance.generation_version) !== Number(command.generation_version) ||
          instance.unexpired !== true) {
        throw new WebLabPersistenceError("RUNTIME_NOT_READY");
      }
      const trustLevel = completionTrust(instance.runtime_mode as RuntimeMode);
      const [attempt] = await tx`
        insert into web_lab_control.web_lab_grade_attempts (
          instance_id, owner_id, web_lab_build_id, trust_level, outcome,
          grader_version, observation_fingerprint
        ) values (${input.instanceId}, ${input.ownerId}, ${instance.web_lab_build_id},
          ${trustLevel}, ${input.outcome}, ${input.graderVersion},
          ${input.observationFingerprint ?? null}) returning id
      `;
      let completionId: string | null = null;
      if (input.outcome === "pass") {
        const fingerprint = sha256(JSON.stringify({ ownerId: input.ownerId,
          buildId: instance.web_lab_build_id, instanceId: input.instanceId,
          gradeId: attempt.id, trustLevel, graderVersion: input.graderVersion,
          observationFingerprint: input.observationFingerprint }));
        const [completion] = await tx`
          insert into web_lab_control.web_lab_completions (
            owner_id, web_lab_build_id, runtime_instance_id, trusted_grade_id,
            trust_level, grader_version, completion_fingerprint
          ) values (${input.ownerId}, ${instance.web_lab_build_id}, ${input.instanceId},
            ${attempt.id}, ${trustLevel}, ${input.graderVersion}, ${fingerprint})
          on conflict (owner_id, web_lab_build_id, trust_level) do nothing
          returning id
        `;
        if (completion) completionId = String(completion.id);
        else {
          const [existing] = await tx`
            select id from web_lab_control.web_lab_completions
            where owner_id = ${input.ownerId} and web_lab_build_id = ${instance.web_lab_build_id}
              and trust_level = ${trustLevel}
          `;
          if (!existing) throw new WebLabPersistenceError("GRADE_RESULT_MISSING");
          completionId = String(existing.id);
        }
      }
      const closed = await tx`
        update web_lab_control.runtime_commands
        set state = ${input.outcome === "error" ? "failed" : "completed"},
          result_code = ${input.outcome}, completed_at = now(),
          lease_owner = null, lease_until = null
        where id = ${input.commandLease.commandId} and state = 'in_progress'
          and lease_owner = ${input.commandLease.workerId}
          and fence_token = ${input.commandLease.fenceToken}
          and lease_until > now()
        returning id
      `;
      if (!closed.length) throw new WebLabPersistenceError("STALE_COMMAND_LEASE");
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, command_id, owner_id, event_type, result, generation_version, safe_code)
        values (${input.instanceId}, ${input.commandLease.commandId}, ${input.ownerId},
          ${input.outcome === "pass" ? "grade_succeeded" : "grade_attempted"},
          ${input.outcome === "error" ? "failed" : "ok"}, ${instance.generation_version},
          ${input.outcome === "error" ? "grader_unavailable" : null})
      `;
      return { attemptId: String(attempt.id), completionId, trustLevel };
    });
  }

  /** Called only after trusted provider inspection confirms the runtime is absent. */
  async releaseAdmissionAfterProviderAbsence(input: { instanceId: string; ownerId: string; providerAbsentConfirmed: true }): Promise<boolean> {
    if (input.providerAbsentConfirmed !== true) throw new WebLabPersistenceError("PROVIDER_ABSENCE_REQUIRED");
    return this.db.begin(async tx => {
      const [policy] = await tx`
        select singleton_id from web_lab_control.runtime_budget_policy where singleton_id = 1 for update
      `;
      if (!policy) throw new WebLabPersistenceError("HOSTED_DISABLED");
      const [admission] = await tx`
        select a.* from web_lab_control.runtime_admission a
        where a.instance_id = ${input.instanceId} and a.owner_id = ${input.ownerId} for update
      `;
      if (!admission || admission.state === "released") return false;
      const [instance] = await tx`
        select lifecycle_state from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId}
      `;
      if (!instance || !["failed", "destroyed", "expired"].includes(instance.lifecycle_state)) {
        throw new WebLabPersistenceError("RUNTIME_NOT_TERMINAL");
      }
      const [slot] = await tx`
        select instance_id from web_lab_control.runtime_admission_slots
        where slot_no = ${admission.slot_no} for update
      `;
      if (!slot || slot.instance_id !== input.instanceId) throw new WebLabPersistenceError("ADMISSION_SLOT_MISMATCH");
      await tx`
        update web_lab_control.runtime_admission
        set state = 'released', released_at = now()
        where id = ${admission.id}
      `;
      await tx`
        update web_lab_control.runtime_admission_slots
        set instance_id = null, reserved_at = null, updated_at = now()
        where slot_no = ${admission.slot_no}
      `;
      const budgetUpdate = await tx`
        update web_lab_control.runtime_budget_policy
        set reserved_spend_gbp_pence = reserved_spend_gbp_pence - ${admission.reserved_cost_gbp_pence},
          version = version + 1, updated_at = now()
        where singleton_id = 1 and reserved_spend_gbp_pence >= ${admission.reserved_cost_gbp_pence}
        returning singleton_id
      `;
      if (!budgetUpdate.length) throw new WebLabPersistenceError("BUDGET_RESERVATION_MISMATCH");
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, owner_id, event_type, generation_version, result)
        select id, owner_id, 'admission_released', generation_version, 'ok'
        from web_lab_control.runtime_instances where id = ${input.instanceId}
      `;
      return true;
    });
  }

  async claimPendingCommand(workerId: string, leaseSeconds = 30): Promise<Record<string, unknown> | null> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(workerId) || !Number.isInteger(leaseSeconds) ||
        leaseSeconds < 1 || leaseSeconds > 300) throw new WebLabPersistenceError("INVALID_WORKER_LEASE");
    const rows = await this.db`
      update web_lab_control.runtime_commands c
      set lease_owner = ${workerId}, lease_until = now() + ${leaseSeconds} * interval '1 second',
        fence_token = fence_token + 1, started_at = coalesce(started_at, now())
      where c.id = (
        select id from web_lab_control.runtime_commands
        where state = 'in_progress' and (lease_until is null or lease_until < now())
        order by created_at, id limit 1 for update skip locked
      )
      returning id, instance_id, owner_id, operation, generation_version,
        lease_until, fence_token
    `;
    return rows[0] ?? null;
  }

  async findPendingCommand(instanceId: string, operation: "create" | "reset" | "destroy"): Promise<string | null> {
    const [row] = await this.db`
      select id from web_lab_control.runtime_commands
      where instance_id = ${instanceId} and operation = ${operation} and state = 'in_progress'
      order by created_at desc, id desc limit 1
    `;
    return row ? String(row.id) : null;
  }

  async claimCommandById(commandId: string, workerId: string, leaseSeconds = 300): Promise<CommandLease | null> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(workerId) || !Number.isInteger(leaseSeconds) ||
        leaseSeconds < 1 || leaseSeconds > 300) throw new WebLabPersistenceError("INVALID_WORKER_LEASE");
    const [row] = await this.db`
      update web_lab_control.runtime_commands
      set lease_owner = ${workerId}, lease_until = now() + ${leaseSeconds} * interval '1 second',
        fence_token = fence_token + 1, started_at = coalesce(started_at, now())
      where id = ${commandId} and state = 'in_progress'
        and (lease_until is null or lease_until < now())
      returning id, lease_owner, lease_until, fence_token
    `;
    return row ? { commandId: String(row.id), workerId: String(row.lease_owner),
      fenceToken: Number(row.fence_token), leaseUntil: new Date(row.lease_until as Date).toISOString() } : null;
  }

  /** A stale worker cannot acknowledge a command after a newer lease takes over. */
  async completeCommand(input: {
    commandId: string; workerId: string; fenceToken: number;
    outcome: "completed" | "failed"; resultCode: string;
  }): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(input.workerId) ||
        !Number.isSafeInteger(input.fenceToken) || input.fenceToken < 1 ||
        !/^[a-z0-9_:-]{1,80}$/.test(input.resultCode)) {
      throw new WebLabPersistenceError("INVALID_COMMAND_COMPLETION");
    }
    const rows = await this.db`
      update web_lab_control.runtime_commands
      set state = ${input.outcome}, result_code = ${input.resultCode},
        completed_at = now(), lease_owner = null, lease_until = null
      where id = ${input.commandId} and state = 'in_progress'
        and lease_owner = ${input.workerId} and fence_token = ${input.fenceToken}
        and lease_until > now()
      returning id
    `;
    if (!rows.length) throw new WebLabPersistenceError("STALE_COMMAND_LEASE");
  }

  async appendAudit(input: {
    instanceId: string; ownerId: string; commandId?: string;
    eventType: string; generationVersion: number;
    result: "ok" | "failed" | "denied"; safeCode?: string;
  }): Promise<void> {
    if (!/^[a-z0-9_]{1,80}$/.test(input.eventType) ||
        (input.safeCode && !/^[a-z0-9_:-]{1,80}$/.test(input.safeCode))) {
      throw new WebLabPersistenceError("INVALID_AUDIT_EVENT");
    }
    await this.db`
      insert into web_lab_control.runtime_audit_events
        (instance_id, command_id, owner_id, event_type, generation_version, result, safe_code)
      values (${input.instanceId}, ${input.commandId ?? null}, ${input.ownerId},
        ${input.eventType}, ${input.generationVersion}, ${input.result}, ${input.safeCode ?? null})
    `;
  }

  /** Atomic, owner/generation-bound replay check. Only grant ID digests are persisted. */
  async consumeLaunchGrant(input: {
    grantIdHash: string; instanceId: string; ownerId: string;
    generationVersion: number; expiresAt: Date;
  }): Promise<"consumed" | "replayed" | "not_ready"> {
    if (!/^[0-9a-f]{64}$/.test(input.grantIdHash)) throw new WebLabPersistenceError("INVALID_LAUNCH_GRANT");
    return this.db.begin(async tx => {
      const [runtime] = await tx`
        select id from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId}
          and lifecycle_state = 'ready' and generation_version = ${input.generationVersion}
          and expires_at > now() and ${input.expiresAt} > now()
        for share
      `;
      if (!runtime) return "not_ready" as const;
      const rows = await tx`
        insert into web_lab_control.runtime_launch_exchanges
          (grant_id_hash, instance_id, owner_id, generation_version, expires_at)
        values (${input.grantIdHash}, ${input.instanceId}, ${input.ownerId},
          ${input.generationVersion}, ${input.expiresAt})
        on conflict (grant_id_hash) do nothing
        returning grant_id_hash
      `;
      if (rows.length) {
        await tx`
          insert into web_lab_control.runtime_audit_events
            (instance_id, owner_id, event_type, generation_version, result)
          values (${input.instanceId}, ${input.ownerId}, 'launch_grant_exchanged',
            ${input.generationVersion}, 'ok')
        `;
      }
      return rows.length ? "consumed" as const : "replayed" as const;
    });
  }

  async recordUsage(input: {
    instanceId: string; providerKind: string; generationVersion: number;
    windowStartedAt: Date; windowEndedAt: Date; provisionedSeconds: number;
    activeCpuMs: number; memoryMbSeconds: number; ingressBytes: number;
    egressBytes: number; graderMs: number; measurementSource: string;
    externalSampleId?: string;
  }): Promise<string> {
    const [row] = await this.db`
      insert into web_lab_control.runtime_usage (
        instance_id, provider_kind, generation_version, window_started_at, window_ended_at,
        provisioned_seconds, active_cpu_ms, memory_mb_seconds, ingress_bytes,
        egress_bytes, grader_ms, measurement_source, external_sample_id
      ) values (${input.instanceId}, ${input.providerKind}, ${input.generationVersion},
        ${input.windowStartedAt}, ${input.windowEndedAt}, ${input.provisionedSeconds},
        ${input.activeCpuMs}, ${input.memoryMbSeconds}, ${input.ingressBytes},
        ${input.egressBytes}, ${input.graderMs}, ${input.measurementSource},
        ${input.externalSampleId ?? null}) returning id
    `;
    return String(row.id);
  }

  /** Trusted grader path only. The trust level is derived from the stored runtime mode. */
  async recordGrade(input: {
    instanceId: string; ownerId: string; outcome: "pass" | "not_complete" | "error";
    graderVersion: string; observationFingerprint?: string;
  }): Promise<{ attemptId: string; completionId: string | null; trustLevel: CompletionTrust }> {
    return this.db.begin(async tx => {
      const [instance] = await tx`
        select id, web_lab_build_id, runtime_mode, lifecycle_state
        from web_lab_control.runtime_instances
        where id = ${input.instanceId} and owner_id = ${input.ownerId} for update
      `;
      if (!instance) throw new WebLabPersistenceError("RUNTIME_NOT_FOUND");
      if (instance.lifecycle_state !== "ready") throw new WebLabPersistenceError("RUNTIME_NOT_READY");
      const trustLevel = completionTrust(instance.runtime_mode as RuntimeMode);
      const [attempt] = await tx`
        insert into web_lab_control.web_lab_grade_attempts (
          instance_id, owner_id, web_lab_build_id, trust_level, outcome,
          grader_version, observation_fingerprint
        ) values (${input.instanceId}, ${input.ownerId}, ${instance.web_lab_build_id},
          ${trustLevel}, ${input.outcome}, ${input.graderVersion},
          ${input.observationFingerprint ?? null}) returning id
      `;
      let completionId: string | null = null;
      if (input.outcome === "pass") {
        if (!input.observationFingerprint) throw new WebLabPersistenceError("TRUSTED_OBSERVATION_REQUIRED");
        const fingerprint = sha256(JSON.stringify({ ownerId: input.ownerId,
          buildId: instance.web_lab_build_id, instanceId: input.instanceId,
          gradeId: attempt.id, trustLevel, graderVersion: input.graderVersion,
          observationFingerprint: input.observationFingerprint }));
        const [completion] = await tx`
          insert into web_lab_control.web_lab_completions (
            owner_id, web_lab_build_id, runtime_instance_id, trusted_grade_id,
            trust_level, grader_version, completion_fingerprint
          ) values (${input.ownerId}, ${instance.web_lab_build_id}, ${input.instanceId},
            ${attempt.id}, ${trustLevel}, ${input.graderVersion}, ${fingerprint})
          on conflict (owner_id, web_lab_build_id, trust_level) do nothing
          returning id
        `;
        if (completion) completionId = String(completion.id);
        else {
          const [existing] = await tx`
            select id from web_lab_control.web_lab_completions
            where owner_id = ${input.ownerId} and web_lab_build_id = ${instance.web_lab_build_id}
              and trust_level = ${trustLevel}
          `;
          completionId = existing ? String(existing.id) : null;
        }
      }
      await tx`
        insert into web_lab_control.runtime_audit_events
          (instance_id, owner_id, event_type, result, generation_version)
        select id, owner_id, ${input.outcome === "pass" ? "grade_succeeded" : "grade_attempted"},
          ${input.outcome === "error" ? "failed" : "ok"}, generation_version
        from web_lab_control.runtime_instances where id = ${input.instanceId}
      `;
      return { attemptId: String(attempt.id), completionId, trustLevel };
    });
  }

  async getCompletionForOwner(buildId: string, ownerId: string): Promise<Readonly<{ id: string; trustLevel: CompletionTrust; completedAt: string }>[]> {
    const rows = await this.db`
      select id, trust_level, completed_at from web_lab_control.web_lab_completions
      where web_lab_build_id = ${buildId} and owner_id = ${ownerId}
      order by completed_at
    `;
    return rows.map(row => ({ id: String(row.id), trustLevel: row.trust_level as CompletionTrust,
      completedAt: new Date(row.completed_at as Date).toISOString() }));
  }
}
