#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped real-provider product E2E. */
"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash, createHmac, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { promisify } = require("node:util");
const postgres = require("postgres");
const ts = require("typescript");

const root = path.resolve(__dirname, "../../..");
const sourceRoot = path.join(root, "lib/web-lab");
const routeRoot = path.join(root, "app/api/web-labs/runtime");
const originalLoad = Module._load;
const initialTsLoader = require.extensions[".ts"];
Module._load = function phase17aServerOnlyBoundary(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};
const webLab = require("../phase5/loadWebLab");
const webLabTsLoader = require.extensions[".ts"];
const { browserSession, gradeInstance, SIGNAL } = require("../phase5/trustedObserver");
const { LocalWebLabGateway } = require("../phase7/localGateway");
const {
  planExecutableWebSpec,
  saveExecutableWebGeneration,
  usesExecutableWebEngine,
} = require("../../../lib/web-lab/generated-executable-lab.ts");
const { PostgresExecutableWebSaveStore } = require("../../../lib/web-lab/generated-executable-postgres.ts");
const {
  PostgresWebLabControlRepository,
  WEB_LAB_COMPILER_VERSION,
} = require("../../../lib/web-lab/postgres-control-repository.ts");
const {
  GeneratedExecutableHostedCompatibilityPolicy,
  WebLabControlPlaneService,
} = require("../../../lib/web-lab/production-control-service.ts");
const { LOCAL_RUNNER_RUNTIME_VERSION } = require("../../../lib/web-lab/local-runner/protocol.ts");
const {
  VercelSandboxRuntimeBackend,
  VERCEL_SANDBOX_RUNTIME_VERSION,
} = require("../../../lib/web-lab/vercel-sandbox-runtime-backend.ts");

require.extensions[".ts"] = (module, filename) => {
  if (filename.startsWith(routeRoot + path.sep)) {
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    module._compile(output.outputText, filename);
    return;
  }
  return webLabTsLoader(module, filename);
};

let activeService;
const actors = new Map();
Module._load = function phase17aRouteBoundary(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  if (specifier === "@/lib/web-lab/runtime-route-handler") {
    return originalLoad.call(this, path.join(sourceRoot, "runtime-route-handler.ts"), parent, isMain);
  }
  if (parent?.filename === path.join(sourceRoot, "runtime-route-handler.ts") &&
      specifier === "./runtime-route-composition") {
    return { createWebLabControlPlane: () => activeService };
  }
  if (parent?.filename === path.join(sourceRoot, "runtime-route-handler.ts") &&
      specifier === "./supabase-runtime-actor") {
    return { resolveSupabaseWebLabActor: async request =>
      actors.get(request.headers.get("x-amniora-test-session")) ?? null };
  }
  return originalLoad.call(this, specifier, parent, isMain);
};

const launchRoute = require(path.join(routeRoot, "launch/route.ts"));
const exchangeRoute = require(path.join(routeRoot, "launch/exchange/route.ts"));
const runtimeRoute = require(path.join(routeRoot, "[id]/route.ts"));
const resetRoute = require(path.join(routeRoot, "[id]/reset/route.ts"));
const gradeRoute = require(path.join(routeRoot, "[id]/grade/route.ts"));

const execFileAsync = promisify(execFile);
const DATABASE_NAME = "amniora_phase17a_test";
const APP_ORIGIN = "https://local.example";
const PROJECT = "vercel-sandbox-default-project";
const TEAM = "amniora";
const DEEP_OWNER = "11111111-1111-4111-8111-111111111111";
const DEEP_JOB = "a28f4371-4a6e-459e-882c-1efc96f23f89";
const FREE_OWNER = "22222222-2222-4222-8222-222222222222";
const FAILURE_OWNER = "33333333-3333-4333-8333-333333333333";
const SECOND_OWNER = "44444444-4444-4444-8444-444444444444";
const EXPIRY_OWNER = "55555555-5555-4555-8555-555555555555";
const PAYLOAD = `<img src=x onerror="console.info('${SIGNAL}')">`;

const report = {
  phase: "17A",
  project: PROJECT,
  region: "lhr1",
  product: {},
  security: {},
  lifecycle: {},
  timingsMs: {},
  providerMetrics: [],
  cleanup: {},
};

function elapsed(start) {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function idempotency(prefix) {
  return `${prefix}-${randomUUID().replaceAll("-", "")}`;
}

async function command(commandName, args, options = {}) {
  return execFileAsync(commandName, args, {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
}

async function docker(...args) {
  const result = await command("docker", args);
  return result.stdout.trim();
}

async function waitForPostgres(containerName) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", DATABASE_NAME);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error("disposable_postgres_not_ready");
}

async function startDisposablePostgres() {
  const suffix = randomBytes(6).toString("hex");
  const containerName = `amniora-phase17a-postgres-${process.pid}-${suffix}`;
  const password = randomBytes(24).toString("base64url");
  try {
    await docker("run", "-d", "--name", containerName,
      "-e", `POSTGRES_PASSWORD=${password}`,
      "-e", `POSTGRES_DB=${DATABASE_NAME}`,
      "-p", "127.0.0.1::5432", "postgres:17-alpine");
    await waitForPostgres(containerName);
    const binding = await docker("port", containerName, "5432/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error("disposable_postgres_not_loopback");
    return { containerName,
      connection: `postgres://postgres:${password}@127.0.0.1:${match[1]}/${DATABASE_NAME}` };
  } catch (error) {
    await docker("rm", "-f", containerName).catch(() => undefined);
    throw error;
  }
}

async function applyDisposableSchema(db) {
  await db.unsafe(`
    create extension if not exists pgcrypto;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key);
    create table public.labs (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      title text not null default 'Fixture lab', topic text not null,
      difficulty text not null default 'Beginner', estimated_time text not null default '30 mins',
      objective text not null default '', scenario text not null default '',
      tasks jsonb not null default '[]'::jsonb, hints jsonb not null default '[]'::jsonb,
      outcomes jsonb not null default '[]'::jsonb, completed boolean not null default false
    );
    create table public.ai_usage_reservations (id uuid primary key default gen_random_uuid());
  `);
  for (const relative of [
    "supabase/migrations/20260901090000_lab_generation_jobs.sql",
    "supabase/migrations/20260922211651_web_lab_control_plane_persistence.sql",
    "supabase/migrations/20260922215508_web_lab_launch_grant_exchange.sql",
  ]) {
    await db.unsafe(fs.readFileSync(path.join(root, relative), "utf8"));
  }
}

async function waitForDatabase(db) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await db`select 1`; return; }
    catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  throw lastError ?? new Error("disposable_postgres_connection_not_ready");
}

async function acquireProjectOidc() {
  const result = await command("npx", ["--yes", "vercel@latest", "project", "token", PROJECT,
    "--scope", TEAM, "--no-color"]);
  const token = result.stdout.trim();
  if (!token) throw new Error("vercel_project_oidc_unavailable");
  process.env.VERCEL_OIDC_TOKEN = token;
}

async function createGenerationJob(db, ownerId, jobId) {
  await db`insert into auth.users (id) values (${ownerId}) on conflict (id) do nothing`;
  await db`
    insert into public.lab_generation_jobs (id, user_id, category, difficulty, duration, status)
    values (${jobId}, ${ownerId}, 'Web Security', 'Beginner', '30 mins', 'generating')
  `;
}

function matchingJob(ownerId, templateId = "ecommerce", moduleId = "stored-xss") {
  for (let attempt = 0; attempt < 200; attempt++) {
    const jobId = randomUUID();
    const spec = planExecutableWebSpec(jobId, ownerId);
    if (spec.templateId === templateId && spec.vulnerability.moduleId === moduleId) return { jobId, spec };
  }
  throw new Error("deterministic_generation_case_not_found");
}

async function generateSavedLab(db, store, ownerId, requestedJobId) {
  const selected = requestedJobId
    ? { jobId: requestedJobId, spec: planExecutableWebSpec(requestedJobId, ownerId) }
    : matchingJob(ownerId);
  await createGenerationJob(db, ownerId, selected.jobId);
  assert.equal(usesExecutableWebEngine("Web Security", "Beginner", "30 mins", true), true);
  assert.equal(selected.spec.templateId, "ecommerce");
  assert.equal(selected.spec.vulnerability.moduleId, "stored-xss");
  const start = process.hrtime.bigint();
  const saved = await saveExecutableWebGeneration(store, selected.jobId, ownerId);
  await db`update public.lab_generation_jobs set status = 'completed', completed_at = now(), updated_at = now()
    where id = ${selected.jobId} and user_id = ${ownerId}`;
  return { ...saved, spec: selected.spec, generationMs: elapsed(start) };
}

function actorFor(ownerId) {
  const token = randomBytes(24).toString("base64url");
  const actor = { userId: ownerId, sessionId: randomUUID() };
  actors.set(token, actor);
  return { token, actor };
}

function makeRequest(method, pathname, body, token, key, headers = {}) {
  return new Request(APP_ORIGIN + pathname, {
    method,
    headers: {
      Origin: APP_ORIGIN,
      ...(token ? { "X-Amniora-Test-Session": token } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function call(operation, id, body, token, key, headers = {}) {
  const routePath = id ? `/api/web-labs/runtime/${id}` : "/api/web-labs/runtime/launch";
  const suffix = operation === "reset" || operation === "grade" ? `/${operation}` :
    operation === "exchange" ? "/exchange" : "";
  const method = operation === "status" ? "GET" : operation === "destroy" ? "DELETE" : "POST";
  const request = makeRequest(method, routePath + suffix, body, token, key, headers);
  const response = operation === "launch" ? await launchRoute.POST(request) :
    operation === "exchange" ? await exchangeRoute.POST(request) :
    operation === "status" ? await runtimeRoute.GET(request, { params: Promise.resolve({ id }) }) :
    operation === "destroy" ? await runtimeRoute.DELETE(request, { params: Promise.resolve({ id }) }) :
    operation === "reset" ? await resetRoute.POST(request, { params: Promise.resolve({ id }) }) :
    await gradeRoute.POST(request, { params: Promise.resolve({ id }) });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const json = await response.json();
  const serialized = JSON.stringify(json);
  for (const forbidden of ["backendReference", "backend_reference", "vercel.run", "sandboxName",
    "internalSolution", "proxyKey", "hopSecret", "service_role"]) {
    assert.equal(serialized.includes(forbidden), false, `learner DTO leaked ${forbidden}`);
  }
  return { status: response.status, ...json };
}

function routeKey(key, instanceId, generationVersion) {
  return createHmac("sha256", key).update(`${instanceId}:${generationVersion}`)
    .digest("base64url").slice(0, 32);
}

function cookiePair(response) {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0];
}

async function openGateway(gateway, launchGrant, token) {
  const exchanged = await call("exchange", null, { grant: launchGrant }, token);
  assert.equal(exchanged.status, 200);
  const response = await fetch(gateway.origin + "/__gateway/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Amniora-Test-Session": token },
    body: JSON.stringify({ grant: exchanged.data.token }),
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 201);
  return { cookie: cookiePair(response), route: (await response.json()).route,
    gatewaySession: exchanged.data.token };
}

async function gatewayState(gateway, opened) {
  const response = await fetch(gateway.origin + opened.route + "__runtime/state", {
    headers: { Cookie: opened.cookie }, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function putGatewayState(gateway, opened, spec, state, text) {
  const flow = spec.vulnerability.storedFlow;
  state.contentByObject[flow.targetObjectId].push({
    id: `learner-${state.nextContentNumber}`,
    authorId: spec.session.displayUserId,
    body: text,
    submittedByLearner: true,
  });
  state.nextContentNumber++;
  const response = await fetch(gateway.origin + opened.route + "__runtime/state", {
    method: "PUT",
    headers: { Cookie: opened.cookie, "Content-Type": "application/json",
      "X-Web-Lab-Field": flow.inputField, "X-Web-Lab-Route": flow.submissionRoute },
    body: JSON.stringify(state), signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 204);
}

function signalled(events) {
  return events.some(event => event.args?.some(argument => argument.value === SIGNAL));
}

async function runStoredXssBrowser(gateway, opened, spec) {
  const target = spec.vulnerability.storedFlow.targetObjectId;
  return browserSession(async browser => {
    await browser.send("Network.enable");
    const [name, value] = opened.cookie.split("=", 2);
    const set = await browser.send("Network.setCookie", { name, value,
      url: gateway.origin + opened.route, httpOnly: true, sameSite: "Strict" });
    assert.equal(set.result?.success, true);
    const detail = gateway.origin + opened.route + "#/products/detail?id=" + encodeURIComponent(target);
    const loadStart = process.hrtime.bigint();
    await browser.navigate(detail);
    const pageLoadMs = elapsed(loadStart);
    const submit = valueToSubmit => browser.evaluate("(() => {" +
      "const field=document.getElementById('product-review');field.value=" + JSON.stringify(valueToSubmit) + ";" +
      "field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));" +
      "return document.querySelector('.saved-note')?.textContent;})()");
    assert.match(await submit("A normal Phase 17A review"), /Review saved/);
    await browser.navigate(gateway.origin + opened.route + "#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(detail);
    assert.equal((await browser.evaluate("document.body.textContent"))
      .includes("A normal Phase 17A review"), true);
    assert.match(await submit(PAYLOAD), /Review saved/);
    assert.equal(signalled(browser.consoleEvents), false, "immediate reflection must not count");
    await browser.navigate(gateway.origin + opened.route + "#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(detail);
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(signalled(browser.consoleEvents), true);
    assert.equal(await browser.evaluate("!!document.querySelector('[data-review-body] img[onerror]')"), true);
    return { pageLoadMs, browserStartupMs: browser.startup.milliseconds };
  });
}

function safeMetric(stage, metadata) {
  return {
    stage,
    region: metadata?.region ?? null,
    status: metadata?.status ?? null,
    persistent: metadata?.persistent ?? null,
    networkPolicy: metadata?.networkPolicy ?? null,
    vcpus: metadata?.vcpus ?? null,
    memoryMb: metadata?.memoryMb ?? null,
    createdAt: metadata?.createdAt ?? null,
    expiresAt: metadata?.expiresAt ?? null,
    totalDurationMs: metadata?.totalDurationMs ?? null,
    totalActiveCpuDurationMs: metadata?.totalActiveCpuDurationMs ?? null,
    ingressBytes: metadata?.ingressBytes ?? null,
    egressBytes: metadata?.egressBytes ?? null,
  };
}

function costModel(metrics) {
  const samples = metrics.filter(item => Number.isFinite(item.totalDurationMs) && item.totalDurationMs > 0);
  const totalDurationMs = samples.reduce((sum, item) => sum + item.totalDurationMs, 0);
  const totalActiveCpuMs = samples.reduce((sum, item) =>
    sum + (Number.isFinite(item.totalActiveCpuDurationMs) ? item.totalActiveCpuDurationMs : 0), 0);
  const totalTransferBytes = samples.reduce((sum, item) =>
    sum + (Number.isFinite(item.ingressBytes) ? item.ingressBytes : 0) +
      (Number.isFinite(item.egressBytes) ? item.egressBytes : 0), 0);
  const cpuDutyCycle = totalDurationMs > 0 ? Math.min(1, totalActiveCpuMs / totalDurationMs) : null;
  const bytesPerMs = totalDurationMs > 0 ? totalTransferBytes / totalDurationMs : 0;
  const cpuRate = 0.177;
  const memoryRatePerGbHour = 0.0292;
  const transferRatePerGb = 0.15;
  const creationCost = 0.60 / 1_000_000;
  const estimate = minutes => {
    const hours = minutes / 60;
    const cpu = cpuRate * hours * (cpuDutyCycle ?? 0.10);
    const memory = memoryRatePerGbHour * 2 * hours;
    const transfer = bytesPerMs * minutes * 60_000 / 1_000_000_000 * transferRatePerGb;
    return { minutes, cpuUsd: cpu, memoryUsd: memory, transferUsd: transfer,
      creationUsd: creationCost, totalUsd: cpu + memory + transfer + creationCost };
  };
  const occupiedSlotHours = 5 * 0.10 * 730;
  const monthlyCpu = cpuRate * occupiedSlotHours * (cpuDutyCycle ?? 0.10);
  const monthlyMemory = memoryRatePerGbHour * 2 * occupiedSlotHours;
  const monthlyTransfer = bytesPerMs * occupiedSlotHours * 3_600_000 /
    1_000_000_000 * transferRatePerGb;
  const monthlySessions = occupiedSlotHours * 2;
  const monthlyUsageUsd = monthlyCpu + monthlyMemory + monthlyTransfer + monthlySessions * creationCost;
  const monthlyInvoiceUsd = Math.max(20, monthlyUsageUsd);
  const monthlyInvoiceGbpAtPlanningFx = monthlyInvoiceUsd / 1.25;
  return {
    sampleCount: samples.length,
    totalDurationMs,
    totalActiveCpuMs,
    totalTransferBytes,
    cpuDutyCycle,
    thirtyMinute: estimate(30),
    sixtyMinute: estimate(60),
    fiveSlotsTenPercentOccupancy: {
      occupiedSlotHours, monthlyUsageUsd, monthlyInvoiceUsd,
      planningFxUsdPerGbp: 1.25, monthlyInvoiceGbp: monthlyInvoiceGbpAtPlanningFx,
      verdict: monthlyInvoiceGbpAtPlanningFx < 50 ? "YES" :
        monthlyInvoiceGbpAtPlanningFx < 60 ? "LIKELY" : "UNLIKELY",
    },
  };
}

async function staleRawRouteDenied(origin) {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
    return response.status !== 200;
  } catch { return true; }
}

function makeFailingBackend() {
  return {
    async create() { throw new Error("phase17a_controlled_provider_create_failure"); },
    async status() { return "destroyed"; },
    async reset() { throw new Error("unexpected_reset"); },
    async destroy() {},
    async inspect() { return { state: "missing", observation: null }; },
    async listManaged() { return []; },
    async destroyManaged() {},
  };
}

async function main() {
  assert.equal(process.platform, "darwin");
  const preexistingBrowserProfiles = new Set(fs.readdirSync("/private/tmp")
    .filter(name => name.startsWith("amniora-web-grader-")));
  const postgresRuntime = await startDisposablePostgres();
  const db = postgres(postgresRuntime.connection, { max: 24, prepare: false, connect_timeout: 5 });
  let backend;
  let gateway;
  const ownedInstanceIds = new Set();
  let maxSimultaneous = 0;
  let clockOffsetMs = 0;
  const now = () => Date.now() + clockOffsetMs;
  const plans = new Map([[FREE_OWNER, "free"]]);
  const sessions = new Map();
  const gatewayKey = randomBytes(32);
  const signingKey = randomBytes(32);
  const hopSigningKey = randomBytes(32);
  const providerCounts = { create: 0, reset: 0, destroy: 0 };

  const updateMaximum = async () => {
    const managed = (await backend.listManaged()).filter(item => ownedInstanceIds.has(item.instanceId));
    maxSimultaneous = Math.max(maxSimultaneous, managed.length);
    assert.ok(managed.length <= 2, `real Sandbox maximum exceeded: ${managed.length}`);
    return managed;
  };

  try {
    await waitForDatabase(db);
    await applyDisposableSchema(db);
    await acquireProjectOidc();
    backend = new VercelSandboxRuntimeBackend({ hopSigningKey, timeoutMs: 5 * 60_000, maximumManaged: 5 });
    assert.deepEqual(await backend.listManaged(), [], "Phase 17A requires an empty managed provider inventory");
    const repository = new PostgresWebLabControlRepository(db);
    const saveStore = new PostgresExecutableWebSaveStore(db);
    const deepIdentity = actorFor(DEEP_OWNER);
    const freeIdentity = actorFor(FREE_OWNER);
    const failureIdentity = actorFor(FAILURE_OWNER);
    const secondIdentity = actorFor(SECOND_OWNER);
    const expiryIdentity = actorFor(EXPIRY_OWNER);
    for (const identity of [deepIdentity, freeIdentity, failureIdentity, secondIdentity, expiryIdentity]) {
      sessions.set(identity.token, identity.actor);
    }

    const deep = await generateSavedLab(db, saveStore, DEEP_OWNER, DEEP_JOB);
    const free = await generateSavedLab(db, saveStore, FREE_OWNER);
    const failure = await generateSavedLab(db, saveStore, FAILURE_OWNER);
    const second = await generateSavedLab(db, saveStore, SECOND_OWNER);
    const expiry = await generateSavedLab(db, saveStore, EXPIRY_OWNER);
    report.timingsMs.savedLabBuildTransaction = deep.generationMs;
    const trusted = await repository.getTrustedBuild(deep.build.id, DEEP_OWNER);
    assert.ok(trusted);
    assert.equal(deep.build.runtimeVersion, LOCAL_RUNNER_RUNTIME_VERSION);
    assert.equal(deep.build.compilerVersion, WEB_LAB_COMPILER_VERSION);
    assert.equal(deep.build.buildFingerprint, webLab.compileWebLab(deep.spec).manifest.canonicalSpecSha256);
    assert.deepEqual(trusted.spec, deep.spec);
    report.product.generatedSavedLabBuild = true;

    const providerBackend = {
      async create(...args) { providerCounts.create++; return backend.create(...args); },
      status: backend.status.bind(backend),
      async reset(...args) { providerCounts.reset++; return backend.reset(...args); },
      async destroy(...args) { providerCounts.destroy++; return backend.destroy(...args); },
      inspect: backend.inspect.bind(backend),
      listManaged: backend.listManaged.bind(backend),
      destroyManaged: backend.destroyManaged.bind(backend),
      resolveBackend: backend.resolveBackend.bind(backend),
      providerMetadata: backend.providerMetadata.bind(backend),
      observeNetworkContainment: backend.observeNetworkContainment.bind(backend),
    };
    const makeService = selectedBackend => new WebLabControlPlaneService({
      repository,
      entitlement: { async planFor(actor) { return plans.get(actor.userId) ?? "pro"; } },
      ratePolicy: { async assertAllowed() {} },
      compatibility: new GeneratedExecutableHostedCompatibilityPolicy(VERCEL_SANDBOX_RUNTIME_VERSION),
      grader: { async grade({ spec, runtime, backend: registeredBackend, context }) {
        const target = await registeredBackend.resolveBackend(runtime.backendReference, context);
        if (!target) throw new Error("hosted_runtime_unavailable");
        const result = await gradeInstance({ instanceId: runtime.instanceId, spec,
          endpoint: target.origin, proxyAccessKey: target.proxyKey });
        return { outcome: result.status === "pass" ? "pass" : "not_complete",
          graderVersion: "phase17a-hosted-browser-1",
          ...(result.status === "pass" ? { observationFingerprint: digest(JSON.stringify({
            instanceId: runtime.instanceId, buildFingerprint: context.buildFingerprint,
            generationVersion: context.generationVersion, result,
          })) } : {}) };
      } },
      backends: [{ mode: "amniora_hosted", providerKind: "vercel_sandbox",
        runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION, backend: selectedBackend }],
      signingKey, now, ttlMinutes: 1, grantMs: 10_000, gatewaySessionMs: 60_000,
    });
    activeService = makeService(providerBackend);
    process.env.WEB_LAB_RUNTIME_API_ENABLED = "true";
    process.env.WEB_LAB_TRUSTED_GRADING_ENABLED = "true";
    process.env.WEB_LAB_APP_ORIGIN = APP_ORIGIN;

    const freeDenied = await call("launch", null,
      { savedLabId: free.savedLabId, mode: "amniora_hosted" }, freeIdentity.token, "free-hosted");
    assert.equal(freeDenied.error.code, "HOSTED_PLAN_REQUIRED");
    report.security.freeHostedDenied = true;
    const killSwitch = await call("launch", null,
      { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, "kill-switch");
    assert.equal(killSwitch.error.code, "HOSTED_DISABLED");
    await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
      budget_state = 'DISABLED', metrics_observed_at = now() where singleton_id = 1`;
    const budgetDisabled = await call("launch", null,
      { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, "budget-disabled");
    assert.equal(budgetDisabled.error.code, "HOSTED_DISABLED");
    await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
      budget_state = 'NORMAL', metrics_observed_at = now() where singleton_id = 1`;
    report.security.killSwitchAndBudgetDenied = true;

    activeService = makeService(makeFailingBackend());
    const failedCreate = await call("launch", null,
      { savedLabId: failure.savedLabId, mode: "amniora_hosted" }, failureIdentity.token, "provider-failure");
    assert.equal(failedCreate.error.code, "RUNTIME_PROVISIONING_FAILED");
    assert.equal((await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
      where instance_id is null`)[0].n, 5);
    report.lifecycle.providerCreateFailureReleasedAdmission = true;
    activeService = makeService(providerBackend);

    const arbitrary = await call("launch", null,
      { savedLabId: deep.savedLabId, mode: "amniora_hosted", url: "https://example.invalid",
        host: "169.254.169.254", port: 80, protocol: "http:" }, deepIdentity.token, "arbitrary-target");
    assert.equal(arbitrary.error.code, "INVALID_REQUEST");
    report.security.arbitraryTargetDenied = true;

    gateway = new LocalWebLabGateway({
      now,
      authenticateLearner: async request => {
        const actor = sessions.get(request.headers["x-amniora-test-session"]);
        return actor ? { ownerId: actor.userId, sessionId: actor.sessionId } : null;
      },
      control: {
        async authorizeDataPlaneLaunch(token, identity) {
          try {
            const target = await activeService.authorizeGatewaySession(token,
              { userId: identity.ownerId, sessionId: identity.sessionId });
            return { instanceId: target.instanceId,
              routeKey: routeKey(gatewayKey, target.instanceId, target.context.generationVersion),
              expiresAt: Date.parse(target.expiresAt) };
          } catch { return null; }
        },
        async resolveDataPlaneTarget({ instanceId, ownerId, routeKey: requested }) {
          const runtime = await repository.getRuntimeControl(instanceId, ownerId);
          if (!runtime || runtime.status !== "ready" || !runtime.backendReference ||
              now() >= Date.parse(runtime.expiresAt) ||
              routeKey(gatewayKey, instanceId, runtime.generationVersion) !== requested) return null;
          return { instanceId, backendReference: runtime.backendReference,
            generationVersion: runtime.generationVersion, expiresAt: Date.parse(runtime.expiresAt) };
        },
      },
      resolveBackend: (reference, target) => backend.resolveBackend(reference, target),
    });
    await gateway.listen();

    const creationStart = process.hrtime.bigint();
    const launchKey = idempotency("deep-launch");
    const duplicateLaunches = await Promise.all([
      call("launch", null, { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, launchKey),
      call("launch", null, { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, launchKey),
    ]);
    assert.equal(duplicateLaunches[0].data.instanceId, duplicateLaunches[1].data.instanceId);
    const runtimeId = duplicateLaunches[0].data.instanceId;
    ownedInstanceIds.add(runtimeId);
    const ready = await call("launch", null,
      { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, launchKey);
    assert.equal(ready.data.status, "ready");
    assert.equal(providerCounts.create, 1);
    report.timingsMs.sandboxCreation = elapsed(creationStart);
    report.lifecycle.duplicateLaunchIdempotent = true;
    await updateMaximum();

    const runtime = await repository.getRuntimeControl(runtimeId, DEEP_OWNER);
    assert.equal(runtime.buildId, deep.build.id);
    assert.equal(runtime.runtimeVersion, VERCEL_SANDBOX_RUNTIME_VERSION);
    const contextOne = { instanceId: runtimeId, buildFingerprint: deep.build.buildFingerprint,
      generationVersion: 1, runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION };
    const targetOne = await backend.resolveBackend(runtime.backendReference, contextOne);
    assert.ok(targetOne);
    assert.equal(targetOne.metadata.region, "lhr1");
    assert.equal(targetOne.metadata.persistent, false);
    assert.equal(targetOne.metadata.vcpus, 1);
    assert.equal(targetOne.metadata.memoryMb, 2048);
    assert.equal(targetOne.metadata.networkPolicy, "deny-all");
    assert.equal((await fetch(targetOne.origin, { signal: AbortSignal.timeout(10_000) })).status, 403);
    const trustedIngressProbe = await fetch(targetOne.origin, {
      headers: { "X-Web-Lab-Proxy-Key": targetOne.proxyKey,
        Authorization: "Bearer must-not-forward", Cookie: "main_session=must-not-forward",
        "X-Amniora-Control": "must-not-forward", "X-Web-Lab-Launch-Grant": "must-not-forward" },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(trustedIngressProbe.status, 200);
    assert.equal(trustedIngressProbe.headers.get("x-amniora-hop-forwarded"), "no");
    report.security.rawRouteDenied = true;
    const containment = await backend.observeNetworkContainment(runtime.backendReference, contextOne);
    assert.deepEqual(containment, { networkPolicyDenyAll: true, dnsBlocked: true,
      directIpBlocked: true, arbitraryPublicTcpBlocked: true });
    report.security.outboundContainment = containment;

    for (const operation of ["status", "reset", "destroy", "grade"]) {
      const denied = await call(operation, runtimeId, operation === "status" ? undefined : {},
        secondIdentity.token, `wrong-user-${operation}`, operation === "grade"
          ? { "X-Web-Lab-Runtime-Session": "wrong-owner-session" } : {});
      assert.equal(denied.error.code, "RUNTIME_NOT_FOUND");
    }
    report.security.wrongUserDenied = true;

    const wrongGrant = await call("exchange", null, { grant: ready.data.launchGrant.token },
      secondIdentity.token);
    assert.equal(wrongGrant.error.code, "INVALID_LAUNCH_GRANT");
    const tampered = ready.data.launchGrant.token.slice(0, -1) +
      (ready.data.launchGrant.token.endsWith("a") ? "b" : "a");
    assert.equal((await call("exchange", null, { grant: tampered }, deepIdentity.token)).error.code,
      "INVALID_LAUNCH_GRANT");
    const expiringGrant = (await activeService.issueLaunchGrant(deepIdentity.actor, runtimeId));
    const beforeGrantExpiry = clockOffsetMs;
    clockOffsetMs = Date.parse(expiringGrant.expiresAt) - Date.now() + 1;
    assert.equal((await call("exchange", null, { grant: expiringGrant.token }, deepIdentity.token)).error.code,
      "LAUNCH_GRANT_EXPIRED");
    clockOffsetMs = beforeGrantExpiry;

    const readyToOpenStart = process.hrtime.bigint();
    const openReady = await call("launch", null,
      { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, launchKey);
    const openedOne = await openGateway(gateway, openReady.data.launchGrant.token, deepIdentity.token);
    report.timingsMs.readyToOpen = elapsed(readyToOpenStart) + report.timingsMs.sandboxCreation;
    assert.equal((await call("exchange", null, { grant: openReady.data.launchGrant.token },
      deepIdentity.token)).error.code, "LAUNCH_GRANT_REPLAYED");
    const gatewayRequestStart = process.hrtime.bigint();
    const rootResponse = await fetch(gateway.origin + openedOne.route, {
      headers: { Cookie: openedOne.cookie, Authorization: "Bearer must-not-forward",
        "X-Amniora-Control": "must-not-forward", "X-Web-Lab-Launch-Grant": "must-not-forward" },
      signal: AbortSignal.timeout(10_000),
    });
    report.timingsMs.gatewayRequest = elapsed(gatewayRequestStart);
    assert.equal(rootResponse.status, 200);
    assert.equal(rootResponse.headers.get("x-amniora-hop-forwarded"), null);
    const browser = await runStoredXssBrowser(gateway, openedOne, deep.spec);
    report.timingsMs.browserPageLoad = browser.pageLoadMs;
    report.timingsMs.browserStartup = browser.browserStartupMs;
    report.product.storedXss = true;
    assert.equal((await backend.providerMetadata(runtimeId, contextOne)).networkPolicy, "deny-all");

    const forgedGrade = await call("grade", runtimeId,
      { completed: true, trustLevel: "hosted_verified" }, deepIdentity.token);
    assert.equal(forgedGrade.error.code, "INVALID_REQUEST");
    const gradeStart = process.hrtime.bigint();
    const grade = await call("grade", runtimeId, {}, deepIdentity.token, idempotency("deep-grade"),
      { "X-Web-Lab-Runtime-Session": openedOne.gatewaySession });
    report.timingsMs.grade = elapsed(gradeStart);
    assert.equal(grade.data.completed, true);
    assert.equal(grade.data.trustLevel, "hosted_verified");
    assert.ok(grade.data.completionId);
    const completionsBeforeLifecycle = await repository.getCompletionForOwner(deep.build.id, DEEP_OWNER);
    assert.equal(completionsBeforeLifecycle.length, 1);
    assert.equal(completionsBeforeLifecycle[0].trustLevel, "hosted_verified");
    report.product.hostedVerified = true;

    const staleGrant = await activeService.issueLaunchGrant(deepIdentity.actor, runtimeId);
    const oldOrigin = targetOne.origin;
    const oldSandboxName = targetOne.metadata.sandboxName;
    const resetStart = process.hrtime.bigint();
    const reset = await call("reset", runtimeId, {}, deepIdentity.token, idempotency("deep-reset"));
    report.timingsMs.reset = elapsed(resetStart);
    assert.equal(reset.data.generationVersion, 2);
    assert.equal(providerCounts.reset, 1);
    assert.ok([401, 410].includes((await fetch(gateway.origin + openedOne.route,
      { headers: { Cookie: openedOne.cookie } })).status));
    assert.equal((await call("exchange", null, { grant: staleGrant.token }, deepIdentity.token)).error.code,
      "INVALID_LAUNCH_GRANT");
    assert.equal(await staleRawRouteDenied(oldOrigin), true);
    const generationOneMetrics = await backend.providerMetadata(runtimeId, contextOne);
    report.providerMetrics.push(safeMetric("deep-generation-1-reset", generationOneMetrics));
    const afterReset = await repository.getRuntimeControl(runtimeId, DEEP_OWNER);
    const contextTwo = { ...contextOne, generationVersion: 2 };
    const targetTwo = await backend.resolveBackend(afterReset.backendReference, contextTwo);
    assert.ok(targetTwo);
    assert.notEqual(targetTwo.metadata.sandboxName, oldSandboxName);
    assert.notEqual(targetTwo.origin, oldOrigin);
    assert.equal((await repository.getBuildMetadata(deep.savedLabId, DEEP_OWNER)).buildFingerprint,
      deep.build.buildFingerprint);
    const reopenedReady = await call("launch", null,
      { savedLabId: deep.savedLabId, mode: "amniora_hosted" }, deepIdentity.token, launchKey);
    const openedTwo = await openGateway(gateway, reopenedReady.data.launchGrant.token, deepIdentity.token);
    assert.equal((await fetch(gateway.origin + openedTwo.route,
      { headers: { Cookie: openedTwo.cookie } })).status, 200);
    assert.equal(JSON.stringify(await gatewayState(gateway, openedTwo)).includes(SIGNAL), false);
    report.lifecycle.resetReplacement = true;
    await updateMaximum();

    const secondStart = process.hrtime.bigint();
    const secondLaunchKey = idempotency("second-launch");
    const secondReady = await call("launch", null,
      { savedLabId: second.savedLabId, mode: "amniora_hosted" }, secondIdentity.token, secondLaunchKey);
    report.timingsMs.secondSandboxCreation = elapsed(secondStart);
    assert.equal(secondReady.data.status, "ready");
    ownedInstanceIds.add(secondReady.data.instanceId);
    const openedSecond = await openGateway(gateway, secondReady.data.launchGrant.token, secondIdentity.token);
    assert.equal((await updateMaximum()).length, 2);
    let secondState = await gatewayState(gateway, openedSecond);
    await putGatewayState(gateway, openedSecond, second.spec, secondState, "Second identity only");
    assert.equal(JSON.stringify(await gatewayState(gateway, openedTwo)).includes("Second identity only"), false);
    assert.equal((await fetch(gateway.origin + openedSecond.route,
      { headers: { Cookie: openedTwo.cookie } })).status, 403);
    assert.equal((await fetch(gateway.origin + openedTwo.route,
      { headers: { Cookie: openedSecond.cookie } })).status, 403);

    const destroyStart = process.hrtime.bigint();
    const destroyedDeep = await call("destroy", runtimeId, {}, deepIdentity.token, idempotency("deep-destroy"));
    report.timingsMs.destroy = elapsed(destroyStart);
    assert.equal(destroyedDeep.data.status, "destroyed");
    assert.ok([401, 410].includes((await fetch(gateway.origin + openedTwo.route,
      { headers: { Cookie: openedTwo.cookie } })).status));
    assert.equal((await fetch(gateway.origin + openedSecond.route,
      { headers: { Cookie: openedSecond.cookie } })).status, 200);
    const deepMetrics = await backend.providerMetadata(runtimeId, contextTwo);
    report.providerMetrics.push(safeMetric("deep-generation-2-destroy", deepMetrics));
    assert.equal((await repository.getCompletionForOwner(deep.build.id, DEEP_OWNER)).length, 1);
    assert.ok(await repository.getTrustedBuild(deep.build.id, DEEP_OWNER));
    report.lifecycle.destroyRetainsBuildAndCompletion = true;

    const secondRuntime = await repository.getRuntimeControl(secondReady.data.instanceId, SECOND_OWNER);
    const secondContext = { instanceId: secondReady.data.instanceId,
      buildFingerprint: second.build.buildFingerprint, generationVersion: 1,
      runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION };
    await call("destroy", secondReady.data.instanceId, {}, secondIdentity.token, idempotency("second-destroy"));
    report.providerMetrics.push(safeMetric("second-destroy",
      await backend.providerMetadata(secondRuntime.backendReference, secondContext)));
    report.lifecycle.twoIdentityIsolation = true;

    const expiryLaunch = await call("launch", null,
      { savedLabId: expiry.savedLabId, mode: "amniora_hosted" }, expiryIdentity.token, idempotency("expiry-launch"));
    assert.equal(expiryLaunch.data.status, "ready");
    ownedInstanceIds.add(expiryLaunch.data.instanceId);
    const openedExpiry = await openGateway(gateway, expiryLaunch.data.launchGrant.token, expiryIdentity.token);
    await updateMaximum();
    const expiryRuntime = await repository.getRuntimeControl(expiryLaunch.data.instanceId, EXPIRY_OWNER);
    const expiryContext = { instanceId: expiryRuntime.instanceId,
      buildFingerprint: expiry.build.buildFingerprint, generationVersion: 1,
      runtimeVersion: VERCEL_SANDBOX_RUNTIME_VERSION };
    clockOffsetMs = Date.parse(expiryLaunch.data.expiresAt) - Date.now() + 1;
    const expired = await call("status", expiryRuntime.instanceId, undefined, expiryIdentity.token);
    assert.equal(expired.data.status, "expired");
    assert.notEqual((await fetch(gateway.origin + openedExpiry.route,
      { headers: { Cookie: openedExpiry.cookie } })).status, 200);
    assert.equal((await backend.inspect(expiryRuntime.instanceId, expiryContext)).state, "missing");
    report.providerMetrics.push(safeMetric("expiry",
      await backend.providerMetadata(expiryRuntime.backendReference, expiryContext)));
    const [freeSlots] = await db`select count(*)::int as n from web_lab_control.runtime_admission_slots
      where instance_id is null`;
    assert.equal(freeSlots.n, 5);
    report.lifecycle.expiry = true;
    report.lifecycle.maxSimultaneousSandboxes = maxSimultaneous;
    assert.equal(maxSimultaneous, 2);

    const gatewaySource = fs.readFileSync(path.join(root, "tests/web-lab/phase7/localGateway.js"), "utf8");
    const allowlist = gatewaySource.match(/const REQUEST_HEADERS = \{([\s\S]*?)\n\};/)?.[1] ?? "";
    for (const forbidden of ["authorization", "cookie", "launch-grant", "hop", "control", "provider"] ) {
      assert.equal(allowlist.toLowerCase().includes(forbidden), false, `gateway allowlist contains ${forbidden}`);
    }
    report.security.headerCookieStripping = true;
    report.product.fullPath = true;
    report.cost = costModel(report.providerMetrics);
  } finally {
    try {
      if (db) {
        const rows = await db`select id from web_lab_control.runtime_instances
          where provider_kind = 'vercel_sandbox'`.catch(() => []);
        for (const row of rows) ownedInstanceIds.add(String(row.id));
      }
      if (backend) {
        for (const observation of await backend.listManaged()) {
          if (ownedInstanceIds.has(observation.instanceId)) await backend.destroyManaged(observation);
        }
        const remaining = (await backend.listManaged()).filter(item => ownedInstanceIds.has(item.instanceId));
        report.cleanup.remainingPhase17aSandboxes = remaining.length;
        assert.equal(remaining.length, 0);
      }
    } finally {
      if (gateway) await gateway.close().catch(() => undefined);
      await db.end().catch(() => undefined);
      await docker("rm", "-f", postgresRuntime.containerName).catch(() => undefined);
      delete process.env.VERCEL_OIDC_TOKEN;
      delete process.env.WEB_LAB_RUNTIME_API_ENABLED;
      delete process.env.WEB_LAB_TRUSTED_GRADING_ENABLED;
      delete process.env.WEB_LAB_APP_ORIGIN;
      Module._load = originalLoad;
      if (initialTsLoader) require.extensions[".ts"] = initialTsLoader;
      else delete require.extensions[".ts"];
      report.cleanup.disposablePostgresRemoved = true;
      report.cleanup.gatewayClosed = true;
      report.cleanup.temporaryOidcRemoved = true;
      report.cleanup.grantsAndSessionsRemoved = true;
      report.cleanup.temporarySigningMaterial = "process-memory-only";
      report.cleanup.testRuntimeBundlesRemoved = report.cleanup.remainingPhase17aSandboxes === 0;
      const newBrowserProfiles = fs.readdirSync("/private/tmp")
        .filter(name => name.startsWith("amniora-web-grader-") && !preexistingBrowserProfiles.has(name));
      report.cleanup.browserProfilesRemoved = newBrowserProfiles.length === 0;
      const remainingDatabase = await docker("ps", "-a", "--filter", `name=^/${postgresRuntime.containerName}$`,
        "--format", "{{.Names}}").catch(() => "unknown");
      report.cleanup.disposablePostgresRemoved = remainingDatabase === "";
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error?.stack ?? error);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
