#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Dependency-free BYO browser gateway contracts. */
"use strict";
const assert = require("node:assert/strict");
const byo = require("../phase16a2a/loadByoRunner");

const APP_ORIGIN = "http://app.localhost:43129";
const GATEWAY_ORIGIN = "http://lab-phase16a2b2b.localhost:43130";
const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const RUNNER = `rnr_${"A".repeat(43)}`;
const RUNTIME = "b".repeat(32);
const FINGERPRINT = "f".repeat(64);

function gatewayRequest(pathname, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Host", new URL(GATEWAY_ORIGIN).host);
  return new Request(GATEWAY_ORIGIN + pathname, { ...options, headers });
}

function launchRequest(grant, overrides = {}) {
  return gatewayRequest(byo.BYO_BROWSER_GATEWAY_LAUNCH_PATH, {
    method: "POST",
    headers: {
      Origin: APP_ORIGIN,
      "Sec-Fetch-Site": "same-site",
      "Content-Type": "application/x-www-form-urlencoded",
      ...(overrides.headers || {}),
    },
    body: overrides.body ?? new URLSearchParams({ grant }).toString(),
  });
}

function cookieFrom(response) {
  return response.headers.get("set-cookie").split(";", 1)[0];
}

async function main() {
  let now = 1_800_000_000_000;
  const observed = [];
  let status = {
    runnerId: RUNNER,
    runtimeId: RUNTIME,
    state: "ready",
    generation: 1,
    buildFingerprint: FINGERPRINT,
    expiresAt: now + 60_000,
    trustLevel: "byo_self_hosted",
  };
  const transport = {
    async runtimeStatus() { return structuredClone(status); },
    async relayHttp(input) {
      observed.push(structuredClone(input));
      const content = input.request.pathQuery === "/"
        ? "<!doctype html><title>Isolated BYO lab</title><div id=brand>Amniora Lab</div>"
        : `${input.request.method} ${input.request.pathQuery} ${Buffer.from(input.request.bodyBase64, "base64")}`;
      return {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": input.request.pathQuery === "/" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
        bodyBase64: Buffer.from(content).toString("base64"),
      };
    },
  };
  const relay = new byo.ByoVmBrowserRelay({
    transport,
    resolveRuntime: async runtimeId => runtimeId === RUNTIME ? { runtimeId: RUNTIME, ownerId: OWNER, runnerId: RUNNER } : null,
    now: () => now,
    sessionTtlMs: 30_000,
  });
  const gateway = new byo.ByoVmBrowserGateway({
    relay,
    gatewayOrigin: GATEWAY_ORIGIN,
    trustedAppOrigin: APP_ORIGIN,
    now: () => now,
  });

  const launch = gateway.issueLaunch({ ownerId: OWNER, runtimeId: RUNTIME });
  assert.equal(launch.action, GATEWAY_ORIGIN + byo.BYO_BROWSER_GATEWAY_LAUNCH_PATH);
  assert.equal(JSON.stringify(launch).includes(OWNER), false, "browser launch response exposed owner identity");
  assert.equal(JSON.stringify(launch).includes(RUNTIME), false, "browser launch response exposed runtime identity");
  const accepted = await gateway.handle(launchRequest(launch.grant));
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/");
  const setCookie = accepted.headers.get("set-cookie");
  assert.match(setCookie, /^amniora_byo_lab_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=30$/);
  assert.equal(/Domain=/i.test(setCookie), false, "gateway cookie must remain host-only");
  const cookie = cookieFrom(accepted);
  assert.equal((await gateway.handle(launchRequest(launch.grant))).status, 401, "launch grant replayed");

  const page = await gateway.handle(gatewayRequest("/", {
    headers: {
      Cookie: `${cookie}; amniora_app_session=must-not-cross`,
      Authorization: "Bearer must-not-cross",
      Accept: "text/html",
      "Sec-Fetch-Site": "same-origin",
    },
  }));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Isolated BYO lab/);
  assert.equal(page.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(page.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(page.headers.get("access-control-allow-origin"), null);
  assert.equal(observed.at(-1).request.headers.cookie, undefined);
  assert.equal(observed.at(-1).request.headers.authorization, undefined);
  assert.equal(observed.at(-1).request.headers.host, undefined);
  assert.equal(observed.at(-1).request.headers.accept, "text/html");

  const metadataInput = "/?next=http%3A%2F%2F169.254.169.254%2Flatest&port=22";
  const fixedTarget = await gateway.handle(gatewayRequest(metadataInput, {
    headers: { Cookie: cookie, Host: new URL(GATEWAY_ORIGIN).host, "Sec-Fetch-Site": "same-origin" },
  }));
  assert.equal(fixedTarget.status, 200);
  assert.equal(observed.at(-1).request.pathQuery, metadataInput);
  assert.equal("host" in observed.at(-1).request, false);
  assert.equal("port" in observed.at(-1).request, false);
  assert.equal("url" in observed.at(-1).request, false);

  const trusted = await gateway.createTrustedSession({ ownerId: OWNER, runtimeId: RUNTIME });
  assert.match(trusted.cookieHeader, /^amniora_byo_lab_session=[A-Za-z0-9_-]{43}$/);
  const put = await gateway.handle(gatewayRequest("/__runtime/state", {
    method: "PUT",
    headers: {
      Cookie: trusted.cookieHeader,
      Origin: GATEWAY_ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: '{"safe":true}',
  }));
  assert.equal(put.status, 200);
  assert.equal(await put.text(), "PUT /__runtime/state {\"safe\":true}");

  const originBound = gateway.issueLaunch({ ownerId: OWNER, runtimeId: RUNTIME });
  assert.equal((await gateway.handle(launchRequest(originBound.grant, {
    headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  }))).status, 403);
  assert.equal((await gateway.handle(launchRequest(originBound.grant))).status, 303,
    "wrong-origin attempt consumed the launch grant");

  const extraField = gateway.issueLaunch({ ownerId: OWNER, runtimeId: RUNTIME });
  assert.equal((await gateway.handle(launchRequest(extraField.grant, {
    body: new URLSearchParams({ grant: extraField.grant, host: "169.254.169.254" }).toString(),
  }))).status, 401);
  const wrongOwner = gateway.issueLaunch({ ownerId: OTHER_OWNER, runtimeId: RUNTIME });
  assert.equal((await gateway.handle(launchRequest(wrongOwner.grant))).status, 403);

  const wrongHost = new Request(GATEWAY_ORIGIN + "/", {
    headers: { Host: "169.254.169.254", Cookie: cookie },
  });
  assert.equal((await gateway.handle(wrongHost)).status, 421);
  assert.equal((await gateway.handle(gatewayRequest("/", { headers: { "Sec-Fetch-Site": "same-origin" } }))).status, 401);
  assert.equal((await gateway.handle(gatewayRequest("/", {
    headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" },
  }))).status, 403);
  assert.equal((await gateway.handle(gatewayRequest("/__runtime/state", {
    method: "PUT",
    headers: { Cookie: cookie, Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: "{}",
  }))).status, 403);

  const staleLaunch = gateway.issueLaunch({ ownerId: OWNER, runtimeId: RUNTIME });
  const staleCookie = cookieFrom(await gateway.handle(launchRequest(staleLaunch.grant)));
  status = { ...status, generation: 2 };
  const stale = await gateway.handle(gatewayRequest("/", { headers: { Cookie: staleCookie } }));
  assert.equal(stale.status, 409);
  assert.match(stale.headers.get("set-cookie"), /Max-Age=0/);

  const expiring = await gateway.createTrustedSession({ ownerId: OWNER, runtimeId: RUNTIME });
  now = expiring.expiresAt;
  assert.equal((await gateway.handle(gatewayRequest("/", { headers: { Cookie: expiring.cookieHeader } }))).status, 401);
  now -= 1;
  status = { ...status, state: "idle" };
  const stoppedGrant = gateway.issueLaunch({ ownerId: OWNER, runtimeId: RUNTIME });
  assert.equal((await gateway.handle(launchRequest(stoppedGrant.grant))).status, 410);

  assert.equal(observed.length, 3, "denied browser requests crossed the fixed relay");
  process.stdout.write("Phase 16A.2B-2B BYO browser gateway contracts: PASS\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
