#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free local runner contract harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const runner = require("./loadRunner");

class FakeBackend {
  constructor() {
    this.doctorResult = { commandAvailable: true, daemonReachable: true, serverVersion: "test", outcome: "RUNNER_READY" };
    this.runtimes = new Map();
    this.createCalls = 0;
    this.stopCalls = 0;
    this.endpoint = "http://127.0.0.1:45678";
  }
  key(identity) { return `${identity.sessionId}:${identity.buildFingerprint}:${identity.generation}`; }
  async doctor() { return this.doctorResult; }
  async create(_pkg, identity) {
    this.createCalls++;
    const runtime = { ...identity, endpoint: this.endpoint, bundleDir: `/safe/${identity.sessionId}-${identity.generation}` };
    this.runtimes.set(this.key(identity), runtime);
    return runtime;
  }
  async recover(identity) { return this.runtimes.get(this.key(identity)) || null; }
  async stop(identity) { this.stopCalls++; this.runtimes.delete(this.key(identity)); }
  async listManaged() { return []; }
}

function temporaryDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amniora-${label}-`));
}

function fixture(now = 1_800_000_000_000, lifetimeMs = 300_000) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spec = runner.planBeginnerEcommerceStoredXssLab("phase15a-focused-contracts");
  const build = { buildId: randomUUID(), ownerId: randomUUID(), explicitExecutable: true, spec };
  const actor = { userId: build.ownerId };
  const authority = { keyId: "phase15a-test-key", privateKey };
  const pkg = runner.createLocalRunnerPackage(build, actor, authority, { now: () => now, lifetimeMs });
  return { privateKey, publicKey, spec, build, actor, authority, pkg, keys: new Map([[authority.keyId, publicKey]]) };
}

function makeCore({ data, backend = new FakeBackend(), now = () => 1_800_000_000_000, ttlMs = 60_000,
  platform = "darwin", architecture = "arm64", directory = temporaryDirectory("runner-state"), capabilityStore } = {}) {
  const stateStore = new runner.LocalRunnerStateStore(directory);
  const core = new runner.LocalRunnerCore({
    verificationKeys: data.keys, backend, stateStore, now, ttlMs, platform, architecture, capabilityStore,
  });
  return { core, backend, stateStore, directory };
}

function launchScope(pkg, key = "launch-idempotency-0001") {
  return { operation: "launch", buildId: pkg.buildId, buildFingerprint: pkg.buildFingerprint, idempotencyKey: key };
}

function lifecycleScope(operation, status, key) {
  return { operation, sessionId: status.sessionId, buildFingerprint: status.buildFingerprint,
    generation: status.generation, idempotencyKey: key };
}

async function authorized(core, scope) {
  return core.authorize(scope).capability;
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error?.code === code);
}

async function rawRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      host: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
      method: options.method || "GET", headers: options.headers || {}, timeout: 2_000,
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers,
        text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function contractTests() {
  const nowValue = 1_800_000_000_000;
  const data = fixture(nowValue);
  assert.equal(runner.serializedPackageBytes(data.pkg) > 0, true);
  assert.equal(runner.serializedBundleBytes(data.pkg.bundle) > 0, true);
  assert.deepEqual(data.pkg.bundle.map(file => file.path), ["index.html", "initial-state.json", "runtime-config.json"]);
  const serialized = JSON.stringify(data.pkg);
  for (const forbidden of ["internalSolution", "groundTruthTag", "service_role", "STRIPE", "OPENAI_API_KEY", "docker.sock"])
    assert.equal(serialized.includes(forbidden), false, `package leaked ${forbidden}`);
  assert.equal(runner.verifyLocalRunnerPackage(data.pkg, data.keys, { now: () => nowValue }), data.pkg);

  const tampered = structuredClone(data.pkg);
  tampered.bundle[0].content += "<!-- modified -->";
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage(tampered, data.keys, { now: () => nowValue })), "PACKAGE_SIGNATURE_INVALID");
  const invalidSignature = { ...data.pkg, signature: (data.pkg.signature[0] === "A" ? "B" : "A") + data.pkg.signature.slice(1) };
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage(invalidSignature, data.keys, { now: () => nowValue })), "PACKAGE_SIGNATURE_INVALID");
  const expired = fixture(nowValue, 1_000).pkg;
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage(expired, data.keys, { now: () => nowValue + 1_001 })), "PACKAGE_SIGNATURE_INVALID");
  const matchingExpired = runner.createLocalRunnerPackage(data.build, data.actor, data.authority, { now: () => nowValue, lifetimeMs: 1_000 });
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage(matchingExpired, data.keys, { now: () => nowValue + 1_001 })), "PACKAGE_EXPIRED");
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage({ ...data.pkg, packageVersion: 2 }, data.keys, { now: () => nowValue })), "PACKAGE_VERSION_UNSUPPORTED");
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage({ ...data.pkg, protocolVersion: "2.0" }, data.keys, { now: () => nowValue })), "PROTOCOL_VERSION_UNSUPPORTED");
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage({ ...data.pkg, runtimeVersion: "attacker-runtime" }, data.keys, { now: () => nowValue })), "RUNTIME_VERSION_UNSUPPORTED");
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage(data.pkg, data.keys, {
    now: () => nowValue, expectedBuildFingerprint: "0".repeat(64),
  })), "BUILD_FINGERPRINT_MISMATCH");
  await expectCode(Promise.resolve().then(() => runner.verifyLocalRunnerPackage({ ...data.pkg, arbitraryDockerImage: "evil:latest" }, data.keys, { now: () => nowValue })), "PACKAGE_INVALID");

  let clock = nowValue;
  const environment = makeCore({ data, now: () => clock });
  try {
    const capabilities = await environment.core.capabilities("1.0");
    assert.equal(capabilities.outcome, "RUNNER_READY");
    assert.equal(capabilities.testedPlatform, true);
    assert.equal(capabilities.protocolCompatibility, "compatible");
    assert.equal((await environment.core.capabilities("99.0")).protocolCompatibility, "incompatible");

    environment.backend.doctorResult = { commandAvailable: false, daemonReachable: false, serverVersion: null, outcome: "DOCKER_UNAVAILABLE" };
    await expectCode(environment.core.launch(await authorized(environment.core, launchScope(data.pkg, "docker-unavailable-01")), data.pkg), "DOCKER_UNAVAILABLE");
    environment.backend.doctorResult = { commandAvailable: true, daemonReachable: false, serverVersion: null, outcome: "DOCKER_DAEMON_UNAVAILABLE" };
    await expectCode(environment.core.launch(await authorized(environment.core, launchScope(data.pkg, "daemon-unavailable-01")), data.pkg), "DOCKER_DAEMON_UNAVAILABLE");
    environment.backend.doctorResult = { commandAvailable: true, daemonReachable: true, serverVersion: "test", outcome: "RUNNER_READY" };

    await expectCode(environment.core.launch("invalid", data.pkg), "CAPABILITY_INVALID");
    const launchKey = "launch-idempotency-0001";
    let status = await environment.core.launch(await authorized(environment.core, launchScope(data.pkg, launchKey)), data.pkg);
    assert.equal(status.state, "ready");
    assert.equal(status.trustLevel, "local_self_hosted");
    assert.match(status.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(environment.backend.createCalls, 1);
    const duplicate = await environment.core.launch(await authorized(environment.core, launchScope(data.pkg, launchKey)), data.pkg);
    assert.equal(duplicate.sessionId, status.sessionId);
    assert.equal(environment.backend.createCalls, 1);
    await expectCode(environment.core.launch(await authorized(environment.core, launchScope(data.pkg, "independent-launch-01")), data.pkg), "LOCAL_RUNTIME_ALREADY_ACTIVE");

    const replayCapability = await authorized(environment.core, lifecycleScope("reset", status, "reset-replay-test-01"));
    status = await environment.core.reset(replayCapability);
    assert.equal(status.generation, 2);
    await expectCode(environment.core.reset(replayCapability), "CAPABILITY_REPLAYED");
    const duplicateReset = await environment.core.reset(await authorized(environment.core, {
      operation: "reset", sessionId: status.sessionId, buildFingerprint: status.buildFingerprint,
      generation: 1, idempotencyKey: "reset-replay-test-01",
    }));
    assert.equal(duplicateReset.generation, 2);
    assert.equal(environment.backend.createCalls, 2);

    const replacement = new runner.LocalRunnerCore({
      verificationKeys: data.keys, backend: environment.backend, stateStore: environment.stateStore, now: () => clock, ttlMs: 60_000,
    });
    const recovered = await replacement.recover();
    assert.equal(recovered.state, "ready");
    assert.equal(recovered.sessionId, status.sessionId);
    assert.equal(environment.backend.createCalls, 2);

    const stopScope = lifecycleScope("stop", recovered, "stop-idempotency-001");
    const stopped = await replacement.stop(await authorized(replacement, stopScope));
    assert.equal(stopped.state, "idle");
    const stoppedAgain = await replacement.stop(await authorized(replacement, stopScope));
    assert.equal(stoppedAgain.state, "idle");
    assert.equal(environment.backend.runtimes.size, 0);
  } finally {
    fs.rmSync(environment.directory, { recursive: true, force: true });
  }

  const unsupported = makeCore({ data, platform: "linux", architecture: "arm64" });
  try {
    assert.equal((await unsupported.core.capabilities()).outcome, "UNSUPPORTED_PLATFORM");
    await expectCode(unsupported.core.launch(await authorized(unsupported.core, launchScope(data.pkg, "unsupported-platform-1")), data.pkg), "UNSUPPORTED_PLATFORM");
  } finally { fs.rmSync(unsupported.directory, { recursive: true, force: true }); }

  let expiryClock = nowValue;
  const ttl = makeCore({ data, now: () => expiryClock, ttlMs: 1_000 });
  try {
    await ttl.core.launch(await authorized(ttl.core, launchScope(data.pkg, "ttl-launch-key-0001")), data.pkg);
    expiryClock += 1_001;
    const expiredStatus = await ttl.core.status();
    assert.equal(expiredStatus.state, "expired");
    assert.equal(expiredStatus.errorCode, "LOCAL_RUNTIME_EXPIRED");
    assert.equal(ttl.backend.runtimes.size, 0);
  } finally { fs.rmSync(ttl.directory, { recursive: true, force: true }); }

  let capabilityClock = nowValue;
  const expiringStore = new runner.LocalRunnerCapabilityStore(() => capabilityClock, 100);
  const capabilityEnvironment = makeCore({ data, now: () => capabilityClock, capabilityStore: expiringStore });
  try {
    const token = await authorized(capabilityEnvironment.core, launchScope(data.pkg, "expired-capability-01"));
    capabilityClock += 101;
    await expectCode(capabilityEnvironment.core.launch(token, data.pkg), "CAPABILITY_EXPIRED");
  } finally { fs.rmSync(capabilityEnvironment.directory, { recursive: true, force: true }); }

  for (const endpoint of ["https://example.com:4000", "http://192.168.1.3:4000", "file:///tmp/a", "javascript:alert(1)", "data:text/plain,x", "http://127.0.0.1:80"])
    assert.equal(runner.isSafeLoopbackEndpoint(endpoint), false, endpoint);
  assert.equal(runner.isSafeLoopbackEndpoint("http://127.0.0.1:45000"), true);
}

async function serverTests() {
  const data = fixture();
  const environment = makeCore({ data });
  const allowedOrigin = "http://127.0.0.1:3000";
  const server = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [allowedOrigin], port: 0, bodyLimit: 512 * 1_024 });
  let second;
  try {
    const origin = await server.listen();
    assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const capabilities = await rawRequest(origin + "/v1/capabilities?protocolVersion=1.0", { headers: { Origin: allowedOrigin } });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.headers["access-control-allow-origin"], allowedOrigin);
    assert.notEqual(capabilities.headers["access-control-allow-origin"], "*");
    assert.equal(capabilities.headers["cache-control"], "no-store");

    for (const pathname of ["/v1/capabilities", "/v1/launch", "/v1/reset", "/v1/stop"]) {
      const isGet = pathname === "/v1/capabilities";
      const hostile = await rawRequest(origin + pathname, {
        method: isGet ? "GET" : "POST",
        headers: { Origin: "https://attacker.example", ...(isGet ? {} : { "Content-Type": "application/json" }) },
        ...(isGet ? {} : { body: "{}" }),
      });
      assert.equal(hostile.status, 403, pathname);
      assert.equal(hostile.headers["access-control-allow-origin"], undefined);
    }
    assert.equal((await rawRequest(origin + "/v1/capabilities")).status, 403);
    assert.equal((await rawRequest(origin + "/v1/capabilities", { headers: { Origin: allowedOrigin, Host: "evil.example" } })).status, 403);
    assert.equal((await rawRequest(origin + "/v1/capabilities", { method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "application/json" }, body: "{}" })).status, 405);
    assert.equal((await rawRequest(origin + "/v1/launch", { method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "text/plain" }, body: "{}" })).status, 415);
    assert.equal((await rawRequest(origin + "/v1/launch", { method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "application/json" }, body: "{" })).status, 400);
    assert.equal((await rawRequest(origin + "/v1/launch", { method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ large: "x".repeat(600_000) }) })).status, 413);

    for (const injection of [
      { image: "evil:latest" }, { dockerArgs: ["--privileged"] }, { hostPath: "/" }, { networkMode: "host" },
      { pidMode: "host" }, { environment: { SECRET: "x" } }, { publishedPort: 22 }, { url: "http://192.168.1.1" },
    ]) {
      const response = await rawRequest(origin + "/v1/launch", {
        method: "POST", headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
        body: JSON.stringify({ capability: "A".repeat(43), package: data.pkg, ...injection }),
      });
      assert.equal(response.status, 400, JSON.stringify(injection));
      assert.equal(environment.backend.createCalls, 0);
    }

    const boundPort = Number(new URL(origin).port);
    second = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [allowedOrigin], port: boundPort });
    await expectCode(second.listen(), "RUNNER_ALREADY_RUNNING");

    const lanAddress = Object.values(os.networkInterfaces()).flat().find(address =>
      address && address.family === "IPv4" && !address.internal && address.address !== "127.0.0.1")?.address;
    if (lanAddress) {
      await assert.rejects(new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: lanAddress, port: boundPort });
        socket.setTimeout(1_000);
        socket.once("connect", () => { socket.destroy(); resolve(); });
        socket.once("timeout", () => { socket.destroy(); reject(new Error("timeout")); });
        socket.once("error", reject);
      }));
    }
  } finally {
    if (second) await second.close();
    await server.close();
    fs.rmSync(environment.directory, { recursive: true, force: true });
  }
}

async function main() {
  await contractTests();
  await serverTests();
  console.log("Phase 15A local runner package, protocol, security, lifecycle, and recovery contracts: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
