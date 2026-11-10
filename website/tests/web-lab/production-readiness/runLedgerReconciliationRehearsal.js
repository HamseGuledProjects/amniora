#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated production-clone rehearsal. */
"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const postgres = require("postgres");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../../..");
const ARCHIVE = path.join(ROOT, "fixtures", "not-distributed", "database.dump");
const ARCHIVE_SHA256 = "0".repeat(64);
const LABEL = "com.amniora.phase12-ledger-reconciliation=true";
const IMAGE = "supabase/postgres:17.6.1.155";
const PHASE12 = "20260922211651";
const PHASE13 = "20260922215508";
const WRONG_VERSION = "20991231235959";
const CLI = path.join(ROOT, "node_modules/.bin/supabase");
const PHASE12_MIGRATION = path.join(
  ROOT, "supabase/migrations/20260922211651_web_lab_control_plane_persistence.sql",
);
const PHASE13_MIGRATION = path.join(
  ROOT, "supabase/migrations/20260922215508_web_lab_launch_grant_exchange.sql",
);
const DATABASES = {
  base: "amniora_phase12_reconciliation",
  wrong: "amniora_phase12_wrong_version",
  mismatch: "amniora_phase12_catalog_mismatch",
  correct: "amniora_phase12_already_correct",
  phase13: "amniora_phase13_after_reconciliation",
};
const PHASE12_TABLES = [
  "runtime_admission",
  "runtime_admission_slots",
  "runtime_audit_events",
  "runtime_budget_policy",
  "runtime_commands",
  "runtime_instances",
  "runtime_usage",
  "web_lab_builds",
  "web_lab_completions",
  "web_lab_grade_attempts",
];
const DATA_TABLES = [
  "public.labs",
  "public.ai_usage",
  "public.ai_usage_reservations",
  "public.ai_usage_events",
  "public.lab_generation_jobs",
  ...PHASE12_TABLES.map(name => `web_lab_control.${name}`),
];
let currentStage = "startup";
let lastCliDiagnostic = "none";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEnvironment(extra = {}) {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    NO_COLOR: "1",
    SUPABASE_ACCESS_TOKEN: "unused",
    ...extra,
  };
}

async function command(program, args, options = {}) {
  return execFileAsync(program, args, {
    cwd: options.cwd || ROOT,
    timeout: options.timeout || 300_000,
    maxBuffer: 16 * 1024 * 1024,
    env: options.env || safeEnvironment(),
  });
}

async function docker(...args) {
  const result = await command("docker", args);
  return result.stdout.trim();
}

function databaseUrl(resource, database) {
  return `postgresql://postgres:${encodeURIComponent(resource.password)}` +
    `@127.0.0.1:${resource.port}/${database}?sslmode=disable`;
}

function db(resource, database, max = 2) {
  return postgres(databaseUrl(resource, database), {
    max,
    prepare: false,
    onnotice: () => undefined,
  });
}

async function waitForPostgres(containerName) {
  let lastError;
  for (let attempt = 0; attempt < 240; attempt++) {
    try {
      const ready = await docker(
        "exec", containerName, "psql", "-U", "postgres", "-d", "postgres",
        "-v", "ON_ERROR_STOP=1", "-Atqc", "select 1",
      );
      if (ready === "1") return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`disposable_postgres_not_ready:${lastError ? "probe_failed" : "timeout"}`);
}

async function startPostgres() {
  const suffix = `${process.pid}-${randomBytes(5).toString("hex")}`;
  const containerName = `amniora-phase12-ledger-${suffix}`;
  const volumeName = `amniora-phase12-ledger-${suffix}`;
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
      IMAGE,
    );
    await waitForPostgres(containerName);
    await new Promise(resolve => setTimeout(resolve, 3_000));
    await waitForPostgres(containerName);
    const binding = await docker("port", containerName, "5432/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error("disposable_postgres_not_loopback_only");
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

async function validateArchive() {
  const stat = fs.statSync(ARCHIVE);
  assert.equal(stat.isFile(), true, "verified production archive must be a file");
  assert.equal(stat.size, 813690, "archive byte size drifted");
  assert.equal(stat.mode & 0o777, 0o600, "archive permissions must remain 0600");
  assert.equal(fs.statSync(path.dirname(ARCHIVE)).mode & 0o777, 0o700,
    "archive directory permissions must remain 0700");
  const digest = await command("shasum", ["-a", "256", ARCHIVE]);
  assert.equal(digest.stdout.trim().split(/\s+/)[0], ARCHIVE_SHA256, "archive digest drifted");
}

async function restoreArchive(resource) {
  currentStage = "archive-restore-role-bootstrap";
  await docker(
    "exec", resource.containerName, "psql", "-U", "supabase_admin", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1", "-c",
    "do $$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then create role supabase_realtime_admin nologin; end if; end $$;",
  );
  currentStage = "archive-restore-database-create";
  await docker(
    "exec", resource.containerName, "createdb", "-U", "supabase_admin", "-O", "postgres",
    "-T", "template0", DATABASES.base,
  );
  currentStage = "archive-restore-event-trigger-count";
  const eventTriggerCount = Number(await docker(
    "exec", resource.containerName, "sh", "-ceu",
    "pg_restore -l /rehearsal/production.dump | grep -c ' EVENT TRIGGER ' || true",
  ));
  assert.equal(eventTriggerCount, 7, "expected seven platform-managed event triggers");
  currentStage = "archive-restore-toc-filter";
  await docker(
    "exec", resource.containerName, "sh", "-ceu",
    "pg_restore -l /rehearsal/production.dump | awk 'index($0, \" EVENT TRIGGER \") == 0' > /tmp/phase12-restore.list",
  );
  currentStage = "archive-restore-pg-restore";
  try {
    await docker(
      "exec", resource.containerName, "pg_restore", "-U", "supabase_admin", "-d", DATABASES.base,
      "--use-list=/tmp/phase12-restore.list", "--single-transaction", "--exit-on-error",
      "/rehearsal/production.dump",
    );
  } catch (error) {
    const diagnostic = `${error?.stderr || ""}`;
    let category = diagnostic.includes("must be member of role") ? "role-membership" :
      diagnostic.includes("permission denied") ? "permission" :
      diagnostic.includes("already exists") ? "object-collision" :
      diagnostic.includes("does not exist") ? "missing-object" :
      diagnostic.includes("event trigger") ? "event-trigger" : "unclassified";
    if (category === "unclassified") {
      category = (diagnostic.match(/(?:ERROR|error):\s*([^\n]+)/)?.[1] || "unclassified")
        .replace(/"[^"]*"/g, "identifier")
        .replace(/[^a-z0-9]+/gi, "_")
        .slice(0, 120);
    }
    throw new Error(`pg_restore_${category}`);
  }
  return eventTriggerCount;
}

async function cloneDatabase(resource, source, target) {
  await docker(
    "exec", resource.containerName, "createdb", "-U", "supabase_admin", "-O", "postgres",
    "-T", source, target,
  );
}

async function queryOnce(resource, database, operation) {
  const connection = db(resource, database);
  try {
    return await operation(connection);
  } finally {
    await connection.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function ledgerSnapshot(resource, database) {
  return queryOnce(resource, database, async sql => sql`
    select version, coalesce(name, '') as name
    from supabase_migrations.schema_migrations
    order by version
  `);
}

async function buildSnapshot(resource, database) {
  const rows = await queryOnce(resource, database, async sql => sql`
    select b.id, b.saved_lab_id, b.owner_id, b.build_fingerprint,
           b.schema_version, b.compiler_version, b.runtime_version, b.created_at,
           encode(digest(b.canonical_spec, 'sha256'), 'hex') = b.build_fingerprint as canonical_valid,
           exists (
             select 1 from public.labs l
             where l.id = b.saved_lab_id and l.user_id = b.owner_id
           ) as saved_lab_owner_valid,
           exists (
             select 1 from public.lab_generation_jobs j
             where j.resulting_lab_id = b.saved_lab_id and j.user_id = b.owner_id
           ) as generation_owner_valid
    from web_lab_control.web_lab_builds b
    order by b.id
  `);
  const normalized = rows.map(row => ({ ...row, created_at: row.created_at.toISOString() }));
  return {
    count: normalized.length,
    valid: normalized.filter(row => row.canonical_valid && row.saved_lab_owner_valid &&
      row.generation_owner_valid).length,
    fingerprint: sha256(JSON.stringify(normalized)),
  };
}

async function dataFingerprint(resource, database) {
  const manifest = [];
  await queryOnce(resource, database, async sql => {
    for (const table of DATA_TABLES) {
      assert.match(table, /^(public|web_lab_control)\.[a-z_]+$/);
      const [row] = await sql.unsafe(`
        select count(*)::integer as row_count,
               encode(digest(coalesce(string_agg(md5(to_jsonb(t)::text), ''
                 order by md5(to_jsonb(t)::text)), ''), 'sha256'), 'hex') as row_digest
        from ${table} t
      `);
      manifest.push({ table, row_count: row.row_count, row_digest: row.row_digest });
    }
  });
  return { fingerprint: sha256(JSON.stringify(manifest)), manifest };
}

async function catalogFingerprint(resource, database) {
  const manifest = await queryOnce(resource, database, async sql => {
    const schema = await sql`
      select n.nspname, pg_get_userbyid(n.nspowner) as owner, coalesce(n.nspacl::text, '') as acl
      from pg_namespace n where n.nspname = 'web_lab_control'
    `;
    const relations = await sql`
      select c.relname, c.relkind, c.relpersistence, pg_get_userbyid(c.relowner) as owner,
             c.relrowsecurity, c.relforcerowsecurity, coalesce(c.relacl::text, '') as acl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control'
        and c.relkind in ('r', 'p', 'S')
        and c.relname <> 'runtime_launch_exchanges'
        and c.relname <> 'runtime_launch_exchanges_pkey'
      order by c.relkind, c.relname
    `;
    const columns = await sql`
      select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as type,
             a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), '') as default_expression,
             a.attidentity, a.attgenerated, coalesce(coll.collname, '') as collation
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      left join pg_collation coll on coll.oid = a.attcollation
      where n.nspname = 'web_lab_control' and c.relkind in ('r', 'p')
        and c.relname <> 'runtime_launch_exchanges'
        and a.attnum > 0 and not a.attisdropped
      order by c.relname, a.attnum
    `;
    const constraints = await sql`
      select c.relname, con.conname, con.contype, con.convalidated, con.condeferrable,
             con.condeferred, pg_get_constraintdef(con.oid, true) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control' and c.relname <> 'runtime_launch_exchanges'
      order by c.relname, con.conname
    `;
    const indexes = await sql`
      select t.relname as table_name, i.relname as index_name, ix.indisunique, ix.indisprimary,
             ix.indisvalid, ix.indisready, pg_get_indexdef(i.oid) as definition,
             coalesce(pg_get_expr(ix.indpred, ix.indrelid), '') as predicate
      from pg_index ix
      join pg_class t on t.oid = ix.indrelid
      join pg_class i on i.oid = ix.indexrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'web_lab_control' and t.relname <> 'runtime_launch_exchanges'
      order by t.relname, i.relname
    `;
    const triggers = await sql`
      select c.relname, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid, true) as definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control' and not t.tgisinternal
        and c.relname <> 'runtime_launch_exchanges'
      order by c.relname, t.tgname
    `;
    const functions = await sql`
      select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
             pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.provolatile,
             coalesce(p.proacl::text, '') as acl, pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'web_lab_control'
      order by p.proname, arguments
    `;
    const policies = await sql`
      select schemaname, tablename, policyname, permissive, roles::text, cmd,
             coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
      from pg_policies
      where schemaname = 'web_lab_control' and tablename <> 'runtime_launch_exchanges'
      order by tablename, policyname
    `;
    const comments = await sql`
      select c.relname, a.attname, d.description
      from pg_description d
      join pg_class c on c.oid = d.objoid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
      where n.nspname = 'web_lab_control' and c.relname <> 'runtime_launch_exchanges'
      order by c.relname, a.attname nulls first, d.description
    `;
    const [publicOwnerIndex] = await sql`
      select pg_get_indexdef(c.oid) as definition
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'labs_web_build_owner_key'
    `;
    const [seed] = await sql`
      select
        (select count(*)::integer from web_lab_control.runtime_admission_slots) as slot_count,
        (select count(*)::integer from web_lab_control.runtime_admission_slots where instance_id is null) as free_slots,
        (select coalesce(min(slot_no), 0)::integer from web_lab_control.runtime_admission_slots) as first_slot,
        (select coalesce(max(slot_no), 0)::integer from web_lab_control.runtime_admission_slots) as last_slot,
        (select count(*)::integer from web_lab_control.runtime_budget_policy) as budget_rows,
        (select count(*)::integer from web_lab_control.runtime_budget_policy
          where hosted_runtime_enabled = false and budget_state = 'DISABLED') as disabled_budget_rows
    `;
    return { schema, relations, columns, constraints, indexes, triggers, functions,
      policies, comments, publicOwnerIndex, seed };
  });
  return { fingerprint: sha256(JSON.stringify(manifest)), manifest };
}

async function safeState(resource, database) {
  const parentStage = currentStage;
  currentStage = `${parentStage}-ledger`;
  const ledger = await ledgerSnapshot(resource, database);
  currentStage = `${parentStage}-catalog`;
  const catalog = await catalogFingerprint(resource, database);
  currentStage = `${parentStage}-builds`;
  const builds = await buildSnapshot(resource, database);
  currentStage = `${parentStage}-data`;
  const data = await dataFingerprint(resource, database);
  currentStage = parentStage;
  return {
    ledger,
    ledgerFingerprint: sha256(JSON.stringify(ledger)),
    catalogFingerprint: catalog.fingerprint,
    builds,
    dataFingerprint: data.fingerprint,
    counts: Object.fromEntries(data.manifest.map(row => [row.table, row.row_count])),
  };
}

async function cliVersion() {
  const result = await command(CLI, ["--version"]);
  return result.stdout.trim();
}

async function runRepair(resource, database, version, workdir, status = "applied") {
  assert.ok(workdir && workdir.startsWith(os.tmpdir()), "CLI workdir must be an isolated temporary directory");
  try {
    await command(CLI, [
      "migration", "repair", version, "--status", status,
      "--db-url", databaseUrl(resource, database), "--workdir", workdir, "--yes",
    ], { cwd: workdir });
    lastCliDiagnostic = "accepted";
    return true;
  } catch (error) {
    const diagnostic = `${error?.stderr || ""}`
      .replace(/postgres(?:ql)?:\/\/\S+/gi, "database_url_redacted") ||
      "cli_rejected_without_stderr";
    lastCliDiagnostic = diagnostic.replace(/password\s*[=:]\s*\S+/gi, "password_redacted")
      .replace(/"[^"]*"/g, "identifier")
      .replace(/[^a-z0-9_.: -]+/gi, "_")
      .slice(-420);
    return false;
  }
}

async function guardedPhase12Repair(resource, database, expected, workdir) {
  const state = await safeState(resource, database);
  if (state.catalogFingerprint !== expected.catalogFingerprint) {
    throw new Error("catalog_fingerprint_mismatch");
  }
  if (state.builds.count !== 2 || state.builds.valid !== 2 ||
      state.builds.fingerprint !== expected.builds.fingerprint) {
    throw new Error("immutable_build_guard_mismatch");
  }
  if (state.dataFingerprint !== expected.dataFingerprint) {
    throw new Error("production_clone_data_guard_mismatch");
  }
  const phase12Rows = state.ledger.filter(row => row.version === PHASE12).length;
  const phase13Rows = state.ledger.filter(row => row.version === PHASE13).length;
  if (phase13Rows !== 0) throw new Error("phase13_must_remain_absent");
  if (phase12Rows === 1) return "already-correct-no-op";
  if (phase12Rows !== 0) throw new Error("phase12_ledger_cardinality_invalid");
  if (!await runRepair(resource, database, PHASE12, workdir)) {
    throw new Error(`supported_repair_failed_${lastCliDiagnostic}`);
  }
  return "repaired";
}

async function expectGuardFailure(operation, expectedMessage) {
  await assert.rejects(operation, error => error?.message === expectedMessage);
}

async function initializeMigrationWorkspace(tempRoot) {
  try {
    await command(CLI, ["init", "--workdir", tempRoot, "--yes"], { cwd: tempRoot });
  } catch {
    throw new Error("temporary_supabase_workspace_initialization_failed");
  }
  fs.mkdirSync(path.join(tempRoot, "supabase/migrations"), { recursive: true, mode: 0o700 });
}

async function applyPhase13WithCli(resource, database, tempRoot) {
  await initializeMigrationWorkspace(tempRoot);
  const migrationsDir = path.join(tempRoot, "supabase/migrations");
  const ledger = await ledgerSnapshot(resource, database);
  for (const row of ledger) {
    assert.match(row.version, /^\d{14}$/);
    const name = (row.name || "already_applied").replace(/[^a-z0-9_]+/gi, "_");
    fs.writeFileSync(path.join(migrationsDir, `${row.version}_${name}.sql`), "", { mode: 0o600 });
  }
  fs.copyFileSync(PHASE13_MIGRATION,
    path.join(migrationsDir, "20260922215508_web_lab_launch_grant_exchange.sql"));
  try {
    await command(CLI, [
      "migration", "up", "--db-url", databaseUrl(resource, database),
      "--workdir", tempRoot,
    ], { cwd: tempRoot });
    await command(CLI, [
      "migration", "up", "--db-url", databaseUrl(resource, database),
      "--workdir", tempRoot,
    ], { cwd: tempRoot });
  } catch {
    throw new Error("phase13_cli_apply_rehearsal_failed");
  }
}

async function verifyPhase13(resource, database, phase12Expected) {
  const state = await safeState(resource, database);
  assert.equal(state.ledger.filter(row => row.version === PHASE12).length, 1);
  assert.equal(state.ledger.filter(row => row.version === PHASE13).length, 1);
  assert.equal(state.catalogFingerprint, phase12Expected.catalogFingerprint,
    "Phase-12 catalog fingerprint changed during Phase-13 apply");
  assert.deepEqual(state.builds, phase12Expected.builds, "immutable builds changed during Phase-13 apply");
  assert.equal(state.dataFingerprint, phase12Expected.dataFingerprint,
    "Phase-12/public data changed during Phase-13 apply");

  const contract = await queryOnce(resource, database, async sql => {
    const [table] = await sql`
      select c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control' and c.relname = 'runtime_launch_exchanges'
    `;
    const columns = await sql`
      select a.attname from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control' and c.relname = 'runtime_launch_exchanges'
        and a.attnum > 0 and not a.attisdropped order by a.attnum
    `;
    const constraints = await sql`
      select con.conname from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control' and c.relname = 'runtime_launch_exchanges'
      order by con.conname
    `;
    const indexes = await sql`
      select i.relname from pg_index ix
      join pg_class t on t.oid = ix.indrelid join pg_class i on i.oid = ix.indexrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'web_lab_control' and t.relname = 'runtime_launch_exchanges'
      order by i.relname
    `;
    const triggers = await sql`
      select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'web_lab_control' and c.relname = 'runtime_launch_exchanges'
        and not t.tgisinternal order by t.tgname
    `;
    const grants = await sql`
      select grantee.rolname as grantee, upper(acl.privilege_type) as privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where n.nspname = 'web_lab_control' and c.relname = 'runtime_launch_exchanges'
        and grantee.rolname in ('anon', 'authenticated', 'service_role')
      order by grantee.rolname, upper(acl.privilege_type)
    `;
    return { table, columns, constraints, indexes, triggers, grants };
  });
  assert.deepEqual(contract.columns.map(row => row.attname), [
    "grant_id_hash", "instance_id", "owner_id", "generation_version", "expires_at", "exchanged_at",
  ]);
  assert.equal(contract.table.relrowsecurity, true);
  assert.equal(contract.table.relforcerowsecurity, false);
  assert.equal(contract.constraints.length, 5);
  assert.deepEqual(contract.indexes.map(row => row.relname), [
    "runtime_launch_exchanges_expiry_idx",
    "runtime_launch_exchanges_instance_idx",
    "runtime_launch_exchanges_pkey",
  ]);
  assert.deepEqual(contract.triggers.map(row => row.tgname), ["runtime_launch_exchanges_append_only"]);
  const directGrants = contract.grants.map(row => `${row.grantee}:${row.privilege_type}`);
  if (JSON.stringify(directGrants) !== JSON.stringify([
    "service_role:INSERT", "service_role:SELECT",
  ])) throw new Error(`phase13_direct_grants_${directGrants.join("_")}`);

  const rollbackMarker = new Error("phase13_contract_transaction_rollback");
  await assert.rejects(queryOnce(resource, database, async sql => sql.begin(async tx => {
    const [build] = await tx`
      select id, owner_id from web_lab_control.web_lab_builds order by id limit 1
    `;
    const [instance] = await tx`
      insert into web_lab_control.runtime_instances
        (owner_id, web_lab_build_id, runtime_mode, provider_kind, runtime_version, route_key, expires_at)
      values (${build.owner_id}, ${build.id}, 'local_runner', 'phase13_rehearsal',
        'phase13-rehearsal-1', ${`phase13-rehearsal-${randomBytes(18).toString("base64url")}`},
        now() + interval '30 minutes')
      returning id
    `;
    const digest = sha256("phase13-disposable-launch-grant");
    await tx`
      insert into web_lab_control.runtime_launch_exchanges
        (grant_id_hash, instance_id, owner_id, generation_version, expires_at)
      values (${digest}, ${instance.id}, ${build.owner_id}, 1, now() + interval '5 minutes')
    `;
    await assert.rejects(tx.savepoint(savepoint => savepoint`
      insert into web_lab_control.runtime_launch_exchanges
        (grant_id_hash, instance_id, owner_id, generation_version, expires_at)
      values (${digest}, ${instance.id}, ${build.owner_id}, 1, now() + interval '5 minutes')
    `));
    await assert.rejects(tx.savepoint(savepoint => savepoint`
      update web_lab_control.runtime_launch_exchanges set generation_version = 2
      where grant_id_hash = ${digest}
    `), /immutable_web_lab_record/);
    throw rollbackMarker;
  })), error => error === rollbackMarker);
  const [exchangeCount] = await queryOnce(resource, database, async sql => sql`
    select count(*)::integer as count from web_lab_control.runtime_launch_exchanges
  `);
  assert.equal(exchangeCount.count, 0, "Phase-13 contract probe must roll back");
  return { ledgerRows: state.ledger.length, contract: "pass", repeatedApply: "no-op" };
}

async function resourceCount() {
  const containers = await docker("ps", "-a", "--filter", `label=${LABEL}`, "--format", "{{.ID}}");
  const volumes = await docker("volume", "ls", "--filter", `label=${LABEL}`, "--format", "{{.Name}}");
  return {
    containers: containers ? containers.split("\n").filter(Boolean).length : 0,
    volumes: volumes ? volumes.split("\n").filter(Boolean).length : 0,
  };
}

async function main() {
  let resource;
  const tempRoots = [];
  let summary;
  try {
    currentStage = "archive-validation";
    await validateArchive();
    assert.deepEqual(await resourceCount(), { containers: 0, volumes: 0 },
      "prior Phase-12 rehearsal resources must not exist");
    const version = await cliVersion();
    assert.match(version, /^\d+\.\d+\.\d+$/, "Supabase CLI must report a semantic version");
    currentStage = "container-start";
    resource = await startPostgres();
    currentStage = "archive-restore";
    const eventTriggersExcluded = await restoreArchive(resource);
    currentStage = "baseline-capture";
    const before = await safeState(resource, DATABASES.base);
    currentStage = "baseline-ledger-count";
    assert.equal(before.ledger.length, 13);
    currentStage = "baseline-phase12-ledger";
    assert.equal(before.ledger.filter(row => row.version === PHASE12).length, 0);
    currentStage = "baseline-phase13-ledger";
    assert.equal(before.ledger.filter(row => row.version === PHASE13).length, 0);
    currentStage = "baseline-build-count";
    assert.equal(before.builds.count, 2);
    currentStage = "baseline-build-validity";
    assert.equal(before.builds.valid, 2);
    currentStage = "baseline-labs-count";
    assert.equal(before.counts["public.labs"], 7);
    currentStage = "baseline-slots-count";
    assert.equal(before.counts["web_lab_control.runtime_admission_slots"], 5);
    currentStage = "baseline-budget-count";
    if (before.counts["web_lab_control.runtime_budget_policy"] !== 1) {
      throw new Error(`baseline_budget_count_${String(
        before.counts["web_lab_control.runtime_budget_policy"],
      ).replace(/[^a-z0-9]+/gi, "_")}`);
    }

    currentStage = "repair-workspace";
    const repairRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase12-repair-"));
    tempRoots.push(repairRoot);
    await initializeMigrationWorkspace(repairRoot);
    fs.copyFileSync(PHASE12_MIGRATION,
      path.join(repairRoot, "supabase/migrations/20260922211651_web_lab_control_plane_persistence.sql"));

    currentStage = "scenario-clones";
    await cloneDatabase(resource, DATABASES.base, DATABASES.wrong);
    await cloneDatabase(resource, DATABASES.base, DATABASES.mismatch);
    currentStage = "supported-repair";
    const repairResult = await guardedPhase12Repair(resource, DATABASES.base, before, repairRoot);
    assert.equal(repairResult, "repaired");
    const after = await safeState(resource, DATABASES.base);
    assert.equal(after.ledger.length, 14);
    assert.equal(after.ledger.filter(row => row.version === PHASE12).length, 1);
    assert.equal(after.ledger.filter(row => row.version === PHASE13).length, 0);
    assert.equal(after.catalogFingerprint, before.catalogFingerprint);
    assert.deepEqual(after.builds, before.builds);
    assert.equal(after.dataFingerprint, before.dataFingerprint);

    currentStage = "repeat-repair";
    const repeatedAccepted = await runRepair(resource, DATABASES.base, PHASE12, repairRoot);
    const afterRepeated = await safeState(resource, DATABASES.base);
    assert.equal(afterRepeated.ledger.filter(row => row.version === PHASE12).length, 1);
    assert.equal(afterRepeated.catalogFingerprint, before.catalogFingerprint);
    assert.deepEqual(afterRepeated.builds, before.builds);
    assert.equal(afterRepeated.dataFingerprint, before.dataFingerprint);

    currentStage = "wrong-version";
    const wrongAccepted = await runRepair(resource, DATABASES.wrong, WRONG_VERSION, repairRoot);
    const wrongLedger = await ledgerSnapshot(resource, DATABASES.wrong);
    assert.equal(wrongLedger.filter(row => row.version === WRONG_VERSION).length, wrongAccepted ? 1 : 0);

    currentStage = "catalog-mismatch";
    await queryOnce(resource, DATABASES.mismatch, sql => sql`
      alter table web_lab_control.runtime_instances
      add column phase12_rehearsal_mismatch boolean not null default false
    `);
    await expectGuardFailure(
      guardedPhase12Repair(resource, DATABASES.mismatch, before, repairRoot),
      "catalog_fingerprint_mismatch",
    );
    const mismatchLedger = await ledgerSnapshot(resource, DATABASES.mismatch);
    assert.equal(mismatchLedger.filter(row => row.version === PHASE12).length, 0);

    currentStage = "already-correct";
    await cloneDatabase(resource, DATABASES.base, DATABASES.correct);
    assert.equal(await guardedPhase12Repair(resource, DATABASES.correct, after, repairRoot),
      "already-correct-no-op");
    const correctLedger = await ledgerSnapshot(resource, DATABASES.correct);
    assert.equal(correctLedger.filter(row => row.version === PHASE12).length, 1);

    currentStage = "phase13-apply";
    await cloneDatabase(resource, DATABASES.base, DATABASES.phase13);
    const phase13Root = fs.mkdtempSync(path.join(os.tmpdir(), "amniora-phase13-rehearsal-"));
    tempRoots.push(phase13Root);
    await applyPhase13WithCli(resource, DATABASES.phase13, phase13Root);
    currentStage = "phase13-contract";
    const phase13 = await verifyPhase13(resource, DATABASES.phase13, after);

    summary = {
      status: "COMPLETE",
      cli: { tool: "Supabase CLI", version, mechanism: "migration repair --status applied --db-url" },
      restore: { postgres: "17.6", eventTriggersExcluded, productionConnections: 0 },
      before: {
        ledgerRows: before.ledger.length,
        phase12Rows: 0,
        phase13Rows: 0,
        catalogFingerprint: before.catalogFingerprint,
        dataFingerprint: before.dataFingerprint,
        builds: before.builds,
      },
      repair: {
        result: repairResult,
        sqlReplayed: false,
        repeatedRepair: repeatedAccepted ? "accepted-idempotently" : "rejected-without-change",
        wrongVersion: wrongAccepted ? "cli-accepted-metadata-only; guarded procedure must reject" : "cli-rejected",
        mismatchedCatalog: "guarded procedure rejected before repair",
        alreadyCorrect: "guarded no-op",
      },
      after: {
        ledgerRows: after.ledger.length,
        phase12Rows: 1,
        phase13Rows: 0,
        catalogFingerprint: after.catalogFingerprint,
        dataFingerprint: after.dataFingerprint,
        builds: after.builds,
      },
      phase13,
    };
  } finally {
    for (const tempRoot of tempRoots) fs.rmSync(tempRoot, { recursive: true, force: true });
    await cleanupPostgres(resource);
  }
  const cleanup = await resourceCount();
  assert.deepEqual(cleanup, { containers: 0, volumes: 0 });
  summary.cleanup = { ...cleanup, temporaryCredentials: "destroyed", temporaryFixtures: "removed" };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(error => {
  const rawMessage = typeof error?.message === "string" ? error.message : "unknown_error";
  const redactedMessage = rawMessage
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "database_url_redacted")
    .replace(/password\s*[=:]\s*\S+/gi, "password_redacted");
  const safeMessage = redactedMessage.includes("Command failed")
    ? "rehearsal_step_failed"
    : redactedMessage.replace(/[^a-z0-9_.: -]+/gi, "_").slice(0, 520);
  process.stderr.write(`Phase-12 ledger reconciliation rehearsal failed at ${currentStage}: ${safeMessage}\n`);
  process.exitCode = 1;
});
