alter table public.ai_usage
  add column if not exists linux_gradings_used integer not null default 0;

alter table public.ai_usage
  drop constraint if exists ai_usage_nonnegative_counts;

alter table public.ai_usage
  add constraint ai_usage_nonnegative_counts
  check (
    tutor_prompts_used >= 0
    and lab_generations_used >= 0
    and linux_gradings_used >= 0
    and total_tokens >= 0
    and estimated_cost >= 0
  );

alter table public.ai_usage_reservations
  drop constraint if exists ai_usage_reservations_feature_type_check;

alter table public.ai_usage_reservations
  add constraint ai_usage_reservations_feature_type_check
  check (feature_type in ('tutor_prompt', 'lab_generation', 'linux_grading'));

alter table if exists public.ai_usage_events
  drop constraint if exists ai_usage_events_feature_type_check;

alter table if exists public.ai_usage_events
  add constraint ai_usage_events_feature_type_check
  check (feature_type in ('tutor_prompt', 'lab_generation', 'linux_grading'));

alter table public.ai_content_consents
  drop constraint if exists ai_content_consents_feature_type_check;

alter table public.ai_content_consents
  add constraint ai_content_consents_feature_type_check
  check (feature_type in ('lab_generation', 'linux_grading', 'tutor_chat'));

alter table public.ai_content_consent_tokens
  drop constraint if exists ai_content_consent_tokens_feature_type_check;

alter table public.ai_content_consent_tokens
  add constraint ai_content_consent_tokens_feature_type_check
  check (feature_type in ('lab_generation', 'linux_grading', 'tutor_chat'));

create or replace function public.reserve_ai_usage(
  p_reservation_id uuid,
  p_user_id uuid,
  p_feature text,
  p_limit integer,
  p_plan_snapshot text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_week_start date := date_trunc('week', timezone('UTC', now()))::date;
  v_tutor_used integer;
  v_lab_used integer;
  v_linux_grading_used integer;
begin
  if p_feature not in ('tutor_prompt', 'lab_generation', 'linux_grading')
    or p_limit < 1
    or p_plan_snapshot not in ('free', 'pro') then
    raise exception 'Invalid AI usage reservation parameters';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || v_week_start::text, 0)
  );

  insert into public.ai_usage (
    user_id,
    week_start,
    tutor_prompts_used,
    lab_generations_used,
    linux_gradings_used,
    total_tokens,
    estimated_cost,
    plan_snapshot
  )
  values (p_user_id, v_week_start, 0, 0, 0, 0, 0, p_plan_snapshot)
  on conflict (user_id, week_start) do nothing;

  if p_feature = 'tutor_prompt' then
    update public.ai_usage
    set tutor_prompts_used = tutor_prompts_used + 1,
        plan_snapshot = p_plan_snapshot,
        updated_at = now()
    where user_id = p_user_id
      and week_start = v_week_start
      and tutor_prompts_used < p_limit
    returning tutor_prompts_used, lab_generations_used, linux_gradings_used
      into v_tutor_used, v_lab_used, v_linux_grading_used;
  elsif p_feature = 'lab_generation' then
    update public.ai_usage
    set lab_generations_used = lab_generations_used + 1,
        plan_snapshot = p_plan_snapshot,
        updated_at = now()
    where user_id = p_user_id
      and week_start = v_week_start
      and lab_generations_used < p_limit
    returning tutor_prompts_used, lab_generations_used, linux_gradings_used
      into v_tutor_used, v_lab_used, v_linux_grading_used;
  else
    update public.ai_usage
    set linux_gradings_used = linux_gradings_used + 1,
        plan_snapshot = p_plan_snapshot,
        updated_at = now()
    where user_id = p_user_id
      and week_start = v_week_start
      and linux_gradings_used < p_limit
    returning tutor_prompts_used, lab_generations_used, linux_gradings_used
      into v_tutor_used, v_lab_used, v_linux_grading_used;
  end if;

  if not found then
    select tutor_prompts_used, lab_generations_used, linux_gradings_used
      into v_tutor_used, v_lab_used, v_linux_grading_used
    from public.ai_usage
    where user_id = p_user_id and week_start = v_week_start;

    return jsonb_build_object(
      'allowed', false,
      'tutorPromptsUsed', coalesce(v_tutor_used, 0),
      'labGenerationsUsed', coalesce(v_lab_used, 0),
      'linuxGradingsUsed', coalesce(v_linux_grading_used, 0)
    );
  end if;

  insert into public.ai_usage_reservations (
    id, user_id, week_start, feature_type, plan_snapshot
  )
  values (
    p_reservation_id, p_user_id, v_week_start, p_feature, p_plan_snapshot
  );

  return jsonb_build_object(
    'allowed', true,
    'reservationId', p_reservation_id,
    'tutorPromptsUsed', v_tutor_used,
    'labGenerationsUsed', v_lab_used,
    'linuxGradingsUsed', v_linux_grading_used
  );
end;
$$;

create or replace function public.release_ai_usage_reservation(
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reservation public.ai_usage_reservations%rowtype;
begin
  select * into v_reservation
  from public.ai_usage_reservations
  where id = p_reservation_id
  for update;

  if not found or v_reservation.status <> 'reserved' then
    return false;
  end if;

  if v_reservation.feature_type = 'tutor_prompt' then
    update public.ai_usage
    set tutor_prompts_used = greatest(tutor_prompts_used - 1, 0),
        updated_at = now()
    where user_id = v_reservation.user_id
      and week_start = v_reservation.week_start;
  elsif v_reservation.feature_type = 'lab_generation' then
    update public.ai_usage
    set lab_generations_used = greatest(lab_generations_used - 1, 0),
        updated_at = now()
    where user_id = v_reservation.user_id
      and week_start = v_reservation.week_start;
  else
    update public.ai_usage
    set linux_gradings_used = greatest(linux_gradings_used - 1, 0),
        updated_at = now()
    where user_id = v_reservation.user_id
      and week_start = v_reservation.week_start;
  end if;

  update public.ai_usage_reservations
  set status = 'released', released_at = now()
  where id = p_reservation_id;

  return true;
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.release_ai_usage_reservation(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_usage(uuid, uuid, text, integer, text)
  to service_role;
grant execute on function public.release_ai_usage_reservation(uuid)
  to service_role;
