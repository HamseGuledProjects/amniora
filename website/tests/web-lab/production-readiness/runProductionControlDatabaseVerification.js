#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Explicit production verification entrypoint. */
"use strict";

const postgres = require("postgres");

const connection = process.env.WEB_LAB_CONTROL_DATABASE_URL;
if (!connection) {
  process.stderr.write("Production control database verification FAILED\n");
  process.exit(1);
}

class RollbackVerification extends Error {}

async function main() {
  const sql = postgres(connection, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 5,
    connection: { statement_timeout: 5_000 },
  });
  try {
    const [catalog] = await sql`
      select
        current_user = 'amniora_web_lab_control' as correct_role,
        not r.rolsuper and not r.rolcreatedb and not r.rolcreaterole and
          not r.rolinherit and not r.rolreplication and not r.rolbypassrls as safe_attributes,
        not exists (select 1 from pg_auth_members where member = r.oid) as independent_role,
        has_database_privilege(current_user, current_database(), 'CONNECT') as can_connect,
        has_schema_privilege(current_user, 'public', 'USAGE') and
          has_schema_privilege(current_user, 'web_lab_control', 'USAGE') as schema_usage,
        not has_schema_privilege(current_user, 'public', 'CREATE') and
          not has_schema_privilege(current_user, 'web_lab_control', 'CREATE') as no_schema_create,
        not has_table_privilege(current_user,
          'web_lab_control.runner_enrollment_capabilities', 'SELECT') and
        not has_table_privilege(current_user,
          'web_lab_control.runner_enrollment_capabilities', 'INSERT') and
        not has_table_privilege(current_user,
          'web_lab_control.runner_enrollment_capabilities', 'UPDATE') and
        not has_table_privilege(current_user,
          'web_lab_control.runner_enrollment_capabilities', 'DELETE') as no_enrollment_access,
        (
          select count(*) = 13
          from pg_policies
          where policyname like 'amniora_control_%'
            and current_user = any (roles)
        ) as exact_policies,
        (
          select count(*) = 6 and bool_and(c.relrowsecurity)
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where (n.nspname, c.relname) in (
            ('public', 'profiles'),
            ('public', 'labs'),
            ('public', 'lab_generation_jobs'),
            ('web_lab_control', 'web_lab_builds'),
            ('web_lab_control', 'security_rate_limit_windows'),
            ('web_lab_control', 'security_rate_limit_requests')
          )
        ) as exact_rls
      from pg_roles r
      where r.rolname = current_user
    `;
    if (!catalog || Object.values(catalog).some(value => value !== true)) {
      throw new Error("catalog_verification_failed");
    }

    try {
      await sql.begin(async tx => {
        await tx`select plan from public.profiles where false`;
        await tx`select id from public.labs where false`;
        await tx`
          select status, category, difficulty, duration, resulting_lab_id
          from public.lab_generation_jobs where false for update
        `;
        await tx`
          insert into public.labs (
            user_id, title, topic, difficulty, estimated_time, objective,
            scenario, tasks, hints, outcomes, completed
          )
          select null::uuid, null::text, null::text, null::text, null::text,
            null::text, null::text, null::jsonb, null::jsonb, null::jsonb, false
          where false
          returning id
        `;
        await tx`
          update public.lab_generation_jobs
          set resulting_lab_id = null, updated_at = now()
          where false returning id
        `;
        await tx`
          select id, saved_lab_id, canonical_lab_id, seed, template_id,
            template_version, vulnerability_module_id, vulnerability_module_version,
            schema_version, compiler_version, runtime_version, build_fingerprint,
            learner_bundle_fingerprint, created_at
          from web_lab_control.web_lab_builds where false
        `;
        await tx`
          insert into web_lab_control.web_lab_builds (
            saved_lab_id, owner_id, canonical_lab_id, schema_version, template_id,
            template_version, vulnerability_module_id, vulnerability_module_version,
            seed, compiler_version, runtime_version, build_fingerprint,
            learner_bundle_fingerprint, canonical_spec
          )
          select null::uuid, null::uuid, null::text, null::integer, null::text,
            null::text, null::text, null::text, null::text, null::text,
            null::text, null::text, null::text, null::text
          where false
          returning id, saved_lab_id, canonical_lab_id, template_id,
            template_version, vulnerability_module_id, vulnerability_module_version,
            schema_version, compiler_version, runtime_version, build_fingerprint,
            learner_bundle_fingerprint, created_at
        `;
        await tx`
          insert into web_lab_control.security_rate_limit_windows (
            owner_id, surface, window_started_at, request_limit, used_count
          )
          select null::uuid, null::text, null::timestamptz, null::integer, null::integer
          where false returning used_count
        `;
        await tx`
          update web_lab_control.security_rate_limit_windows
          set used_count = used_count + 1, updated_at = now()
          where false returning used_count
        `;
        await tx`
          insert into web_lab_control.security_rate_limit_requests (
            owner_id, surface, idempotency_key, request_hash, window_started_at, allowed
          )
          select null::uuid, null::text, null::text, null::text, null::timestamptz, false
          where false returning allowed
        `;
        await tx`
          update web_lab_control.security_rate_limit_requests
          set allowed = false where false returning allowed
        `;
        throw new RollbackVerification();
      });
    } catch (error) {
      if (!(error instanceof RollbackVerification)) throw error;
    }
  } finally {
    await sql.end({ timeout: 1 });
  }
  process.stdout.write(
    "Production control database verification PASS (identity, objects, RLS, least privilege, rollback-only operations)\n",
  );
}

main().catch(() => {
  process.stderr.write("Production control database verification FAILED\n");
  process.exitCode = 1;
});
