-- ============================================================================
-- STAGING TEST HARNESS ONLY : NEVER APPLY TO PRODUCTION
-- Target: Amniora Staging (project ref portfoliofixtureaaaa)
--
-- This file creates only the pre-Patch-1B dependencies required to validate
-- atomic AI quota reservations. It must be executed only after the CLI link has
-- been independently verified as the staging project.
-- ============================================================================

do $staging_guard$
begin
  if exists (select 1 from auth.users) then
    raise exception 'Staging guard failed: auth.users is not empty';
  end if;

  if to_regclass('public.profiles') is not null
    or to_regclass('public.ai_usage') is not null
    or to_regclass('public.ai_usage_reservations') is not null then
    raise exception 'Staging guard failed: Patch 1B harness objects already exist';
  end if;
end;
$staging_guard$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free', 'pro'))
);

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
    tutor_prompts_used >= 0
    and lab_generations_used >= 0
    and total_tokens >= 0
    and estimated_cost >= 0
  ),
  constraint ai_usage_user_week_harness_unique unique (user_id, week_start)
);
