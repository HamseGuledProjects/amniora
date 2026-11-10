#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated direct-Postgres rehearsal harness. */
"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash, randomBytes, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { promisify } = require("node:util");
const postgres = require("postgres");

const ROOT = path.resolve(__dirname, "../../..");
const BASELINE = path.join(__dirname, "schema-rehearsal-baseline.sql");
const LABEL = "com.amniora.phase1-schema-rehearsal=true";
const DATABASES = {
  fresh: "amniora_phase1_fresh",
  upgrade: "amniora_phase1_upgrade",
  missing: "amniora_phase1_missing_prerequisite",
  mismatch: "amniora_phase1_jsonb_mismatch",
  phase12: "amniora_phase12_test",
  phase13: "amniora_phase13_test",
};
const MIGRATIONS = [
  "supabase/migrations/20260725020800_ai_content_consents.sql",
  "supabase/migrations/20260727090000_atomic_ai_usage_reservations.sql",
  "supabase/migrations/20260731100000_linux_grading_usage_and_consent.sql",
  "supabase/migrations/20260901090000_lab_generation_jobs.sql",
  "supabase/migrations/20260922211651_web_lab_control_plane_persistence.sql",
  "supabase/migrations/20260922215508_web_lab_launch_grant_exchange.sql",
  "supabase/migrations/20260927213116_detach_deleted_saved_investigations.sql",
];
const PRE_RUNTIME_MIGRATIONS = MIGRATIONS.slice(0, 4);
const RUNTIME_MIGRATIONS = MIGRATIONS.slice(4);
const execFileAsync = promisify(execFile);
const fingerprint = value => createHash("sha256").update(value).digest("hex");

const originalLoad = Module._load;
Module._load = function serverOnlyRehearsalBoundary(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};
require(path.join(ROOT, "tests/web-lab/phase15a/loadRunner.js"));
const {
  planExecutableWebSpec,
  saveExecutableWebGeneration,
} = require(path.join(ROOT, "lib/web-lab/generated-executable-lab.ts"));
const { PostgresExecutableWebSaveStore } =
  require(path.join(ROOT, "lib/web-lab/generated-executable-postgres.ts"));
const { PostgresWebLabControlRepository } =
  require(path.join(ROOT, "lib/web-lab/postgres-control-repository.ts"));

function migrationSource(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function safeEnvironment(extra = {}) {
  return { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", ...extra };
}

async function command(program, args, options = {}) {
  return execFileAsync(program, args, {
    cwd: ROOT,
    timeout: options.timeout ?? 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: options.env ?? safeEnvironment(),
  });
}

async function docker(...args) {
  const result = await command("docker", args);
  return result.stdout.trim();
}

function quoteIdentifier(value) {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error("invalid_test_database_name");
  return `"${value}"`;
}

function databaseUrl(port, password, database) {
  return `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
}

function connect(connection, max) {
  return postgres(connection, { max, prepare: false, onnotice: () => undefined });
}

async function waitForPostgres(containerName) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const result = await docker(
        "exec", containerName, "psql", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-Atqc", "select 1",
      );
      if (result !== "1") throw new Error("phase1_internal_postgres_probe_failed");
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("phase1_postgres_not_ready");
}

async function waitForExternalPostgres(connection) {
  const probe = connect(connection, 1);
  let lastError;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const [row] = await probe`select 1 as ready`;
        if (row.ready !== 1) throw new Error("phase1_external_postgres_probe_failed");
        return;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw lastError || new Error("phase1_external_postgres_not_ready");
  } finally {
    await probe.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function startPostgres() {
  const suffix = `${process.pid}-${randomBytes(6).toString("hex")}`;
  const containerName = `amniora-phase1-schema-rehearsal-${suffix}`;
  const volumeName = `amniora-phase1-schema-rehearsal-${suffix}`;
  const password = randomBytes(32).toString("base64url");
  let volumeCreated = false;
  try {
    await docker("volume", "create", "--label", LABEL, volumeName);
    volumeCreated = true;
    await docker(
      "run", "-d", "--name", containerName, "--label", LABEL,
      "-e", `POSTGRES_PASSWORD=${password}`,
      "-p", "127.0.0.1::5432",
      "--mount", `type=volume,source=${volumeName},target=/var/lib/postgresql/data`,
      "postgres:17-alpine",
    );
    await waitForPostgres(containerName);
    const binding = await docker("port", containerName, "5432/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error("phase1_postgres_not_loopback");
    const port = Number(match[1]);
    await waitForExternalPostgres(databaseUrl(port, password, "postgres"));
    return { containerName, volumeName, password, port };
  } catch (error) {
    await docker("rm", "-f", "-v", containerName).catch(() => undefined);
    if (volumeCreated) await docker("volume", "rm", "-f", volumeName).catch(() => undefined);
    throw error;
  }
}

async function cleanupPostgres(resource) {
  if (!resource) return;
  await docker("rm", "-f", "-v", resource.containerName).catch(() => undefined);
  await docker("volume", "rm", "-f", resource.volumeName).catch(() => undefined);
}

async function createDatabase(admin, name) {
  await admin.unsafe(`create database ${quoteIdentifier(name)}`);
}

async function dropDatabase(admin, name) {
  await admin`select pg_terminate_backend(pid) from pg_stat_activity
    where datname = ${name} and pid <> pg_backend_pid()`;
  await admin.unsafe(`drop database if exists ${quoteIdentifier(name)}`);
}

async function applyBaseline(db, options = {}) {
  let source = fs.readFileSync(BASELINE, "utf8");
  if (options.textArrays === true) {
    source = source
      .replace("tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array')",
        "tasks text[] not null default '{}'::text[]")
      .replace("hints jsonb not null default '[]'::jsonb check (jsonb_typeof(hints) = 'array')",
        "hints text[] not null default '{}'::text[]")
      .replace("outcomes jsonb not null default '[]'::jsonb check (jsonb_typeof(outcomes) = 'array')",
        "outcomes text[] not null default '{}'::text[]");
  }
  await db.unsafe(source);
}

async function applyMigrations(db, migrations) {
  for (const relative of migrations) {
    await db.begin(async tx => tx.unsafe(migrationSource(relative)));
  }
}

async function prepareDatabase(resource, admin, name, migrations = MIGRATIONS, options = {}) {
  await createDatabase(admin, name);
  const db = connect(databaseUrl(resource.port, resource.password, name), 24);
  try {
    await applyBaseline(db, options);
    await applyMigrations(db, migrations);
    return db;
  } catch (error) {
    await db.end({ timeout: 5 }).catch(() => undefined);
    await dropDatabase(admin, name).catch(() => undefined);
    throw error;
  }
}

async function expectRejected(operation, predicate, label) {
  let rejected = false;
  try {
    await operation();
  } catch (error) {
    rejected = predicate(error);
  }
  assert.equal(rejected, true, label);
}

async function inspectSchema(db) {
  const labColumns = await db`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'labs'
    order by ordinal_position
  `;
  const labTypes = Object.fromEntries(labColumns.map(row => [row.column_name, row.data_type]));
  assert.deepEqual(Object.keys(labTypes), [
    "id", "user_id", "title", "topic", "difficulty", "estimated_time", "objective",
    "scenario", "tasks", "hints", "outcomes", "completed",
  ]);
  assert.equal(labTypes.id, "uuid");
  assert.equal(labTypes.user_id, "uuid");
  assert.equal(labTypes.tasks, "jsonb");
  assert.equal(labTypes.hints, "jsonb");
  assert.equal(labTypes.outcomes, "jsonb");
  assert.equal(labTypes.completed, "boolean");

  const jobColumns = await db`
    select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_generation_jobs'
    order by ordinal_position
  `;
  assert.deepEqual(jobColumns.map(row => row.column_name), [
    "id", "user_id", "category", "difficulty", "duration", "status", "resulting_lab_id",
    "usage_reservation_id", "safe_error_code", "safe_error_message", "retryable", "created_at",
    "updated_at", "started_at", "completed_at", "failed_at", "expires_at",
  ]);

  const buildColumns = await db`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'web_lab_control' and table_name = 'web_lab_builds'
    order by ordinal_position
  `;
  for (const required of [
    "id", "saved_lab_id", "owner_id", "canonical_lab_id", "schema_version", "template_id",
    "template_version", "vulnerability_module_id", "vulnerability_module_version", "seed",
    "compiler_version", "runtime_version", "build_fingerprint", "learner_bundle_fingerprint",
    "canonical_spec", "derived_from_build_id", "created_at",
  ]) assert.ok(buildColumns.some(row => row.column_name === required), `missing build column ${required}`);
  assert.equal(buildColumns.find(row => row.column_name === "saved_lab_id").is_nullable, "YES");

  const controlTables = await db`
    select table_name from information_schema.tables
    where table_schema = 'web_lab_control' and table_type = 'BASE TABLE'
    order by table_name
  `;
  assert.deepEqual(controlTables.map(row => row.table_name), [
    "runtime_admission", "runtime_admission_slots", "runtime_audit_events", "runtime_budget_policy",
    "runtime_commands", "runtime_instances", "runtime_launch_exchanges", "runtime_usage",
    "web_lab_builds", "web_lab_completions", "web_lab_grade_attempts",
  ]);

  const triggers = await db`
    select event_object_table, trigger_name
    from information_schema.triggers
    where trigger_schema = 'web_lab_control'
    order by event_object_table, trigger_name
  `;
  const triggerNames = new Set(triggers.map(row => row.trigger_name));
  for (const required of [
    "web_lab_builds_immutable", "runtime_instances_guard_update", "runtime_audit_events_append_only",
    "runtime_usage_append_only", "web_lab_grade_attempts_append_only",
    "web_lab_completions_append_only", "web_lab_completions_trusted_grade",
    "runtime_launch_exchanges_append_only",
  ]) assert.ok(triggerNames.has(required), `missing trigger ${required}`);

  const [slots] = await db`select count(*)::int as count from web_lab_control.runtime_admission_slots`;
  const [policy] = await db`select hosted_runtime_enabled, budget_state from web_lab_control.runtime_budget_policy`;
  assert.equal(slots.count, 5);
  assert.equal(policy.hosted_runtime_enabled, false);
  assert.equal(policy.budget_state, "DISABLED");

  const rls = await db`
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'web_lab_control' and c.relkind = 'r'
  `;
  assert.ok(rls.length === 11 && rls.every(row => row.relrowsecurity === true));

  const constraints = await db`
    select conrelid::regclass::text as table_name, conname, contype,
      pg_get_constraintdef(oid) as definition
    from pg_constraint
    where connamespace in ('public'::regnamespace, 'web_lab_control'::regnamespace)
    order by table_name, conname
  `;
  assert.ok(constraints.some(row => row.conname === "web_lab_builds_saved_owner_fk" && row.contype === "f" &&
    /ON UPDATE RESTRICT ON DELETE SET NULL \(saved_lab_id\)/.test(row.definition)));
  assert.ok(constraints.some(row => row.conname === "runtime_commands_idempotency_key" && row.contype === "u"));
  assert.ok(constraints.some(row => row.conname === "web_lab_completions_owner_build_trust_key" && row.contype === "u"));

  const indexes = await db`
    select schemaname, tablename, indexname, indexdef
    from pg_indexes
    where schemaname in ('public', 'web_lab_control')
    order by schemaname, tablename, indexname
  `;
  for (const required of [
    "ai_usage_user_week_unique", "lab_generation_jobs_one_active_per_user_idx",
    "labs_web_build_owner_key", "runtime_instances_one_active_hosted_owner_idx",
    "runtime_admission_one_active_per_slot_idx", "runtime_usage_provider_sample_idx",
  ]) assert.ok(indexes.some(row => row.indexname === required), `missing index ${required}`);

  const foreignKeyIndexReviewCandidates = await db`
    select c.conrelid::regclass::text as table_name, c.conname,
      array_agg(a.attname order by key_position.ordinality) as columns
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as key_position(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key_position.attnum
    where c.contype = 'f'
      and c.connamespace in ('public'::regnamespace, 'web_lab_control'::regnamespace)
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and (
            select array_agg(index_key.attnum order by index_key.ordinality)
            from unnest(i.indkey::smallint[]) with ordinality as index_key(attnum, ordinality)
            where index_key.ordinality <= cardinality(c.conkey)
          ) @> c.conkey
      )
    group by c.conrelid, c.conname
    order by c.conrelid::regclass::text, c.conname
  `;

  const owners = await db`
    select n.nspname as schema_name, c.relname, pg_get_userbyid(c.relowner) as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'web_lab_control') and c.relkind = 'r'
    order by n.nspname, c.relname
  `;
  assert.ok(owners.every(row => row.owner === "postgres"));

  return {
    postgresVersion: String((await db`show server_version`)[0].server_version),
    controlTableCount: controlTables.length,
    triggerCount: triggerNames.size,
    constraintCount: constraints.length,
    indexCount: indexes.length,
    foreignKeyIndexReviewCandidates:
      foreignKeyIndexReviewCandidates.map(row => `${row.table_name}.${row.conname}`),
    localOwner: "postgres",
  };
}

async function verifyPermissions(db, knownBuildId, knownOwnerId) {
  for (const role of ["anon", "authenticated"]) {
    await expectRejected(() => db.begin(async tx => {
      await tx.unsafe(`set local role ${role}`);
      await tx`select id from web_lab_control.web_lab_builds limit 1`;
    }), error => error && error.code === "42501", `${role} must not read private builds`);
  }
  const serviceRows = await db.begin(async tx => {
    await tx`set local role service_role`;
    return tx`select id from web_lab_control.web_lab_builds where id = ${knownBuildId}`;
  });
  assert.equal(serviceRows.length, 1);

  await expectRejected(() => db.begin(async tx => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${knownOwnerId}, true)`;
    await tx`insert into web_lab_control.web_lab_completions (id) values (${randomUUID()})`;
  }), error => error && error.code === "42501", "authenticated completion insert must be denied");

  const privileges = await db`
    select
      has_schema_privilege('anon', 'web_lab_control', 'usage') as anon_schema,
      has_schema_privilege('authenticated', 'web_lab_control', 'usage') as authenticated_schema,
      has_schema_privilege('service_role', 'web_lab_control', 'usage') as service_schema,
      has_table_privilege('authenticated', 'web_lab_control.web_lab_builds', 'select') as learner_build_select,
      has_table_privilege('service_role', 'web_lab_control.web_lab_builds', 'select') as service_build_select
  `;
  assert.deepEqual(privileges[0], {
    anon_schema: false,
    authenticated_schema: false,
    service_schema: true,
    learner_build_select: false,
    service_build_select: true,
  });
}

async function createReadyRuntime(repo, ownerId, savedLabId, runtimeMode, runtimeVersion) {
  const runtime = await repo.createSelfHostedRuntime({
    ownerId, savedLabId, runtimeMode, providerKind: `${runtimeMode}_test`,
    runtimeVersion, ttlMinutes: 30,
  });
  let current = await repo.transitionRuntime({
    instanceId: runtime.instanceId, ownerId, expectedVersion: runtime.version,
    status: "provisioning", auditEvent: "provider_create_started",
  });
  current = await repo.transitionRuntime({
    instanceId: runtime.instanceId, ownerId, expectedVersion: current.version,
    status: "ready", backendReference: `${runtimeMode}-test-reference`, auditEvent: "instance_ready",
  });
  return current;
}

async function runGenerationAndTrust(db) {
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const jobId = randomUUID();
  const reservationId = randomUUID();
  await db`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`;

  const [reservation] = await db`
    select public.reserve_ai_usage(${reservationId}, ${ownerId}, 'lab_generation', 5, 'pro') as result
  `;
  assert.equal(reservation.result.allowed, true);
  await db`
    insert into public.lab_generation_jobs
      (id, user_id, category, difficulty, duration, status, usage_reservation_id, started_at)
    values (${jobId}, ${ownerId}, 'Web Security', 'Beginner', '30 mins', 'generating',
      ${reservationId}, now())
  `;

  const store = new PostgresExecutableWebSaveStore(db);
  const stages = [];
  const saved = await saveExecutableWebGeneration(store, jobId, ownerId, stage => stages.push(stage));
  assert.deepEqual(stages, ["generation_job_lock", "spec_plan", "saved_lab_insert", "build_insert", "job_link"]);
  const replay = await saveExecutableWebGeneration(store, jobId, ownerId);
  assert.equal(replay.replayed, true);
  assert.equal(replay.savedLabId, saved.savedLabId);
  assert.equal(replay.build.buildFingerprint, saved.build.buildFingerprint);

  await db`
    update public.lab_generation_jobs
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = ${jobId} and user_id = ${ownerId} and resulting_lab_id = ${saved.savedLabId}
  `;
  const [finalized] = await db`
    select public.finalize_ai_usage_reservation(${reservationId}, 10, 20, 0.01) as ok
  `;
  assert.equal(finalized.ok, true);
  await db`
    insert into public.ai_usage_events (
      user_id, generated_lab_id, feature_type, model_used, input_tokens,
      output_tokens, total_tokens, estimated_cost, plan_snapshot
    ) values (${ownerId}, ${saved.savedLabId}, 'lab_generation', 'deterministic-web-v1',
      10, 20, 30, 0.01, 'pro')
  `;

  const [stored] = await db`
    select l.id, jsonb_typeof(l.tasks) as tasks_type, jsonb_typeof(l.hints) as hints_type,
      jsonb_typeof(l.outcomes) as outcomes_type, l.completed, j.status,
      j.resulting_lab_id, j.usage_reservation_id, r.status as reservation_status,
      b.id as build_id, b.build_fingerprint
    from public.labs l
    join public.lab_generation_jobs j on j.resulting_lab_id = l.id
    join public.ai_usage_reservations r on r.id = j.usage_reservation_id
    join web_lab_control.web_lab_builds b on b.saved_lab_id = l.id and b.owner_id = l.user_id
    where l.id = ${saved.savedLabId}
  `;
  assert.deepEqual({ tasks: stored.tasks_type, hints: stored.hints_type, outcomes: stored.outcomes_type },
    { tasks: "array", hints: "array", outcomes: "array" });
  assert.equal(stored.completed, false);
  assert.equal(stored.status, "completed");
  assert.equal(String(stored.resulting_lab_id), saved.savedLabId);
  assert.equal(String(stored.usage_reservation_id), reservationId);
  assert.equal(stored.reservation_status, "finalized");
  assert.equal(String(stored.build_id), saved.build.id);
  assert.equal(stored.build_fingerprint, saved.build.buildFingerprint);

  await expectRejected(() => db`
    update web_lab_control.web_lab_builds set seed = 'forbidden-mutation' where id = ${saved.build.id}
  `, error => /immutable_web_lab_record/.test(String(error && error.message)), "build mutation must fail");

  const repo = new PostgresWebLabControlRepository(db);
  const foreignLabId = randomUUID();
  await db`insert into public.labs (id, user_id, topic) values (${foreignLabId}, ${ownerId}, 'Web Security')`;
  await expectRejected(() => repo.createBuild({
    savedLabId: foreignLabId, ownerId: otherOwnerId,
    spec: planExecutableWebSpec(randomUUID(), otherOwnerId), runtimeVersion: "phase1-runtime-1",
  }), error => error && error.code === "23503", "owner/build linkage must reject forgery");

  const failedOwnerId = randomUUID();
  const failedJobId = randomUUID();
  await db`insert into auth.users (id) values (${failedOwnerId})`;
  await db`
    insert into public.lab_generation_jobs (id, user_id, category, difficulty, duration, status)
    values (${failedJobId}, ${failedOwnerId}, 'Web Security', 'Beginner', '30 mins', 'generating')
  `;
  await db.unsafe(`
    create function web_lab_control.phase1_reject_build() returns trigger
    language plpgsql set search_path = pg_catalog as $$
    begin raise exception 'phase1_forced_build_failure' using errcode = 'P0001'; end;
    $$;
    create trigger phase1_reject_build before insert on web_lab_control.web_lab_builds
      for each row execute function web_lab_control.phase1_reject_build();
  `);
  await expectRejected(() => saveExecutableWebGeneration(store, failedJobId, failedOwnerId),
    error => /phase1_forced_build_failure/.test(String(error && error.message)),
    "forced build failure must reject transaction");
  const [rollback] = await db`
    select
      (select count(*)::int from public.labs where user_id = ${failedOwnerId}) as labs,
      (select count(*)::int from web_lab_control.web_lab_builds where owner_id = ${failedOwnerId}) as builds,
      (select resulting_lab_id from public.lab_generation_jobs where id = ${failedJobId}) as resulting_lab_id
  `;
  assert.deepEqual(rollback, { labs: 0, builds: 0, resulting_lab_id: null });
  await db.unsafe(`
    drop trigger phase1_reject_build on web_lab_control.web_lab_builds;
    drop function web_lab_control.phase1_reject_build();
  `);

  const orphanLabId = randomUUID();
  const orphanJobId = randomUUID();
  await db`insert into public.labs (id, user_id, topic) values (${orphanLabId}, ${ownerId}, 'Web Security')`;
  await db`
    insert into public.lab_generation_jobs
      (id, user_id, category, difficulty, duration, status, resulting_lab_id)
    values (${orphanJobId}, ${ownerId}, 'Web Security', 'Beginner', '30 mins', 'generating', ${orphanLabId})
  `;
  await expectRejected(() => saveExecutableWebGeneration(store, orphanJobId, ownerId),
    error => error && error.message === "GENERATION_BUILD_LINK_MISSING",
    "missing immutable build must fail closed");

  const local = await createReadyRuntime(
    repo, ownerId, saved.savedLabId, "local_runner", saved.build.runtimeVersion,
  );
  const launchHash = fingerprint(`launch-${randomUUID()}`);
  const launchExpires = new Date(Date.now() + 60_000);
  assert.equal(await repo.consumeLaunchGrant({ grantIdHash: launchHash, instanceId: local.instanceId,
    ownerId, generationVersion: 1, expiresAt: launchExpires }), "consumed");
  assert.equal(await repo.consumeLaunchGrant({ grantIdHash: launchHash, instanceId: local.instanceId,
    ownerId, generationVersion: 1, expiresAt: launchExpires }), "replayed");
  assert.equal(await repo.consumeLaunchGrant({ grantIdHash: fingerprint("wrong-owner"), instanceId: local.instanceId,
    ownerId: otherOwnerId, generationVersion: 1, expiresAt: launchExpires }), "not_ready");
  assert.equal(await repo.consumeLaunchGrant({ grantIdHash: fingerprint("expired"), instanceId: local.instanceId,
    ownerId, generationVersion: 1, expiresAt: new Date(Date.now() - 1000) }), "not_ready");

  const reset = await repo.requestReset({ instanceId: local.instanceId, ownerId,
    idempotencyKey: "phase1-local-reset", expectedVersion: local.version });
  const resetReplay = await repo.requestReset({ instanceId: local.instanceId, ownerId,
    idempotencyKey: "phase1-local-reset", expectedVersion: local.version });
  assert.equal(resetReplay.commandId, reset.commandId);
  assert.equal(resetReplay.replayed, true);
  let localReady = await repo.getRuntimeForOwner(local.instanceId, ownerId);
  localReady = await repo.transitionRuntime({ instanceId: local.instanceId, ownerId,
    expectedVersion: localReady.version, status: "ready", auditEvent: "reset_ready" });
  assert.equal(await repo.consumeLaunchGrant({ grantIdHash: fingerprint("stale-generation"),
    instanceId: local.instanceId, ownerId, generationVersion: 1, expiresAt: launchExpires }), "not_ready");

  const localUsage = await repo.recordUsage({ instanceId: local.instanceId,
    providerKind: "local_runner_test", generationVersion: 2,
    windowStartedAt: new Date(Date.now() - 1000), windowEndedAt: new Date(),
    provisionedSeconds: 1, activeCpuMs: 2, memoryMbSeconds: 3,
    ingressBytes: 4, egressBytes: 5, graderMs: 6, measurementSource: "phase1" });
  await expectRejected(() => db`update web_lab_control.runtime_usage set active_cpu_ms = 99 where id = ${localUsage}`,
    error => /immutable_web_lab_record/.test(String(error && error.message)), "usage must be append-only");

  const localGrade = await repo.recordGrade({ instanceId: local.instanceId, ownerId, outcome: "pass",
    graderVersion: "phase1-grader", observationFingerprint: fingerprint("local-observation") });
  assert.equal(localGrade.trustLevel, "local_self_hosted");
  assert.ok(localGrade.completionId);
  await expectRejected(() => db`
    insert into web_lab_control.web_lab_completions (
      owner_id, web_lab_build_id, runtime_instance_id, trusted_grade_id,
      trust_level, grader_version, completion_fingerprint
    ) values (${ownerId}, ${saved.build.id}, ${local.instanceId}, ${localGrade.attemptId},
      'hosted_verified', 'phase1-grader', ${fingerprint("forged-hosted")})
  `, error => /untrusted_web_lab_completion/.test(String(error && error.message)),
  "trust escalation must be rejected");

  const byo = await createReadyRuntime(
    repo, ownerId, saved.savedLabId, "byo_runtime", saved.build.runtimeVersion,
  );
  const byoGrade = await repo.recordGrade({ instanceId: byo.instanceId, ownerId, outcome: "pass",
    graderVersion: "phase1-grader", observationFingerprint: fingerprint("byo-observation") });
  assert.equal(byoGrade.trustLevel, "byo_self_hosted");

  await db`update web_lab_control.runtime_budget_policy set hosted_runtime_enabled = true,
    budget_state = 'NORMAL', metrics_observed_at = now() where singleton_id = 1`;
  const hosted = await repo.admitHosted({ ownerId, savedLabId: saved.savedLabId,
    idempotencyKey: "phase1-hosted", providerKind: "fake_runtime", runtimeVersion: "phase1-runtime-1",
    ttlMinutes: 15, reservedCostGbpPence: 10 });
  let hostedReady = await repo.getRuntimeForOwner(hosted.instanceId, ownerId);
  hostedReady = await repo.transitionRuntime({ instanceId: hosted.instanceId, ownerId,
    expectedVersion: hostedReady.version, status: "provisioning", auditEvent: "provider_create_started" });
  hostedReady = await repo.transitionRuntime({ instanceId: hosted.instanceId, ownerId,
    expectedVersion: hostedReady.version, status: "ready", backendReference: "fake-hosted-reference",
    auditEvent: "instance_ready" });
  assert.equal(hostedReady.status, "ready");
  const hostedGrade = await repo.recordGrade({ instanceId: hosted.instanceId, ownerId, outcome: "pass",
    graderVersion: "phase1-grader", observationFingerprint: fingerprint("hosted-observation") });
  assert.equal(hostedGrade.trustLevel, "hosted_verified");

  const destroy = await repo.requestDestroy({ instanceId: local.instanceId, ownerId,
    idempotencyKey: "phase1-local-destroy", expectedVersion: localReady.version });
  let localDestroying = await repo.getRuntimeForOwner(local.instanceId, ownerId);
  await repo.transitionRuntime({ instanceId: local.instanceId, ownerId,
    expectedVersion: localDestroying.version, status: "destroyed", auditEvent: "destroyed" });
  assert.equal(destroy.status, "destroying");
  const completionsAfterDestroy = await repo.getCompletionForOwner(saved.build.id, ownerId);
  assert.deepEqual(new Set(completionsAfterDestroy.map(row => row.trustLevel)),
    new Set(["local_self_hosted", "byo_self_hosted", "hosted_verified"]));

  const [counts] = await db`
    select
      (select count(*)::int from web_lab_control.runtime_audit_events) as audits,
      (select count(*)::int from web_lab_control.runtime_usage) as usage,
      (select count(*)::int from web_lab_control.web_lab_grade_attempts) as grades,
      (select count(*)::int from web_lab_control.web_lab_completions) as completions,
      (select count(*)::int from web_lab_control.runtime_launch_exchanges) as exchanges
  `;
  assert.ok(counts.audits > 0 && counts.usage > 0 && counts.grades >= 3 &&
    counts.completions >= 3 && counts.exchanges === 1);

  return {
    ownerId,
    savedLabId: saved.savedLabId,
    buildId: saved.build.id,
    buildFingerprint: saved.build.buildFingerprint,
    stageCount: stages.length,
    trustModes: ["local_self_hosted", "byo_self_hosted", "hosted_verified"],
    counts,
  };
}

async function deleteAsLearner(db, ownerId, predicate) {
  return db.begin(async tx => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${ownerId}, true)`;
    return predicate(tx);
  });
}

async function runSavedInvestigationDeletionRegression(db) {
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const linkedLab = randomUUID();
  const ordinaryLab = randomUUID();
  const deleteAllLinkedLab = randomUUID();
  const deleteAllOrdinaryLab = randomUUID();
  await db`insert into auth.users (id) values (${ownerA}), (${ownerB})`;
  await db`insert into public.labs (id, user_id, topic) values
    (${linkedLab}, ${ownerA}, 'Web Security'),
    (${ordinaryLab}, ${ownerA}, 'General'),
    (${deleteAllLinkedLab}, ${ownerA}, 'Web Security'),
    (${deleteAllOrdinaryLab}, ${ownerA}, 'General')`;

  const repo = new PostgresWebLabControlRepository(db);
  const linkedBuild = await repo.createBuild({ savedLabId: linkedLab, ownerId: ownerA,
    spec: planExecutableWebSpec(randomUUID(), ownerA), runtimeVersion: "phase1-runtime-1" });
  const retainedRuntime = await createReadyRuntime(
    repo, ownerA, linkedLab, "local_runner", linkedBuild.runtimeVersion,
  );
  const deleteAllBuild = await repo.createBuild({ savedLabId: deleteAllLinkedLab, ownerId: ownerA,
    spec: planExecutableWebSpec(randomUUID(), ownerA), runtimeVersion: "phase1-runtime-1" });

  const foreignDelete = await deleteAsLearner(db, ownerB,
    tx => tx`delete from public.labs where id = ${linkedLab} returning id`);
  assert.equal(foreignDelete.length, 0, "another learner must not delete the owner's lab");
  const [foreignState] = await db`select l.id as lab_id, b.saved_lab_id, b.owner_id
    from public.labs l join web_lab_control.web_lab_builds b on b.saved_lab_id = l.id
    where l.id = ${linkedLab}`;
  assert.equal(String(foreignState.lab_id), linkedLab);
  assert.equal(String(foreignState.saved_lab_id), linkedLab);
  assert.equal(String(foreignState.owner_id), ownerA);

  const ownDelete = await deleteAsLearner(db, ownerA,
    tx => tx`delete from public.labs where id = ${linkedLab} returning id`);
  assert.equal(ownDelete.length, 1, "owner must delete a linked Saved Investigation");
  const [detached] = await db`select saved_lab_id, owner_id from web_lab_control.web_lab_builds
    where id = ${linkedBuild.id}`;
  assert.deepEqual(detached, { saved_lab_id: null, owner_id: ownerA });
  assert.equal((await db`select id from public.labs where id = ${linkedLab}`).length, 0);
  assert.equal((await repo.getTrustedBuild(linkedBuild.id, ownerA)).metadata.savedLabId, null);
  const [history] = await db`select b.id as build_id, i.id as runtime_id,
    (select count(*)::int from web_lab_control.runtime_audit_events a where a.instance_id = i.id) as audits
    from web_lab_control.web_lab_builds b
    join web_lab_control.runtime_instances i on i.web_lab_build_id = b.id and i.owner_id = b.owner_id
    where b.id = ${linkedBuild.id} and i.id = ${retainedRuntime.instanceId}`;
  assert.equal(String(history.build_id), linkedBuild.id);
  assert.equal(String(history.runtime_id), retainedRuntime.instanceId);
  assert.ok(history.audits >= 2, "runtime audit history must survive Saved Investigation deletion");

  await expectRejected(() => db`update web_lab_control.web_lab_builds
    set seed = 'still-forbidden' where id = ${deleteAllBuild.id}`,
  error => /immutable_web_lab_record/.test(String(error && error.message)),
  "unrelated immutable build updates must remain rejected");

  const deleteAll = await deleteAsLearner(db, ownerA,
    tx => tx`delete from public.labs where user_id = ${ownerA} returning id`);
  assert.deepEqual(new Set(deleteAll.map(row => String(row.id))),
    new Set([ordinaryLab, deleteAllLinkedLab, deleteAllOrdinaryLab]));
  const [deleteAllState] = await db`select saved_lab_id, owner_id
    from web_lab_control.web_lab_builds where id = ${deleteAllBuild.id}`;
  assert.deepEqual(deleteAllState, { saved_lab_id: null, owner_id: ownerA });
  assert.equal((await db`select id from public.labs where user_id = ${ownerA}`).length, 0);

  return {
    ownLinkedDelete: "pass",
    crossUserDelete: "pass",
    deleteAll: "pass",
    retainedHistory: "pass",
  };
}

async function runUpgrade(db) {
  const ownerId = randomUUID();
  const labId = randomUUID();
  await db`insert into auth.users (id) values (${ownerId})`;
  const tasks = ["existing-task", JSON.stringify({ phase: "upgrade", evidence: [] })];
  const hints = ["existing-hint"];
  const outcomes = ["existing-outcome"];
  await db`
    insert into public.labs (
      id, user_id, title, topic, difficulty, estimated_time, objective,
      scenario, tasks, hints, outcomes, completed
    ) values (${labId}, ${ownerId}, 'Existing Saved Lab', 'Web Security', 'Beginner',
      '30 mins', 'Existing objective', 'Existing scenario', ${db.json(tasks)},
      ${db.json(hints)}, ${db.json(outcomes)}, false)
  `;
  const [before] = await db`
    select tasks, hints, outcomes, pg_typeof(tasks)::text as tasks_type
    from public.labs where id = ${labId}
  `;
  await applyMigrations(db, RUNTIME_MIGRATIONS);
  const [after] = await db`
    select tasks, hints, outcomes, pg_typeof(tasks)::text as tasks_type
    from public.labs where id = ${labId}
  `;
  assert.deepEqual(after, before);
  assert.equal(after.tasks_type, "jsonb");

  const repo = new PostgresWebLabControlRepository(db);
  const spec = planExecutableWebSpec(randomUUID(), ownerId);
  const build = await repo.createBuild({ savedLabId: labId, ownerId, spec, runtimeVersion: "phase1-runtime-1" });
  assert.equal(build.savedLabId, labId);
  return { labId, buildId: build.id, jsonbPreserved: true };
}

async function runMissingPrerequisite(db) {
  await expectRejected(() => db.begin(async tx =>
    tx.unsafe(migrationSource("supabase/migrations/20260901090000_lab_generation_jobs.sql"))),
  error => error && ["3F000", "42P01"].includes(error.code),
  "lab-generation migration must fail without auth/labs/reservations prerequisites");
}

async function classifyReapplication(db) {
  const outcomes = {};
  for (const relative of MIGRATIONS) {
    const rollback = new Error("phase1_reapplication_rollback");
    try {
      await db.begin(async tx => {
        await tx.unsafe(migrationSource(relative));
        throw rollback;
      });
    } catch (error) {
      outcomes[path.basename(relative)] = error === rollback || error.message === rollback.message
        ? "safe-but-run-once-by-policy"
        : `fails:${error.code || "unknown"}`;
    }
  }
  assert.equal(outcomes["20260725020800_ai_content_consents.sql"], "safe-but-run-once-by-policy");
  assert.equal(outcomes["20260727090000_atomic_ai_usage_reservations.sql"], "safe-but-run-once-by-policy");
  assert.equal(outcomes["20260731100000_linux_grading_usage_and_consent.sql"], "safe-but-run-once-by-policy");
  assert.match(outcomes["20260901090000_lab_generation_jobs.sql"], /^fails:/);
  assert.match(outcomes["20260922211651_web_lab_control_plane_persistence.sql"], /^fails:/);
  assert.match(outcomes["20260922215508_web_lab_launch_grant_exchange.sql"], /^fails:/);
  assert.match(outcomes["20260927213116_detach_deleted_saved_investigations.sql"], /^fails:/);
  return outcomes;
}

async function runJsonbMismatch(db) {
  const ownerId = randomUUID();
  const jobId = randomUUID();
  await db`insert into auth.users (id) values (${ownerId})`;
  await db`
    insert into public.lab_generation_jobs (id, user_id, category, difficulty, duration, status)
    values (${jobId}, ${ownerId}, 'Web Security', 'Beginner', '30 mins', 'generating')
  `;
  const store = new PostgresExecutableWebSaveStore(db);
  await expectRejected(() => saveExecutableWebGeneration(store, jobId, ownerId),
    error => error && ["22P02", "42804"].includes(error.code),
    "text[] regression must fail real JSONB persistence path");
  const [state] = await db`
    select
      (select count(*)::int from public.labs where user_id = ${ownerId}) as labs,
      (select count(*)::int from web_lab_control.web_lab_builds where owner_id = ${ownerId}) as builds,
      (select resulting_lab_id from public.lab_generation_jobs where id = ${jobId}) as resulting_lab_id
  `;
  assert.deepEqual(state, { labs: 0, builds: 0, resulting_lab_id: null });
}

async function runExistingContract(script, variable, connection) {
  const result = await command(process.execPath, [script], {
    timeout: 180_000,
    env: safeEnvironment({ [variable]: connection }),
  });
  return result.stdout.trim();
}

async function assertNoPhase1Resources() {
  const containers = await docker("ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.Names}}");
  const volumes = await docker("volume", "ls", "--filter", `label=${LABEL}`, "--format", "{{.Name}}");
  assert.equal(containers, "", "Phase 1 container remained after cleanup");
  assert.equal(volumes, "", "Phase 1 volume remained after cleanup");
}

async function main() {
  let resource;
  let admin;
  const created = new Set();
  const report = {
    migrationOrder: MIGRATIONS.map(relative => path.basename(relative)),
    productionConnections: 0,
    productionMigrations: 0,
    providerResources: 0,
  };
  try {
    resource = await startPostgres();
    admin = connect(databaseUrl(resource.port, resource.password, "postgres"), 2);
    const [version] = await admin`show server_version`;
    report.postgresVersion = String(version.server_version);

    await createDatabase(admin, DATABASES.missing);
    created.add(DATABASES.missing);
    let db = connect(databaseUrl(resource.port, resource.password, DATABASES.missing), 2);
    await runMissingPrerequisite(db);
    await db.end({ timeout: 5 });
    await dropDatabase(admin, DATABASES.missing);
    created.delete(DATABASES.missing);
    report.missingPrerequisite = "deterministic failure";

    db = await prepareDatabase(resource, admin, DATABASES.fresh);
    created.add(DATABASES.fresh);
    report.schema = await inspectSchema(db);
    report.generation = await runGenerationAndTrust(db);
    report.savedInvestigationDeletion = await runSavedInvestigationDeletionRegression(db);
    await verifyPermissions(db, report.generation.buildId, report.generation.ownerId);
    report.reapplication = await classifyReapplication(db);
    await db.end({ timeout: 5 });
    await dropDatabase(admin, DATABASES.fresh);
    created.delete(DATABASES.fresh);

    db = await prepareDatabase(resource, admin, DATABASES.upgrade, PRE_RUNTIME_MIGRATIONS);
    created.add(DATABASES.upgrade);
    report.upgrade = await runUpgrade(db);
    await db.end({ timeout: 5 });
    await dropDatabase(admin, DATABASES.upgrade);
    created.delete(DATABASES.upgrade);

    db = await prepareDatabase(resource, admin, DATABASES.mismatch, MIGRATIONS, { textArrays: true });
    created.add(DATABASES.mismatch);
    await runJsonbMismatch(db);
    report.jsonbMismatch = "deterministic failure with full transaction rollback";
    await db.end({ timeout: 5 });
    await dropDatabase(admin, DATABASES.mismatch);
    created.delete(DATABASES.mismatch);

    db = await prepareDatabase(resource, admin, DATABASES.phase12);
    created.add(DATABASES.phase12);
    await db.end({ timeout: 5 });
    report.phase12 = await runExistingContract(
      "tests/web-lab/phase12/runPostgresContracts.js", "PHASE12_TEST_DATABASE_URL",
      databaseUrl(resource.port, resource.password, DATABASES.phase12),
    );
    await dropDatabase(admin, DATABASES.phase12);
    created.delete(DATABASES.phase12);

    db = await prepareDatabase(resource, admin, DATABASES.phase13);
    created.add(DATABASES.phase13);
    await db.end({ timeout: 5 });
    report.phase13 = await runExistingContract(
      "tests/web-lab/phase13/runServiceContracts.js", "PHASE13_TEST_DATABASE_URL",
      databaseUrl(resource.port, resource.password, DATABASES.phase13),
    );
    await dropDatabase(admin, DATABASES.phase13);
    created.delete(DATABASES.phase13);

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (admin) {
      for (const name of created) await dropDatabase(admin, name).catch(() => undefined);
      await admin.end({ timeout: 5 }).catch(() => undefined);
    }
    await cleanupPostgres(resource);
    await assertNoPhase1Resources();
  }
}

main().catch(error => {
  process.stderr.write(`PHASE1_SCHEMA_REHEARSAL_FAILED:${error && error.message ? error.message : "unknown"}\n`);
  process.exitCode = 1;
});
