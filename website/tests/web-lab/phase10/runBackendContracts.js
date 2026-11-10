#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Focused CommonJS contract test. */
"use strict";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const webLab = require("../phase5/loadWebLab");
const {
  VercelSandboxRuntimeBackend, VERCEL_SANDBOX_RUNTIME_VERSION,
} = require("../../../lib/web-lab/vercel-sandbox-runtime-backend.ts");

class FakeSandbox {
  constructor(api, options) {
    this.api = api;
    this.options = options;
    this.name = options.name;
    this.persistent = options.persistent;
    this.region = options.region;
    this.vcpus = options.resources.vcpus;
    this.memory = this.vcpus * 2048;
    this.image = "vercel/sandbox/node@sha256:" + "a".repeat(64);
    this.timeout = options.timeout;
    this.networkPolicy = options.networkPolicy;
    this.status = "running";
    this.cwd = "/vercel/sandbox";
    this.createdAt = new Date(api.clock++);
    this.expiresAt = new Date(this.createdAt.getTime() + this.timeout);
    this.tags = structuredClone(options.tags);
    this.totalDurationMs = 1_000;
    this.totalActiveCpuDurationMs = 100;
    this.totalIngressBytes = 200;
    this.totalEgressBytes = 50;
    this.files = [];
    this.commands = [];
  }
  async mkDir(path) { this.directory = path; }
  async writeFiles(files) { this.files.push(...files); }
  async runCommand(params) {
    this.commands.push(structuredClone(params));
    return { exitCode: 0, async stdout() { return ""; }, async stderr() { return ""; } };
  }
  domain(port) { return `https://${this.name}-${port}.vercel.run`; }
  async stop() { this.status = "stopped"; }
  async delete() { this.api.sandboxes.delete(this.name); }
}

class FakeSandboxApi {
  constructor() { this.clock = 2_000_000_000_000; this.sandboxes = new Map(); this.creates = []; }
  async create(options) {
    assert.equal(this.sandboxes.has(options.name), false);
    const sandbox = new FakeSandbox(this, structuredClone(options));
    this.sandboxes.set(options.name, sandbox);
    this.creates.push(options);
    return sandbox;
  }
  async get({ name }) {
    const sandbox = this.sandboxes.get(name);
    if (!sandbox) throw new Error("not_found");
    return sandbox;
  }
  async list({ tags }) {
    const sandboxes = [...this.sandboxes.values()].filter(sandbox =>
      Object.entries(tags).every(([key, value]) => sandbox.tags?.[key] === value)).map(sandbox => ({
        name: sandbox.name, persistent: sandbox.persistent, createdAt: sandbox.createdAt.getTime(),
        updatedAt: sandbox.createdAt.getTime(), status: sandbox.status, region: sandbox.region,
        vcpus: sandbox.vcpus, memory: sandbox.memory, image: sandbox.image, timeout: sandbox.timeout,
        networkPolicy: { mode: sandbox.networkPolicy }, tags: structuredClone(sandbox.tags),
        totalDurationMs: sandbox.totalDurationMs, totalActiveCpuDurationMs: sandbox.totalActiveCpuDurationMs,
        totalIngressBytes: sandbox.totalIngressBytes, totalEgressBytes: sandbox.totalEgressBytes,
        expiresAt: sandbox.expiresAt.getTime(),
      }));
    return { async toArray() { return sandboxes; } };
  }
}

function context(spec, generationVersion = 1) {
  return {
    instanceId: randomUUID(), buildFingerprint: webLab.compileWebLab(spec).manifest.canonicalSpecSha256,
    generationVersion, runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION,
  };
}

async function main() {
  const api = new FakeSandboxApi();
  const backend = new VercelSandboxRuntimeBackend({
    sandboxApi: api, hopSigningKey: Buffer.alloc(32, 7), timeoutMs: 10 * 60_000, maximumManaged: 2,
    fetchImpl: async () => new Response("ok", { status: 200 }),
  });
  const specA = webLab.planBeginnerEcommerceStoredXssLab("phase10-contract-a");
  const specB = webLab.planBeginnerHelpdeskLab("phase10-contract-b");
  const contextA = context(specA);
  const contextB = context(specB);

  assert.equal(await backend.create(specA, contextA), contextA.instanceId);
  assert.equal(api.creates.length, 1);
  assert.deepEqual(api.creates[0], {
    name: `amniora-p10-${contextA.instanceId.replaceAll("-", "")}-g1`,
    image: "vercel/sandbox/node:24", ports: [8080], timeout: 600_000,
    resources: { vcpus: 1 }, networkPolicy: "deny-all",
    tags: {
      "amniora-managed": "phase10", "amniora-instance": contextA.instanceId,
      "amniora-build": contextA.buildFingerprint, "amniora-generation": "1",
      "amniora-runtime": VERCEL_SANDBOX_RUNTIME_VERSION,
    }, region: "lhr1", persistent: false,
  });
  const firstSandbox = [...api.sandboxes.values()][0];
  assert.equal(firstSandbox.files.length, 5);
  assert.deepEqual(firstSandbox.files.map(file => file.path.split("/").at(-1)).sort(), [
    "challenge-server.cjs", "index.html", "ingress-shim.cjs", "initial-state.json", "runtime-config.json",
  ]);
  const serializedFiles = JSON.stringify(firstSandbox.files);
  for (const forbidden of ["internalSolution", "successCondition", "storedFlow", "solution contract"]) {
    assert.equal(serializedFiles.includes(forbidden), false);
  }
  assert.equal(JSON.stringify(api.creates[0].tags).includes(specA.session.displayUserId), false);
  const resolvedA1 = await backend.resolveBackend(contextA.instanceId, contextA);
  assert.equal(resolvedA1.kind, "vercel-sandbox");
  assert.match(resolvedA1.origin, /^https:\/\/amniora-p10-.*-8080\.vercel\.run$/);
  assert.match(resolvedA1.proxyKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(serializedFiles.includes(resolvedA1.proxyKey), false);
  assert.equal(JSON.stringify(api.creates[0].tags).includes(resolvedA1.proxyKey), false);
  assert.equal(firstSandbox.commands[0].env, undefined);
  assert.equal(firstSandbox.commands[1].env.AMNIORA_HOP_SECRET, resolvedA1.proxyKey);
  assert.match(firstSandbox.commands[1].env.AMNIORA_GRADER_SECRET, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstSandbox.commands[1].env.AMNIORA_GRADER_SECRET, resolvedA1.proxyKey);
  const trustedTargetA1 = await backend.resolveTrustedGradeTarget(contextA.instanceId, contextA);
  assert.equal(trustedTargetA1.kind, "vercel-sandbox");
  assert.deepEqual(Object.keys(trustedTargetA1.requestHeaders).sort(), [
    "X-Web-Lab-Grader-Key", "X-Web-Lab-Proxy-Key",
  ]);
  assert.equal(trustedTargetA1.requestHeaders["X-Web-Lab-Proxy-Key"], resolvedA1.proxyKey);
  assert.equal(trustedTargetA1.requestHeaders["X-Web-Lab-Grader-Key"],
    firstSandbox.commands[1].env.AMNIORA_GRADER_SECRET);
  const runtimeConfig = JSON.parse(firstSandbox.files.find(file => file.path.endsWith("runtime-config.json")).content);
  assert.deepEqual(Object.keys(runtimeConfig).sort(), [
    "displayUserId", "reflectedField", "reflectedRoute", "storedField", "storedRoute", "writableObjectIds",
  ]);
  const runtimeHtml = firstSandbox.files.find(file => file.path.endsWith("index.html")).content;
  assert.equal(runtimeHtml.includes("__runtime/reflected-candidate"), true);
  const ingress = firstSandbox.files.find(file => file.path.endsWith("ingress-shim.cjs")).content;
  assert.equal(ingress.includes("x-web-lab-grader-key"), true);
  assert.equal(await backend.status(contextA.instanceId, contextA), "ready");
  assert.equal((await backend.inspect(contextA.instanceId, contextA)).state, "ready");
  assert.equal(await backend.outboundTcp443Blocked(contextA.instanceId, contextA), true);

  await backend.create(specB, contextB);
  assert.equal((await backend.listManaged()).length, 2);
  const specC = webLab.planBeginnerHelpdeskLab("phase10-contract-c");
  const contextC = context(specC);
  await assert.rejects(backend.create(specC, contextC), /vercel_sandbox_global_limit/);

  const contextA2 = { ...contextA, generationVersion: 2 };
  const oldOrigin = resolvedA1.origin;
  await backend.reset(contextA.instanceId, contextA2, specA);
  const resolvedA2 = await backend.resolveBackend(contextA.instanceId, contextA2);
  assert.notEqual(resolvedA2.origin, oldOrigin);
  assert.notEqual(resolvedA2.proxyKey, resolvedA1.proxyKey);
  assert.equal(await backend.resolveBackend(contextA.instanceId, contextA), null);
  assert.equal(await backend.resolveTrustedGradeTarget(contextA.instanceId, contextA), null);
  assert.equal((await backend.listManaged()).filter(item => item.instanceId === contextA.instanceId).length, 1);
  assert.equal((await backend.inspect(contextA.instanceId, contextA)).state, "mismatch");
  assert.equal((await backend.inspect(contextA.instanceId, contextA2)).state, "ready");

  await backend.destroy(contextA.instanceId, contextA2);
  assert.equal((await backend.listManaged()).some(item => item.instanceId === contextA.instanceId), false);
  assert.equal((await backend.listManaged()).some(item => item.instanceId === contextB.instanceId), true);
  assert.equal((await backend.providerMetadata(contextA.instanceId)).status, "stopped");
  await backend.destroy(contextB.instanceId, contextB);
  assert.equal((await backend.listManaged()).length, 0);

  const disabled = new VercelSandboxRuntimeBackend({
    sandboxApi: api, hopSigningKey: Buffer.alloc(32, 8), creationDisabled: true,
    fetchImpl: async () => new Response("ok", { status: 200 }),
  });
  await assert.rejects(disabled.create(specA, context(specA)), /vercel_sandbox_creation_disabled/);
  console.log("Phase 10 Vercel backend contracts: PASS");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
