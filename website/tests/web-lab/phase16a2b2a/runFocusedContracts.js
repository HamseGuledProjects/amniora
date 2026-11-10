#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free BYO relay contract harness. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const local = require("../phase15a/loadRunner");
const byo = require("../phase16a2a/loadByoRunner");

class FakeBackend {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.runtimes = new Map();
  }
  key(identity) { return `${identity.sessionId}:${identity.buildFingerprint}:${identity.generation}`; }
  async doctor() {
    return { commandAvailable: true, daemonReachable: true, serverVersion: "29.8.1", outcome: "RUNNER_READY" };
  }
  async create(_pkg, identity) {
    const value = { ...identity, endpoint: this.endpoint, bundleDir: `/runtime/${this.key(identity)}` };
    this.runtimes.set(this.key(identity), value);
    return value;
  }
  async recover(identity) { return this.runtimes.get(this.key(identity)) || null; }
  async stop(identity) { this.runtimes.delete(this.key(identity)); }
  async listManaged() { return []; }
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16a2b2a-"));
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

async function challengeFixture() {
  const requests = [];
  const server = http.createServer({ maxHeaderSize: 8192, requestTimeout: 10_000 }, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Internal-Challenge": "must-not-cross",
      "Set-Cookie": "challenge_secret=must-not-cross",
    });
    if (request.url === "/oversized-response") {
      response.end(Buffer.alloc(byo.BYO_RELAY_MAX_RESPONSE_BODY_BYTES + 1, 0x61));
      return;
    }
    response.end(`${request.method} ${request.url} ${body.toString("utf8")}`);
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function fixture(now) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const ownerId = "owner_phase16a2b2a_0001";
  const spec = local.planBeginnerEcommerceStoredXssLab("phase16a2b2a-ecommerce-stored");
  const build = { buildId: randomUUID(), ownerId, explicitExecutable: true, spec };
  const authority = { keyId: "phase16a2b2a-signing-key", privateKey };
  const pkg = local.createLocalRunnerPackage(build, { userId: ownerId }, authority, {
    now: () => now,
    lifetimeMs: 60 * 60_000,
  });
  return { ownerId, pkg, keys: new Map([[authority.keyId, publicKey]]) };
}

function operationHandler(directory, backend, keys, now) {
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

function runnerClient(endpoint, cert, ownerId, identityDirectory, operations, token) {
  return new byo.ByoRunnerClient({
    endpoint: { ...endpoint, serverName: "amniora-byo-broker.test", ca: cert },
    ownerId,
    identityStore: new byo.ByoRunnerIdentityStore(identityDirectory),
    operations,
    enrollmentToken: token,
    reconnectDelayMs: 50,
  });
}

function browserRequest(overrides = {}) {
  return {
    method: "GET",
    pathQuery: "/",
    headers: {},
    body: Buffer.alloc(0),
    ...overrides,
  };
}

function relayInput(session, ownerId, request = browserRequest()) {
  return { sessionToken: session.sessionToken, runtimeId: session.runtimeId, ownerId, request };
}

async function expectCode(operation, code) {
  await assert.rejects(operation, error => error?.code === code, code);
}

async function main() {
  const root = temporaryDirectory();
  const certificate = certificateFixture(root);
  const runtimeNow = 1_800_000_000_000;
  let relayNow = runtimeNow;
  const data = fixture(runtimeNow);
  const challenge = await challengeFixture();
  const backend = new FakeBackend(challenge.endpoint);
  const broker = new byo.ByoRunnerBroker({
    tls: certificate,
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
    const enrollment = broker.issueEnrollment(data.ownerId);
    runner = runnerClient(endpoint, certificate.cert, data.ownerId, path.join(root, "identity"),
      operationHandler(path.join(root, "runtime"), backend, data.keys, runtimeNow), enrollment.token);
    const runnerId = (await runner.start()).runnerId;
    const status = await broker.launch({
      runnerId,
      ownerId: data.ownerId,
      package: data.pkg,
      idempotencyKey: "relay-launch-idempotency-0001",
    });
    const targets = new Map([[status.runtimeId, { runtimeId: status.runtimeId, ownerId: data.ownerId, runnerId }]]);
    const relay = new byo.ByoVmBrowserRelay({
      transport: broker,
      resolveRuntime: async runtimeId => targets.get(runtimeId) ?? null,
      now: () => relayNow,
      sessionTtlMs: 2_000,
    });

    const session = await relay.createSession({ ownerId: data.ownerId, runtimeId: status.runtimeId });
    assert.deepEqual(Object.keys(session).sort(), ["expiresAt", "runtimeId", "sessionToken"]);

    const approvedPath = "/products?next=http%3A%2F%2F169.254.169.254%2Flatest&q=a%20b";
    const response = await relay.relay(relayInput(session, data.ownerId, browserRequest({
        pathQuery: approvedPath,
        headers: {
          Accept: "text/html",
          Cookie: "amniora_auth=must-not-cross; amniora_relay=must-not-cross",
          Authorization: "Bearer must-not-cross",
          Host: "169.254.169.254:80",
          Connection: "keep-alive",
          "Proxy-Authorization": "Basic must-not-cross",
          "X-Amniora-Broker-Credential": "must-not-cross",
          "X-Web-Lab-Proxy-Key": "must-not-cross",
        },
      })));
    assert.equal(response.status, 200);
    assert.equal(response.body.toString("utf8"), `GET ${approvedPath} `);
    assert.equal(response.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(response.headers["set-cookie"], undefined);
    assert.equal(response.headers["x-internal-challenge"], undefined);
    const observed = challenge.requests.at(-1);
    assert.equal(observed.url, approvedPath, "approved path/query changed");
    assert.equal(observed.headers.accept, "text/html");
    for (const stripped of [
      "cookie", "authorization", "proxy-authorization", "x-amniora-broker-credential", "x-web-lab-proxy-key",
    ]) assert.equal(observed.headers[stripped], undefined, `${stripped} reached challenge`);
    assert.equal(observed.headers.connection, "close", "browser hop-by-hop value reached challenge");
    assert.match(observed.headers.host, /^127\.0\.0\.1:\d+$/, "browser Host selected the upstream");

    const post = await relay.relay(relayInput(session, data.ownerId, browserRequest({
        method: "POST",
        pathQuery: "/submit?mode=stored",
        headers: { "Content-Type": "application/json", "Content-Length": "999999" },
        body: Buffer.from('{"message":"safe"}'),
      })));
    assert.equal(post.body.toString("utf8"), 'POST /submit?mode=stored {"message":"safe"}');
    assert.equal(challenge.requests.at(-1).headers["content-length"], "18", "body length was not recomputed");

    const put = await relay.relay(relayInput(session, data.ownerId, browserRequest({
        method: "PUT",
        pathQuery: "/__runtime/state",
        headers: { "Content-Type": "application/json" },
        body: Buffer.from('{"route":"products"}'),
      })));
    assert.equal(put.body.toString("utf8"), 'PUT /__runtime/state {"route":"products"}');

    const head = await relay.relay(relayInput(session, data.ownerId, browserRequest({ method: "HEAD" })));
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);

    await expectCode(relay.createSession({ ownerId: "wrong_owner_0001", runtimeId: status.runtimeId }), "RELAY_OWNER_MISMATCH");
    await expectCode(relay.relay(relayInput(session, "wrong_owner_0001")), "RELAY_OWNER_MISMATCH");

    targets.set(status.runtimeId, { ...targets.get(status.runtimeId), runnerId: `rnr_${"A".repeat(43)}` });
    await expectCode(relay.relay(relayInput(session, data.ownerId)), "RELAY_RUNNER_MISMATCH");
    targets.set(status.runtimeId, { runtimeId: status.runtimeId, ownerId: data.ownerId, runnerId });

    for (const extra of [{ host: "169.254.169.254" }, { port: 22 }, { url: "http://169.254.169.254/" }]) {
      await expectCode(relay.relay(relayInput(session, data.ownerId, { ...browserRequest(), ...extra })), "RELAY_REQUEST_INVALID");
    }
    await expectCode(relay.relay(relayInput(session, data.ownerId,
      browserRequest({ pathQuery: "http://169.254.169.254/latest" }))), "RELAY_REQUEST_INVALID");
    await expectCode(relay.relay(relayInput(session, data.ownerId,
      browserRequest({ method: "PATCH" }))), "RELAY_METHOD_NOT_ALLOWED");
    await expectCode(relay.relay(relayInput(session, data.ownerId,
      browserRequest({ headers: { "X-Oversized": "x".repeat(byo.BYO_RELAY_MAX_HEADER_BYTES) } }))),
    "RELAY_HEADERS_TOO_LARGE");
    await expectCode(relay.relay(relayInput(session, data.ownerId, browserRequest({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: Buffer.alloc(byo.BYO_RELAY_MAX_REQUEST_BODY_BYTES + 1),
      }))), "RELAY_BODY_TOO_LARGE");
    await expectCode(relay.relay(relayInput(session, data.ownerId,
      browserRequest({ pathQuery: "/oversized-response" }))), "RELAY_RESPONSE_TOO_LARGE");

    const reset = await broker.reset({
      runnerId,
      ownerId: data.ownerId,
      runtimeId: status.runtimeId,
      buildFingerprint: status.buildFingerprint,
      generation: status.generation,
      idempotencyKey: "relay-reset-idempotency-0001",
    });
    await expectCode(relay.relay(relayInput(session, data.ownerId)), "RELAY_GENERATION_STALE");

    const expiring = await relay.createSession({ ownerId: data.ownerId, runtimeId: reset.runtimeId });
    relayNow = expiring.expiresAt;
    await expectCode(relay.relay(relayInput(expiring, data.ownerId)), "RELAY_SESSION_EXPIRED");

    const stoppedSession = await relay.createSession({ ownerId: data.ownerId, runtimeId: reset.runtimeId });
    await broker.stop({
      runnerId,
      ownerId: data.ownerId,
      runtimeId: reset.runtimeId,
      buildFingerprint: reset.buildFingerprint,
      generation: reset.generation,
      idempotencyKey: "relay-stop-idempotency-00001",
    });
    await expectCode(relay.relay(relayInput(stoppedSession, data.ownerId)), "RELAY_RUNTIME_NOT_READY");
    targets.delete(reset.runtimeId);
    await expectCode(relay.relay(relayInput(stoppedSession, data.ownerId)), "RELAY_RUNTIME_NOT_FOUND");

    const source = ["protocol.ts", "broker.ts", "runner.ts", "runtime-controller.ts"].map(file =>
      fs.readFileSync(path.resolve(__dirname, `../../../lib/web-lab/byo-runner/${file}`), "utf8")).join("\n");
    for (const forbidden of ["arbitraryTcp", "tcpTunnel", "shellCommand", "portForward", "upstreamUrl"]) {
      assert.equal(source.includes(forbidden), false, `relay exposed ${forbidden}`);
    }
    assert.equal(challenge.requests.length, 5, "denied inputs reached the fixed challenge target");
    process.stdout.write("Phase 16A.2B-2A BYO VM browser relay contracts: PASS\n");
  } finally {
    if (runner) await runner.stop().catch(() => undefined);
    await broker.close().catch(() => undefined);
    await challenge.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
