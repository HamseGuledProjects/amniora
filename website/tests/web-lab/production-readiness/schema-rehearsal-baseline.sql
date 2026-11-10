-- TEST-ONLY BASELINE FIXTURE : NEVER APPLY TO PRODUCTION.
--
-- The repository does not version the original DDL for auth.users,
-- public.labs, public.ai_usage, or public.ai_usage_events. This fixture exists
-- only to make the Phase 1 disposable PostgreSQL rehearsal reproducible. It
-- models columns and constraints proven by repository source, migrations, and
-- existing test fixtures. It is not production migration history.

create extension if not exists pgcrypto;

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$roles$;

create schema auth;

create function auth.uid()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase owns the authoritative auth.users definition. Only the UUID key
-- required by repository foreign keys is represented here.
create table auth.users (
  id uuid primary key
);

-- Minimal prerequisite keys for the authoritative AI-consent migration.
-- Their real production definitions are not versioned in this repository.
create table public.ai_conversations (
  id uuid primary key
);

create table public.generated_labs (
  id uuid primary key
);

-- Repository-proven Saved Lab contract. The JSONB list columns are an explicit
-- approved production fact; they must never be changed to PostgreSQL text[].
create table public.labs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Fixture lab',
  topic text not null,
  difficulty text not null default 'Beginner',
  estimated_time text not null default '30 mins',
  objective text not null default '',
  scenario text not null default '',
  tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array'),
  hints jsonb not null default '[]'::jsonb check (jsonb_typeof(hints) = 'array'),
  outcomes jsonb not null default '[]'::jsonb check (jsonb_typeof(outcomes) = 'array'),
  completed boolean not null default false
);

alter table public.labs enable row level security;
revoke all on public.labs from public, anon, authenticated;
grant select, insert, update, delete on public.labs to authenticated;
grant all on public.labs to service_role;

create policy labs_owner_select on public.labs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy labs_owner_insert on public.labs for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy labs_owner_update on public.labs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy labs_owner_delete on public.labs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Proven by the atomic reservation migration and usageService.ts. The later
-- authoritative Linux-grading migration adds linux_gradings_used.
create table public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  tutor_prompts_used integer not null default 0,
  lab_generations_used integer not null default 0,
  total_tokens integer not null default 0,
  estimated_cost numeric not null default 0,
  plan_snapshot text not null default 'free'
    check (plan_snapshot in ('free', 'pro')),
  updated_at timestamptz not null default now(),
  constraint ai_usage_nonnegative_counts check (
    tutor_prompts_used >= 0 and lab_generations_used >= 0 and
    total_tokens >= 0 and estimated_cost >= 0
  )
);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;
grant all on public.ai_usage to service_role;

-- Proven insert/read columns only. The original event primary-key/default and
-- historical foreign-key choices still require authoritative catalog capture.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid null,
  message_id uuid null,
  generated_lab_id uuid null,
  feature_type text not null,
  model_used text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  estimated_cost numeric not null default 0 check (estimated_cost >= 0),
  plan_snapshot text not null check (plan_snapshot in ('free', 'pro')),
  created_at timestamptz not null default now(),
  constraint ai_usage_events_feature_type_check
    check (feature_type in ('tutor_prompt', 'lab_generation'))
);

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public, anon, authenticated;
grant all on public.ai_usage_events to service_role;

revoke all on public.ai_conversations, public.generated_labs from public, anon, authenticated;
grant all on public.ai_conversations, public.generated_labs to service_role;
