create table public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  beta_access_granted boolean not null default false,
  beta_access_granted_at timestamptz null,
  beta_access_version text null,
  granted_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.beta_access_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  code_version text not null,
  ip_hash text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index beta_access_redemptions_user_id_idx
  on public.beta_access_redemptions (user_id);

create index beta_access_redemptions_redeemed_at_idx
  on public.beta_access_redemptions (redeemed_at);

create index user_access_beta_access_granted_idx
  on public.user_access (beta_access_granted)
  where beta_access_granted = true;

alter table public.user_access enable row level security;
alter table public.beta_access_redemptions enable row level security;

revoke all on table public.user_access
  from public, anon, authenticated;
revoke all on table public.beta_access_redemptions
  from public, anon, authenticated;

grant select on table public.user_access to authenticated;
grant all on table public.user_access to service_role;
grant all on table public.beta_access_redemptions to service_role;

create policy "Users may read their own beta access"
  on public.user_access
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.redeem_beta_access(
  p_invitation_code text
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'success', false,
    'status', 'not_implemented'
  );
$$;

revoke all on function public.redeem_beta_access(text)
  from public, anon, authenticated;
grant execute on function public.redeem_beta_access(text)
  to service_role;

comment on table public.user_access is
  'Private beta access state, kept separate from user profile data.';
comment on table public.beta_access_redemptions is
  'Audit records for successful private beta invitation redemptions.';
comment on column public.beta_access_redemptions.ip_hash is
  'Optional one-way hash of the redemption IP address; never store the plaintext address.';
comment on function public.redeem_beta_access(text) is
  'Placeholder for a future private beta redemption flow; performs no validation or data changes.';
