#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Phase 4 viewer security contracts. */
"use strict";
const assert = require("node:assert/strict");
const phase4 = require("./loadPhase4");

const runtimeId = "4".repeat(32);
const buildFingerprint = "5".repeat(64);
const ready = (overrides = {}) => ({
  state: "ready", runtimeId, buildId: "phase4-viewer-build", buildFingerprint, generation: 7,
  ready: true, labType: "web-security", architecture: "arm64", ingressReady: true,
  startedAt: 1_700_000_000_000, errorCode: null, ...overrides,
});

function frame(overrides = {}) {
  return {
    type: "viewer-request", requestId: "vrq_1234567890abcdef", authority: `${runtimeId}-g7`,
    method: "GET", pathQuery: "/", headers: { accept: "text/html" }, bodyBase64: "", ...overrides,
  };
}

async function expectCode(action, code) {
  await assert.rejects(action, error => error?.code === code || error?.message === code, code);
}

async function main() {
  let status = ready();
  const relayed = [];
  const transport = {
    async runtimeStatus() { return status; },
    async relayHttp(input) {
      relayed.push(input);
      return { status: 200, headers: { "cache-control": "no-store", "content-type": "text/html" },
        bodyBase64: Buffer.from("<script>globalThis.xssExecuted=true</script>").toString("base64") };
    },
  };
  const session = await phase4.LocalFirstViewerSession.create(transport);
  assert.equal(session.binding.origin, `amniora-lab://${runtimeId}-g7`);
  const response = await session.relay(frame());
  assert.equal(response.status, 200);
  assert.match(Buffer.from(response.bodyBase64, "base64").toString("utf8"), /xssExecuted=true/,
    "the relay must preserve executable challenge content");
  assert.deepEqual(relayed[0], {
    runtimeId, buildFingerprint, generation: 7,
    request: { method: "GET", pathQuery: "/", headers: { accept: "text/html" }, bodyBase64: "" },
  });
  assert.equal("hostname" in relayed[0].request, false);
  assert.equal("port" in relayed[0].request, false);
  assert.equal("protocol" in relayed[0].request, false);

  for (const [bad, code] of [
    [frame({ authority: `${"6".repeat(32)}-g7` }), "VIEWER_REQUEST_INVALID"],
    [frame({ pathQuery: "http://127.0.0.1:80/" }), "RELAY_REQUEST_INVALID"],
    [frame({ pathQuery: "//169.254.169.254/latest/meta-data" }), "RELAY_REQUEST_INVALID"],
    [frame({ pathQuery: "/ok#http://example.com" }), "RELAY_REQUEST_INVALID"],
    [frame({ method: "CONNECT" }), "RELAY_METHOD_NOT_ALLOWED"],
    [frame({ headers: { host: "127.0.0.1", accept: "text/html" } }), "VIEWER_REQUEST_INVALID"],
    [frame({ bodyBase64: Buffer.alloc(65_537).toString("base64"), method: "POST",
      headers: { "content-type": "text/plain" } }), "VIEWER_REQUEST_INVALID"],
    [{ ...frame(), extra: true }, "VIEWER_REQUEST_INVALID"],
  ]) await expectCode(() => session.relay(bad), code);

  status = ready({ generation: 8 });
  await expectCode(() => session.relay(frame()), "VIEWER_GENERATION_STALE");
  assert.equal(await session.current(), false);
  status = ready({ state: "idle", runtimeId: null, buildId: null, buildFingerprint: null, generation: null,
    ready: false, labType: null, ingressReady: false, startedAt: null });
  await expectCode(() => session.relay(frame()), "VIEWER_GENERATION_STALE");

  const validRelay = {
    type: "REQUEST", protocolVersion: phase4.GUEST_PROTOCOL_VERSION,
    sessionId: `ses_${"a".repeat(43)}`, generation: 1, sequence: 1,
    requestId: `greq_${"b".repeat(43)}`, operation: "RELAY_HTTP", sentAt: Date.now(), input: {
      runtimeId, buildFingerprint, generation: 7,
      request: { method: "GET", pathQuery: "/", headers: {}, bodyBase64: "" },
    },
  };
  assert.equal(phase4.requireGuestRequest(validRelay, true).operation, "RELAY_HTTP");
  for (const mutation of [
    { input: { ...validRelay.input, host: "127.0.0.1" } },
    { input: { ...validRelay.input, request: { ...validRelay.input.request, pathQuery: "http://localhost/" } } },
    { input: { ...validRelay.input, request: { ...validRelay.input.request, port: 80 } } },
    { input: { ...validRelay.input, runtimeId: "7".repeat(32) } },
  ]) {
    const candidate = { ...validRelay, ...mutation };
    if (candidate.input.runtimeId === "7".repeat(32)) {
      assert.equal(phase4.requireGuestRequest(candidate, true).input.runtimeId, "7".repeat(32),
        "a syntactically valid other runtime is rejected by authoritative runtime state, not URL parsing");
    } else assert.throws(() => phase4.requireGuestRequest(candidate, true), /MESSAGE_INVALID/);
  }

  process.stdout.write("Local-first Phase 4 viewer contracts: PASS (generation origin, fixed relay, bounds, stale/stop fencing, XSS bytes preserved)\n");
}

main().catch(error => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
