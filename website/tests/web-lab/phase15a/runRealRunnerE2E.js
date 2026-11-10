#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Real macOS/arm64 Docker and browser verification. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { generateKeyPairSync, randomUUID } = require("node:crypto");
const runner = require("./loadRunner");
const { browserSession, gradeInstance, SIGNAL } = require("../phase5/trustedObserver");

const execFileAsync = promisify(execFile);
const TEST_ORIGIN = "http://127.0.0.1:3000";
const PAYLOAD = `<img src=x onerror="console.info('${SIGNAL}')">`;
const metrics = {
  runnerStartupMs: 0, capabilitiesReadyMs: 0, challengeStartupMs: [], resetMs: 0, stopMs: [],
  observerAttempts: [], secondRunnerRejected: false, outboundContainmentConfirmed: false,
};

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function idempotency(prefix) { return `${prefix}-${randomUUID().replaceAll("-", "")}`; }

async function docker(...args) {
  return (await execFileAsync("docker", args, { maxBuffer: 2 * 1024 * 1024, timeout: 120_000 })).stdout.trim();
}

function issue(spec, privateKey, keyId) {
  const ownerId = randomUUID();
  return runner.createLocalRunnerPackage(
    { buildId: randomUUID(), ownerId, explicitExecutable: true, spec },
    { userId: ownerId },
    { keyId, privateKey },
    { lifetimeMs: 10 * 60_000 },
  );
}

function createEnvironment(directory, keys) {
  const backend = new runner.DockerLocalRunnerBackend(undefined, directory);
  const stateStore = new runner.LocalRunnerStateStore(directory);
  const core = new runner.LocalRunnerCore({ verificationKeys: keys, backend, stateStore, ttlMs: 15 * 60_000 });
  return { backend, stateStore, core };
}

async function api(controlOrigin, pathname, options = {}) {
  const response = await fetch(controlOrigin + pathname, {
    ...options,
    headers: { Origin: TEST_ORIGIN, ...(options.headers || {}) },
    signal: AbortSignal.timeout(130_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw Object.assign(new Error(body.error?.code || "runner_request_failed"), { code: body.error?.code });
  return body.data;
}

async function authorize(controlOrigin, scope) {
  return (await api(controlOrigin, "/v1/authorize", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scope),
  })).capability;
}

async function launch(controlOrigin, pkg, key) {
  const capability = await authorize(controlOrigin, {
    operation: "launch", buildId: pkg.buildId, buildFingerprint: pkg.buildFingerprint, idempotencyKey: key,
  });
  const start = process.hrtime.bigint();
  const status = await api(controlOrigin, "/v1/launch", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability, package: pkg }),
  });
  metrics.challengeStartupMs.push(elapsed(start));
  return status;
}

async function reset(controlOrigin, status, key) {
  const capability = await authorize(controlOrigin, {
    operation: "reset", sessionId: status.sessionId, buildFingerprint: status.buildFingerprint,
    generation: status.generation, idempotencyKey: key,
  });
  const start = process.hrtime.bigint();
  const result = await api(controlOrigin, "/v1/reset", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability }),
  });
  metrics.resetMs = elapsed(start);
  return result;
}

async function stop(controlOrigin, status, key) {
  const capability = await authorize(controlOrigin, {
    operation: "stop", sessionId: status.sessionId, buildFingerprint: status.buildFingerprint,
    generation: status.generation, idempotencyKey: key,
  });
  const start = process.hrtime.bigint();
  const result = await api(controlOrigin, "/v1/stop", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ capability }),
  });
  metrics.stopMs.push(elapsed(start));
  return result;
}

async function state(endpoint) {
  const response = await fetch(endpoint + "/__runtime/state", { signal: AbortSignal.timeout(2_000) });
  assert.equal(response.status, 200);
  return response.json();
}

function signalled(events) {
  return events.some(event => event.args?.some(argument => argument.value === SIGNAL));
}

async function submitReviewAndObserve(spec, endpoint) {
  const target = spec.vulnerability.storedFlow.targetObjectId;
  return browserSession(async browser => {
    await browser.navigate(`${endpoint}/#/products/detail?id=${encodeURIComponent(target)}`);
    const submit = value => browser.evaluate("(() => { const field=document.getElementById('product-review'); field.value=" +
      JSON.stringify(value) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); " +
      "return document.querySelector('.saved-note').textContent; })()");
    assert.match(await submit("A normal Phase 15A review"), /Review saved/);
    await browser.navigate(endpoint + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(`${endpoint}/#/products/detail?id=${encodeURIComponent(target)}`);
    assert.equal((await browser.evaluate("document.querySelector('.reviews').textContent")).includes("A normal Phase 15A review"), true);
    assert.match(await submit(PAYLOAD), /Review saved/);
    assert.equal(signalled(browser.consoleEvents), false);
    await browser.navigate(endpoint + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(`${endpoint}/#/products/detail?id=${encodeURIComponent(target)}`);
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(signalled(browser.consoleEvents), true);
    assert.equal(await browser.evaluate("!!document.querySelector('[data-review-body] img[onerror]')"), true);
  });
}

async function observerReliability(spec, endpoint) {
  let passes = 0;
  const failures = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    const start = process.hrtime.bigint();
    try {
      const result = await gradeInstance({
        instanceId: `phase15a-observer-${attempt}`,
        spec,
        endpoint,
        proxyAccessKey: null,
      });
      assert.equal(result.status, "pass");
      passes++;
      metrics.observerAttempts.push({ attempt, result: "pass", milliseconds: elapsed(start) });
    } catch (error) {
      failures.push({ attempt, code: error?.code || error?.message || "failure" });
      metrics.observerAttempts.push({ attempt, result: "fail", milliseconds: elapsed(start) });
      break;
    }
  }
  assert.deepEqual(failures, []);
  return { passes, failures: failures.length, gradingUnavailableReproduced: false };
}

async function assertSecondRunnerProcessRejected(controlOrigin) {
  const loader = path.join(__dirname, "loadRunner.js");
  const script = `
    const runner = require(${JSON.stringify(loader)});
    const server = new runner.LocalRunnerControlServer({
      core: {}, allowedOrigins: [${JSON.stringify(TEST_ORIGIN)}], port: Number(process.argv[1]),
    });
    server.listen().then(async () => {
      await server.close();
      process.stderr.write("unexpected_second_runner_bind\\n");
      process.exitCode = 2;
    }, error => {
      if (error?.code === "RUNNER_ALREADY_RUNNING") {
        process.stdout.write("RUNNER_ALREADY_RUNNING\\n");
        return;
      }
      process.stderr.write(String(error?.code || error?.message || error) + "\\n");
      process.exitCode = 1;
    });
  `;
  const result = await execFileAsync(process.execPath, ["-e", script, new URL(controlOrigin).port], {
    cwd: path.join(__dirname, "../../.."), timeout: 5_000,
  });
  assert.match(result.stdout, /RUNNER_ALREADY_RUNNING/);
  metrics.secondRunnerRejected = true;
}

async function reflectedSmoke(spec, endpoint) {
  await browserSession(async browser => {
    await browser.navigate(endpoint + "/#/articles");
    assert.equal(signalled(browser.consoleEvents), false);
    await browser.navigate(endpoint + "/#" + spec.vulnerability.route + "?" +
      encodeURIComponent(spec.vulnerability.input) + "=" + encodeURIComponent(PAYLOAD));
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(signalled(browser.consoleEvents), true);
  });
}

async function inspectIsolation(backend, status) {
  const resources = await backend.listManaged();
  const current = resources.filter(resource => resource.identity.sessionId === status.sessionId && resource.identity.generation === status.generation);
  assert.equal(current.length, 3);
  const challenge = current.find(resource => resource.role === "challenge");
  const proxy = current.find(resource => resource.role === "proxy");
  const network = current.find(resource => resource.role === "network");
  assert.ok(challenge && proxy && network);
  const host = challenge.detail.HostConfig;
  assert.equal(host.Privileged, false);
  assert.equal(host.PidMode, "");
  assert.equal(host.NetworkMode, network.detail.Name);
  assert.notEqual(host.NetworkMode, "host");
  assert.equal(host.ReadonlyRootfs, true);
  assert.ok(host.CapDrop.includes("ALL"));
  assert.ok(host.SecurityOpt.some(value => value.startsWith("no-new-privileges")));
  assert.equal(challenge.detail.Config.Image, runner.LOCAL_RUNNER_DOCKER_IMAGE);
  assert.equal(challenge.detail.Path, "docker-entrypoint.sh");
  assert.deepEqual(challenge.detail.Args, ["node", "/app/challenge-server.cjs"]);
  assert.equal(challenge.detail.NetworkSettings.Ports["8080/tcp"], null);
  assert.equal(proxy.detail.NetworkSettings.Ports["8080/tcp"][0].HostIp, "127.0.0.1");
  assert.equal(proxy.detail.HostConfig.Privileged, false);
  assert.equal(proxy.detail.HostConfig.PidMode, "");
  assert.notEqual(proxy.detail.HostConfig.NetworkMode, "host");
  assert.equal(proxy.detail.HostConfig.ReadonlyRootfs, true);
  assert.ok(proxy.detail.HostConfig.CapDrop.includes("ALL"));
  assert.ok(proxy.detail.HostConfig.SecurityOpt.some(value => value.startsWith("no-new-privileges")));
  assert.equal(proxy.detail.Config.Image, runner.LOCAL_RUNNER_DOCKER_IMAGE);
  assert.equal(proxy.detail.Path, "docker-entrypoint.sh");
  assert.deepEqual(proxy.detail.Args, ["node", "/app/ingress-proxy.cjs"]);
  assert.equal(proxy.detail.Mounts.length, 0);
  assert.equal(network.detail.Internal, true);
  assert.equal(challenge.detail.Mounts.length, 1);
  assert.equal(challenge.detail.Mounts[0].Destination, "/bundle");
  assert.equal(challenge.detail.Mounts[0].RW, false);
  assert.equal(challenge.detail.Mounts.some(mount => mount.Source.includes("docker.sock") || mount.Source.includes("CyberLab")), false);
  const labelText = JSON.stringify(challenge.detail.Config.Labels);
  for (const forbidden of ["signature", "capability", "email", "secret", "solution", "token"]) assert.equal(labelText.toLowerCase().includes(forbidden), false);
  const envNames = challenge.detail.Config.Env.map(value => value.split("=")[0]);
  for (const name of envNames) assert.ok(["PATH", "NODE_VERSION", "YARN_VERSION", "WEB_LAB_LOCAL_ONLY"].includes(name), name);
  assert.equal(await docker("exec", challenge.id, "id", "-u"), "1000");
  const outboundScript = "const n=require('node:net');const s=n.connect({host:'93.184.216.34',port:80});" +
    "s.on('connect',()=>process.exit(9));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),2000);";
  await docker("exec", challenge.id, "node", "-e", outboundScript);
  metrics.outboundContainmentConfirmed = true;
}

function assertPackageSafe(pkg, directory) {
  const serialized = JSON.stringify(pkg);
  for (const forbidden of ["internalSolution", "groundTruthTag", "service_role", "OPENAI_API_KEY", "STRIPE", "docker.sock"])
    assert.equal(serialized.includes(forbidden), false, `signed package leaked ${forbidden}`);
  const bundleRoot = path.join(directory, "bundles");
  if (!fs.existsSync(bundleRoot)) return;
  for (const relative of fs.readdirSync(bundleRoot, { recursive: true })) {
    const file = path.join(bundleRoot, relative);
    if (!fs.statSync(file).isFile()) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const forbidden of ["internalSolution", "groundTruthTag", "service_role", "OPENAI_API_KEY", "docker.sock"])
      assert.equal(content.includes(forbidden), false, `runtime bundle leaked ${forbidden}`);
  }
}

async function main() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase15a-real-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "phase15a-ephemeral-real";
  const keys = new Map([[keyId, publicKey]]);
  const deepSpec = runner.planBeginnerEcommerceStoredXssLab("phase15a-ecommerce-stored-deterministic");
  const smokeSpec = runner.planBeginnerHelpdeskLab("phase15a-helpdesk-reflected-deterministic");
  const deepPackage = issue(deepSpec, privateKey, keyId);
  const smokePackage = issue(smokeSpec, privateKey, keyId);
  const packageMetrics = {
    serializedPackageBytes: runner.serializedPackageBytes(deepPackage),
    runtimeBundleBytes: runner.serializedBundleBytes(deepPackage.bundle),
  };
  let environment = createEnvironment(directory, keys);
  let server = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [TEST_ORIGIN], port: 0 });
  let status;
  let controlOrigin;
  let reliability;
  try {
    const startup = process.hrtime.bigint();
    controlOrigin = await server.listen();
    metrics.runnerStartupMs = elapsed(startup);
    assert.match(controlOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
    await assertSecondRunnerProcessRejected(controlOrigin);
    const capabilitiesStart = process.hrtime.bigint();
    const capabilities = await api(controlOrigin, "/v1/capabilities?protocolVersion=1.0");
    metrics.capabilitiesReadyMs = elapsed(capabilitiesStart);
    assert.equal(capabilities.outcome, "RUNNER_READY");
    assert.equal(capabilities.platform, "darwin");
    assert.equal(capabilities.architecture, "arm64");

    status = await launch(controlOrigin, deepPackage, idempotency("deep-launch"));
    assert.equal(status.state, "ready");
    assert.equal(status.trustLevel, "local_self_hosted");
    assert.equal(runner.verifyLocalRunnerPackage(deepPackage, keys), deepPackage);
    assertPackageSafe(deepPackage, directory);
    await inspectIsolation(environment.backend, status);
    const initialState = await state(status.endpoint);
    await submitReviewAndObserve(deepSpec, status.endpoint);
    const mutated = await state(status.endpoint);
    const entries = mutated.contentByObject[deepSpec.vulnerability.storedFlow.targetObjectId];
    assert.equal(entries.at(-2).body, "A normal Phase 15A review");
    assert.equal(entries.at(-1).body, PAYLOAD);

    await server.close();
    environment = createEnvironment(directory, keys);
    const recovered = await environment.core.recover();
    assert.equal(recovered.state, "ready");
    assert.equal(recovered.sessionId, status.sessionId);
    assert.equal(recovered.endpoint, status.endpoint);
    assert.equal((await environment.backend.listManaged()).filter(resource =>
      resource.identity.sessionId === recovered.sessionId && resource.identity.generation === recovered.generation).length, 3);
    server = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [TEST_ORIGIN], port: 0 });
    controlOrigin = await server.listen();
    status = await api(controlOrigin, "/v1/status");
    assert.equal(status.state, "ready");
    assert.equal((await state(status.endpoint)).contentByObject[deepSpec.vulnerability.storedFlow.targetObjectId].at(-1).body, PAYLOAD);

    reliability = await observerReliability(deepSpec, status.endpoint);
    status = await reset(controlOrigin, status, idempotency("deep-reset"));
    assert.equal(status.generation, 2);
    assert.deepEqual(await state(status.endpoint), initialState);
    await inspectIsolation(environment.backend, status);
    status = await stop(controlOrigin, status, idempotency("deep-stop"));
    assert.equal(status.state, "idle");
    assert.equal((await environment.backend.listManaged()).length, 0);

    status = await launch(controlOrigin, smokePackage, idempotency("smoke-launch"));
    await reflectedSmoke(smokeSpec, status.endpoint);
    status = await stop(controlOrigin, status, idempotency("smoke-stop"));
    assert.equal(status.state, "idle");
    assert.equal((await environment.backend.listManaged()).length, 0);

    console.log(JSON.stringify({ package: packageMetrics, reliability, performance: metrics }, null, 2));
    console.log("Phase 15A real signed runner ecommerce/stored deep case + helpdesk/reflected smoke: PASS");
  } finally {
    try {
      if (server) await server.close();
      const current = await environment.core.status().catch(() => null);
      if (current?.sessionId && current?.buildFingerprint && current?.generation && current.state !== "idle") {
        await environment.backend.stop({ sessionId: current.sessionId, buildFingerprint: current.buildFingerprint, generation: current.generation });
      }
      for (const resource of await environment.backend.listManaged().catch(() => [])) {
        await environment.backend.stop(resource.identity).catch(() => undefined);
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
