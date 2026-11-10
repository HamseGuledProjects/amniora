#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped CommonJS route/Docker integration harness. */
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const ts = require("typescript");
const Module = require("node:module");
const { createHmac, randomBytes, randomUUID } = require("node:crypto");
const postgres = require("postgres");
const webLab = require("../phase5/loadWebLab");
const { browserSession, SIGNAL } = require("../phase5/trustedObserver");
const { LocalWebLabGateway } = require("../phase7/localGateway");
const { createPhase14LocalDockerAdapter } = require("./localDockerAdapter");
const { PostgresWebLabControlRepository } = require("../../../lib/web-lab/postgres-control-repository.ts");

const connection = process.env.PHASE14_TEST_DATABASE_URL;
if (!connection) throw new Error("PHASE14_TEST_DATABASE_URL is required");
const parsed = new URL(connection);
if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/amniora_phase14_test") {
  throw new Error("Refusing non-loopback/non-disposable Phase 14 database");
}
const db = postgres(connection, { max: 24 });
const repo = new PostgresWebLabControlRepository(db);
const signingKey = randomBytes(32);
const gatewayKey = randomBytes(32);
const actors = new Map();
const routeRoot = path.resolve(__dirname, "../../../app/api/web-labs/runtime");
const sourceRoot = path.resolve(__dirname, "../../../lib/web-lab");
let activeService;
let actorResolutionCount = 0;
const originalLoad = Module._load;
const originalTsLoader = require.extensions[".ts"];
require.extensions[".ts"] = (module, filename) => {
  if (filename.startsWith(routeRoot + path.sep)) {
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    module._compile(output.outputText, filename);
    return;
  }
  return originalTsLoader(module, filename);
};
Module._load = function scopedRouteTestDependencies(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  if (specifier === "@/lib/web-lab/runtime-route-handler") {
    return originalLoad.call(this, path.join(sourceRoot, "runtime-route-handler.ts"), parent, isMain);
  }
  if (parent?.filename === path.join(sourceRoot, "runtime-route-handler.ts") &&
      specifier === "./runtime-route-composition") {
    return { createWebLabControlPlane: () => activeService };
  }
  if (parent?.filename === path.join(sourceRoot, "runtime-route-handler.ts") &&
      specifier === "./supabase-runtime-actor") {
    return { resolveSupabaseWebLabActor: async request => {
      actorResolutionCount++;
      return actors.get(request.headers.get("x-amniora-test-session")) ?? null;
    } };
  }
  return originalLoad.call(this, specifier, parent, isMain);
};
const { WebLabControlPlaneService, ExactWebLabCompatibilityPolicy } =
  require("../../../lib/web-lab/production-control-service.ts");

const launchRoute = require(path.join(routeRoot, "launch/route.ts"));
const exchangeRoute = require(path.join(routeRoot, "launch/exchange/route.ts"));
const runtimeRoute = require(path.join(routeRoot, "[id]/route.ts"));
const resetRoute = require(path.join(routeRoot, "[id]/reset/route.ts"));
const gradeRoute = require(path.join(routeRoot, "[id]/grade/route.ts"));
const routeContext = id => ({ params: Promise.resolve({ id }) });
const payload = `<img src=x onerror="console.info('${SIGNAL}')">`;
let now = Date.now();

function makeService(backend, grader, overrides = {}) {
  return new WebLabControlPlaneService({
    repository: repo,
    entitlement: { async planFor(actor) { return overrides.planFor?.(actor) ?? "pro"; } },
    ratePolicy: { async assertAllowed(actor, operation) {
      if (overrides.denyOperation === operation) {
        const { WebLabControlError } = require("../../../lib/web-lab/production-control-service.ts");
        throw new WebLabControlError("RATE_LIMITED");
      }
    } },
    compatibility: new ExactWebLabCompatibilityPolicy(), grader,
    backends: [{ mode: "amniora_hosted", providerKind: overrides.providerKind ?? "phase14_local_docker",
      runtimeVersion: overrides.runtimeVersion ?? "phase8-local-1", backend }],
    signingKey, now: () => now, ttlMinutes: 1,
  });
}

function makeRequest(method, pathName, body, token, headers = {}) {
  return new Request(`https://local.example${pathName}`, { method,
    headers: { Origin: "https://local.example", ...(token ? { "X-Amniora-Test-Session": token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function call(operation, id, body, token, key, headers = {}) {
  const routePath = id ? `/api/web-labs/runtime/${id}` : "/api/web-labs/runtime/launch";
  const suffix = operation === "reset" || operation === "grade" ? `/${operation}` :
    operation === "exchange" ? "/exchange" : "";
  const method = operation === "status" ? "GET" : operation === "destroy" ? "DELETE" : "POST";
  const request = makeRequest(method, routePath + suffix, body, token,
    { ...(key ? { "Idempotency-Key": key } : {}), ...headers });
  const response = operation === "launch" ? await launchRoute.POST(request) :
    operation === "exchange" ? await exchangeRoute.POST(request) :
    operation === "status" ? await runtimeRoute.GET(request, routeContext(id)) :
    operation === "destroy" ? await runtimeRoute.DELETE(request, routeContext(id)) :
    operation === "reset" ? await resetRoute.POST(request, routeContext(id)) :
    await gradeRoute.POST(request, routeContext(id));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
  assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
  const json = await response.json();
  const serialized = JSON.stringify(json);
  for (const forbidden of ["backend_reference", "backendReference", "vercel.run", "sandboxName",
    "internalSolution", "solution", "hopSecret", "proxyKey", "signingKey",
    "service_role", "local-private-"]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
  return { status: response.status, ...json };
}

async function createOwner(spec, runtimeVersion = "phase8-local-1") {
  const actor = { userId: randomUUID(), sessionId: randomUUID() };
  const token = randomBytes(20).toString("base64url");
  const savedLabId = randomUUID();
  actors.set(token, actor);
  await db`insert into auth.users (id) values (${actor.userId})`;
  await db`insert into public.labs (id, user_id, topic) values (${savedLabId}, ${actor.userId}, 'Web Security')`;
  const build = await repo.createBuild({ savedLabId, ownerId: actor.userId, spec, runtimeVersion });
  return { actor, token, savedLabId, build };
}

function routeKey(instanceId, generationVersion) {
  return createHmac("sha256", gatewayKey).update(`${instanceId}:${generationVersion}`).digest("base64url").slice(0, 32);
}

function createFakeBackend() {
  const resources = new Map();
  const calls = { create: 0, reset: 0, destroy: 0 };
  const failures = { create: false, reset: false };
  const observation = item => ({ reference: item.reference, ...item.context, state: "ready" });
  const backend = {
    async create(_spec, context) {
      calls.create++;
      if (failures.create) { failures.create = false; throw new Error("fake-private-create-failure"); }
      const reference = `phase14-fake-${context.instanceId}`;
      resources.set(context.instanceId, { reference, context: { ...context } });
      return reference;
    },
    async status(_reference, context) { return resources.has(context.instanceId) ? "ready" : "destroyed"; },
    async reset(_reference, context) {
      calls.reset++;
      if (failures.reset) { failures.reset = false; throw new Error("fake-private-reset-failure"); }
      const item = resources.get(context.instanceId);
      if (!item) throw new Error("fake-private-missing");
      item.context = { ...context };
    },
    async destroy(_reference, context) { calls.destroy++; resources.delete(context.instanceId); },
    async inspect(reference, expected) {
      const item = resources.get(expected.instanceId);
      if (!item || (reference !== expected.instanceId && reference !== item.reference)) {
        return { state: "missing", observation: null };
      }
      const observed = observation(item);
      return { state: item.context.generationVersion === expected.generationVersion ? "ready" : "mismatch",
        observation: observed };
    },
    async listManaged() { return [...resources.values()].map(observation); },
    async destroyManaged(item) { resources.delete(item.instanceId); },
  };
  return { backend, calls, failures, resources };
}

function cookiePair(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(cookie, /; Secure(?:;|$)/); // Loopback HTTP only; production HTTPS must set Secure.
  return cookie.split(";", 1)[0];
}

async function gatewayFor(local) {
  const gateway = new LocalWebLabGateway({
    authenticateLearner: async request => {
      const actor = actors.get(request.headers["x-amniora-test-session"]);
      return actor ? { ownerId: actor.userId, sessionId: actor.sessionId } : null;
    },
    control: {
      async authorizeDataPlaneLaunch(token, identity) {
        try {
          const target = await activeService.authorizeGatewaySession(token,
            { userId: identity.ownerId, sessionId: identity.sessionId });
          return { instanceId: target.instanceId, routeKey: routeKey(target.instanceId,
            target.context.generationVersion), expiresAt: Date.parse(target.expiresAt) };
        } catch { return null; }
      },
      async resolveDataPlaneTarget({ instanceId, ownerId, routeKey: requested }) {
        const runtime = await repo.getRuntimeControl(instanceId, ownerId);
        if (!runtime || runtime.status !== "ready" || !runtime.backendReference ||
            Date.now() >= Date.parse(runtime.expiresAt) ||
            routeKey(instanceId, runtime.generationVersion) !== requested) return null;
        return { instanceId, backendReference: runtime.backendReference,
          generationVersion: runtime.generationVersion, expiresAt: Date.parse(runtime.expiresAt) };
      },
    },
    resolveBackend: (reference, target) => local.resolveBackend(reference, target),
  });
  await gateway.listen();
  return gateway;
}

async function withGatewayBrowser(gateway, route, cookie, work) {
  return browserSession(async browser => {
    await browser.send("Network.enable");
    const [name, value] = cookie.split("=", 2);
    const set = await browser.send("Network.setCookie", { name, value,
      url: gateway.origin + route, httpOnly: true, sameSite: "Strict" });
    assert.equal(set.result?.success, true);
    return work(browser);
  });
}

async function main() {
  const local = createPhase14LocalDockerAdapter();
  let gateway;
  const spec = webLab.planBeginnerEcommerceStoredXssLab(`phase14-ecommerce-${randomUUID()}`);
  const owner = await createOwner(spec);
  const other = await createOwner(spec);
  activeService = makeService(local.backend, local.grader);
  const anyId = randomUUID();
  const allOperations = [
    () => call("launch", null, { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, owner.token, "disabled"),
    () => call("status", anyId, undefined, owner.token),
    () => call("reset", anyId, {}, owner.token, "disabled"),
    () => call("destroy", anyId, {}, owner.token, "disabled"),
    () => call("grade", anyId, {}, owner.token),
    () => call("exchange", null, { grant: "invalid" }, owner.token),
  ];
  try {
    for (const value of [undefined, "false"]) {
      if (value === undefined) delete process.env.WEB_LAB_RUNTIME_API_ENABLED;
      else process.env.WEB_LAB_RUNTIME_API_ENABLED = value;
      const before = actorResolutionCount;
      for (const run of allOperations) assert.equal((await run()).status, 404);
      assert.equal(actorResolutionCount, before, "disabled routes must not resolve auth");
    }
    process.env.WEB_LAB_RUNTIME_API_ENABLED = "true";
    process.env.WEB_LAB_TRUSTED_GRADING_ENABLED = "true";
    process.env.WEB_LAB_APP_ORIGIN = "https://local.example";
    assert.equal((await call("launch", null,
      { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, null, "unauth" )).status, 401);
    for (const origin of ["https://evil.example", "%%%", "null", ""]) {
      const response = await call("launch", null,
        { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, owner.token,
        `csrf-${origin.length}`, { Origin: origin });
      assert.equal(response.error.code, "CSRF_REJECTED");
    }
    const form = makeRequest("POST", "/api/web-labs/runtime/launch", undefined, owner.token,
      { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal((await launchRoute.POST(form)).status, 400);
    for (const forged of [{ ownerId: owner.actor.userId }, { plan: "pro" },
      { provider: "vercel" }, { completed: true, trustLevel: "hosted_verified" }]) {
      assert.equal((await call("launch", null,
        { savedLabId: owner.savedLabId, mode: "amniora_hosted", ...forged },
        owner.token, `forged-${Object.keys(forged)[0]}`)).error.code, "INVALID_REQUEST");
    }
    const staticId = randomUUID();
    await db`insert into public.labs (id, user_id, topic) values (${staticId}, ${owner.actor.userId}, 'Web Security')`;
    assert.equal((await call("launch", null,
      { savedLabId: staticId, mode: "amniora_hosted" }, owner.token, "static-lab")).error.code,
    "LAB_NOT_FOUND");
    for (const mode of ["local_runner", "byo_runtime"]) {
      assert.equal((await call("launch", null,
        { savedLabId: owner.savedLabId, mode }, owner.token, `mode-${mode}`)).error.code,
      "RUNNER_UNAVAILABLE");
    }
    activeService = makeService(local.backend, local.grader, { planFor: () => "free" });
    assert.equal((await call("launch", null,
      { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, owner.token, "free-plan")).error.code,
    "HOSTED_PLAN_REQUIRED");
    activeService = makeService(local.backend, local.grader);
    assert.equal(local.counts.create, 0);
    await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
      budget_state = 'NORMAL', metrics_observed_at = now() where singleton_id = 1`;
    await local.manager.buildImage();
    const [first, duplicate] = await Promise.all([
      call("launch", null, { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, owner.token, "deep-launch"),
      call("launch", null, { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, owner.token, "deep-launch"),
    ]);
    assert.equal(first.data.instanceId, duplicate.data.instanceId);
    assert.equal(local.counts.create, 1);
    const runtimeId = first.data.instanceId;
    const ready = first.data.status === "ready" ? first : duplicate;
    assert.equal(ready.data.status, "ready");
    assert.ok(ready.data.launchGrant?.token);
    const [runtimeCount] = await db`select count(*)::int as n from web_lab_control.runtime_instances
      where owner_id = ${owner.actor.userId}`;
    assert.equal(runtimeCount.n, 1);
    const internal = await repo.getRuntimeControl(runtimeId, owner.actor.userId);
    assert.equal((await local.backend.listManaged()).filter(item => item.instanceId === runtimeId).length, 1);
    assert.equal((await call("status", runtimeId, undefined, owner.token)).data.status, "ready");
    for (const operation of ["status", "reset", "destroy", "grade"]) {
      const denied = await call(operation, runtimeId, operation === "status" ? undefined : {},
        other.token, `other-${operation}`, operation === "grade"
          ? { "X-Web-Lab-Runtime-Session": "wrong-owner-session" } : {});
      assert.equal(denied.error.code, "RUNTIME_NOT_FOUND");
    }
    assert.equal((await call("exchange", null,
      { grant: ready.data.launchGrant.token }, other.token)).error.code, "INVALID_LAUNCH_GRANT");
    const alternateSession = randomBytes(20).toString("base64url");
    actors.set(alternateSession, { userId: owner.actor.userId, sessionId: randomUUID() });
    assert.equal((await call("exchange", null,
      { grant: ready.data.launchGrant.token }, alternateSession)).error.code, "INVALID_LAUNCH_GRANT");
    const expiringGrant = (await call("launch", null,
      { savedLabId: owner.savedLabId, mode: "amniora_hosted" }, owner.token,
      "deep-launch")).data.launchGrant.token;
    now += 31_000;
    assert.equal((await call("exchange", null,
      { grant: expiringGrant }, owner.token)).error.code, "LAUNCH_GRANT_EXPIRED");
    now -= 31_000;
    const exchanged = await call("exchange", null, { grant: ready.data.launchGrant.token }, owner.token);
    assert.equal(exchanged.status, 200);
    assert.equal((await call("exchange", null,
      { grant: exchanged.data.token }, owner.token)).error.code, "INVALID_LAUNCH_GRANT");
    assert.equal((await call("exchange", null,
      { grant: ready.data.launchGrant.token }, owner.token)).error.code, "LAUNCH_GRANT_REPLAYED");
    gateway = await gatewayFor(local);
    const open = await fetch(gateway.origin + "/__gateway/launch", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Amniora-Test-Session": owner.token },
      body: JSON.stringify({ grant: exchanged.data.token }) });
    assert.equal(open.status, 201);
    const cookie = cookiePair(open);
    const route = (await open.json()).route;
    const raw = await local.resolveBackend(internal.backendReference,
      { instanceId: runtimeId, generationVersion: 1 });
    assert.equal((await fetch(raw.origin)).status, 403);
    assert.equal((await fetch(gateway.origin + route, { headers: { Cookie: cookie } })).status, 200);
    const target = spec.vulnerability.storedFlow.targetObjectId;
    await withGatewayBrowser(gateway, route, cookie, async browser => {
      const detail = gateway.origin + route + "#/products/detail?id=" + encodeURIComponent(target);
      await browser.navigate(detail);
      const submit = async value => browser.evaluate("(() => { const field=document.getElementById('product-review'); field.value=" +
        JSON.stringify(value) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return document.querySelector('.saved-note')?.textContent; })()");
      assert.match(await submit("Ordinary review"), /Review saved/);
      await browser.navigate(gateway.origin + route + "#/catalog");
      await browser.send("Page.reload", { ignoreCache: true });
      await browser.navigate(detail);
      assert.equal(await browser.evaluate("document.body.textContent.includes('Ordinary review')"), true);
      assert.match(await submit(payload), /Review saved/);
      await browser.navigate(gateway.origin + route + "#/catalog");
      await browser.send("Page.reload", { ignoreCache: true });
      await browser.navigate(detail);
      for (let attempt = 0; attempt < 30 && !browser.consoleEvents.some(event =>
        event.args?.some(arg => arg.value === SIGNAL)); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), true);
    });
    const forgedGrade = await call("grade", runtimeId,
      { completed: true, gradePassed: true, trustLevel: "hosted_verified" }, owner.token);
    assert.equal(forgedGrade.error.code, "INVALID_REQUEST");
    const graded = await call("grade", runtimeId, {}, owner.token, "deep-grade",
      { "X-Web-Lab-Runtime-Session": exchanged.data.token });
    assert.ok(graded.data, JSON.stringify(graded));
    assert.equal(graded.data.completed, true);
    assert.ok(graded.data.completionId);
    const originalBuild = await repo.getBuildMetadata(owner.savedLabId, owner.actor.userId);
    activeService = makeService(local.backend, local.grader); // Same DB, fresh route composition/service.
    assert.equal((await call("status", runtimeId, undefined, owner.token)).data.status, "ready");
    assert.equal((await call("exchange", null,
      { grant: ready.data.launchGrant.token }, owner.token)).error.code, "LAUNCH_GRANT_REPLAYED");
    const reset = await call("reset", runtimeId, {}, owner.token, "reset-1");
    assert.equal(reset.data.generationVersion, 2);
    assert.equal((await call("reset", runtimeId, {}, owner.token, "reset-1")).data.generationVersion, 2);
    assert.equal(local.counts.reset, 1);
    assert.equal((await fetch(gateway.origin + route, { headers: { Cookie: cookie } })).status, 410);
    const state = await local.state(internal.backendReference);
    assert.equal(JSON.stringify(state).includes(SIGNAL), false);
    assert.equal((await repo.getBuildMetadata(owner.savedLabId, owner.actor.userId)).buildFingerprint,
      originalBuild.buildFingerprint);
    for (let index = 2; index <= 3; index++) {
      assert.equal((await call("reset", runtimeId, {}, owner.token, `reset-${index}`)).data.generationVersion,
        index + 1);
    }
    assert.equal((await call("reset", runtimeId, {}, owner.token, "reset-4")).error.code,
      "RESET_LIMIT_EXCEEDED");
    assert.equal(local.counts.reset, 3);
    const destroyed = await call("destroy", runtimeId, {}, owner.token, "destroy-1");
    assert.equal(destroyed.data.status, "destroyed");
    assert.equal((await call("destroy", runtimeId, {}, owner.token, "destroy-1")).data.status, "destroyed");
    assert.equal((await local.backend.listManaged()).filter(item => item.instanceId === runtimeId).length, 0);
    assert.ok([401, 410].includes((await fetch(gateway.origin + route,
      { headers: { Cookie: cookie } })).status));
    assert.equal((await repo.getCompletionForOwner(owner.build.id, owner.actor.userId)).length, 1);
    const [audit] = await db`select array_agg(event_type order by event_id) as events
      from web_lab_control.runtime_audit_events where instance_id = ${runtimeId}`;
    for (const event of ["admission_reserved", "instance_ready", "launch_grant_exchanged", "grade_succeeded",
      "reset_completed", "destroyed"]) {
      assert.ok(audit.events.includes(event), `audit missing ${event}`);
    }
    const [auditLeak] = await db`select count(*)::int as n from web_lab_control.runtime_audit_events
      where instance_id = ${runtimeId} and (event_type ilike ${`%${SIGNAL}%`} or
        safe_code ilike ${`%${SIGNAL}%`})`;
    assert.equal(auditLeak.n, 0);
    const [usage] = await db`select count(*)::int as n from web_lab_control.runtime_usage
      where instance_id = ${runtimeId}`;
    assert.ok(usage.n >= 1);
    const [freeSlots] = await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
      where instance_id is null`;
    assert.equal(freeSlots.n, 5);

    // The same registered handlers exercise DB-atomic admission under contention without seven Docker builds.
    const fake = createFakeBackend();
    const fakeVersion = "phase14-fake-1";
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion });
    const burstOwners = await Promise.all(Array.from({ length: 7 }, (_, index) =>
      createOwner(webLab.planBeginnerEcommerceStoredXssLab(`phase14-burst-${index}-${randomUUID()}`),
        fakeVersion)));
    const burst = await Promise.all(burstOwners.map((item, index) => call("launch", null,
      { savedLabId: item.savedLabId, mode: "amniora_hosted" }, item.token, `burst-${index}`)));
    const accepted = burst.filter(item => item.data);
    const denied = burst.filter(item => item.error?.code === "HOSTED_CAPACITY_FULL");
    assert.equal(accepted.length, 5);
    assert.equal(denied.length, 2);
    assert.equal(fake.calls.create, 5);
    const repeatedIndex = burst.findIndex(item => item.data);
    const repeated = await Promise.all(Array.from({ length: 3 }, () => call("launch", null,
      { savedLabId: burstOwners[repeatedIndex].savedLabId, mode: "amniora_hosted" },
      burstOwners[repeatedIndex].token, `burst-${repeatedIndex}`)));
    assert.equal(new Set(repeated.map(item => item.data?.instanceId)).size, 1);
    assert.equal(fake.calls.create, 5);
    for (const [index, result] of burst.entries()) {
      if (!result.data) continue;
      if (index !== repeatedIndex) {
        assert.equal((await call("destroy", result.data.instanceId, {},
          burstOwners[index].token, `burst-destroy-${index}`)).data.status, "destroyed");
      }
    }
    assert.equal((await call("launch", null,
      { savedLabId: burstOwners[repeatedIndex].savedLabId, mode: "amniora_hosted" },
      burstOwners[repeatedIndex].token, "second-active")).error.code, "RUNTIME_ALREADY_ACTIVE");
    assert.equal((await call("destroy", burst[repeatedIndex].data.instanceId, {},
      burstOwners[repeatedIndex].token, `burst-destroy-${repeatedIndex}`)).data.status, "destroyed");
    assert.equal((await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
      where instance_id is null`)[0].n, 5);

    const policyOwner = await createOwner(webLab.planBeginnerEcommerceStoredXssLab(
      `phase14-policy-${randomUUID()}`), fakeVersion);
    const policyLaunch = key => call("launch", null,
      { savedLabId: policyOwner.savedLabId, mode: "amniora_hosted" }, policyOwner.token, key);
    await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = false
      where singleton_id = 1`;
    assert.equal((await policyLaunch("kill-switch")).error.code, "HOSTED_DISABLED");
    await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
      budget_state = 'DISABLED' where singleton_id = 1`;
    assert.equal((await policyLaunch("budget-disabled")).error.code, "HOSTED_DISABLED");
    assert.equal(fake.calls.create, 5);
    await db`update web_lab_control.runtime_budget_policy set budget_state = 'NORMAL',
      metrics_observed_at = now() where singleton_id = 1`;
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion,
      denyOperation: "launch" });
    assert.equal((await policyLaunch("rate-launch")).error.code, "RATE_LIMITED");
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion });
    fake.failures.create = true;
    assert.equal((await policyLaunch("create-failure")).error.code,
      "RUNTIME_PROVISIONING_FAILED");
    assert.equal((await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
      where instance_id is null`)[0].n, 5);
    const policyReady = await policyLaunch("policy-ready");
    assert.equal(policyReady.data.status, "ready");
    const policyId = policyReady.data.instanceId;
    const policySession = await call("exchange", null,
      { grant: policyReady.data.launchGrant.token }, policyOwner.token);
    assert.equal((await call("grade", policyId, {}, policyOwner.token, "policy-grade-unavailable",
      { "X-Web-Lab-Runtime-Session": policySession.data.token })).error.code,
    "GRADE_UNAVAILABLE");
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion,
      denyOperation: "reset" });
    assert.equal((await call("reset", policyId, {}, policyOwner.token, "rate-reset")).error.code,
      "RATE_LIMITED");
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion,
      denyOperation: "grade" });
    assert.equal((await call("grade", policyId, {}, policyOwner.token, "policy-grade-rate",
      { "X-Web-Lab-Runtime-Session": policySession.data.token })).error.code,
      "RATE_LIMITED");
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion });
    fake.failures.reset = true;
    assert.equal((await call("reset", policyId, {}, policyOwner.token, "reset-failure")).error.code,
      "RUNTIME_PROVISIONING_FAILED");
    assert.equal((await call("destroy", policyId, {}, policyOwner.token, "destroy-reset-failure")).data.status,
      "destroyed");

    const raceOwner = await createOwner(webLab.planBeginnerEcommerceStoredXssLab(
      `phase14-race-${randomUUID()}`), fakeVersion);
    const raceLaunch = await call("launch", null,
      { savedLabId: raceOwner.savedLabId, mode: "amniora_hosted" }, raceOwner.token, "race-launch");
    const raceId = raceLaunch.data.instanceId;
    const resetCallsBefore = fake.calls.reset;
    const resetRace = await Promise.all(Array.from({ length: 3 }, () =>
      call("reset", raceId, {}, raceOwner.token, "race-reset")));
    assert.equal(new Set(resetRace.map(item => item.data?.generationVersion)).size, 1);
    assert.equal((await call("status", raceId, undefined, raceOwner.token)).data.generationVersion, 2);
    assert.equal(fake.calls.reset - resetCallsBefore, 1);
    const destroyCallsBefore = fake.calls.destroy;
    await Promise.all(Array.from({ length: 3 }, () =>
      call("destroy", raceId, {}, raceOwner.token, "race-destroy")));
    assert.equal((await call("status", raceId, undefined, raceOwner.token)).data.status, "destroyed");
    assert.equal(fake.calls.destroy - destroyCallsBefore, 1);

    const expiringOwner = await createOwner(webLab.planBeginnerEcommerceStoredXssLab(
      `phase14-expiry-${randomUUID()}`), fakeVersion);
    const expires = await call("launch", null,
      { savedLabId: expiringOwner.savedLabId, mode: "amniora_hosted" },
      expiringOwner.token, "expiry-launch");
    assert.equal(expires.data.status, "ready");
    const beforeExpiryClock = now;
    now = Date.parse(expires.data.expiresAt) + 1000;
    activeService = makeService(fake.backend, { async grade() {
      throw new Error("fake-private-grader-unavailable");
    } }, { providerKind: "phase14_fake", runtimeVersion: fakeVersion });
    assert.equal((await call("status", expires.data.instanceId, undefined,
      expiringOwner.token)).data.status, "expired");
    assert.equal(fake.resources.has(expires.data.instanceId), false);
    assert.equal((await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
      where instance_id is null`)[0].n, 5);
    now = beforeExpiryClock;
    console.log("Phase 14 registered-route + Docker + gateway + Stored-XSS + grade/reset/destroy: PASS");
  } finally {
    if (gateway) await gateway.close();
    for (const observation of await local.backend.listManaged()) {
      await local.backend.destroyManaged(observation);
    }
    await db.end();
    Module._load = originalLoad;
    require.extensions[".ts"] = originalTsLoader;
    delete process.env.WEB_LAB_RUNTIME_API_ENABLED;
    delete process.env.WEB_LAB_TRUSTED_GRADING_ENABLED;
    delete process.env.WEB_LAB_APP_ORIGIN;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
