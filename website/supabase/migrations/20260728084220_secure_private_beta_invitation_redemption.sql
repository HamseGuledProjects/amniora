-- Infrastructure prerequisites:
--   - pgcrypto, installed in the extensions schema
--   - supabase_vault, exposing vault.decrypted_secrets
-- These extensions must be enabled in the target Supabase project before this
-- application migration is applied. Application migrations do not provision
-- database extensions.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'pgcrypto'
  ) then
    raise exception
      using
        errcode = '55000',
        message = 'Required PostgreSQL extension "pgcrypto" is not installed.',
        hint = 'Enable pgcrypto in the target Supabase project before applying this migration.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_extension
    where extname = 'supabase_vault'
  ) then
    raise exception
      using
        errcode = '55000',
        message = 'Required PostgreSQL extension "supabase_vault" is not installed.',
        hint = 'Enable Supabase Vault in the target project before applying this migration.';
  end if;

  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception
      using
        errcode = '55000',
        message = 'Required pgcrypto function "extensions.digest(bytea,text)" is unavailable.',
        hint = 'Verify that pgcrypto is enabled in the extensions schema before applying this migration.';
  end if;

  if pg_catalog.to_regclass('vault.decrypted_secrets') is null then
    raise exception
      using
        errcode = '55000',
        message = 'Required Supabase Vault view "vault.decrypted_secrets" is unavailable.',
        hint = 'Verify that Supabase Vault is enabled before applying this migration.';
  end if;
end;
$$;

alter table public.beta_access_redemptions
  add constraint beta_access_redemptions_user_code_version_key
  unique (user_id, code_version);

create table public.beta_access_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp(),
  outcome text not null check (outcome = 'invalid_code'),
  primary key (user_id, attempted_at)
);

alter table public.beta_access_attempts enable row level security;

revoke all on table public.beta_access_attempts
  from public, anon, authenticated;
grant all on table public.beta_access_attempts
  to service_role;

create or replace function public.set_user_access_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

alter function public.set_user_access_updated_at() owner to postgres;
revoke all on function public.set_user_access_updated_at()
  from public, anon, authenticated, service_role;

create trigger set_user_access_updated_at
  before update on public.user_access
  for each row
  execute function public.set_user_access_updated_at();

create or replace function public.redeem_beta_access(
  p_invitation_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_code_version constant text := 'private-beta-v1';
  v_secret_name constant text := 'amniora_private_beta_v1_digest';
  v_attempt_limit constant integer := 5;
  v_attempt_window constant interval := interval '15 minutes';
  v_code text;
  v_expected_digest text;
  v_candidate_digest text;
  v_digest_difference integer := 0;
  v_failed_attempts integer := 0;
  v_oldest_attempt timestamptz;
  v_now timestamptz;
  v_retry_after_seconds integer;
  v_is_admin boolean := false;
  v_already_redeemed boolean := false;
  v_existing_granted boolean := false;
  v_existing_version text;
  v_character_index integer;
begin
  if v_user_id is null then
    raise insufficient_privilege
      using message = 'Authentication is required.';
  end if;

  select exists (
    select 1
    from public.profiles
    where id = v_user_id
      and role = 'admin'
  )
  into v_is_admin;

  if v_is_admin then
    return jsonb_build_object(
      'success', true,
      'status', 'admin_bypass'
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('beta-access-redemption:' || v_user_id::text, 0)
  );
  v_now := clock_timestamp();

  select
    coalesce(ua.beta_access_granted, false),
    ua.beta_access_version
  into
    v_existing_granted,
    v_existing_version
  from public.user_access as ua
  where ua.user_id = v_user_id;

  select exists (
    select 1
    from public.beta_access_redemptions as bar
    where bar.user_id = v_user_id
      and bar.code_version = v_code_version
  )
  into v_already_redeemed;

  if v_existing_granted
    and v_existing_version = v_code_version
    and v_already_redeemed then
    return jsonb_build_object(
      'success', true,
      'status', 'already_redeemed',
      'beta_access_version', v_code_version
    );
  end if;

  select
    count(*)::integer,
    min(baa.attempted_at)
  into
    v_failed_attempts,
    v_oldest_attempt
  from public.beta_access_attempts as baa
  where baa.user_id = v_user_id
    and baa.outcome = 'invalid_code'
    and baa.attempted_at > v_now - v_attempt_window;

  if v_failed_attempts >= v_attempt_limit then
    v_retry_after_seconds := greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_oldest_attempt + v_attempt_window - v_now
          )
        )
      )::integer
    );

    return jsonb_build_object(
      'success', false,
      'status', 'rate_limited',
      'retry_after_seconds', v_retry_after_seconds
    );
  end if;

  v_code := btrim(p_invitation_code);

  if v_code is null
    or v_code = ''
    or length(v_code) > 256 then
    insert into public.beta_access_attempts (
      user_id,
      attempted_at,
      outcome
    )
    values (
      v_user_id,
      v_now,
      'invalid_code'
    );

    return jsonb_build_object(
      'success', false,
      'status', 'invalid_code'
    );
  end if;

  select lower(vds.decrypted_secret)
  into v_expected_digest
  from vault.decrypted_secrets as vds
  where vds.name = v_secret_name;

  if v_expected_digest is null
    or v_expected_digest !~ '^[0-9a-f]{64}$' then
    raise exception
      using
        errcode = 'P0001',
        message = 'Beta access redemption is unavailable.';
  end if;

  v_candidate_digest := encode(
    extensions.digest(
      convert_to(v_code || chr(31) || v_code_version, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  for v_character_index in 1..64 loop
    v_digest_difference := v_digest_difference
      | (
        ascii(substr(v_candidate_digest, v_character_index, 1))
        # ascii(substr(v_expected_digest, v_character_index, 1))
      );
  end loop;

  if v_digest_difference <> 0 then
    insert into public.beta_access_attempts (
      user_id,
      attempted_at,
      outcome
    )
    values (
      v_user_id,
      v_now,
      'invalid_code'
    );

    return jsonb_build_object(
      'success', false,
      'status', 'invalid_code'
    );
  end if;

  insert into public.user_access (
    user_id,
    beta_access_granted,
    beta_access_granted_at,
    beta_access_version,
    granted_by,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    true,
    v_now,
    v_code_version,
    null,
    v_now,
    v_now
  )
  on conflict (user_id) do update
  set
    beta_access_granted = true,
    beta_access_granted_at = coalesce(
      public.user_access.beta_access_granted_at,
      excluded.beta_access_granted_at
    ),
    beta_access_version = excluded.beta_access_version,
    granted_by = public.user_access.granted_by,
    updated_at = excluded.updated_at;

  insert into public.beta_access_redemptions (
    user_id,
    redeemed_at,
    code_version
  )
  values (
    v_user_id,
    v_now,
    v_code_version
  )
  on conflict (user_id, code_version) do nothing;

  return jsonb_build_object(
    'success', true,
    'status', 'redeemed',
    'beta_access_version', v_code_version
  );
end;
$$;

alter function public.redeem_beta_access(text) owner to postgres;

revoke all on function public.redeem_beta_access(text)
  from public, anon, authenticated, service_role;
grant execute on function public.redeem_beta_access(text)
  to authenticated;

comment on table public.beta_access_attempts is
  'Protected failed-attempt records for private beta redemption rate limiting.';
comment on function public.redeem_beta_access(text) is
  'Redeems the current private beta invitation for the authenticated user using a digest stored in Supabase Vault.';
