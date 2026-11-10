-- Phase 9 provider setup: a dedicated, non-owner login identity for only the
-- completed shared controls. The credential is configured out of band after
-- this migration; no password or connection string belongs in migration SQL.

do $$
declare
  role_is_privileged boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'amniora_web_lab_control') then
    create role amniora_web_lab_control
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;

  select rolsuper or rolcreatedb or rolcreaterole or rolinherit or
      rolreplication or rolbypassrls or exists (
        select 1 from pg_auth_members where member = pg_roles.oid
      )
    into role_is_privileged
  from pg_roles
  where rolname = 'amniora_web_lab_control';

  if coalesce(role_is_privileged, true) then
    raise exception 'amniora_web_lab_control_must_remain_unprivileged_and_independent';
  end if;

  execute format(
    'revoke all privileges on database %I from amniora_web_lab_control',
    current_database()
  );
  execute format(
    'grant connect on database %I to amniora_web_lab_control',
    current_database()
  );
end
$$;

revoke all on schema public, web_lab_control from amniora_web_lab_control;
grant usage on schema public, web_lab_control to amniora_web_lab_control;

revoke all on table
  public.profiles,
  public.labs,
  public.lab_generation_jobs,
  web_lab_control.web_lab_builds,
  web_lab_control.security_rate_limit_windows,
  web_lab_control.security_rate_limit_requests
from amniora_web_lab_control;

revoke all on all sequences in schema public, web_lab_control
from amniora_web_lab_control;

-- Server-authoritative entitlement lookup.
grant select (id, plan) on table public.profiles
to amniora_web_lab_control;

-- Executable Saved Lab transaction. The role can return only the generated
-- lab ID and cannot read learner-facing content from public.labs.
grant select (id) on table public.labs
to amniora_web_lab_control;
grant insert (
  user_id, title, topic, difficulty, estimated_time, objective,
  scenario, tasks, hints, outcomes, completed
) on table public.labs to amniora_web_lab_control;

grant select (
  id, user_id, status, category, difficulty, duration, resulting_lab_id
) on table public.lab_generation_jobs to amniora_web_lab_control;
grant update (resulting_lab_id, updated_at)
on table public.lab_generation_jobs to amniora_web_lab_control;

-- Immutable canonical build insertion and safe metadata reuse.
grant select (
  id, saved_lab_id, owner_id, canonical_lab_id, seed, template_id,
  template_version, vulnerability_module_id, vulnerability_module_version,
  schema_version, compiler_version, runtime_version, build_fingerprint,
  learner_bundle_fingerprint, created_at
) on table web_lab_control.web_lab_builds to amniora_web_lab_control;
grant insert (
  saved_lab_id, owner_id, canonical_lab_id, schema_version, template_id,
  template_version, vulnerability_module_id, vulnerability_module_version,
  seed, compiler_version, runtime_version, build_fingerprint,
  learner_bundle_fingerprint, canonical_spec
) on table web_lab_control.web_lab_builds to amniora_web_lab_control;

-- B6 distributed security/abuse decisions. Delete remains intentionally
-- unavailable; retention requires a separate administrative path.
grant select (
  owner_id, surface, window_started_at, request_limit, used_count
) on table web_lab_control.security_rate_limit_windows
to amniora_web_lab_control;
grant insert (
  owner_id, surface, window_started_at, request_limit, used_count
) on table web_lab_control.security_rate_limit_windows
to amniora_web_lab_control;
grant update (used_count, updated_at)
on table web_lab_control.security_rate_limit_windows
to amniora_web_lab_control;

grant select (
  owner_id, surface, idempotency_key, request_hash, allowed
) on table web_lab_control.security_rate_limit_requests
to amniora_web_lab_control;
grant insert (
  owner_id, surface, idempotency_key, request_hash, window_started_at, allowed
) on table web_lab_control.security_rate_limit_requests
to amniora_web_lab_control;
grant update (allowed)
on table web_lab_control.security_rate_limit_requests
to amniora_web_lab_control;

-- Direct Postgres callers still pass through RLS. These policies are scoped
-- to the dedicated role, whose object grants above remain the hard boundary.
drop policy if exists amniora_control_profiles_select on public.profiles;
create policy amniora_control_profiles_select
  on public.profiles for select to amniora_web_lab_control
  using (true);

drop policy if exists amniora_control_labs_select_id on public.labs;
create policy amniora_control_labs_select_id
  on public.labs for select to amniora_web_lab_control
  using (true);
drop policy if exists amniora_control_labs_insert on public.labs;
create policy amniora_control_labs_insert
  on public.labs for insert to amniora_web_lab_control
  with check (true);

drop policy if exists amniora_control_jobs_select on public.lab_generation_jobs;
create policy amniora_control_jobs_select
  on public.lab_generation_jobs for select to amniora_web_lab_control
  using (true);
drop policy if exists amniora_control_jobs_update on public.lab_generation_jobs;
create policy amniora_control_jobs_update
  on public.lab_generation_jobs for update to amniora_web_lab_control
  using (true) with check (true);

drop policy if exists amniora_control_builds_select on web_lab_control.web_lab_builds;
create policy amniora_control_builds_select
  on web_lab_control.web_lab_builds for select to amniora_web_lab_control
  using (true);
drop policy if exists amniora_control_builds_insert on web_lab_control.web_lab_builds;
create policy amniora_control_builds_insert
  on web_lab_control.web_lab_builds for insert to amniora_web_lab_control
  with check (true);

drop policy if exists amniora_control_rate_windows_select
  on web_lab_control.security_rate_limit_windows;
create policy amniora_control_rate_windows_select
  on web_lab_control.security_rate_limit_windows
  for select to amniora_web_lab_control using (true);
drop policy if exists amniora_control_rate_windows_insert
  on web_lab_control.security_rate_limit_windows;
create policy amniora_control_rate_windows_insert
  on web_lab_control.security_rate_limit_windows
  for insert to amniora_web_lab_control with check (true);
drop policy if exists amniora_control_rate_windows_update
  on web_lab_control.security_rate_limit_windows;
create policy amniora_control_rate_windows_update
  on web_lab_control.security_rate_limit_windows
  for update to amniora_web_lab_control using (true) with check (true);

drop policy if exists amniora_control_rate_requests_select
  on web_lab_control.security_rate_limit_requests;
create policy amniora_control_rate_requests_select
  on web_lab_control.security_rate_limit_requests
  for select to amniora_web_lab_control using (true);
drop policy if exists amniora_control_rate_requests_insert
  on web_lab_control.security_rate_limit_requests;
create policy amniora_control_rate_requests_insert
  on web_lab_control.security_rate_limit_requests
  for insert to amniora_web_lab_control with check (true);
drop policy if exists amniora_control_rate_requests_update
  on web_lab_control.security_rate_limit_requests;
create policy amniora_control_rate_requests_update
  on web_lab_control.security_rate_limit_requests
  for update to amniora_web_lab_control using (true) with check (true);

comment on role amniora_web_lab_control is
  'Least-privileged direct Postgres identity for completed Phase 9 shared controls.';
