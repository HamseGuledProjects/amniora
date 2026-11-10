import type {
  CommandRecord, InstallationRecord, LocalFirstProductRepository, OwnerActivity, PairingRecord,
} from "./repository";
import { resolvedByAnyLaterStatus } from "./repository";
import type { ProductOperation } from "./contract";
import { ProductProtocolError } from "./protocol";

function matches<T extends object>(value: T, expected: Partial<T>): boolean {
  return Object.entries(expected).every(([key, item]) => value[key as keyof T] === item);
}

/** Durable-shape adapter for deterministic tests and the local product rehearsal. */
export class InMemoryLocalFirstProductRepository implements LocalFirstProductRepository {
  readonly pairings = new Map<string, PairingRecord>();
  readonly installations = new Map<string, InstallationRecord>();
  readonly commands = new Map<string, CommandRecord>();
  private queue: Promise<void> = Promise.resolve();

  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const prior = this.queue;
    let release!: () => void;
    this.queue = new Promise(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }

  async createPairing(record: PairingRecord): Promise<void> {
    await this.exclusive(() => {
      if (this.pairings.has(record.authorizationRequestId)) throw new Error("pairing_conflict");
      this.pairings.set(record.authorizationRequestId, structuredClone(record));
    });
  }
  async pairing(id: string): Promise<PairingRecord | null> {
    const value = this.pairings.get(id); return value ? structuredClone(value) : null;
  }
  async activePairingForInstallation(installationId: string): Promise<PairingRecord | null> {
    const value = [...this.pairings.values()].find(item => item.installationId === installationId &&
      item.consumedAt === null && item.deniedAt === null);
    return value ? structuredClone(value) : null;
  }
  async updatePairing(id: string, expected: Partial<PairingRecord>, patch: Partial<PairingRecord>): Promise<PairingRecord | null> {
    return this.exclusive(() => {
      const value = this.pairings.get(id);
      if (!value || !matches(value, expected)) return null;
      const next = { ...value, ...patch };
      this.pairings.set(id, next);
      return structuredClone(next);
    });
  }
  async saveInstallation(record: InstallationRecord): Promise<void> {
    await this.exclusive(() => { this.installations.set(record.installationId, structuredClone(record)); });
  }
  async installation(id: string): Promise<InstallationRecord | null> {
    const value = this.installations.get(id); return value ? structuredClone(value) : null;
  }
  async activeInstallationForAccount(accountId: string): Promise<InstallationRecord | null> {
    const values = [...this.installations.values()].filter(value => value.accountId === accountId && value.revokedAt === null)
      .sort((a, b) => b.createdAt - a.createdAt);
    return values[0] ? structuredClone(values[0]) : null;
  }
  async updateInstallation(id: string, expected: Partial<InstallationRecord>, patch: Partial<InstallationRecord>): Promise<InstallationRecord | null> {
    return this.exclusive(() => {
      const value = this.installations.get(id);
      if (!value || !matches(value, expected)) return null;
      const next = { ...value, ...patch };
      this.installations.set(id, next);
      return structuredClone(next);
    });
  }
  async revokeIfIdle(accountId: string, installationId: string, revokedAt: number): Promise<boolean> {
    return this.exclusive(async () => {
      const value = this.installations.get(installationId);
      if (!value || value.accountId !== accountId || value.revokedAt !== null) return false;
      const activity = await this.ownerActivity(accountId, revokedAt);
      if (activity.runtime || activity.pending) throw new ProductProtocolError("OPERATION_IN_PROGRESS");
      this.installations.set(installationId, { ...value, revokedAt });
      return true;
    });
  }
  async command(id: string): Promise<CommandRecord | null> {
    const value = this.commands.get(id); return value ? structuredClone(value) : null;
  }
  async commandByTicketDigest(ticketDigest: string): Promise<CommandRecord | null> {
    const value = [...this.commands.values()].find(item => item.ticketDigest === ticketDigest);
    return value ? structuredClone(value) : null;
  }
  async commandByIdempotency(accountId: string, installationId: string, idempotencyKey: string): Promise<CommandRecord | null> {
    const value = [...this.commands.values()].find(item => item.accountId === accountId &&
      item.installationId === installationId && item.idempotencyKey === idempotencyKey);
    return value ? structuredClone(value) : null;
  }
  async latestCompleted(accountId: string, installationId: string, operation?: ProductOperation): Promise<CommandRecord | null> {
    const values = [...this.commands.values()].filter(item => item.accountId === accountId && item.installationId === installationId &&
      item.state === "completed" && (!operation || item.operation === operation)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    return values[0] ? structuredClone(values[0]) : null;
  }
  async ownerActivity(accountId: string, now: number): Promise<OwnerActivity> {
    const owned = [...this.commands.values()].filter(item => item.accountId === accountId);
    const latestPending = owned.filter(item => item.operation !== "STATUS" && ["issued", "redeemed"].includes(item.state) &&
      (item.state === "redeemed" || item.expiresAt > now)).sort((a, b) => b.issuedAt - a.issuedAt)[0] ?? null;
    const laterStatuses = latestPending ? owned.filter(item => item.operation === "STATUS" && item.state === "completed" &&
      item.installationId === latestPending.installationId && item.issuedAt > latestPending.issuedAt) : [];
    const pending = latestPending && !resolvedByAnyLaterStatus(latestPending, laterStatuses) ? latestPending : null;
    const latestRuntime = owned.filter(item => item.state === "completed" && item.result?.runtime)
      .sort((a, b) => b.issuedAt - a.issuedAt || (b.completedAt ?? 0) - (a.completedAt ?? 0))[0] ?? null;
    const runtime = latestRuntime?.result?.runtime?.state === "stopped" ? null : latestRuntime;
    return { pending: pending ? structuredClone(pending) : null, runtime: runtime ? structuredClone(runtime) : null };
  }
  async saveCommand(record: CommandRecord): Promise<void> {
    await this.exclusive(async () => {
      const installation = this.installations.get(record.installationId);
      if (!installation || installation.accountId !== record.accountId || installation.revokedAt !== null) {
        throw new ProductProtocolError("PAIRING_REVOKED");
      }
      if (this.commands.has(record.requestId) || [...this.commands.values()].some(item => item.ticketDigest === record.ticketDigest ||
        (item.accountId === record.accountId && item.installationId === record.installationId && item.idempotencyKey === record.idempotencyKey))) {
        throw new Error("command_conflict");
      }
      if (record.operation !== "STATUS") {
        const activity = await this.ownerActivity(record.accountId, record.issuedAt);
        if (activity.pending) throw new ProductProtocolError("OPERATION_IN_PROGRESS");
        const active = activity.runtime?.result?.runtime;
        if (record.operation === "LAUNCH" && active) throw new ProductProtocolError("RUNTIME_CONFLICT");
        if (record.operation !== "LAUNCH" && (!active || active.buildId !== record.buildId ||
            active.runtimeId !== record.runtimeId || active.generation !== record.generation || active.state !== "running")) {
          throw new ProductProtocolError("CONTEXT_MISMATCH");
        }
      }
      this.commands.set(record.requestId, structuredClone(record));
    });
  }
  async updateCommand(id: string, expected: Partial<CommandRecord>, patch: Partial<CommandRecord>): Promise<CommandRecord | null> {
    return this.exclusive(() => {
      const value = this.commands.get(id);
      if (!value || !matches(value, expected)) return null;
      const next = { ...value, ...patch };
      this.commands.set(id, next);
      return structuredClone(next);
    });
  }
}
