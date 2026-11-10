#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS Docker verification. */
const assert = require("node:assert/strict");
require("../phase5/loadWebLab");
const { planBeginnerStoredXssLab, planBeginnerEcommerceReflectedXssLab } = require("../phase5/loadWebLab");
const { LocalWebLabControlService } = require("../../../lib/web-lab/control-plane.ts");
const { localControlTrust } = require("./localTrust");
const { dockerBackend } = require("./dockerBackend");
const { browserSession, SIGNAL } = require("../phase5/trustedObserver");

const payload = `<img src=x onerror="console.info('${SIGNAL}')">`;

async function submitStored(spec, endpoint) {
  const flow = spec.vulnerability.storedFlow;
  await browserSession(async browser => {
    await browser.navigate(endpoint + "/#" + flow.submissionRoute + "?id=" + encodeURIComponent(flow.targetObjectId));
    const expression = "(() => { const field=document.getElementById('ticket-comment'); field.value=" +
      JSON.stringify(payload) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return !!document.querySelector('.saved-note')?.textContent; })()";
    assert.equal(await browser.evaluate(expression), true);
  });
}

async function main() {
  const now = () => Date.now();
  const ttlMs = 120_000;
  const trust = localControlTrust(now);
  const { backend, grader, manager } = dockerBackend(now, ttlMs);
  const saved = new Map([
    ["saved-a", { savedLabId: "saved-a", ownerId: "synthetic-a", spec: planBeginnerStoredXssLab("phase6-docker-a") }],
    ["saved-b", { savedLabId: "saved-b", ownerId: "synthetic-b", spec: planBeginnerEcommerceReflectedXssLab("phase6-docker-b") }],
  ]);
  const service = new LocalWebLabControlService({
    verifyCommand: trust.verify, savedLabs: { async find(id) { return saved.get(id) ?? null; } },
    backend, grader, now, ttlMs,
  });
  const command = (operation, owner, resource) => trust.sign(operation, owner, `session-${owner}`, resource);
  const created = [];
  try {
    const a = await service.create(command("create", "synthetic-a", "saved-a"));
    created.push(a.instanceId);
    const b = await service.create(command("create", "synthetic-b", "saved-b"));
    created.push(b.instanceId);
    assert.equal(a.status, "ready");
    assert.equal(b.status, "ready");
    assert.notEqual(a.instanceId, b.instanceId);
    assert.equal(service.validateLaunchGrant(a.launchGrant.token, {
      instanceId: a.instanceId, ownerId: "synthetic-a", sessionId: "session-synthetic-a",
    }), true);
    assert.equal(service.validateLaunchGrant(a.launchGrant.token, {
      instanceId: b.instanceId, ownerId: "synthetic-b", sessionId: "session-synthetic-b",
    }), false);
    const refs = [...manager.instances.keys()];
    assert.equal(refs.length, 2);
    const aRef = refs[0];
    const aEndpoint = manager.getRecord(aRef).endpoint;
    assert.match(aEndpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(aEndpoint)).status, 200);
    assert.equal((await service.grade(command("grade", "synthetic-a", a.instanceId))).completed, false);
    await assert.rejects(service.grade(command("grade", "synthetic-b", a.instanceId)), /runtime_not_found/);
    await submitStored(saved.get("saved-a").spec, aEndpoint);
    assert.equal((await service.grade(command("grade", "synthetic-a", a.instanceId))).completed, true);
    const reset = await service.reset(command("reset", "synthetic-a", a.instanceId));
    assert.equal(reset.status, "ready");
    assert.equal((await service.grade(command("grade", "synthetic-a", a.instanceId))).completed, false);
    assert.equal((await service.status(command("status", "synthetic-b", b.instanceId))).status, "ready");
    assert.equal((await service.destroy(command("destroy", "synthetic-a", a.instanceId))).status, "destroyed");
    assert.equal((await service.destroy(command("destroy", "synthetic-b", b.instanceId))).status, "destroyed");
    await assert.rejects(fetch(aEndpoint, { signal: AbortSignal.timeout(1000) }));
    console.log("Phase 6 control contract over Phase 5 Docker containers: PASS");
  } finally {
    for (const ref of manager.instances.keys()) await manager.destroy(ref);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
