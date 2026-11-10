#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Existing Web-lab QA uses a scoped TS hook. */
"use strict";
const assert = require("node:assert/strict");
const { createHash, createHmac, randomUUID } = require("node:crypto");
const Module = require("node:module");
const postgres = require("postgres");
const webLab = require("../phase5/loadWebLab");
const loadModule = Module._load;
Module._load = function serverOnlyTestBoundary(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return loadModule.call(this, specifier, parent, isMain);
};
const { PostgresWebLabControlRepository } = require("../../../lib/web-lab/postgres-control-repository.ts");
const { WebLabControlPlaneService, WebLabControlError, ExactWebLabCompatibilityPolicy } =
  require("../../../lib/web-lab/production-control-service.ts");
const { createWebLabRuntimeApiContracts } =
  require("../../../lib/web-lab/runtime-api-contracts.ts");

const connection = process.env.PHASE13_TEST_DATABASE_URL;
if (!connection) throw new Error("PHASE13_TEST_DATABASE_URL is required");
const parsed = new URL(connection);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/amniora_phase13_test") {
  throw new Error("Refusing to run against anything but isolated loopback Phase 13 test DB");
}
const db = postgres(connection, { max: 20 });
const repo = new PostgresWebLabControlRepository(db);
const digest = value => createHash("sha256").update(value).digest("hex");
const runtimeVersion = "phase13-fake-1";

class FakeRuntimeBackend {
  constructor() {
    this.resources = new Map();
    this.unrelated = new Set(["unrelated-provider-resource"]);
    this.createCalls = []; this.resetCalls = []; this.destroyCalls = []; this.destroyManagedCalls = [];
    this.failBefore = false; this.failAfter = false; this.delayMs = 0;
  }
  reference(context) {
    return `https://amniora-test-${context.instanceId}-g${context.generationVersion}.vercel.run`;
  }
  observation(resource) {
    return { reference: resource.reference, instanceId: resource.context.instanceId,
      buildFingerprint: resource.context.buildFingerprint,
      generationVersion: resource.context.generationVersion,
      runtimeVersion: resource.context.runtimeVersion, state: "ready" };
  }
  async create(_spec, context) {
    this.createCalls.push(context.instanceId);
    if (this.delayMs) await new Promise(resolve => setTimeout(resolve, this.delayMs));
    if (this.failBefore) { this.failBefore = false; throw new Error("provider-secret-create-error"); }
    const resource = { context: structuredClone(context), reference: this.reference(context) };
    this.resources.set(context.instanceId, resource);
    if (this.failAfter) { this.failAfter = false; throw new Error("provider-secret-after-create"); }
    return resource.reference;
  }
  async inspect(_reference, expected) {
    const resource = this.resources.get(expected.instanceId);
    if (!resource) return { state: "missing", observation: null };
    if (resource.context.buildFingerprint !== expected.buildFingerprint ||
        resource.context.generationVersion !== expected.generationVersion ||
        resource.context.runtimeVersion !== expected.runtimeVersion) {
      return { state: "mismatch", observation: this.observation(resource) };
    }
    return { state: "ready", observation: this.observation(resource) };
  }
  async status(reference, context) {
    return (await this.inspect(reference, context)).state === "ready" ? "ready" : "destroyed";
  }
  async reset(_reference, context) {
    this.resetCalls.push(context.instanceId);
    const resource = { context: structuredClone(context), reference: this.reference(context) };
    this.resources.set(context.instanceId, resource);
  }
  async destroy(_reference, context) {
    this.destroyCalls.push(context.instanceId);
    this.resources.delete(context.instanceId);
  }
  async listManaged() {
    return [...this.resources.values()].map(item => this.observation(item));
  }
  async destroyManaged(observation) {
    this.destroyManagedCalls.push(observation.instanceId);
    this.resources.delete(observation.instanceId);
  }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => error instanceof WebLabControlError && error.code === code);
}

function request(method, path, body, headers = {}) {
  return new Request(`https://local.example${path}`, { method,
    headers: { Origin: "https://local.example",
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function main() {
  const owners = Array.from({ length: 22 }, () => ({ userId: randomUUID(), savedLabId: randomUUID(), sessionId: randomUUID() }));
  const actor = index => ({ userId: owners[index].userId, sessionId: owners[index].sessionId });
  const builds = [];
  const spec = webLab.planBeginnerHelpdeskLab(`phase13-${randomUUID()}`);
  for (const owner of owners) {
    await db`insert into auth.users (id) values (${owner.userId})`;
    await db`insert into public.labs (id, user_id, topic)
      values (${owner.savedLabId}, ${owner.userId}, 'Web Security')`;
    builds.push(await repo.createBuild({ savedLabId: owner.savedLabId, ownerId: owner.userId,
      spec, runtimeVersion }));
  }
  const backend = new FakeRuntimeBackend();
  const freeUsers = new Set([owners[0].userId]);
  const unsupportedBuilds = new Set();
  const rateDenials = new Set();
  const grader = { outcome: "not_complete", calls: 0,
    async grade() { this.calls++; return { outcome: this.outcome,
      graderVersion: "phase13-test-grader-1",
      ...(this.outcome === "pass" ? { observationFingerprint: digest(`trusted-grade-${this.calls}`) } : {}) }; } };
  let clockMs = Date.now();
  const signingKey = Buffer.alloc(32, 13);
  const dependencies = {
    repository: repo,
    entitlement: { async planFor(identity) { return freeUsers.has(identity.userId) ? "free" : "pro"; } },
    ratePolicy: { async assertAllowed(identity, operation) {
      if (rateDenials.has(`${identity.userId}:${operation}`)) {
        throw new WebLabControlError(operation === "grade" ? "GRADE_RATE_LIMITED" : "RATE_LIMITED");
      }
    } },
    compatibility: { verdict(build, mode, version) {
      return unsupportedBuilds.has(build.id) ? "MIGRATABLE" :
        new ExactWebLabCompatibilityPolicy().verdict(build, mode, version);
    } },
    grader,
    backends: [{ mode: "amniora_hosted", providerKind: "fake_runner", runtimeVersion, backend }],
    signingKey, now: () => clockMs, grantMs: 5_000,
  };
  const service = new WebLabControlPlaneService(dependencies);
  const launch = (index, key = `launch-${index}`) => service.launch(actor(index), {
    savedLabId: owners[index].savedLabId, mode: "amniora_hosted", idempotencyKey: key });
  const currentPolicy = async () => (await db`
    select hosted_runtime_enabled, budget_state, reserved_spend_gbp_pence
    from web_lab_control.runtime_budget_policy where singleton_id = 1`)[0];

  await expectCode(launch(0), "HOSTED_PLAN_REQUIRED");
  unsupportedBuilds.add(builds[1].id);
  await expectCode(launch(1), "LAB_INCOMPATIBLE");
  unsupportedBuilds.delete(builds[1].id);
  await expectCode(service.launch(actor(2), { savedLabId: owners[1].savedLabId,
    mode: "amniora_hosted", idempotencyKey: "foreign" }), "LAB_NOT_FOUND");
  await expectCode(launch(1), "HOSTED_DISABLED");
  await expectCode(service.launch(actor(0), { savedLabId: owners[0].savedLabId,
    mode: "local_runner", idempotencyKey: "local-allowed-but-no-runner" }), "RUNNER_UNAVAILABLE");
  rateDenials.add(`${owners[1].userId}:launch`);
  await expectCode(launch(1), "RATE_LIMITED");
  rateDenials.clear();
  const quotaService = new WebLabControlPlaneService({ ...dependencies,
    ratePolicy: { async assertAllowed() { throw new WebLabControlError("HOSTED_QUOTA_EXCEEDED"); } } });
  await expectCode(quotaService.launch(actor(1), { savedLabId: owners[1].savedLabId,
    mode: "amniora_hosted", idempotencyKey: "quota-denied" }), "HOSTED_QUOTA_EXCEEDED");
  await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
    budget_state = 'NORMAL', metrics_observed_at = now() where singleton_id = 1`;

  const first = await launch(1, "first-create");
  assert.equal(first.status, "ready");
  assert.ok(first.launchGrant?.token);
  assert.equal(backend.createCalls.length, 1);
  assert.equal(JSON.stringify(first).includes("vercel.run"), false);
  assert.equal(JSON.stringify(first).includes("internalSolution"), false);
  assert.equal(JSON.stringify(first).includes("backendReference"), false);
  assert.equal((await repo.getRuntimeControl(first.instanceId, owners[1].userId)).backendReference,
    backend.reference({ instanceId: first.instanceId, generationVersion: 1 }));
  const repeatedCreate = await launch(1, "first-create");
  assert.equal(repeatedCreate.instanceId, first.instanceId);
  assert.equal(backend.createCalls.length, 1);
  await expectCode(launch(1, "different-create"), "RUNTIME_ALREADY_ACTIVE");
  await expectCode(service.getRuntimeStatus(actor(2), first.instanceId), "RUNTIME_NOT_FOUND");
  await expectCode(service.reset(actor(2), { instanceId: first.instanceId,
    idempotencyKey: "foreign-reset" }), "RUNTIME_NOT_FOUND");
  await expectCode(service.destroy(actor(2), { instanceId: first.instanceId,
    idempotencyKey: "foreign-destroy" }), "RUNTIME_NOT_FOUND");
  assert.equal((await service.getRuntimeStatus(actor(1), first.instanceId)).status, "ready");

  const firstGrant = first.launchGrant.token;
  await expectCode(service.exchangeLaunchGrant(actor(2), firstGrant), "INVALID_LAUNCH_GRANT");
  const wrongAudiencePayload = Buffer.from(JSON.stringify({
    audience: "web-lab-gateway-session", grantId: "test-grant", instanceId: first.instanceId,
    ownerId: owners[1].userId, sessionId: owners[1].sessionId,
    generationVersion: 1, expiresAt: clockMs + 5000,
  })).toString("base64url");
  const wrongAudience = `${wrongAudiencePayload}.${createHmac("sha256", signingKey)
    .update(wrongAudiencePayload).digest("base64url")}`;
  await expectCode(service.exchangeLaunchGrant(actor(1), wrongAudience), "INVALID_LAUNCH_GRANT");
  const exchanged = await service.exchangeLaunchGrant(actor(1), firstGrant);
  assert.equal(exchanged.instanceId, first.instanceId);
  assert.equal(JSON.stringify(exchanged).includes("vercel.run"), false);
  assert.equal((await service.authorizeGatewaySession(exchanged.token, actor(1))).instanceId,
    first.instanceId);
  await expectCode(service.exchangeLaunchGrant(actor(1), firstGrant), "LAUNCH_GRANT_REPLAYED");
  const [storedGrant] = await db`select grant_id_hash from web_lab_control.runtime_launch_exchanges limit 1`;
  assert.match(storedGrant.grant_id_hash, /^[0-9a-f]{64}$/);
  assert.equal(storedGrant.grant_id_hash.includes(firstGrant), false);
  await assert.rejects(db`update web_lab_control.runtime_launch_exchanges
    set generation_version = 99 where grant_id_hash = ${storedGrant.grant_id_hash}`,
  /immutable_web_lab_record/);
  await assert.rejects(db.begin(async tx => {
    await tx`set local role authenticated`;
    await tx`select * from web_lab_control.runtime_launch_exchanges limit 1`;
  }), /permission denied/);
  await expectCode(service.exchangeLaunchGrant({ userId: actor(1).userId,
    sessionId: randomUUID() }, firstGrant), "INVALID_LAUNCH_GRANT");
  const expiringGrant = (await service.issueLaunchGrant(actor(1), first.instanceId)).token;
  clockMs += 6_000;
  await expectCode(service.exchangeLaunchGrant(actor(1), expiringGrant), "LAUNCH_GRANT_EXPIRED");
  clockMs -= 6_000;

  grader.outcome = "not_complete";
  assert.equal((await service.grade(actor(1), first.instanceId,
    "grade-not-complete", exchanged.token)).completed, false);
  assert.equal((await repo.getCompletionForOwner(builds[1].id, owners[1].userId)).length, 0);
  grader.outcome = "pass";
  const passed = await service.grade(actor(1), first.instanceId, "grade-pass", exchanged.token);
  assert.equal(passed.completed, true);
  const passedAgain = await service.grade(actor(1), first.instanceId, "grade-pass", exchanged.token);
  assert.equal(passedAgain.completionId, passed.completionId);
  assert.equal((await repo.getCompletionForOwner(builds[1].id, owners[1].userId)).length, 1);
  rateDenials.add(`${owners[1].userId}:grade`);
  await expectCode(service.grade(actor(1), first.instanceId,
    "grade-rate-denied", exchanged.token), "GRADE_RATE_LIMITED");
  rateDenials.clear();
  const unavailableGrader = new WebLabControlPlaneService({ ...dependencies,
    grader: { async grade() { throw new Error("private-grader-failure"); } } });
  await expectCode(unavailableGrader.grade(actor(1), first.instanceId,
    "grade-provider-failed", exchanged.token), "GRADE_UNAVAILABLE");
  const [gradePersistence] = await db`
    select
      (select count(*)::int from web_lab_control.web_lab_grade_attempts
        where instance_id = ${first.instanceId}) as attempts,
      (select count(*)::int from web_lab_control.web_lab_completions
        where runtime_instance_id = ${first.instanceId}) as completions
  `;
  assert.deepEqual(gradePersistence, { attempts: 3, completions: 1 });

  let beforeReset = (await repo.getRuntimeControl(first.instanceId, owners[1].userId)).backendReference;
  const resetOne = await service.reset(actor(1), { instanceId: first.instanceId, idempotencyKey: "reset-1" });
  assert.equal(resetOne.generationVersion, 2);
  assert.equal(backend.resetCalls.length, 1);
  const afterReset = (await repo.getRuntimeControl(first.instanceId, owners[1].userId)).backendReference;
  assert.notEqual(beforeReset, afterReset);
  beforeReset = afterReset;
  const resetAgain = await service.reset(actor(1), { instanceId: first.instanceId, idempotencyKey: "reset-1" });
  assert.equal(resetAgain.generationVersion, 2);
  assert.equal(backend.resetCalls.length, 1);
  await expectCode(service.exchangeLaunchGrant(actor(1), repeatedCreate.launchGrant.token), "INVALID_LAUNCH_GRANT");
  await service.reset(actor(1), { instanceId: first.instanceId, idempotencyKey: "reset-2" });
  const resetThree = await service.reset(actor(1), { instanceId: first.instanceId, idempotencyKey: "reset-3" });
  assert.equal(resetThree.generationVersion, 4);
  assert.equal(resetThree.remainingResets, 0);
  assert.notEqual((await repo.getRuntimeControl(first.instanceId, owners[1].userId)).backendReference, beforeReset);
  await expectCode(service.reset(actor(1), { instanceId: first.instanceId,
    idempotencyKey: "reset-4" }), "RESET_LIMIT_EXCEEDED");
  const destroyed = await service.destroy(actor(1), { instanceId: first.instanceId, idempotencyKey: "destroy-1" });
  assert.equal(destroyed.status, "destroyed");
  assert.equal((await service.destroy(actor(1), { instanceId: first.instanceId,
    idempotencyKey: "destroy-1" })).status, "destroyed");
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);
  assert.equal((await repo.getCompletionForOwner(builds[1].id, owners[1].userId)).length, 1);

  const missingOnDestroy = await launch(2);
  backend.resources.delete(missingOnDestroy.instanceId);
  assert.equal((await service.destroy(actor(2), { instanceId: missingOnDestroy.instanceId,
    idempotencyKey: "already-missing" })).status, "destroyed");
  backend.failBefore = true;
  await expectCode(launch(3), "RUNTIME_PROVISIONING_FAILED");
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);
  const [failedAdmission] = await db`select i.lifecycle_state, a.state as admission_state
    from web_lab_control.runtime_instances i
    join web_lab_control.runtime_admission a on a.instance_id = i.id
    where i.owner_id = ${owners[3].userId}`;
  assert.equal(failedAdmission.lifecycle_state, "failed");
  assert.equal(failedAdmission.admission_state, "released");

  await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = false where singleton_id = 1`;
  await expectCode(launch(4), "HOSTED_DISABLED");
  await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
    budget_state = 'DISABLED' where singleton_id = 1`;
  await expectCode(launch(4), "HOSTED_DISABLED");
  await db`update web_lab_control.runtime_budget_policy set budget_state = 'RESTRICTED' where singleton_id = 1`;
  await expectCode(launch(4), "HOSTED_BUDGET_RESTRICTED");
  await db`update web_lab_control.runtime_budget_policy set budget_state = 'NORMAL',
    observed_spend_gbp_pence = 3950 where singleton_id = 1`;
  await expectCode(launch(4), "HOSTED_BUDGET_EXCEEDED");
  await db`update web_lab_control.runtime_budget_policy set observed_spend_gbp_pence = 0 where singleton_id = 1`;
  await db`update web_lab_control.runtime_budget_policy set budget_state = 'WARNING' where singleton_id = 1`;
  const warning = await launch(4);
  const [warningAudit] = await db`select count(*)::int as n from web_lab_control.runtime_audit_events
    where instance_id = ${warning.instanceId} and event_type = 'budget_warning_launch'`;
  assert.equal(warningAudit.n, 1);
  await service.destroy(actor(4), { instanceId: warning.instanceId, idempotencyKey: "warning-destroy" });
  await db`update web_lab_control.runtime_budget_policy set budget_state = 'NORMAL' where singleton_id = 1`;

  backend.delayMs = 30;
  const duplicate = await Promise.all([launch(12, "same-key"), launch(12, "same-key")]);
  assert.equal(duplicate[0].instanceId, duplicate[1].instanceId);
  assert.equal(backend.createCalls.filter(id => id === duplicate[0].instanceId).length, 1);
  await service.destroy(actor(12), { instanceId: duplicate[0].instanceId, idempotencyKey: "same-destroy" });
  backend.delayMs = 0;

  const beforeBurstCreateCalls = backend.createCalls.length;
  const burst = await Promise.allSettled(Array.from({ length: 7 }, (_, offset) => launch(5 + offset)));
  const accepted = burst.filter(item => item.status === "fulfilled").map(item => item.value);
  const denied = burst.filter(item => item.status === "rejected").map(item => item.reason);
  assert.equal(accepted.length, 5);
  assert.equal(denied.length, 2);
  assert.ok(denied.every(item => item instanceof WebLabControlError && item.code === "HOSTED_CAPACITY_FULL"));
  assert.equal(accepted.filter(item => item.status === "ready").length, 5);
  assert.equal(backend.createCalls.length - beforeBurstCreateCalls, 5);
  const [occupied] = await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
    where instance_id is not null`;
  assert.equal(occupied.n, 5);
  for (const item of accepted) {
    const [saved] = await db`select owner_id from web_lab_control.runtime_instances where id = ${item.instanceId}`;
    const index = owners.findIndex(owner => owner.userId === saved.owner_id);
    assert.ok(index >= 0);
    await service.destroy(actor(index), { instanceId: item.instanceId, idempotencyKey: `burst-destroy-${index}` });
  }
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);

  const leaseAdmission = await repo.admitHosted({ ownerId: owners[13].userId,
    savedLabId: owners[13].savedLabId, idempotencyKey: "lease-test",
    providerKind: "fake_runner", runtimeVersion, ttlMinutes: 30,
    reservedCostGbpPence: 100 });
  const oldLease = await repo.claimCommandById(leaseAdmission.commandId, "worker-old", 30);
  await db`update web_lab_control.runtime_commands set lease_until = now() - interval '1 second'
    where id = ${leaseAdmission.commandId}`;
  const newLease = await repo.claimCommandById(leaseAdmission.commandId, "worker-new", 30);
  assert.ok(newLease.fenceToken > oldLease.fenceToken);
  const leaseRuntime = await repo.getRuntimeControl(leaseAdmission.instanceId, owners[13].userId);
  await assert.rejects(repo.transitionRuntime({ instanceId: leaseAdmission.instanceId,
    ownerId: owners[13].userId, expectedVersion: leaseRuntime.version,
    status: "provisioning", auditEvent: "provider_create_started", commandLease: oldLease }),
  error => error.code === "STALE_RUNTIME_VERSION");
  await repo.transitionRuntime({ instanceId: leaseAdmission.instanceId,
    ownerId: owners[13].userId, expectedVersion: leaseRuntime.version,
    status: "failed", auditEvent: "runtime_lost", commandLease: newLease });
  await assert.rejects(repo.transitionRuntime({ instanceId: leaseAdmission.instanceId,
    ownerId: owners[13].userId, expectedVersion: leaseRuntime.version,
    status: "destroyed", auditEvent: "destroyed" }),
  error => error.code === "STALE_RUNTIME_VERSION");
  await repo.completeCommand({ commandId: newLease.commandId, workerId: newLease.workerId,
    fenceToken: newLease.fenceToken, outcome: "failed", resultCode: "test_failed" });
  await repo.releaseAdmissionAfterProviderAbsence({ instanceId: leaseAdmission.instanceId,
    ownerId: owners[13].userId, providerAbsentConfirmed: true });

  // Crash after admission/logical insert: no provider exists, reconciliation releases the held slot.
  const admittedOnly = await repo.admitHosted({ ownerId: owners[14].userId,
    savedLabId: owners[14].savedLabId, idempotencyKey: "crash-after-admission",
    providerKind: "fake_runner", runtimeVersion, ttlMinutes: 30,
    reservedCostGbpPence: 100 });
  await service.reconcile(new Date(Date.now() + 60_000));
  assert.equal((await repo.getRuntimeControl(admittedOnly.instanceId, owners[14].userId)).status, "failed");
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);

  // Ambiguous provider create: the exact managed resource is adopted after lease expiry.
  backend.failAfter = true;
  await expectCode(launch(15), "RUNTIME_PROVISIONING_FAILED");
  const [ambiguous] = await db`select id from web_lab_control.runtime_instances where owner_id = ${owners[15].userId}`;
  assert.equal((await repo.getRuntimeControl(ambiguous.id, owners[15].userId)).status, "provisioning");
  await db`update web_lab_control.runtime_commands set lease_until = now() - interval '1 second'
    where instance_id = ${ambiguous.id} and operation = 'create'`;
  await service.reconcile(new Date(Date.now() + 60_000));
  assert.equal((await repo.getRuntimeControl(ambiguous.id, owners[15].userId)).status, "ready");
  await service.destroy(actor(15), { instanceId: ambiguous.id, idempotencyKey: "ambiguous-destroy" });

  // Crash after the backend reference write, before READY.
  let injected = false;
  const faultRepo = new Proxy(repo, { get(target, key) {
    if (key === "transitionRuntime") return async input => {
      const result = await target.transitionRuntime(input);
      if (!injected && input.backendReference && input.status === "provisioning") {
        injected = true; throw new Error("simulated-process-crash-after-reference-write");
      }
      return result;
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const faultService = new WebLabControlPlaneService({ ...dependencies, repository: faultRepo });
  await expectCode(faultService.launch(actor(16), { savedLabId: owners[16].savedLabId,
    mode: "amniora_hosted", idempotencyKey: "crash-after-reference" }),
  "RUNTIME_PROVISIONING_FAILED");
  const [persistedRef] = await db`select id, backend_reference from web_lab_control.runtime_instances
    where owner_id = ${owners[16].userId}`;
  assert.ok(persistedRef.backend_reference.includes("vercel.run"));
  await db`update web_lab_control.runtime_commands set lease_until = now() - interval '1 second'
    where instance_id = ${persistedRef.id} and operation = 'create'`;
  await service.reconcile(new Date(Date.now() + 60_000));
  assert.equal((await repo.getRuntimeControl(persistedRef.id, owners[16].userId)).status, "ready");
  await service.destroy(actor(16), { instanceId: persistedRef.id, idempotencyKey: "ref-destroy" });

  const staleReset = await launch(21, "stale-reset-launch");
  const staleResetRuntime = await repo.getRuntimeControl(staleReset.instanceId, owners[21].userId);
  await repo.requestReset({ instanceId: staleReset.instanceId,
    ownerId: owners[21].userId, idempotencyKey: "stale-reset-command",
    expectedVersion: staleResetRuntime.version });
  await service.reconcile(new Date(Date.now() + 60_000));
  const recoveredReset = await repo.getRuntimeControl(staleReset.instanceId, owners[21].userId);
  assert.equal(recoveredReset.status, "ready");
  assert.equal(recoveredReset.generationVersion, 2);
  await service.destroy(actor(21), { instanceId: staleReset.instanceId,
    idempotencyKey: "stale-reset-cleanup" });

  const lost = await launch(17);
  backend.resources.delete(lost.instanceId);
  await service.reconcile(new Date(Date.now() + 60_000));
  assert.equal((await repo.getRuntimeControl(lost.instanceId, owners[17].userId)).status, "failed");
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);
  const expiring = await launch(18);
  clockMs = new Date(expiring.expiresAt).getTime() + 1;
  assert.equal((await service.getRuntimeStatus(actor(18), expiring.instanceId)).status, "expired");
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);
  clockMs = Date.now();
  for (const [instanceId, build, generation] of [
    [staleReset.instanceId, builds[21], 2],
    [expiring.instanceId, builds[18], 1],
  ]) {
    const managedContext = { instanceId, buildFingerprint: build.buildFingerprint,
      generationVersion: generation, runtimeVersion };
    backend.resources.set(instanceId, { context: managedContext,
      reference: backend.reference(managedContext) });
  }
  await service.reconcile(new Date(Date.now() + 60_000));
  assert.equal(backend.resources.has(staleReset.instanceId), false);
  assert.equal(backend.resources.has(expiring.instanceId), false);

  const orphanId = randomUUID();
  backend.resources.set(orphanId, { context: { instanceId: orphanId,
    buildFingerprint: builds[1].buildFingerprint, generationVersion: 1, runtimeVersion },
  reference: `https://orphan-${orphanId}.vercel.run` });
  await service.reconcile(new Date(Date.now() + 60_000));
  assert.equal(backend.resources.has(orphanId), false);
  assert.equal(backend.unrelated.has("unrelated-provider-resource"), true);
  assert.ok(backend.destroyManagedCalls.includes(orphanId));

  // Persistence trust classes remain mode-bound even though Local/BYO runners are not implemented.
  for (const [index, mode, expectedTrust] of [
    [20, "local_runner", "local_self_hosted"],
    [21, "byo_runtime", "byo_self_hosted"],
  ]) {
    let selfHosted = await repo.createSelfHostedRuntime({ ownerId: owners[index].userId,
      savedLabId: owners[index].savedLabId, runtimeMode: mode,
      providerKind: mode === "local_runner" ? "local_docker" : "future_runner",
      runtimeVersion, ttlMinutes: 60 });
    selfHosted = await repo.transitionRuntime({ instanceId: selfHosted.instanceId,
      ownerId: owners[index].userId, expectedVersion: selfHosted.version,
      status: "provisioning", auditEvent: "provider_create_started" });
    selfHosted = await repo.transitionRuntime({ instanceId: selfHosted.instanceId,
      ownerId: owners[index].userId, expectedVersion: selfHosted.version,
      status: "ready", auditEvent: "instance_ready" });
    const graded = await repo.recordGrade({ instanceId: selfHosted.instanceId,
      ownerId: owners[index].userId, outcome: "pass", graderVersion: "phase13-test-grader-1",
      observationFingerprint: digest(`self-hosted-${mode}`) });
    assert.equal(graded.trustLevel, expectedTrust);
  }
  const oldBuildRuntime = await launch(20, "old-build-cleanup");
  const cleanupRepo = new Proxy(repo, { get(target, property) {
    if (property === "getTrustedBuild") return async () => { throw new Error("retired-compiler"); };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const cleanupService = new WebLabControlPlaneService({ ...dependencies, repository: cleanupRepo });
  assert.equal((await cleanupService.destroy(actor(20), { instanceId: oldBuildRuntime.instanceId,
    idempotencyKey: "retired-build-destroy" })).status, "destroyed");
  assert.equal((await currentPolicy()).reserved_spend_gbp_pence, 0);

  // API contracts are unregistered and default disabled; enabled is test-only.
  let authCalls = 0;
  const actorForRequest = async req => {
    authCalls++;
    const rawIndex = req.headers.get("x-test-owner");
    if (rawIndex === null) return null;
    const index = Number(rawIndex);
    return Number.isInteger(index) && index >= 0 && index < owners.length ? actor(index) : null;
  };
  const disabledApi = createWebLabRuntimeApiContracts({ service, resolveActor: actorForRequest });
  const disabledResponse = await disabledApi.launch(request("POST", "/api/web-labs/runtime/launch",
    { savedLabId: owners[19].savedLabId, mode: "amniora_hosted" },
    { "idempotency-key": "disabled" }));
  assert.equal(disabledResponse.status, 404);
  assert.equal(authCalls, 0);
  const api = createWebLabRuntimeApiContracts({ service, resolveActor: actorForRequest,
    enabled: true, gradingEnabled: true, trustedOrigin: "https://local.example" });
  const noAuth = await api.launch(request("POST", "/api/web-labs/runtime/launch",
    { savedLabId: owners[19].savedLabId, mode: "amniora_hosted" },
    { "idempotency-key": "no-auth" }));
  assert.equal(noAuth.status, 401);
  assert.deepEqual(await noAuth.json(), { data: null, error: { code: "UNAUTHENTICATED" } });
  const forgedOwner = await api.launch(request("POST", "/api/web-labs/runtime/launch",
    { savedLabId: owners[19].savedLabId, mode: "amniora_hosted", owner_id: owners[1].userId },
    { "x-test-owner": "19", "idempotency-key": "forged-owner" }));
  assert.equal(forgedOwner.status, 400);
  const apiLaunch = await api.launch(request("POST", "/api/web-labs/runtime/launch",
    { savedLabId: owners[19].savedLabId, mode: "amniora_hosted" },
    { "x-test-owner": "19", "idempotency-key": "api-launch" }));
  assert.equal(apiLaunch.status, 202);
  assert.equal(apiLaunch.headers.get("cache-control"), "no-store");
  const apiJson = await apiLaunch.json();
  assert.equal(apiJson.error, null);
  assert.equal(JSON.stringify(apiJson).includes("vercel.run"), false);
  assert.equal(JSON.stringify(apiJson).includes("provider-secret"), false);
  assert.equal(JSON.stringify(apiJson).includes("internalSolution"), false);
  const apiId = apiJson.data.instanceId;
  const forbiddenStatus = await api.status(request("GET", `/api/web-labs/runtime/${apiId}`,
    undefined, { "x-test-owner": "20" }), apiId);
  assert.equal(forbiddenStatus.status, 404);
  const forgedComplete = await api.grade(request("POST", `/api/web-labs/runtime/${apiId}/grade`,
    { completed: true }, { "x-test-owner": "19" }), apiId);
  assert.equal(forgedComplete.status, 400);
  assert.equal((await repo.getCompletionForOwner(builds[19].id, owners[19].userId)).length, 0);
  const apiExchange = await api.exchange(request("POST", "/api/web-labs/runtime/launch/exchange",
    { grant: apiJson.data.launchGrant.token }, { "x-test-owner": "19" }));
  assert.equal(apiExchange.status, 200);
  const apiExchangeJson = await apiExchange.json();
  assert.equal(JSON.stringify(apiExchangeJson).includes("vercel.run"), false);
  grader.outcome = "not_complete";
  const apiGrade = await api.grade(request("POST", `/api/web-labs/runtime/${apiId}/grade`,
    {}, { "x-test-owner": "19", "idempotency-key": "api-grade",
      "x-web-lab-runtime-session": apiExchangeJson.data.token }), apiId);
  assert.equal(apiGrade.status, 200);
  assert.equal((await apiGrade.json()).data.completed, false);
  const missingKey = await api.reset(request("POST", `/api/web-labs/runtime/${apiId}/reset`,
    {}, { "x-test-owner": "19" }), apiId);
  assert.equal(missingKey.status, 400);
  await service.destroy(actor(19), { instanceId: apiId, idempotencyKey: "api-cleanup" });
  backend.failBefore = true;
  const providerFailureResponse = await api.launch(request("POST", "/api/web-labs/runtime/launch",
    { savedLabId: owners[20].savedLabId, mode: "amniora_hosted" },
    { "x-test-owner": "20", "idempotency-key": "api-provider-failure" }));
  assert.equal(providerFailureResponse.status, 503);
  const providerFailureJson = await providerFailureResponse.json();
  assert.deepEqual(providerFailureJson, { data: null, error: { code: "RUNTIME_PROVISIONING_FAILED" } });
  assert.equal(JSON.stringify(providerFailureJson).includes("provider-secret"), false);
  const [usage] = await db`select count(*)::int as n from web_lab_control.runtime_usage
    where measurement_source = 'control_plane_terminal'`;
  const [audit] = await db`select count(*)::int as n from web_lab_control.runtime_audit_events`;
  assert.ok(usage.n >= 1);
  assert.ok(audit.n >= 1);
  const [legacy] = await db`select count(*)::int as n from public.labs where completed = true`;
  assert.equal(legacy.n, 0);
  console.log("Phase 13 service + API contracts: PASS (auth, ownership, compatibility, entitlement, 5 slots, idempotency, fencing, recovery, grants, grade, safe DTOs)");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await db.end(); });
