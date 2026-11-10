#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Real Saved Lab UI to BYO VM product campaign. */
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const webpack = require("webpack");
const byo = require("../phase16a2a/loadByoRunner");
const { issueRealProductPackage } = require("../phase16a2b1/productPackageFixture");
const foundation = require("../phase16a2b1/runRealVmE2E");
const engineering = require("./vmEngineeringDispatcher");
const { learnerSavedLab } = require("../../../lib/web-lab/generated-executable-lab.ts");
const { MyVmProductService } = require("../../../lib/web-lab/byo-runner/product-service.ts");
const { createMyVmProductApi } = require("../../../lib/web-lab/byo-runner/product-api.ts");
const { SIGNAL, gradeInstance } = require("../phase5/trustedObserver");
const { resolveBrowserExecutable } = require("../browserDiscovery");

const ROOT = path.resolve(__dirname, "../../..");
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const PAYLOAD = `<img src=x onerror="console.info('${SIGNAL}')">`;
const MAX_BODY_BYTES = byo.BYO_RELAY_MAX_REQUEST_BODY_BYTES + 1_024;
const SSH_AUTHORIZATION_MARKER = "amniora-phase16b-product-e2e";
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function eventWait(emitter, event, predicate = () => true, timeoutMs = 30_000) {
  let rejectWait;
  let resolveWait;
  let settled = false;
  let timer;
  const receive = value => {
    if (!predicate(value) || settled) return;
    settled = true;
    clearTimeout(timer);
    emitter.off(event, receive);
    resolveWait(value);
  };
  const promise = new Promise((resolve, reject) => {
    resolveWait = resolve;
    rejectWait = reject;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      emitter.off(event, receive);
      reject(new Error(`timeout_waiting_for_${event}`));
    }, timeoutMs);
    emitter.on(event, receive);
  });
  void promise.catch(() => undefined);
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      emitter.off(event, receive);
      rejectWait(new Error(`cancelled_waiting_for_${event}`));
    },
  };
}

async function operateThenWait(waiter, operation) {
  try {
    await operation();
    return await waiter.promise;
  } catch (error) {
    waiter.cancel();
    throw error;
  }
}

function json(data, status = 200) {
  return Response.json({ data, error: null }, { status, headers: { "Cache-Control": "no-store" } });
}

async function incomingBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("phase16b_product_input_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function webServer(handler, tls) {
  let origin;
  const listener = async (request, response) => {
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
  };
  const server = tls ? https.createServer(tls, listener) : http.createServer(listener);
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
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({ hostname: "127.0.0.1", port: target.port, method: options.method || "GET",
      path: pathname, headers, rejectUnauthorized: false }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.once("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

async function compileProductUi(output, product) {
  const build = path.join(output, "saved-lab-ui");
  fs.mkdirSync(build, { recursive: true });
  const replacement = (matcher, replacement) => new webpack.NormalModuleReplacementPlugin(matcher, resource => {
    resource.request = replacement;
  });
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "production", devtool: false, context: ROOT, target: "web",
      entry: path.join(__dirname, "browserProductEntry.jsx"),
      output: { path: build, filename: "product.js" },
      resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"], alias: {
        "@": ROOT,
        "next/navigation$": path.join(__dirname, "browserNextNavigation.jsx"),
        "next/link$": path.join(__dirname, "browserNextLink.jsx"),
      } },
      module: { rules: [{ test: /\.[jt]sx?$/, exclude: /node_modules/, use: path.join(__dirname, "../phase15b/fixtureTsLoader.cjs") }] },
      plugins: [
        replacement(/lib[\\/]supabase[\\/]client$/, path.join(__dirname, "browserSupabaseClient.js")),
        replacement(/app[\\/]lib[\\/]checkAchievements$/, path.join(__dirname, "browserCheckAchievements.js")),
        new webpack.DefinePlugin({ "process.env": JSON.stringify({ NODE_ENV: "production" }) }),
      ],
      optimization: { minimize: false }, performance: { hints: false },
    });
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError) reject(error || closeError);
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true })));
      else resolve();
    }));
  });
  const cssPath = path.join(ROOT, "app", "globals.css");
  const css = await postcss([tailwind({ base: ROOT, optimize: true })])
    .process(fs.readFileSync(cssPath, "utf8"), { from: cssPath });
  fs.writeFileSync(path.join(build, "product.css"), css.css);
  const learnerRecord = learnerSavedLab(product.ownerId, product.expectedSpec);
  const lab = { ...Object.fromEntries(Object.entries(learnerRecord).filter(([key]) => key !== "user_id")), id: product.savedLabId };
  const bootstrap = JSON.stringify({ lab }).replace(/</g, "\\u003c");
  fs.writeFileSync(path.join(build, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved Lab · My VM E2E</title><link rel="stylesheet" href="/product.css"></head><body class="bg-[#0c1828]"><div id="root"></div><script>const fixture=${bootstrap};window.__phase16bLab=fixture.lab;</script><script src="/product.js"></script></body></html>`);
  return { build, lab };
}

function fixtureFile(build, pathname) {
  const name = { "/product.css": "product.css", "/product.js": "product.js" }[pathname];
  if (!name) return null;
  return new Response(fs.readFileSync(path.join(build, name)), { headers: {
    "Cache-Control": "no-store", "Content-Type": name.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
  } });
}

class CdpPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleEvents = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      }
      if (message.method === "Runtime.consoleAPICalled") this.consoleEvents.push(message.params);
    });
  }
  static async connect(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    const page = new CdpPage(socket);
    await page.send("Page.enable"); await page.send("Runtime.enable"); await page.send("Network.enable");
    return page;
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`browser_command_timeout_${method}`)); }, 20_000);
      this.pending.set(id, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`browser_evaluation_failed_${result.exceptionDetails.text}`);
    return result.result?.value;
  }
  async waitFor(expression, label, attempts = 160) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { if (await this.evaluate(expression)) return; } catch { /* navigation in progress */ }
      await wait(100);
    }
    const state = await this.evaluate("({url:location.href,body:document.body?.innerText?.slice(0,1200)})").catch(() => null);
    throw new Error(`browser_wait_failed_${label}: ${JSON.stringify(state)}`);
  }
  async navigate(url, ready = "document.readyState === 'complete'") {
    const result = await this.send("Page.navigate", { url });
    if (result.errorText) throw new Error(`browser_navigation_failed_${result.errorText}`);
    await this.waitFor(ready, "navigation");
  }
  async click(text, selector = "button,a") {
    const point = await this.evaluate(`(() => { const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(value => value.textContent.trim() === ${JSON.stringify(text)} && !value.disabled); if(!element)return null; element.scrollIntoView({block:'center',inline:'center'}); const rect=element.getBoundingClientRect(); return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}; })()`);
    assert.ok(point, `missing_clickable_${text}`);
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  close() { this.socket.close(); }
}

async function browserHarness(callback) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16b-product-browser-"));
  const child = spawn(resolveBrowserExecutable(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--ignore-certificate-errors",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" });
  let browserError;
  child.on("error", error => { browserError = error; });
  const pages = [];
  try {
    let port;
    for (let attempt = 0; attempt < 150 && !port; attempt++) {
      if (browserError) throw browserError;
      try { port = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch { await wait(100); }
    }
    if (!port) throw new Error("product_browser_debugger_unavailable");
    const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) })).json())
      .filter(target => target.type === "page" && target.webSocketDebuggerUrl);
    const initial = (await targets())[0];
    assert.ok(initial);
    const ui = await CdpPage.connect(initial.webSocketDebuggerUrl); pages.push(ui);
    const popup = async excluded => {
      for (let attempt = 0; attempt < 160; attempt++) {
        const target = (await targets()).find(value => !excluded.has(value.id) && value.url !== "about:blank");
        if (target) { const page = await CdpPage.connect(target.webSocketDebuggerUrl); pages.push(page); return { page, targetId: target.id }; }
        await wait(100);
      }
      throw new Error("product_open_lab_popup_unavailable");
    };
    return await callback({ ui, targets, popup });
  } finally {
    for (const page of pages) page.close();
    const exited = new Promise(resolve => {
      if (child.exitCode !== null || child.pid === undefined) return resolve();
      const timer = setTimeout(resolve, 5_000); child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    child.kill(); await exited;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function signalled(events) {
  return events.some(event => event.args?.some(argument => argument.value === SIGNAL));
}

async function submitReview(page, value) {
  return page.evaluate(`(() => { const field=document.getElementById('product-review'); field.value=${JSON.stringify(value)}; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return document.querySelector('.saved-note').textContent; })()`);
}

async function openFromProductUi(ui, browser, labOrigin, excludedIds) {
  await ui.click("Open Lab", "[data-my-vm-panel] button");
  const opened = await browser.popup(excludedIds);
  await opened.page.waitFor(`location.origin === ${JSON.stringify(labOrigin)} && document.readyState === 'complete' && !!document.getElementById('brand')`, "product_open_lab");
  assert.equal(await opened.page.evaluate("document.cookie"), "", "gateway cookie must be HttpOnly");
  return opened;
}

async function cleanupEngineeringAuthorization({ allowFailure = false } = {}) {
  const revoke = await engineering.revoke({ allowFailure: true, timeoutMs: 15_000 }).catch(() => ({ code: 1 }));
  const cleanup = await foundation.ssh(`set -eu
authorization="$HOME/.ssh/authorized_keys"
temporary="$HOME/.ssh/authorized_keys.phase16b-product-e2e"
if [ -f "$authorization" ]; then
  grep -v '${SSH_AUTHORIZATION_MARKER}$' "$authorization" >"$temporary" || true
  chmod 600 "$temporary"
  mv "$temporary" "$authorization"
  if grep -q '${SSH_AUTHORIZATION_MARKER}$' "$authorization"; then exit 45; fi
fi
`, { allowFailure, timeoutMs: 15_000 });
  if (cleanup.code !== 0) {
    if (allowFailure) return false;
    throw new Error("phase16b_engineering_authorization_cleanup_failed");
  }
  const keyPath = process.env.AMNIORA_VM_SSH_KEY;
  const denied = await foundation.run("ssh", [
    "-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=yes", "-p", "2222", "amniora@127.0.0.1", "true",
  ], { allowFailure: true, timeoutMs: 15_000 });
  if (denied.code === 0) {
    if (allowFailure) return false;
    throw new Error("phase16b_public_key_authorization_still_present");
  }
  if (revoke.code !== 0) {
    if (allowFailure) return false;
    throw new Error("phase16b_engineering_policy_revoke_failed");
  }
  return true;
}

async function main() {
  if (process.argv.includes("--compile-only")) {
    const compileTemporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16b-product-compile-"));
    const compileProduct = await issueRealProductPackage();
    try {
      const fixture = await compileProductUi(compileTemporary, compileProduct);
      assert.ok(fs.statSync(path.join(fixture.build, "product.js")).size > 0);
      assert.equal(fixture.lab.id, compileProduct.savedLabId);
      process.stdout.write("Phase 16B real Saved Lab UI compile: PASS\n");
    } finally {
      await compileProduct.cleanup();
      fs.rmSync(compileTemporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    return;
  }
  const sshKey = process.env.AMNIORA_VM_SSH_KEY;
  if (!sshKey || !path.isAbsolute(sshKey) || !fs.existsSync(sshKey)) throw new Error("AMNIORA_VM_SSH_KEY is required");
  await foundation.freePortAvailable(foundation.BROKER_PORT);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase16b-product-"));
  const product = await issueRealProductPackage();
  const tlsFixture = await foundation.generateCertificate(temporary);
  const [runnerArchive, nodeRelease, uiFixture] = await Promise.all([
    foundation.buildRunner(temporary), foundation.downloadNode(temporary), compileProductUi(temporary, product),
  ]);
  const broker = new byo.ByoRunnerBroker({
    tls: tlsFixture,
    identityStore: new byo.ByoBrokerIdentityStore(path.join(temporary, "broker-state")),
    host: "127.0.0.1", port: foundation.BROKER_PORT,
    heartbeatIntervalMs: 250, livenessTimeoutMs: 2_000, handshakeTimeoutMs: 5_000, commandTimeoutMs: 180_000,
  });
  let gateway;
  const relayedHeaderNames = [];
  const gatewayTrace = [];
  const gatewayServer = webServer(async request => {
    const response = await gateway.handle(request);
    gatewayTrace.push({ method: request.method, path: new URL(request.url).pathname, status: response.status });
    return response;
  }, { key: tlsFixture.key, cert: tlsFixture.cert });
  let appHandler;
  const appServer = webServer(request => appHandler(request), { key: tlsFixture.key, cert: tlsFixture.cert });
  const results = {
    ui: { enabled: false, enrollment: false, connected: false, starting: false, ready: false, openLab: false,
      reset: false, stop: false, offlineReconnect: false, vmReboot: false },
    runtime: { ubuntu: false, docker: false, storedXss: false, trustedGrading: false, trust: null, gradeOperations: 0 },
    security: { directExposureDenied: false, openProxyDenied: false, arbitraryTargetDenied: false,
      crossUserDenied: false, credentialLeakageDenied: false, staleSessionsDenied: false },
    recovery: { runnerRestart: false, vmReboot: false, duplicateRuntime: null },
    cleanup: { containers: false, networks: false, temporaryCredentials: false, browser: false, vmState: null },
  };
  let vmInstalled = false;
  let vmCleanupVerified = false;
  let accessRemoved = false;
  let campaignPassed = false;
  let runnerId = null;
  let runtimeStatus = null;
  let activeTarget = null;
  let operationState = null;
  let connectionPresentation = "offline";
  let relay;
  let productApi;
  let lastOperationFailure = "NONE";
  const safeRunnerKey = crypto.randomBytes(32).toString("base64url");
  const observedProductBodies = [];
  try {
    await broker.listen();
    vmInstalled = true;
    const inventory = await engineering.installRunnerArtifacts(
      temporary, runnerArchive, nodeRelease, tlsFixture, product.verificationConfig);
    assert.equal(inventory.architecture, "aarch64");
    assert.equal(inventory.docker_service, "active");
    results.runtime.ubuntu = /Ubuntu 24\.04/i.test(inventory.os);
    results.runtime.docker = true;

    const gatewayPort = await gatewayServer.listen();
    const appPort = await appServer.listen();
    const gatewayOrigin = `https://phase16b.labs.localhost:${gatewayPort}`;
    const appOrigin = `https://app.labs.localhost:${appPort}`;
    gatewayServer.setOrigin(gatewayOrigin);
    appServer.setOrigin(appOrigin);
    assert.equal(gatewayServer.server.address().address, "127.0.0.1");
    assert.equal(appServer.server.address().address, "127.0.0.1");

    const relayTransport = {
      runtimeStatus: input => broker.runtimeStatus(input),
      relayHttp: input => {
        relayedHeaderNames.push(...Object.keys(input.request.headers).map(value => value.toLowerCase()));
        return broker.relayHttp(input);
      },
    };
    relay = new byo.ByoVmBrowserRelay({
      transport: relayTransport,
      resolveRuntime: async runtimeId => activeTarget?.runtimeId === runtimeId ? activeTarget : null,
      sessionTtlMs: 120_000,
    });
    gateway = new byo.ByoVmBrowserGateway({ relay, gatewayOrigin, trustedAppOrigin: appOrigin });
    broker.on("disconnected", () => { connectionPresentation = "offline"; relay.clearSessions(); });
    broker.on("connected", status => { runnerId = status.runnerId; connectionPresentation = "connected"; });

    const backend = {
      async eligibility(ownerId, savedLabId) { return ownerId === product.ownerId && savedLabId === product.savedLabId; },
      async list(ownerId, savedLabId) {
        if (ownerId !== product.ownerId || savedLabId !== product.savedLabId || !runnerId) return [];
        const publicStatus = broker.status(runnerId);
        if (!publicStatus) return [];
        if (publicStatus.connected && !operationState) {
          try { runtimeStatus = await broker.runtimeStatus({ runnerId, ownerId: product.ownerId }); }
          catch { /* A disconnect between the safe status read and command remains an offline state. */ }
        }
        const latest = runtimeStatus || broker.lastRuntimeStatus(runnerId);
        return [{
          ownerId: product.ownerId, runnerKey: safeRunnerKey, displayName: "Amniora-BYO-Test",
          platform: "Linux", architecture: inventory.architecture, version: "16.0.0-e2e",
          state: publicStatus.connected ? "connected" : connectionPresentation,
          lastSeenAt: new Date(publicStatus.lastHeartbeatAt || publicStatus.lastConnectedAt).toISOString(),
          dockerAvailable: true, labState: operationState || latest?.state || "idle", generation: latest?.generation ?? null,
        }];
      },
      async issueEnrollment(ownerId) {
        if (ownerId !== product.ownerId) throw new Error("owner_mismatch");
        return broker.issueEnrollment(ownerId);
      },
      async launch({ ownerId, savedLabId, runnerKey, idempotencyKey }) {
        assert.equal(ownerId, product.ownerId); assert.equal(savedLabId, product.savedLabId); assert.equal(runnerKey, safeRunnerKey);
        operationState = "starting"; await wait(350);
        try {
          runtimeStatus = await broker.launch({ runnerId, ownerId, package: product.package, idempotencyKey });
          activeTarget = { ownerId, runnerId, runtimeId: runtimeStatus.runtimeId };
        } catch (error) {
          const code = typeof error?.code === "string" && /^[A-Z_]{3,64}$/.test(error.code) ? error.code : "UNAVAILABLE";
          lastOperationFailure = code;
          throw error;
        } finally { operationState = null; }
      },
      async reset({ ownerId, savedLabId, runnerKey, idempotencyKey }) {
        assert.equal(ownerId, product.ownerId); assert.equal(savedLabId, product.savedLabId); assert.equal(runnerKey, safeRunnerKey);
        operationState = "resetting"; await wait(350);
        try {
          runtimeStatus = await broker.reset({ runnerId, ownerId, runtimeId: runtimeStatus.runtimeId,
            buildFingerprint: runtimeStatus.buildFingerprint, generation: runtimeStatus.generation, idempotencyKey });
        } finally { operationState = null; }
      },
      async stop({ ownerId, savedLabId, runnerKey, idempotencyKey }) {
        assert.equal(ownerId, product.ownerId); assert.equal(savedLabId, product.savedLabId); assert.equal(runnerKey, safeRunnerKey);
        operationState = "stopping"; await wait(350);
        try {
          runtimeStatus = await broker.stop({ runnerId, ownerId, runtimeId: runtimeStatus.runtimeId,
            buildFingerprint: runtimeStatus.buildFingerprint, generation: runtimeStatus.generation, idempotencyKey });
        } finally { operationState = null; }
      },
      async open({ ownerId, savedLabId, runnerKey }) {
        assert.equal(ownerId, product.ownerId); assert.equal(savedLabId, product.savedLabId); assert.equal(runnerKey, safeRunnerKey);
        const launch = gateway.issueLaunch({ ownerId, runtimeId: runtimeStatus.runtimeId });
        return { action: launch.action, grant: launch.grant, expiresAt: new Date(launch.expiresAt).toISOString() };
      },
    };
    const service = new MyVmProductService(backend,
      `https://runner.labs.localhost:${foundation.BROKER_PORT}`, gatewayOrigin,
      { runnerVersion: "1.0.0", minimumCompatibleVersion: "1.0.0", protocolVersion: "1.0",
        installerUrl: "https://runner.portfolio.example.test/runner/installers/1.0.0/install.sh", installerSha256: "a".repeat(64),
        brokerEndpoint: `https://runner.labs.localhost:${foundation.BROKER_PORT}` });
    productApi = createMyVmProductApi({ enabled: true, origin: appOrigin,
      resolveActor: async request => request.headers.get("x-phase16b-actor") === "other"
        ? { userId: OTHER_OWNER, sessionId: "other-product-session" }
        : { userId: product.ownerId, sessionId: "real-product-session" }, service });

    appHandler = async request => {
      const url = new URL(request.url);
      if (request.headers.get("host") !== new URL(appOrigin).host) return new Response("Misdirected", { status: 421 });
      if (url.pathname === `/dashboard/saved/${product.savedLabId}` && request.method === "GET") {
        return new Response(fs.readFileSync(path.join(uiFixture.build, "index.html")), { headers: {
          "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "strict-origin",
        } });
      }
      const staticResponse = fixtureFile(uiFixture.build, url.pathname);
      if (staticResponse && request.method === "GET") return staticResponse;
      if (url.pathname === `/api/web-labs/my-vm/${product.savedLabId}`) {
        if (request.method === "POST") observedProductBodies.push(await request.clone().text());
        return productApi(request, product.savedLabId);
      }
      if (url.pathname === `/api/web-labs/local-runner/${product.savedLabId}` && request.method === "GET") {
        return json({ enabled: false, eligible: false, build: null });
      }
      if (url.pathname === `/api/web-labs/cloud/${product.savedLabId}` && request.method === "GET") {
        return json({ enabled: false, eligible: false, plan: "free", availability: "service_disabled", runtime: null });
      }
      if (url.pathname === `/api/labs/${product.savedLabId}/feedback` && request.method === "GET") {
        return Response.json({ feedback: null }, { headers: { "Cache-Control": "no-store" } });
      }
      if (url.pathname === `/api/labs/${product.savedLabId}/complaints` && request.method === "GET") {
        return Response.json({ complaints: [] }, { headers: { "Cache-Control": "no-store" } });
      }
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    };

    await browserHarness(async browser => {
      const ui = browser.ui;
      const appUrl = `${appOrigin}/dashboard/saved/${product.savedLabId}`;
      await ui.navigate(appUrl);
      await ui.waitFor("!!document.querySelector('[data-saved-investigation-screen]') && document.body.innerText.includes('Run this lab')", "saved_lab_product_page");
      assert.equal(await ui.evaluate("document.body.innerText.includes('Web Security') && document.body.innerText.includes('Beginner') && document.body.innerText.includes('30 mins')"), true);
      await ui.waitFor("[...document.querySelectorAll('button')].some(value => value.textContent.trim()==='My VM' && !value.disabled)", "my_vm_enabled");
      assert.equal(await ui.evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(value=>value.textContent.trim()==='My VM'); return button && !button.disabled && !button.parentElement.innerText.includes('Coming soon'); })()`), true);
      results.ui.enabled = true;

      await ui.click("My VM");
      await ui.waitFor("document.body.innerText.includes('Connect your VM')", "no_vm_connected");
      await ui.click("Connect VM", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Waiting for your VM') && !!document.getElementById('vm-enrollment-command')", "enrollment_waiting");
      const command = await ui.evaluate("document.getElementById('vm-enrollment-command').value");
      assert.doesNotMatch(command, /password|private.?key|root password|cloud.?credential|ssh /i);
      const tokenMatch = command.match(/printf '%s\\n' '([A-Za-z0-9_-]{43})'/);
      assert.ok(tokenMatch, "product enrollment command did not contain one intended capability");
      const enrollmentToken = tokenMatch[1];
      results.ui.enrollment = true;

      const firstConnected = eventWait(broker, "connected", value => value.ownerId === product.ownerId);
      const first = await operateThenWait(firstConnected, () => engineering.initialRunner(enrollmentToken));
      runnerId = first.runnerId;
      await foundation.waitFor(broker, "heartbeat", value => value?.runnerId === runnerId);
      await engineering.replayEnrollment(enrollmentToken);
      await ui.waitFor("document.body.innerText.includes('Runner online') && document.body.innerText.includes('Launch Lab')", "runner_connected");
      assert.equal((await ui.evaluate("document.body.innerText")).includes(enrollmentToken), false);
      results.ui.connected = true;

      const firstDisconnected = eventWait(broker, "disconnected", value => value.runnerId === runnerId);
      await operateThenWait(firstDisconnected, () => engineering.serviceStop());
      const durableConnected = eventWait(broker, "connected", value => value.runnerId === runnerId);
      assert.equal((await operateThenWait(durableConnected, () => engineering.serviceStart())).runnerId, runnerId);

      await ui.click("Launch Lab", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Starting Lab')", "starting_state");
      results.ui.starting = true;
      await ui.waitFor("(document.body.innerText.includes('Open Lab') && document.body.innerText.includes('Lab ready')) || document.body.innerText.includes('Unable to complete operation')", "launch_terminal_state", 1_800);
      assert.equal(await ui.evaluate("document.body.innerText.includes('Open Lab') && document.body.innerText.includes('Lab ready')"),
        true, `product_launch_failed_${lastOperationFailure}`);
      assert.equal(runtimeStatus.state, "ready");
      assert.equal(runtimeStatus.trustLevel, "byo_self_hosted");
      results.ui.ready = true;
      results.runtime.trust = runtimeStatus.trustLevel;
      const immutableFingerprint = runtimeStatus.buildFingerprint;
      const inspection = await engineering.inspectRuntime();
      foundation.assertDockerSecurity(inspection, runtimeStatus.runtimeId, runtimeStatus.generation);
      await engineering.checkOutbound();
      await engineering.assertNoLanExposure(inspection);
      results.security.directExposureDenied = true;

      const knownTargets = new Set((await browser.targets()).map(value => value.id));
      let challenge = await openFromProductUi(ui, browser, gatewayOrigin, knownTargets);
      knownTargets.add(challenge.targetId);
      results.ui.openLab = true;
      const productSource = await ui.evaluate("document.documentElement.outerHTML");
      assert.equal(productSource.includes(product.ownerId), false);
      assert.equal(productSource.includes(runtimeStatus.runtimeId), false);
      assert.equal(productSource.includes("internalSolution"), false);

      const target = product.expectedSpec.vulnerability.storedFlow.targetObjectId;
      await challenge.page.navigate(`${gatewayOrigin}/#/products/detail?id=${encodeURIComponent(target)}`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      assert.match(await submitReview(challenge.page, "A normal Phase 16B product review"), /Review saved/);
      await challenge.page.navigate(`${gatewayOrigin}/#/catalog`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      await challenge.page.send("Page.reload", { ignoreCache: true });
      await challenge.page.navigate(`${gatewayOrigin}/#/products/detail?id=${encodeURIComponent(target)}`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      assert.equal((await challenge.page.evaluate("document.querySelector('.reviews').textContent")).includes("A normal Phase 16B product review"), true);
      assert.match(await submitReview(challenge.page, PAYLOAD), /Review saved/);
      assert.equal(signalled(challenge.page.consoleEvents), false, "stored payload must not count as immediate reflection");
      await challenge.page.navigate(`${gatewayOrigin}/#/catalog`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      await challenge.page.send("Page.reload", { ignoreCache: true });
      await challenge.page.navigate(`${gatewayOrigin}/#/products/detail?id=${encodeURIComponent(target)}`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      await challenge.page.waitFor("!!document.querySelector('[data-review-body] img[onerror]')", "stored_xss_retrieval");
      for (let attempt = 0; attempt < 40 && !signalled(challenge.page.consoleEvents); attempt++) await wait(100);
      assert.equal(signalled(challenge.page.consoleEvents), true);
      results.runtime.storedXss = true;

      const previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
      try {
        for (let operation = 0; operation < 5; operation++) {
          const trusted = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
          const grade = await gradeInstance({ instanceId: `phase16b-product-grade-${operation}`, spec: product.expectedSpec,
            endpoint: gatewayOrigin, proxyAccessKey: null, cookieHeader: trusted.cookieHeader, ignoreCertificateErrors: true });
          assert.equal(grade.status, "pass");
          results.runtime.gradeOperations++;
        }
      } finally {
        if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
      }
      results.runtime.trustedGrading = true;

      await assert.rejects(gateway.createTrustedSession({ ownerId: OTHER_OWNER, runtimeId: runtimeStatus.runtimeId }),
        error => error?.code === "RELAY_OWNER_MISMATCH");
      results.security.crossUserDenied = true;
      const fixed = await gateway.createTrustedSession({ ownerId: product.ownerId, runtimeId: runtimeStatus.runtimeId });
      const proxyAttempt = await localRequest(gatewayOrigin, "/?target=http%3A%2F%2F169.254.169.254%2Flatest&port=22",
        { headers: { Cookie: fixed.cookieHeader } });
      assert.equal(proxyAttempt.status, 200);
      assert.match(proxyAttempt.body.toString("utf8"), /id="brand"/);
      assert.equal((await localRequest(gatewayOrigin, "/", { host: "169.254.169.254" })).status, 421);
      results.security.openProxyDenied = true;

      const apiRequest = (body, actor) => new Request(`${appOrigin}/api/web-labs/my-vm/${product.savedLabId}`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: appOrigin,
          ...(actor ? { "x-phase16b-actor": actor } : {}) }, body: JSON.stringify(body),
      });
      for (const extra of [{ host: "169.254.169.254" }, { port: 22 }, { url: "http://10.0.2.15" }, { protocol: "file:" }]) {
        assert.equal((await productApi(apiRequest({ action: "open", runnerKey: safeRunnerKey, ...extra }), product.savedLabId)).status, 400);
      }
      assert.equal((await productApi(apiRequest({ action: "launch", runnerKey: safeRunnerKey,
        idempotencyKey: "wrong-user-product-operation" }, "other"), product.savedLabId)).status, 404);
      results.security.arbitraryTargetDenied = true;

      const beforeGeneration = runtimeStatus.generation;
      await ui.click("Reset", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Reset lab?')", "reset_confirmation");
      await ui.click("Reset Lab", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Resetting')", "resetting_state");
      await ui.waitFor("document.body.innerText.includes('Open Lab') && document.body.innerText.includes('Lab ready')", "ready_after_reset", 1_800);
      assert.equal(runtimeStatus.generation, beforeGeneration + 1);
      assert.equal(runtimeStatus.buildFingerprint, immutableFingerprint);
      await challenge.page.send("Page.reload", { ignoreCache: true });
      await challenge.page.waitFor("document.body.innerText.includes('RELAY_GENERATION_STALE')", "stale_generation_denied");
      let resetChallenge = await openFromProductUi(ui, browser, gatewayOrigin, knownTargets);
      knownTargets.add(resetChallenge.targetId);
      await resetChallenge.page.navigate(`${gatewayOrigin}/#/products/detail?id=${encodeURIComponent(target)}`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      assert.equal((await resetChallenge.page.evaluate("document.querySelector('.reviews').textContent")).includes(SIGNAL), false);
      results.ui.reset = true;
      results.security.staleSessionsDenied = true;

      await ui.click("Stop", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Stopping')", "stopping_state");
      await ui.waitFor("document.body.innerText.includes('Launch Lab') && !document.body.innerText.includes('Open Lab')", "stopped_state", 1_800);
      await resetChallenge.page.send("Page.reload", { ignoreCache: true });
      await resetChallenge.page.waitFor("document.body.innerText.includes('RELAY_RUNTIME_NOT_READY')", "stopped_relay_denied");
      assert.deepEqual(await engineering.managedCounts(), { containers: 0, networks: 0 });
      assert.equal(broker.status(runnerId).connected, true);
      results.ui.stop = true;

      await ui.click("Launch Lab", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Starting Lab')", "restart_campaign_starting");
      await ui.waitFor("document.body.innerText.includes('Open Lab')", "restart_campaign_ready", 1_800);
      const recoveredRuntimeId = runtimeStatus.runtimeId;
      const recoveredGeneration = runtimeStatus.generation;
      const processSession = await openFromProductUi(ui, browser, gatewayOrigin, knownTargets);
      knownTargets.add(processSession.targetId);

      const processDisconnected = eventWait(broker, "disconnected", value => value.runnerId === runnerId);
      await operateThenWait(processDisconnected, () => engineering.serviceStop());
      connectionPresentation = "offline";
      await ui.click("Refresh Status", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Connection lost')", "process_offline");
      connectionPresentation = "reconnecting";
      await ui.click("Refresh Status", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Reconnect')", "process_reconnecting");
      const processConnected = eventWait(broker, "connected", value => value.runnerId === runnerId);
      assert.equal((await operateThenWait(processConnected, () => engineering.serviceStart())).runnerId, runnerId);
      await ui.waitFor("document.body.innerText.includes('Runner online') && document.body.innerText.includes('Open Lab')", "process_recovered", 1_000);
      runtimeStatus = await broker.runtimeStatus({ runnerId, ownerId: product.ownerId });
      assert.equal(runtimeStatus.runtimeId, recoveredRuntimeId);
      assert.equal(runtimeStatus.generation, recoveredGeneration);
      assert.deepEqual(await engineering.managedCounts(), { containers: 2, networks: 1 });
      await processSession.page.send("Page.reload", { ignoreCache: true });
      await processSession.page.waitFor("document.body.innerText.includes('RELAY_SESSION_INVALID')", "process_stale_session");
      results.ui.offlineReconnect = true;
      results.recovery.runnerRestart = true;

      const rebootSession = await openFromProductUi(ui, browser, gatewayOrigin, knownTargets);
      knownTargets.add(rebootSession.targetId);
      const rebootDisconnected = eventWait(broker, "disconnected", value => value.runnerId === runnerId, 30_000);
      const rebootPromise = foundation.cleanVmReboot();
      try {
        await Promise.race([
          rebootDisconnected.promise,
          rebootPromise.then(() => new Promise(() => undefined)),
        ]);
      } catch (error) {
        rebootDisconnected.cancel();
        throw error;
      }
      connectionPresentation = "offline";
      await ui.click("Refresh Status", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Connection lost')", "vm_reboot_offline");
      connectionPresentation = "reconnecting";
      await ui.click("Refresh Status", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Reconnect')", "vm_reboot_reconnecting");
      const rebootConnected = eventWait(broker, "connected", value => value.runnerId === runnerId, 150_000);
      try {
        await rebootPromise;
        await foundation.waitForSsh();
        assert.equal((await rebootConnected.promise).runnerId, runnerId);
      } catch (error) {
        rebootConnected.cancel();
        throw error;
      }
      await ui.waitFor("document.body.innerText.includes('Runner online') && document.body.innerText.includes('Open Lab')", "vm_reboot_recovered", 1_500);
      runtimeStatus = await broker.runtimeStatus({ runnerId, ownerId: product.ownerId });
      assert.equal(runtimeStatus.runtimeId, recoveredRuntimeId);
      assert.equal(runtimeStatus.generation, recoveredGeneration);
      assert.deepEqual(await engineering.managedCounts(), { containers: 2, networks: 1 });
      await rebootSession.page.send("Page.reload", { ignoreCache: true });
      await rebootSession.page.waitFor("document.body.innerText.includes('RELAY_SESSION_INVALID')", "vm_reboot_stale_session");
      const afterReboot = await openFromProductUi(ui, browser, gatewayOrigin, knownTargets);
      knownTargets.add(afterReboot.targetId);
      await afterReboot.page.navigate(`${gatewayOrigin}/#/products/detail?id=${encodeURIComponent(target)}`, "document.readyState === 'complete' && !!document.getElementById('brand')");
      assert.equal((await afterReboot.page.evaluate("document.querySelector('.reviews').textContent")).includes(SIGNAL), false);
      results.ui.vmReboot = true;
      results.recovery.vmReboot = true;
      results.recovery.duplicateRuntime = false;

      await ui.click("Stop", "[data-my-vm-panel] button");
      await ui.waitFor("document.body.innerText.includes('Stopping')", "final_stopping");
      await ui.waitFor("document.body.innerText.includes('Launch Lab')", "final_stopped", 1_800);
      assert.deepEqual(await engineering.managedCounts(), { containers: 0, networks: 0 });
      const persisted = await ui.evaluate("JSON.stringify({local:{...localStorage},session:{...sessionStorage}})");
      assert.equal(persisted.includes(enrollmentToken), false);
      results.security.credentialLeakageDenied = true;
    });
    results.cleanup.browser = true;

    const forbiddenHeaders = new Set(["authorization", "cookie", "proxy-authorization", "x-amniora-control", "x-amniora-token"]);
    assert.equal(relayedHeaderNames.some(name => forbiddenHeaders.has(name)), false);
    assert.equal(observedProductBodies.some(body => /"(?:host|port|url|protocol|image|mounts?)"\s*:/i.test(body)), false);
    assert.equal(observedProductBodies.some(body => body.includes(product.ownerId) || body.includes(runnerId)), false);
    assert.ok(gatewayTrace.some(entry => entry.path === byo.BYO_BROWSER_GATEWAY_LAUNCH_PATH && entry.status === 303));

    await engineering.cleanup();
    vmInstalled = false;
    vmCleanupVerified = true;
    assert.deepEqual(await engineering.managedCounts().catch(() => ({ containers: 0, networks: 0 })), { containers: 0, networks: 0 });
    results.cleanup.containers = true;
    results.cleanup.networks = true;
    accessRemoved = await cleanupEngineeringAuthorization();
    results.cleanup.temporaryCredentials = accessRemoved;
    const vmInfo = await foundation.run("VBoxManage", ["showvminfo", foundation.VM, "--machinereadable"]);
    results.cleanup.vmState = /^VMState="running"$/m.test(vmInfo.stdout) ? "running" : "unexpected";
    campaignPassed = true;
    process.stdout.write(`${JSON.stringify({ phase: "16B real My VM product E2E", result: "PASS", ...results }, null, 2)}\n`);
  } finally {
    gateway?.clear();
    await Promise.allSettled([gatewayServer.close(), appServer.close()]);
    await broker.close().catch(() => undefined);
    if (vmInstalled) {
      const cleanup = await engineering.cleanup({ allowFailure: true }).catch(() => null);
      vmCleanupVerified = cleanup?.code === 0;
    }
    if (!accessRemoved) {
      accessRemoved = await cleanupEngineeringAuthorization({ allowFailure: true }).catch(() => false);
    }
    await product.cleanup();
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (!campaignPassed) {
      process.stderr.write(`${JSON.stringify({ phase: "16B failure cleanup", vmCleanupVerified,
        dispatcherRevokedAndPhaseKeyDenied: accessRemoved, localTemporaryRemoved: !fs.existsSync(temporary) })}\n`);
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
