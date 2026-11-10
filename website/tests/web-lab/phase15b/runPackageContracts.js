#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped TS loader; no database or cloud services. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "../../..");
const sourceRoot = path.join(root, "lib/web-lab");
const routeRoot = path.join(root, "app/api/web-labs/local-runner");
const load = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  if (specifier === "./supabase-runtime-actor") return { resolveSupabaseWebLabActor: async () => actor };
  if (specifier.startsWith("@/lib/web-lab/")) {
    return load.call(this, path.join(root, specifier.slice(2)) + ".ts", parent, isMain);
  }
  return load.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (![sourceRoot, routeRoot].some(directory => filename.startsWith(directory + path.sep))) {
    throw new Error("Only scoped Web lab sources may be loaded");
  }
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};
const { LocalRunnerProductService, LocalRunnerProductError } = require(path.join(sourceRoot, "local-runner-product-service.ts"));
const { createLocalRunnerProductApi } = require(path.join(sourceRoot, "local-runner-product-api.ts"));
const { compileWebLab } = require(path.join(sourceRoot, "compiler.ts"));
const { WEB_LAB_COMPILER_VERSION } = require(path.join(sourceRoot, "postgres-control-repository.ts"));
const { verifyLocalRunnerPackage } = require(path.join(sourceRoot, "local-runner/package.ts"));
const { LOCAL_RUNNER_RUNTIME_VERSION } = require(path.join(sourceRoot, "local-runner/protocol.ts"));
const planners = { ...require(path.join(sourceRoot, "planner.ts")), ...require(path.join(sourceRoot, "ecommerce-planner.ts")) };
const actor = { userId: randomUUID(), sessionId: "fixture-session" };
const foreignActor = { userId: randomUUID(), sessionId: "foreign-session" };
const origin = "http://localhost:3000";
const now = 1_800_000_000_000;
let assertions = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function fixture(planner = planners.planBeginnerEcommerceStoredXssLab) {
  const spec = planner("phase15b-package-contract");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const authority = { keyId: "phase15b-fixture-key", privateKey };
  const metadata = { id: randomUUID(), savedLabId: randomUUID(), canonicalLabId: spec.labId,
    templateId: spec.templateId, templateVersion: spec.templateVersion,
    vulnerabilityModuleId: spec.vulnerability.moduleId, vulnerabilityModuleVersion: spec.vulnerability.moduleVersion,
    schemaVersion: spec.schemaVersion, compilerVersion: WEB_LAB_COMPILER_VERSION,
    runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION, buildFingerprint: compileWebLab(spec).manifest.canonicalSpecSha256,
    createdAt: new Date(now).toISOString() };
  const calls = [];
  const trusted = { metadata: structuredClone(metadata), spec };
  const repository = {
    async getBuildMetadata(savedLabId, ownerId) {
      calls.push(["metadata", savedLabId, ownerId]);
      return ownerId === actor.userId && savedLabId === metadata.savedLabId ? metadata : null;
    },
    async getTrustedBuild(buildId, ownerId) {
      calls.push(["trusted", buildId, ownerId]);
      return ownerId === actor.userId && buildId === metadata.id ? trusted : null;
    },
  };
  let signCalls = 0;
  const service = new LocalRunnerProductService({ repository,
    signingAuthority: () => { signCalls++; return authority; }, now: () => now });
  const api = createLocalRunnerProductApi({ enabled: true, trustedOrigin: origin,
    resolveActor: async () => actor, service: () => service });
  return { spec, metadata, trusted, authority, publicKey, repository, calls, service, api, signCalls: () => signCalls };
}
function request(id, operation = "eligibility", overrides = {}) {
  const packageRequest = operation === "package";
  return new Request(overrides.url ?? `${origin}/api/web-labs/local-runner/${id}${packageRequest ? "/package" : ""}`, {
    method: packageRequest ? "POST" : "GET", ...(packageRequest ? { body: "{}",
      headers: { origin, "content-type": "application/json" } } : {}), ...overrides,
  });
}
async function expectError(response, status, code) {
  equal(response.status, status);
  equal(await response.json(), { data: null, error: { code } });
  equal(response.headers.get("cache-control"), "no-store");
  equal(response.headers.get("access-control-allow-origin"), null);
}

async function main() {
  for (const planner of [planners.planBeginnerHelpdeskLab, planners.planBeginnerStoredXssLab,
    planners.planBeginnerEcommerceReflectedXssLab, planners.planBeginnerEcommerceStoredXssLab]) {
    const f = fixture(planner);
    const eligibility = await f.api("eligibility", request(f.metadata.savedLabId), f.metadata.savedLabId);
    equal(await eligibility.json(), { data: { enabled: true, eligible: true, build: {
      buildId: f.metadata.id, buildFingerprint: f.metadata.buildFingerprint,
      runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION } }, error: null });
    equal(f.signCalls(), 0, "eligibility never reads signing authority");
    const response = await f.api("package", request(f.metadata.savedLabId, "package"), f.metadata.savedLabId);
    equal(response.status, 200);
    const issued = (await response.json()).data.package;
    equal(verifyLocalRunnerPackage(issued, new Map([[f.authority.keyId, f.publicKey]]), {
      now: () => now, expectedBuildId: f.metadata.id, expectedBuildFingerprint: f.metadata.buildFingerprint }).buildId, f.metadata.id);
    equal(issued.expiresAt - issued.issuedAt, 300_000);
    equal(issued.bundle.map(file => file.path), ["index.html", "initial-state.json", "runtime-config.json"]);
    const serialized = JSON.stringify(issued);
    for (const text of ["internalSolution", "groundTruthTag", "service_role", "PRIVATE KEY", "hopSecret",
      "backendReference", "providerReference", "databaseConnection", "trustedGradingContract", "vercel.run",
      "docker.sock", actor.userId, actor.sessionId]) equal(serialized.includes(text), false, `package leak: ${text}`);
    equal(f.calls.every(call => call[2] === actor.userId), true, "every query binds authenticated owner");
    const tampered = { ...issued, providerReference: "unexpected-provider" };
    assert.throws(() => verifyLocalRunnerPackage(tampered, new Map([[f.authority.keyId, f.publicKey]]), {
      now: () => now }), error => error.code === "PACKAGE_INVALID"); assertions++;
  }

  const f = fixture();
  for (const enabled of [undefined, false]) {
    const disabled = createLocalRunnerProductApi({ enabled, service: () => { throw new Error("must not connect"); },
      resolveActor: async () => { throw new Error("must not resolve"); } });
    equal(await (await disabled("eligibility", request(f.metadata.savedLabId), f.metadata.savedLabId)).json(),
      { data: { enabled: false, eligible: false, build: null }, error: null });
    await expectError(await disabled("package", request(f.metadata.savedLabId, "package"), f.metadata.savedLabId), 404, "LAB_NOT_FOUND");
  }
  const anonymous = createLocalRunnerProductApi({ enabled: true, service: () => f.service,
    trustedOrigin: origin, resolveActor: async () => null });
  for (const operation of ["eligibility", "package"]) await expectError(await anonymous(operation,
    request(f.metadata.savedLabId, operation), f.metadata.savedLabId), 401, "UNAUTHENTICATED");

  const foreign = createLocalRunnerProductApi({ enabled: true, trustedOrigin: origin,
    service: () => f.service, resolveActor: async () => foreignActor });
  equal(await (await foreign("eligibility", request(f.metadata.savedLabId), f.metadata.savedLabId)).json(),
    { data: { enabled: true, eligible: false, build: null }, error: null });
  await expectError(await foreign("package", request(f.metadata.savedLabId, "package"), f.metadata.savedLabId), 404, "LAB_NOT_FOUND");
  equal(f.signCalls(), 0, "forged owner never reaches signer");
  for (const staticCategory of ["Web Security", "Linux"]) {
    const staticId = randomUUID();
    equal(await (await f.api("eligibility", request(staticId), staticId)).json(),
      { data: { enabled: true, eligible: false, build: null }, error: null }, staticCategory);
    await expectError(await f.api("package", request(staticId, "package"), staticId), 404, "LAB_NOT_FOUND");
  }
  for (const body of [JSON.stringify({ ownerId: actor.userId }), JSON.stringify({ category: "Web Security", executable: true }),
    JSON.stringify({ buildId: f.metadata.id }), JSON.stringify({ spec: f.spec }), JSON.stringify({ image: "attacker" }),
    JSON.stringify({ runtimeVersion: LOCAL_RUNNER_RUNTIME_VERSION }), "null", "[]", "{", '{"__proto__":{}}']) {
    await expectError(await f.api("package", request(f.metadata.savedLabId, "package", { body }), f.metadata.savedLabId),
      Buffer.byteLength(body) > 512 ? 413 : 400, Buffer.byteLength(body) > 512 ? "REQUEST_TOO_LARGE" : "INVALID_REQUEST");
  }
  for (const suppliedOrigin of [undefined, "null", "https://attacker.example", origin + "/", origin + "/evil",
    "http://localhost:3000@attacker.example", "http://127.0.0.1:3000"]) {
    const headers = { "content-type": "application/json", host: "localhost:3000", "x-forwarded-host": "localhost:3000" };
    if (suppliedOrigin !== undefined) headers.origin = suppliedOrigin;
    await expectError(await f.api("package", request(f.metadata.savedLabId, "package", { headers }), f.metadata.savedLabId), 403, "CSRF_REJECTED");
  }
  await expectError(await f.api("package", request(f.metadata.savedLabId, "package", {
    url: `https://attacker.example/api/web-labs/local-runner/${f.metadata.savedLabId}/package`,
  }), f.metadata.savedLabId), 403, "CSRF_REJECTED");
  await expectError(await f.api("package", request(f.metadata.savedLabId, "package", { body: " ".repeat(513) }),
    f.metadata.savedLabId), 413, "REQUEST_TOO_LARGE");
  await expectError(await f.api("package", request(f.metadata.savedLabId, "package", { headers: { origin,
    "content-type": "text/plain" } }), f.metadata.savedLabId), 400, "INVALID_REQUEST");
  await expectError(await f.api("eligibility", request(f.metadata.savedLabId, "eligibility", { headers: {
    "sec-fetch-site": "cross-site" } }), f.metadata.savedLabId), 403, "CSRF_REJECTED");
  for (const query of ["?ownerId=forged", "?category=Web%20Security", "?redirect=http://attacker.example"]) {
    await expectError(await f.api("eligibility", request(f.metadata.savedLabId, "eligibility", {
      url: `${origin}/api/web-labs/local-runner/${f.metadata.savedLabId}${query}` }), f.metadata.savedLabId), 400, "INVALID_REQUEST");
  }
  for (const mutation of [
    data => { data.metadata.runtimeVersion = "unsupported"; },
    data => { data.metadata.compilerVersion = "unsupported"; },
    data => { data.metadata.savedLabId = randomUUID(); },
    data => { data.trusted.metadata.buildFingerprint = "0".repeat(64); },
    data => { data.spec.seed += "-changed"; },
    data => { data.spec.providerReference = "unexpected"; },
  ]) {
    const broken = fixture();
    const savedLabId = broken.metadata.savedLabId;
    // Force the inconsistent row back to the service to exercise defense beyond the repository query.
    broken.repository.getBuildMetadata = async () => broken.metadata;
    mutation(broken);
    await expectError(await broken.api("package", request(savedLabId, "package"), savedLabId), 409, "LAB_INCOMPATIBLE");
    equal(broken.signCalls(), 0);
  }
  const unavailable = new LocalRunnerProductService({ repository: f.repository,
    signingAuthority: () => { throw new LocalRunnerProductError("LOCAL_RUNNER_UNAVAILABLE"); } });
  const unavailableApi = createLocalRunnerProductApi({ enabled: true, trustedOrigin: origin,
    resolveActor: async () => actor, service: () => unavailable });
  await expectError(await unavailableApi("package", request(f.metadata.savedLabId, "package"), f.metadata.savedLabId), 503, "LOCAL_RUNNER_UNAVAILABLE");
  const failureApi = createLocalRunnerProductApi({ enabled: true, trustedOrigin: origin,
    resolveActor: async () => actor, service: () => { throw new Error("fixture-private-database-detail"); } });
  await expectError(await failureApi("package", request(f.metadata.savedLabId, "package"), f.metadata.savedLabId), 500, "INTERNAL_ERROR");

  // Exercise the actual Next route wrappers and feature-flag composition with no DB or credential access.
  const getRoute = require(path.join(routeRoot, "[id]/route.ts"));
  const packageRoute = require(path.join(routeRoot, "[id]/package/route.ts"));
  for (const flag of [undefined, "false", "TRUE", "1"]) {
    if (flag === undefined) delete process.env.WEB_LAB_LOCAL_RUNNER_ENABLED;
    else process.env.WEB_LAB_LOCAL_RUNNER_ENABLED = flag;
    equal(await (await getRoute.GET(request(f.metadata.savedLabId), { params: Promise.resolve({ id: f.metadata.savedLabId }) })).json(),
      { data: { enabled: false, eligible: false, build: null }, error: null });
    await expectError(await packageRoute.POST(request(f.metadata.savedLabId, "package"), {
      params: Promise.resolve({ id: f.metadata.savedLabId }) }), 404, "LAB_NOT_FOUND");
  }
  process.env.WEB_LAB_LOCAL_RUNNER_ENABLED = "true";
  process.env.WEB_LAB_APP_ORIGIN = origin;
  delete process.env.WEB_LAB_CONTROL_DATABASE_URL;
  await expectError(await packageRoute.POST(request(f.metadata.savedLabId, "package"), {
    params: Promise.resolve({ id: f.metadata.savedLabId }) }), 503, "LOCAL_RUNNER_UNAVAILABLE");
  console.log(`Phase 15B package boundary: ${assertions} assertions passed; 4 signed template/module fixtures; no external services.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
