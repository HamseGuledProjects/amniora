#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline TypeScript contract loader. */
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "../../..");
const SOURCE = path.join(ROOT, "lib/web-lab");
const originalLoad = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(`${path.join(ROOT, "lib")}${path.sep}`)) {
    throw new Error("scoped_typescript_load_denied");
  }
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
};

const { compileWebLab } = require(path.join(SOURCE, "compiler.ts"));
const { planBeginnerHelpdeskLab } = require(path.join(SOURCE, "planner.ts"));
const { WebLabPersistenceError } = require(path.join(SOURCE, "postgres-control-repository.ts"));
const { WebLabControlError, WebLabControlPlaneService } = require(
  path.join(SOURCE, "production-control-service.ts"),
);
const { createWebLabRuntimeApiContracts } = require(path.join(SOURCE, "runtime-api-contracts.ts"));
const {
  HostedWebLabTrustedGrader, NodeChromiumWebLabObserver,
  PRODUCTION_WEB_LAB_GRADER_VERSION, WEB_LAB_HARMLESS_EXECUTION_SIGNAL,
} = require(path.join(SOURCE, "production-trusted-grader.ts"));
const { VERCEL_SANDBOX_RUNTIME_VERSION } = require(path.join(SOURCE, "vercel-sandbox-runtime-backend.ts"));
const { buildVercelRuntimeBundle } = require(path.join(SOURCE, "vercel-runtime-bundle.ts"));
const { browserSession } = require(path.join(ROOT, "tests/web-lab/phase5/trustedObserver.js"));

const APP_ORIGIN = "https://app.example.test";
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const BUILD_A = randomUUID();
const BUILD_B = randomUUID();
const RUNTIME_A = randomUUID();
const RUNTIME_B = randomUUID();
const SESSION_A = "verified-session-a";
const SESSION_B = "verified-session-b";
const SIGNAL_PAYLOAD = `<img src=x onerror="console.info('${WEB_LAB_HARMLESS_EXECUTION_SIGNAL}')">`;

let assertions = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
async function rejects(work, code, message) {
  await assert.rejects(work, error => error instanceof WebLabControlError && error.code === code, message);
  assertions++;
}

function fingerprint(value) { return createHash("sha256").update(value).digest("hex"); }
function actor(userId = OWNER_A, sessionId = SESSION_A) { return { userId, sessionId }; }

function metadata(spec, id, savedLabId) {
  const manifest = compileWebLab(spec).manifest;
  return {
    id, savedLabId, canonicalLabId: spec.labId, templateId: manifest.templateId,
    templateVersion: manifest.templateVersion, vulnerabilityModuleId: manifest.vulnerabilityId,
    vulnerabilityModuleVersion: manifest.vulnerabilityVersion, schemaVersion: manifest.schemaVersion,
    compilerVersion: "phase12-web-1", runtimeVersion: "phase15-local-runner-1",
    buildFingerprint: manifest.canonicalSpecSha256, createdAt: new Date(2_000_000_000_000).toISOString(),
  };
}

class MemoryGradeRepository {
  constructor(entries) {
    this.entries = new Map(entries.map(entry => [entry.runtime.instanceId, entry]));
    this.commands = new Map();
    this.attempts = [];
    this.completions = new Map();
    this.failPersistence = false;
  }
  entry(instanceId, ownerId) {
    const entry = this.entries.get(instanceId);
    return entry?.runtime.ownerId === ownerId ? entry : null;
  }
  async getRuntimeControl(instanceId, ownerId) { return this.entry(instanceId, ownerId)?.runtime ?? null; }
  async getTrustedBuild(buildId, ownerId) {
    const entry = [...this.entries.values()].find(value =>
      value.runtime.buildId === buildId && value.runtime.ownerId === ownerId);
    return entry ? { metadata: entry.metadata, spec: entry.spec } : null;
  }
  async getBuildMetadataById(buildId, ownerId) {
    return (await this.getTrustedBuild(buildId, ownerId))?.metadata ?? null;
  }
  async consumeLaunchGrant(input) {
    const entry = this.entry(input.instanceId, input.ownerId);
    if (!entry || entry.runtime.status !== "ready" ||
        entry.runtime.generationVersion !== input.generationVersion) return "not_ready";
    if (this.exchanges?.has(input.grantIdHash)) return "replayed";
    this.exchanges ??= new Set();
    this.exchanges.add(input.grantIdHash);
    return "consumed";
  }
  async requestGrade(input) {
    const entry = this.entry(input.instanceId, input.ownerId);
    if (!entry) throw new WebLabPersistenceError("RUNTIME_NOT_FOUND");
    const identity = `${input.instanceId}:${entry.runtime.buildId}:${entry.runtime.generationVersion}`;
    const mapKey = `${input.ownerId}:${input.idempotencyKey}`;
    const existing = this.commands.get(mapKey);
    if (existing) {
      if (existing.identity !== identity) throw new WebLabPersistenceError("IDEMPOTENCY_CONFLICT");
      return { ...existing, replayed: true };
    }
    const command = { commandId: randomUUID(), generationVersion: entry.runtime.generationVersion,
      state: "in_progress", resultCode: null, replayed: false, completionId: null,
      trustLevel: "hosted_verified", identity, ownerId: input.ownerId, instanceId: input.instanceId,
      leased: false };
    this.commands.set(mapKey, command);
    return { ...command };
  }
  async claimCommandById(commandId, workerId) {
    const command = [...this.commands.values()].find(value => value.commandId === commandId);
    if (!command || command.state !== "in_progress" || command.leased) return null;
    command.leased = true;
    command.workerId = workerId;
    command.fenceToken = 1;
    return { commandId, workerId, fenceToken: 1,
      leaseUntil: new Date(Date.now() + 30_000).toISOString() };
  }
  async recordGradeCommand(input) {
    if (this.failPersistence) throw new Error("persistence_unavailable");
    const command = [...this.commands.values()].find(value =>
      value.commandId === input.commandLease.commandId && value.instanceId === input.instanceId &&
      value.ownerId === input.ownerId && value.leased);
    if (!command) throw new Error("stale_grade_command");
    const entry = this.entry(input.instanceId, input.ownerId);
    if (!entry || entry.runtime.status !== "ready" ||
        entry.runtime.generationVersion !== command.generationVersion) throw new Error("stale_runtime");
    this.attempts.push({ instanceId: input.instanceId, ownerId: input.ownerId,
      buildId: entry.runtime.buildId, outcome: input.outcome, graderVersion: input.graderVersion });
    command.state = input.outcome === "error" ? "failed" : "completed";
    command.resultCode = input.outcome;
    command.leased = false;
    if (input.outcome === "pass") {
      const key = `${input.ownerId}:${entry.runtime.buildId}:hosted_verified`;
      if (!this.completions.has(key)) this.completions.set(key, randomUUID());
      command.completionId = this.completions.get(key);
    }
    return { attemptId: randomUUID(), completionId: command.completionId,
      trustLevel: "hosted_verified" };
  }
}

class ControlledGrader {
  constructor() { this.calls = 0; this.behavior = "pass"; }
  async grade({ runtime }) {
    this.calls++;
    if (this.behavior === "throw") throw new Error("private_provider_failure");
    if (this.behavior === "malformed") return null;
    if (this.behavior === "error") return { outcome: "error", graderVersion: "controlled-v1" };
    if (this.behavior === "not_complete") return { outcome: "not_complete", graderVersion: "controlled-v1" };
    return { outcome: "pass", graderVersion: "controlled-v1",
      observationFingerprint: fingerprint(`trusted:${runtime.instanceId}:${runtime.generationVersion}`) };
  }
}

function makeBackend() {
  return {
    async create() { throw new Error("not_used"); }, async status() { return "ready"; },
    async reset() {}, async destroy() {},
    async inspect(_reference, context) { return { state: "ready", observation: {
      reference: context.instanceId, instanceId: context.instanceId,
      buildFingerprint: context.buildFingerprint, generationVersion: context.generationVersion,
      runtimeVersion: context.runtimeVersion, state: "ready",
    } }; },
    async listManaged() { return []; }, async destroyManaged() {},
  };
}

function request(body, runtimeSession, idempotencyKey = "grade-api") {
  return new Request(`${APP_ORIGIN}/api/web-labs/runtime/${RUNTIME_A}/grade`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_ORIGIN,
      "idempotency-key": idempotencyKey,
      ...(runtimeSession ? { "x-web-lab-runtime-session": runtimeSession } : {}) },
    body: JSON.stringify(body),
  });
}

async function json(response) { return { status: response.status, body: await response.json() }; }

function browserExecutable() {
  const candidates = [
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/chromium", "/usr/bin/google-chrome",
  ];
  const selected = candidates.find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); }
    catch { return false; }
  });
  if (!selected) throw new Error("trusted_grader_contract_requires_chromium");
  return selected;
}

async function withRuntimeFixture(spec, callback) {
  let candidate = { labId: spec.labId, route: spec.internalSolution.route,
    field: spec.internalSolution.input, value: SIGNAL_PAYLOAD };
  const html = compileWebLab(spec).html;
  const proxyKey = "p".repeat(43);
  const graderKey = "g".repeat(43);
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.headers["x-web-lab-proxy-key"] !== proxyKey) { res.writeHead(403); res.end(); return; }
    const pathname = new URL(req.url, "http://fixture").pathname;
    if (pathname === "/__runtime/reflected-candidate") {
      if (req.headers["x-web-lab-grader-key"] !== graderKey || !candidate) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(candidate));
      return;
    }
    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await callback({
      origin: `http://127.0.0.1:${address.port}`,
      headers: { "X-Web-Lab-Proxy-Key": proxyKey, "X-Web-Lab-Grader-Key": graderKey },
      setCandidate(value) { candidate = value; },
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function withGeneratedRuntime(spec, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-trusted-runtime-contract-"));
  for (const file of buildVercelRuntimeBundle(spec)) {
    const target = path.join(directory, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, { mode: file.mode ?? 0o644 });
  }
  const proxyKey = "p".repeat(43);
  const graderKey = "g".repeat(43);
  const challenge = spawn(process.execPath, ["challenge-server.cjs"], { cwd: directory, stdio: "ignore" });
  const ingress = spawn(process.execPath, ["ingress-shim.cjs"], { cwd: directory, stdio: "ignore",
    env: { AMNIORA_HOP_SECRET: proxyKey, AMNIORA_GRADER_SECRET: graderKey } });
  const origin = "http://127.0.0.1:8080";
  const learnerHeaders = { "X-Web-Lab-Proxy-Key": proxyKey };
  const trustedHeaders = { ...learnerHeaders, "X-Web-Lab-Grader-Key": graderKey };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !ready; attempt++) {
      if (challenge.exitCode !== null || ingress.exitCode !== null) break;
      try {
        const response = await fetch(`${origin}/__runtime/health`, {
          headers: learnerHeaders, signal: AbortSignal.timeout(250),
        });
        ready = response.ok;
      } catch { /* local generated runtime is starting */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("generated_runtime_fixture_unavailable");
    return await callback({ origin, learnerHeaders, trustedHeaders });
  } finally {
    await Promise.all([stopProcess(ingress), stopProcess(challenge)]);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function main() {
  const specA = planBeginnerHelpdeskLab("trusted-production-grade-a");
  const specB = planBeginnerHelpdeskLab("trusted-production-grade-b");
  const savedA = randomUUID();
  const savedB = randomUUID();
  const metaA = metadata(specA, BUILD_A, savedA);
  const metaB = metadata(specB, BUILD_B, savedB);
  const createdAt = new Date(Date.now() - 1_000).toISOString();
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const runtimeA = { instanceId: RUNTIME_A, buildId: BUILD_A, runtimeMode: "amniora_hosted",
    status: "ready", generationVersion: 1, createdAt, expiresAt, version: 2,
    ownerId: OWNER_A, providerKind: "vercel_sandbox", runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION,
    backendReference: RUNTIME_A, updatedAt: createdAt };
  const runtimeB = { ...runtimeA, instanceId: RUNTIME_B, buildId: BUILD_B,
    backendReference: RUNTIME_B };
  const repository = new MemoryGradeRepository([
    { runtime: runtimeA, metadata: metaA, spec: specA },
    { runtime: runtimeB, metadata: metaB, spec: specB },
  ]);
  const plans = new Map([[OWNER_A, "pro"], [OWNER_B, "pro"]]);
  const grader = new ControlledGrader();
  const backend = makeBackend();
  const service = new WebLabControlPlaneService({
    repository, entitlement: { async planFor(identity) { return plans.get(identity.userId) ?? "free"; } },
    ratePolicy: { async assertAllowed() {} }, compatibility: { verdict() { return "SUPPORTED"; } },
    grader, backends: [{ mode: "amniora_hosted", providerKind: "vercel_sandbox",
      runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION, backend }],
    signingKey: Buffer.alloc(32, 9), now: Date.now, gatewaySessionMs: 60_000,
  });

  const launchA = await service.issueLaunchGrant(actor(), RUNTIME_A);
  const gatewayA = await service.exchangeLaunchGrant(actor(), launchA.token);
  const launchB = await service.issueLaunchGrant(actor(), RUNTIME_B);
  const gatewayB = await service.exchangeLaunchGrant(actor(), launchB.token);

  const passed = await service.grade(actor(), RUNTIME_A, "valid-grade", gatewayA.token);
  check(passed.completed, true, "valid owner/session/runtime grade passes");
  check(passed.trustLevel, "hosted_verified", "hosted trust comes from stored runtime mode");
  const duplicate = await service.grade(actor(), RUNTIME_A, "valid-grade", gatewayA.token);
  check(duplicate, passed, "duplicate legitimate request replays the durable result");
  check(grader.calls, 1, "duplicate legitimate request does not rerun the grader");
  check(repository.attempts.length, 1, "duplicate legitimate request does not duplicate attempts");
  check(repository.completions.size, 1, "duplicate legitimate request does not duplicate completion");

  await rejects(service.grade(actor(OWNER_B, SESSION_A), RUNTIME_A, "wrong-user", gatewayA.token),
    "RUNTIME_NOT_FOUND", "wrong learner cannot resolve another runtime");
  await rejects(service.grade(actor(OWNER_A, SESSION_B), RUNTIME_A, "wrong-session", gatewayA.token),
    "INVALID_LAUNCH_GRANT", "same learner in another session cannot replay grade authority");
  await rejects(service.grade(actor(), RUNTIME_B, "cross-case-token", gatewayA.token),
    "INVALID_LAUNCH_GRANT", "runtime token from case A cannot grade case B");
  await rejects(service.grade(actor(), RUNTIME_B, "valid-grade", gatewayB.token),
    "IDEMPOTENCY_CONFLICT", "successful idempotency material cannot be replayed against another case");
  plans.set(OWNER_A, "free");
  await rejects(service.grade(actor(), RUNTIME_B, "no-entitlement", gatewayB.token),
    "HOSTED_PLAN_REQUIRED", "server-authoritative entitlement is rechecked for grading");
  plans.set(OWNER_A, "pro");

  await repository.requestGrade({ instanceId: RUNTIME_B, ownerId: OWNER_A,
    idempotencyKey: "recover-unclaimed" });
  const recovered = await service.grade(actor(), RUNTIME_B, "recover-unclaimed", gatewayB.token);
  check(recovered.completed, true,
    "an unclaimed durable command is safely resumed after an interrupted request");

  const api = createWebLabRuntimeApiContracts({ service, resolveActor: async () => actor(),
    enabled: true, gradingEnabled: true, trustedOrigin: APP_ORIGIN });
  const noAuth = createWebLabRuntimeApiContracts({ service, resolveActor: async () => null,
    enabled: true, gradingEnabled: true, trustedOrigin: APP_ORIGIN });
  check((await json(await noAuth.grade(request({}, gatewayA.token), RUNTIME_A))).status, 401,
    "unauthenticated grading fails");
  const disabled = createWebLabRuntimeApiContracts({ service,
    resolveActor: async () => { throw new Error("disabled_grade_resolved_actor"); },
    enabled: true, gradingEnabled: false, trustedOrigin: APP_ORIGIN });
  check((await json(await disabled.grade(request({}, gatewayA.token), RUNTIME_A))).status, 404,
    "disabled trusted-grading gate cannot be bypassed and does not resolve identity");
  check((await json(await api.grade(request({}, ""), RUNTIME_A))).status, 400,
    "missing trusted runtime session fails safely");
  check((await json(await api.grade(new Request(`${APP_ORIGIN}/api/web-labs/runtime/${RUNTIME_A}/grade`, {
    method: "POST", headers: { "content-type": "text/plain", origin: APP_ORIGIN,
      "idempotency-key": "malformed", "x-web-lab-runtime-session": gatewayA.token }, body: "{}",
  }), RUNTIME_A))).status, 400, "malformed grading request fails safely");

  for (const [field, value] of Object.entries({
    completed: true, score: 100, expectedAnswer: "pass", answerKey: "secret",
    gradingRule: { outcome: "pass" }, taskId: "case-b-task", investigationId: savedB,
    runtimeResult: "pass", ownerId: OWNER_A,
  })) {
    const result = await json(await api.grade(request({ [field]: value }, gatewayA.token,
      `tamper-${field}`), RUNTIME_A));
    check(result.status, 400, `learner-controlled ${field} is rejected`);
  }

  repository.entries.delete(RUNTIME_B);
  await rejects(service.grade(actor(), RUNTIME_B, "missing-runtime", gatewayB.token),
    "RUNTIME_NOT_FOUND", "missing trusted runtime state fails closed");
  repository.entries.set(RUNTIME_B, { runtime: runtimeB, metadata: metaB, spec: specB });
  repository.entries.get(RUNTIME_B).runtime = { ...runtimeB, status: "expired" };
  await rejects(service.grade(actor(), RUNTIME_B, "stale-runtime", gatewayB.token),
    "RUNTIME_NOT_READY", "stale runtime fails closed");
  repository.entries.get(RUNTIME_B).runtime = runtimeB;

  grader.behavior = "throw";
  await rejects(service.grade(actor(), RUNTIME_B, "provider-failure", gatewayB.token),
    "GRADE_UNAVAILABLE", "provider failure fails closed");
  grader.behavior = "error";
  await rejects(service.grade(actor(), RUNTIME_B, "provider-error", gatewayB.token),
    "GRADE_UNAVAILABLE", "explicit internal grader error fails closed");
  grader.behavior = "malformed";
  await rejects(service.grade(actor(), RUNTIME_B, "provider-malformed", gatewayB.token),
    "GRADE_UNAVAILABLE", "malformed internal grader output fails closed");
  grader.behavior = "pass";
  repository.failPersistence = true;
  const beforeCompletions = repository.completions.size;
  await assert.rejects(service.grade(actor(), RUNTIME_B, "persistence-failure", gatewayB.token),
    /persistence_unavailable/);
  assertions++;
  check(repository.completions.size, beforeCompletions,
    "persistence failure cannot produce a false successful completion");
  repository.failPersistence = false;

  const apiPass = await json(await api.grade(request({}, gatewayB.token, "safe-response"), RUNTIME_B));
  check(apiPass.status, 200, "authorized API grade succeeds");
  const serializedResponse = JSON.stringify(apiPass.body);
  check(/internalSolution|groundTruthTag|successCondition|answerKey|expectedAnswer|proxyKey|graderKey/.test(serializedResponse),
    false, "learner response exposes no answer key or grading authority");

  await withGeneratedRuntime(specA, async fixture => {
    check((await fetch(`${fixture.origin}/__runtime/reflected-candidate`, {
      headers: fixture.learnerHeaders,
    })).status, 404, "the learner route cannot read reflected grading evidence");
    await browserSession(async browser => {
      await browser.navigate(`${fixture.origin}/#/search`);
      await browser.evaluate(`(() => {
        const field = document.querySelector('[name="q"]');
        field.value = ${JSON.stringify(SIGNAL_PAYLOAD)};
        field.form.requestSubmit();
      })()`);
    }, fixture.learnerHeaders);
    check((await fetch(`${fixture.origin}/__runtime/reflected-candidate`, {
      headers: fixture.learnerHeaders,
    })).status, 404, "recorded reflected evidence remains grader-only");
    const captured = await fetch(`${fixture.origin}/__runtime/reflected-candidate`, {
      headers: fixture.trustedHeaders,
    });
    check(captured.status, 200, "the generated runtime records a bound reflected candidate");
    check(await captured.json(), { labId: specA.labId, route: specA.internalSolution.route,
      field: specA.internalSolution.input, value: SIGNAL_PAYLOAD },
    "the generated runtime records only its compiled lab/route/field tuple");
    const observer = new NodeChromiumWebLabObserver(browserExecutable());
    const productionGrader = new HostedWebLabTrustedGrader(observer, 20_000);
    const context = { instanceId: RUNTIME_A, buildFingerprint: metaA.buildFingerprint,
      generationVersion: 1, runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION };
    const generatedBackend = { ...makeBackend(), async resolveTrustedGradeTarget() {
      return { kind: "vercel-sandbox", origin: fixture.origin,
        requestHeaders: fixture.trustedHeaders };
    } };
    check((await productionGrader.grade({ spec: specA, runtime: runtimeA,
      backend: generatedBackend, context })).outcome, "pass",
    "generated runtime capture and real Chromium observation form one passing boundary");
  });

  await withRuntimeFixture(specA, async fixture => {
    const observer = new NodeChromiumWebLabObserver(browserExecutable());
    const productionGrader = new HostedWebLabTrustedGrader(observer, 20_000);
    const context = { instanceId: RUNTIME_A, buildFingerprint: metaA.buildFingerprint,
      generationVersion: 1, runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION };
    const productionBackend = { ...makeBackend(),
      async resolveTrustedGradeTarget() { return { kind: "vercel-sandbox",
        origin: fixture.origin, requestHeaders: fixture.headers }; } };
    const valid = await productionGrader.grade({ spec: specA, runtime: runtimeA,
      backend: productionBackend, context });
    check(valid.outcome, "pass", "real trusted Chromium observation validates the authoritative candidate");
    check(valid.graderVersion, PRODUCTION_WEB_LAB_GRADER_VERSION,
      "production grader uses a fixed auditable version");
    check(/^[0-9a-f]{64}$/.test(valid.observationFingerprint), true,
      "passing observation produces a bounded fingerprint");
    fixture.setCandidate({ labId: specB.labId, route: specA.internalSolution.route,
      field: specA.internalSolution.input, value: SIGNAL_PAYLOAD });
    const substituted = await productionGrader.grade({ spec: specA, runtime: runtimeA,
      backend: productionBackend, context });
    check(substituted.outcome, "not_complete",
      "cross-case runtime candidate substitution cannot satisfy canonical grading truth");
    const wrongGenerationBackend = { ...productionBackend, async inspect() {
      return { state: "mismatch", observation: { reference: RUNTIME_A, instanceId: RUNTIME_A,
        buildFingerprint: metaA.buildFingerprint, generationVersion: 2,
        runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION, state: "ready" } };
    } };
    const stale = await productionGrader.grade({ spec: specA, runtime: runtimeA,
      backend: wrongGenerationBackend, context });
    check(stale.outcome, "error", "cross-generation runtime observation fails closed");
    const selfHosted = await productionGrader.grade({ spec: specA,
      runtime: { ...runtimeA, runtimeMode: "local_runner", providerKind: "local" },
      backend: productionBackend, context });
    check(selfHosted.outcome, "error",
      "learner-controlled Local Runner cannot claim hosted verified grading");
    const timeoutGrader = new HostedWebLabTrustedGrader(observer, 5_000);
    const timedOut = await timeoutGrader.grade({ spec: specA, runtime: runtimeA,
      backend: { ...productionBackend, inspect() { return new Promise(() => {}); } }, context });
    check(timedOut.outcome, "error", "trusted provider timeout fails closed");
  });

  process.stdout.write(`Trusted production grader contracts PASS (${assertions} assertions)\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || "trusted_production_grader_contract_failed"}\n`);
  process.exitCode = 1;
});
