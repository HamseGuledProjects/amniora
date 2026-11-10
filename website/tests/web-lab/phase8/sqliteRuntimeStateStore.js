// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Node 24 built-in SQLite local adapter. */
"use strict";
const { DatabaseSync } = require("node:sqlite");

const activeStatuses = ["requested", "provisioning", "ready", "resetting", "expiring", "destroying"];

class SqliteRuntimeStateStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      create table if not exists runtime_instances (
        instance_id text primary key,
        owner_id text not null,
        saved_lab_id text not null,
        canonical_lab_id text not null,
        build_fingerprint text not null,
        template_id text not null,
        template_version text not null,
        vulnerability_id text not null,
        vulnerability_version text not null,
        status text not null,
        created_at integer not null,
        updated_at integer not null,
        expires_at integer not null,
        last_activity_at integer not null,
        destroyed_at integer,
        backend_reference text,
        runtime_version text not null,
        generation_version integer not null,
        route_key text not null unique,
        last_reconciled_at integer,
        failure_code text,
        version integer not null
      );
      create unique index if not exists runtime_instances_one_active_owner
        on runtime_instances(owner_id)
        where status in ('requested','provisioning','ready','resetting','expiring','destroying');
      create index if not exists runtime_instances_expiry on runtime_instances(status, expires_at);
      create table if not exists runtime_commands (
        owner_id text not null,
        operation text not null,
        idempotency_key text not null,
        resource_id text not null,
        request_id text not null,
        instance_id text not null,
        state text not null check (state in ('in-progress','completed')),
        generation_version integer,
        result_json text,
        created_at integer not null,
        completed_at integer,
        primary key (owner_id, operation, idempotency_key)
      );
      create index if not exists runtime_commands_instance on runtime_commands(instance_id, state);
      create table if not exists runtime_audit_events (
        event_id integer primary key autoincrement,
        instance_id text not null,
        owner_id text,
        event_type text not null,
        at integer not null,
        generation_version integer not null,
        result text not null,
        code text
      );
      create index if not exists runtime_audit_instance_order on runtime_audit_events(instance_id, event_id);
    `);
    this.insertInstance = this.db.prepare(`
      insert into runtime_instances (
        instance_id, owner_id, saved_lab_id, canonical_lab_id, build_fingerprint,
        template_id, template_version, vulnerability_id, vulnerability_version, status,
        created_at, updated_at, expires_at, last_activity_at, destroyed_at, backend_reference,
        runtime_version, generation_version, route_key, last_reconciled_at, failure_code, version
      ) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    this.insertCommand = this.db.prepare(`
      insert into runtime_commands (
        owner_id, operation, idempotency_key, resource_id, request_id, instance_id,
        state, generation_version, result_json, created_at, completed_at
      ) values (?,?,?,?,?,?,?,?,?,?,?) on conflict(owner_id, operation, idempotency_key) do nothing
    `);
    this.insertAudit = this.db.prepare(`
      insert into runtime_audit_events (
        instance_id, owner_id, event_type, at, generation_version, result, code
      ) values (?,?,?,?,?,?,?)
    `);
  }

  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  instanceValues(value) {
    return [
      value.instanceId, value.ownerId, value.savedLabId, value.canonicalLabId, value.buildFingerprint,
      value.templateId, value.templateVersion, value.vulnerabilityId, value.vulnerabilityVersion, value.status,
      value.createdAt, value.updatedAt, value.expiresAt, value.lastActivityAt, value.destroyedAt,
      value.backendReference, value.runtimeVersion, value.generationVersion, value.routeKey,
      value.lastReconciledAt, value.failureCode, value.version,
    ];
  }

  commandValues(value) {
    return [
      value.ownerId, value.operation, value.idempotencyKey, value.resourceId, value.requestId,
      value.instanceId, value.state, value.generationVersion, value.resultJson,
      value.createdAt, value.completedAt,
    ];
  }

  auditValues(value) {
    return [value.instanceId, value.ownerId, value.eventType, value.at, value.generationVersion, value.result, value.code];
  }

  rowToInstance(row) {
    if (!row) return null;
    return {
      instanceId: row.instance_id, ownerId: row.owner_id, savedLabId: row.saved_lab_id,
      canonicalLabId: row.canonical_lab_id, buildFingerprint: row.build_fingerprint,
      templateId: row.template_id, templateVersion: row.template_version,
      vulnerabilityId: row.vulnerability_id, vulnerabilityVersion: row.vulnerability_version,
      status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      expiresAt: row.expires_at, lastActivityAt: row.last_activity_at,
      destroyedAt: row.destroyed_at, backendReference: row.backend_reference,
      runtimeVersion: row.runtime_version, generationVersion: row.generation_version,
      routeKey: row.route_key, lastReconciledAt: row.last_reconciled_at,
      failureCode: row.failure_code, version: row.version,
    };
  }

  rowToCommand(row) {
    if (!row) return null;
    return {
      ownerId: row.owner_id, operation: row.operation, idempotencyKey: row.idempotency_key,
      resourceId: row.resource_id, requestId: row.request_id, instanceId: row.instance_id,
      state: row.state, generationVersion: row.generation_version, resultJson: row.result_json,
      createdAt: row.created_at, completedAt: row.completed_at,
    };
  }

  rowToAudit(row) {
    return {
      eventId: row.event_id, instanceId: row.instance_id, ownerId: row.owner_id,
      eventType: row.event_type, at: row.at, generationVersion: row.generation_version,
      result: row.result, code: row.code,
    };
  }

  async createInstanceRecord(instance, audits = []) {
    this.transaction(() => {
      this.insertInstance.run(...this.instanceValues(instance));
      for (const audit of audits) this.insertAudit.run(...this.auditValues(audit));
    });
  }

  async createInstanceWithCommand(instance, command, audits) {
    this.transaction(() => {
      this.insertInstance.run(...this.instanceValues(instance));
      const result = this.insertCommand.run(...this.commandValues(command));
      if (Number(result.changes) !== 1) throw new Error("idempotency_conflict");
      for (const audit of audits) this.insertAudit.run(...this.auditValues(audit));
    });
  }

  async getInstance(instanceId) {
    return this.rowToInstance(this.db.prepare("select * from runtime_instances where instance_id = ?").get(instanceId));
  }

  async updateLifecycle(instanceId, expectedVersion, patch, audits = []) {
    return this.transaction(() => {
      const current = this.rowToInstance(this.db.prepare("select * from runtime_instances where instance_id = ?").get(instanceId));
      if (!current) throw new Error("runtime_not_found");
      if (current.version !== expectedVersion) throw new Error("runtime_state_conflict");
      const next = { ...current, ...patch, version: current.version + 1 };
      const result = this.db.prepare(`
        update runtime_instances set
          status=?, updated_at=?, expires_at=?, last_activity_at=?, destroyed_at=?,
          backend_reference=?, generation_version=?, last_reconciled_at=?, failure_code=?, version=?
        where instance_id=? and version=?
      `).run(
        next.status, next.updatedAt, next.expiresAt, next.lastActivityAt, next.destroyedAt,
        next.backendReference, next.generationVersion, next.lastReconciledAt, next.failureCode,
        next.version, instanceId, expectedVersion,
      );
      if (Number(result.changes) !== 1) throw new Error("runtime_state_conflict");
      for (const audit of audits) this.insertAudit.run(...this.auditValues(audit));
      return next;
    });
  }

  async listInstances() {
    return this.db.prepare("select * from runtime_instances order by created_at, instance_id").all().map(row => this.rowToInstance(row));
  }

  async listActiveInstances(ownerId) {
    const placeholders = activeStatuses.map(() => "?").join(",");
    const sql = `select * from runtime_instances where status in (${placeholders})${ownerId ? " and owner_id = ?" : ""} order by created_at, instance_id`;
    return this.db.prepare(sql).all(...activeStatuses, ...(ownerId ? [ownerId] : [])).map(row => this.rowToInstance(row));
  }

  async listExpiredInstances(now) {
    const placeholders = activeStatuses.map(() => "?").join(",");
    return this.db.prepare(`select * from runtime_instances where status in (${placeholders}) and expires_at <= ? order by expires_at, instance_id`)
      .all(...activeStatuses, now).map(row => this.rowToInstance(row));
  }

  async recordIdempotency(command) {
    return Number(this.insertCommand.run(...this.commandValues(command)).changes) === 1;
  }

  async getIdempotencyResult(ownerId, operation, idempotencyKey) {
    return this.rowToCommand(this.db.prepare(`
      select * from runtime_commands where owner_id=? and operation=? and idempotency_key=?
    `).get(ownerId, operation, idempotencyKey));
  }

  async completeIdempotency(ownerId, operation, idempotencyKey, resultJson, generationVersion, completedAt) {
    const result = this.db.prepare(`
      update runtime_commands set state='completed', result_json=?, generation_version=?, completed_at=?
      where owner_id=? and operation=? and idempotency_key=?
    `).run(resultJson, generationVersion, completedAt, ownerId, operation, idempotencyKey);
    if (Number(result.changes) !== 1) throw new Error("idempotency_result_missing");
  }

  async listPendingCommands(instanceId) {
    const rows = instanceId
      ? this.db.prepare("select * from runtime_commands where state='in-progress' and instance_id=? order by created_at, rowid").all(instanceId)
      : this.db.prepare("select * from runtime_commands where state='in-progress' order by created_at, rowid").all();
    return rows.map(row => this.rowToCommand(row));
  }

  async recordAuditEvent(event) {
    const result = this.insertAudit.run(...this.auditValues(event));
    return { ...event, eventId: Number(result.lastInsertRowid) };
  }

  async listAuditEvents(instanceId) {
    const rows = instanceId
      ? this.db.prepare("select * from runtime_audit_events where instance_id=? order by event_id").all(instanceId)
      : this.db.prepare("select * from runtime_audit_events order by event_id").all();
    return rows.map(row => this.rowToAudit(row));
  }

  async close() { this.db.close(); }
}

module.exports = { SqliteRuntimeStateStore };
