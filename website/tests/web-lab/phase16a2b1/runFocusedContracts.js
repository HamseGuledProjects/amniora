#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free BYO runtime contract harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const local = require("../phase15a/loadRunner");
const byo = require("../phase16a2a/loadByoRunner");

class FakeBackend {
  constructor() {
    this.runtimes = new Map();
    this.createCalls = 0;
    this.stopCalls = 0;
  }
  key(identity) { return `${identity.sessionId}:${identity.buildFingerprint}:${identity.generation}`; }
  async doctor() {
    return { commandAvailable: true, daemonReachable: true, serverVersion: "29.8.1", outcome: "RUNNER_READY" };
  }
  async create(_pkg, identity) {
    this.createCalls++;
    const value = { ...identity, endpoint: "http://127.0.0.1:45123", bundleDir: `/runtime/${this.key(identity)}` };
    this.runtimes.set(this.key(identity), value);
    return value;
  }
  async recover(identity) { return this.runtimes.get(this.key(identity)) || null; }
  async stop(identity) { this.stopCalls++; this.runtimes.delete(this.key(identity)); }
  async listManaged() { return []; }
}

function temporaryDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `amniora-${label}-`));
}

function certificateFixture(directory) {
  const keyPath = path.join(directory, "broker-key.pem");
  const certPath = path.join(directory, "broker-cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-subj", "/CN=amniora-byo-broker.test",
    "-addext", "subjectAltName=DNS:amniora-byo-broker.test,IP:127.0.0.1",
    "-keyout", keyPath, "-out", certPath,
  ], { stdio: "ignore" });
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function waitFor(emitter, event, predicate = () => true, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, receive);
      reject(new Error(`timeout_waiting_for_${event}`));
    }, timeoutMs);
    const receive = value => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.off(event, receive);
      resolve(value);
    };
    emitter.on(event, receive);
  });
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error?.code === code, code);
}

function fixture(now) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const ownerId = "owner_phase16a2b1_0001";
  const spec = local.planBeginnerEcommerceStoredXssLab("phase16a2b1-ecommerce-stored");
  const build = { buildId: randomUUID(), ownerId, explicitExecutable: true, spec };
  const authority = { keyId: "phase16a2b1-signing-key", privateKey };
  const pkg = local.createLocalRunnerPackage(build, { userId: ownerId }, authority, {
    now: () => now,
    lifetimeMs: 60 * 60_000,
  });
  return { ownerId, publicKey, pkg, keys: new Map([[authority.keyId, publicKey]]) };
}

function operations(directory, backend, keys, now) {
  const core = new local.LocalRunnerCore({
    verificationKeys: keys,
    backend,
    stateStore: new local.LocalRunnerStateStore(directory),
    now: () => now,
    platform: "linux",
    architecture: "arm64",
    supportedPlatforms: [{ platform: "linux", architecture: "arm64" }],
    recreateMissingRuntimeOnRecover: true,
  });
  return new byo.ByoRunnerRuntimeController(core);
}

function client(endpoint, cert, ownerId, identityDirectory, operationHandler, token) {
  return new byo.ByoRunnerClient({
    endpoint: { ...endpoint, serverName: "amniora-byo-broker.test", ca: cert },
    ownerId,
    identityStore: new byo.ByoRunnerIdentityStore(identityDirectory),
    operations: operationHandler,
    ...(token ? { enrollmentToken: token } : {}),
    reconnectDelayMs: 50,
    now: () => 1_800_000_000_000,
  });
}

function lifecycle(status, ownerId, runnerId, idempotencyKey) {
  return {
    runnerId,
    ownerId,
    runtimeId: status.runtimeId,
    buildFingerprint: status.buildFingerprint,
    generation: status.generation,
    idempotencyKey,
  };
}

async function main() {
  const root = temporaryDirectory("phase16a2b1");
  const cert = certificateFixture(root);
  const now = 1_800_000_000_000;
  const data = fixture(now);
  const backend = new FakeBackend();
  const runtimeDirectory = path.join(root, "runtime");
  const identityDirectory = path.join(root, "identity");
  const broker = new byo.ByoRunnerBroker({
    tls: cert,
    identityStore: new byo.ByoBrokerIdentityStore(path.join(root, "broker")),
    host: "127.0.0.1",
    port: await freePort(),
    heartbeatIntervalMs: 40,
    livenessTimeoutMs: 250,
    handshakeTimeoutMs: 500,
    commandTimeoutMs: 5_000,
  });
  let runner;
  try {
    const endpoint = await broker.listen();
    const capability = broker.issueEnrollment(data.ownerId);
    runner = client(endpoint, cert.cert, data.ownerId, identityDirectory,
      operations(runtimeDirectory, backend, data.keys, now), capability.token);
    const enrolled = await runner.start();
    const runnerId = enrolled.runnerId;
    assert.match(runnerId, /^rnr_/);

    await expectCode(broker.runtimeStatus({ runnerId, ownerId: "wrong_owner_0001" }), "OWNER_MISMATCH");
    await expectCode(broker.runtimeStatus({ runnerId: `rnr_${"A".repeat(43)}`, ownerId: data.ownerId }),
      "RUNNER_IDENTITY_NOT_FOUND");

    const tampered = structuredClone(data.pkg);
    tampered.bundle[0].content += "<!-- tampered -->";
    await expectCode(broker.launch({ runnerId, ownerId: data.ownerId, package: tampered,
      idempotencyKey: "tampered-launch-0001" }), "PACKAGE_SIGNATURE_INVALID");
    assert.equal(backend.createCalls, 0, "tampered package reached Docker backend");

    const unsupported = { ...data.pkg, runtimeVersion: "attacker-runtime" };
    await expectCode(broker.launch({ runnerId, ownerId: data.ownerId, package: unsupported,
      idempotencyKey: "version-launch-00001" }), "RUNTIME_VERSION_UNSUPPORTED");
    assert.equal(backend.createCalls, 0, "unsupported runtime reached Docker backend");

    for (const injection of [
      { image: "evil:latest" },
      { command: ["sh", "-c", "id"] },
      { hostMount: "/" },
    ]) {
      await expectCode(broker.launch({ runnerId, ownerId: data.ownerId, package: { ...data.pkg, ...injection },
        idempotencyKey: `negative-${Object.keys(injection)[0]}-0001` }), "PACKAGE_INVALID");
      assert.equal(backend.createCalls, 0, `${Object.keys(injection)[0]} reached Docker backend`);
    }

    const launchInput = { runnerId, ownerId: data.ownerId, package: data.pkg,
      idempotencyKey: "launch-idempotency-0001" };
    let status = await broker.launch(launchInput);
    assert.deepEqual(Object.keys(status).sort(), [
      "buildFingerprint", "expiresAt", "generation", "runnerId", "runtimeId", "state", "trustLevel",
    ]);
    assert.equal(status.state, "ready");
    assert.equal(status.trustLevel, "byo_self_hosted");
    assert.notEqual(status.trustLevel, "hosted_verified");
    assert.equal(status.buildFingerprint, data.pkg.buildFingerprint);
    assert.equal(backend.createCalls, 1);
    const launchedAgain = await broker.launch(launchInput);
    assert.equal(launchedAgain.runtimeId, status.runtimeId);
    assert.equal(backend.createCalls, 1, "launch replay created duplicate runtime");
    assert.deepEqual(await broker.runtimeStatus({ runnerId, ownerId: data.ownerId }), status);

    const resetInput = lifecycle(status, data.ownerId, runnerId, "reset-idempotency-0001");
    status = await broker.reset(resetInput);
    assert.equal(status.generation, 2);
    assert.equal(backend.createCalls, 2);
    const resetAgain = await broker.reset(resetInput);
    assert.equal(resetAgain.generation, 2);
    assert.equal(backend.createCalls, 2, "reset replay advanced generation twice");

    let disconnected = waitFor(broker, "disconnected", value => value.runnerId === runnerId);
    await runner.stop();
    await disconnected;
    const restarted = client(endpoint, cert.cert, data.ownerId, identityDirectory,
      operations(runtimeDirectory, backend, data.keys, now));
    runner = restarted;
    await restarted.start();
    const recovered = await broker.runtimeStatus({ runnerId, ownerId: data.ownerId });
    assert.equal(recovered.runtimeId, status.runtimeId);
    assert.equal(recovered.generation, status.generation);
    assert.equal(backend.createCalls, 2, "Runner restart duplicated Docker runtime");

    disconnected = waitFor(broker, "disconnected", value => value.runnerId === runnerId);
    await restarted.stop();
    await disconnected;
    backend.runtimes.clear();
    const rebooted = client(endpoint, cert.cert, data.ownerId, identityDirectory,
      operations(runtimeDirectory, backend, data.keys, now));
    runner = rebooted;
    await rebooted.start();
    status = await broker.runtimeStatus({ runnerId, ownerId: data.ownerId });
    assert.equal(status.runtimeId, recovered.runtimeId);
    assert.equal(status.generation, recovered.generation);
    assert.equal(backend.createCalls, 3, "reboot recovery did not recreate exactly one runtime");

    const stopInput = lifecycle(status, data.ownerId, runnerId, "stop-idempotency-0001");
    const stopped = await broker.stop(stopInput);
    assert.equal(stopped.state, "idle");
    const stoppedAgain = await broker.stop(stopInput);
    assert.equal(stoppedAgain.state, "idle");
    assert.equal(backend.runtimes.size, 0);
    assert.equal(broker.lastRuntimeStatus(runnerId).trustLevel, "byo_self_hosted");

    const protocolSource = ["protocol.ts", "broker.ts", "runner.ts", "runtime-controller.ts"].map(file =>
      fs.readFileSync(path.resolve(__dirname, `../../../lib/web-lab/byo-runner/${file}`), "utf8")).join("\n");
    for (const forbidden of ["dockerArgs", "hostPath", "portForward", "forwardTarget", "shellCommand"]) {
      assert.equal(protocolSource.includes(forbidden), false, `remote protocol exposed ${forbidden}`);
    }

    process.stdout.write("Phase 16A.2B-1 BYO signed-package lifecycle contracts: PASS\n");
  } finally {
    if (runner) await runner.stop().catch(() => undefined);
    await broker.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
