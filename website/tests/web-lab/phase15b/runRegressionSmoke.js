#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Supplemental offline contracts with narrow real-source imports. */
"use strict";

// This is NOT the Phase 13 Postgres campaign or Phase 14 Next/Docker integration.
// It exercises their shared real policy/API modules with injected fixture services only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const sourceRoot = path.resolve(__dirname, "../../../lib/web-lab");
const originalLoad = Module._load;
Module._load = function serverMarker(specifier, parent, isMain) {
  if (specifier === "server-only") {
    // Use Next's actual server entry for its marker, not a fake provider/business dependency.
    return originalLoad.call(this, "next/dist/compiled/server-only/empty.js", parent, isMain);
  }
  return originalLoad.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};
const { ExactWebLabCompatibilityPolicy, WebLabControlError, WebLabControlPlaneService } =
  require(path.join(sourceRoot, "production-control-service.ts"));
const { WEB_LAB_COMPILER_VERSION } = require(path.join(sourceRoot, "postgres-control-repository.ts"));
const { createWebLabRuntimeApiContracts } = require(path.join(sourceRoot, "runtime-api-contracts.ts"));
const { compileWebLab } = require(path.join(sourceRoot, "compiler.ts"));
const planners = {
  ...require(path.join(sourceRoot, "planner.ts")), ...require(path.join(sourceRoot, "ecommerce-planner.ts")),
};

const ORIGIN = "http://localhost:3000";
const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR = { userId: "33333333-3333-4333-8333-333333333333", sessionId: "fixture-session" };
let assertions = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function ok(condition, message) { assert.ok(condition, message); assertions++; }

function request(method = "POST", data = { savedLabId: ID, mode: "local_runner" }, overrides = {}) {
  const headers = new Headers({ Origin: ORIGIN, "content-type": "application/json", "idempotency-key": "fixture-key" });
  for (const [key, value] of Object.entries(overrides.headers || {})) {
    if (value === null) headers.delete(key); else headers.set(key, value);
  }
  return new Request(overrides.url || ORIGIN + "/api/web-labs/runtime/launch", {
    method, headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body: overrides.raw ?? JSON.stringify(data) }),
  });
}

async function read(response, code, httpStatus) {
  equal(response.status, httpStatus);
  equal(response.headers.get("cache-control"), "no-store");
  ok(response.headers.get("content-type").includes("application/json"));
  const text = await response.text();
  for (const secret of ["private-fixture-detail", "provider.example", "internalSolution", "backendReference", "ownerId"])
    equal(text.includes(secret), false, `Response leaked ${secret}`);
  const payload = JSON.parse(text);
  equal(Object.keys(payload).sort(), ["data", "error"]);
  if (code) { equal(payload.data, null); equal(payload.error.code, code); }
  else equal(payload.error, null);
  return payload;
}

function fixtureApi(overrides = {}) {
  const calls = [];
  let actorCalls = 0;
  const service = {};
  for (const operation of ["launch", "getRuntimeStatus", "reset", "destroy", "grade", "exchangeLaunchGrant"]) {
    service[operation] = async (actor, ...inputs) => {
      calls.push({ operation, actor, input: inputs[0], inputs });
      if (overrides.error) throw overrides.error;
      return { fixture: true, operation };
    };
  }
  const api = createWebLabRuntimeApiContracts({
    service, enabled: true, gradingEnabled: true, trustedOrigin: ORIGIN,
    resolveActor: async () => { actorCalls++; return ACTOR; }, ...overrides,
  });
  return { api, calls, actorCalls: () => actorCalls };
}

function compatibilityTests() {
  const policy = new ExactWebLabCompatibilityPolicy();
  const metadata = { compilerVersion: WEB_LAB_COMPILER_VERSION, runtimeVersion: "web-lab-local-1" };
  for (const mode of ["local_runner", "byo_runtime", "amniora_hosted"]) {
    equal(policy.verdict(metadata, mode, "web-lab-local-1"), "SUPPORTED");
    equal(policy.verdict({ ...metadata, compilerVersion: "older-compiler" }, mode, "web-lab-local-1"), "LEGACY_READ_ONLY");
    equal(policy.verdict({ ...metadata, runtimeVersion: "older-runtime" }, mode, "web-lab-local-1"), "LEGACY_READ_ONLY");
    equal(policy.verdict(metadata, mode, "different-runtime"), "LEGACY_READ_ONLY");
  }
}

async function serviceProjectionTests() {
  const now = 1_800_000_000_000;
  const runtime = {
    instanceId: ID, buildId: OTHER_ID, runtimeMode: "local_runner", status: "ready", generationVersion: 1,
    createdAt: new Date(now - 1_000).toISOString(), expiresAt: new Date(now + 60_000).toISOString(), version: 1,
    ownerId: ACTOR.userId, providerKind: "fixture-provider", runtimeVersion: "web-lab-local-1",
    backendReference: "https://provider.example/private-fixture-detail", updatedAt: new Date(now).toISOString(),
    internalSolution: "private-fixture-detail",
  };
  const lookups = [];
  const service = new WebLabControlPlaneService({
    repository: { async getRuntimeControl(instanceId, ownerId) {
      lookups.push({ instanceId, ownerId });
      return instanceId === ID && ownerId === ACTOR.userId ? runtime : null;
    } },
    entitlement: { async planFor() { return "free"; } },
    ratePolicy: { async assertAllowed() { throw new Error("Unexpected rate operation"); } },
    compatibility: new ExactWebLabCompatibilityPolicy(),
    grader: { async grade() { throw new Error("Unexpected grading"); } },
    backends: [], signingKey: Buffer.alloc(32, 15), now: () => now,
  });
  const result = await service.getRuntimeStatus(ACTOR, ID);
  equal(Object.keys(result).sort(), ["instanceId", "buildId", "mode", "status", "createdAt", "expiresAt",
    "generationVersion", "remainingResets", "availableActions"].sort());
  equal(result.availableActions, ["open", "grade", "reset", "destroy"]);
  equal(lookups, [{ instanceId: ID, ownerId: ACTOR.userId }]);
  for (const hidden of ["backendReference", "providerKind", "ownerId", "internalSolution", "private-fixture-detail"])
    equal(JSON.stringify(result).includes(hidden), false, "Real service DTO excludes internal repository fields");
  await assert.rejects(service.getRuntimeStatus({ ...ACTOR, userId: OTHER_ID }, ID), error => error.code === "RUNTIME_NOT_FOUND"); assertions++;
  await assert.rejects(service.getRuntimeStatus({ ...ACTOR, userId: "invalid" }, ID), error => error.code === "UNAUTHENTICATED"); assertions++;
  await assert.rejects(service.getRuntimeStatus(ACTOR, "invalid"), error => error.code === "RUNTIME_NOT_FOUND"); assertions++;
}

async function routeBoundaryTests() {
  for (const enabled of [undefined, false, "true", 1]) {
    const fixture = fixtureApi({ enabled });
    await read(await fixture.api.launch(request()), "LAB_NOT_FOUND", 404);
    equal(fixture.calls.length, 0);
    equal(fixture.actorCalls(), 0, "Default-disabled gate precedes actor/service resolution");
  }
  const unauthenticated = fixtureApi({ resolveActor: async () => null });
  await read(await unauthenticated.api.launch(request()), "UNAUTHENTICATED", 401);
  equal(unauthenticated.calls.length, 0);
  const valid = fixtureApi();
  const launched = await read(await valid.api.launch(request()), null, 202);
  equal(launched.data, { fixture: true, operation: "launch" });
  equal(valid.calls, [{ operation: "launch", actor: ACTOR,
    input: { savedLabId: ID, mode: "local_runner", idempotencyKey: "fixture-key" },
    inputs: [{ savedLabId: ID, mode: "local_runner", idempotencyKey: "fixture-key" }] }]);
  for (const overrides of [
    { headers: { Origin: null } }, { headers: { Origin: "https://hostile.example" } },
    { headers: { Origin: "null" } }, { headers: { Origin: ORIGIN + "/path" } },
    { url: "https://hostile.example/path", headers: { Host: "localhost:3000", "X-Forwarded-Host": "localhost:3000" } },
  ]) {
    const fixture = fixtureApi();
    await read(await fixture.api.launch(request("POST", undefined, overrides)), "CSRF_REJECTED", 403);
    equal(fixture.calls.length, 0);
  }
  for (const trustedOrigin of [undefined, "http://192.168.1.3:3000", "javascript:alert(1)", ORIGIN + "/path"]) {
    const fixture = fixtureApi({ trustedOrigin });
    await read(await fixture.api.launch(request()), "CSRF_REJECTED", 403);
    equal(fixture.calls.length, 0);
  }
  for (const invalid of [
    { savedLabId: ID, mode: "local_runner", ownerId: OTHER_ID },
    { savedLabId: ID, mode: "local_runner", image: "arbitrary" },
    { savedLabId: ID, mode: "local_runner", completed: true },
    { savedLabId: ID, mode: "unknown" }, { savedLabId: "invalid", mode: "local_runner" },
    [], null,
  ]) {
    const fixture = fixtureApi();
    await read(await fixture.api.launch(request("POST", invalid)), "INVALID_REQUEST", 400);
    equal(fixture.calls.length, 0);
  }
  for (const overrides of [
    { headers: { "content-type": "text/plain" } }, { headers: { "content-type": null } },
    { headers: { "idempotency-key": null } }, { headers: { "idempotency-key": "x".repeat(161) } },
    { headers: { "content-length": "4096" } }, { raw: "{" }, { raw: " ".repeat(2_049) },
  ]) {
    const fixture = fixtureApi();
    await read(await fixture.api.launch(request("POST", undefined, overrides)), "INVALID_REQUEST", 400);
    equal(fixture.calls.length, 0);
  }
  const wrongMethod = fixtureApi();
  await read(await wrongMethod.api.launch(request("GET")), "INVALID_REQUEST", 400);
  await read(await wrongMethod.api.status(request("POST", {}), ID), "INVALID_REQUEST", 400);
  await read(await wrongMethod.api.status(request("GET"), "invalid"), "RUNTIME_NOT_FOUND", 404);
  equal(wrongMethod.calls.length, 0);
  for (const operation of ["reset", "destroy", "grade"]) {
    const fixture = fixtureApi();
    const method = operation === "destroy" ? "DELETE" : "POST";
    await read(await fixture.api[operation](request(method, { completed: true }), ID), "INVALID_REQUEST", 400);
    equal(fixture.calls.length, 0, "The browser cannot submit completion/privileged input");
    const validRequest = request(method, {}, operation === "grade"
      ? { headers: { "x-web-lab-runtime-session": "fixture-runtime-session" } } : {});
    await read(await fixture.api[operation](validRequest, ID), null, operation === "grade" ? 200 : 202);
    equal(fixture.calls[0].actor, ACTOR);
  }
  const rawFailure = fixtureApi({ error: new Error("private-fixture-detail provider.example") });
  await read(await rawFailure.api.status(request("GET"), ID), "INTERNAL_ERROR", 500);
  const safeFailure = fixtureApi({ error: new WebLabControlError("LAB_INCOMPATIBLE", "LEGACY_READ_ONLY") });
  const safePayload = await read(await safeFailure.api.launch(request()), "LAB_INCOMPATIBLE", 409);
  equal(safePayload.error, { code: "LAB_INCOMPATIBLE", compatibility: "LEGACY_READ_ONLY" });
}

function deterministicCompilerTests() {
  const cases = [
    ["helpdesk", "reflected-xss", planners.planBeginnerHelpdeskLab],
    ["helpdesk", "stored-xss", planners.planBeginnerStoredXssLab],
    ["ecommerce", "reflected-xss", planners.planBeginnerEcommerceReflectedXssLab],
    ["ecommerce", "stored-xss", planners.planBeginnerEcommerceStoredXssLab],
  ];
  const fingerprints = new Set();
  for (const [template, vulnerability, plan] of cases) {
    for (const seed of ["phase15b-smoke-one", "phase15b-smoke-two", "phase15b-smoke-three"]) {
      const spec = plan(seed);
      const repeated = plan(seed);
      equal(repeated, spec, "Planner remains deterministic");
      const compiled = compileWebLab(spec);
      equal(compileWebLab(repeated), compiled, "Compiler output remains deterministic");
      equal(compiled.manifest.templateId, template);
      equal(compiled.manifest.vulnerabilityId, vulnerability);
      equal(compiled.manifest.difficulty, "Beginner");
      equal(compiled.manifest.durationMinutes, 30);
      equal(compiled.isolation.iframeSandbox, "allow-scripts");
      equal(compiled.isolation.opaqueOriginRequired, true);
      ok(/^[0-9a-f]{64}$/.test(compiled.manifest.canonicalSpecSha256));
      ok(/^[0-9a-f]{64}$/.test(compiled.manifest.learnerBundleSha256));
      for (const hidden of ["internalSolution", "groundTruthTag", "service_role", "providerReference"])
        equal(compiled.html.includes(hidden), false, "Learner HTML must not contain internal contract fields");
      fingerprints.add(compiled.manifest.canonicalSpecSha256);
    }
  }
  equal(fingerprints.size, 12, "Each template/module/seed fixture retains its own canonical identity");
}

async function main() {
  compatibilityTests();
  await serviceProjectionTests();
  await routeBoundaryTests();
  deterministicCompilerTests();
  console.log(`Phase 15B supplemental offline regression smoke: PASS (${assertions} assertions)`);
  console.log("Real Phase 13 compatibility/DTO + shared Phase 14 API boundary + 12 deterministic compiles (4 families).");
  console.log("Not the full Phase 13/14 integration suites: no Next server, database, Docker, provider, or browser launched.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
