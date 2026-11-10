#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS Docker verification. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { LocalWebLabRuntimeManager, docker } = require("./runtimeManager");
const {
  planBeginnerEcommerceReflectedXssLab,
  planBeginnerStoredXssLab,
  planBeginnerHelpdeskLab,
  canonicalWebLabRuntimeState,
  sha256,
} = require("./loadWebLab");
const { browserSession, SIGNAL } = require("./trustedObserver");

const payload = "<img src=x onerror=\"console.info('" + SIGNAL + "')\">";

async function submitStored(spec, endpoint) {
  const flow = spec.vulnerability.storedFlow;
  const fieldId = spec.templateId === "ecommerce" ? "product-review" : "ticket-comment";
  return browserSession(async browser => {
    await browser.navigate(endpoint + "/#" + flow.submissionRoute + "?id=" + encodeURIComponent(flow.targetObjectId));
    const expression = "(() => { const field=document.getElementById(" + JSON.stringify(fieldId) + "); field.value=" +
      JSON.stringify(payload) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return !!document.querySelector('.saved-note')?.textContent; })()";
    assert.equal(await browser.evaluate(expression), true);
    assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), false);
    await browser.navigate(endpoint + "/#/");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(endpoint + "/#" + flow.retrievalRoute + "?id=" + encodeURIComponent(flow.targetObjectId));
  });
}

async function combination(spec, stored) {
  const manager = new LocalWebLabRuntimeManager();
  let instance;
  try {
    instance = await manager.create(spec);
    assert.equal(instance.status, "ready");
    if (!stored) {
      assert.equal((await manager.grade(instance.instanceId, { input: "plain text" })).status, "not-complete");
      assert.equal((await manager.grade(instance.instanceId, { input: SIGNAL })).status, "not-complete");
    }
    assert.equal((await manager.grade(instance.instanceId, { input: stored ? undefined : payload })).status, stored ? "not-complete" : "pass");
    if (stored) {
      await submitStored(spec, instance.endpoint);
      const state = await manager.state(instance.instanceId);
      assert.equal(state.contentByObject[spec.vulnerability.storedFlow.targetObjectId].at(-1).body, payload);
      assert.equal((await manager.grade(instance.instanceId)).status, "pass");
    }
    instance = await manager.reset(instance.instanceId);
    assert.equal(sha256(JSON.stringify(await manager.state(instance.instanceId))), sha256(JSON.stringify(canonicalWebLabRuntimeState(spec))));
    if (stored) assert.equal((await manager.grade(instance.instanceId)).status, "not-complete");
    instance = await manager.destroy(instance.instanceId);
    assert.equal(instance.status, "destroyed");
    await assert.rejects(manager.grade(instance.instanceId, { input: payload }), /not ready/);
  } finally {
    if (instance) await manager.destroy(instance.instanceId);
  }
}

async function lifecycleNegatives() {
  const spec = planBeginnerEcommerceReflectedXssLab("phase5-lifecycle");
  const manager = new LocalWebLabRuntimeManager();
  await assert.rejects(manager.create({}), /validation failed/);
  assert.equal(manager.instances.size, 0);

  const failed = new LocalWebLabRuntimeManager({ challengeCommand: ["node", "/app/does-not-exist.js"] });
  let failedId;
  try {
    await failed.create(spec);
    assert.fail("Invalid startup unexpectedly succeeded");
  } catch (error) {
    failedId = error.instanceId;
    assert.ok(failedId);
  }
  const record = failed.getRecord(failedId);
  assert.equal((await failed.status(failedId)).status, "failed");
  assert.equal(record.endpoint, null);
  if (record.lastEndpoint) await assert.rejects(fetch(record.lastEndpoint, { signal: AbortSignal.timeout(1000) }));
  assert.equal(fs.existsSync(record.bundleDir), false);
  await assert.rejects(docker("inspect", record.containerName));
  await assert.rejects(docker("inspect", record.proxyName));
  await assert.rejects(docker("network", "inspect", record.networkName));

  let now = 1_000_000;
  const expiring = new LocalWebLabRuntimeManager({ now: () => now, ttlMs: 1000 });
  let instance;
  try {
    instance = await expiring.create(spec);
    const endpoint = instance.endpoint;
    assert.equal((await expiring.status(instance.instanceId)).status, "ready");
    now += 1001;
    assert.equal((await expiring.status(instance.instanceId)).status, "expired");
    await assert.rejects(expiring.grade(instance.instanceId, { input: payload }), /not ready/);
    await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(1000) }));
    await assert.rejects(docker("inspect", expiring.getRecord(instance.instanceId).containerName));
    await assert.rejects(docker("inspect", expiring.getRecord(instance.instanceId).proxyName));
    await assert.rejects(docker("network", "inspect", expiring.getRecord(instance.instanceId).networkName));
  } finally {
    if (instance) await expiring.destroy(instance.instanceId);
  }
  console.log("Phase 5 lifecycle negatives: PASS");
}

async function main() {
  await combination(planBeginnerEcommerceReflectedXssLab("phase5-ecommerce-reflected"), false);
  console.log("Phase 5 ecommerce/reflected Docker case: PASS");
  await combination(planBeginnerStoredXssLab("phase5-helpdesk-stored"), true);
  console.log("Phase 5 helpdesk/stored Docker case: PASS");
  await combination(planBeginnerHelpdeskLab("phase5-helpdesk-reflected"), false);
  console.log("Phase 5 helpdesk/reflected Docker case: PASS");
  await lifecycleNegatives();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
