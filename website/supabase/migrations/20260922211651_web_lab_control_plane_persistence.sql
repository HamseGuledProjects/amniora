-- Phase 12: trusted Web-lab persistence. Do not expose this schema through the Data API.
-- No existing lab row is rewritten. A build link, not labs.topic or labs.completed,
-- identifies an executable Web lab. This migration intentionally starts hosted
-- creation disabled until a later production service is reviewed.
create schema if not exists web_lab_control;
revoke all on schema web_lab_control from public, anon, authenticated;

-- A composite FK binds the new private build owner to the existing saved lab.
-- The existing labs primary key already makes this pair unique in practice;
-- this index lets Postgres enforce the pair without changing existing rows.
create unique index if not exists labs_web_build_owner_key
  on public.labs (id, user_id);

create table web_lab_control.web_lab_builds (
  id uuid primary key default gen_random_uuid(),
  saved_lab_id uuid not null unique,
  owner_id uuid not null,
  engine_type text not null default 'web_runtime' check (engine_type = 'web_runtime'),
  canonical_lab_id text not null check (length(canonical_lab_id) between 1 and 120),
  schema_version integer not null check (schema_version > 0),
  template_id text not null check (length(template_id) between 1 and 80),
  template_version text not null check (length(template_version) between 1 and 40),
  vulnerability_module_id text not null check (length(vulnerability_module_id) between 1 and 80),
  vulnerability_module_version text not null check (length(vulnerability_module_version) between 1 and 40),
  seed text not null check (length(seed) between 1 and 64),
  compiler_version text not null check (length(compiler_version) between 1 and 80),
  runtime_version text not null check (length(runtime_version) between 1 and 80),
  build_fingerprint text not null check (build_fingerprint ~ '^[0-9a-f]{64}$'),
  learner_bundle_fingerprint text not null check (learner_bundle_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_spec text not null check (octet_length(canonical_spec) between 1 and 131072),
  derived_from_build_id uuid null references web_lab_control.web_lab_builds(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint web_lab_builds_saved_owner_fk foreign key (saved_lab_id, owner_id)
    references public.labs (id, user_id) on update restrict on delete restrict,
  constraint web_lab_builds_id_owner_key unique (id, owner_id)
);
create index web_lab_builds_owner_created_idx
  on web_lab_control.web_lab_builds (owner_id, created_at desc);
create index web_lab_builds_derived_from_idx
  on web_lab_control.web_lab_builds (derived_from_build_id)
  where derived_from_build_id is not null;

-- The full canonical spec includes internalSolution. The entire table is
-- service-only; there is deliberately no learner SELECT policy or public view.
comment on column web_lab_control.web_lab_builds.canonical_spec is
  'Exact canonical UTF-8 WebLabSpec including internalSolution; trusted service only';

create table web_lab_control.runtime_instances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  web_lab_build_id uuid not null,
  runtime_mode text not null check (runtime_mode in ('local_runner', 'byo_runtime', 'amniora_hosted')),
  provider_kind text not null check (length(provider_kind) between 1 and 80),
  lifecycle_state text not null default 'requested' check (lifecycle_state in
    ('requested', 'provisioning', 'ready', 'resetting', 'expiring', 'destroying', 'expired', 'failed', 'destroyed')),
  backend_reference text null check (backend_reference is null or length(backend_reference) between 1 and 512),
  runtime_version text not null check (length(runtime_version) between 1 and 80),
  generation_version integer not null default 1 check
    (generation_version > 0 and (runtime_mode <> 'amniora_hosted' or generation_version <= 4)),
  route_key text not null unique check (length(route_key) between 22 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz null,
  expires_at timestamptz not null,
  last_activity_at timestamptz not null default now(),
  last_reconciled_at timestamptz null,
  destroyed_at timestamptz null,
  failure_code text null check (failure_code is null or failure_code ~ '^[a-z0-9_:-]{1,80}$'),
  version bigint not null default 1 check (version > 0),
  constraint runtime_instances_build_owner_fk foreign key (web_lab_build_id, owner_id)
    references web_lab_control.web_lab_builds (id, owner_id) on delete restrict,
  constraint runtime_instances_id_owner_key unique (id, owner_id),
  constraint runtime_instances_id_owner_build_key unique (id, owner_id, web_lab_build_id),
  constraint runtime_instances_expiry_check check (expires_at > created_at and
    (runtime_mode <> 'amniora_hosted' or expires_at <= created_at + interval '60 minutes'))
);
create unique index runtime_instances_one_active_hosted_owner_idx
  on web_lab_control.runtime_instances (owner_id)
  where runtime_mode = 'amniora_hosted' and lifecycle_state in
    ('requested', 'provisioning', 'ready', 'resetting', 'expiring', 'destroying');
create index runtime_instances_build_idx
  on web_lab_control.runtime_instances (web_lab_build_id, created_at desc);
create index runtime_instances_reconcile_idx
  on web_lab_control.runtime_instances (lifecycle_state, updated_at)
  where lifecycle_state in ('requested', 'provisioning', 'ready', 'resetting', 'expiring', 'destroying');
create index runtime_instances_expiry_idx
  on web_lab_control.runtime_instances (expires_at)
  where lifecycle_state in ('requested', 'provisioning', 'ready', 'resetting', 'expiring');
comment on column web_lab_control.runtime_instances.backend_reference is
  'Internal provider-neutral backend identity; never return in learner DTOs';

create table web_lab_control.runtime_commands (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null,
  owner_id uuid not null,
  operation text not null check (operation in ('create', 'reset', 'destroy', 'grade')),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'in_progress' check (state in ('in_progress', 'completed', 'failed')),
  generation_version integer not null check (generation_version > 0),
  result_code text null check (result_code is null or result_code ~ '^[a-z0-9_:-]{1,80}$'),
  created_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  lease_owner text null check (lease_owner is null or length(lease_owner) between 1 and 120),
  lease_until timestamptz null,
  fence_token bigint not null default 0 check (fence_token >= 0),
  constraint runtime_commands_instance_owner_fk foreign key (instance_id, owner_id)
    references web_lab_control.runtime_instances (id, owner_id) on delete restrict,
  constraint runtime_commands_idempotency_key unique (owner_id, operation, idempotency_key)
);
create index runtime_commands_instance_idx
  on web_lab_control.runtime_commands (instance_id, created_at desc);
create index runtime_commands_pending_idx
  on web_lab_control.runtime_commands (lease_until, created_at)
  where state = 'in_progress';

create table web_lab_control.runtime_admission_slots (
  slot_no smallint primary key check (slot_no between 1 and 5),
  instance_id uuid null unique references web_lab_control.runtime_instances(id) on delete restrict,
  reserved_at timestamptz null,
  updated_at timestamptz not null default now(),
  constraint runtime_admission_slots_pair_check check
    ((instance_id is null and reserved_at is null) or (instance_id is not null and reserved_at is not null))
);
insert into web_lab_control.runtime_admission_slots (slot_no)
select value from generate_series(1, 5) as value;

create table web_lab_control.runtime_admission (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null unique,
  owner_id uuid not null,
  web_lab_build_id uuid not null,
  command_id uuid not null unique references web_lab_control.runtime_commands(id) on delete restrict,
  slot_no smallint not null references web_lab_control.runtime_admission_slots(slot_no) on delete restrict,
  state text not null default 'reserved' check (state in ('reserved', 'occupied', 'releasing', 'released')),
  reserved_cost_gbp_pence integer not null check (reserved_cost_gbp_pence >= 0),
  reserved_minutes integer not null check (reserved_minutes between 1 and 60),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz null,
  constraint runtime_admission_instance_owner_build_fk foreign key
    (instance_id, owner_id, web_lab_build_id)
    references web_lab_control.runtime_instances (id, owner_id, web_lab_build_id) on delete restrict,
  constraint runtime_admission_release_check check
    ((state = 'released' and released_at is not null) or (state <> 'released' and released_at is null))
);
create unique index runtime_admission_one_active_per_slot_idx
  on web_lab_control.runtime_admission (slot_no)
  where state in ('reserved', 'occupied', 'releasing');
create index runtime_admission_owner_created_idx
  on web_lab_control.runtime_admission (owner_id, created_at desc);
create index runtime_admission_expiry_idx
  on web_lab_control.runtime_admission (expires_at)
  where state in ('reserved', 'occupied', 'releasing');

create table web_lab_control.runtime_budget_policy (
  singleton_id smallint primary key default 1 check (singleton_id = 1),
  hosted_runtime_enabled boolean not null default false,
  budget_state text not null default 'DISABLED'
    check (budget_state in ('NORMAL', 'WARNING', 'RESTRICTED', 'DISABLED')),
  warning_gbp_pence integer not null default 2500,
  restricted_gbp_pence integer not null default 3500,
  disable_gbp_pence integer not null default 4000,
  observed_spend_gbp_pence integer not null default 0 check (observed_spend_gbp_pence >= 0),
  reserved_spend_gbp_pence integer not null default 0 check (reserved_spend_gbp_pence >= 0),
  metrics_observed_at timestamptz null,
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  constraint runtime_budget_thresholds_check check
    (0 <= warning_gbp_pence and warning_gbp_pence < restricted_gbp_pence and
     restricted_gbp_pence < disable_gbp_pence)
);
insert into web_lab_control.runtime_budget_policy (singleton_id) values (1);

create table web_lab_control.runtime_audit_events (
  event_id bigint generated always as identity primary key,
  instance_id uuid null references web_lab_control.runtime_instances(id) on delete restrict,
  command_id uuid null references web_lab_control.runtime_commands(id) on delete restrict,
  owner_id uuid null,
  event_type text not null check (event_type ~ '^[a-z0-9_]{1,80}$'),
  generation_version integer null check (generation_version > 0),
  result text not null check (result in ('ok', 'failed', 'denied')),
  safe_code text null check (safe_code is null or safe_code ~ '^[a-z0-9_:-]{1,80}$'),
  occurred_at timestamptz not null default now()
);
create index runtime_audit_instance_order_idx
  on web_lab_control.runtime_audit_events (instance_id, event_id)
  where instance_id is not null;
create index runtime_audit_owner_order_idx
  on web_lab_control.runtime_audit_events (owner_id, event_id)
  where owner_id is not null;

create table web_lab_control.runtime_usage (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references web_lab_control.runtime_instances(id) on delete restrict,
  provider_kind text not null check (length(provider_kind) between 1 and 80),
  generation_version integer not null check (generation_version > 0),
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  provisioned_seconds bigint not null default 0 check (provisioned_seconds >= 0),
  active_cpu_ms bigint not null default 0 check (active_cpu_ms >= 0),
  memory_mb_seconds bigint not null default 0 check (memory_mb_seconds >= 0),
  ingress_bytes bigint not null default 0 check (ingress_bytes >= 0),
  egress_bytes bigint not null default 0 check (egress_bytes >= 0),
  grader_ms bigint not null default 0 check (grader_ms >= 0),
  estimated_cost_minor_units bigint null check (estimated_cost_minor_units >= 0),
  cost_currency text null check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  measurement_source text not null check (length(measurement_source) between 1 and 80),
  external_sample_id text null check (external_sample_id is null or length(external_sample_id) between 1 and 160),
  observed_at timestamptz not null default now(),
  constraint runtime_usage_window_check check (window_ended_at >= window_started_at),
  constraint runtime_usage_cost_pair_check check
    ((estimated_cost_minor_units is null and cost_currency is null) or
     (estimated_cost_minor_units is not null and cost_currency is not null))
);
create unique index runtime_usage_provider_sample_idx
  on web_lab_control.runtime_usage (provider_kind, measurement_source, external_sample_id)
  where external_sample_id is not null;
create index runtime_usage_instance_window_idx
  on web_lab_control.runtime_usage (instance_id, window_started_at desc);

create table web_lab_control.web_lab_grade_attempts (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null,
  owner_id uuid not null,
  web_lab_build_id uuid not null,
  trust_level text not null check (trust_level in
    ('hosted_verified', 'local_self_hosted', 'byo_self_hosted')),
  outcome text not null check (outcome in ('pass', 'not_complete', 'error')),
  grader_version text not null check (length(grader_version) between 1 and 80),
  observation_fingerprint text null check
    (observation_fingerprint is null or observation_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint web_lab_grade_attempts_instance_fk foreign key
    (instance_id, owner_id, web_lab_build_id)
    references web_lab_control.runtime_instances (id, owner_id, web_lab_build_id) on delete restrict,
  constraint web_lab_grade_attempts_id_owner_build_key unique (id, owner_id, web_lab_build_id)
);
create index web_lab_grade_attempts_owner_created_idx
  on web_lab_control.web_lab_grade_attempts (owner_id, created_at desc);

create table web_lab_control.web_lab_completions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  web_lab_build_id uuid not null,
  runtime_instance_id uuid not null,
  trusted_grade_id uuid not null unique,
  trust_level text not null check (trust_level in
    ('hosted_verified', 'local_self_hosted', 'byo_self_hosted')),
  completed_at timestamptz not null default now(),
  grader_version text not null check (length(grader_version) between 1 and 80),
  completion_fingerprint text not null check (completion_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint web_lab_completions_build_owner_fk foreign key (web_lab_build_id, owner_id)
    references web_lab_control.web_lab_builds (id, owner_id) on delete restrict,
  constraint web_lab_completions_instance_fk foreign key
    (runtime_instance_id, owner_id, web_lab_build_id)
    references web_lab_control.runtime_instances (id, owner_id, web_lab_build_id) on delete restrict,
  constraint web_lab_completions_grade_fk foreign key
    (trusted_grade_id, owner_id, web_lab_build_id)
    references web_lab_control.web_lab_grade_attempts (id, owner_id, web_lab_build_id) on delete restrict,
  constraint web_lab_completions_owner_build_trust_key unique (owner_id, web_lab_build_id, trust_level)
);
create index web_lab_completions_owner_completed_idx
  on web_lab_control.web_lab_completions (owner_id, completed_at desc);

-- Service-owned immutable records remain immutable even if an accidentally
-- broad table grant is later introduced. A future retention migration needs
-- an explicit, reviewed deletion path.
create function web_lab_control.reject_immutable_row_change()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'immutable_web_lab_record' using errcode = 'P0001';
end;
$$;
create trigger web_lab_builds_immutable
  before update or delete on web_lab_control.web_lab_builds
  for each row execute function web_lab_control.reject_immutable_row_change();
create trigger runtime_audit_events_append_only
  before update or delete on web_lab_control.runtime_audit_events
  for each row execute function web_lab_control.reject_immutable_row_change();
create trigger runtime_usage_append_only
  before update or delete on web_lab_control.runtime_usage
  for each row execute function web_lab_control.reject_immutable_row_change();
create trigger web_lab_grade_attempts_append_only
  before update or delete on web_lab_control.web_lab_grade_attempts
  for each row execute function web_lab_control.reject_immutable_row_change();
create trigger web_lab_completions_append_only
  before update or delete on web_lab_control.web_lab_completions
  for each row execute function web_lab_control.reject_immutable_row_change();

create function web_lab_control.guard_runtime_instance_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if new.id <> old.id or new.owner_id <> old.owner_id or
     new.web_lab_build_id <> old.web_lab_build_id or
     new.runtime_mode <> old.runtime_mode or new.provider_kind <> old.provider_kind or
     new.runtime_version <> old.runtime_version or
     new.created_at <> old.created_at or new.route_key <> old.route_key then
    raise exception 'immutable_runtime_identity' using errcode = 'P0001';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'stale_runtime_version' using errcode = 'P0001';
  end if;
  if new.generation_version < old.generation_version or
     new.generation_version > old.generation_version + 1 then
    raise exception 'invalid_runtime_generation' using errcode = 'P0001';
  end if;
  if new.lifecycle_state <> old.lifecycle_state and not (
    (old.lifecycle_state = 'requested' and new.lifecycle_state in ('provisioning','expiring','failed','destroying','destroyed')) or
    (old.lifecycle_state = 'provisioning' and new.lifecycle_state in ('ready','expiring','failed','destroying','destroyed')) or
    (old.lifecycle_state = 'ready' and new.lifecycle_state in ('resetting','expiring','failed','destroying','destroyed')) or
    (old.lifecycle_state = 'resetting' and new.lifecycle_state in ('ready','expiring','failed','destroying','destroyed')) or
    (old.lifecycle_state = 'expiring' and new.lifecycle_state in ('expired','failed','destroying')) or
    (old.lifecycle_state = 'destroying' and new.lifecycle_state in ('destroyed','failed')) or
    (old.lifecycle_state = 'expired' and new.lifecycle_state in ('destroying','destroyed')) or
    (old.lifecycle_state = 'failed' and new.lifecycle_state in ('destroying','destroyed'))
  ) then
    raise exception 'invalid_runtime_transition' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger runtime_instances_guard_update
  before update on web_lab_control.runtime_instances
  for each row execute function web_lab_control.guard_runtime_instance_update();

create function web_lab_control.guard_completion_insert()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  grade_row record;
  runtime_row record;
begin
  select * into grade_row from web_lab_control.web_lab_grade_attempts
    where id = new.trusted_grade_id;
  if not found then
    raise exception 'untrusted_web_lab_completion' using errcode = 'P0001';
  end if;
  select * into runtime_row from web_lab_control.runtime_instances
    where id = new.runtime_instance_id;
  if not found then
    raise exception 'untrusted_web_lab_completion' using errcode = 'P0001';
  end if;
  if grade_row.outcome <> 'pass' or
     grade_row.instance_id <> new.runtime_instance_id or
     grade_row.owner_id <> new.owner_id or
     grade_row.web_lab_build_id <> new.web_lab_build_id or
     grade_row.trust_level <> new.trust_level or
     grade_row.grader_version <> new.grader_version or
     (new.trust_level = 'hosted_verified' and runtime_row.runtime_mode <> 'amniora_hosted') or
     (new.trust_level = 'local_self_hosted' and runtime_row.runtime_mode <> 'local_runner') or
     (new.trust_level = 'byo_self_hosted' and runtime_row.runtime_mode <> 'byo_runtime') then
    raise exception 'untrusted_web_lab_completion' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger web_lab_completions_trusted_grade
  before insert on web_lab_control.web_lab_completions
  for each row execute function web_lab_control.guard_completion_insert();

-- The schema is not in api.schemas. RLS is additional defense and has no
-- learner policies. Explicit grants below are for trusted server use only.
alter table web_lab_control.web_lab_builds enable row level security;
alter table web_lab_control.runtime_instances enable row level security;
alter table web_lab_control.runtime_commands enable row level security;
alter table web_lab_control.runtime_admission_slots enable row level security;
alter table web_lab_control.runtime_admission enable row level security;
alter table web_lab_control.runtime_budget_policy enable row level security;
alter table web_lab_control.runtime_audit_events enable row level security;
alter table web_lab_control.runtime_usage enable row level security;
alter table web_lab_control.web_lab_grade_attempts enable row level security;
alter table web_lab_control.web_lab_completions enable row level security;

revoke all on all tables in schema web_lab_control from public, anon, authenticated;
revoke all on all sequences in schema web_lab_control from public, anon, authenticated;
revoke execute on all functions in schema web_lab_control from public, anon, authenticated;
grant usage on schema web_lab_control to service_role;
grant select, insert on web_lab_control.web_lab_builds,
  web_lab_control.runtime_audit_events, web_lab_control.runtime_usage,
  web_lab_control.web_lab_grade_attempts, web_lab_control.web_lab_completions to service_role;
grant select, insert, update on web_lab_control.runtime_instances,
  web_lab_control.runtime_commands, web_lab_control.runtime_admission to service_role;
grant select, update on web_lab_control.runtime_admission_slots,
  web_lab_control.runtime_budget_policy to service_role;
grant usage, select on all sequences in schema web_lab_control to service_role;
