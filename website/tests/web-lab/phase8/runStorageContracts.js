#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Node 24 built-in SQLite contract verification. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SqliteRuntimeStateStore } = require("./sqliteRuntimeStateStore");

function instance(overrides = {}) {
  return {
    instanceId: "00000000-0000-4000-8000-000000000001", ownerId: "storage-user-a",
    savedLabId: "saved-storage-a", canonicalLabId: "storage-lab-a", buildFingerprint: "a".repeat(64),
    templateId: "ecommerce", templateVersion: "1", vulnerabilityId: "stored-xss",
    vulnerabilityVersion: "1", status: "requested", createdAt: 1000, updatedAt: 1000,
    expiresAt: 61_000, lastActivityAt: 1000, destroyedAt: null, backendReference: null,
    runtimeVersion: "phase8-local-1", generationVersion: 1, routeKey: "r".repeat(32),
    lastReconciledAt: null, failureCode: null, version: 1, ...overrides,
  };
}

function audit(record, eventType, at) {
  return {
    instanceId: record.instanceId, ownerId: record.ownerId, eventType, at,
    generationVersion: record.generationVersion, result: "ok", code: null,
  };
}

async function main() {
  const directory = fs.mkdtempSync("/private/tmp/amniora-web-phase8-store-");
  const filename = path.join(directory, "runtime.sqlite");
  const secretMarker = "PHASE8_SECRET_MUST_NEVER_BE_PERSISTED";
  let store = new SqliteRuntimeStateStore(filename);
  try {
    const first = instance();
    const createCommand = {
      ownerId: first.ownerId, operation: "create", idempotencyKey: "create-once",
      resourceId: first.savedLabId, requestId: "request-create", instanceId: first.instanceId,
      state: "in-progress", generationVersion: 1, resultJson: null, createdAt: 1000, completedAt: null,
    };
    await store.createInstanceWithCommand(first, createCommand, [audit(first, "instance_requested", 1000)]);
    assert.deepEqual(await store.getInstance(first.instanceId), first);
    assert.equal((await store.listActiveInstances(first.ownerId)).length, 1);
    await assert.rejects(store.createInstanceRecord(instance({
      instanceId: "00000000-0000-4000-8000-000000000002", routeKey: "s".repeat(32),
    })), /UNIQUE constraint failed/);

    const provisioning = await store.updateLifecycle(first.instanceId, 1, {
      status: "provisioning", updatedAt: 1100,
    }, [audit(first, "instance_provisioning", 1100)]);
    assert.equal(provisioning.version, 2);
    const ready = await store.updateLifecycle(first.instanceId, 2, {
      status: "ready", updatedAt: 1200, backendReference: "b".repeat(32), lastReconciledAt: 1200,
    }, [audit(first, "instance_ready", 1200)]);
    assert.equal(ready.version, 3);
    await assert.rejects(store.updateLifecycle(first.instanceId, 2, { status: "failed" }), /runtime_state_conflict/);

    assert.equal(await store.recordIdempotency(createCommand), false);
    await store.completeIdempotency(first.ownerId, "create", "create-once", JSON.stringify({ instanceId: first.instanceId }), 1, 1250);
    const completed = await store.getIdempotencyResult(first.ownerId, "create", "create-once");
    assert.equal(completed.state, "completed");
    assert.equal(JSON.parse(completed.resultJson).instanceId, first.instanceId);
    assert.deepEqual((await store.listAuditEvents(first.instanceId)).map(event => event.eventType), [
      "instance_requested", "instance_provisioning", "instance_ready",
    ]);
    await store.close();

    store = new SqliteRuntimeStateStore(filename);
    const reopened = await store.getInstance(first.instanceId);
    assert.equal(reopened.status, "ready");
    assert.equal(reopened.backendReference, "b".repeat(32));
    assert.equal((await store.getIdempotencyResult(first.ownerId, "create", "create-once")).state, "completed");
    assert.equal((await store.listAuditEvents(first.instanceId)).length, 3);
    await store.close();
    store = null;

    const bytes = Buffer.concat(fs.readdirSync(directory).map(name => fs.readFileSync(path.join(directory, name))));
    assert.equal(bytes.includes(Buffer.from(secretMarker)), false);
    console.log("Phase 8 SQLite persistence, CAS, idempotency, audit, and reopen contracts: PASS");
  } finally {
    if (store) await store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
