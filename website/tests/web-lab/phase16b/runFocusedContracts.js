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
Module._load = function(request, parent, isMain) { if (request === "server-only") return {}; return originalLoad.call(this, request, parent, isMain); };
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(root + path.sep)) throw new Error("Only Web Lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  module._compile(result.outputText, filename);
};
const { MyVmProductService } = require(path.join(root, "byo-runner/product-service.ts"));
const { createMyVmProductApi } = require(path.join(root, "byo-runner/product-api.ts"));

const ORIGIN = "http://localhost:3000";
const LAB = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const actor = { userId: OWNER, sessionId: "session" };
const ENROLLMENT_TOKEN = "e".repeat(43);
const INSTALLER_RELEASE = { runnerVersion: "1.0.0", minimumCompatibleVersion: "1.0.0", protocolVersion: "1.0",
  installerUrl: "https://runner.portfolio.example.test/runner/installers/1.0.0/install.sh", installerSha256: "a".repeat(64),
  brokerEndpoint: "https://broker.amniora.example/connect" };
let state = "idle";
let openAction = "https://lab.amniora.example/__amniora/byo/launch";
const calls = [];
const row = ownerId => ({ ownerId, runnerKey: "safe-runner-key", displayName: "Ubuntu VM", platform: "Linux", architecture: "x64", version: "1.0.0", state: "connected", lastSeenAt: new Date().toISOString(), dockerAvailable: true, labState: state, generation: state === "ready" ? 2 : null, brokerCredential: "must-not-leak" });
const backend = {
  async eligibility(_owner, id) { return id === LAB; },
  async list(owner) { return [row(owner), { ...row(OTHER), runnerKey: "other-runner-key" }]; },
  async issueEnrollment(ownerId) { calls.push({ operation: "enroll", ownerId }); return { token: ENROLLMENT_TOKEN, expiresAt: Date.now() + 60_000 }; },
  async launch(input) { calls.push({ operation: "launch", ...input }); state = "starting"; },
  async reset(input) { calls.push({ operation: "reset", ...input }); state = "resetting"; },
  async stop(input) { calls.push({ operation: "stop", ...input }); state = "stopping"; },
  async disconnect(input) { calls.push({ operation: "disconnect", ...input }); },
  async open(input) { calls.push({ operation: "open", ...input }); return { action: openAction, grant: "g".repeat(43), expiresAt: new Date(Date.now() + 10_000).toISOString() }; },
};
const service = new MyVmProductService(backend, "https://broker.amniora.example/connect", "https://lab.amniora.example", INSTALLER_RELEASE);
const api = createMyVmProductApi({ enabled: true, origin: ORIGIN, resolveActor: async request => request.headers.get("authorization") === "other" ? { userId: OTHER, sessionId: "other" } : actor, service });
function request(method = "GET", body, headers = {}) { return new Request(`${ORIGIN}/api/web-labs/my-vm/${LAB}`, { method, headers: { ...(body ? { "content-type": "application/json", origin: ORIGIN } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
async function data(response) { return (await response.json()).data; }

async function main() {
  for (const plan of ["free", "pro"]) { // Plans never enter the contract: My VM is available to both.
    const snapshot = await data(await api(request(), LAB));
    assert.equal(snapshot.enabled, true, `${plan} available`); assert.equal(snapshot.runners.length, 1);
    assert.equal("ownerId" in snapshot.runners[0], false); assert.equal(JSON.stringify(snapshot).includes(OTHER), false);
    assert.equal(JSON.stringify(snapshot).includes("must-not-leak"), false);
  }
  const enrollment = await data(await api(request("POST", { action: "enroll" }), LAB));
  assert.match(enrollment.command, new RegExp(ENROLLMENT_TOKEN)); assert.doesNotMatch(enrollment.command, /password|private.?key|cloud.?credential/i);
  for (const action of ["launch", "reset", "stop", "disconnect"]) {
    const response = await api(request("POST", { action, runnerKey: "safe-runner-key", idempotencyKey: `phase16b-${action}` }), LAB);
    assert.equal(response.status, 202); assert.equal(calls.at(-1).ownerId, OWNER);
  }
  state = "ready";
  const open = await data(await api(request("POST", { action: "open", runnerKey: "safe-runner-key" }), LAB));
  assert.match(open.action, /^https:\/\/lab\.amniora\.example/); assert.equal(JSON.stringify(open).includes("10.0.2."), false); assert.equal("url" in open, false);
  openAction = "https://10.0.2.15/__amniora/byo/launch";
  assert.equal((await api(request("POST", { action: "open", runnerKey: "safe-runner-key" }), LAB)).status, 503,
    "backend cannot replace the configured relay with a raw VM address");
  openAction = "https://lab.amniora.example/__amniora/byo/launch";
  for (const extra of [{ host: "169.254.169.254" }, { port: 22 }, { url: "http://evil" }, { protocol: "file:" }]) {
    const response = await api(request("POST", { action: "open", runnerKey: "safe-runner-key", ...extra }), LAB); assert.equal(response.status, 400);
  }
  const wrong = await api(request("POST", { action: "launch", runnerKey: "safe-runner-key", idempotencyKey: "wrong-user" }, { authorization: "other" }), LAB);
  assert.equal(wrong.status, 202); assert.equal(calls.at(-1).ownerId, OTHER, "identity derives from authenticated actor, never body");
  const ownerInjection = await api(request("POST", { action: "launch", runnerKey: "safe-runner-key", idempotencyKey: "inject", ownerId: OWNER }), LAB);
  assert.equal(ownerInjection.status, 400);
  const crossUser = await api(request("POST", { action: "launch", runnerKey: "other-runner-key", idempotencyKey: "cross-user" }), LAB);
  assert.equal(crossUser.status, 404, "another user's Runner is denied");
  const staticLab = await service.snapshot(actor, "44444444-4444-4444-8444-444444444444"); assert.equal(staticLab.eligible, false); assert.deepEqual(staticLab.runners, []);
  const disabled = createMyVmProductApi({ enabled: false, origin: ORIGIN, resolveActor: async () => actor, service });
  assert.equal((await disabled(request(), LAB)).status, 404);
  const sources = ["app/dashboard/saved/[id]/SavedLabMyVm.tsx", "lib/web-lab/byo-runner/product-contract.ts"].map(file => fs.readFileSync(path.resolve(__dirname, "../../..", file), "utf8")).join("\n");
  assert.doesNotMatch(sources, /type=["']password|name=["'](?:ssh|root|cloud)/i);
  assert.doesNotMatch(sources, /10\.0\.2\.|192\.168\.|docker\.sock/);
  console.log("Phase 16B My VM product contracts: PASS (Free/Pro, enrollment, states, lifecycle, relay, ownership, target rejection, flag, static exclusion)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
