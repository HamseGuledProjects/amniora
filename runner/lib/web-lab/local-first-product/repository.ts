import type { AuthoritativeRunnerResult, ProductOperation } from "./contract";

export type PairingRecord = {
  authorizationRequestId: string;
  installationId: string;
  publicKey: string;
  deviceName: string;
  protocolVersion: string;
  codeChallenge: string;
  stateDigest: string;
  createdAt: number;
  expiresAt: number;
  accountId: string | null;
  authorizationCodeDigest: string | null;
  approvedAt: number | null;
  deniedAt: number | null;
  consumedAt: number | null;
};

export type InstallationRecord = {
  installationId: string;
  accountId: string;
  publicKey: string;
  deviceName: string;
  protocolVersion: string;
  createdAt: number;
  lastInteractionAt: number | null;
  revokedAt: number | null;
};

export type CommandRecord = {
  requestId: string;
  commandId: string | null;
  accountId: string;
  installationId: string;
  operation: ProductOperation;
  buildId: string | null;
  runtimeId: string | null;
  generation: number | null;
  nonce: string;
  idempotencyKey: string;
  requestFingerprint: string;
  ticketDigest: string;
  state: "issued" | "redeemed" | "completed" | "cancelled";
  issuedAt: number;
  expiresAt: number;
  consumedAt: number | null;
  completedAt: number | null;
  result: AuthoritativeRunnerResult | null;
  resultDigest: string | null;
  resultProof: string | null;
};

/** Owner-wide occupancy is deliberately conservative: a redeemed command without a result
 * still owns the slot, and an unverified disappearance never releases a running lab. */
export type OwnerActivity = Readonly<{
  pending: CommandRecord | null;
  runtime: CommandRecord | null;
}>;

/** A later signed STATUS is a recovery fence: Runner serializes local commands, so it can
 * establish that an older redeemed operation is no longer executing even if its result was lost. */
export function resolvedByLaterStatus(pending: CommandRecord, status: CommandRecord | null): boolean {
  if (pending.state !== "redeemed" || status?.operation !== "STATUS" || status.state !== "completed" ||
      status.installationId !== pending.installationId || status.issuedAt <= pending.issuedAt || !status.result?.ok) return false;
  const runtime = status.result.runtime;
  if (pending.operation === "LAUNCH") return !runtime || runtime.state === "stopped" ||
    (runtime.buildId === pending.buildId && runtime.state === "running");
  if (pending.operation === "STOP") return !runtime ||
    (runtime.runtimeId === pending.runtimeId && runtime.state === "stopped");
  if (pending.operation === "RESET") return !!runtime && runtime.runtimeId === pending.runtimeId &&
    runtime.generation > Number(pending.generation) && runtime.state === "running";
  return pending.operation === "OPEN_LAB" && (!runtime || runtime.state === "stopped" ||
    (runtime.runtimeId === pending.runtimeId && runtime.generation === pending.generation));
}

/** A recovery fence remains valid after subsequent statuses report another lab. */
export function resolvedByAnyLaterStatus(pending: CommandRecord, statuses: readonly CommandRecord[]): boolean {
  return statuses.some(status => resolvedByLaterStatus(pending, status));
}

export interface LocalFirstProductRepository {
  createPairing(record: PairingRecord): Promise<void>;
  pairing(id: string): Promise<PairingRecord | null>;
  activePairingForInstallation(installationId: string): Promise<PairingRecord | null>;
  updatePairing(id: string, expected: Partial<PairingRecord>, patch: Partial<PairingRecord>): Promise<PairingRecord | null>;
  saveInstallation(record: InstallationRecord): Promise<void>;
  installation(id: string): Promise<InstallationRecord | null>;
  activeInstallationForAccount(accountId: string): Promise<InstallationRecord | null>;
  updateInstallation(id: string, expected: Partial<InstallationRecord>, patch: Partial<InstallationRecord>): Promise<InstallationRecord | null>;
  revokeIfIdle(accountId: string, installationId: string, revokedAt: number): Promise<boolean>;
  command(id: string): Promise<CommandRecord | null>;
  commandByTicketDigest(ticketDigest: string): Promise<CommandRecord | null>;
  commandByIdempotency(accountId: string, installationId: string, idempotencyKey: string): Promise<CommandRecord | null>;
  latestCompleted(accountId: string, installationId: string, operation?: ProductOperation): Promise<CommandRecord | null>;
  ownerActivity(accountId: string, now: number): Promise<OwnerActivity>;
  saveCommand(record: CommandRecord): Promise<void>;
  updateCommand(id: string, expected: Partial<CommandRecord>, patch: Partial<CommandRecord>): Promise<CommandRecord | null>;
}
