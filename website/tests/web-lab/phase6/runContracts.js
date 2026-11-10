#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS contract verification. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../phase5/loadWebLab");
const { planBeginnerHelpdeskLab, planBeginnerEcommerceReflectedXssLab } = require("../phase5/loadWebLab");
const { LocalWebLabControlService, assertRuntimeTransition } = require("../../../lib/web-lab/control-plane.ts");
const { localControlTrust } = require("./localTrust");

const USER_A = "synthetic-user-a";
const USER_B = "synthetic-user-b";
const SESSION_A = "synthetic-session-a";
const SESSION_B = "synthetic-session-b";
const forbidden = ["backendReference", "container", "endpoint", "internalSolution", "ownerId", "savedLabId", "grader", "signingKey", "host"];
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture({ createGate, resetGate, failCreate = false, failDestroy = false } = {}) {
  let current = 1_800_000_000_000;
  const now = () => current;
  const trust = localControlTrust(now);
  const stats = { creates: 0, resets: 0, destroys: 0, grades: 0 };
  const backends = new Map();
  const labs = new Map([
    ["saved-a", { savedLabId: "saved-a", ownerId: USER_A, spec: planBeginnerHelpdeskLab("phase6-a") }],
    ["saved-a-2", { savedLabId: "saved-a-2", ownerId: USER_A, spec: planBeginnerEcommerceReflectedXssLab("phase6-a2") }],
    ["saved-b", { savedLabId: "saved-b", ownerId: USER_B, spec: planBeginnerHelpdeskLab("phase6-b") }],
  ]);
  const backend = {
    async create() {
      stats.creates++;
      if (createGate) await createGate.promise;
      if (failCreate) throw new Error("synthetic_backend_failure");
      const ref = `backend-${stats.creates}`;
      backends.set(ref, "ready");
      return ref;
    },
    async status(ref) { return backends.get(ref); },
    async reset(ref) {
      stats.resets++;
      if (resetGate) await resetGate.promise;
      assert.equal(backends.get(ref), "ready");
    },
    async destroy(ref) {
      stats.destroys++;
      if (failDestroy) throw new Error("synthetic_cleanup_failure");
      backends.set(ref, "destroyed");
    },
  };
  const service = new LocalWebLabControlService({
    verifyCommand: trust.verify, savedLabs: { async find(id) { return labs.get(id) ?? null; } },
    backend, grader: { async grade(ref) {
      assert.equal(backends.get(ref), "ready");
      stats.grades++;
      return { status: "not-complete", reason: "SECRET_INTERNAL_REASON" };
    } },
    now, ttlMs: 60_000, grantMs: 10_000,
  });
  const command = (operation, ownerId, resourceId, key, sessionId = SESSION_A) =>
    trust.sign(operation, ownerId, sessionId, resourceId, key);
  return { service, command, stats, labs, advance: ms => { current += ms; }, now };
}

async function expectReject(promise, code) { await assert.rejects(promise, new RegExp(code)); }

async function lifecycleAndSecurity() {
  const challengeSource = fs.readFileSync(path.join(__dirname, "../phase5/container/server.js"), "utf8");
  for (const route of ["/destroy", "/reset-instance", "/trusted-grade"]) {
    assert.equal(challengeSource.includes(route), false);
  }
  assertRuntimeTransition("requested", "provisioning");
  assertRuntimeTransition("ready", "resetting");
  assertRuntimeTransition("resetting", "expiring");
  for (const [from, to] of [["destroyed", "ready"], ["failed", "ready"], ["expired", "resetting"], ["requested", "ready"]]) {
    assert.throws(() => assertRuntimeTransition(from, to), /invalid_transition/);
  }
  const f = fixture();
  const { service, command, stats } = f;
  await expectReject(service.create(command("create", USER_B, "saved-a")), "saved_lab_not_found");
  const forgedOwner = { ...command("create", USER_A, "saved-a"), ownerId: USER_B };
  await expectReject(service.create(forgedOwner), "unauthorized_control_request");
  const forgedTtl = { ...command("create", USER_A, "saved-a"), ttlMs: 999999999 };
  const a = await service.create(forgedTtl);
  assert.equal(a.status, "ready");
  assert.equal(a.expiresAt, f.now() + 60_000);
  assert.equal(a.launchAvailable, true);
  assert.equal(stats.creates, 1);
  for (const field of forbidden) assert.equal(JSON.stringify(a).includes(field), false, field);
  const duplicate = await service.create(command("create", USER_A, "saved-a", forgedTtl.idempotencyKey));
  assert.equal(duplicate.instanceId, a.instanceId);
  assert.equal(stats.creates, 1);
  await expectReject(service.create(command("create", USER_A, "saved-a-2", forgedTtl.idempotencyKey)), "idempotency_conflict");
  await expectReject(service.create(command("create", USER_A, "saved-a-2")), "active_instance_limit");
  const b = await service.create(command("create", USER_B, "saved-b"));
  assert.notEqual(b.instanceId, a.instanceId);
  assert.equal(stats.creates, 2);
  await expectReject(service.status(command("status", USER_B, a.instanceId)), "runtime_not_found");
  await expectReject(service.reset(command("reset", USER_B, a.instanceId)), "runtime_not_found");
  await expectReject(service.grade(command("grade", USER_B, a.instanceId)), "runtime_not_found");
  await expectReject(service.destroy(command("destroy", USER_B, a.instanceId)), "runtime_not_found");

  const context = { instanceId: a.instanceId, ownerId: USER_A, sessionId: SESSION_A };
  const grant = a.launchGrant.token;
  assert.equal(service.validateLaunchGrant(grant, context), true);
  assert.equal(service.validateLaunchGrant(grant, { ...context, instanceId: b.instanceId }), false);
  assert.equal(service.validateLaunchGrant(grant, { ...context, ownerId: USER_B }), false);
  assert.equal(service.validateLaunchGrant(grant, { ...context, sessionId: SESSION_B }), false);
  assert.equal(service.validateLaunchGrant(grant.slice(0, -2) + "xx", context), false);
  await expectReject(service.destroy(grant), "unauthorized_control_request");
  await expectReject(service.grade(grant), "unauthorized_control_request");
  const operationForgery = { ...command("status", USER_A, a.instanceId), operation: "destroy" };
  await expectReject(service.destroy(operationForgery), "unauthorized_control_request");
  const stale = command("destroy", USER_A, a.instanceId);
  f.advance(30_001);
  await expectReject(service.destroy(stale), "unauthorized_control_request");
  assert.equal(service.validateLaunchGrant(grant, context), false);
  const fresh = await service.status(command("status", USER_A, a.instanceId));
  assert.equal(service.validateLaunchGrant(fresh.launchGrant.token, context), true);
  const resetCommand = command("reset", USER_A, a.instanceId);
  const reset = await service.reset(resetCommand);
  assert.equal(reset.status, "ready");
  assert.equal(stats.resets, 1);
  assert.equal(service.validateLaunchGrant(fresh.launchGrant.token, context), false);
  await service.reset(command("reset", USER_A, a.instanceId, resetCommand.idempotencyKey));
  assert.equal(stats.resets, 1);
  const gradeCommand = command("grade", USER_A, a.instanceId);
  const grade = await service.grade(gradeCommand);
  assert.deepEqual(Object.keys(grade).sort(), ["completed", "gradedAt"]);
  assert.equal(grade.completed, false);
  await service.grade(command("grade", USER_A, a.instanceId, gradeCommand.idempotencyKey));
  assert.equal(stats.grades, 1);
  await service.reset(command("reset", USER_A, a.instanceId));
  await expectReject(service.grade(command("grade", USER_A, a.instanceId, gradeCommand.idempotencyKey)), "stale_idempotency_key");
  const destroy = command("destroy", USER_A, a.instanceId);
  assert.equal((await service.destroy(destroy)).status, "destroyed");
  assert.equal((await service.destroy(command("destroy", USER_A, a.instanceId, destroy.idempotencyKey))).status, "destroyed");
  assert.equal((await service.destroy(command("destroy", USER_A, a.instanceId))).status, "destroyed");
  assert.equal(stats.destroys, 1);
  assert.equal(service.validateLaunchGrant(reset.launchGrant.token, context), false);
  await expectReject(service.reset(command("reset", USER_A, a.instanceId)), "instance_not_resettable");
  await expectReject(service.grade(command("grade", USER_A, a.instanceId)), "instance_not_gradable");
  const replacement = await service.create(command("create", USER_A, "saved-a-2"));
  assert.equal(replacement.status, "ready");
  f.advance(60_001);
  assert.equal((await service.status(command("status", USER_A, replacement.instanceId))).status, "expired");
  await expectReject(service.reset(command("reset", USER_A, replacement.instanceId)), "instance_not_resettable");
  await expectReject(service.grade(command("grade", USER_A, replacement.instanceId)), "instance_not_gradable");
  assert.equal(service.validateLaunchGrant(replacement.launchGrant.token, { instanceId: replacement.instanceId, ownerId: USER_A, sessionId: SESSION_A }), false);
  assert.equal((await service.status(command("status", USER_B, b.instanceId))).status, "expired");
  assert.ok(service.auditEvents.every(event => Object.keys(event).sort().join() === "action,at,instanceId,ownerId,result"));
}

async function raceCases() {
  const gate = deferred();
  const f = fixture({ createGate: gate });
  const first = f.command("create", USER_A, "saved-a", "same-create");
  const pending = f.service.create(first);
  await new Promise(resolve => setImmediate(resolve));
  const id = f.service.auditEvents[0].instanceId;
  const duplicate = f.service.create(f.command("create", USER_A, "saved-a", "same-create"));
  const destroy = f.service.destroy(f.command("destroy", USER_A, id));
  gate.resolve();
  assert.equal((await pending).status, "ready");
  assert.equal((await duplicate).instanceId, id);
  assert.equal((await destroy).status, "destroyed");
  assert.equal(f.stats.creates, 1);
  await expectReject(f.service.reset(f.command("reset", USER_A, id)), "instance_not_resettable");

  const resetGate = deferred();
  const r = fixture({ resetGate });
  const created = await r.service.create(r.command("create", USER_A, "saved-a"));
  const reset = r.service.reset(r.command("reset", USER_A, created.instanceId));
  await new Promise(resolve => setImmediate(resolve));
  const destroying = r.service.destroy(r.command("destroy", USER_A, created.instanceId));
  resetGate.resolve();
  assert.equal((await reset).status, "ready");
  assert.equal((await destroying).status, "destroyed");
  await expectReject(r.service.reset(r.command("reset", USER_A, created.instanceId)), "instance_not_resettable");

  const d = fixture();
  const doomed = await d.service.create(d.command("create", USER_A, "saved-a"));
  const destroyFirst = d.service.destroy(d.command("destroy", USER_A, doomed.instanceId));
  const resetSecond = d.service.reset(d.command("reset", USER_A, doomed.instanceId));
  assert.equal((await destroyFirst).status, "destroyed");
  await expectReject(resetSecond, "instance_not_resettable");

  const expiringGate = deferred();
  const e = fixture({ resetGate: expiringGate });
  const expiring = await e.service.create(e.command("create", USER_A, "saved-a"));
  const resetAtExpiry = e.service.reset(e.command("reset", USER_A, expiring.instanceId));
  await new Promise(resolve => setImmediate(resolve));
  e.advance(60_001);
  expiringGate.resolve();
  assert.equal((await resetAtExpiry).status, "expired");
  assert.equal(e.stats.destroys, 1);
  await expectReject(e.service.grade(e.command("grade", USER_A, expiring.instanceId)), "instance_not_gradable");

  const failed = fixture({ failCreate: true });
  await expectReject(failed.service.create(failed.command("create", USER_A, "saved-a")), "synthetic_backend_failure");
  assert.equal(failed.service.auditEvents.at(-1).action, "instance_failed");
  assert.equal((await failed.service.destroy(failed.command("destroy", USER_A, failed.service.auditEvents[0].instanceId))).status, "destroyed");

  const cleanup = fixture({ failDestroy: true });
  const leaking = await cleanup.service.create(cleanup.command("create", USER_A, "saved-a"));
  await expectReject(cleanup.service.destroy(cleanup.command("destroy", USER_A, leaking.instanceId)), "synthetic_cleanup_failure");
  assert.equal((await cleanup.service.status(cleanup.command("status", USER_A, leaking.instanceId))).status, "failed");
  assert.equal(cleanup.service.validateLaunchGrant(leaking.launchGrant.token, {
    instanceId: leaking.instanceId, ownerId: USER_A, sessionId: SESSION_A,
  }), false);
}

async function main() {
  await lifecycleAndSecurity();
  await raceCases();
  console.log("Phase 6 local control contracts: PASS");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
