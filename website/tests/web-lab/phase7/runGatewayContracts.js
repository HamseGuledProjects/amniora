#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS gateway verification. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
require("../phase5/loadWebLab");
const { planBeginnerHelpdeskLab } = require("../phase5/loadWebLab");
const { LocalWebLabControlService } = require("../../../lib/web-lab/control-plane.ts");
const { localControlTrust } = require("../phase6/localTrust");
const { LocalWebLabGateway } = require("./localGateway");

const USER_A = "gateway-user-a";
const USER_B = "gateway-user-b";
const SESSION_A = "main-session-a";
const SESSION_B = "main-session-b";

function changedClaim(token, name, value) {
  const [encoded, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  claims[name] = value;
  return Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + signature;
}

function labCookie(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value);
  return value.split(";", 1)[0];
}

async function startUpstream(label, proxyKey) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ method: request.method, url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
    if (request.headers["x-web-lab-proxy-key"] !== proxyKey) { response.writeHead(403); response.end(); return; }
    response.writeHead(200, {
      "Content-Type": "text/plain", "X-Internal-Backend": "must-not-cross", "Set-Cookie": "challenge=must-not-cross",
    });
    response.end(label);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`, requests,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function main() {
  let current = 1_900_000_000_000;
  const now = () => current;
  const trust = localControlTrust(now);
  const proxyKey = randomBytes(32).toString("base64url");
  const upstreamA1 = await startUpstream("A generation 1", proxyKey);
  const upstreamA2 = await startUpstream("A generation 2", proxyKey);
  const upstreamB = await startUpstream("B", proxyKey);
  const states = new Map();
  const origins = new Map([["backend-a", upstreamA1.origin], ["backend-b", upstreamB.origin]]);
  let creates = 0;
  const backend = {
    async create() { const ref = creates++ === 0 ? "backend-a" : "backend-b"; states.set(ref, "ready"); return ref; },
    async status(ref) { return states.get(ref); },
    async reset(ref) { if (ref === "backend-a") origins.set(ref, upstreamA2.origin); },
    async destroy(ref) { states.set(ref, "destroyed"); },
  };
  const labs = new Map([
    ["saved-a", { savedLabId: "saved-a", ownerId: USER_A, spec: planBeginnerHelpdeskLab("phase7-contract-a") }],
    ["saved-b", { savedLabId: "saved-b", ownerId: USER_B, spec: planBeginnerHelpdeskLab("phase7-contract-b") }],
  ]);
  const control = new LocalWebLabControlService({
    verifyCommand: trust.verify, savedLabs: { async find(id) { return labs.get(id) ?? null; } }, backend,
    grader: { async grade() { return { status: "not-complete" }; } }, now, ttlMs: 120_000, grantMs: 10_000,
  });
  const command = (operation, owner, session, resource) => trust.sign(operation, owner, session, resource);
  const authTokens = new Map([
    [randomBytes(24).toString("base64url"), { ownerId: USER_A, sessionId: SESSION_A }],
    [randomBytes(24).toString("base64url"), { ownerId: USER_B, sessionId: SESSION_B }],
  ]);
  const [authA, authB] = authTokens.keys();
  const gateway = new LocalWebLabGateway({
    control, now, sessionMs: 20_000,
    authenticateLearner: async request => authTokens.get(request.headers["x-amniora-test-session"]) ?? null,
    resolveBackend: async ref => ({ origin: origins.get(ref), proxyKey }),
  });
  const a = await control.create(command("create", USER_A, SESSION_A, "saved-a"));
  const b = await control.create(command("create", USER_B, SESSION_B, "saved-b"));
  const origin = await gateway.listen();
  const launch = (grant, auth = authA, body = { grant }) => fetch(origin + "/__gateway/launch", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Amniora-Test-Session": auth }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(origin + "/__gateway/launch", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await launch(undefined, authA, {})).status, 403);
    assert.equal((await launch("malformed")).status, 403);
    assert.equal((await launch(a.launchGrant.token.slice(0, -2) + "xx")).status, 403);
    assert.equal((await launch(changedClaim(a.launchGrant.token, "audience", "web-lab-control"))).status, 403);
    assert.equal((await launch(changedClaim(a.launchGrant.token, "instanceId", b.instanceId))).status, 403);
    assert.equal((await launch(a.launchGrant.token, authB)).status, 403);
    const expiredGrant = (await control.status(command("status", USER_A, SESSION_A, a.instanceId))).launchGrant.token;
    current += 10_001;
    assert.equal((await launch(expiredGrant)).status, 403);
    const refreshedA = await control.status(command("status", USER_A, SESSION_A, a.instanceId));
    const accepted = await launch(refreshedA.launchGrant.token);
    assert.equal(accepted.status, 201);
    const sessionA = labCookie(accepted);
    const locationA = (await accepted.json()).route;
    assert.equal((await launch(refreshedA.launchGrant.token)).status, 403, "launch grant is one-time at gateway");
    assert.equal((await fetch(origin + locationA)).status, 401);
    const page = await fetch(origin + locationA + "?q=http://169.254.169.254/", {
      headers: {
        Cookie: sessionA + "; amniora_main=must-not-cross", Authorization: "Bearer must-not-cross",
        "X-Amniora-Test-Session": authA, "X-Web-Lab-Control": "destroy",
      },
    });
    assert.equal(await page.text(), "A generation 1");
    assert.equal(page.headers.has("x-internal-backend"), false);
    assert.equal(page.headers.has("set-cookie"), false);
    const forwarded = upstreamA1.requests.at(-1);
    assert.equal(forwarded.url, "/?q=http://169.254.169.254/");
    assert.equal(forwarded.headers.authorization, undefined);
    assert.equal(forwarded.headers.cookie, undefined);
    assert.equal(forwarded.headers["x-amniora-test-session"], undefined);
    assert.equal(forwarded.headers["x-web-lab-control"], undefined);
    assert.equal((await fetch(origin + locationA, { method: "POST", headers: { Cookie: sessionA } })).status, 405);
    assert.equal((await fetch(origin + locationA + "__runtime/state", {
      method: "PUT", headers: { Cookie: sessionA, "Content-Type": "application/json" }, body: "x".repeat(65_537),
    })).status, 413);

    const refreshedB = await control.status(command("status", USER_B, SESSION_B, b.instanceId));
    const acceptedB = await launch(refreshedB.launchGrant.token, authB);
    const sessionB = labCookie(acceptedB);
    const locationB = (await acceptedB.json()).route;
    assert.equal((await fetch(origin + locationB, { headers: { Cookie: sessionA } })).status, 403);
    assert.equal((await fetch(origin + locationA, { headers: { Cookie: sessionB } })).status, 403);
    assert.equal(await (await fetch(origin + locationB, { headers: { Cookie: sessionB } })).text(), "B");

    const oldLaunch = refreshedA.launchGrant.token;
    await control.reset(command("reset", USER_A, SESSION_A, a.instanceId));
    assert.equal(await (await fetch(origin + locationA, { headers: { Cookie: sessionA } })).text(), "A generation 2");
    assert.equal((await launch(oldLaunch)).status, 403);
    await assert.rejects(control.reset(refreshedA.launchGrant.token), /unauthorized_control_request/);
    await assert.rejects(control.destroy(refreshedA.launchGrant.token), /unauthorized_control_request/);
    await assert.rejects(control.grade(refreshedA.launchGrant.token), /unauthorized_control_request/);
    await assert.rejects(control.create(refreshedA.launchGrant.token), /unauthorized_control_request/);

    current += 20_001;
    assert.equal((await fetch(origin + locationA, { headers: { Cookie: sessionA } })).status, 401);
    assert.equal((await control.status(command("status", USER_A, SESSION_A, a.instanceId))).status, "ready", "gateway session expiry does not change runtime TTL");
    const afterSessionExpiry = await control.status(command("status", USER_A, SESSION_A, a.instanceId));
    const relaunched = await launch(afterSessionExpiry.launchGrant.token);
    const newSessionA = labCookie(relaunched);
    const newLocationA = (await relaunched.json()).route;
    const destroyedGrant = (await control.status(command("status", USER_A, SESSION_A, a.instanceId))).launchGrant.token;
    await control.destroy(command("destroy", USER_A, SESSION_A, a.instanceId));
    assert.equal((await fetch(origin + newLocationA, { headers: { Cookie: newSessionA } })).status, 410);
    assert.equal((await launch(destroyedGrant)).status, 403);

    const doomed = await control.status(command("status", USER_B, SESSION_B, b.instanceId));
    states.set("backend-b", "failed");
    assert.equal((await launch(doomed.launchGrant.token, authB)).status, 403);
    await control.destroy(command("destroy", USER_B, SESSION_B, b.instanceId));
    const replacementB = await control.create(command("create", USER_B, SESSION_B, "saved-b"));
    current += 120_001;
    assert.equal((await control.status(command("status", USER_B, SESSION_B, replacementB.instanceId))).status, "expired");
    assert.equal((await launch(replacementB.launchGrant.token, authB)).status, 403);
    assert.ok(gateway.auditEvents.some(event => event.event === "launch_grant_accepted"));
    assert.ok(gateway.auditEvents.some(event => event.event === "launch_grant_rejected"));
    assert.ok(gateway.auditEvents.some(event => event.event === "lab_session_expired"));
    assert.ok(gateway.auditEvents.every(event => !JSON.stringify(event).includes(a.launchGrant.token)));
    const proxySource = fs.readFileSync(path.join(__dirname, "../phase5/container/proxy.js"), "utf8");
    assert.equal(/\.\.\.request\.headers/.test(proxySource), false);
    const proxyAllowlist = proxySource.match(/const forwardedHeaders = \[[^\n]+/)[0];
    for (const denied of ["authorization", "cookie", "x-web-lab-proxy-key", "x-amniora-test-session"]) {
      assert.equal(proxyAllowlist.includes(`\"${denied}\"`), false);
    }
    console.log("Phase 7 gateway contracts: PASS");
  } finally {
    await gateway.close();
    await Promise.all([upstreamA1.close(), upstreamA2.close(), upstreamB.close()]);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
