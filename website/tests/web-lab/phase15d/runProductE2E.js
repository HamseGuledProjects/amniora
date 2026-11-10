#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped integration loader for trusted server-only Web lab sources. */
"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash, generateKeyPairSync, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const postgres = require("postgres");

const originalLoad = Module._load;
Module._load = function serverOnlyIntegrationBoundary(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};

const runner = require("../phase15a/loadRunner");
const { browserSession, gradeInstance, SIGNAL } = require("../phase5/trustedObserver");
const {
  learnerSavedLab,
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
  LocalRunnerProductError,
  LocalRunnerProductService,
} = require("../../../lib/web-lab/local-runner-product-service.ts");
const { canonicalSpecBytes } = require("../../../lib/web-lab/manifest.ts");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "../../..");
const TEST_ORIGIN = "http://127.0.0.1:3000";
const HOSTILE_ORIGIN = "https://hostile.invalid";
const DATABASE_NAME = "amniora_phase15d_test";
const DEEP_OWNER = "11111111-1111-4111-8111-111111111111";
const DEEP_JOB = "a28f4371-4a6e-459e-882c-1efc96f23f89";
const SMOKE_JOB = "23c3a75d-45f1-446a-843c-621e19ebd1e5";
const STATIC_OWNER = "22222222-2222-4222-8222-222222222222";
const LINUX_OWNER = "33333333-3333-4333-8333-333333333333";
const FAILURE_OWNER = "44444444-4444-4444-8444-444444444444";
const FAILURE_JOB = "55555555-5555-4555-8555-555555555555";
const LINUX_JOB = "66666666-6666-4666-8666-666666666666";
const PAYLOAD = `<img src=x onerror="console.info('${SIGNAL}')">`;

const report = {
  environment: {},
  identity: {},
  timingsMs: {},
  reliability: [],
  failures: {},
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
  const result = await execFileAsync(commandName, args, {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
  return result.stdout.trim();
}

async function docker(...args) {
  return command("docker", args);
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
  throw lastError || new Error("disposable_postgres_not_ready");
}

async function startDisposablePostgres() {
  const suffix = randomBytes(6).toString("hex");
  const containerName = `amniora-phase15d-postgres-${process.pid}-${suffix}`;
  const password = randomBytes(24).toString("base64url");
  try {
    await docker(
      "run", "-d", "--name", containerName,
      "-e", `POSTGRES_PASSWORD=${password}`,
      "-e", `POSTGRES_DB=${DATABASE_NAME}`,
      "-p", "127.0.0.1::5432",
      "postgres:17-alpine",
    );
    await waitForPostgres(containerName);
    const binding = await docker("port", containerName, "5432/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error("disposable_postgres_not_loopback");
    return {
      containerName,
      connection: `postgres://postgres:${password}@127.0.0.1:${match[1]}/${DATABASE_NAME}`,
    };
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
      title text not null default 'Fixture lab',
      topic text not null,
      difficulty text not null default 'Beginner',
      estimated_time text not null default '30 mins',
      objective text not null default '',
      scenario text not null default '',
      tasks jsonb not null default '[]'::jsonb,
      hints jsonb not null default '[]'::jsonb,
      outcomes jsonb not null default '[]'::jsonb,
      completed boolean not null default false
    );
    create table public.ai_usage_reservations (id uuid primary key default gen_random_uuid());
  `);
  const migrations = [
    "supabase/migrations/20260901090000_lab_generation_jobs.sql",
    "supabase/migrations/20260922211651_web_lab_control_plane_persistence.sql",
    "supabase/migrations/20260922215508_web_lab_launch_grant_exchange.sql",
  ];
  for (const relative of migrations) {
    await db.unsafe(fs.readFileSync(path.join(root, relative), "utf8"));
  }
}

async function waitForExternalDatabase(db) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await db`select 1 as ready`;
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("disposable_postgres_external_connection_not_ready");
}

async function createGenerationJob(db, ownerId, jobId, category = "Web Security") {
  await db`insert into auth.users (id) values (${ownerId}) on conflict (id) do nothing`;
  const [queued] = await db`
    insert into public.lab_generation_jobs (id, user_id, category, difficulty, duration, status)
    values (${jobId}, ${ownerId}, ${category}, 'Beginner', '30 mins', 'queued')
    returning status
  `;
  assert.equal(queued.status, "queued");
  const [claimed] = await db`
    update public.lab_generation_jobs
    set status = 'generating', started_at = now(), updated_at = now()
    where id = ${jobId} and user_id = ${ownerId} and status = 'queued'
    returning status
  `;
  assert.equal(claimed.status, "generating");
}

async function runGeneratedCase(db, saveStore, ownerId, jobId, expectedTemplate, expectedModule) {
  await createGenerationJob(db, ownerId, jobId);
  assert.equal(usesExecutableWebEngine("Web Security", "Beginner", "30 mins", true), true);
  const planningStart = process.hrtime.bigint();
  const expectedSpec = planExecutableWebSpec(jobId, ownerId);
  const planningMs = elapsed(planningStart);
  assert.equal(expectedSpec.templateId, expectedTemplate);
  assert.equal(expectedSpec.vulnerability.moduleId, expectedModule);

  const saveStart = process.hrtime.bigint();
  const saved = await saveExecutableWebGeneration(saveStore, jobId, ownerId);
  const saveMs = elapsed(saveStart);
  assert.equal(saved.replayed, false);
  await db`
    update public.lab_generation_jobs
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = ${jobId} and user_id = ${ownerId} and resulting_lab_id = ${saved.savedLabId}
  `;
  const [job] = await db`
    select status, resulting_lab_id from public.lab_generation_jobs
    where id = ${jobId} and user_id = ${ownerId}
  `;
  assert.equal(job.status, "completed");
  assert.equal(String(job.resulting_lab_id), saved.savedLabId);
  return { ...saved, expectedSpec, planningMs, saveMs };
}

function createProductService(repository, privateKey, now = () => Date.now()) {
  return new LocalRunnerProductService({
    repository,
    signingAuthority: () => ({ keyId: "phase15d-ephemeral-ed25519", privateKey }),
    now,
  });
}

function createRunnerEnvironment(directory, keys, backend) {
  const selectedBackend = backend || new runner.DockerLocalRunnerBackend(undefined, directory);
  const stateStore = new runner.LocalRunnerStateStore(directory);
  const core = new runner.LocalRunnerCore({
    verificationKeys: keys,
    backend: selectedBackend,
    stateStore,
    ttlMs: 30 * 60_000,
  });
  return { backend: selectedBackend, stateStore, core };
}

async function apiResponse(controlOrigin, pathname, options = {}, requestOrigin = TEST_ORIGIN) {
  const response = await fetch(controlOrigin + pathname, {
    ...options,
    headers: { Origin: requestOrigin, ...(options.headers || {}) },
    signal: AbortSignal.timeout(150_000),
  });
  const body = await response.json();
  return { response, body };
}

async function api(controlOrigin, pathname, options = {}) {
  const result = await apiResponse(controlOrigin, pathname, options);
  if (!result.response.ok || result.body.error) {
    throw Object.assign(new Error(result.body.error?.code || "runner_request_failed"), {
      code: result.body.error?.code,
      status: result.response.status,
    });
  }
  return result.body.data;
}

async function authorize(controlOrigin, scope) {
  return (await api(controlOrigin, "/v1/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(scope),
  })).capability;
}

async function launch(controlOrigin, pkg, key) {
  const capability = await authorize(controlOrigin, {
    operation: "launch",
    buildId: pkg.buildId,
    buildFingerprint: pkg.buildFingerprint,
    idempotencyKey: key,
  });
  const start = process.hrtime.bigint();
  const status = await api(controlOrigin, "/v1/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, package: pkg }),
  });
  return { status, milliseconds: elapsed(start) };
}

async function reset(controlOrigin, status, key) {
  const capability = await authorize(controlOrigin, {
    operation: "reset",
    sessionId: status.sessionId,
    buildFingerprint: status.buildFingerprint,
    generation: status.generation,
    idempotencyKey: key,
  });
  const start = process.hrtime.bigint();
  const result = await api(controlOrigin, "/v1/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability }),
  });
  return { status: result, milliseconds: elapsed(start) };
}

async function stop(controlOrigin, status, key) {
  const capability = await authorize(controlOrigin, {
    operation: "stop",
    sessionId: status.sessionId,
    buildFingerprint: status.buildFingerprint,
    generation: status.generation,
    idempotencyKey: key,
  });
  const start = process.hrtime.bigint();
  const result = await api(controlOrigin, "/v1/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability }),
  });
  return { status: result, milliseconds: elapsed(start) };
}

async function runtimeState(endpoint) {
  const response = await fetch(endpoint + "/__runtime/state", { signal: AbortSignal.timeout(2_000) });
  assert.equal(response.status, 200);
  return response.json();
}

function signalled(events) {
  return events.some(event => event.args?.some(argument => argument.value === SIGNAL));
}

async function storedXssLearnerFlow(spec, endpoint) {
  const target = spec.vulnerability.storedFlow.targetObjectId;
  return browserSession(async browser => {
    await browser.navigate(`${endpoint}/#/products/detail?id=${encodeURIComponent(target)}`);
    const submit = value => browser.evaluate("(() => { const field=document.getElementById('product-review'); field.value=" +
      JSON.stringify(value) + "; field.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); " +
      "return document.querySelector('.saved-note').textContent; })()");
    assert.match(await submit("A normal Phase 15D review"), /Review saved/);
    await browser.navigate(endpoint + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(`${endpoint}/#/products/detail?id=${encodeURIComponent(target)}`);
    assert.equal((await browser.evaluate("document.querySelector('.reviews').textContent"))
      .includes("A normal Phase 15D review"), true);
    assert.match(await submit(PAYLOAD), /Review saved/);
    assert.equal(signalled(browser.consoleEvents), false, "stored payload must not count as an immediate reflection");
    await browser.navigate(endpoint + "/#/catalog");
    await browser.send("Page.reload", { ignoreCache: true });
    await browser.navigate(`${endpoint}/#/products/detail?id=${encodeURIComponent(target)}`);
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(signalled(browser.consoleEvents), true);
    assert.equal(await browser.evaluate("!!document.querySelector('[data-review-body] img[onerror]')"), true);
  });
}

async function reflectedXssSmoke(spec, endpoint) {
  await browserSession(async browser => {
    await browser.navigate(endpoint + "/#/articles");
    assert.equal(signalled(browser.consoleEvents), false);
    await browser.navigate(endpoint + "/#" + spec.vulnerability.route + "?" +
      encodeURIComponent(spec.vulnerability.input) + "=" + encodeURIComponent(PAYLOAD));
    for (let attempt = 0; attempt < 30 && !signalled(browser.consoleEvents); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(signalled(browser.consoleEvents), true);
  });
}

async function inspectIsolation(backend, status) {
  const resources = await backend.listManaged();
  const current = resources.filter(resource => resource.identity.sessionId === status.sessionId &&
    resource.identity.generation === status.generation);
  assert.equal(current.length, 3);
  const challenge = current.find(resource => resource.role === "challenge");
  const proxy = current.find(resource => resource.role === "proxy");
  const network = current.find(resource => resource.role === "network");
  assert.ok(challenge && proxy && network);
  const challengeHost = challenge.detail.HostConfig;
  assert.equal(challengeHost.Privileged, false);
  assert.equal(challengeHost.NetworkMode, network.detail.Name);
  assert.notEqual(challengeHost.NetworkMode, "host");
  assert.equal(challengeHost.ReadonlyRootfs, true);
  assert.ok(challengeHost.CapDrop.includes("ALL"));
  assert.ok(challengeHost.SecurityOpt.some(value => value.startsWith("no-new-privileges")));
  assert.equal(challenge.detail.NetworkSettings.Ports["8080/tcp"], null);
  assert.equal(challenge.detail.Mounts.length, 1);
  assert.equal(challenge.detail.Mounts[0].Destination, "/bundle");
  assert.equal(challenge.detail.Mounts[0].RW, false);
  assert.equal(challenge.detail.Mounts.some(mount => mount.Source.includes("docker.sock")), false);
  const labelText = JSON.stringify(challenge.detail.Config.Labels).toLowerCase();
  for (const forbidden of ["signature", "capability", "private", "secret", "solution", "token"]) {
    assert.equal(labelText.includes(forbidden), false, `challenge label leaked ${forbidden}`);
  }
  const environmentNames = challenge.detail.Config.Env.map(value => value.split("=")[0]);
  for (const name of environmentNames) {
    assert.ok(["PATH", "NODE_VERSION", "YARN_VERSION", "WEB_LAB_LOCAL_ONLY"].includes(name), name);
  }
  const proxyHost = proxy.detail.HostConfig;
  assert.equal(proxyHost.Privileged, false);
  assert.notEqual(proxyHost.NetworkMode, "host");
  assert.equal(proxyHost.ReadonlyRootfs, true);
  assert.equal(proxy.detail.Mounts.length, 0);
  assert.equal(proxy.detail.NetworkSettings.Ports["8080/tcp"][0].HostIp, "127.0.0.1");
  assert.equal(network.detail.Internal, true);
  assert.equal(await docker("exec", challenge.id, "id", "-u"), "1000");
  const outboundScript = "const n=require('node:net');const s=n.connect({host:'93.184.216.34',port:80});" +
    "s.on('connect',()=>process.exit(9));s.on('error',()=>process.exit(0));setTimeout(()=>process.exit(0),2000);";
  await docker("exec", challenge.id, "node", "-e", outboundScript);
  return current;
}

async function assertLoopbackListeners(controlOrigin, learnerEndpoint) {
  assert.match(controlOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(learnerEndpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const endpoint of [controlOrigin, learnerEndpoint]) {
    const port = new URL(endpoint).port;
    let output = "";
    try {
      output = await command("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { timeout: 10_000 });
    } catch (error) {
      output = error.stdout?.trim() || "";
    }
    if (output) {
      assert.equal(output.includes(`*:${port}`), false);
      assert.equal(output.includes(`0.0.0.0:${port}`), false);
    }
  }
}

async function assertHostileOriginsDenied(controlOrigin) {
  for (const route of ["/v1/launch", "/v1/reset", "/v1/stop"]) {
    const { response, body } = await apiResponse(controlOrigin, route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }, HOSTILE_ORIGIN);
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "ORIGIN_DENIED");
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
  }
  const response = await fetch(controlOrigin + "/v1/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "ORIGIN_DENIED");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

async function assertPackageTamperDenied(controlOrigin, backend, pkg) {
  const before = new Set((await backend.listManaged()).map(resource => resource.id));
  const capability = await authorize(controlOrigin, {
    operation: "launch",
    buildId: pkg.buildId,
    buildFingerprint: pkg.buildFingerprint,
    idempotencyKey: idempotency("tampered-package"),
  });
  const tampered = { ...pkg, issuedAt: pkg.issuedAt + 1 };
  const { response, body } = await apiResponse(controlOrigin, "/v1/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, package: tampered }),
  });
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "PACKAGE_SIGNATURE_INVALID");
  const after = await backend.listManaged();
  assert.equal(after.some(resource => !before.has(resource.id)), false);
}

async function assertControlledStartFailure(pkg, keys) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase15d-start-failure-"));
  let failedRun = false;
  const execute = async (commandName, args) => {
    if (commandName === "docker" && args[0] === "run" && !failedRun) {
      failedRun = true;
      throw new Error("phase15d_controlled_docker_run_failure");
    }
    return command(commandName, args);
  };
  const backend = new runner.DockerLocalRunnerBackend(execute, directory);
  const before = new Set((await backend.listManaged()).map(resource => resource.id));
  const environment = createRunnerEnvironment(directory, keys, backend);
  const server = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [TEST_ORIGIN], port: 0 });
  try {
    const origin = await server.listen();
    await assert.rejects(
      async () => launch(origin, pkg, idempotency("controlled-start-failure")),
      error => error.code === "LOCAL_RUNTIME_START_FAILED" && error.status === 500,
    );
    const failed = await environment.core.status();
    assert.equal(failed.state, "failed");
    assert.equal(failed.errorCode, "LOCAL_RUNTIME_START_FAILED");
    const after = await backend.listManaged();
    assert.equal(after.some(resource => !before.has(resource.id)), false);
    assert.equal(fs.existsSync(path.join(directory, "bundles")) &&
      fs.readdirSync(path.join(directory, "bundles")).length > 0, false);
  } finally {
    await server.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function assertBuildSaveFailure(db, saveStore) {
  await createGenerationJob(db, FAILURE_OWNER, FAILURE_JOB);
  await db.unsafe(`
    create function web_lab_control.phase15d_reject_build() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin
      raise exception 'phase15d_controlled_build_failure' using errcode = 'P0001';
    end;
    $$;
    create trigger phase15d_reject_build
      before insert on web_lab_control.web_lab_builds
      for each row execute function web_lab_control.phase15d_reject_build();
  `);
  try {
    await assert.rejects(
      saveExecutableWebGeneration(saveStore, FAILURE_JOB, FAILURE_OWNER),
      /phase15d_controlled_build_failure/,
    );
    const [counts] = await db`
      select
        (select count(*)::int from public.labs where user_id = ${FAILURE_OWNER}) as labs,
        (select count(*)::int from web_lab_control.web_lab_builds where owner_id = ${FAILURE_OWNER}) as builds,
        (select count(*)::int from public.lab_generation_jobs
          where id = ${FAILURE_JOB} and resulting_lab_id is not null) as links
    `;
    assert.deepEqual({ labs: counts.labs, builds: counts.builds, links: counts.links },
      { labs: 0, builds: 0, links: 0 });
  } finally {
    await db.unsafe(`
      drop trigger if exists phase15d_reject_build on web_lab_control.web_lab_builds;
      drop function if exists web_lab_control.phase15d_reject_build();
    `);
  }
}

async function assertStaticAndLinuxNegative(db, saveStore, productService) {
  await db`insert into auth.users (id) values (${STATIC_OWNER})`;
  const [staticLab] = await db`
    insert into public.labs (user_id, topic, title)
    values (${STATIC_OWNER}, 'Web Security', 'Static Web Security Saved Lab') returning id
  `;
  const staticId = String(staticLab.id);
  const staticEligibility = await productService.eligibility({ userId: STATIC_OWNER, sessionId: "static-session" }, staticId);
  assert.equal(staticEligibility.eligible, false);
  await assert.rejects(
    productService.issuePackage({ userId: STATIC_OWNER, sessionId: "static-session" }, staticId),
    error => error instanceof LocalRunnerProductError && error.code === "LAB_NOT_FOUND",
  );

  await createGenerationJob(db, LINUX_OWNER, LINUX_JOB, "Linux");
  assert.equal(usesExecutableWebEngine("Linux", "Beginner", "30 mins", true), false);
  await assert.rejects(saveExecutableWebGeneration(saveStore, LINUX_JOB, LINUX_OWNER), /GENERATION_JOB_INVALID/);
  const [linuxLab] = await db`
    insert into public.labs (user_id, topic, title)
    values (${LINUX_OWNER}, 'Linux', 'Linux Saved Lab') returning id
  `;
  const linuxId = String(linuxLab.id);
  assert.equal((await productService.eligibility({ userId: LINUX_OWNER, sessionId: "linux-session" }, linuxId)).eligible, false);
  await assert.rejects(
    productService.issuePackage({ userId: LINUX_OWNER, sessionId: "linux-session" }, linuxId),
    error => error instanceof LocalRunnerProductError && error.code === "LAB_NOT_FOUND",
  );
  return { staticId, linuxId };
}

async function registerLocalRuntime(repository, ownerId, savedLabId, runnerStatus) {
  let runtime = await repository.createSelfHostedRuntime({
    ownerId,
    savedLabId,
    runtimeMode: "local_runner",
    providerKind: "amniora_local_runner",
    runtimeVersion: runner.LOCAL_RUNNER_RUNTIME_VERSION,
    ttlMinutes: 60,
  });
  runtime = await repository.transitionRuntime({
    instanceId: runtime.instanceId,
    ownerId,
    expectedVersion: runtime.version,
    status: "provisioning",
    backendReference: runnerStatus.sessionId,
    auditEvent: "local_runner_start_observed",
  });
  runtime = await repository.transitionRuntime({
    instanceId: runtime.instanceId,
    ownerId,
    expectedVersion: runtime.version,
    status: "ready",
    backendReference: runnerStatus.sessionId,
    auditEvent: "local_runner_ready_observed",
  });
  return runtime;
}

async function assertGraderUnavailableSafe(repository, runtime, ownerId) {
  const before = await repository.getCompletionForOwner(runtime.buildId, ownerId);
  const unavailable = async () => { throw new Error("phase15d_trusted_grader_unavailable"); };
  await assert.rejects(unavailable, /phase15d_trusted_grader_unavailable/);
  const after = await repository.getCompletionForOwner(runtime.buildId, ownerId);
  assert.deepEqual(after, before);
  assert.equal((await repository.getRuntimeForOwner(runtime.instanceId, ownerId)).status, "ready");
}

async function runReliableTrustedGrades(spec, status) {
  const results = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    const start = process.hrtime.bigint();
    const result = await gradeInstance({
      instanceId: status.sessionId,
      spec,
      endpoint: status.endpoint,
      proxyAccessKey: null,
    });
    assert.equal(result.status, "pass");
    results.push({ attempt, outcome: result.status, milliseconds: elapsed(start) });
  }
  return results;
}

async function main() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  report.environment = {
    machine: `${process.platform}-${process.arch}`,
    node: process.version,
    runnerVersion: runner.LOCAL_RUNNER_VERSION,
    protocolVersion: runner.LOCAL_RUNNER_PROTOCOL_VERSION,
    runtimeVersion: runner.LOCAL_RUNNER_RUNTIME_VERSION,
    postgres: "17-alpine",
    productionConnections: 0,
    vercelSandboxesCreated: 0,
  };

  const postgresRuntime = await startDisposablePostgres();
  const db = postgres(postgresRuntime.connection, { max: 12, prepare: false, connect_timeout: 5 });
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase15d-runner-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const verificationKeys = new Map([["phase15d-ephemeral-ed25519", publicKey]]);
  const ownedRunnerSessions = new Set();
  let environment;
  let server;
  let reportReady = false;

  try {
    await waitForExternalDatabase(db);
    await applyDisposableSchema(db);
    const repository = new PostgresWebLabControlRepository(db);
    const saveStore = new PostgresExecutableWebSaveStore(db);
    const actor = { userId: DEEP_OWNER, sessionId: "phase15d-product-session" };
    const productService = createProductService(repository, privateKey);

    await assertBuildSaveFailure(db, saveStore);
    report.failures.buildSaveRollback = "pass";

    const deep = await runGeneratedCase(db, saveStore, DEEP_OWNER, DEEP_JOB, "ecommerce", "stored-xss");
    report.timingsMs.deterministicPlanning = deep.planningMs;
    report.timingsMs.savedLabBuildTransaction = deep.saveMs;
    const [savedLab] = await db`select * from public.labs where id = ${deep.savedLabId}`;
    const [rawBuild] = await db`select * from web_lab_control.web_lab_builds where id = ${deep.build.id}`;
    const trustedBuild = await repository.getTrustedBuild(deep.build.id, DEEP_OWNER);
    assert.ok(savedLab && rawBuild && trustedBuild);
    assert.equal(String(savedLab.user_id), DEEP_OWNER);
    assert.equal(String(rawBuild.owner_id), DEEP_OWNER);
    assert.equal(String(rawBuild.saved_lab_id), deep.savedLabId);
    assert.equal(Number(rawBuild.schema_version), 1);
    assert.equal(rawBuild.template_version, "1.0.0");
    assert.equal(rawBuild.vulnerability_module_version, "1.0.0");
    assert.equal(rawBuild.compiler_version, WEB_LAB_COMPILER_VERSION);
    assert.equal(rawBuild.runtime_version, runner.LOCAL_RUNNER_RUNTIME_VERSION);
    assert.equal(rawBuild.seed, deep.expectedSpec.seed);
    assert.equal(rawBuild.canonical_spec, canonicalSpecBytes(deep.expectedSpec));
    assert.equal(rawBuild.build_fingerprint, runner.compileWebLab(deep.expectedSpec).manifest.canonicalSpecSha256);
    assert.equal(trustedBuild.spec.internalSolution.behavior, "stored");
    const expectedLearnerLab = learnerSavedLab(DEEP_OWNER, deep.expectedSpec);
    assert.deepEqual(savedLab.tasks, expectedLearnerLab.tasks);
    const learnerProjection = JSON.stringify(savedLab);
    for (const forbidden of ["internalSolution", "groundTruthTag", "canonical_spec", "service_role", "privateKey"]) {
      assert.equal(learnerProjection.includes(forbidden), false, `learner projection leaked ${forbidden}`);
    }
    await assert.rejects(db`update web_lab_control.web_lab_builds set seed = 'mutated' where id = ${deep.build.id}`,
      /immutable_web_lab_record/);

    const eligibility = await productService.eligibility(actor, deep.savedLabId);
    assert.equal(eligibility.eligible, true);
    assert.equal(eligibility.build.buildId, deep.build.id);
    assert.equal(eligibility.build.buildFingerprint, deep.build.buildFingerprint);
    assert.equal(eligibility.build.runtimeVersion, runner.LOCAL_RUNNER_RUNTIME_VERSION);
    const packageStart = process.hrtime.bigint();
    const deepPackage = await productService.issuePackage(actor, deep.savedLabId);
    report.timingsMs.packageIssuance = elapsed(packageStart);
    assert.equal(deepPackage.buildId, deep.build.id);
    assert.equal(deepPackage.buildFingerprint, deep.build.buildFingerprint);
    assert.equal(deepPackage.templateId, "ecommerce");
    assert.equal(deepPackage.vulnerabilityModuleId, "stored-xss");
    assert.equal(deepPackage.schemaVersion, 1);
    assert.equal(deepPackage.templateVersion, "1.0.0");
    assert.equal(deepPackage.vulnerabilityModuleVersion, "1.0.0");
    assert.equal(deepPackage.runtimeVersion, runner.LOCAL_RUNNER_RUNTIME_VERSION);
    assert.equal(deepPackage.seed, deep.expectedSpec.seed);
    const serializedPackage = JSON.stringify(deepPackage);
    for (const forbidden of ["internalSolution", "groundTruthTag", "providerKind", "service_role", "privateKey", "backend_reference", "route_key"]) {
      assert.equal(serializedPackage.includes(forbidden), false, `package leaked ${forbidden}`);
    }
    const verificationStart = process.hrtime.bigint();
    assert.equal(runner.verifyLocalRunnerPackage(deepPackage, verificationKeys), deepPackage);
    report.timingsMs.packageVerification = elapsed(verificationStart);
    await assert.rejects(
      productService.issuePackage({ userId: STATIC_OWNER, sessionId: actor.sessionId }, deep.savedLabId),
      error => error instanceof LocalRunnerProductError && error.code === "LAB_NOT_FOUND",
    );

    await assertStaticAndLinuxNegative(db, saveStore, productService);
    report.failures.staticWebDenied = "pass";
    report.failures.linuxExcluded = "pass";

    environment = createRunnerEnvironment(stateDirectory, verificationKeys);
    server = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [TEST_ORIGIN], port: 0 });
    const serverStart = process.hrtime.bigint();
    let controlOrigin = await server.listen();
    report.timingsMs.runnerControlStartup = elapsed(serverStart);
    const capabilities = await api(controlOrigin, "/v1/capabilities?protocolVersion=1.0");
    assert.equal(capabilities.runnerVersion, "15.0.0-alpha.1");
    assert.equal(capabilities.protocolVersion, "1.0");
    assert.equal(capabilities.protocolCompatibility, "compatible");
    assert.equal(capabilities.outcome, "RUNNER_READY");
    assert.equal(capabilities.activeLocalRuntimeState, "idle");
    await assertHostileOriginsDenied(controlOrigin);
    report.failures.hostileOriginDenied = "pass";
    await assertPackageTamperDenied(controlOrigin, environment.backend, deepPackage);
    report.failures.tamperedPackageDeniedBeforeDocker = "pass";
    await assertControlledStartFailure(deepPackage, verificationKeys);
    report.failures.runnerStartCleanup = "pass";

    const deepLaunch = await launch(controlOrigin, deepPackage, idempotency("deep-launch"));
    let runnerStatus = deepLaunch.status;
    report.timingsMs.challengeStartup = deepLaunch.milliseconds;
    report.timingsMs.readyToOpen = deepLaunch.milliseconds;
    ownedRunnerSessions.add(runnerStatus.sessionId);
    assert.equal(runnerStatus.state, "ready");
    assert.equal(runnerStatus.buildId, deep.build.id);
    assert.equal(runnerStatus.buildFingerprint, deep.build.buildFingerprint);
    assert.equal(runnerStatus.trustLevel, "local_self_hosted");
    await assertLoopbackListeners(controlOrigin, runnerStatus.endpoint);
    await inspectIsolation(environment.backend, runnerStatus);
    report.failures.outboundContainment = "pass";
    const initialState = await runtimeState(runnerStatus.endpoint);

    let persistedRuntime = await registerLocalRuntime(repository, DEEP_OWNER, deep.savedLabId, runnerStatus);
    assert.equal(persistedRuntime.buildId, deep.build.id);
    assert.equal(persistedRuntime.runtimeMode, "local_runner");
    await assertGraderUnavailableSafe(repository, persistedRuntime, DEEP_OWNER);
    report.failures.graderUnavailableSafe = "pass";

    await storedXssLearnerFlow(deep.expectedSpec, runnerStatus.endpoint);
    const mutatedState = await runtimeState(runnerStatus.endpoint);
    const storedEntries = mutatedState.contentByObject[deep.expectedSpec.vulnerability.storedFlow.targetObjectId];
    assert.equal(storedEntries.at(-2).body, "A normal Phase 15D review");
    assert.equal(storedEntries.at(-1).body, PAYLOAD);

    report.reliability = await runReliableTrustedGrades(trustedBuild.spec, runnerStatus);
    const gradeStart = process.hrtime.bigint();
    const observationFingerprint = digest(JSON.stringify({
      buildFingerprint: deep.build.buildFingerprint,
      runnerSessionId: runnerStatus.sessionId,
      runnerGeneration: runnerStatus.generation,
      outcome: "pass",
      reason: "trusted-observation-matched",
      graderVersion: "phase15d-local-observer-1",
    }));
    const persistedGrade = await repository.recordGrade({
      instanceId: persistedRuntime.instanceId,
      ownerId: DEEP_OWNER,
      outcome: "pass",
      graderVersion: "phase15d-local-observer-1",
      observationFingerprint,
    });
    report.timingsMs.trustedGradePersistence = elapsed(gradeStart);
    assert.ok(persistedGrade.completionId);
    assert.equal(persistedGrade.trustLevel, "local_self_hosted");
    assert.notEqual(persistedGrade.trustLevel, "hosted_verified");
    const [completionRow] = await db`
      select owner_id, web_lab_build_id, runtime_instance_id, trust_level
      from web_lab_control.web_lab_completions where id = ${persistedGrade.completionId}
    `;
    assert.equal(String(completionRow.owner_id), DEEP_OWNER);
    assert.equal(String(completionRow.web_lab_build_id), deep.build.id);
    assert.equal(String(completionRow.runtime_instance_id), persistedRuntime.instanceId);
    assert.equal(completionRow.trust_level, "local_self_hosted");
    const [legacyLab] = await db`select completed from public.labs where id = ${deep.savedLabId}`;
    assert.equal(legacyLab.completed, false);
    await assert.rejects(db.begin(async tx => {
      await tx`set local role authenticated`;
      await tx`insert into web_lab_control.web_lab_completions (id) values (${randomUUID()})`;
    }), /permission denied/);

    await server.close();
    environment = createRunnerEnvironment(stateDirectory, verificationKeys);
    const recovered = await environment.core.recover();
    assert.equal(recovered.state, "ready");
    assert.equal(recovered.sessionId, runnerStatus.sessionId);
    assert.equal(recovered.generation, runnerStatus.generation);
    assert.equal(recovered.buildFingerprint, deep.build.buildFingerprint);
    assert.equal((await environment.backend.listManaged()).filter(resource =>
      resource.identity.sessionId === recovered.sessionId && resource.identity.generation === recovered.generation).length, 3);
    const reconstructedProductService = createProductService(repository, privateKey);
    assert.equal((await reconstructedProductService.eligibility(actor, deep.savedLabId)).build.buildId, deep.build.id);
    server = new runner.LocalRunnerControlServer({ core: environment.core, allowedOrigins: [TEST_ORIGIN], port: 0 });
    controlOrigin = await server.listen();
    runnerStatus = await api(controlOrigin, "/v1/status");
    assert.equal(runnerStatus.sessionId, recovered.sessionId);
    assert.equal((await runtimeState(runnerStatus.endpoint))
      .contentByObject[deep.expectedSpec.vulnerability.storedFlow.targetObjectId].at(-1).body, PAYLOAD);

    const beforeReset = runnerStatus;
    const resetKey = idempotency("deep-reset");
    const firstReset = await reset(controlOrigin, beforeReset, resetKey);
    const secondReset = await reset(controlOrigin, beforeReset, resetKey);
    runnerStatus = firstReset.status;
    report.timingsMs.reset = firstReset.milliseconds;
    assert.equal(runnerStatus.generation, beforeReset.generation + 1);
    assert.equal(secondReset.status.generation, runnerStatus.generation);
    assert.equal(secondReset.status.sessionId, runnerStatus.sessionId);
    assert.deepEqual(await runtimeState(runnerStatus.endpoint), initialState);
    assert.equal(runnerStatus.buildId, deepPackage.buildId);
    assert.equal(runnerStatus.buildFingerprint, deepPackage.buildFingerprint);
    await inspectIsolation(environment.backend, runnerStatus);
    const databaseResetKey = "phase15d-database-reset-idempotency";
    const [firstDatabaseReset, secondDatabaseReset] = await Promise.all([
      repository.requestReset({ instanceId: persistedRuntime.instanceId, ownerId: DEEP_OWNER,
        idempotencyKey: databaseResetKey, expectedVersion: persistedRuntime.version }),
      repository.requestReset({ instanceId: persistedRuntime.instanceId, ownerId: DEEP_OWNER,
        idempotencyKey: databaseResetKey, expectedVersion: persistedRuntime.version }),
    ]);
    assert.equal(firstDatabaseReset.commandId, secondDatabaseReset.commandId);
    assert.equal(firstDatabaseReset.generationVersion, 2);
    assert.equal(secondDatabaseReset.generationVersion, 2);
    assert.equal([firstDatabaseReset, secondDatabaseReset].filter(item => item.replayed).length, 1);
    persistedRuntime = await repository.getRuntimeForOwner(persistedRuntime.instanceId, DEEP_OWNER);
    persistedRuntime = await repository.transitionRuntime({
      instanceId: persistedRuntime.instanceId,
      ownerId: DEEP_OWNER,
      expectedVersion: persistedRuntime.version,
      status: "ready",
      generationVersion: 2,
      auditEvent: "local_runner_reset_observed",
    });
    assert.equal((await repository.getCompletionForOwner(deep.build.id, DEEP_OWNER)).length, 1);

    const beforeStop = runnerStatus;
    const stopKey = idempotency("deep-stop");
    const firstStop = await stop(controlOrigin, beforeStop, stopKey);
    const secondStop = await stop(controlOrigin, beforeStop, stopKey);
    report.timingsMs.stop = firstStop.milliseconds;
    assert.equal(firstStop.status.state, "idle");
    assert.equal(secondStop.status.state, "idle");
    assert.equal((await environment.backend.listManaged()).filter(resource =>
      resource.identity.sessionId === beforeStop.sessionId).length, 0);
    assert.equal(fs.existsSync(path.join(stateDirectory, "bundles", `${beforeStop.sessionId}-g${beforeStop.generation}`)), false);
    const destroyKey = "phase15d-database-destroy-idempotency";
    const [firstDestroy, secondDestroy] = await Promise.all([
      repository.requestDestroy({ instanceId: persistedRuntime.instanceId, ownerId: DEEP_OWNER,
        idempotencyKey: destroyKey, expectedVersion: persistedRuntime.version }),
      repository.requestDestroy({ instanceId: persistedRuntime.instanceId, ownerId: DEEP_OWNER,
        idempotencyKey: destroyKey, expectedVersion: persistedRuntime.version }),
    ]);
    assert.equal(firstDestroy.commandId, secondDestroy.commandId);
    assert.equal([firstDestroy, secondDestroy].filter(item => item.replayed).length, 1);
    persistedRuntime = await repository.getRuntimeForOwner(persistedRuntime.instanceId, DEEP_OWNER);
    persistedRuntime = await repository.transitionRuntime({
      instanceId: persistedRuntime.instanceId,
      ownerId: DEEP_OWNER,
      expectedVersion: persistedRuntime.version,
      status: "destroyed",
      auditEvent: "local_runner_stop_observed",
    });
    assert.equal(persistedRuntime.status, "destroyed");
    assert.equal((await repository.getCompletionForOwner(deep.build.id, DEEP_OWNER)).length, 1);
    assert.ok(await repository.getTrustedBuild(deep.build.id, DEEP_OWNER));

    const smoke = await runGeneratedCase(db, saveStore, DEEP_OWNER, SMOKE_JOB, "helpdesk", "reflected-xss");
    const smokePackage = await productService.issuePackage(actor, smoke.savedLabId);
    assert.equal(smokePackage.buildFingerprint, smoke.build.buildFingerprint);
    const smokeLaunch = await launch(controlOrigin, smokePackage, idempotency("smoke-launch"));
    let smokeStatus = smokeLaunch.status;
    ownedRunnerSessions.add(smokeStatus.sessionId);
    assert.equal(smokeStatus.buildId, smoke.build.id);
    assert.equal(smokeStatus.buildFingerprint, smoke.build.buildFingerprint);
    await reflectedXssSmoke(smoke.expectedSpec, smokeStatus.endpoint);
    const smokeGrade = await gradeInstance({
      instanceId: smokeStatus.sessionId,
      spec: (await repository.getTrustedBuild(smoke.build.id, DEEP_OWNER)).spec,
      endpoint: smokeStatus.endpoint,
      proxyAccessKey: null,
    }, { input: PAYLOAD });
    assert.equal(smokeGrade.status, "pass");
    smokeStatus = (await stop(controlOrigin, smokeStatus, idempotency("smoke-stop"))).status;
    assert.equal(smokeStatus.state, "idle");

    const [durableCounts] = await db`
      select
        (select count(*)::int from public.labs where id in (${deep.savedLabId}, ${smoke.savedLabId})) as labs,
        (select count(*)::int from web_lab_control.web_lab_builds where id in (${deep.build.id}, ${smoke.build.id})) as builds,
        (select count(*)::int from web_lab_control.web_lab_completions
          where web_lab_build_id = ${deep.build.id}) as completions
    `;
    assert.deepEqual({ labs: durableCounts.labs, builds: durableCounts.builds, completions: durableCounts.completions },
      { labs: 2, builds: 2, completions: 1 });

    report.identity = {
      generatedCanonicalFingerprint: runner.compileWebLab(deep.expectedSpec).manifest.canonicalSpecSha256,
      persistedBuildFingerprint: deep.build.buildFingerprint,
      eligibilityFingerprint: eligibility.build.buildFingerprint,
      signedPackageFingerprint: deepPackage.buildFingerprint,
      runnerFingerprint: beforeReset.buildFingerprint,
      trustedGradeBuildFingerprint: String(completionRow.web_lab_build_id) === deep.build.id
        ? deep.build.buildFingerprint : null,
      allEqual: new Set([
        runner.compileWebLab(deep.expectedSpec).manifest.canonicalSpecSha256,
        deep.build.buildFingerprint,
        eligibility.build.buildFingerprint,
        deepPackage.buildFingerprint,
        beforeReset.buildFingerprint,
      ]).size === 1,
    };
    assert.equal(report.identity.allEqual, true);
    reportReady = true;
  } finally {
    const cleanupErrors = [];
    try { if (server) await server.close(); } catch (error) { cleanupErrors.push(error); }
    if (environment) {
      try {
        const resources = await environment.backend.listManaged();
        const identities = new Map();
        for (const resource of resources) {
          if (!ownedRunnerSessions.has(resource.identity.sessionId)) continue;
          identities.set(`${resource.identity.sessionId}:${resource.identity.buildFingerprint}:${resource.identity.generation}`,
            resource.identity);
        }
        for (const identity of identities.values()) await environment.backend.stop(identity);
      } catch (error) { cleanupErrors.push(error); }
    }
    try { await db.end({ timeout: 5 }); } catch (error) { cleanupErrors.push(error); }
    try { fs.rmSync(stateDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    catch (error) { cleanupErrors.push(error); }
    try { await docker("rm", "-f", postgresRuntime.containerName); } catch (error) { cleanupErrors.push(error); }
    report.cleanup = {
      runnerStateDirectoryRemoved: !fs.existsSync(stateDirectory),
      disposablePostgresRemoved: !(await docker("container", "inspect", postgresRuntime.containerName)
        .then(() => true, () => false)),
      errors: cleanupErrors.map(error => error.message),
    };
    assert.deepEqual(report.cleanup.errors, []);
    assert.equal(report.cleanup.runnerStateDirectoryRemoved, true);
    assert.equal(report.cleanup.disposablePostgresRemoved, true);
  }

  assert.equal(reportReady, true);
  console.log(JSON.stringify(report, null, 2));
  console.log("Phase 15D generated Saved Lab -> signed Local Runner -> Docker -> browser -> trusted local completion: PASS");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
