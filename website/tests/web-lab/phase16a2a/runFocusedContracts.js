#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free BYO transport contract harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const { execFileSync } = require("node:child_process");
const byo = require("./loadByoRunner");

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

function waitFor(emitter, event, timeoutMs = 3_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, done);
      reject(new Error(`timeout_waiting_for_${event}`));
    }, timeoutMs);
    const done = value => { clearTimeout(timer); resolve(value); };
    emitter.once(event, done);
  });
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error?.code === code, code);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function rawTlsMessage(endpoint, ca, message) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: endpoint.host,
      port: endpoint.port,
      servername: "amniora-byo-broker.test",
      ca,
      rejectUnauthorized: true,
      minVersion: "TLSv1.3",
    });
    let response = "";
    socket.once("secureConnect", () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on("data", chunk => {
      response += chunk.toString("utf8");
      const newline = response.indexOf("\n");
      if (newline !== -1) {
        socket.destroy();
        resolve(JSON.parse(response.slice(0, newline)));
      }
    });
    socket.once("error", reject);
  });
}

function clientOptions(endpoint, cert, ownerId, directory, enrollmentToken) {
  return {
    endpoint: { ...endpoint, serverName: "amniora-byo-broker.test", ca: cert },
    ownerId,
    identityStore: new byo.ByoRunnerIdentityStore(directory),
    ...(enrollmentToken ? { enrollmentToken } : {}),
    reconnectDelayMs: 50,
  };
}

async function enrollmentContracts() {
  let clock = 1_800_000_000_000;
  const store = new byo.ByoRunnerEnrollmentStore(() => clock, 1_000);
  const issued = store.issue("owner_enrollment_001");
  assert.equal(issued.expiresAt, clock + 1_000);
  assert.equal(JSON.stringify(store).includes(issued.token), false, "raw enrollment token retained by broker store");
  await expectCode(Promise.resolve().then(() => store.consume(issued.token, "wrong_owner_0001", issued.audience)), "OWNER_MISMATCH");
  assert.equal(store.consume(issued.token, issued.ownerId, issued.audience).ownerId, issued.ownerId);
  await expectCode(Promise.resolve().then(() => store.consume(issued.token, issued.ownerId, issued.audience)), "ENROLLMENT_REPLAYED");

  const wrongAudience = store.issue("owner_enrollment_002");
  await expectCode(Promise.resolve().then(() => store.consume(wrongAudience.token, wrongAudience.ownerId, "wrong-audience")), "AUDIENCE_MISMATCH");
  assert.equal(store.consume(wrongAudience.token, wrongAudience.ownerId, wrongAudience.audience).ownerId, wrongAudience.ownerId);

  const expired = store.issue("owner_enrollment_003");
  clock += 1_000;
  await expectCode(Promise.resolve().then(() => store.consume(expired.token, expired.ownerId, expired.audience)), "ENROLLMENT_EXPIRED");
}

async function transportContracts() {
  const root = temporaryDirectory("phase16a2a");
  const tlsFixture = certificateFixture(root);
  const identityStore = new byo.ByoBrokerIdentityStore(path.join(root, "broker-state"));
  const port = await freePort();
  const broker = new byo.ByoRunnerBroker({
    tls: tlsFixture,
    identityStore,
    host: "127.0.0.1",
    port,
    heartbeatIntervalMs: 40,
    livenessTimeoutMs: 140,
    handshakeTimeoutMs: 500,
  });
  let client;
  let restarted;
  let wrongOwner;
  let replay;
  try {
    const endpoint = await broker.listen();
    assert.deepEqual(endpoint, { host: "127.0.0.1", port });

    const ownerId = "owner_transport_0001";
    const capability = broker.issueEnrollment(ownerId);
    const runnerDirectory = path.join(root, "runner-state");
    client = new byo.ByoRunnerClient(clientOptions(endpoint, tlsFixture.cert, ownerId, runnerDirectory, capability.token));
    const heartbeat = waitFor(client, "heartbeat");
    const enrolled = await client.start();
    assert.equal(enrolled.connected, true);
    assert.match(enrolled.runnerId, /^rnr_[A-Za-z0-9_-]{43}$/);
    const runnerId = enrolled.runnerId;
    await heartbeat;
    assert.equal(broker.status(runnerId).connected, true);
    assert.equal(broker.status(runnerId).ownerId, ownerId);
    assert.equal(broker.status(runnerId).lastHeartbeatAt !== null, true);

    const runnerStatePath = path.join(runnerDirectory, "runner-identity.json");
    const brokerStatePath = path.join(root, "broker-state", "broker-identities.json");
    const runnerState = fs.readFileSync(runnerStatePath, "utf8");
    const brokerState = fs.readFileSync(brokerStatePath, "utf8");
    assert.equal(runnerState.includes(capability.token), false);
    assert.equal(brokerState.includes(capability.token), false);
    assert.equal(brokerState.includes("PRIVATE KEY"), false);
    assert.equal(fs.statSync(runnerStatePath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(runnerDirectory).mode & 0o777, 0o700);

    const disconnected = waitFor(broker, "disconnected");
    await client.stop();
    assert.equal((await disconnected).runnerId, runnerId);
    assert.equal(broker.status(runnerId).connected, false);

    await client.start();
    assert.equal(client.status().runnerId, runnerId);
    assert.equal(broker.status(runnerId).connectionCount, 2);
    await client.stop();

    restarted = new byo.ByoRunnerClient(clientOptions(endpoint, tlsFixture.cert, ownerId, runnerDirectory));
    await restarted.start();
    assert.equal(restarted.status().runnerId, runnerId);
    assert.equal(broker.status(runnerId).connectionCount, 3);

    clearInterval(restarted.heartbeatTimer);
    restarted.heartbeatTimer = null;
    const timedOut = waitFor(broker, "disconnected");
    assert.equal((await timedOut).runnerId, runnerId);
    assert.equal(broker.status(runnerId).connected, false);
    const reconnected = waitFor(restarted, "connected");
    assert.equal((await reconnected).runnerId, runnerId);
    assert.equal(broker.status(runnerId).connected, true);
    await restarted.stop();

    const ownerCapability = broker.issueEnrollment("owner_binding_0001");
    wrongOwner = new byo.ByoRunnerClient(clientOptions(
      endpoint, tlsFixture.cert, "wrong_owner_0001", path.join(root, "wrong-owner"), ownerCapability.token,
    ));
    await expectCode(wrongOwner.start(), "OWNER_MISMATCH");
    const correctAfterWrong = new byo.ByoRunnerClient(clientOptions(
      endpoint, tlsFixture.cert, ownerCapability.ownerId, path.join(root, "correct-owner"), ownerCapability.token,
    ));
    await correctAfterWrong.start();
    await correctAfterWrong.stop();

    replay = new byo.ByoRunnerClient(clientOptions(
      endpoint, tlsFixture.cert, ownerCapability.ownerId, path.join(root, "replay"), ownerCapability.token,
    ));
    await expectCode(replay.start(), "ENROLLMENT_REPLAYED");

    const response = await rawTlsMessage(endpoint, tlsFixture.cert, {
      type: "shell",
      protocolVersion: byo.BYO_RUNNER_PROTOCOL_VERSION,
      command: "id",
    });
    assert.deepEqual(response, {
      type: "error",
      protocolVersion: byo.BYO_RUNNER_PROTOCOL_VERSION,
      code: "PROTOCOL_MESSAGE_INVALID",
    });

    const untrusted = certificateFixture(temporaryDirectory("wrong-ca"));
    const rejected = new byo.ByoRunnerClient(clientOptions(
      endpoint, untrusted.cert, "owner_untrusted_0001", path.join(root, "untrusted"), broker.issueEnrollment("owner_untrusted_0001").token,
    ));
    await expectCode(rejected.start(), "CONNECTION_FAILED");

    const protocolSource = ["broker.ts", "runner.ts", "protocol.ts"].map(file =>
      fs.readFileSync(path.resolve(__dirname, `../../../lib/web-lab/byo-runner/${file}`), "utf8")).join("\n");
    for (const forbidden of ["child_process", "exec(", "spawn(", "docker run", "hostPath", "portForward", "forwardTarget"]) {
      assert.equal(protocolSource.includes(forbidden), false, `transport exposed ${forbidden}`);
    }
  } finally {
    for (const candidate of [client, restarted, wrongOwner, replay]) {
      if (candidate) await candidate.stop().catch(() => undefined);
    }
    await broker.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await enrollmentContracts();
  await transportContracts();
  process.stdout.write("Phase 16A.2A focused contracts: PASS\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
