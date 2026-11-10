-- Early Access B6: private persistence for distributed abuse decisions and
-- one-use My VM enrollment capabilities. No learner-facing policies exist.

create table web_lab_control.security_rate_limit_windows (
  owner_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in (
    'runner_package', 'my_vm_enrollment', 'runtime_launch',
    'runtime_reset', 'runtime_grade', 'launch_exchange'
  )),
  window_started_at timestamptz not null,
  request_limit integer not null check (request_limit between 1 and 10000),
  used_count integer not null check (used_count between 0 and request_limit),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, surface, window_started_at)
);

create table web_lab_control.security_rate_limit_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  surface text not null check (surface in (
    'runner_package', 'my_vm_enrollment', 'runtime_launch',
    'runtime_reset', 'runtime_grade', 'launch_exchange'
  )),
  idempotency_key text not null check (
    length(idempotency_key) between 1 and 160
    and idempotency_key ~ '^[A-Za-z0-9_-]+$'
  ),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  allowed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (owner_id, surface, idempotency_key)
);

create index security_rate_limit_requests_created_at_idx
  on web_lab_control.security_rate_limit_requests (created_at);

create table web_lab_control.runner_enrollment_capabilities (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  audience text not null check (audience = 'amniora-byo-broker'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > issued_at),
  check (consumed_at is null or consumed_at >= issued_at)
);

create index runner_enrollment_capabilities_expiry_idx
  on web_lab_control.runner_enrollment_capabilities (expires_at)
  where consumed_at is null;

alter table web_lab_control.security_rate_limit_windows enable row level security;
alter table web_lab_control.security_rate_limit_requests enable row level security;
alter table web_lab_control.runner_enrollment_capabilities enable row level security;

revoke all on table web_lab_control.security_rate_limit_windows
  from public, anon, authenticated, service_role;
revoke all on table web_lab_control.security_rate_limit_requests
  from public, anon, authenticated, service_role;
revoke all on table web_lab_control.runner_enrollment_capabilities
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table web_lab_control.security_rate_limit_windows to service_role;
grant select, insert, update, delete
  on table web_lab_control.security_rate_limit_requests to service_role;
grant select, insert, update, delete
  on table web_lab_control.runner_enrollment_capabilities to service_role;

comment on table web_lab_control.security_rate_limit_windows is
  'Server-only atomic bounded-window counters for Early Access runtime surfaces.';
comment on table web_lab_control.security_rate_limit_requests is
  'Server-only idempotent abuse-control decisions; contains no raw tokens.';
comment on table web_lab_control.runner_enrollment_capabilities is
  'Server-only one-use enrollment token digests; raw capabilities are never persisted.';
