#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Existing Web-lab QA uses a scoped TS hook. */
"use strict";
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const postgres = require("postgres");
const webLab = require("../phase5/loadWebLab");
const { PostgresWebLabControlRepository, WebLabPersistenceError } =
  require("../../../lib/web-lab/postgres-control-repository.ts");

const connection = process.env.PHASE12_TEST_DATABASE_URL;
if (!connection) throw new Error("PHASE12_TEST_DATABASE_URL is required");
const parsed = new URL(connection);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/amniora_phase12_test") {
  throw new Error("Refusing to run against anything but isolated loopback test DB");
}
const db = postgres(connection, { max: 12 });
const repo = new PostgresWebLabControlRepository(db);
const fingerprint = value => createHash("sha256").update(value).digest("hex");

async function errorCode(promise, code) {
  await assert.rejects(promise, error => error instanceof WebLabPersistenceError && error.code === code);
}

async function main() {
  const owners = Array.from({ length: 8 }, () => ({ ownerId: randomUUID(), savedLabId: randomUUID() }));
  for (const owner of owners) {
    await db`insert into auth.users (id) values (${owner.ownerId})`;
    await db`insert into public.labs (id, user_id, topic) values (${owner.savedLabId}, ${owner.ownerId}, 'Web Security')`;
  }
  const spec = webLab.planBeginnerHelpdeskLab(`phase12-${randomUUID()}`);
  const runtimeVersion = "phase12-runtime-1";
  const builds = [];
  for (const owner of owners) {
    builds.push(await repo.createBuild({ savedLabId: owner.savedLabId, ownerId: owner.ownerId,
      spec, runtimeVersion }));
  }
  assert.equal(builds[0].buildFingerprint, builds[1].buildFingerprint,
    "same canonical spec can be separately owned");
  assert.notEqual(builds[0].id, builds[1].id);
  assert.equal(await repo.getBuildMetadata(owners[0].savedLabId, owners[1].ownerId), null);
  assert.equal(await repo.getTrustedBuild(builds[0].id, owners[1].ownerId), null);
  assert.deepEqual((await repo.getCompletionForOwner(builds[0].id, owners[1].ownerId)), []);
  assert.equal(JSON.stringify(builds[0]).includes("internalSolution"), false);
  assert.equal(JSON.stringify(builds[0]).includes("canonical_spec"), false);
  assert.deepEqual((await repo.getTrustedBuild(builds[0].id, owners[0].ownerId)).spec, spec);
  await assert.rejects(repo.createBuild({ savedLabId: owners[0].savedLabId,
    ownerId: owners[0].ownerId, spec, runtimeVersion }), { code: "23505" });
  await assert.rejects(repo.createBuild({ savedLabId: owners[0].savedLabId,
    ownerId: owners[1].ownerId, spec, runtimeVersion }), { code: "23505" });
  const foreignLabId = randomUUID();
  await db`insert into public.labs (id, user_id, topic)
    values (${foreignLabId}, ${owners[0].ownerId}, 'Web Security')`;
  await assert.rejects(repo.createBuild({ savedLabId: foreignLabId,
    ownerId: owners[1].ownerId, spec, runtimeVersion }), { code: "23503" });
  await assert.rejects(db`update web_lab_control.web_lab_builds set seed = 'tampered' where id = ${builds[0].id}`,
    /immutable_web_lab_record/);
  await assert.rejects(db.begin(async tx => {
    await tx`set local role authenticated`;
    await tx`select * from web_lab_control.web_lab_builds limit 1`;
  }), /permission denied/);
  await assert.rejects(db.begin(async tx => {
    await tx`set local role authenticated`;
    await tx`insert into web_lab_control.web_lab_completions (id) values (${randomUUID()})`;
  }), /permission denied/);
  const serviceRows = await db.begin(async tx => {
    await tx`set local role service_role`;
    return tx`select id from web_lab_control.web_lab_builds where id = ${builds[0].id}`;
  });
  assert.equal(serviceRows.length, 1);

  // Defaults fail closed. Only this isolated test database is enabled below.
  await errorCode(repo.admitHosted({ ownerId: owners[0].ownerId,
    savedLabId: owners[0].savedLabId, idempotencyKey: "disabled-0", providerKind: "fake_runner",
    runtimeVersion, ttlMinutes: 15, reservedCostGbpPence: 100 }), "HOSTED_DISABLED");
  await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
    budget_state = 'NORMAL', metrics_observed_at = now() where singleton_id = 1`;
  const admit = (index, key = `create-${index}`) => repo.admitHosted({
    ownerId: owners[index].ownerId, savedLabId: owners[index].savedLabId,
    idempotencyKey: key, providerKind: "fake_runner", runtimeVersion,
    ttlMinutes: 15, reservedCostGbpPence: 100,
  });
  const duplicate = await Promise.all([admit(0), admit(0)]);
  assert.equal(duplicate[0].instanceId, duplicate[1].instanceId);
  assert.equal(duplicate.filter(item => item.replayed).length, 1);
  const burst = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => admit(index + 1)));
  const accepted = burst.filter(item => item.status === "fulfilled").map(item => item.value);
  const denied = burst.filter(item => item.status === "rejected").map(item => item.reason);
  assert.equal(accepted.length, 4);
  assert.equal(denied.length, 2);
  assert.ok(denied.every(error => error instanceof WebLabPersistenceError &&
    error.code === "HOSTED_CAPACITY_FULL"));
  assert.equal(new Set([duplicate[0], ...accepted].map(item => item.slotNo)).size, 5);
  const [slots] = await db`select count(*)::int as n from web_lab_control.runtime_admission_slots where instance_id is not null`;
  assert.equal(slots.n, 5);
  const [budget] = await db`select reserved_spend_gbp_pence from web_lab_control.runtime_budget_policy`;
  assert.equal(budget.reserved_spend_gbp_pence, 500);
  await errorCode(admit(0, "second-create-key"), "RUNTIME_ALREADY_ACTIVE");
  const [createCount] = await db`select count(*)::int as n from web_lab_control.runtime_commands
    where owner_id = ${owners[0].ownerId} and operation = 'create'`;
  assert.equal(createCount.n, 1);
  await assert.rejects(db`
    insert into web_lab_control.runtime_instances (
      owner_id, web_lab_build_id, runtime_mode, provider_kind, runtime_version,
      route_key, expires_at
    ) values (${owners[0].ownerId}, ${builds[0].id}, 'amniora_hosted', 'fake_runner',
      ${runtimeVersion}, ${randomUUID()}, now() + interval '10 minutes')`,
  { code: "23505" });
  assert.equal(await repo.getRuntimeForOwner(duplicate[0].instanceId, owners[1].ownerId), null);
  await errorCode(repo.requestReset({ instanceId: duplicate[0].instanceId,
    ownerId: owners[1].ownerId, idempotencyKey: "foreign-reset", expectedVersion: 1 }), "RUNTIME_NOT_FOUND");
  await errorCode(repo.requestDestroy({ instanceId: duplicate[0].instanceId,
    ownerId: owners[1].ownerId, idempotencyKey: "foreign-destroy", expectedVersion: 1 }), "RUNTIME_NOT_FOUND");
  await errorCode(repo.recordGrade({ instanceId: duplicate[0].instanceId,
    ownerId: owners[1].ownerId, outcome: "pass", graderVersion: "v1",
    observationFingerprint: fingerprint("foreign") }), "RUNTIME_NOT_FOUND");

  const requested = await repo.getRuntimeForOwner(duplicate[0].instanceId, owners[0].ownerId);
  assert.equal(JSON.stringify(requested).includes("backendReference"), false);
  assert.equal(JSON.stringify(requested).includes("routeKey"), false);
  let current = await repo.transitionRuntime({ instanceId: duplicate[0].instanceId,
    ownerId: owners[0].ownerId, expectedVersion: requested.version,
    status: "provisioning", auditEvent: "provider_create_started" });
  await errorCode(repo.transitionRuntime({ instanceId: duplicate[0].instanceId,
    ownerId: owners[0].ownerId, expectedVersion: requested.version,
    status: "ready", auditEvent: "instance_ready" }), "STALE_RUNTIME_VERSION");
  current = await repo.transitionRuntime({ instanceId: duplicate[0].instanceId,
    ownerId: owners[0].ownerId, expectedVersion: current.version,
    status: "ready", backendReference: "internal-fake-ref", auditEvent: "instance_ready" });
  assert.equal(JSON.stringify(await repo.getRuntimeForOwner(current.instanceId, owners[0].ownerId))
    .includes("internal-fake-ref"), false);
  const notComplete = await repo.recordGrade({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, outcome: "not_complete", graderVersion: "v1" });
  assert.equal(notComplete.completionId, null);
  await errorCode(repo.recordGrade({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, outcome: "pass", graderVersion: "v1" }),
  "TRUSTED_OBSERVATION_REQUIRED");
  const passed = await repo.recordGrade({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, outcome: "pass", graderVersion: "v1",
    observationFingerprint: fingerprint("trusted-observation") });
  assert.equal(passed.trustLevel, "hosted_verified");
  assert.ok(passed.completionId);
  assert.equal((await repo.getCompletionForOwner(builds[0].id, owners[0].ownerId)).length, 1);
  await assert.rejects(db`
    insert into web_lab_control.web_lab_completions (
      owner_id, web_lab_build_id, runtime_instance_id, trusted_grade_id,
      trust_level, grader_version, completion_fingerprint
    ) values (${owners[0].ownerId}, ${builds[0].id}, ${current.instanceId},
      ${notComplete.attemptId}, 'hosted_verified', 'v1', ${fingerprint("fake")})`,
  /untrusted_web_lab_completion/);

  const reset = await Promise.all([repo.requestReset({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, idempotencyKey: "reset-one", expectedVersion: current.version }),
  repo.requestReset({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, idempotencyKey: "reset-one", expectedVersion: current.version })]);
  assert.equal(reset[0].commandId, reset[1].commandId);
  assert.equal(reset[0].generationVersion, 2);
  assert.equal(reset[1].generationVersion, 2);
  assert.equal(reset.filter(item => item.replayed).length, 1);
  let afterReset = await repo.getRuntimeForOwner(current.instanceId, owners[0].ownerId);
  assert.equal(afterReset.generationVersion, 2);
  await errorCode(repo.requestReset({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, idempotencyKey: "stale-reset", expectedVersion: current.version }),
  "STALE_RUNTIME_VERSION");
  afterReset = await repo.transitionRuntime({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, expectedVersion: afterReset.version,
    status: "ready", auditEvent: "reset_completed" });
  const destroy = await Promise.all([repo.requestDestroy({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, idempotencyKey: "destroy-one", expectedVersion: afterReset.version }),
  repo.requestDestroy({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, idempotencyKey: "destroy-one", expectedVersion: afterReset.version })]);
  assert.equal(destroy[0].commandId, destroy[1].commandId);
  assert.equal(destroy.filter(item => item.replayed).length, 1);
  await errorCode(repo.releaseAdmissionAfterProviderAbsence({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, providerAbsentConfirmed: true }), "RUNTIME_NOT_TERMINAL");
  const destroying = await repo.getRuntimeForOwner(current.instanceId, owners[0].ownerId);
  await repo.transitionRuntime({ instanceId: current.instanceId, ownerId: owners[0].ownerId,
    expectedVersion: destroying.version, status: "destroyed", auditEvent: "destroyed" });
  assert.equal(await repo.releaseAdmissionAfterProviderAbsence({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, providerAbsentConfirmed: true }), true);
  assert.equal(await repo.releaseAdmissionAfterProviderAbsence({ instanceId: current.instanceId,
    ownerId: owners[0].ownerId, providerAbsentConfirmed: true }), false);
  assert.equal((await repo.getCompletionForOwner(builds[0].id, owners[0].ownerId)).length, 1);

  // A failed provision remains reconcilable until trusted provider absence releases its slot.
  const failed = accepted[0];
  const pending = await repo.getRuntimeForOwner(failed.instanceId, owners[1].ownerId);
  await repo.transitionRuntime({ instanceId: failed.instanceId, ownerId: owners[1].ownerId,
    expectedVersion: pending.version, status: "failed", failureCode: "test_failure",
    auditEvent: "runtime_lost" });
  const candidates = await repo.listReconciliationCandidates(new Date(Date.now() + 60_000));
  assert.ok(candidates.some(row => row.instanceId === failed.instanceId));
  assert.equal(await repo.releaseAdmissionAfterProviderAbsence({ instanceId: failed.instanceId,
    ownerId: owners[1].ownerId, providerAbsentConfirmed: true }), true);
  const [freeSlots] = await db`select count(*)::int as n from web_lab_control.runtime_admission_slots where instance_id is null`;
  assert.equal(freeSlots.n, 2);
  const [postReleaseBudget] = await db`select reserved_spend_gbp_pence from web_lab_control.runtime_budget_policy`;
  assert.equal(postReleaseBudget.reserved_spend_gbp_pence, 300);

  await db`update web_lab_control.runtime_budget_policy set budget_state = 'DISABLED' where singleton_id = 1`;
  await errorCode(admit(6, "budget-denied"), "HOSTED_DISABLED");
  const local = await repo.createSelfHostedRuntime({ ownerId: owners[6].ownerId,
    savedLabId: owners[6].savedLabId, runtimeMode: "local_runner", providerKind: "local_docker",
    runtimeVersion, ttlMinutes: 60 });
  const byo = await repo.createSelfHostedRuntime({ ownerId: owners[7].ownerId,
    savedLabId: owners[7].savedLabId, runtimeMode: "byo_runtime", providerKind: "future_runner",
    runtimeVersion, ttlMinutes: 60 });
  assert.equal(local.runtimeMode, "local_runner");
  assert.equal(byo.runtimeMode, "byo_runtime");
  await errorCode(repo.createSelfHostedRuntime({ ownerId: owners[6].ownerId,
    savedLabId: owners[6].savedLabId, runtimeMode: "amniora_hosted",
    providerKind: "fake_runner", runtimeVersion, ttlMinutes: 60 }), "INVALID_RUNTIME_REQUEST");
  const [slotsAfterSelfHosted] = await db`select count(*)::int as n from web_lab_control.runtime_admission_slots where instance_id is not null`;
  assert.equal(slotsAfterSelfHosted.n, 3);

  const sampleId = await repo.recordUsage({ instanceId: duplicate[0].instanceId,
    providerKind: "fake_runner", generationVersion: 1,
    windowStartedAt: new Date(Date.now() - 1000), windowEndedAt: new Date(),
    provisionedSeconds: 1, activeCpuMs: 12, memoryMbSeconds: 24,
    ingressBytes: 3, egressBytes: 4, graderMs: 5, measurementSource: "test" });
  await assert.rejects(db`update web_lab_control.runtime_usage set active_cpu_ms = 999 where id = ${sampleId}`,
    /immutable_web_lab_record/);
  await assert.rejects(db`update web_lab_control.runtime_audit_events set result = 'failed' where event_id =
    (select min(event_id) from web_lab_control.runtime_audit_events)`, /immutable_web_lab_record/);
  const claimed = await repo.claimPendingCommand("worker-one", 30);
  assert.ok(claimed);
  await errorCode(repo.completeCommand({ commandId: claimed.id, workerId: "worker-one",
    fenceToken: Number(claimed.fence_token) + 1, outcome: "completed", resultCode: "ok" }),
  "STALE_COMMAND_LEASE");
  await repo.completeCommand({ commandId: claimed.id, workerId: "worker-one",
    fenceToken: Number(claimed.fence_token), outcome: "completed", resultCode: "ok" });
  await errorCode(repo.completeCommand({ commandId: claimed.id, workerId: "worker-one",
    fenceToken: Number(claimed.fence_token), outcome: "completed", resultCode: "ok" }),
  "STALE_COMMAND_LEASE");
  const [oldCompleted] = await db`select completed from public.labs where id = ${owners[0].savedLabId}`;
  assert.equal(oldCompleted.completed, false);
  console.log("Phase 12 Postgres contracts: PASS (build, ownership, RLS, 5-slot concurrency, CAS, idempotency, completion, reconciliation, budget, usage, audit)");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.end(); });
