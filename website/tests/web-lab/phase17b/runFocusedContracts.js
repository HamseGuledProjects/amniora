#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated TypeScript contract harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const Module = require("node:module");
const root = path.resolve(__dirname, "../../../lib/web-lab");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(root + path.sep)) throw new Error("Only Web Lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};

const { CloudProductService } = require(path.join(root, "cloud-runtime/product-service.ts"));
const { createCloudProductApi } = require(path.join(root, "cloud-runtime/product-api.ts"));
const { WebLabControlError, WebLabControlPlaneService } = require(path.join(root, "production-control-service.ts"));

const ORIGIN = "http://localhost:3000";
const GATEWAY = "https://lab.amniora.example";
const LAB = "11111111-1111-4111-8111-111111111111";
const STATIC = "44444444-4444-4444-8444-444444444444";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const INSTANCE = "55555555-5555-4555-8555-555555555555";
const BUILD = "66666666-6666-4666-8666-666666666666";
const now = Date.now();
const actors = {
  pro: { userId: OWNER, sessionId: "pro-session" },
  free: { userId: OWNER, sessionId: "free-session" },
  other: { userId: OTHER, sessionId: "other-session" },
};
const runtime = (status = "ready") => ({
  instanceId: INSTANCE, buildId: BUILD, mode: "amniora_hosted", status,
  createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60_000).toISOString(),
  generationVersion: 1, remainingResets: 3,
  availableActions: status === "ready" ? ["open", "reset", "destroy", "grade"]
    : ["requested", "provisioning", "resetting", "destroying", "expiring"].includes(status) ? ["destroy"] : [],
});

let availability = "available";
let current = null;
let launchFailure = null;
let launchCalls = 0;
let resetCalls = 0;
let stopCalls = 0;
let grantCalls = 0;
const launches = new Map();
const ownership = new Map([[OWNER, null], [OTHER, null]]);
const control = {
  async getHostedProductState(actor, savedLabId) {
    const owned = ownership.get(actor.userId) || null;
    return {
      plan: actor.sessionId.startsWith("free") ? "free" : "pro",
      eligible: savedLabId === LAB,
      availability: actor.sessionId.startsWith("free") ? "plan_required" : savedLabId === LAB ? availability : "unavailable",
      runtime: owned,
    };
  },
  async launch(actor, input) {
    if (launchFailure) throw new WebLabControlError(launchFailure);
    const scope = `${actor.userId}:${input.idempotencyKey}`;
    if (!launches.has(scope)) { launches.set(scope, true); launchCalls++; }
    current = runtime("ready"); ownership.set(actor.userId, current); return current;
  },
  async reset(actor) { resetCalls++; current = runtime("ready"); ownership.set(actor.userId, current); return current; },
  async destroy(actor) { stopCalls++; current = null; ownership.set(actor.userId, null); return runtime("destroyed"); },
  async issueLaunchGrant(actor, instanceId) {
    assert.equal(ownership.get(actor.userId)?.instanceId, instanceId, "open resolves only the authenticated owner's runtime");
    grantCalls++; return { token: "control-launch-grant", expiresAt: new Date(now + 20_000).toISOString() };
  },
  async exchangeLaunchGrant(actor, token) {
    assert.equal(token, "control-launch-grant");
    return { token: `${"a".repeat(48)}.${"b".repeat(43)}`, instanceId: ownership.get(actor.userId).instanceId,
      expiresAt: new Date(Date.now() + 20_000).toISOString() };
  },
};
const service = new CloudProductService(control, GATEWAY);
const resolver = async request => actors[request.headers.get("authorization") || "pro"] || null;
const api = createCloudProductApi({ enabled: true, origin: ORIGIN, resolveActor: resolver, service });

function request(method = "GET", body, authorization = "pro", id = LAB, extraHeaders = {}) {
  return new Request(`${ORIGIN}/api/web-labs/cloud/${id}`, {
    method,
    headers: {
      authorization,
      ...(body ? { "content-type": "application/json", origin: ORIGIN } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function envelope(response) { return { status: response.status, ...(await response.json()) }; }
function serializedSafe(value) {
  const text = JSON.stringify(value);
  for (const forbidden of ["instanceId", "buildId", "backendReference", "provider", "sandbox", "vercel.run",
    "service_role", "internalSolution", "launchGrant", "signingKey"]) {
    assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `safe Cloud DTO leaked ${forbidden}`);
  }
}

async function main() {
  let plan = "free";
  let slotAvailable = true;
  let policy = { enabled: true, state: "NORMAL", metricsObservedAt: new Date().toISOString() };
  let active = null;
  const metadata = { id: BUILD, savedLabId: LAB, canonicalLabId: LAB, templateId: "helpdesk", templateVersion: "1",
    vulnerabilityModuleId: "stored-xss", vulnerabilityModuleVersion: "1", schemaVersion: 1,
    compilerVersion: "phase12-web-1", runtimeVersion: "web-lab-local-1", buildFingerprint: "0".repeat(64),
    createdAt: new Date().toISOString() };
  const stateRepository = {
    async getBuildMetadata(id, ownerId) { return id === LAB && ownerId === OWNER ? metadata : null; },
    async getLatestHostedRuntimeForSavedLab() { return active?.savedLabId === LAB ? active : null; },
    async getActiveHostedRuntimeForOwner() { return active; },
    async getHostedBudgetPolicy() { return policy; },
    async hasAvailableHostedSlot() { return slotAvailable; },
  };
  const stateService = new WebLabControlPlaneService({ repository: stateRepository,
    entitlement: { async planFor() { return plan; } }, ratePolicy: { async assertAllowed() {} },
    compatibility: { verdict() { return "SUPPORTED"; } }, grader: { async grade() { throw new Error("not used"); } },
    backends: [{ mode: "amniora_hosted", providerKind: "hosted", runtimeVersion: "hosted-1", backend: {} }],
    signingKey: Buffer.alloc(32, 7) });
  assert.equal((await stateService.getHostedProductState(actors.pro, LAB)).availability, "plan_required");
  plan = "pro"; slotAvailable = false;
  assert.equal((await stateService.getHostedProductState(actors.pro, LAB)).availability, "capacity_full");
  slotAvailable = true; policy = { ...policy, state: "RESTRICTED" };
  assert.equal((await stateService.getHostedProductState(actors.pro, LAB)).availability, "budget_unavailable");
  policy = { ...policy, state: "DISABLED" };
  assert.equal((await stateService.getHostedProductState(actors.pro, LAB)).availability, "service_disabled");
  policy = { ...policy, state: "NORMAL" };
  active = { ...runtime("provisioning"), runtimeMode: "amniora_hosted", savedLabId: STATIC, version: 1 };
  assert.equal((await stateService.getHostedProductState(actors.pro, LAB)).availability, "active_elsewhere");
  active = null;

  const disabled = createCloudProductApi({ enabled: false, origin: ORIGIN, resolveActor: resolver, service });
  assert.equal((await disabled(request(), LAB)).status, 404, "Cloud product flag defaults closed");

  const free = await envelope(await api(request("GET", undefined, "free"), LAB));
  assert.equal(free.status, 200); assert.equal(free.data.plan, "free");
  assert.equal(free.data.availability, "plan_required"); assert.equal(free.data.runtime, null);
  serializedSafe(free.data);

  const staticLab = await envelope(await api(request("GET", undefined, "pro", STATIC), STATIC));
  assert.equal(staticLab.data.eligible, false, "static/non-executable Saved Lab is excluded by server build eligibility");

  const pro = await envelope(await api(request(), LAB));
  assert.deepEqual({ plan: pro.data.plan, eligible: pro.data.eligible, availability: pro.data.availability },
    { plan: "pro", eligible: true, availability: "available" });

  const launchBody = { action: "launch", idempotencyKey: "phase17b-launch" };
  const launched = await envelope(await api(request("POST", launchBody), LAB));
  assert.equal(launched.status, 202); assert.equal(launched.data.runtime.state, "ready");
  serializedSafe(launched.data);
  await api(request("POST", launchBody), LAB);
  assert.equal(launchCalls, 1, "duplicate launch key creates one logical launch");

  const recovered = await envelope(await api(request(), LAB));
  assert.equal(recovered.data.runtime.state, "ready", "refresh recovers authoritative hosted state");
  assert.equal(Object.hasOwn(recovered.data.runtime, "generationVersion"), false);

  const opened = await envelope(await api(request("POST", { action: "open" }), LAB));
  assert.equal(opened.status, 200); assert.equal(opened.data.action, `${GATEWAY}/__amniora/cloud/launch`);
  assert.match(opened.data.handoff, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(grantCalls, 1, "Open exchanges a fresh one-use control grant server-side");
  assert.equal(JSON.stringify(opened).includes("control-launch-grant"), false, "control grant never reaches the browser");
  assert.equal(JSON.stringify(opened).includes("vercel.run"), false);

  const reset = await envelope(await api(request("POST", { action: "reset", idempotencyKey: "phase17b-reset" }), LAB));
  assert.equal(reset.status, 202); assert.equal(reset.data.runtime.state, "ready"); assert.equal(resetCalls, 1);
  const stopped = await envelope(await api(request("POST", { action: "stop", idempotencyKey: "phase17b-stop" }), LAB));
  assert.equal(stopped.status, 202); assert.equal(stopped.data.runtime, null); assert.equal(stopCalls, 1);

  for (const [code, status] of [["HOSTED_CAPACITY_FULL", 409], ["HOSTED_DISABLED", 503],
    ["HOSTED_BUDGET_RESTRICTED", 503], ["HOSTED_BUDGET_EXCEEDED", 503],
    ["RUNTIME_PROVISIONING_FAILED", 503]]) {
    launchFailure = code;
    const result = await envelope(await api(request("POST", { action: "launch", idempotencyKey: `failure-${code}` }), LAB));
    assert.equal(result.status, status); assert.deepEqual(result.error, { code });
  }
  launchFailure = null;
  for (const state of ["capacity_full", "budget_unavailable", "service_disabled", "unavailable", "active_elsewhere"]) {
    availability = state;
    const result = await envelope(await api(request(), LAB));
    assert.equal(result.data.availability, state, `${state} remains learner-safe`);
    serializedSafe(result.data);
  }
  availability = "available";

  for (const extra of [{ ownerId: OWNER }, { runtimeId: INSTANCE }, { host: "169.254.169.254" },
    { port: 443 }, { url: "https://example.invalid" }, { protocol: "https:" }]) {
    const result = await api(request("POST", { action: "launch", idempotencyKey: "inject", ...extra }), LAB);
    assert.equal(result.status, 400, `reject browser authority field ${Object.keys(extra)[0]}`);
  }
  assert.equal((await api(request("POST", { action: "open", idempotencyKey: "not-allowed" }), LAB)).status, 400);
  assert.equal((await api(request("POST", { action: "launch", idempotencyKey: "csrf" }, "pro", LAB, { origin: "https://evil.invalid" }), LAB)).status, 403);
  assert.equal((await api(request("GET", undefined, "missing"), LAB)).status, 401);

  current = runtime("ready"); ownership.set(OWNER, current); ownership.set(OTHER, runtime("ready"));
  await api(request("POST", { action: "stop", idempotencyKey: "other-stop" }, "other"), LAB);
  assert.equal(ownership.get(OWNER)?.status, "ready", "wrong user cannot stop the owner's runtime");
  assert.equal(ownership.get(OTHER), null, "authenticated actor controls only their own runtime");

  const component = fs.readFileSync(path.resolve(__dirname, "../../../app/dashboard/saved/[id]/SavedLabCloud.tsx"), "utf8");
  assert.doesNotMatch(component, /vercel|sandbox|provider project|region id|backendReference/i);
  assert.doesNotMatch(component, /\{\s*(?:value\.)?handoff\s*\}/, "gateway handoff is never rendered");
  const parent = fs.readFileSync(path.resolve(__dirname, "../../../app/dashboard/saved/[id]/SavedLabLocalRunner.tsx"), "utf8");
  for (const option of ["My Computer", "My VM", "Amniora Cloud", "Available · Free and Pro"]) assert.match(parent, new RegExp(option.replace("·", "\\·")));
  assert.match(parent, /cloudSnapshot\?\.plan === "free"/);
  const composition = fs.readFileSync(path.resolve(__dirname, "../../../lib/web-lab/cloud-runtime/product-composition.ts"), "utf8");
  assert.match(composition, /WEB_LAB_CLOUD_PRODUCT_ENABLED !== "true"/);
  assert.match(composition, /WEB_LAB_RUNTIME_API_ENABLED !== "true"/);
  console.log("Phase 17B Cloud product contracts: PASS (Free/Pro, flag, executable gate, lifecycle, recovery, idempotency, hosted guards, ownership, target rejection, safe DTO and gateway handoff)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
