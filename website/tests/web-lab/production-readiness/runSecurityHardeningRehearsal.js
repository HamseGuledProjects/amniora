#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated production-clone rehearsal. */
"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { promisify } = require("node:util");
const postgres = require("postgres");
const ts = require("typescript");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../../..");
const WEB_LAB_SOURCE = path.join(ROOT, "lib/web-lab");
const originalLoad = Module._load;
Module._load = function (specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};
require.extensions[".ts"] = (module, filename) => {
  if (!filename.startsWith(`${WEB_LAB_SOURCE}${path.sep}`)) throw new Error("scoped_typescript_load_denied");
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  module._compile(output, filename);
};
const { PostgresDistributedAbusePolicy, safeRequestFingerprint } = require(
  path.join(WEB_LAB_SOURCE, "production-security-controls.ts"),
);
const { PostgresByoRunnerEnrollmentStore } = require(
  path.join(WEB_LAB_SOURCE, "byo-runner/postgres-enrollment.ts"),
);
const ARCHIVE = path.join(ROOT, "fixtures", "not-distributed", "database.dump");
const ARCHIVE_SHA256 = "0".repeat(64);
const ARCHIVE_SIZE = 0;
const IMAGE = "supabase/postgres:17.6.1.155";
const LABEL = "com.amniora.production-readiness.security-hardening=true";
const DATABASE = "amniora_security_hardening";
const PHASE13 = path.join(ROOT, "supabase/migrations/20260922215508_web_lab_launch_grant_exchange.sql");
const PROPOSAL = path.join(__dirname, "security-hardening-proposal.sql");
const B1_B2 = path.join(ROOT, "supabase/migrations/20260927121713_early_access_public_security_hardening.sql");
const B3 = path.join(ROOT, "supabase/migrations/20260927121714_early_access_resulting_lab_index.sql");
const B6 = path.join(ROOT, "supabase/migrations/20260927121715_early_access_runtime_security_controls.sql");
const TARGET_TABLES = ["labs", "lab_generation_jobs", "ai_usage", "ai_usage_events", "ai_usage_reservations"];
const DATA_TABLES = [
  ...TARGET_TABLES.map(name => `public.${name}`),
  "public.profiles", "public.roadmap_progress", "public.user_achievements",
  "web_lab_control.web_lab_builds", "web_lab_control.runtime_instances",
  "web_lab_control.runtime_commands", "web_lab_control.runtime_admission_slots",
  "web_lab_control.runtime_admission", "web_lab_control.runtime_budget_policy",
  "web_lab_control.runtime_audit_events", "web_lab_control.runtime_usage",
  "web_lab_control.web_lab_grade_attempts", "web_lab_control.web_lab_completions",
  "web_lab_control.runtime_launch_exchanges",
];
const LOCKED_FUNCTIONS = [
  "award_xp_from_roadmap_completion()",
  "check_and_unlock_achievements(uuid)",
  "create_default_roadmap_progress()",
  "handle_new_user()",
  "increment_labs_generated(uuid)",
  "run_achievement_check()",
  "sync_profile_lab_stats()",
  "sync_roadmap_from_completed_lab()",
];
const USAGE_FUNCTIONS = [
  "reserve_ai_usage(uuid,uuid,text,integer,text)",
  "finalize_ai_usage_reservation(uuid,integer,integer,numeric)",
  "release_ai_usage_reservation(uuid)",
];
let currentStage = "startup";

function safeEnvironment() {
  return { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", NO_COLOR: "1" };
}

async function command(program, args, options = {}) {
  return execFileAsync(program, args, {
    cwd: options.cwd || ROOT,
    timeout: options.timeout || 300_000,
    maxBuffer: 16 * 1024 * 1024,
    env: safeEnvironment(),
  });
}

async function docker(...args) {
  const result = await command("docker", args);
  return result.stdout.trim();
}

async function archiveDigest() {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(ARCHIVE);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function validateInputs() {
  const stat = fs.statSync(ARCHIVE);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.size, ARCHIVE_SIZE);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(ARCHIVE)).mode & 0o777, 0o700);
  assert.equal(await archiveDigest(), ARCHIVE_SHA256);
  assert.equal(fs.statSync(PHASE13).isFile(), true);
  assert.equal(fs.statSync(PROPOSAL).isFile(), true);
  for (const migration of [B1_B2, B3, B6]) assert.equal(fs.statSync(migration).isFile(), true);
}

async function waitForPostgres(containerName) {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      ready = await docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", "postgres") !== "";
    } catch { ready = false; }
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("disposable_postgres_not_ready");
}

async function startPostgres() {
  const suffix = `${process.pid}-${randomBytes(5).toString("hex")}`;
  const containerName = `amniora-security-hardening-${suffix}`;
  const volumeName = `amniora-security-hardening-${suffix}`;
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
      "--mount", `type=bind,source=${ARCHIVE},target=/rehearsal/production.dump,readonly`,
      "--mount", `type=bind,source=${PHASE13},target=/rehearsal/phase13.sql,readonly`,
      "--mount", `type=bind,source=${PROPOSAL},target=/rehearsal/security-hardening.sql,readonly`,
      "--mount", `type=bind,source=${B1_B2},target=/rehearsal/b1-b2.sql,readonly`,
      "--mount", `type=bind,source=${B3},target=/rehearsal/b3.sql,readonly`,
      "--mount", `type=bind,source=${B6},target=/rehearsal/b6.sql,readonly`,
      IMAGE,
    );
    await waitForPostgres(containerName);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    await waitForPostgres(containerName);
    const binding = await docker("port", containerName, "5432/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    assert.ok(match, "disposable PostgreSQL must be loopback-only");
    return { containerName, volumeName, password, port: Number(match[1]) };
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

async function resourceCount() {
  const containers = await docker("ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.ID}}");
  const volumes = await docker("volume", "ls", "--filter", `label=${LABEL}`, "--format", "{{.Name}}");
  return {
    containers: containers ? containers.split("\n").filter(Boolean).length : 0,
    volumes: volumes ? volumes.split("\n").filter(Boolean).length : 0,
  };
}

async function restoreCurrentClone(resource) {
  await docker(
    "exec", resource.containerName, "psql", "-U", "supabase_admin", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-Atqc",
    "do $$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then create role supabase_realtime_admin nologin; end if; end $$;",
  );
  await docker("exec", resource.containerName, "createdb", "-U", "supabase_admin", "-O", "postgres", "-T", "template0", DATABASE);
  const eventTriggers = Number(await docker(
    "exec", resource.containerName, "sh", "-ceu",
    "pg_restore -l /rehearsal/production.dump | grep -c ' EVENT TRIGGER ' || true",
  ));
  assert.equal(eventTriggers, 7);
  await docker(
    "exec", resource.containerName, "sh", "-ceu",
    "pg_restore -l /rehearsal/production.dump | awk 'index($0, \" EVENT TRIGGER \") == 0' > /tmp/security-restore.list",
  );
  await docker(
    "exec", resource.containerName, "pg_restore", "-U", "supabase_admin", "-d", DATABASE,
    "--use-list=/tmp/security-restore.list", "--single-transaction", "--exit-on-error",
    "/rehearsal/production.dump",
  );
  await docker(
    "exec", resource.containerName, "psql", "-U", "postgres", "-d", DATABASE,
    "-v", "ON_ERROR_STOP=1", "-f", "/rehearsal/phase13.sql",
  );
}

function databaseUrl(resource) {
  return `postgresql://postgres:${encodeURIComponent(resource.password)}` +
    `@127.0.0.1:${resource.port}/${DATABASE}?sslmode=disable`;
}

function db(resource) {
  return postgres(databaseUrl(resource), { max: 3, prepare: false, onnotice: () => undefined });
}

async function dataSnapshot(sql) {
  const manifest = [];
  for (const table of DATA_TABLES) {
    assert.match(table, /^(public|web_lab_control)\.[a-z_]+$/);
    const [row] = await sql.unsafe(`
      select count(*)::integer as row_count,
        encode(extensions.digest(coalesce(string_agg(md5(to_jsonb(t)::text), ''
          order by md5(to_jsonb(t)::text)), ''), 'sha256'), 'hex') as row_digest
      from ${table} t
    `);
    manifest.push({ table, rowCount: row.row_count, rowDigest: row.row_digest });
  }
  return {
    fingerprint: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    counts: Object.fromEntries(manifest.map(row => [row.table, row.rowCount])),
  };
}

async function assertInitialCatalog(sql) {
  const tables = await sql`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ${sql(TARGET_TABLES)}
    order by c.relname
  `;
  assert.equal(tables.length, TARGET_TABLES.length);
  assert.ok(tables.every(row => row.relrowsecurity && !row.relforcerowsecurity));
  for (const table of ["ai_usage", "ai_usage_events"]) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const [{ allowed }] = await sql`
        select has_table_privilege('authenticated', ${`public.${table}`}, ${privilege}) as allowed
      `;
      assert.equal(allowed, true, `${table} must reproduce the captured broad authenticated grant`);
    }
  }
  const triggerFunctions = await sql`
    select p.oid::regprocedure::text as signature, p.prosecdef,
      coalesce(array_to_string(p.proconfig, ','), '') as config,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public' and c.relname = 'labs' and not t.tgisinternal
    order by p.oid::regprocedure::text
  `;
  assert.deepEqual(triggerFunctions.map(row => row.signature), [
    "sync_profile_lab_stats()", "sync_roadmap_from_completed_lab()",
  ]);
  assert.ok(triggerFunctions.every(row => row.prosecdef && row.config === "search_path=public" && row.authenticated_execute));
  const [phase13] = await sql`
    select c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'web_lab_control' and c.relname = 'runtime_launch_exchanges'
  `;
  assert.ok(phase13?.relrowsecurity && !phase13.relforcerowsecurity);
}

async function applyChangeSet(resource) {
  for (const file of ["/rehearsal/b1-b2.sql", "/rehearsal/b3.sql", "/rehearsal/b6.sql"]) {
    await docker(
      "exec", resource.containerName, "psql", "-U", "postgres", "-d", DATABASE,
      "-v", "ON_ERROR_STOP=1", "-f", file,
    );
  }
}

async function functionSecurity(sql, signature) {
  const [row] = await sql`
    select coalesce(array_to_string(p.proconfig, ','), '') as config,
      has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
      has_function_privilege('service_role', p.oid, 'execute') as service
    from pg_proc p
    where p.oid = ${`public.${signature}`}::regprocedure
  `;
  return row;
}

async function assertHardenedCatalog(sql) {
  const expected = {
    labs: { authenticated: ["SELECT", "DELETE"], service_role: ["SELECT", "INSERT", "UPDATE"] },
    lab_generation_jobs: { authenticated: ["SELECT"], service_role: ["SELECT", "INSERT", "UPDATE"] },
    ai_usage: { authenticated: [], service_role: ["SELECT", "INSERT", "UPDATE"] },
    ai_usage_events: { authenticated: [], service_role: ["SELECT", "INSERT"] },
    ai_usage_reservations: { authenticated: [], service_role: ["SELECT", "INSERT", "UPDATE"] },
  };
  for (const [table, roles] of Object.entries(expected)) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
        const [{ allowed }] = await sql`
          select has_table_privilege(${role}, ${`public.${table}`}, ${privilege}) as allowed
        `;
        assert.equal(allowed, (roles[role] || []).includes(privilege), `${role}:${table}:${privilege}`);
      }
    }
  }
  const [[{ completedUpdate }], [{ titleUpdate }]] = await Promise.all([
    sql`select has_column_privilege('authenticated', 'public.labs', 'completed', 'update') as "completedUpdate"`,
    sql`select has_column_privilege('authenticated', 'public.labs', 'title', 'update') as "titleUpdate"`,
  ]);
  assert.equal(completedUpdate, true);
  assert.equal(titleUpdate, false);

  const policies = await sql`
    select tablename, policyname, cmd, roles::text
    from pg_policies
    where schemaname = 'public' and tablename in ${sql(TARGET_TABLES)}
    order by tablename, policyname
  `;
  assert.deepEqual(policies.map(row => `${row.tablename}:${row.cmd}:${row.roles}`), [
    "lab_generation_jobs:SELECT:{authenticated}",
    "labs:DELETE:{authenticated}",
    "labs:UPDATE:{authenticated}",
    "labs:SELECT:{authenticated}",
  ]);

  for (const signature of LOCKED_FUNCTIONS) {
    const security = await functionSecurity(sql, signature);
    assert.equal(security.config, 'search_path=""', signature);
    assert.deepEqual([security.anon, security.authenticated, security.service], [false, false, false], signature);
  }
  const reset = await functionSecurity(sql, "reset_my_roadmap()");
  assert.equal(reset.config, 'search_path=""');
  assert.deepEqual([reset.anon, reset.authenticated, reset.service], [false, true, false]);
  for (const signature of USAGE_FUNCTIONS) {
    const security = await functionSecurity(sql, signature);
    assert.equal(security.config, 'search_path=""', signature);
    assert.deepEqual([security.anon, security.authenticated, security.service], [false, false, true], signature);
  }

  const defaultLeak = await sql`
    select coalesce(grantee.rolname, 'PUBLIC') as grantee, acl.privilege_type
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) acl
    left join pg_roles grantee on grantee.oid = acl.grantee
    where d.defaclnamespace in (0, 'public'::regnamespace)
      and pg_get_userbyid(d.defaclrole) = 'postgres'
      and coalesce(grantee.rolname, 'PUBLIC') in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  `;
  assert.deepEqual(
    defaultLeak.map(row => `${row.grantee}:${row.privilege_type}`),
    [],
    "application-role default privileges must fail closed",
  );

  const [index] = await sql`
    select ix.indisvalid, ix.indisready, pg_get_expr(ix.indpred, ix.indrelid) as predicate
    from pg_index ix join pg_class i on i.oid = ix.indexrelid
    join pg_namespace n on n.oid = i.relnamespace
    where n.nspname = 'public' and i.relname = 'lab_generation_jobs_resulting_lab_id_idx'
  `;
  assert.ok(index?.indisvalid && index.indisready);
  assert.match(index.predicate, /resulting_lab_id IS NOT NULL/i);

  const privateAccess = await sql`
    select
      has_schema_privilege('anon', 'web_lab_control', 'usage') as anon_schema,
      has_schema_privilege('authenticated', 'web_lab_control', 'usage') as authenticated_schema,
      has_table_privilege('anon', 'web_lab_control.runtime_launch_exchanges', 'select') as anon_exchange,
      has_table_privilege('authenticated', 'web_lab_control.runtime_launch_exchanges', 'insert') as authenticated_exchange,
      has_table_privilege('service_role', 'web_lab_control.runtime_launch_exchanges', 'select') as service_select,
      has_table_privilege('service_role', 'web_lab_control.runtime_launch_exchanges', 'insert') as service_insert,
      has_table_privilege('service_role', 'web_lab_control.runtime_launch_exchanges', 'update') as service_update
  `;
  assert.deepEqual(privateAccess[0], {
    anon_schema: false, authenticated_schema: false, anon_exchange: false,
    authenticated_exchange: false, service_select: true, service_insert: true,
    service_update: false,
  });

  const controls = await sql`
    select c.relname, c.relrowsecurity,
      (select count(*)::integer from pg_policy p where p.polrelid = c.oid) as policy_count,
      has_table_privilege('anon', c.oid, 'select') as anon_select,
      has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
      has_table_privilege('service_role', c.oid, 'select') as service_select
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'web_lab_control' and c.relname in (
      'security_rate_limit_windows', 'security_rate_limit_requests',
      'runner_enrollment_capabilities'
    ) order by c.relname
  `;
  assert.equal(controls.length, 3);
  assert.ok(controls.every(row => row.relrowsecurity && row.policy_count === 0 &&
    !row.anon_select && !row.authenticated_select && row.service_select));
}

async function expectDenied(operation) {
  await assert.rejects(operation, error => error && (error.code === "42501" || error.code === "42883"));
}

async function assertApplicationCompatibility(sql) {
  const [fixture] = await sql`
    select l.user_id as owner_id, j.id as job_id
    from public.labs l
    left join lateral (
      select id from public.lab_generation_jobs
      where user_id = l.user_id
      order by created_at
      limit 1
    ) j on true
    order by (j.id is not null) desc, l.id
    limit 1
  `;
  assert.ok(fixture?.owner_id);
  const rollback = new Error("expected_rehearsal_rollback");
  await assert.rejects(sql.begin(async tx => {
    currentStage = "compat_authenticated_role";
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${String(fixture.owner_id)}, true)`;
    currentStage = "compat_authenticated_select_lab";
    const own = await tx`select id from public.labs where user_id = ${fixture.owner_id} limit 1`;
    assert.equal(own.length, 1);
    currentStage = "compat_authenticated_update_completed";
    const updated = await tx`
      update public.labs set completed = completed
      where id = ${own[0].id} returning id
    `;
    assert.equal(updated.length, 1);
    currentStage = "compat_authenticated_deny_title_update";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      update public.labs set title = title where id = ${own[0].id}
    `));
    currentStage = "compat_authenticated_deny_lab_insert";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      insert into public.labs (user_id, title, topic, difficulty)
      values (${fixture.owner_id}, 'rehearsal', 'Web Security', 'Beginner')
    `));
    currentStage = "compat_authenticated_deny_usage_update";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      update public.ai_usage set total_tokens = total_tokens where user_id = ${fixture.owner_id}
    `));
    currentStage = "compat_authenticated_deny_usage_event_insert";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      insert into public.ai_usage_events (user_id, feature_type)
      values (${fixture.owner_id}, 'lab_generation')
    `));
    currentStage = "compat_authenticated_deny_usage_event_select";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      select id, feature_type from public.ai_usage_events limit 1
    `));
    if (fixture.job_id) {
      currentStage = "compat_authenticated_select_job";
      const jobs = await tx`select id from public.lab_generation_jobs where id = ${fixture.job_id}`;
      assert.equal(jobs.length, 1);
    }
    currentStage = "compat_authenticated_reset_roadmap";
    await tx`select public.reset_my_roadmap()`;
    currentStage = "compat_authenticated_deny_increment_labs";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      select public.increment_labs_generated(${fixture.owner_id})
    `));
    throw rollback;
  }), error => error === rollback);

  await assert.rejects(sql.begin(async tx => {
    currentStage = "compat_anon_deny_lab_select";
    await tx`set local role anon`;
    await expectDenied(tx.savepoint(savepoint => savepoint`select id from public.labs limit 1`));
    throw rollback;
  }), error => error === rollback);

  await assert.rejects(sql.begin(async tx => {
    currentStage = "compat_service_role";
    await tx`set local role service_role`;
    currentStage = "compat_service_insert_lab";
    const inserted = await tx`
      insert into public.labs
        (user_id, title, topic, difficulty, tasks, hints, outcomes, completed)
      values
        (${fixture.owner_id}, 'Hardening rehearsal', 'Web Security', 'Beginner',
         ${tx.json([])}, ${tx.json([])}, ${tx.json([])}, false)
      returning id
    `;
    assert.equal(inserted.length, 1);
    const reservationId = randomBytes(16).toString("hex").replace(
      /(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5",
    );
    currentStage = "compat_service_reserve_usage";
    const [reserved] = await tx`
      select public.reserve_ai_usage(${reservationId}::uuid, ${fixture.owner_id},
        'lab_generation', 1000000, 'free') as result
    `;
    assert.equal(reserved.result.allowed, true);
    currentStage = "compat_service_finalize_usage";
    const [finalized] = await tx`
      select public.finalize_ai_usage_reservation(${reservationId}::uuid, 0, 0, 0) as ok
    `;
    assert.equal(finalized.ok, true);
    currentStage = "compat_service_insert_usage_event";
    await tx`
      insert into public.ai_usage_events
        (user_id, feature_type, model_used, input_tokens, output_tokens,
         total_tokens, estimated_cost, plan_snapshot)
      values (${fixture.owner_id}, 'lab_generation', 'hardening-rehearsal', 0, 0, 0, 0, 'free')
    `;
    currentStage = "compat_service_admin_analytics_select";
    const analytics = await tx`
      select id, feature_type, model_used, input_tokens, output_tokens,
        total_tokens, estimated_cost, plan_snapshot, created_at
      from public.ai_usage_events
      where user_id = ${fixture.owner_id}
      order by created_at desc
      limit 1
    `;
    assert.equal(analytics.length, 1,
      "guarded Admin AI service-role projection must remain available");
    if (fixture.job_id) {
      currentStage = "compat_service_update_job";
      await tx`update public.lab_generation_jobs set updated_at = updated_at where id = ${fixture.job_id}`;
    }
    currentStage = "compat_service_deny_trigger_function";
    await expectDenied(tx.savepoint(savepoint => savepoint`
      select public.sync_profile_lab_stats()
    `));
    throw rollback;
  }), error => error === rollback);
}

async function assertDefaultPrivilegeProbe(sql) {
  const [identity] = await sql`select current_user as current_role, session_user as session_role`;
  assert.deepEqual(identity, { current_role: "postgres", session_role: "postgres" });
  await sql.unsafe("create table public.amniora_security_table_probe (id bigint)");
  await sql.unsafe("create sequence public.amniora_security_sequence_probe");
  await sql.unsafe("create function public.amniora_security_function_probe() returns integer language sql as 'select 1'");
  try {
    const [probe] = await sql`
      select
        has_table_privilege('anon', 'public.amniora_security_table_probe', 'select') as anon_table,
        has_table_privilege('authenticated', 'public.amniora_security_table_probe', 'insert') as authenticated_table,
        has_table_privilege('service_role', 'public.amniora_security_table_probe', 'select') as service_table,
        has_sequence_privilege('anon', 'public.amniora_security_sequence_probe', 'usage') as anon_sequence,
        has_function_privilege('anon', 'public.amniora_security_function_probe()', 'execute') as anon_function,
        has_function_privilege('authenticated', 'public.amniora_security_function_probe()', 'execute') as authenticated_function,
        has_function_privilege('service_role', 'public.amniora_security_function_probe()', 'execute') as service_function
    `;
    const exposed = Object.entries(probe)
      .filter(([, value]) => value !== false)
      .map(([key]) => key);
    assert.deepEqual(exposed, [], "default privilege probe must remain private");
  } finally {
    await sql.unsafe("drop function if exists public.amniora_security_function_probe()");
    await sql.unsafe("drop sequence if exists public.amniora_security_sequence_probe");
    await sql.unsafe("drop table if exists public.amniora_security_table_probe");
  }
}

async function assertRuntimeSecurityPersistence(sql) {
  const [fixture] = await sql`select id from auth.users order by id limit 1`;
  assert.ok(fixture?.id);
  const ownerId = String(fixture.id);
  const now = () => 1_800_000_000_000;
  const policy = new PostgresDistributedAbusePolicy(sql, {
    runner_package: { limit: 2, windowMs: 60_000 },
  }, now);
  const fingerprint = safeRequestFingerprint({ savedLabId: "fixture" });
  const duplicate = { ownerId, surface: "runner_package", idempotencyKey: "same_request",
    requestFingerprint: fingerprint };
  await Promise.all([policy.assertAllowed(duplicate), policy.assertAllowed(duplicate)]);
  const [one] = await sql`
    select used_count from web_lab_control.security_rate_limit_windows
    where owner_id = ${ownerId} and surface = 'runner_package'
  `;
  assert.equal(one.used_count, 1, "racing duplicate must consume one unit");
  await policy.assertAllowed({ ...duplicate, idempotencyKey: "second_request" });
  await assert.rejects(policy.assertAllowed({ ...duplicate, idempotencyKey: "denied_request" }),
    error => error?.code === "RATE_LIMITED");
  const missing = new PostgresDistributedAbusePolicy(sql, {}, now);
  await assert.rejects(missing.assertAllowed(duplicate), error => error?.code === "CONTROL_UNAVAILABLE");

  const enrollments = new PostgresByoRunnerEnrollmentStore(sql, now);
  const capability = await enrollments.issue(ownerId);
  const attempts = await Promise.allSettled([
    enrollments.consume(capability.token, ownerId, capability.audience),
    enrollments.consume(capability.token, ownerId, capability.audience),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1,
    "exactly one racing enrollment consume must succeed");
  assert.equal(attempts.filter(result => result.status === "rejected" && result.reason?.code === "ENROLLMENT_REPLAYED").length, 1,
    "the losing enrollment consume must be a replay");
  const [stored] = await sql`
    select token_hash, consumed_at from web_lab_control.runner_enrollment_capabilities
    where owner_id = ${ownerId}
  `;
  assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.token_hash, capability.token, "raw enrollment token must not be persisted");
  assert.ok(stored.consumed_at);
}

async function main() {
  let resource;
  let connection;
  let summary;
  try {
    currentStage = "validate_inputs";
    await validateInputs();
    currentStage = "verify_clean_resources";
    assert.deepEqual(await resourceCount(), { containers: 0, volumes: 0 });
    currentStage = "start_disposable_postgres";
    resource = await startPostgres();
    currentStage = "restore_current_clone";
    await restoreCurrentClone(resource);
    connection = db(resource);
    currentStage = "assert_initial_catalog";
    await assertInitialCatalog(connection);
    currentStage = "snapshot_before";
    const before = await dataSnapshot(connection);
    assert.equal(before.counts["web_lab_control.web_lab_builds"], 2,
      "verified clone must retain the two immutable builds");
    currentStage = "apply_hardening_changeset";
    await applyChangeSet(resource);
    currentStage = "assert_hardened_catalog";
    await assertHardenedCatalog(connection);
    currentStage = "assert_application_compatibility";
    await assertApplicationCompatibility(connection);
    currentStage = "assert_default_privilege_probe";
    await assertDefaultPrivilegeProbe(connection);
    currentStage = "assert_runtime_security_persistence";
    await assertRuntimeSecurityPersistence(connection);
    currentStage = "snapshot_after";
    const after = await dataSnapshot(connection);
    assert.deepEqual(after, before, "security hardening must preserve all protected rows");
    summary = {
      status: "PASS",
      archive: "fresh_pre_phase13_verified",
      productionConnections: 0,
      productionMutations: 0,
      phase13AppliedToDisposableClone: true,
      protectedDataPreserved: true,
      publicSecurityNarrowed: true,
      privateControlPlanePreserved: true,
      requiredIndexValid: true,
      defaultPrivilegesFailClosed: true,
      guardedAdminAnalyticsCompatible: true,
      runtimeSecurityPersistenceReady: true,
      immutableBuildsPreserved: after.counts["web_lab_control.web_lab_builds"] === 2,
    };
  } finally {
    if (connection) await connection.end({ timeout: 5 }).catch(() => undefined);
    await cleanupPostgres(resource);
  }
  assert.deepEqual(await resourceCount(), { containers: 0, volumes: 0 });
  process.stdout.write(`${JSON.stringify({ ...summary, cleanup: "PASS" }, null, 2)}\n`);
}

main().catch(async error => {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
    ? error.code : "VALIDATION_FAILED";
  process.stderr.write(`Security hardening rehearsal failed at ${currentStage}: ${code}\n`);
  process.exitCode = 1;
});
