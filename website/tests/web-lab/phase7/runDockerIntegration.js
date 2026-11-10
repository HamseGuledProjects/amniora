#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS Docker gateway verification. */
"use strict";
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
require("../phase5/loadWebLab");
const { planBeginnerEcommerceStoredXssLab, planBeginnerHelpdeskLab } = require("../phase5/loadWebLab");
const { LocalWebLabControlService } = require("../../../lib/web-lab/control-plane.ts");
const { LocalWebLabRuntimeManager, docker } = require("../phase5/runtimeManager");
const { browserSession, SIGNAL } = require("../phase5/trustedObserver");
const { localControlTrust } = require("../phase6/localTrust");
const { LocalWebLabGateway } = require("./localGateway");

const USER_A = "phase7-user-a";
const USER_B = "phase7-user-b";
const SESSION_A = "phase7-main-session-a";
const SESSION_B = "phase7-main-session-b";
const payload = `<img src=x onerror="console.info('${SIGNAL}')">`;

function sessionCookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  const [pair] = value.split(";");
  const index = pair.indexOf("=");
  return { name: pair.slice(0, index), value: pair.slice(index + 1) };
}

async function withLabBrowser(origin, route, cookie, callback) {
  return browserSession(async browser => {
    await browser.send("Network.enable");
    const set = await browser.send("Network.setCookie", {
      name: cookie.name, value: cookie.value, url: origin + route,
      httpOnly: true, sameSite: "Strict",
    });
    assert.equal(set.result?.success, true);
    return callback(browser);
  });
}

async function main() {
  const now = () => Date.now();
  const ttlMs = 180_000;
  const trust = localControlTrust(now);
  const manager = new LocalWebLabRuntimeManager({ now, ttlMs, gatewayOnly: true });
  const backend = {
    async create(spec) { return (await manager.create(spec)).instanceId; },
    async status(ref) { return (await manager.status(ref)).status; },
    async reset(ref) { await manager.reset(ref); },
    async destroy(ref) { await manager.destroy(ref); },
  };
  const grader = { async grade(ref) { return manager.grade(ref); } };
  const specA = planBeginnerEcommerceStoredXssLab("phase7-ecommerce-stored");
  const specB = planBeginnerHelpdeskLab("phase7-helpdesk-reflected");
  const labs = new Map([
    ["saved-a", { savedLabId: "saved-a", ownerId: USER_A, spec: specA }],
    ["saved-b", { savedLabId: "saved-b", ownerId: USER_B, spec: specB }],
  ]);
  const control = new LocalWebLabControlService({
    verifyCommand: trust.verify, savedLabs: { async find(id) { return labs.get(id) ?? null; } },
    backend, grader, now, ttlMs, grantMs: 30_000,
  });
  const mainSessions = new Map([
    [randomBytes(24).toString("base64url"), { ownerId: USER_A, sessionId: SESSION_A }],
    [randomBytes(24).toString("base64url"), { ownerId: USER_B, sessionId: SESSION_B }],
  ]);
  const [authA, authB] = mainSessions.keys();
  const gateway = new LocalWebLabGateway({
    control, now, sessionMs: 60_000,
    authenticateLearner: async request => mainSessions.get(request.headers["x-amniora-test-session"]) ?? null,
    resolveBackend: async ref => {
      const record = manager.getRecord(ref);
      return { origin: record.endpoint, proxyKey: record.proxyAccessKey };
    },
  });
  const command = (operation, owner, session, resource) => trust.sign(operation, owner, session, resource);
  let a;
  let b;
  try {
    await manager.buildImage();
    a = await control.create(command("create", USER_A, SESSION_A, "saved-a"));
    b = await control.create(command("create", USER_B, SESSION_B, "saved-b"));
    const records = [...manager.instances.values()];
    const recordA = records.find(record => record.spec.labId === specA.labId);
    const recordB = records.find(record => record.spec.labId === specB.labId);
    assert.ok(recordA && recordB);
    assert.equal((await fetch(recordA.endpoint)).status, 403, "knowing the localhost address is insufficient");
    assert.equal((await fetch(recordA.endpoint, { headers: { Cookie: "amniora_main=forged" } })).status, 403);
    const challengeEnv = JSON.parse(await docker("inspect", recordA.containerName))[0].Config.Env;
    assert.equal(challengeEnv.some(value => value.startsWith("WEB_LAB_PROXY_KEY=")), false);
    assert.equal(typeof recordA.proxyAccessKey, "string");

    const gatewayOrigin = await gateway.listen();
    const launch = (grant, auth) => fetch(gatewayOrigin + "/__gateway/launch", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Amniora-Test-Session": auth },
      body: JSON.stringify({ grant }),
    });
    assert.equal((await launch(a.launchGrant.token, authB)).status, 403);
    const launchA = await launch(a.launchGrant.token, authA);
    assert.equal(launchA.status, 201);
    const cookieA = sessionCookie(launchA);
    const routeA = (await launchA.json()).route;
    assert.equal((await launch(a.launchGrant.token, authA)).status, 403);
    const freshB = await control.status(command("status", USER_B, SESSION_B, b.instanceId));
    const launchB = await launch(freshB.launchGrant.token, authB);
    assert.equal(launchB.status, 201);
    const cookieB = sessionCookie(launchB);
    const routeB = (await launchB.json()).route;
    assert.equal((await fetch(gatewayOrigin + routeB, { headers: { Cookie: `${cookieA.name}=${cookieA.value}` } })).status, 403);
    assert.equal((await fetch(gatewayOrigin + routeA, { headers: { Cookie: `${cookieB.name}=${cookieB.value}` } })).status, 403);

    const target = specA.vulnerability.storedFlow.targetObjectId;
    await withLabBrowser(gatewayOrigin, routeA, cookieA, async browser => {
      await browser.navigate(gatewayOrigin + routeA + "#/products/detail?id=" + encodeURIComponent(target));
      assert.ok(await browser.evaluate("document.getElementById('heading')?.textContent"));
      const expression = "(() => { const field=document.getElementById('product-review'); field.value=" +
        JSON.stringify(payload) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return document.querySelector('.saved-note')?.textContent; })()";
      assert.match(await browser.evaluate(expression), /Review saved/);
      assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), false);
      await browser.navigate(gatewayOrigin + routeA + "#/catalog");
      await browser.send("Page.reload", { ignoreCache: true });
      await browser.navigate(gatewayOrigin + routeA + "#/products/detail?id=" + encodeURIComponent(target));
      for (let attempt = 0; attempt < 30 && !browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), true);
    });
    assert.equal((await control.grade(command("grade", USER_A, SESSION_A, a.instanceId))).completed, true);

    await withLabBrowser(gatewayOrigin, routeB, cookieB, async browser => {
      await browser.navigate(gatewayOrigin + routeB + "#/search?q=" + encodeURIComponent(payload));
      for (let attempt = 0; attempt < 30 && !browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), true);
    });

    const oldEndpointA = recordA.endpoint;
    await control.reset(command("reset", USER_A, SESSION_A, a.instanceId));
    assert.equal((await fetch(gatewayOrigin + routeA, { headers: { Cookie: `${cookieA.name}=${cookieA.value}` } })).status, 200);
    assert.equal((await control.grade(command("grade", USER_A, SESSION_A, a.instanceId))).completed, false);
    assert.equal(manager.getRecord(recordA.instanceId).endpoint, oldEndpointA, "gateway re-resolves the authoritative backend after reset");
    await control.destroy(command("destroy", USER_A, SESSION_A, a.instanceId));
    assert.equal((await fetch(gatewayOrigin + routeA, { headers: { Cookie: `${cookieA.name}=${cookieA.value}` } })).status, 410);
    await control.destroy(command("destroy", USER_B, SESSION_B, b.instanceId));
    console.log("Phase 7 gateway over real Docker challenges: PASS");
  } finally {
    await gateway.close();
    for (const ref of manager.instances.keys()) await manager.destroy(ref);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
