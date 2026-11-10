import "server-only";
import postgres from "postgres";
import type { ProductOperation } from "./contract";
import { resolvedByAnyLaterStatus, type CommandRecord, type InstallationRecord, type LocalFirstProductRepository,
  type OwnerActivity, type PairingRecord } from "./repository";
import { ProductProtocolError } from "./protocol";
import type { ExecutableProductBuild, LocalFirstBuildRepository } from "./product-service";

type Sql = ReturnType<typeof postgres>;
type Row = Record<string, unknown>;
const epoch = (value: unknown): number => new Date(value as Date).getTime();
const nullableEpoch = (value: unknown): number | null => value == null ? null : epoch(value);

function pairing(row: Row): PairingRecord {
  return { authorizationRequestId: String(row.authorization_request_id), installationId: String(row.installation_id),
    publicKey: String(row.public_key), deviceName: String(row.friendly_name), protocolVersion: String(row.protocol_version),
    codeChallenge: String(row.code_challenge), stateDigest: String(row.state_digest), createdAt: epoch(row.created_at),
    expiresAt: epoch(row.expires_at), accountId: row.owner_id == null ? null : String(row.owner_id),
    authorizationCodeDigest: row.authorization_code_digest == null ? null : String(row.authorization_code_digest),
    approvedAt: nullableEpoch(row.approved_at), deniedAt: nullableEpoch(row.denied_at), consumedAt: nullableEpoch(row.consumed_at) };
}
function installation(row: Row): InstallationRecord {
  return { installationId: String(row.installation_id), accountId: String(row.owner_id), publicKey: String(row.public_key),
    deviceName: String(row.friendly_name), protocolVersion: String(row.protocol_version), createdAt: epoch(row.created_at),
    lastInteractionAt: nullableEpoch(row.last_interaction_at), revokedAt: nullableEpoch(row.revoked_at) };
}
function command(row: Row): CommandRecord {
  return { requestId: String(row.request_id), commandId: row.command_id == null ? null : String(row.command_id),
    accountId: String(row.owner_id), installationId: String(row.installation_id), operation: row.operation as ProductOperation,
    buildId: row.build_id == null ? null : String(row.build_id), runtimeId: row.runtime_id == null ? null : String(row.runtime_id),
    generation: row.generation == null ? null : Number(row.generation), nonce: String(row.nonce),
    idempotencyKey: String(row.idempotency_key), requestFingerprint: String(row.request_fingerprint),
    ticketDigest: String(row.ticket_digest), state: row.state as CommandRecord["state"], issuedAt: epoch(row.issued_at),
    expiresAt: epoch(row.expires_at), consumedAt: nullableEpoch(row.consumed_at), completedAt: nullableEpoch(row.completed_at),
    result: row.result == null ? null : row.result as CommandRecord["result"],
    resultDigest: row.result_digest == null ? null : String(row.result_digest),
    resultProof: row.result_proof == null ? null : String(row.result_proof) };
}

function matches<T extends object>(value: T, expected: Partial<T>): boolean {
  return Object.entries(expected).every(([key, item]) => value[key as keyof T] === item);
}

/** Private-schema adapter. Raw authorization codes and command tickets are never persisted. */
export class PostgresLocalFirstProductRepository implements LocalFirstProductRepository, LocalFirstBuildRepository {
  constructor(private readonly sql: Sql,
    private readonly supportedArchitectures: readonly ("arm64" | "amd64")[] = ["arm64", "amd64"]) {}

  async createPairing(value: PairingRecord): Promise<void> {
    await this.sql`insert into web_lab_control.local_first_pairing_requests
      (authorization_request_id, installation_id, public_key, friendly_name, protocol_version, code_challenge,
       state_digest, created_at, expires_at)
      values (${value.authorizationRequestId}, ${value.installationId}, ${value.publicKey}, ${value.deviceName},
       ${value.protocolVersion}, ${value.codeChallenge}, ${value.stateDigest},
       ${new Date(value.createdAt)}, ${new Date(value.expiresAt)})`;
  }
  async pairing(id: string): Promise<PairingRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_pairing_requests
      where authorization_request_id = ${id} limit 1`;
    return rows[0] ? pairing(rows[0]) : null;
  }
  async activePairingForInstallation(installationId: string): Promise<PairingRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_pairing_requests
      where installation_id = ${installationId} and consumed_at is null and denied_at is null
      order by created_at desc limit 1`;
    return rows[0] ? pairing(rows[0]) : null;
  }
  async updatePairing(id: string, expected: Partial<PairingRecord>, patch: Partial<PairingRecord>): Promise<PairingRecord | null> {
    return this.sql.begin(async tx => {
      const rows = await tx<Row[]>`select * from web_lab_control.local_first_pairing_requests
        where authorization_request_id = ${id} for update`;
      if (!rows[0] || !matches(pairing(rows[0]), expected)) return null;
      const current = { ...pairing(rows[0]), ...patch };
      const updated = await tx<Row[]>`update web_lab_control.local_first_pairing_requests set
        owner_id = ${current.accountId}, authorization_code_digest = ${current.authorizationCodeDigest},
        approved_at = ${current.approvedAt === null ? null : new Date(current.approvedAt)},
        denied_at = ${current.deniedAt === null ? null : new Date(current.deniedAt)},
        consumed_at = ${current.consumedAt === null ? null : new Date(current.consumedAt)}
        where authorization_request_id = ${id} returning *`;
      return updated[0] ? pairing(updated[0]) : null;
    });
  }
  async saveInstallation(value: InstallationRecord): Promise<void> {
    const rows = await this.sql<Row[]>`insert into web_lab_control.local_first_runner_installations
      (installation_id, owner_id, public_key, friendly_name, protocol_version, created_at, last_interaction_at, revoked_at)
      values (${value.installationId}, ${value.accountId}, ${value.publicKey}, ${value.deviceName}, ${value.protocolVersion},
       ${new Date(value.createdAt)}, ${value.lastInteractionAt === null ? null : new Date(value.lastInteractionAt)},
       ${value.revokedAt === null ? null : new Date(value.revokedAt)})
      on conflict (installation_id) do update set friendly_name = excluded.friendly_name,
        protocol_version = excluded.protocol_version, last_interaction_at = excluded.last_interaction_at, revoked_at = excluded.revoked_at
      where web_lab_control.local_first_runner_installations.owner_id = excluded.owner_id
        and web_lab_control.local_first_runner_installations.public_key = excluded.public_key
      returning installation_id`;
    if (!rows[0]) throw new Error("installation_account_conflict");
  }
  async installation(id: string): Promise<InstallationRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_runner_installations
      where installation_id = ${id} limit 1`;
    return rows[0] ? installation(rows[0]) : null;
  }
  async activeInstallationForAccount(accountId: string): Promise<InstallationRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_runner_installations
      where owner_id = ${accountId} and revoked_at is null order by created_at desc limit 1`;
    return rows[0] ? installation(rows[0]) : null;
  }
  async updateInstallation(id: string, expected: Partial<InstallationRecord>, patch: Partial<InstallationRecord>): Promise<InstallationRecord | null> {
    return this.sql.begin(async tx => {
      const rows = await tx<Row[]>`select * from web_lab_control.local_first_runner_installations
        where installation_id = ${id} for update`;
      if (!rows[0] || !matches(installation(rows[0]), expected)) return null;
      const current = { ...installation(rows[0]), ...patch };
      const updated = await tx<Row[]>`update web_lab_control.local_first_runner_installations set
        friendly_name = ${current.deviceName}, protocol_version = ${current.protocolVersion},
        last_interaction_at = ${current.lastInteractionAt === null ? null : new Date(current.lastInteractionAt)},
        revoked_at = ${current.revokedAt === null ? null : new Date(current.revokedAt)}
        where installation_id = ${id} returning *`;
      return updated[0] ? installation(updated[0]) : null;
    });
  }
  async revokeIfIdle(accountId: string, installationId: string, revokedAt: number): Promise<boolean> {
    return this.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext('amniora-my-vm'), hashtext(${accountId}))`;
      const installations = await tx<Row[]>`select * from web_lab_control.local_first_runner_installations
        where installation_id = ${installationId} and owner_id = ${accountId} for update`;
      if (!installations[0] || installations[0].revoked_at !== null) return false;
      const pending = await tx<Row[]>`select * from web_lab_control.local_first_command_requests
        where owner_id = ${accountId} and operation <> 'STATUS' and state in ('issued', 'redeemed')
          and (state = 'redeemed' or expires_at > ${new Date(revokedAt)}) order by issued_at desc limit 1`;
      const pendingRecord = pending[0] ? command(pending[0]) : null;
      const statuses = pendingRecord ? await tx<Row[]>`select * from web_lab_control.local_first_command_requests
        where owner_id = ${accountId} and installation_id = ${pendingRecord.installationId}
          and operation = 'STATUS' and state = 'completed'
          and issued_at > ${new Date(pendingRecord.issuedAt)}` : [];
      const rows = await tx<Row[]>`select * from web_lab_control.local_first_command_requests
        where owner_id = ${accountId} and state = 'completed' and result #>> '{runtime,runtimeId}' is not null
        order by issued_at desc, completed_at desc limit 1`;
      const active = rows[0] ? command(rows[0]).result?.runtime : null;
      if (pendingRecord && !resolvedByAnyLaterStatus(pendingRecord, statuses.map(command)) ||
          active && active.state !== "stopped") throw new ProductProtocolError("OPERATION_IN_PROGRESS");
      await tx`update web_lab_control.local_first_runner_installations set revoked_at = ${new Date(revokedAt)}
        where installation_id = ${installationId} and owner_id = ${accountId}`;
      return true;
    });
  }
  async command(id: string): Promise<CommandRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests where request_id = ${id} limit 1`;
    return rows[0] ? command(rows[0]) : null;
  }
  async commandByTicketDigest(ticketDigest: string): Promise<CommandRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests where ticket_digest = ${ticketDigest} limit 1`;
    return rows[0] ? command(rows[0]) : null;
  }
  async commandByIdempotency(accountId: string, installationId: string, idempotencyKey: string): Promise<CommandRecord | null> {
    const rows = await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests
      where owner_id = ${accountId} and installation_id = ${installationId} and idempotency_key = ${idempotencyKey} limit 1`;
    return rows[0] ? command(rows[0]) : null;
  }
  async latestCompleted(accountId: string, installationId: string, operation?: ProductOperation): Promise<CommandRecord | null> {
    const rows = operation
      ? await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests where owner_id = ${accountId}
          and installation_id = ${installationId} and state = 'completed' and operation = ${operation}
          order by completed_at desc limit 1`
      : await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests where owner_id = ${accountId}
          and installation_id = ${installationId} and state = 'completed' order by completed_at desc limit 1`;
    return rows[0] ? command(rows[0]) : null;
  }
  async ownerActivity(accountId: string, now: number): Promise<OwnerActivity> {
    const pending = await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests
      where owner_id = ${accountId} and operation <> 'STATUS' and state in ('issued', 'redeemed')
        and (state = 'redeemed' or expires_at > ${new Date(now)})
      order by issued_at desc limit 1`;
    const pendingRecord = pending[0] ? command(pending[0]) : null;
    const statuses = pendingRecord ? await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests
      where owner_id = ${accountId} and installation_id = ${pendingRecord.installationId}
        and operation = 'STATUS' and state = 'completed'
        and issued_at > ${new Date(pendingRecord.issuedAt)}` : [];
    const runtime = await this.sql<Row[]>`select * from web_lab_control.local_first_command_requests
      where owner_id = ${accountId} and state = 'completed' and result #>> '{runtime,runtimeId}' is not null
      order by issued_at desc, completed_at desc limit 1`;
    const latest = runtime[0] ? command(runtime[0]) : null;
    return { pending: pendingRecord && !resolvedByAnyLaterStatus(pendingRecord, statuses.map(command)) ? pendingRecord : null,
      runtime: latest?.result?.runtime?.state === "stopped" ? null : latest };
  }
  async saveCommand(value: CommandRecord): Promise<void> {
    const storedResult = value.result === null ? null : this.sql.json(value.result);
    await this.sql.begin(async tx => {
      // One transaction-scoped owner lock serializes reservations across tabs and server instances.
      await tx`select pg_advisory_xact_lock(hashtext('amniora-my-vm'), hashtext(${value.accountId}))`;
      const installations = await tx<Row[]>`select revoked_at from web_lab_control.local_first_runner_installations
        where installation_id = ${value.installationId} and owner_id = ${value.accountId} for update`;
      if (!installations[0] || installations[0].revoked_at !== null) throw new ProductProtocolError("PAIRING_REVOKED");
      if (value.operation !== "STATUS") {
        const pending = await tx<Row[]>`select * from web_lab_control.local_first_command_requests
          where owner_id = ${value.accountId} and operation <> 'STATUS' and state in ('issued', 'redeemed')
            and (state = 'redeemed' or expires_at > ${new Date(value.issuedAt)})
          order by issued_at desc limit 1`;
        const pendingRecord = pending[0] ? command(pending[0]) : null;
        const statuses = pendingRecord ? await tx<Row[]>`select * from web_lab_control.local_first_command_requests
          where owner_id = ${value.accountId} and installation_id = ${pendingRecord.installationId}
            and operation = 'STATUS' and state = 'completed'
            and issued_at > ${new Date(pendingRecord.issuedAt)}` : [];
        if (pendingRecord && !resolvedByAnyLaterStatus(pendingRecord, statuses.map(command))) {
          throw new ProductProtocolError("OPERATION_IN_PROGRESS");
        }
        const rows = await tx<Row[]>`select * from web_lab_control.local_first_command_requests
          where owner_id = ${value.accountId} and state = 'completed' and result #>> '{runtime,runtimeId}' is not null
          order by issued_at desc, completed_at desc limit 1`;
        const runtime = rows[0] ? command(rows[0]).result?.runtime : null;
        const active = runtime?.state === "stopped" ? null : runtime;
        if (value.operation === "LAUNCH" && active) throw new ProductProtocolError("RUNTIME_CONFLICT");
        if (value.operation !== "LAUNCH" && (!active || active.buildId !== value.buildId ||
            active.runtimeId !== value.runtimeId || active.generation !== value.generation || active.state !== "running")) {
          throw new ProductProtocolError("CONTEXT_MISMATCH");
        }
      }
      await tx`insert into web_lab_control.local_first_command_requests
      (request_id, command_id, owner_id, installation_id, operation, build_id, runtime_id, generation, nonce,
       idempotency_key, request_fingerprint, ticket_digest, state, issued_at, expires_at, consumed_at, completed_at,
       result, result_digest, result_proof)
      values (${value.requestId}, ${value.commandId}, ${value.accountId}, ${value.installationId}, ${value.operation},
       ${value.buildId}, ${value.runtimeId}, ${value.generation}, ${value.nonce}, ${value.idempotencyKey},
       ${value.requestFingerprint}, ${value.ticketDigest}, ${value.state}, ${new Date(value.issuedAt)},
       ${new Date(value.expiresAt)}, ${value.consumedAt === null ? null : new Date(value.consumedAt)},
       ${value.completedAt === null ? null : new Date(value.completedAt)}, ${storedResult},
       ${value.resultDigest}, ${value.resultProof})`;
    });
  }
  async updateCommand(id: string, expected: Partial<CommandRecord>, patch: Partial<CommandRecord>): Promise<CommandRecord | null> {
    return this.sql.begin(async tx => {
      const rows = await tx<Row[]>`select * from web_lab_control.local_first_command_requests where request_id = ${id} for update`;
      if (!rows[0] || !matches(command(rows[0]), expected)) return null;
      const current = { ...command(rows[0]), ...patch };
      const storedResult = current.result === null ? null : this.sql.json(current.result);
      const updated = await tx<Row[]>`update web_lab_control.local_first_command_requests set
        command_id = ${current.commandId}, nonce = ${current.nonce}, ticket_digest = ${current.ticketDigest},
        state = ${current.state}, issued_at = ${new Date(current.issuedAt)}, expires_at = ${new Date(current.expiresAt)},
        consumed_at = ${current.consumedAt === null ? null : new Date(current.consumedAt)},
        completed_at = ${current.completedAt === null ? null : new Date(current.completedAt)},
        result = ${storedResult}, result_digest = ${current.resultDigest}, result_proof = ${current.resultProof}
        where request_id = ${id} returning *`;
      return updated[0] ? command(updated[0]) : null;
    });
  }

  async ownedExecutableBuild(savedLabId: string, ownerId: string): Promise<ExecutableProductBuild | null> {
    const rows = await this.sql<Row[]>`select b.id, b.saved_lab_id, b.owner_id, l.title
      from web_lab_control.web_lab_builds b join public.labs l on l.id = b.saved_lab_id and l.user_id = b.owner_id
      where b.saved_lab_id = ${savedLabId} and b.owner_id = ${ownerId} limit 1`;
    return rows[0] ? { buildId: String(rows[0].id), savedLabId: String(rows[0].saved_lab_id),
      ownerId: String(rows[0].owner_id), labName: String(rows[0].title),
      supportedArchitectures: this.supportedArchitectures } : null;
  }
  async ownedExecutableBuildById(buildId: string, ownerId: string): Promise<ExecutableProductBuild | null> {
    const rows = await this.sql<Row[]>`select b.id, b.saved_lab_id, b.owner_id, l.title
      from web_lab_control.web_lab_builds b join public.labs l on l.id = b.saved_lab_id and l.user_id = b.owner_id
      where b.id = ${buildId} and b.owner_id = ${ownerId} limit 1`;
    return rows[0] ? { buildId: String(rows[0].id), savedLabId: String(rows[0].saved_lab_id),
      ownerId: String(rows[0].owner_id), labName: String(rows[0].title),
      supportedArchitectures: this.supportedArchitectures } : null;
  }
}
