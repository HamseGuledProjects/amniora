#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated local Postgres rehearsal. */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../../..");
const migrations = path.join(ROOT, "supabase/migrations");
const migrationName = fs.readdirSync(migrations)
  .find(file => file.endsWith("_web_lab_control_runtime_role.sql"));
if (!migrationName) throw new Error("control_database_role_migration_missing");

const fixture = path.join(__dirname, "fixtures/control-database-role.sql");
const migration = path.join(migrations, migrationName);
const container = `amniora-control-role-${randomUUID().slice(0, 12)}`;

function docker(args, options = {}) {
  return spawnSync("docker", args, { encoding: "utf8", ...options });
}

function applySql(sql, label) {
  const result = docker([
    "exec", "-i", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", "postgres",
  ], { input: sql });
  if (result.status !== 0) {
    throw new Error(`${label}_failed\n${result.stderr.trim()}`);
  }
}

const verify = String.raw`
do $$
declare
  role_row record;
  policy_count integer;
begin
  select * into role_row from pg_roles where rolname = 'amniora_web_lab_control';
  if role_row is null or role_row.rolcanlogin or role_row.rolsuper or
      role_row.rolcreatedb or role_row.rolcreaterole or role_row.rolinherit or
      role_row.rolreplication or role_row.rolbypassrls then
    raise exception 'unsafe_role_attributes';
  end if;
  if not has_database_privilege('amniora_web_lab_control', current_database(), 'CONNECT') or
      not has_schema_privilege('amniora_web_lab_control', 'public', 'USAGE') or
      not has_schema_privilege('amniora_web_lab_control', 'web_lab_control', 'USAGE') then
    raise exception 'required_connection_or_schema_privilege_missing';
  end if;
  if has_schema_privilege('amniora_web_lab_control', 'public', 'CREATE') or
      has_schema_privilege('amniora_web_lab_control', 'web_lab_control', 'CREATE') then
    raise exception 'unexpected_schema_create_privilege';
  end if;
  if not has_column_privilege('amniora_web_lab_control', 'public.profiles', 'plan', 'SELECT') or
      has_column_privilege('amniora_web_lab_control', 'public.profiles', 'email', 'SELECT') or
      not has_column_privilege('amniora_web_lab_control', 'public.labs', 'id', 'SELECT') or
      has_column_privilege('amniora_web_lab_control', 'public.labs', 'title', 'SELECT') or
      not has_column_privilege('amniora_web_lab_control', 'public.labs', 'title', 'INSERT') or
      has_column_privilege('amniora_web_lab_control', 'public.labs', 'id', 'INSERT') or
      not has_column_privilege('amniora_web_lab_control', 'public.lab_generation_jobs', 'resulting_lab_id', 'UPDATE') or
      has_column_privilege('amniora_web_lab_control', 'public.lab_generation_jobs', 'status', 'UPDATE') or
      not has_column_privilege('amniora_web_lab_control', 'web_lab_control.web_lab_builds', 'canonical_spec', 'INSERT') or
      has_column_privilege('amniora_web_lab_control', 'web_lab_control.web_lab_builds', 'derived_from_build_id', 'INSERT') then
    raise exception 'column_privilege_mismatch';
  end if;
  if has_table_privilege('amniora_web_lab_control', 'public.profiles', 'UPDATE') or
      has_table_privilege('amniora_web_lab_control', 'public.labs', 'UPDATE') or
      has_table_privilege('amniora_web_lab_control', 'public.lab_generation_jobs', 'INSERT') or
      has_table_privilege('amniora_web_lab_control', 'web_lab_control.web_lab_builds', 'UPDATE') or
      has_table_privilege('amniora_web_lab_control', 'web_lab_control.security_rate_limit_windows', 'DELETE') or
      has_table_privilege('amniora_web_lab_control', 'web_lab_control.security_rate_limit_requests', 'DELETE') or
      has_table_privilege('amniora_web_lab_control', 'web_lab_control.runner_enrollment_capabilities', 'SELECT') then
    raise exception 'unexpected_table_privilege';
  end if;
  select count(*) into policy_count
  from pg_policies
  where policyname like 'amniora_control_%'
    and 'amniora_web_lab_control' = any (roles);
  if policy_count <> 13 then raise exception 'role_policy_count_mismatch'; end if;
end
$$;
`;

try {
  const started = docker([
    "run", "--rm", "-d", "--name", container,
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine",
  ]);
  if (started.status !== 0) throw new Error(`postgres_start_failed\n${started.stderr.trim()}`);

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker(["exec", container, "pg_isready", "-U", "postgres"]).status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!ready) throw new Error("postgres_readiness_timeout");

  applySql(fs.readFileSync(fixture, "utf8"), "fixture");
  applySql(fs.readFileSync(migration, "utf8"), "first_migration");
  applySql(fs.readFileSync(migration, "utf8"), "idempotent_migration");
  applySql(verify, "privilege_verification");
  process.stdout.write("Control database role rehearsal PASS (Postgres 17, idempotent, least privilege)\n");
} finally {
  docker(["rm", "-f", container]);
}
