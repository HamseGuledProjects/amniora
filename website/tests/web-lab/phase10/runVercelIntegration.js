#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Real Phase 10 provider integration. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");
const webLab = require("../phase5/loadWebLab");
const { gradeInstance, SIGNAL } = require("../phase5/trustedObserver");
const { localControlTrust } = require("../phase6/localTrust");
const { LocalWebLabGateway } = require("../phase7/localGateway");
const { SqliteRuntimeStateStore } = require("../phase8/sqliteRuntimeStateStore");
const { DurableWebLabControlService } = require("../../../lib/web-lab/durable-control-plane.ts");
const {
  VercelSandboxRuntimeBackend, VERCEL_SANDBOX_RUNTIME_VERSION,
} = require("../../../lib/web-lab/vercel-sandbox-runtime-backend.ts");

const USER_A = "phase10-user-a";
const USER_B = "phase10-user-b";
const SESSION_A = "phase10-session-a";
const SESSION_B = "phase10-session-b";
const storedPayload = `<img src=x onerror="console.info('${SIGNAL}')">`;

function cookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0];
}

function runtimeContext(record) {
  return {
    instanceId: record.instanceId, buildFingerprint: record.buildFingerprint,
    generationVersion: record.generationVersion, runtimeVersion: record.runtimeVersion,
  };
}

async function main() {
  const startedAt = Date.now();
  let clock = startedAt;
  const now = () => clock;
  const directory = fs.mkdtempSync("/private/tmp/amniora-web-phase10-");
  const database = path.join(directory, "runtime.sqlite");
  const stateStore = new SqliteRuntimeStateStore(database);
  const trust = localControlTrust(now);
  const specA = webLab.planBeginnerEcommerceStoredXssLab("phase10-vercel-ecommerce-a");
  const specB = webLab.planBeginnerEcommerceStoredXssLab("phase10-vercel-ecommerce-b");
  const helpdeskSpec = webLab.planBeginnerHelpdeskLab("phase10-vercel-helpdesk");
  const labs = new Map([
    ["saved-a", { savedLabId: "saved-a", ownerId: USER_A, spec: specA }],
    ["saved-b", { savedLabId: "saved-b", ownerId: USER_B, spec: specB }],
    ["saved-helpdesk", { savedLabId: "saved-helpdesk", ownerId: USER_A, spec: helpdeskSpec }],
  ]);
  const hopSigningKey = randomBytes(32);
  const backend = new VercelSandboxRuntimeBackend({ hopSigningKey, timeoutMs: 10 * 60_000, maximumManaged: 5 });
  let creationCount = 0;
  const providerBackend = {
    async create(...args) { creationCount++; return backend.create(...args); },
    status: backend.status.bind(backend), reset: async (...args) => { creationCount++; return backend.reset(...args); },
    destroy: backend.destroy.bind(backend), inspect: backend.inspect.bind(backend),
    listManaged: backend.listManaged.bind(backend), destroyManaged: backend.destroyManaged.bind(backend),
  };
  let graderDurationMs = 0;
  const grader = {
    async grade(reference, spec) {
      const target = await backend.resolveBackend(reference);
      if (!target || !spec) throw new Error("managed_runtime_unavailable");
      const gradeStarted = Date.now();
      const result = await gradeInstance({
        instanceId: reference, spec, endpoint: target.origin, proxyAccessKey: target.proxyKey,
      });
      graderDurationMs += Date.now() - gradeStarted;
      return result;
    },
  };
  const control = new DurableWebLabControlService({
    verifyCommand: trust.verify, savedLabs: { async find(id) { return labs.get(id) ?? null; } },
    backend: providerBackend, grader, stateStore, now, ttlMs: 10 * 60_000, grantMs: 30_000,
    runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION,
  });
  const mainSessions = new Map([
    [randomBytes(24).toString("base64url"), { ownerId: USER_A, sessionId: SESSION_A }],
    [randomBytes(24).toString("base64url"), { ownerId: USER_B, sessionId: SESSION_B }],
  ]);
  const [authA, authB] = mainSessions.keys();
  const gateway = new LocalWebLabGateway({
    control, now, sessionMs: 5 * 60_000,
    authenticateLearner: async request => mainSessions.get(request.headers["x-amniora-test-session"]) ?? null,
    resolveBackend: backend.resolveBackend.bind(backend),
  });
  const command = (operation, owner, session, resource, key = randomUUID()) =>
    trust.sign(operation, owner, session, resource, key);
  const launch = (grant, auth) => fetch(gateway.origin + "/__gateway/launch", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Amniora-Test-Session": auth },
    body: JSON.stringify({ grant }), signal: AbortSignal.timeout(10_000),
  });
  const report = {
    sdk: require("@vercel/sandbox/package.json").version,
    project: "vercel-sandbox-default-project", region: "lhr1", networkPolicy: "deny-all",
    compiledFingerprintStable: false, rawUnauthorizedStatus: null, gatewayAuthorizedStatus: null,
    storedStatePersisted: false, storedXssGrade: false, forgedGradeRejected: false,
    resetCanonical: false, staleRouteInvalidated: false, replacementRouteChanged: false,
    twoInstanceIsolation: false, crossUserDenied: false, destroyIsolation: false,
    helpdeskReflectedSmoke: false, outboundTcp443Blocked: false,
    healthyReconciliation: false, destroyedRuntimeCleanup: false, orphanCleanup: false,
    runtimeLostDetected: false, expiryReconciled: false, cleanupCount: null,
    sandboxCreationCount: 0, graderDurationMs: 0, wallClockMs: 0, providerMetrics: [],
  };

  async function gatewayState(route, labCookie) {
    const response = await fetch(gateway.origin + route + "__runtime/state", {
      headers: { Cookie: labCookie }, signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    return response.json();
  }

  async function putState(route, labCookie, spec, state, body) {
    const flow = spec.vulnerability.storedFlow;
    state.contentByObject[flow.targetObjectId].push({
      id: `learner-${state.nextContentNumber}`, authorId: spec.session.displayUserId,
      body, submittedByLearner: true,
    });
    state.nextContentNumber++;
    const response = await fetch(gateway.origin + route + "__runtime/state", {
      method: "PUT", headers: {
        Cookie: labCookie, "Content-Type": "application/json",
        "X-Web-Lab-Field": flow.inputField, "X-Web-Lab-Route": flow.submissionRoute,
      }, body: JSON.stringify(state), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 204);
  }

  await gateway.listen();
  try {
    const offlineA = webLab.compileWebLab(specA).manifest.canonicalSpecSha256;
    const a = await control.create(command("create", USER_A, SESSION_A, "saved-a", "create-a"));
    assert.equal(a.status, "ready");
    let recordA = await stateStore.getInstance(a.instanceId);
    assert.equal(recordA.buildFingerprint, offlineA);
    report.compiledFingerprintStable = true;
    let targetA = await backend.resolveBackend(recordA.backendReference, runtimeContext(recordA));
    assert.ok(targetA);
    report.providerMetrics.push({ stage: "a-created", ...targetA.metadata, rawOrigin: "<redacted-vercel-run-route>" });

    const rawDenied = await fetch(targetA.origin, { signal: AbortSignal.timeout(10_000) });
    assert.equal(rawDenied.status, 403);
    report.rawUnauthorizedStatus = rawDenied.status;
    const rawAuthorized = await fetch(targetA.origin, {
      headers: { "X-Web-Lab-Proxy-Key": targetA.proxyKey }, signal: AbortSignal.timeout(10_000),
    });
    assert.equal(rawAuthorized.status, 200);
    assert.equal(rawAuthorized.headers.get("x-amniora-hop-forwarded"), "no");

    const launchA = await launch(a.launchGrant.token, authA);
    assert.equal(launchA.status, 201);
    const cookieA = cookie(launchA);
    const routeA = (await launchA.json()).route;
    const gatewayPage = await fetch(gateway.origin + routeA, { headers: { Cookie: cookieA } });
    assert.equal(gatewayPage.status, 200);
    report.gatewayAuthorizedStatus = gatewayPage.status;

    let stateA = await gatewayState(routeA, cookieA);
    await putState(routeA, cookieA, specA, stateA, "A normal persisted review");
    stateA = await gatewayState(routeA, cookieA);
    assert.ok(stateA.contentByObject[specA.vulnerability.storedFlow.targetObjectId]
      .some(entry => entry.body === "A normal persisted review"));
    await putState(routeA, cookieA, specA, stateA, storedPayload);
    const persistedA = await gatewayState(routeA, cookieA);
    assert.ok(persistedA.contentByObject[specA.vulnerability.storedFlow.targetObjectId]
      .some(entry => entry.body === storedPayload));
    report.storedStatePersisted = true;

    const forged = await fetch(gateway.origin + routeA + "__runtime/grade", {
      method: "PUT", headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }), signal: AbortSignal.timeout(10_000),
    });
    assert.equal(forged.status, 404);
    report.forgedGradeRejected = true;
    const gradeA = await control.grade(command("grade", USER_A, SESSION_A, a.instanceId, "grade-a"));
    assert.equal(gradeA.completed, true);
    report.storedXssGrade = true;
    report.outboundTcp443Blocked = await backend.outboundTcp443Blocked(recordA.backendReference, runtimeContext(recordA));
    assert.equal(report.outboundTcp443Blocked, true);

    const oldOrigin = targetA.origin;
    const oldKey = targetA.proxyKey;
    const resetA = await control.reset(command("reset", USER_A, SESSION_A, a.instanceId, "reset-a"));
    assert.equal(resetA.status, "ready");
    recordA = await stateStore.getInstance(a.instanceId);
    assert.equal(recordA.generationVersion, 2);
    targetA = await backend.resolveBackend(recordA.backendReference, runtimeContext(recordA));
    assert.ok(targetA);
    assert.notEqual(targetA.origin, oldOrigin);
    assert.notEqual(targetA.proxyKey, oldKey);
    report.replacementRouteChanged = true;
    const resetState = await gatewayState(routeA, cookieA);
    assert.equal(resetState.nextContentNumber, 1);
    assert.equal(JSON.stringify(resetState).includes("A normal persisted review"), false);
    assert.equal(JSON.stringify(resetState).includes(SIGNAL), false);
    report.resetCanonical = true;
    try {
      const stale = await fetch(oldOrigin, {
        headers: { "X-Web-Lab-Proxy-Key": oldKey }, signal: AbortSignal.timeout(10_000),
      });
      report.staleRouteInvalidated = stale.status !== 200;
    } catch { report.staleRouteInvalidated = true; }
    assert.equal(report.staleRouteInvalidated, true);

    const b = await control.create(command("create", USER_B, SESSION_B, "saved-b", "create-b"));
    let recordB = await stateStore.getInstance(b.instanceId);
    let targetB = await backend.resolveBackend(recordB.backendReference, runtimeContext(recordB));
    assert.ok(targetB);
    assert.notEqual(targetA.metadata.sandboxName, targetB.metadata.sandboxName);
    const launchB = await launch(b.launchGrant.token, authB);
    assert.equal(launchB.status, 201);
    const cookieB = cookie(launchB);
    const routeB = (await launchB.json()).route;
    assert.equal((await fetch(gateway.origin + routeB, { headers: { Cookie: cookieA } })).status, 403);
    assert.equal((await fetch(gateway.origin + routeA, { headers: { Cookie: cookieB } })).status, 403);
    report.crossUserDenied = true;
    let freshA = await gatewayState(routeA, cookieA);
    await putState(routeA, cookieA, specA, freshA, "A-only review");
    const stateB = await gatewayState(routeB, cookieB);
    assert.equal(JSON.stringify(stateB).includes("A-only review"), false);
    report.twoInstanceIsolation = true;
    const healthy = await control.reconcile();
    assert.ok(healthy.healthy >= 2);
    report.healthyReconciliation = true;

    await control.destroy(command("destroy", USER_A, SESSION_A, a.instanceId, "destroy-a"));
    assert.equal((await fetch(gateway.origin + routeA, { headers: { Cookie: cookieA } })).status, 410);
    assert.equal((await fetch(gateway.origin + routeB, { headers: { Cookie: cookieB } })).status, 200);
    report.destroyIsolation = true;

    creationCount++;
    await backend.create(specA, runtimeContext(recordA));
    assert.ok((await backend.listManaged()).some(item => item.instanceId === a.instanceId));
    await control.reconcile();
    assert.equal((await backend.listManaged()).some(item => item.instanceId === a.instanceId), false);
    report.destroyedRuntimeCleanup = true;

    const orphanContext = {
      instanceId: randomUUID(), buildFingerprint: webLab.compileWebLab(specA).manifest.canonicalSpecSha256,
      generationVersion: 1, runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION,
    };
    creationCount++;
    await backend.create(specA, orphanContext);
    const orphanResult = await control.reconcile();
    assert.ok(orphanResult.orphansRemoved >= 1);
    assert.equal((await backend.listManaged()).some(item => item.instanceId === orphanContext.instanceId), false);
    report.orphanCleanup = true;

    await control.destroy(command("destroy", USER_B, SESSION_B, b.instanceId, "destroy-b"));
    const helpdesk = await control.create(command("create", USER_A, SESSION_A, "saved-helpdesk", "create-helpdesk"));
    const helpdeskRecord = await stateStore.getInstance(helpdesk.instanceId);
    const helpdeskTarget = await backend.resolveBackend(helpdeskRecord.backendReference, runtimeContext(helpdeskRecord));
    assert.ok(helpdeskTarget);
    const launchHelpdesk = await launch(helpdesk.launchGrant.token, authA);
    assert.equal(launchHelpdesk.status, 201);
    const helpdeskCookie = cookie(launchHelpdesk);
    const helpdeskRoute = (await launchHelpdesk.json()).route;
    assert.equal((await fetch(gateway.origin + helpdeskRoute, { headers: { Cookie: helpdeskCookie } })).status, 200);
    const reflected = await gradeInstance({
      instanceId: helpdeskRecord.backendReference, spec: helpdeskSpec,
      endpoint: helpdeskTarget.origin, proxyAccessKey: helpdeskTarget.proxyKey,
    }, { input: storedPayload });
    assert.equal(reflected.status, "pass");
    report.helpdeskReflectedSmoke = true;

    const helpdeskObservation = (await backend.listManaged()).find(item => item.instanceId === helpdesk.instanceId);
    assert.ok(helpdeskObservation);
    await backend.destroyManaged(helpdeskObservation);
    const lostResult = await control.reconcile();
    assert.ok(lostResult.failed >= 1);
    assert.equal((await stateStore.getInstance(helpdesk.instanceId)).failureCode, "runtime_lost");
    report.runtimeLostDetected = true;

    const expiring = await control.create(command("create", USER_B, SESSION_B, "saved-b", "create-expiring"));
    const expiringLaunch = await launch(expiring.launchGrant.token, authB);
    const expiringCookie = cookie(expiringLaunch);
    const expiringRoute = (await expiringLaunch.json()).route;
    assert.equal((await fetch(gateway.origin + expiringRoute, { headers: { Cookie: expiringCookie } })).status, 200);
    clock += 10 * 60_000 + 1;
    const expiryResult = await control.reconcile();
    assert.ok(expiryResult.expired >= 1);
    assert.equal((await stateStore.getInstance(expiring.instanceId)).status, "expired");
    assert.equal((await fetch(gateway.origin + expiringRoute, { headers: { Cookie: expiringCookie } })).status, 401);
    report.expiryReconciled = true;

    report.providerMetrics.push({
      stage: "a-destroyed", ...(await backend.providerMetadata(a.instanceId)), rawOrigin: "<redacted-vercel-run-route>",
    });
  } finally {
    for (const observation of await backend.listManaged()) {
      try { await backend.destroyManaged(observation); } catch { /* continue bounded cleanup */ }
    }
    const remaining = await backend.listManaged();
    report.cleanupCount = remaining.length;
    report.sandboxCreationCount = creationCount;
    report.graderDurationMs = graderDurationMs;
    report.wallClockMs = Date.now() - startedAt;
    await gateway.close();
    await stateStore.close();
    fs.rmSync(directory, { recursive: true, force: true });
    console.log(JSON.stringify(report, null, 2));
    if (remaining.length) throw new Error(`phase10_cleanup_incomplete:${remaining.length}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
