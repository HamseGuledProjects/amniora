-- Patch 2.7: production private-beta management.
-- Prerequisite: pgcrypto must already be installed in the extensions schema.

-- Bootstrap the established authorization role model before any Patch 2.7
-- object reads public.profiles.role. Existing valid roles are preserved;
-- unexpected non-null values abort the migration for manual inspection.
alter table public.profiles
  add column if not exists role text;

do $$
declare
  v_invalid_role_count bigint;
begin
  select count(*)
  into v_invalid_role_count
  from public.profiles
  where role is not null
    and role not in ('user', 'admin');

  if v_invalid_role_count > 0 then
    raise exception
      using
        errcode = '23514',
        message = 'Cannot bootstrap public.profiles.role because unexpected role values exist.',
        detail = format(
          'Found %s profile row(s) whose non-null role is neither "user" nor "admin".',
          v_invalid_role_count
        ),
        hint = 'Inspect and correct the invalid role values before rerunning this migration.';
  end if;
end;
$$;

update public.profiles
set role = 'user'
where role is null;

alter table public.profiles
  alter column role set default 'user';

alter table public.profiles
  alter column role set not null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('user', 'admin'));
  end if;
end;
$$;

do $$
begin
  if pg_catalog.to_regprocedure('extensions.digest(bytea,text)') is null
    or pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception
      using
        errcode = '55000',
        message = 'Required pgcrypto functions are unavailable.',
        hint = 'Enable pgcrypto in the extensions schema before applying this migration.';
  end if;
end;
$$;

create table public.app_settings (
  id boolean primary key default true check (id),
  private_beta_enabled boolean not null default true,
  updated_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, private_beta_enabled)
values (true, true);

create table public.beta_invitation_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 1 and 80),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  max_redemptions integer null check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  expires_at timestamptz null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.beta_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid null references public.beta_invitation_codes(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  ip inet null,
  user_agent text null
);

create table public.beta_management_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid null references auth.users(id) on delete set null,
  action text not null check (
    action in (
      'code_created',
      'code_deleted',
      'code_enabled',
      'code_disabled',
      'code_regenerated',
      'global_enabled',
      'global_disabled',
      'bulk_access_revoked',
      'user_redeemed'
    )
  ),
  code_id uuid null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index beta_invitation_codes_enabled_idx
  on public.beta_invitation_codes (enabled, created_at desc);
create index beta_invitation_codes_expires_at_idx
  on public.beta_invitation_codes (expires_at)
  where expires_at is not null;
create index beta_redemptions_code_id_redeemed_at_idx
  on public.beta_redemptions (code_id, redeemed_at desc);
create index beta_redemptions_user_id_idx
  on public.beta_redemptions (user_id);
create index beta_redemptions_redeemed_at_idx
  on public.beta_redemptions (redeemed_at desc);
create index beta_management_audit_created_at_idx
  on public.beta_management_audit_log (created_at desc);

alter table public.app_settings enable row level security;
alter table public.beta_invitation_codes enable row level security;
alter table public.beta_redemptions enable row level security;
alter table public.beta_management_audit_log enable row level security;

revoke all on table public.app_settings,
  public.beta_invitation_codes,
  public.beta_redemptions,
  public.beta_management_audit_log
  from public, anon, authenticated;

grant select on table public.app_settings to authenticated;
grant all on table public.app_settings,
  public.beta_invitation_codes,
  public.beta_redemptions,
  public.beta_management_audit_log
  to service_role;

create policy "Authenticated users may read beta availability"
  on public.app_settings
  for select
  to authenticated
  using (id);

create or replace function public.set_beta_management_updated_at()
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

create trigger set_app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_beta_management_updated_at();
create trigger set_beta_invitation_codes_updated_at
  before update on public.beta_invitation_codes
  for each row execute function public.set_beta_management_updated_at();

create or replace function public.private_beta_is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = p_user_id and role = 'admin'
  );
$$;

create or replace function public.private_beta_constant_time_equal(
  p_left text,
  p_right text
)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  v_difference integer := length(p_left) # length(p_right);
  v_index integer;
begin
  for v_index in 1..64 loop
    v_difference := v_difference | (
      ascii(coalesce(nullif(substr(p_left, v_index, 1), ''), ' '))
      # ascii(coalesce(nullif(substr(p_right, v_index, 1), ''), ' '))
    );
  end loop;
  return v_difference = 0;
end;
$$;

create or replace function public.private_beta_generate_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_compact text := '';
  v_index integer;
begin
  for v_index in 1..12 loop
    v_compact := v_compact || substr(
      v_alphabet,
      1 + (
        get_byte(extensions.gen_random_bytes(1), 0)
        % length(v_alphabet)
      ),
      1
    );
  end loop;
  return 'AMNIORA-' || substr(v_compact, 1, 4) || '-'
    || substr(v_compact, 5, 4) || '-' || substr(v_compact, 9, 4);
end;
$$;

create or replace function public.admin_create_beta_invitation_code(
  p_label text,
  p_max_redemptions integer default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_code text;
  v_code_id uuid;
begin
  if v_actor is null or not public.private_beta_is_admin(v_actor) then
    raise insufficient_privilege using message = 'Admin authorization required.';
  end if;
  if p_label is null
    or length(btrim(p_label)) not between 1 and 80
    or (p_max_redemptions is not null and p_max_redemptions <= 0)
    or (p_expires_at is not null and p_expires_at <= now()) then
    raise invalid_parameter_value using message = 'Invalid invitation configuration.';
  end if;

  v_code := public.private_beta_generate_code();
  insert into public.beta_invitation_codes (
    label, code_hash, max_redemptions, expires_at, created_by
  ) values (
    btrim(p_label),
    encode(extensions.digest(convert_to(v_code, 'UTF8'), 'sha256'), 'hex'),
    p_max_redemptions,
    p_expires_at,
    v_actor
  ) returning id into v_code_id;

  insert into public.beta_management_audit_log (actor_id, action, code_id, details)
  values (v_actor, 'code_created', v_code_id, jsonb_build_object('label', btrim(p_label)));

  return jsonb_build_object('id', v_code_id, 'code', v_code);
end;
$$;

create or replace function public.admin_set_private_beta_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.private_beta_is_admin(v_actor) then
    raise insufficient_privilege using message = 'Admin authorization required.';
  end if;
  update public.app_settings
  set private_beta_enabled = p_enabled, updated_by = v_actor
  where id = true;
  if not found then
    raise exception using message = 'Private beta settings are unavailable.';
  end if;
  insert into public.beta_management_audit_log (actor_id, action)
  values (v_actor, case when p_enabled then 'global_enabled' else 'global_disabled' end);
  return p_enabled;
end;
$$;

create or replace function public.admin_set_beta_code_enabled(
  p_code_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
begin
  if v_actor is null or not public.private_beta_is_admin(v_actor) then
    raise insufficient_privilege using message = 'Admin authorization required.';
  end if;
  update public.beta_invitation_codes
  set enabled = p_enabled
  where id = p_code_id
  returning label into v_label;
  if not found then raise no_data_found using message = 'Invitation code not found.'; end if;
  insert into public.beta_management_audit_log (actor_id, action, code_id, details)
  values (
    v_actor,
    case when p_enabled then 'code_enabled' else 'code_disabled' end,
    p_code_id,
    jsonb_build_object('label', v_label)
  );
  return p_enabled;
end;
$$;

create or replace function public.admin_delete_beta_code(p_code_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
begin
  if v_actor is null or not public.private_beta_is_admin(v_actor) then
    raise insufficient_privilege using message = 'Admin authorization required.';
  end if;
  select label into v_label from public.beta_invitation_codes where id = p_code_id for update;
  if not found then raise no_data_found using message = 'Invitation code not found.'; end if;
  insert into public.beta_management_audit_log (actor_id, action, code_id, details)
  values (v_actor, 'code_deleted', p_code_id, jsonb_build_object('label', v_label));
  delete from public.beta_invitation_codes where id = p_code_id;
  return true;
end;
$$;

create or replace function public.admin_regenerate_beta_code(p_code_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.beta_invitation_codes%rowtype;
  v_code text;
  v_new_id uuid;
begin
  if v_actor is null or not public.private_beta_is_admin(v_actor) then
    raise insufficient_privilege using message = 'Admin authorization required.';
  end if;
  select * into v_old from public.beta_invitation_codes where id = p_code_id for update;
  if not found then raise no_data_found using message = 'Invitation code not found.'; end if;

  update public.beta_invitation_codes set enabled = false where id = p_code_id;
  v_code := public.private_beta_generate_code();
  insert into public.beta_invitation_codes (
    label, code_hash, enabled, max_redemptions, expires_at, created_by
  ) values (
    v_old.label,
    encode(extensions.digest(convert_to(v_code, 'UTF8'), 'sha256'), 'hex'),
    true,
    v_old.max_redemptions,
    v_old.expires_at,
    v_actor
  ) returning id into v_new_id;

  insert into public.beta_management_audit_log (actor_id, action, code_id, details)
  values (
    v_actor,
    'code_regenerated',
    v_new_id,
    jsonb_build_object('replaces_code_id', p_code_id, 'label', v_old.label)
  );
  return jsonb_build_object('id', v_new_id, 'code', v_code);
end;
$$;

create or replace function public.admin_revoke_all_beta_access()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_count bigint;
begin
  if v_actor is null or not public.private_beta_is_admin(v_actor) then
    raise insufficient_privilege using message = 'Admin authorization required.';
  end if;
  update public.user_access
  set beta_access_granted = false, updated_at = statement_timestamp()
  where beta_access_granted = true;
  get diagnostics v_count = row_count;
  insert into public.beta_management_audit_log (actor_id, action, details)
  values (v_actor, 'bulk_access_revoked', jsonb_build_object('revoked_count', v_count));
  return v_count;
end;
$$;

create or replace function public.redeem_beta_access(p_invitation_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_candidate_hash text;
  v_code public.beta_invitation_codes%rowtype;
  v_failed_attempts integer;
  v_oldest_attempt timestamptz;
  v_headers jsonb := '{}'::jsonb;
  v_ip inet;
  v_user_agent text;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'Authentication is required.';
  end if;
  if public.private_beta_is_admin(v_user_id) then
    return jsonb_build_object('success', true, 'status', 'admin_bypass');
  end if;
  if not coalesce(
    (select private_beta_enabled from public.app_settings where id = true),
    false
  ) then
    return jsonb_build_object('success', false, 'status', 'beta_disabled');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('beta-redemption:' || v_user_id::text, 0));

  select count(*)::integer, min(attempted_at)
  into v_failed_attempts, v_oldest_attempt
  from public.beta_access_attempts
  where user_id = v_user_id
    and outcome = 'invalid_code'
    and attempted_at > v_now - interval '15 minutes';

  if v_failed_attempts >= 5 then
    return jsonb_build_object(
      'success', false,
      'status', 'rate_limited',
      'retry_after_seconds', greatest(
        1,
        ceil(extract(epoch from (v_oldest_attempt + interval '15 minutes' - v_now)))::integer
      )
    );
  end if;

  if p_invitation_code is null
    or length(btrim(p_invitation_code)) not between 1 and 128 then
    insert into public.beta_access_attempts (user_id, attempted_at, outcome)
    values (v_user_id, v_now, 'invalid_code');
    return jsonb_build_object('success', false, 'status', 'invalid_code');
  end if;

  v_candidate_hash := encode(
    extensions.digest(convert_to(upper(btrim(p_invitation_code)), 'UTF8'), 'sha256'),
    'hex'
  );

  select bic.* into v_code
  from public.beta_invitation_codes as bic
  where public.private_beta_constant_time_equal(bic.code_hash, v_candidate_hash)
  order by bic.created_at desc
  limit 1
  for update;

  if not found
    or not v_code.enabled
    or (v_code.expires_at is not null and v_code.expires_at <= v_now)
    or (
      v_code.max_redemptions is not null
      and v_code.redemption_count >= v_code.max_redemptions
    ) then
    insert into public.beta_access_attempts (user_id, attempted_at, outcome)
    values (v_user_id, v_now, 'invalid_code');
    return jsonb_build_object('success', false, 'status', 'invalid_code');
  end if;

  insert into public.user_access (
    user_id,
    beta_access_granted,
    beta_access_granted_at,
    beta_access_version,
    granted_by,
    created_at,
    updated_at
  ) values (
    v_user_id, true, v_now, v_code.id::text, v_code.created_by, v_now, v_now
  )
  on conflict (user_id) do update set
    beta_access_granted = true,
    beta_access_granted_at = excluded.beta_access_granted_at,
    beta_access_version = excluded.beta_access_version,
    granted_by = excluded.granted_by,
    updated_at = excluded.updated_at;

  update public.beta_invitation_codes
  set redemption_count = redemption_count + 1
  where id = v_code.id;

  begin
    v_headers := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
    v_ip := nullif(
      split_part(
        coalesce(
          v_headers ->> 'x-forwarded-for',
          v_headers ->> 'cf-connecting-ip',
          ''
        ),
        ',',
        1
      ),
      ''
    )::inet;
  exception when others then
    v_ip := null;
  end;
  v_user_agent := left(coalesce(v_headers ->> 'user-agent', ''), 512);

  insert into public.beta_redemptions (
    code_id, user_id, redeemed_at, ip, user_agent
  )
  values (
    v_code.id, v_user_id, v_now, v_ip, nullif(v_user_agent, '')
  );
  insert into public.beta_management_audit_log (actor_id, action, code_id, details)
  values (
    v_user_id,
    'user_redeemed',
    v_code.id,
    jsonb_build_object('user_id', v_user_id)
  );

  return jsonb_build_object(
    'success', true,
    'status', 'redeemed',
    'beta_access_version', v_code.id::text
  );
end;
$$;

alter function public.set_beta_management_updated_at() owner to postgres;
alter function public.private_beta_is_admin(uuid) owner to postgres;
alter function public.private_beta_constant_time_equal(text, text) owner to postgres;
alter function public.private_beta_generate_code() owner to postgres;
alter function public.admin_create_beta_invitation_code(text, integer, timestamptz) owner to postgres;
alter function public.admin_set_private_beta_enabled(boolean) owner to postgres;
alter function public.admin_set_beta_code_enabled(uuid, boolean) owner to postgres;
alter function public.admin_delete_beta_code(uuid) owner to postgres;
alter function public.admin_regenerate_beta_code(uuid) owner to postgres;
alter function public.admin_revoke_all_beta_access() owner to postgres;
alter function public.redeem_beta_access(text) owner to postgres;

revoke all on function public.set_beta_management_updated_at(),
  public.private_beta_is_admin(uuid),
  public.private_beta_constant_time_equal(text, text),
  public.private_beta_generate_code(),
  public.admin_create_beta_invitation_code(text, integer, timestamptz),
  public.admin_set_private_beta_enabled(boolean),
  public.admin_set_beta_code_enabled(uuid, boolean),
  public.admin_delete_beta_code(uuid),
  public.admin_regenerate_beta_code(uuid),
  public.admin_revoke_all_beta_access(),
  public.redeem_beta_access(text)
  from public, anon, authenticated, service_role;

grant execute on function public.redeem_beta_access(text) to authenticated;
grant execute on function public.admin_create_beta_invitation_code(text, integer, timestamptz),
  public.admin_set_private_beta_enabled(boolean),
  public.admin_set_beta_code_enabled(uuid, boolean),
  public.admin_delete_beta_code(uuid),
  public.admin_regenerate_beta_code(uuid),
  public.admin_revoke_all_beta_access()
  to authenticated;

comment on table public.app_settings is
  'Singleton application settings used by the private-beta authorization gate.';
comment on table public.beta_invitation_codes is
  'Managed invitation metadata and SHA-256 digests; plaintext codes are never stored.';
comment on table public.beta_redemptions is
  'Successful managed invitation redemptions.';
comment on table public.beta_management_audit_log is
  'Immutable audit trail for private-beta management and redemption events.';
