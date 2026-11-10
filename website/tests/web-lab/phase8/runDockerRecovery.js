#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local Phase 8 Docker recovery verification. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const webLab = require("../phase5/loadWebLab");
const {
  planBeginnerEcommerceStoredXssLab, planBeginnerHelpdeskLab, compileWebLab,
} = webLab;
const { SIGNAL } = require("../phase5/trustedObserver");
const { docker, IMAGE, PHASE8_LABEL_PREFIX } = require("../phase5/runtimeManager");
const { localControlTrust } = require("../phase6/localTrust");
const { LocalWebLabGateway } = require("../phase7/localGateway");
const { DurableWebLabControlService } = require("../../../lib/web-lab/durable-control-plane.ts");
const { SqliteRuntimeStateStore } = require("./sqliteRuntimeStateStore");
const { phase8DockerBackend, managedResources } = require("./phase8DockerBackend");

const USER_A = "phase8-user-a";
const USER_B = "phase8-user-b";
const SESSION_A = "phase8-session-a";
const SESSION_B = "phase8-session-b";
const payload = `<img src=x onerror="console.info('${SIGNAL}')">`;

function sessionCookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0];
}

function persistedRecord(spec, overrides = {}) {
  const manifest = compileWebLab(spec).manifest;
  const at = overrides.createdAt ?? Date.now();
  return {
    instanceId: randomUUID(), ownerId: "phase8-crash-user", savedLabId: "saved-crash",
    canonicalLabId: spec.labId, buildFingerprint: manifest.canonicalSpecSha256,
    templateId: manifest.templateId, templateVersion: manifest.templateVersion,
    vulnerabilityId: manifest.vulnerabilityId, vulnerabilityVersion: manifest.vulnerabilityVersion,
    status: "requested", createdAt: at, updatedAt: at, expiresAt: at + 180_000,
    lastActivityAt: at, destroyedAt: null, backendReference: null,
    runtimeVersion: "phase8-local-1", generationVersion: 1,
    routeKey: randomBytes(24).toString("base64url"), lastReconciledAt: null,
    failureCode: null, version: 1, ...overrides,
  };
}

async function main() {
  const directory = fs.mkdtempSync("/private/tmp/amniora-web-phase8-recovery-");
  const database = path.join(directory, "runtime.sqlite");
  let clock = Date.now();
  const now = () => clock;
  const trust = localControlTrust(now);
  const specA = planBeginnerEcommerceStoredXssLab("phase8-restart-stored-a");
  const specB = planBeginnerHelpdeskLab("phase8-restart-reflected-b");
  const labs = new Map([
    ["saved-a", { savedLabId: "saved-a", ownerId: USER_A, spec: specA }],
    ["saved-b", { savedLabId: "saved-b", ownerId: USER_B, spec: specB }],
    ["saved-lost", { savedLabId: "saved-lost", ownerId: "phase8-user-lost", spec: specB }],
    ["saved-expired", { savedLabId: "saved-expired", ownerId: "phase8-user-expired", spec: specB }],
    ["saved-reset-crash", { savedLabId: "saved-reset-crash", ownerId: "phase8-user-reset-crash", spec: specB }],
  ]);
  const mainSessions = new Map([
    [randomBytes(24).toString("base64url"), { ownerId: USER_A, sessionId: SESSION_A }],
    [randomBytes(24).toString("base64url"), { ownerId: USER_B, sessionId: SESSION_B }],
  ]);
  const [authA, authB] = mainSessions.keys();
  let currentStore = null;
  let currentGateway = null;
  let unrelatedName = null;

  const open = (ttlMs = 180_000) => {
    const stateStore = new SqliteRuntimeStateStore(database);
    const adapter = phase8DockerBackend({ now, ttlMs });
    const control = new DurableWebLabControlService({
      verifyCommand: trust.verify, savedLabs: { async find(id) { return labs.get(id) ?? null; } },
      backend: adapter.backend, grader: adapter.grader, stateStore, now, ttlMs, grantMs: 30_000,
    });
    currentStore = stateStore;
    return { stateStore, adapter, control };
  };
  const closeStore = async () => {
    if (currentStore) await currentStore.close();
    currentStore = null;
  };
  const command = (operation, owner, session, resource, idempotencyKey) =>
    trust.sign(operation, owner, session, resource, idempotencyKey);
  const gatewayFor = async env => {
    const gateway = new LocalWebLabGateway({
      control: env.control, now, sessionMs: 60_000,
      authenticateLearner: async request => mainSessions.get(request.headers["x-amniora-test-session"]) ?? null,
      resolveBackend: env.adapter.resolveBackend,
    });
    await gateway.listen();
    currentGateway = gateway;
    return gateway;
  };
  const closeGateway = async () => {
    if (currentGateway) await currentGateway.close();
    currentGateway = null;
  };
  const launch = (gateway, grant, auth) => fetch(gateway.origin + "/__gateway/launch", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Amniora-Test-Session": auth },
    body: JSON.stringify({ grant }),
  });

  try {
    let env = open();
    await env.adapter.manager.buildImage();
    const createA = command("create", USER_A, SESSION_A, "saved-a", "create-a-once");
    const a = await env.control.create(createA);
    const b = await env.control.create(command("create", USER_B, SESSION_B, "saved-b", "create-b-once"));
    assert.equal(a.status, "ready");
    assert.equal(b.status, "ready");
    const recordA = await env.stateStore.getInstance(a.instanceId);
    const recordB = await env.stateStore.getInstance(b.instanceId);
    assert.ok(recordA?.backendReference && recordB?.backendReference);

    const resources = await managedResources();
    assert.equal(resources.length, 6);
    for (const resource of resources) {
      const labels = resource.detail.Config?.Labels || resource.detail.Labels;
      assert.equal(labels[`${PHASE8_LABEL_PREFIX}.managed`], "phase8");
      const serialized = JSON.stringify(labels);
      assert.equal(serialized.includes(USER_A), false);
      assert.equal(serialized.includes(USER_B), false);
      assert.equal(serialized.includes("PROXY_KEY"), false);
      assert.equal(serialized.includes(SIGNAL), false);
    }

    let gateway = await gatewayFor(env);
    const launchA = await launch(gateway, a.launchGrant.token, authA);
    assert.equal(launchA.status, 201);
    const cookieA = sessionCookie(launchA);
    const routeA = (await launchA.json()).route;
    const stateResponse = await fetch(gateway.origin + routeA + "__runtime/state", { headers: { Cookie: cookieA } });
    assert.equal(stateResponse.status, 200);
    const mutable = await stateResponse.json();
    const flow = specA.vulnerability.storedFlow;
    mutable.contentByObject[flow.targetObjectId].push({
      id: `learner-${mutable.nextContentNumber}`, authorId: specA.session.displayUserId,
      body: payload, submittedByLearner: true,
    });
    mutable.nextContentNumber++;
    const mutation = await fetch(gateway.origin + routeA + "__runtime/state", {
      method: "PUT",
      headers: {
        Cookie: cookieA, "Content-Type": "application/json",
        "X-Web-Lab-Field": flow.inputField, "X-Web-Lab-Route": flow.submissionRoute,
      },
      body: JSON.stringify(mutable),
    });
    assert.equal(mutation.status, 204);
    const preservedState = await env.adapter.state(recordA.backendReference);

    const oldOrigin = gateway.origin;
    await closeGateway();
    await closeStore();
    env = open();
    const recovered = await env.control.reconcile();
    assert.equal(recovered.healthy, 2);
    assert.equal((await env.control.status(command("status", USER_A, SESSION_A, a.instanceId))).status, "ready");
    const recoveredARecord = await env.stateStore.getInstance(a.instanceId);
    assert.equal(recoveredARecord.ownerId, USER_A);
    assert.equal(recoveredARecord.buildFingerprint, recordA.buildFingerprint);
    assert.equal(recoveredARecord.status, "ready");
    await assert.rejects(env.control.status(command("status", USER_B, SESSION_B, a.instanceId)), /runtime_not_found/);
    await assert.rejects(env.control.status(command("status", USER_A, SESSION_A, b.instanceId)), /runtime_not_found/);
    await assert.rejects(env.control.create(command("create", USER_A, SESSION_A, "saved-a", "second-active")), /active_instance_limit/);
    assert.deepEqual(await env.adapter.state(recordA.backendReference), preservedState);

    gateway = await gatewayFor(env);
    assert.notEqual(gateway.origin, oldOrigin);
    assert.equal((await launch(gateway, a.launchGrant.token, authA)).status, 403, "pre-restart grant is invalid");
    assert.equal((await fetch(gateway.origin + routeA, { headers: { Cookie: cookieA } })).status, 401,
      "pre-restart gateway session is invalid");
    const freshA = await env.control.status(command("status", USER_A, SESSION_A, a.instanceId));
    const freshB = await env.control.status(command("status", USER_B, SESSION_B, b.instanceId));
    assert.equal((await launch(gateway, freshA.launchGrant.token, authB)).status, 403);
    assert.equal((await launch(gateway, freshB.launchGrant.token, authA)).status, 403);
    const relaunched = await launch(gateway, freshA.launchGrant.token, authA);
    assert.equal(relaunched.status, 201);
    const recoveredCookie = sessionCookie(relaunched);
    const recoveredRoute = (await relaunched.json()).route;
    assert.equal((await fetch(gateway.origin + recoveredRoute, { headers: { Cookie: recoveredCookie } })).status, 200);
    assert.equal((await env.control.grade(command("grade", USER_A, SESSION_A, a.instanceId))).completed, true);
    assert.equal((await env.control.create(createA)).instanceId, a.instanceId);
    assert.equal((await env.adapter.backend.listManaged()).filter(item => item.instanceId === a.instanceId).length, 1);

    const resetKey = "reset-a-once";
    const resetA = await env.control.reset(command("reset", USER_A, SESSION_A, a.instanceId, resetKey));
    assert.equal(resetA.status, "ready");
    assert.equal((await env.stateStore.getInstance(a.instanceId)).generationVersion, 2);
    assert.equal((await env.control.grade(command("grade", USER_A, SESSION_A, a.instanceId))).completed, false);
    await closeGateway();
    await closeStore();
    env = open();
    await env.control.reconcile();
    assert.equal((await env.control.reset(command("reset", USER_A, SESSION_A, a.instanceId, resetKey))).status, "ready");
    assert.equal((await env.stateStore.getInstance(a.instanceId)).generationVersion, 2,
      "reset idempotency survives control restart");

    const destroyBKey = "destroy-b-once";
    assert.equal((await env.control.destroy(command("destroy", USER_B, SESSION_B, b.instanceId, destroyBKey))).status, "destroyed");
    await closeStore();
    env = open();
    await env.control.reconcile();
    assert.equal((await env.control.destroy(command("destroy", USER_B, SESSION_B, b.instanceId, destroyBKey))).status, "destroyed");
    assert.equal((await env.adapter.backend.listManaged()).some(item => item.instanceId === b.instanceId), false);

    const lost = await env.control.create(command("create", "phase8-user-lost", "phase8-session-lost", "saved-lost", "create-lost"));
    const lostRecord = await env.stateStore.getInstance(lost.instanceId);
    await docker("rm", "-f", `amniora-web-${lostRecord.backendReference}`);
    await env.control.reconcile();
    const lostAfter = await env.stateStore.getInstance(lost.instanceId);
    assert.equal(lostAfter.status, "failed");
    assert.equal(lostAfter.failureCode, "runtime_lost");
    assert.equal((await env.adapter.backend.listManaged()).some(item => item.instanceId === lost.instanceId), false);
    assert.equal(fs.existsSync(`/private/tmp/amniora-web-runtime-${lostRecord.backendReference}`), false);

    const orphanContext = {
      instanceId: randomUUID(), buildFingerprint: compileWebLab(specB).manifest.canonicalSpecSha256,
      generationVersion: 1, runtimeVersion: "phase8-local-1",
    };
    const orphan = await env.adapter.manager.create(specB, orphanContext);
    unrelatedName = `amniora-phase8-unrelated-${randomBytes(5).toString("hex")}`;
    await docker("run", "-d", "--name", unrelatedName, IMAGE, "node", "-e", "setInterval(()=>{},10000)");
    const orphanSummary = await env.control.reconcile();
    assert.equal(orphanSummary.orphansRemoved, 1);
    await assert.rejects(docker("inspect", `amniora-web-${orphan.instanceId}`));
    assert.ok(await docker("inspect", unrelatedName));

    await closeStore();
    env = open(1000);
    const expired = await env.control.create(command("create", "phase8-user-expired", "phase8-session-expired", "saved-expired", "create-expired"));
    const expiredBefore = await env.stateStore.getInstance(expired.instanceId);
    await closeStore();
    clock += 1500;
    env = open(1000);
    const expirySummary = await env.control.reconcile();
    assert.equal(expirySummary.expired, 1);
    const expiredAfter = await env.stateStore.getInstance(expired.instanceId);
    assert.equal(expiredAfter.status, "expired");
    const expiredStatus = await env.control.status(command("status", "phase8-user-expired", "phase8-session-expired", expired.instanceId));
    assert.equal(expiredStatus.launchAvailable, false);
    assert.equal(expiredStatus.launchGrant, null);
    assert.equal(await env.control.authorizeDataPlaneLaunch(expired.launchGrant.token, {
      ownerId: "phase8-user-expired", sessionId: "phase8-session-expired",
    }), null);
    assert.equal((await env.adapter.backend.listManaged()).some(item => item.instanceId === expiredBefore.instanceId), false);

    const provisioningCrash = persistedRecord(specB, {
      ownerId: "phase8-crash-provisioning", savedLabId: "saved-crash-provisioning",
      status: "provisioning",
    });
    await env.stateStore.createInstanceRecord(provisioningCrash);
    await env.control.reconcile();
    assert.equal((await env.stateStore.getInstance(provisioningCrash.instanceId)).failureCode, "provisioning_interrupted");

    const resetCrash = await env.control.create(command("create", "phase8-user-reset-crash", "phase8-session-reset-crash",
      "saved-reset-crash", "create-reset-crash"));
    const resetCrashReady = await env.stateStore.getInstance(resetCrash.instanceId);
    await env.stateStore.updateLifecycle(resetCrash.instanceId, resetCrashReady.version, {
      status: "resetting", generationVersion: 2, updatedAt: now(),
    });
    await closeStore();
    env = open();
    await env.control.reconcile();
    const resetCrashAfter = await env.stateStore.getInstance(resetCrash.instanceId);
    assert.equal(resetCrashAfter.status, "failed");
    assert.equal(resetCrashAfter.failureCode, "backend_identity_mismatch");
    assert.equal((await env.adapter.backend.listManaged()).some(item => item.instanceId === resetCrash.instanceId), false);

    const destroyedB = await env.stateStore.getInstance(b.instanceId);
    const staleContext = {
      instanceId: b.instanceId, buildFingerprint: destroyedB.buildFingerprint,
      generationVersion: destroyedB.generationVersion, runtimeVersion: destroyedB.runtimeVersion,
    };
    await env.adapter.manager.create(specB, staleContext);
    await env.control.reconcile();
    assert.equal((await env.stateStore.getInstance(b.instanceId)).status, "destroyed");
    assert.equal((await env.adapter.backend.listManaged()).some(item => item.instanceId === b.instanceId), false);

    const auditsA = await env.stateStore.listAuditEvents(a.instanceId);
    assert.deepEqual(auditsA.map(item => item.eventId), [...auditsA].map(item => item.eventId).sort((x, y) => x - y));
    assert.ok(auditsA.some(item => item.eventType === "instance_reconciled"));
    assert.ok(auditsA.some(item => item.eventType === "instance_reset_completed"));
    const orphanAudits = await env.stateStore.listAuditEvents(orphanContext.instanceId);
    assert.deepEqual(orphanAudits.map(item => item.eventType), ["orphan_detected", "orphan_removed"]);

    await env.control.destroy(command("destroy", USER_A, SESSION_A, a.instanceId, "destroy-a-final"));
    console.log("Phase 8 durable Docker restart, recovery, isolation, gateway, grading, and failure matrix: PASS");
  } finally {
    await closeGateway().catch(() => {});
    await closeStore().catch(() => {});
    try {
      const cleanup = phase8DockerBackend({ now });
      for (const observation of await cleanup.backend.listManaged()) await cleanup.backend.destroyManaged(observation);
    } catch { /* preserve primary failure */ }
    if (unrelatedName) try { await docker("rm", "-f", unrelatedName); } catch { /* absent */ }
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
