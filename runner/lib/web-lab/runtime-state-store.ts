import type { RuntimeOperation, RuntimeStatus } from "./control-plane";
import type { WebModuleId, WebTemplateId } from "./schema";

export type StoredRuntimeInstance = Readonly<{
  instanceId: string;
  ownerId: string;
  savedLabId: string;
  canonicalLabId: string;
  buildFingerprint: string;
  templateId: WebTemplateId;
  templateVersion: string;
  vulnerabilityId: WebModuleId;
  vulnerabilityVersion: string;
  status: RuntimeStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastActivityAt: number;
  destroyedAt: number | null;
  backendReference: string | null;
  runtimeVersion: string;
  generationVersion: number;
  routeKey: string;
  lastReconciledAt: number | null;
  failureCode: string | null;
  version: number;
}>;

export type RuntimeInstancePatch = Partial<Pick<StoredRuntimeInstance,
  "status" | "updatedAt" | "expiresAt" | "lastActivityAt" | "destroyedAt" |
  "backendReference" | "generationVersion" | "lastReconciledAt" | "failureCode"
>>;

export type StoredRuntimeCommand = Readonly<{
  ownerId: string;
  operation: RuntimeOperation;
  idempotencyKey: string;
  resourceId: string;
  requestId: string;
  instanceId: string;
  state: "in-progress" | "completed";
  generationVersion: number | null;
  resultJson: string | null;
  createdAt: number;
  completedAt: number | null;
}>;

export type RuntimeAuditType =
  | "instance_requested" | "instance_provisioning" | "instance_ready"
  | "instance_reset_started" | "instance_reset_completed" | "instance_reconciled"
  | "instance_runtime_lost" | "instance_expired" | "instance_destroy_started"
  | "instance_destroyed" | "instance_failed" | "orphan_detected" | "orphan_removed";

export type RuntimeAuditInput = Readonly<{
  instanceId: string;
  ownerId: string | null;
  eventType: RuntimeAuditType;
  at: number;
  generationVersion: number;
  result: "ok" | "failed";
  code: string | null;
}>;

export type StoredRuntimeAuditEvent = RuntimeAuditInput & Readonly<{ eventId: number }>;

/** Trusted lifecycle persistence. Adapters must make each method atomic. */
export interface RuntimeStateStore {
  createInstanceRecord(instance: StoredRuntimeInstance, audits?: readonly RuntimeAuditInput[]): Promise<void>;
  createInstanceWithCommand(instance: StoredRuntimeInstance, command: StoredRuntimeCommand, audits: readonly RuntimeAuditInput[]): Promise<void>;
  getInstance(instanceId: string): Promise<StoredRuntimeInstance | null>;
  updateLifecycle(instanceId: string, expectedVersion: number, patch: RuntimeInstancePatch, audits?: readonly RuntimeAuditInput[]): Promise<StoredRuntimeInstance>;
  listInstances(): Promise<readonly StoredRuntimeInstance[]>;
  listActiveInstances(ownerId?: string): Promise<readonly StoredRuntimeInstance[]>;
  listExpiredInstances(now: number): Promise<readonly StoredRuntimeInstance[]>;
  recordIdempotency(command: StoredRuntimeCommand): Promise<boolean>;
  getIdempotencyResult(ownerId: string, operation: RuntimeOperation, idempotencyKey: string): Promise<StoredRuntimeCommand | null>;
  completeIdempotency(ownerId: string, operation: RuntimeOperation, idempotencyKey: string, resultJson: string, generationVersion: number, completedAt: number): Promise<void>;
  listPendingCommands(instanceId?: string): Promise<readonly StoredRuntimeCommand[]>;
  recordAuditEvent(event: RuntimeAuditInput): Promise<StoredRuntimeAuditEvent>;
  listAuditEvents(instanceId?: string): Promise<readonly StoredRuntimeAuditEvent[]>;
  close(): Promise<void>;
}

export const activeRuntimeStatuses: readonly RuntimeStatus[] = [
  "requested", "provisioning", "ready", "resetting", "expiring", "destroying",
];
