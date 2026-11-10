#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Offline browser-contract harness using a scoped TypeScript loader. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { generateKeyPairSync } = require("node:crypto");
const sourceRoot = path.resolve(__dirname, "../../../lib/web-lab");
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(sourceRoot + path.sep)) throw new Error("Only Web lab sources may be transpiled");
  const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  module._compile(result.outputText, filename);
};
const runner = {
  ...require(path.join(sourceRoot, "ecommerce-planner.ts")),
  ...require(path.join(sourceRoot, "local-runner/package.ts")),
};
const browser = require(path.resolve(__dirname, "../../../lib/web-lab/local-runner/browser-client.ts"));

const CONTROL = "http://127.0.0.1:43127";
const SAVED_ID = "11111111-1111-4111-8111-111111111111";
const BUILD_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "a".repeat(32);
const IDEMPOTENCY = "phase15b-logical-operation-0001";
let assertions = 0;

function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions++;
}

function ok(condition, message) {
  assert.ok(condition, message);
  assertions++;
}

async function rejectsSafe(operation, expectedCode) {
  await assert.rejects(operation, error => {
    ok(error instanceof browser.RunnerBrowserError, "Expected a safe typed browser error");
    if (expectedCode) equal(error.code, expectedCode);
    ok(!/private-value|unsafe raw detail|password|STACK_TRACE/.test(error.message), "Never expose raw server/network details");
    return true;
  });
  assertions++;
}

function packageFixture() {
  // Ephemeral fixture-only key; never read environment, persisted keys, or live services.
  const { privateKey } = generateKeyPairSync("ed25519");
  return runner.createLocalRunnerPackage({
    buildId: BUILD_ID,
    ownerId: OWNER_ID,
    explicitExecutable: true,
    spec: runner.planBeginnerEcommerceStoredXssLab("phase15b-browser-contracts"),
  }, { userId: OWNER_ID }, { keyId: "phase15b-fixture-key", privateKey });
}

const pkg = packageFixture();
const build = { buildId: pkg.buildId, buildFingerprint: pkg.buildFingerprint, runtimeVersion: pkg.runtimeVersion };

function status(state = "ready", overrides = {}) {
  if (state === "idle") return {
    state, sessionId: null, buildId: null, buildFingerprint: null, generation: null,
    endpoint: null, createdAt: null, expiresAt: null, trustLevel: "local_self_hosted", ...overrides,
  };
  return {
    state, sessionId: SESSION_ID, buildId: build.buildId, buildFingerprint: build.buildFingerprint,
    generation: 1, endpoint: state === "ready" ? "http://127.0.0.1:49152" : null,
    createdAt: Date.now() - 1_000, expiresAt: Date.now() + 7_000_000,
    trustLevel: "local_self_hosted", ...overrides,
  };
}

function capabilities(overrides = {}) {
  return {
    runnerVersion: "15.0.0-alpha.1", protocolVersion: "1.0", platform: "darwin", architecture: "arm64",
    testedPlatform: true,
    docker: { commandAvailable: true, daemonReachable: true, serverVersion: "fixture" },
    supportedRuntimeVersions: ["web-lab-local-1"], activeLocalRuntimeState: "idle",
    protocolCompatibility: "compatible", outcome: "RUNNER_READY", ...overrides,
  };
}

function envelope(data, options = {}) {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200, headers: { "Content-Type": "application/json" }, ...options,
  });
}

async function withFetch(steps, operation) {
  const prior = global.fetch;
  const calls = [];
  let transportAssertion;
  global.fetch = async (url, options = {}) => {
    try {
    const call = { url: String(url), options, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const next = steps.shift();
    ok(next, `Unexpected request ${call.url}`);
    if (next.path) equal(call.url, next.path);
    if (call.url.startsWith(CONTROL)) {
      equal(options.credentials, "omit", "Do not send website credentials to the Runner");
      equal(options.redirect, "error", "Never follow loopback redirects");
      equal(options.cache, "no-store", "Never cache capabilities/status");
      ok(options.signal instanceof AbortSignal, "Every loopback operation must be bounded/cancellable");
      const headers = new Headers(options.headers);
      equal(headers.has("Authorization"), false);
      equal(headers.has("Cookie"), false);
      equal(headers.has("Origin"), false, "The browser must supply its real Origin");
    }
    if (next.method) equal(options.method || "GET", next.method);
    if (next.check) next.check(call);
    if (next.error) throw next.error;
    return typeof next.response === "function" ? next.response(call) : next.response;
    } catch (error) {
      // The adapter intentionally sanitizes transport errors. Do not let that hide harness failures.
      if (error instanceof assert.AssertionError) transportAssertion = error;
      throw error;
    }
  };
  try {
    const result = await operation(calls);
    if (transportAssertion) throw transportAssertion;
    equal(steps.length, 0, "Expected request sequence was not completed");
    return result;
  } finally {
    global.fetch = prior;
  }
}

function runnerStep(pathname, data, method = "GET", check) {
  return { path: CONTROL + pathname, response: envelope(data), method, check };
}

function authorizationStep(operation, check) {
  return runnerStep("/v1/authorize", {
    capability: "F".repeat(43), operation, expiresAt: Date.now() + 25_000,
  }, "POST", check);
}

async function endpointTests() {
  for (const endpoint of ["http://127.0.0.1:1024", "http://127.0.0.1:49152", "http://127.0.0.1:65535/"]) {
    ok(typeof browser.validateBrowserEndpoint(endpoint) === "string", endpoint);
  }
  for (const endpoint of [
    "https://example.com:49152", "http://192.168.1.10:49152", "http://localhost:49152",
    "http://[::1]:49152", "javascript:alert(1)", "data:text/html,hello", "file:///tmp/lab",
    "http://127.0.0.1", "http://127.0.0.1:80", "http://127.0.0.1:1023", "http://127.0.0.1:65536",
    "http://127.0.0.1:49152/task", "http://127.0.0.1:49152?", "http://127.0.0.1:49152#",
    "http://127.0.0.1:49152/?secret=x", "http://127.0.0.1:49152/#task",
    "http://user:pass@127.0.0.1:49152", "http://127.0.0.1.evil.example:49152",
    "http://127.1:49152", "http://2130706433:49152", "http://0x7f000001:49152",
    "http://0177.0.0.1:49152", "http://127.0.0.1:049152", "http://127.0.0.1:49152/.",
    "http://127.0.0.1:49152/a/..", "http://127.0.0.1:49152/%2e", " http://127.0.0.1:49152",
    "http://127.0.0.1:49152\n", "http://127.0.0.1:49152\\", null, {}, 49152,
  ]) {
    await rejectsSafe(Promise.resolve().then(() => browser.validateBrowserEndpoint(endpoint)), "INVALID_ENDPOINT");
  }
}

async function eligibilityTests() {
  for (const data of [
    { enabled: false, eligible: false, build: null },
    { enabled: true, eligible: false, build: null },
    { enabled: true, eligible: true, build },
  ]) {
    await withFetch([{ path: `/api/web-labs/local-runner/${SAVED_ID}`, response: envelope(data), check(call) {
      equal(call.options.credentials, "same-origin");
      equal(call.options.redirect, "error");
    } }], async calls => {
      equal(await browser.getEligibility(SAVED_ID), data);
      equal(calls.length, 1, "Eligibility never probes the Runner");
    });
  }
  for (const invalid of [
    { enabled: false, eligible: true, build },
    { enabled: true, eligible: true, build: null },
    { enabled: true, eligible: true, build: { ...build, runtimeVersion: "unknown" } },
    { enabled: true, eligible: true, build, internalSolution: "private-value" },
    { enabled: true, eligible: true, build: { ...build, ownerId: OWNER_ID } },
  ]) {
    await withFetch([{ path: `/api/web-labs/local-runner/${SAVED_ID}`, response: envelope(invalid) }], () =>
      rejectsSafe(browser.getEligibility(SAVED_ID), "INVALID_RESPONSE"));
  }
  for (const invalid of ["../../other", "http://evil.example/path", "a/b", "?x=1", "x#y"]) {
    await withFetch([], () => rejectsSafe(browser.getEligibility(invalid), "INVALID_REQUEST"));
  }
}

async function capabilityTests() {
  await withFetch([
    runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities()), runnerStep("/v1/status", status("idle")),
  ], async () => equal(await browser.detectRunner(build), status("idle")));
  // Protocol negotiation is authoritative; the UI must not invent a semver compatibility rule.
  await withFetch([
    runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities({ runnerVersion: "future-diagnostic-version" })),
    runnerStep("/v1/status", status("idle")),
  ], async () => equal(await browser.detectRunner(build), status("idle")));
  for (const override of [
    { protocolVersion: "99.0" }, { protocolCompatibility: "incompatible" },
    { protocolCompatibility: "not-requested" }, { supportedRuntimeVersions: ["unknown-runtime"] },
    { outcome: "DOCKER_UNAVAILABLE", docker: { commandAvailable: false, daemonReachable: false, serverVersion: null } },
    { outcome: "DOCKER_DAEMON_UNAVAILABLE", docker: { commandAvailable: true, daemonReachable: false, serverVersion: null } },
    { outcome: "UNSUPPORTED_PLATFORM", platform: "win32", architecture: "x64", testedPlatform: false },
    { outcome: "RUNNER_VERSION_UNSUPPORTED" },
  ]) {
    await withFetch([runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities(override))], () =>
      rejectsSafe(browser.detectRunner(build)));
  }
  await withFetch([{ path: CONTROL + "/v1/capabilities?protocolVersion=1.0", error: new TypeError("unsafe raw detail") }], () =>
    rejectsSafe(browser.detectRunner(build)));
}

async function statusTests() {
  for (const state of ["idle", "starting", "ready", "resetting", "stopping", "failed", "expired"]) {
    const value = status(state);
    await withFetch([runnerStep("/v1/status", value)], async () => equal(await browser.getRunnerStatus(build), value));
  }
  for (const override of [
    { endpoint: "https://evil.example" }, { endpoint: "http://192.168.1.8:49152" },
    { trustLevel: "hosted_verified" }, { state: "anything" }, { generation: -1 },
    { sessionId: "bad" }, { buildFingerprint: "not-a-fingerprint" },
    { canonicalSolution: "private-value" }, { errorCode: "unsafe raw detail" },
  ]) {
    await withFetch([runnerStep("/v1/status", status("ready", override))], () =>
      rejectsSafe(browser.getRunnerStatus(build)));
  }
  await withFetch([runnerStep("/v1/status", status("starting", { endpoint: "http://127.0.0.1:49152" }))], () =>
    rejectsSafe(browser.getRunnerStatus(build)));
  await withFetch([{ path: CONTROL + "/v1/status", response: new Response(JSON.stringify({
    data: null, error: { code: "LOCAL_RUNTIME_INCONSISTENT", message: "unsafe raw detail" },
  }), { status: 409 }) }], () => rejectsSafe(browser.getRunnerStatus(build)));
  await withFetch([runnerStep("/v1/status", status("ready", { buildId: "other-build-identity" }))], () =>
    rejectsSafe(browser.getRunnerStatus(build), "LOCAL_RUNTIME_ALREADY_ACTIVE"));
  await withFetch([runnerStep("/v1/status", status("ready", { buildFingerprint: "0".repeat(64) }))], () =>
    rejectsSafe(browser.getRunnerStatus(build), "BUILD_FINGERPRINT_MISMATCH"));
  const stale = status("ready", { createdAt: Date.now() - 100_000, expiresAt: Date.now() - 100 });
  await withFetch([runnerStep("/v1/status", stale)], async () =>
    equal(await browser.getRunnerStatus(build), { ...stale, state: "expired", endpoint: null }));
}

async function responseBoundaryTests() {
  for (const response of [
    new Response("<html>unsafe raw detail</html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ data: status(), error: null, internalSolution: "private-value" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    }),
    envelope(status(), { status: 302, headers: { Location: "https://evil.example", "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ data: null, error: { code: "unsafe raw detail" } }), {
      status: 409, headers: { "Content-Type": "application/json" },
    }),
    new Response(" ".repeat(600_001), { status: 200, headers: { "Content-Type": "application/json" } }),
  ]) {
    await withFetch([{ path: CONTROL + "/v1/status", response }], () => rejectsSafe(browser.getRunnerStatus(build)));
  }
  const redirected = envelope(status());
  Object.defineProperty(redirected, "redirected", { value: true });
  await withFetch([{ path: CONTROL + "/v1/status", response: redirected }], () =>
    rejectsSafe(browser.getRunnerStatus(build), "INVALID_RESPONSE"));
  let streamPulls = 0;
  let streamCancelled = false;
  const oversizedStream = new ReadableStream({
    pull(controller) {
      streamPulls++;
      // Multibyte data proves the cap is bytes, not string length. The full stream is never buffered.
      controller.enqueue(new TextEncoder().encode("€".repeat(66_667)));
    },
    cancel() { streamCancelled = true; },
  }, { highWaterMark: 0 });
  await withFetch([{ path: CONTROL + "/v1/status", response: new Response(oversizedStream, {
    headers: { "Content-Type": "application/json" },
  }) }], () => rejectsSafe(browser.getRunnerStatus(build), "INVALID_RESPONSE"));
  equal(streamPulls, 3, "Stop reading immediately after the byte cap is exceeded");
  equal(streamCancelled, true, "Cancel oversize body instead of consuming its remaining stream");
  for (const code of ["CAPABILITY_REPLAYED", "PACKAGE_SIGNATURE_INVALID", "LOCAL_RUNTIME_INCONSISTENT"]) {
    await withFetch([{ path: CONTROL + "/v1/status", response: new Response(JSON.stringify({ data: null, error: { code } }), {
      status: 409, headers: { "Content-Type": "application/json" },
    }) }], () => rejectsSafe(browser.getRunnerStatus(build), code));
  }
  const priorTimer = global.setTimeout;
  const delays = [];
  global.setTimeout = (callback, delay, ...args) => { delays.push(delay); return priorTimer(callback, 0, ...args); };
  try {
    await withFetch([{ path: CONTROL + "/v1/status", response: call => new Promise((resolve, reject) => {
      void resolve;
      call.options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }) }], () => rejectsSafe(browser.getRunnerStatus(build), "RUNNER_OFFLINE"));
    equal(delays, [5_000], "Status has one bounded timeout and no automatic retry loop");
  } finally { global.setTimeout = priorTimer; }
  const cancellation = new AbortController();
  cancellation.abort();
  await withFetch([{ path: CONTROL + "/v1/status", response: call => {
    equal(call.options.signal.aborted, true);
    throw new DOMException("unsafe raw detail", "AbortError");
  } }], () => rejectsSafe(browser.getRunnerStatus(build, cancellation.signal), "CANCELLED"));
}

async function lifecycleTests() {
  const ready = status();
  await withFetch([
    runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities()), runnerStep("/v1/status", status("idle")),
    { path: `/api/web-labs/local-runner/${SAVED_ID}/package`, method: "POST", response: envelope({ package: pkg }) },
    authorizationStep("launch", call => equal(call.body, {
      operation: "launch", buildId: build.buildId, buildFingerprint: build.buildFingerprint, idempotencyKey: IDEMPOTENCY,
    })),
    runnerStep("/v1/launch", ready, "POST", call => equal(call.body, { capability: "F".repeat(43), package: pkg })),
  ], async () => equal(await browser.launchLab(SAVED_ID, build, IDEMPOTENCY), ready));

  for (const operation of ["reset", "stop"]) {
    const result = operation === "reset" ? status("ready", { generation: 2, endpoint: "http://127.0.0.1:49153" }) : status("idle");
    await withFetch([
      authorizationStep(operation, call => equal(call.body, {
        operation, sessionId: SESSION_ID, buildFingerprint: build.buildFingerprint,
        generation: 1, idempotencyKey: IDEMPOTENCY,
      })),
      runnerStep(`/v1/${operation}`, result, "POST", call => equal(call.body, { capability: "F".repeat(43) })),
    ], async () => equal(await browser[`${operation}Lab`](build, ready, IDEMPOTENCY), result));
  }
  await withFetch([
    authorizationStep("reset"),
    { path: CONTROL + "/v1/reset", response: new Response("{not-json", {
      headers: { "Content-Type": "application/json" },
    }) },
  ], async calls => {
    await rejectsSafe(browser.resetLab(build, ready, IDEMPOTENCY), "INVALID_RESPONSE");
    equal(calls.length, 2, "Malformed mutation JSON is not a network failure and must not trigger status/replay");
  });
  // Two attempts at the same logical reset must request fresh capabilities while retaining scope/idempotency.
  const resetResult = status("ready", { generation: 2, endpoint: "http://127.0.0.1:49153" });
  for (const token of ["G".repeat(43), "H".repeat(43)]) {
    await withFetch([
      runnerStep("/v1/authorize", { capability: token, operation: "reset", expiresAt: Date.now() + 25_000 }, "POST", call => {
        equal(call.body.idempotencyKey, IDEMPOTENCY);
        equal(call.body.generation, 1);
      }),
      runnerStep("/v1/reset", resetResult, "POST", call => equal(call.body, { capability: token })),
    ], async () => {
      const result = await browser.resetLab(build, ready, IDEMPOTENCY);
      equal(result, resetResult);
      equal("capability" in result, false, "One-use capabilities are not returned with public UI state");
    });
  }
  // Reconnecting or re-activating a running lab cannot issue a second package/launch.
  await withFetch([
    runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities()), runnerStep("/v1/status", ready),
  ], async calls => {
    equal(await browser.launchLab(SAVED_ID, build, IDEMPOTENCY), ready);
    equal(calls.length, 2);
  });
  // A lost mutation response reads status once instead of replaying the capability/launch.
  await withFetch([
    runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities()), runnerStep("/v1/status", status("idle")),
    { path: `/api/web-labs/local-runner/${SAVED_ID}/package`, response: envelope({ package: pkg }) },
    authorizationStep("launch"),
    { path: CONTROL + "/v1/launch", error: new TypeError("unsafe raw detail") },
    runnerStep("/v1/status", ready),
  ], async calls => {
    equal(await browser.launchLab(SAVED_ID, build, IDEMPOTENCY), ready);
    equal(calls.filter(call => call.url.endsWith("/v1/launch")).length, 1);
    equal(calls.filter(call => call.url.endsWith("/v1/authorize")).length, 1);
  });
  for (const invalid of [
    { capability: "F".repeat(43), operation: "launch", expiresAt: Date.now() + 20_000 },
    { capability: "F".repeat(43), operation: "reset", expiresAt: Date.now() - 1 },
    { capability: "F".repeat(43), operation: "reset", expiresAt: Date.now() + 90_000 },
    { capability: "bad", operation: "reset", expiresAt: Date.now() + 20_000 },
    { capability: "F".repeat(43), operation: "reset", expiresAt: Date.now() + 20_000, token: "private-value" },
  ]) {
    await withFetch([runnerStep("/v1/authorize", invalid, "POST")], () =>
      rejectsSafe(browser.resetLab(build, ready, IDEMPOTENCY), "CAPABILITY_INVALID"));
  }
  for (const operation of ["reset", "stop"]) {
    await withFetch([], () => rejectsSafe(browser[`${operation}Lab`](build, status("idle"), IDEMPOTENCY)));
    await withFetch([], () => rejectsSafe(browser[`${operation}Lab`](build, ready, "short"), "INVALID_REQUEST"));
  }
}

async function packageBoundaryTests() {
  const mutations = [
    value => { value.command = "arbitrary"; },
    value => { value.internalSolution = "private-value"; },
    value => { value.providerReference = "private-value"; },
    value => { value.privateKey = "private-value"; },
    value => { value.manifest.internalSolution = "private-value"; },
    value => { value.bundle[0].hostPath = "private-value"; },
    value => { value.bundle.push({ path: "solution.json", content: "private-value", sha256: "a".repeat(64) }); },
    value => { value.bundle[0].path = "../../host"; },
    value => { value.buildFingerprint = "0".repeat(64); },
    value => { value.buildId = "some-other-build"; },
    value => { value.runtimeVersion = "unknown-runtime"; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(pkg);
    mutate(invalid);
    await withFetch([
      runnerStep("/v1/capabilities?protocolVersion=1.0", capabilities()), runnerStep("/v1/status", status("idle")),
      { path: `/api/web-labs/local-runner/${SAVED_ID}/package`, response: envelope({ package: invalid }) },
    ], calls => rejectsSafe(browser.launchLab(SAVED_ID, build, IDEMPOTENCY))
      .then(() => equal(calls.length, 3, "Unsafe package never reaches authorization/Runner")));
  }
}

async function main() {
  await endpointTests();
  await eligibilityTests();
  await capabilityTests();
  await statusTests();
  await responseBoundaryTests();
  await lifecycleTests();
  await packageBoundaryTests();
  console.log(`Phase 15B offline browser adapter contracts: PASS (${assertions} assertions; no real Runner, Docker, account, or provider calls)`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
