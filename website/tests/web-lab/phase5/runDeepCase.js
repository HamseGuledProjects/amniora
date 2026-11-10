#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Local CommonJS Docker verification. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LocalWebLabRuntimeManager, docker } = require("./runtimeManager");
const { planBeginnerEcommerceStoredXssLab, sha256 } = require("./loadWebLab");
const { browserSession, SIGNAL } = require("./trustedObserver");

async function submit(endpoint, target, value) {
  return browserSession(async browser => {
    await browser.navigate(endpoint + "/#/products/detail?id=" + encodeURIComponent(target));
    const expression = "(() => { const field=document.getElementById('product-review'); field.value=" +
      JSON.stringify(value) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return document.querySelector('.saved-note').textContent; })()";
    assert.match(await browser.evaluate(expression), /Review saved/);
    assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), false);
    await browser.navigate(endpoint + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(endpoint + "/#/products/detail?id=" + encodeURIComponent(target));
    return browser.evaluate("document.querySelector('.reviews').innerHTML");
  });
}

async function main() {
  const manager = new LocalWebLabRuntimeManager();
  const spec = planBeginnerEcommerceStoredXssLab("phase5-local-deep-case");
  const target = spec.vulnerability.storedFlow.targetObjectId;
  let a;
  let b;
  try {
    const image = await manager.buildImage();
    assert.equal(image.architecture, "arm64");
    a = await manager.create(spec);
    assert.equal(a.status, "ready");
    assert.match(a.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    const initial = await manager.state(a.instanceId);
    const initialHash = sha256(JSON.stringify(initial));
    assert.equal(initialHash, manager.getRecord(a.instanceId).initialFingerprint);
    const bundleDir = manager.getRecord(a.instanceId).bundleDir;
    assert.deepEqual(fs.readdirSync(bundleDir).sort(), ["index.html", "initial-state.json", "runtime-config.json"]);
    assert.equal(fs.readFileSync(path.join(bundleDir, "index.html"), "utf8").includes(spec.internalSolution.groundTruthTag), false);
    assert.equal(fs.readFileSync(path.join(bundleDir, "runtime-config.json"), "utf8").includes("internalSolution"), false);
    const inspect = JSON.parse(await docker("inspect", manager.getRecord(a.instanceId).containerName))[0];
    const proxy = JSON.parse(await docker("inspect", manager.getRecord(a.instanceId).proxyName))[0];
    assert.equal(inspect.HostConfig.Privileged, false);
    assert.equal(inspect.HostConfig.PidMode, "");
    assert.equal(inspect.HostConfig.NetworkMode, manager.getRecord(a.instanceId).networkName);
    assert.ok(inspect.HostConfig.CapDrop.includes("ALL"));
    assert.ok(inspect.HostConfig.SecurityOpt.some(value => value.startsWith("no-new-privileges")));
    assert.equal(inspect.HostConfig.Memory, 128 * 1024 * 1024);
    assert.equal(inspect.HostConfig.PidsLimit, 64);
    assert.ok(inspect.HostConfig.NanoCpus > 0);
    assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspect.NetworkSettings.Ports["8080/tcp"], null);
    assert.equal(proxy.NetworkSettings.Ports["8080/tcp"][0].HostIp, "127.0.0.1");
    assert.equal(proxy.HostConfig.Privileged, false);
    assert.equal(proxy.HostConfig.PidMode, "");
    assert.ok(proxy.HostConfig.CapDrop.includes("ALL"));
    assert.ok(proxy.HostConfig.SecurityOpt.some(value => value.startsWith("no-new-privileges")));
    assert.equal(proxy.HostConfig.ReadonlyRootfs, true);
    assert.equal(proxy.Mounts.length, 0);
    assert.equal(await docker("exec", inspect.Name.slice(1), "id", "-u"), "1000");
    assert.equal(JSON.parse(await docker("network", "inspect", manager.getRecord(a.instanceId).networkName))[0].Internal, true);
    assert.equal(inspect.Mounts.length, 1);
    assert.equal(inspect.Mounts[0].RW, false);
    assert.ok(inspect.Mounts[0].Destination === "/bundle");
    assert.ok(inspect.Mounts[0].Source.startsWith("/private/tmp/amniora-web-runtime-"));
    assert.equal(inspect.Mounts.some(mount => mount.Source.includes("docker.sock") || mount.Source.includes("CyberLab")), false);
    const names = inspect.Config.Env.map(item => item.split("=")[0]);
    for (const name of names) assert.ok(["PATH", "NODE_VERSION", "YARN_VERSION", "WEB_LAB_LOCAL_ONLY"].includes(name), "Unexpected env name: " + name);
    assert.equal((await fetch(a.endpoint)).status, 200);
    assert.equal((await manager.grade(a.instanceId)).status, "not-complete");
    const forged = structuredClone(initial);
    forged.contentByObject[target].push({ id: "learner-1", authorId: spec.session.displayUserId, body: "forged", submittedByLearner: true });
    forged.nextContentNumber++;
    const put = (candidate, field, route, endpoint = a.endpoint) => fetch(endpoint + "/__runtime/state", {
      method: "PUT", headers: { "Content-Type": "application/json", "X-Web-Lab-Field": field, "X-Web-Lab-Route": route },
      body: JSON.stringify(candidate),
    });
    assert.equal((await put(forged, "wrong-field", spec.vulnerability.storedFlow.submissionRoute)).status, 422);
    assert.equal((await put(forged, spec.vulnerability.storedFlow.inputField, "/wrong-route")).status, 422);
    assert.equal((await put({ ...forged, completed: true }, spec.vulnerability.storedFlow.inputField, spec.vulnerability.storedFlow.submissionRoute)).status, 422);
    const disabledProduct = spec.products.find(product => !product.reviewEnabled);
    assert.ok(disabledProduct);
    const wrongProduct = structuredClone(initial);
    wrongProduct.contentByObject[disabledProduct.id].push({ id: "learner-1", authorId: spec.session.displayUserId, body: "wrong product", submittedByLearner: true });
    wrongProduct.nextContentNumber++;
    assert.equal((await put(wrongProduct, spec.vulnerability.storedFlow.inputField, spec.vulnerability.storedFlow.submissionRoute)).status, 422);
    assert.equal(sha256(JSON.stringify(await manager.state(a.instanceId))), initialHash);
    const reflectedOnly = "<img src=x onerror=\"console.info('" + SIGNAL + "')\">";
    await browserSession(async browser => {
      await browser.navigate(a.endpoint + "/#/catalog?query=" + encodeURIComponent(reflectedOnly));
      assert.equal(browser.consoleEvents.some(event => event.args?.some(arg => arg.value === SIGNAL)), false);
      assert.equal(await browser.evaluate("document.querySelector('#catalog-summary img') === null"), true);
    });
    assert.equal((await manager.grade(a.instanceId)).status, "not-complete");
    const normal = "A normal phase five review";
    assert.ok((await submit(a.endpoint, target, normal)).includes(normal));
    assert.equal((await manager.state(a.instanceId)).contentByObject[target].at(-1).body, normal);
    assert.equal((await manager.grade(a.instanceId)).status, "not-complete");
    assert.ok((await submit(a.endpoint, target, SIGNAL)).includes(SIGNAL));
    assert.equal((await manager.grade(a.instanceId)).status, "not-complete");
    const payload = "<img src=x onerror=\"console.info('" + SIGNAL + "')\">";
    assert.ok((await submit(a.endpoint, target, payload)).includes(SIGNAL));
    assert.equal((await manager.state(a.instanceId)).contentByObject[target].at(-1).body, payload);
    assert.equal((await manager.grade(a.instanceId, { completed: true, observation: { eventType: spec.internalSolution.successCondition } })).status, "pass");
    process.env.WEB_LAB_PHASE5_FORBIDDEN_SENTINEL = "dummy-only";
    try { b = await manager.create(spec); } finally { delete process.env.WEB_LAB_PHASE5_FORBIDDEN_SENTINEL; }
    assert.notEqual(a.instanceId, b.instanceId);
    assert.equal(a.buildFingerprint, b.buildFingerprint);
    assert.equal(sha256(JSON.stringify(await manager.state(b.instanceId))), initialHash);
    const bEnvNames = JSON.parse(await docker("inspect", manager.getRecord(b.instanceId).containerName))[0].Config.Env.map(item => item.split("=")[0]);
    assert.equal(bEnvNames.includes("WEB_LAB_PHASE5_FORBIDDEN_SENTINEL"), false);
    assert.equal((await put(await manager.state(a.instanceId), spec.vulnerability.storedFlow.inputField, spec.vulnerability.storedFlow.submissionRoute, b.endpoint)).status, 422);
    assert.equal((await manager.grade(b.instanceId)).status, "not-complete");
    assert.equal((await manager.grade(b.instanceId, { instanceId: a.instanceId, completed: true })).status, "not-complete");
    const oldEndpoint = a.endpoint;
    a = await manager.reset(a.instanceId);
    assert.equal(sha256(JSON.stringify(await manager.state(a.instanceId))), initialHash);
    assert.equal((await manager.grade(a.instanceId)).status, "not-complete");
    assert.equal(sha256(JSON.stringify(await manager.state(b.instanceId))), initialHash);
    a = await manager.destroy(a.instanceId);
    assert.equal(a.status, "destroyed");
    await assert.rejects(fetch(oldEndpoint, { signal: AbortSignal.timeout(1000) }));
    assert.equal(fs.existsSync(bundleDir), false);
    await assert.rejects(docker("inspect", manager.getRecord(a.instanceId).containerName));
    await assert.rejects(docker("inspect", manager.getRecord(a.instanceId).proxyName));
    await assert.rejects(docker("network", "inspect", manager.getRecord(a.instanceId).networkName));
    await assert.rejects(manager.grade(a.instanceId), /not ready/);
    assert.equal((await manager.status(b.instanceId)).status, "ready");
    console.log("Phase 5 deep ecommerce/stored Docker case: PASS");
  } finally {
    if (a) await manager.destroy(a.instanceId);
    if (b) await manager.destroy(b.instanceId);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
