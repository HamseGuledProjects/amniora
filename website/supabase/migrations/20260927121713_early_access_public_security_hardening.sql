-- Early Access B1/B2: narrow existing public access and fail closed for future
-- application-owned objects. This migration intentionally does not alter
-- function bodies, protected rows, or Supabase-managed role defaults.

revoke all on table public.labs from anon, authenticated, service_role;
grant select, delete on table public.labs to authenticated;
grant update (completed) on table public.labs to authenticated;
grant select, insert, update on table public.labs to service_role;

revoke all on table public.lab_generation_jobs from anon, authenticated, service_role;
grant select on table public.lab_generation_jobs to authenticated;
grant select, insert, update on table public.lab_generation_jobs to service_role;

revoke all on table public.ai_usage from anon, authenticated, service_role;
grant select, insert, update on table public.ai_usage to service_role;

revoke all on table public.ai_usage_events from anon, authenticated, service_role;
grant select, insert on table public.ai_usage_events to service_role;

revoke all on table public.ai_usage_reservations from anon, authenticated, service_role;
grant select, insert, update on table public.ai_usage_reservations to service_role;

alter policy "Users can view own labs"
  on public.labs
  to authenticated
  using ((select auth.uid()) = user_id);

alter policy "Users can update own labs"
  on public.labs
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter policy "Users can delete own labs"
  on public.labs
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own labs" on public.labs;

alter policy "Users can read their own lab generation jobs"
  on public.lab_generation_jobs
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own AI usage" on public.ai_usage;
drop policy if exists "Users can create their own AI usage" on public.ai_usage;
drop policy if exists "Users can update their own AI usage" on public.ai_usage;
drop policy if exists "Users can delete their own AI usage" on public.ai_usage;

drop policy if exists "Users can view their own AI usage events" on public.ai_usage_events;
drop policy if exists "Users can create their own AI usage events" on public.ai_usage_events;
drop policy if exists "Users can update their own AI usage events" on public.ai_usage_events;
drop policy if exists "Users can delete their own AI usage events" on public.ai_usage_events;

alter function public.award_xp_from_roadmap_completion() set search_path = '';
alter function public.check_and_unlock_achievements(uuid) set search_path = '';
alter function public.create_default_roadmap_progress() set search_path = '';
alter function public.finalize_ai_usage_reservation(uuid, integer, integer, numeric) set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.increment_labs_generated(uuid) set search_path = '';
alter function public.release_ai_usage_reservation(uuid) set search_path = '';
alter function public.reserve_ai_usage(uuid, uuid, text, integer, text) set search_path = '';
alter function public.reset_my_roadmap() set search_path = '';
alter function public.run_achievement_check() set search_path = '';
alter function public.sync_profile_lab_stats() set search_path = '';
alter function public.sync_roadmap_from_completed_lab() set search_path = '';

revoke all on function public.award_xp_from_roadmap_completion()
  from public, anon, authenticated, service_role;
revoke all on function public.check_and_unlock_achievements(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_default_roadmap_progress()
  from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user()
  from public, anon, authenticated, service_role;
revoke all on function public.increment_labs_generated(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.run_achievement_check()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_profile_lab_stats()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_roadmap_from_completed_lab()
  from public, anon, authenticated, service_role;

revoke all on function public.reset_my_roadmap()
  from public, anon, authenticated, service_role;
grant execute on function public.reset_my_roadmap() to authenticated;

revoke all on function public.reserve_ai_usage(uuid, uuid, text, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_ai_usage_reservation(uuid, integer, integer, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.release_ai_usage_reservation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_ai_usage(uuid, uuid, text, integer, text)
  to service_role;
grant execute on function public.finalize_ai_usage_reservation(uuid, integer, integer, numeric)
  to service_role;
grant execute on function public.release_ai_usage_reservation(uuid)
  to service_role;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- Platform-managed supabase_admin defaults are deliberately left to the
-- documented manual catalog verification step.
