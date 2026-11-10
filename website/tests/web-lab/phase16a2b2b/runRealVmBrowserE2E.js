#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Real Mac browser to BYO VM relay campaign. */
"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const byo = require("../phase16a2a/loadByoRunner");
const { issueRealProductPackage } = require("../phase16a2b1/productPackageFixture");
const foundation = require("../phase16a2b1/runRealVmE2E");
const { SIGNAL, browserSession, gradeInstance } = require("../phase5/trustedObserver");

const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const SSH_MARKER = "amniora-phase16a2b2b-temporary";
const APP_COOKIE = "amniora_phase16a2b2b_app";
const PAYLOAD = `<img src=x onerror="console.info('${SIGNAL}')">`;
const MAX_SERVER_BODY_BYTES = byo.BYO_RELAY_MAX_REQUEST_BODY_BYTES + 1_024;

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function cookieValue(header, name) {
  if (!header) return null;
  const values = header.split(";").map(value => value.trim()).filter(value => value.startsWith(name + "="));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

function signalled(events) {
  return events.some(event => event.args?.some(argument => argument.value === SIGNAL));
}

async function incomingBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_SERVER_BODY_BYTES) throw new Error("browser_gateway_input_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function webServer(handler) {
  let origin;
  const server = http.createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000 }, async (request, response) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
        else if (value !== undefined) headers.set(name, value);
      }
      const method = request.method || "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : await incomingBody(request);
      const webRequest = new Request(new URL(request.url || "/", origin), { method, headers, body });
      const webResponse = await handler(webRequest);
      const outgoing = {};
      webResponse.headers.forEach((value, name) => { outgoing[name] = value; });
      response.writeHead(webResponse.status, outgoing);
      response.end(method === "HEAD" ? undefined : Buffer.from(await webResponse.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
      response.end(error?.message || "server_error");
    }
  });
  return {
    server,
    setOrigin(value) { origin = value; },
    async listen() {
      await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
      return server.address().port;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

function localRequest(origin, pathname, options = {}) {
  const target = new URL(origin);
  const body = options.body === undefined ? null : Buffer.from(options.body);
  const headers = { Host: options.host || target.host, ...(options.headers || {}) };
  if (body && headers["Content-Length"] === undefined) headers["Content-Length"] = String(body.length);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      port: target.port,
      method: options.method || "GET",
      path: pathname,
      headers,
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function waitForBrowser(browser, expression, label, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (await browser.evaluate(expression)) return;
    } catch { /* cross-origin navigation is still committing */ }
    await wait(100);
  }
  const diagnostic = await browser.evaluate("({ href: location.href, title: document.title, body: document.body?.innerText?.slice(0, 500) })")
    .catch(error => ({ evaluationError: error?.message || String(error) }));
  throw new Error(`browser_timeout_${label}: ${JSON.stringify(diagnostic)}`);
}

async function establishBrowserSession(browser, appOrigin, labOrigin, appToken, ownerId, runtimeId) {
  await browser.send("Network.enable");
  const cookie = await browser.send("Network.setCookie", {
    name: APP_COOKIE,
    value: appToken,
    url: appOrigin + "/open",
    httpOnly: true,
    sameSite: "Strict",
  });
  assert.equal(cookie.result?.success, true, "browser rejected the app authentication cookie");
  await browser.navigate(appOrigin + "/open");
  const source = await browser.evaluate("document.documentElement.outerHTML");
  assert.equal(source.includes(ownerId), false, "launch page exposed owner identity");
  assert.equal(source.includes(runtimeId), false, "launch page exposed runtime identity");
  assert.equal(await browser.evaluate("document.cookie"), "", "HttpOnly app cookie became script-visible");
  assert.equal(await browser.evaluate("document.querySelector('form')?.method"), "post");
  assert.equal(await browser.evaluate("document.querySelector('form')?.action"),
    labOrigin + byo.BYO_BROWSER_GATEWAY_LAUNCH_PATH);
  await browser.evaluate("document.querySelector('form').submit()");
  await waitForBrowser(browser,
    `location.origin === ${JSON.stringify(labOrigin)} && document.readyState === 'complete' && !!document.getElementById('brand')`,
    "relay_launch");
  assert.equal(await browser.evaluate("document.cookie"), "", "gateway session cookie became script-visible");
}

async function learnerStoredXss(appOrigin, labOrigin, appToken, product, results) {
  const target = product.expectedSpec.vulnerability.storedFlow.targetObjectId;
  await browserSession(async browser => {
    await establishBrowserSession(browser, appOrigin, labOrigin, appToken, product.ownerId, results.runtimeId);
    await browser.navigate(`${labOrigin}/#/products/detail?id=${encodeURIComponent(target)}`);
    const submit = value => browser.evaluate("(() => { const field=document.getElementById('product-review'); field.value=" +
      JSON.stringify(value) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); " +
      "return document.querySelector('.saved-note').textContent; })()");
    assert.match(await submit("A normal Phase 16A.2B-2B review"), /Review saved/);
    await browser.navigate(labOrigin + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(`${labOrigin}/#/products/detail?id=${encodeURIComponent(target)}`);
    assert.equal((await browser.evaluate("document.querySelector('.reviews').textContent"))
      .includes("A normal Phase 16A.2B-2B review"), true);
    assert.match(await submit(PAYLOAD), /Review saved/);
    assert.equal(signalled(browser.consoleEvents), false, "stored payload executed during submission");
    await browser.navigate(labOrigin + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(`${labOrigin}/#/products/detail?id=${encodeURIComponent(target)}`);
    await waitForBrowser(browser, "!!document.querySelector('[data-review-body] img[onerror]')", "stored_xss_dom");
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) await wait(100);
    assert.equal(signalled(browser.consoleEvents), true, "stored payload did not execute after retrieval");
  });
  results.browserStoredXss = true;
}

async function browserReconnectCheck(appOrigin, labOrigin, appToken, product, runtimeId, expectStored) {
  const target = product.expectedSpec.vulnerability.storedFlow.targetObjectId;
  await browserSession(async browser => {
    await establishBrowserSession(browser, appOrigin, labOrigin, appToken, product.ownerId, runtimeId);
    await browser.navigate(`${labOrigin}/#/products/detail?id=${encodeURIComponent(target)}`);
    const reviewText = await browser.evaluate("document.querySelector('.reviews').textContent");
    assert.equal(reviewText.includes("A normal Phase 16A.2B-2B review"), expectStored);
    assert.equal(await browser.evaluate("!!document.querySelector('[data-review-body] img[onerror]')"), expectStored);
  });
}

async function cleanupAuthorization({ allowFailure = false } = {}) {
  const result = await foundation.ssh(`set -eu
sudo -n rm -f -- /etc/sudoers.d/amniora-phase16a2b2b
test ! -e /etc/sudoers.d/amniora-phase16a2b2b
authorization=/home/amniora/.ssh/authorized_keys
temporary=/home/amniora/.ssh/authorized_keys.phase16a2b2b
if [ -f "$authorization" ]; then
  grep -v '${SSH_MARKER}$' "$authorization" >"$temporary" || true
  chmod 600 "$temporary"
  mv "$temporary" "$authorization"
  if grep -q '${SSH_MARKER}$' "$authorization"; then exit 45; fi
fi
`, { allowFailure, timeoutMs: 15_000 });
  if (result.code !== 0 && !allowFailure) throw new Error("temporary_campaign_access_cleanup_failed");
  return result;
}

async function main() {
  const sshKey = process.env.AMNIORA_VM_SSH_KEY;
  if (!sshKey || !path.isAbsolute(sshKey) || !fs.existsSync(sshKey)) {
    throw new Error("AMNIORA_VM_SSH_KEY is required");
  }
  await foundation.freePortAvailable(foundation.BROKER_PORT);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16a2b2b-vm-"));
  const product = await issueRealProductPackage();
  const tlsFixture = await foundation.generateCertificate(temporary);
  const [runnerArchive, nodeRelease] = await Promise.all([
    foundation.buildRunner(temporary),
    foundation.downloadNode(temporary),
  ]);
  const broker = new byo.ByoRunnerBroker({
    tls: tlsFixture,
    identityStore: new byo.ByoBrokerIdentityStore(path.join(temporary, "broker-state")),
    host: "127.0.0.1",
    port: foundation.BROKER_PORT,
    heartbeatIntervalMs: 250,
    livenessTimeoutMs: 2_000,
    handshakeTimeoutMs: 5_000,
    commandTimeoutMs: 180_000,
  });
  let gateway;
  const gatewayTrace = [];
  const gatewayServer = webServer(async request => {
    const response = await gateway.handle(request);
    gatewayTrace.push({
      method: request.method,
      pathname: new URL(request.url).pathname,
      origin: request.headers.get("origin"),
      fetchSite: request.headers.get("sec-fetch-site"),
      status: response.status,
    });
    return response;
  });
  let appHandler;
  const appServer = webServer(request => appHandler(request));
  const results = {
    architecture: null,
    docker: null,
    runtimeId: null,
    trustLevel: null,
    macServersLoopbackOnly: false,
    vmRuntimeLoopbackOnly: false,
    browserStoredXss: false,
    trustedGrade: false,
    crossUserDenied: false,
    openProxyDenied: false,
    processReconnect: false,
    rebootReconnect: false,
    staleSessionDeniedAfterReset: false,
    stoppedSessionDenied: false,
    cleanupVerified: false,
    cleanup: false,
  };
  let vmInstalled = false;
  let accessRemoved = false;
  let runnerId;
  let runtimeStatus;
  let activeTarget;
  try {
    await broker.listen();
    vmInstalled = true;
    const inventory = await foundation.installRunnerArtifacts(
      temporary, runnerArchive, nodeRelease, tlsFixture, product.verificationConfig);
    results.architecture = inventory.architecture;
    results.docker = `${inventory.docker_service}; ${inventory.docker_client}`;
    assert.equal(inventory.architecture, "aarch64");
    assert.equal(inventory.docker_service, "active");

    const capability = broker.issueEnrollment(product.ownerId);
    const initialConnected = foundation.waitFor(broker, "connected", value => value.ownerId === product.ownerId);
    await foundation.startInitialRunner(capability.token);
    runnerId = (await initialConnected).runnerId;
    await foundation.waitFor(broker, "heartbeat", value => value?.runnerId === runnerId);
    const initialDisconnected = foundation.waitFor(broker, "disconnected", value => value.runnerId === runnerId);
    await foundation.ssh(`set -eu
sudo -n kill "$(cat "${foundation.GUEST_STAGE}/initial-runner.pid")"
`);
    await initialDisconnected;
    const serviceConnected = foundation.waitFor(broker, "connected", value => value.runnerId === runnerId);
    await foundation.ssh(`set -eu
sudo -n systemctl start "${foundation.SERVICE}"
`);
    await serviceConnected;

    runtimeStatus = await broker.launch({
      runnerId,
      ownerId: product.ownerId,
      package: product.package,
      idempotencyKey: "phase16a2b2b-real-browser-launch-0001",
    });
    assert.equal(runtimeStatus.state, "ready");
    assert.equal(runtimeStatus.trustLevel, "byo_self_hosted");
    results.runtimeId = runtimeStatus.runtimeId;
    results.trustLevel = runtimeStatus.trustLevel;
    activeTarget = { runtimeId: runtimeStatus.runtimeId, ownerId: product.ownerId, runnerId };

    const inspection = await foundation.inspectRuntime(runtimeStatus.runtimeId);
    const resources = foundation.assertDockerSecurity(inspection, runtimeStatus.runtimeId, runtimeStatus.generation);
    await foundation.assertOutboundBlocked(resources.challenge.Name.replace(/^\//, ""));
    await foundation.assertNoLanExposure(inspection.endpoint);
    results.vmRuntimeLoopbackOnly = true;

    const relay = new byo.ByoVmBrowserRelay({
      transport: broker,
      resolveRuntime: async runtimeId => activeTarget?.runtimeId === runtimeId ? activeTarget : null,
      sessionTtlMs: 120_000,
    });
    const gatewayPort = await gatewayServer.listen();
    const appPort = await appServer.listen();
    const labOrigin = `http://phase16a2b2b.labs.localhost:${gatewayPort}`;
    const appOrigin = `http://app.labs.localhost:${appPort}`;
    gatewayServer.setOrigin(labOrigin);
    appServer.setOrigin(appOrigin);
    gateway = new byo.ByoVmBrowserGateway({ relay, gatewayOrigin: labOrigin, trustedAppOrigin: appOrigin });
    const appToken = crypto.randomBytes(32).toString("base64url");
    appHandler = async request => {
      const url = new URL(request.url);
      if (request.headers.get("host") !== new URL(appOrigin).host || request.method !== "GET" ||
          url.pathname !== "/open" || url.search || cookieValue(request.headers.get("cookie"), APP_COOKIE) !== appToken) {
        return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const launch = gateway.issueLaunch({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
      const html = `<!doctype html><meta charset="utf-8"><title>Open BYO lab</title>
<div id="brand">Amniora</div><form method="post" action="${launch.action}">
<input type="hidden" name="grant" value="${launch.grant}"><button type="submit">Open lab</button></form>`;
      return new Response(html, { headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; form-action ${labOrigin}; base-uri 'none'; frame-ancestors 'none'`,
        "Referrer-Policy": "strict-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      } });
    };
    assert.deepEqual(gatewayServer.server.address().address, "127.0.0.1");
    assert.deepEqual(appServer.server.address().address, "127.0.0.1");
    results.macServersLoopbackOnly = true;

    const unauthenticated = await localRequest(labOrigin, "/");
    assert.equal(unauthenticated.status, 401);
    const wrongHost = await localRequest(labOrigin, "/", { host: "169.254.169.254" });
    assert.equal(wrongHost.status, 421);
    await assert.rejects(gateway.createTrustedSession({ ownerId: OTHER_OWNER, runtimeId: runtimeStatus.runtimeId }),
      error => error?.code === "RELAY_OWNER_MISMATCH");
    results.crossUserDenied = true;

    const fixedTarget = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
    const metadataAttempt = await localRequest(labOrigin, "/?target=http%3A%2F%2F169.254.169.254%2Flatest&port=22", {
      headers: { Cookie: fixedTarget.cookieHeader },
    });
    assert.equal(metadataAttempt.status, 200);
    assert.match(metadataAttempt.body.toString("utf8"), /id="brand"/);
    assert.equal(metadataAttempt.headers["access-control-allow-origin"], undefined);
    results.openProxyDenied = true;

    try {
      await learnerStoredXss(appOrigin, labOrigin, appToken, product, results);
    } catch (error) {
      throw new Error(`${error?.stack || error}\nGateway trace: ${JSON.stringify(gatewayTrace)}`);
    }
    const trusted = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
    const grade = await gradeInstance({
      instanceId: "phase16a2b2b-trusted-grade",
      spec: product.expectedSpec,
      endpoint: labOrigin,
      proxyAccessKey: null,
      cookieHeader: trusted.cookieHeader,
    });
    assert.equal(grade.status, "pass");
    results.trustedGrade = true;

    const restartDisconnected = foundation.waitFor(broker, "disconnected", value => value.runnerId === runnerId);
    const restartConnected = foundation.waitFor(broker, "connected",
      value => value.runnerId === runnerId && value.connectionCount >= 3, 60_000);
    await foundation.ssh(`set -eu
sudo -n systemctl restart "${foundation.SERVICE}"
`);
    await restartDisconnected;
    await restartConnected;
    await browserReconnectCheck(appOrigin, labOrigin, appToken, product, runtimeStatus.runtimeId, true);
    results.processReconnect = true;

    const rebootDisconnected = foundation.waitFor(broker, "disconnected", value => value.runnerId === runnerId, 30_000);
    const rebootConnected = foundation.waitFor(broker, "connected",
      value => value.runnerId === runnerId && value.connectionCount >= 4, 150_000);
    await foundation.cleanVmReboot();
    await rebootDisconnected;
    await foundation.waitForSsh();
    await rebootConnected;
    runtimeStatus = await broker.runtimeStatus({ runnerId, ownerId: product.ownerId });
    assert.equal(runtimeStatus.state, "ready");
    await browserReconnectCheck(appOrigin, labOrigin, appToken, product, runtimeStatus.runtimeId, false);
    results.rebootReconnect = true;

    const stale = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
    const resetInput = {
      runnerId,
      ownerId: product.ownerId,
      runtimeId: runtimeStatus.runtimeId,
      buildFingerprint: runtimeStatus.buildFingerprint,
      generation: runtimeStatus.generation,
      idempotencyKey: "phase16a2b2b-reset-idempotency-0001",
    };
    runtimeStatus = await broker.reset(resetInput);
    assert.equal(runtimeStatus.generation, 2);
    assert.equal((await broker.reset(resetInput)).generation, 2);
    const staleResponse = await localRequest(labOrigin, "/", { headers: { Cookie: stale.cookieHeader } });
    assert.equal(staleResponse.status, 409);
    assert.match(String(staleResponse.headers["set-cookie"]), /Max-Age=0/);
    const resetSession = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
    const resetState = await localRequest(labOrigin, "/__runtime/state", { headers: { Cookie: resetSession.cookieHeader } });
    assert.equal(resetState.status, 200);
    assert.equal(resetState.body.toString("utf8").includes(SIGNAL), false);
    results.staleSessionDeniedAfterReset = true;

    const stoppedSession = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
    const stopInput = {
      runnerId,
      ownerId: product.ownerId,
      runtimeId: runtimeStatus.runtimeId,
      buildFingerprint: runtimeStatus.buildFingerprint,
      generation: runtimeStatus.generation,
      idempotencyKey: "phase16a2b2b-stop-idempotency-00001",
    };
    assert.equal((await broker.stop(stopInput)).state, "idle");
    assert.equal((await broker.stop(stopInput)).state, "idle");
    const stoppedResponse = await localRequest(labOrigin, "/", { headers: { Cookie: stoppedSession.cookieHeader } });
    assert.equal(stoppedResponse.status, 410);
    assert.match(String(stoppedResponse.headers["set-cookie"]), /Max-Age=0/);
    assert.deepEqual(await foundation.managedCounts(), { containers: 0, networks: 0 });
    results.stoppedSessionDenied = true;

    await foundation.cleanupVm(false);
    await foundation.ssh(`set -eu
test ! -e "${foundation.INSTALL_ROOT}"
test ! -e "${foundation.STATE_ROOT}"
test ! -e "${foundation.GUEST_STAGE}"
test ! -e "/etc/systemd/system/${foundation.SERVICE}"
test "$(sudo -n docker container ls -aq --filter label=com.amniora.local-runner.managed=true | wc -l | tr -d ' ')" = 0
test "$(sudo -n docker network ls -q --filter label=com.amniora.local-runner.managed=true | wc -l | tr -d ' ')" = 0
`);
    results.cleanupVerified = true;
    await cleanupAuthorization();
    accessRemoved = true;
    vmInstalled = false;
    results.cleanup = true;
    process.stdout.write(`${JSON.stringify({ phase: "16A.2B-2B real browser relay", result: "PASS", runnerId, ...results }, null, 2)}\n`);
  } finally {
    gateway?.clear();
    await Promise.allSettled([gatewayServer.close(), appServer.close()]);
    await broker.close().catch(() => undefined);
    if (vmInstalled) await foundation.cleanupVm(false);
    if (!accessRemoved) await cleanupAuthorization({ allowFailure: true }).catch(() => undefined);
    await product.cleanup();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
