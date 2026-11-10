create unique index if not exists ai_usage_user_week_unique
  on public.ai_usage(user_id, week_start);

create table if not exists public.ai_usage_reservations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  feature_type text not null check (feature_type in ('tutor_prompt', 'lab_generation')),
  plan_snapshot text not null check (plan_snapshot in ('free', 'pro')),
  status text not null default 'reserved'
    check (status in ('reserved', 'finalized', 'released')),
  created_at timestamptz not null default now(),
  finalized_at timestamptz null,
  released_at timestamptz null
);

create index if not exists ai_usage_reservations_user_week_idx
  on public.ai_usage_reservations(user_id, week_start);

alter table public.ai_usage_reservations enable row level security;

revoke all on table public.ai_usage_reservations from public, anon, authenticated;
grant all on table public.ai_usage_reservations to service_role;

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
begin
  if p_feature not in ('tutor_prompt', 'lab_generation')
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
    total_tokens,
    estimated_cost,
    plan_snapshot
  )
  values (p_user_id, v_week_start, 0, 0, 0, 0, p_plan_snapshot)
  on conflict (user_id, week_start) do nothing;

  if p_feature = 'tutor_prompt' then
    update public.ai_usage
    set tutor_prompts_used = tutor_prompts_used + 1,
        plan_snapshot = p_plan_snapshot,
        updated_at = now()
    where user_id = p_user_id
      and week_start = v_week_start
      and tutor_prompts_used < p_limit
    returning tutor_prompts_used, lab_generations_used
      into v_tutor_used, v_lab_used;
  else
    update public.ai_usage
    set lab_generations_used = lab_generations_used + 1,
        plan_snapshot = p_plan_snapshot,
        updated_at = now()
    where user_id = p_user_id
      and week_start = v_week_start
      and lab_generations_used < p_limit
    returning tutor_prompts_used, lab_generations_used
      into v_tutor_used, v_lab_used;
  end if;

  if not found then
    select tutor_prompts_used, lab_generations_used
      into v_tutor_used, v_lab_used
    from public.ai_usage
    where user_id = p_user_id and week_start = v_week_start;

    return jsonb_build_object(
      'allowed', false,
      'tutorPromptsUsed', coalesce(v_tutor_used, 0),
      'labGenerationsUsed', coalesce(v_lab_used, 0)
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
    'labGenerationsUsed', v_lab_used
  );
end;
$$;

create or replace function public.finalize_ai_usage_reservation(
  p_reservation_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_estimated_cost numeric
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

  update public.ai_usage
  set total_tokens = total_tokens
        + greatest(coalesce(p_input_tokens, 0), 0)
        + greatest(coalesce(p_output_tokens, 0), 0),
      estimated_cost = estimated_cost + greatest(coalesce(p_estimated_cost, 0), 0),
      updated_at = now()
  where user_id = v_reservation.user_id
    and week_start = v_reservation.week_start;

  update public.ai_usage_reservations
  set status = 'finalized', finalized_at = now()
  where id = p_reservation_id;

  return true;
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
  else
    update public.ai_usage
    set lab_generations_used = greatest(lab_generations_used - 1, 0),
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
revoke all on function public.finalize_ai_usage_reservation(uuid, integer, integer, numeric)
  from public, anon, authenticated;
revoke all on function public.release_ai_usage_reservation(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_ai_usage(uuid, uuid, text, integer, text)
  to service_role;
grant execute on function public.finalize_ai_usage_reservation(uuid, integer, integer, numeric)
  to service_role;
grant execute on function public.release_ai_usage_reservation(uuid)
  to service_role;
