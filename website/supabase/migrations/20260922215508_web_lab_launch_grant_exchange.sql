-- Phase 13: a private, durable one-use launch-grant exchange ledger.
-- Stores only a SHA-256 grant ID digest, never the signed grant or gateway session.
create table web_lab_control.runtime_launch_exchanges (
  grant_id_hash text primary key check (grant_id_hash ~ '^[0-9a-f]{64}$'),
  instance_id uuid not null,
  owner_id uuid not null,
  generation_version integer not null check (generation_version > 0),
  expires_at timestamptz not null,
  exchanged_at timestamptz not null default now(),
  constraint runtime_launch_exchanges_instance_owner_fk foreign key (instance_id, owner_id)
    references web_lab_control.runtime_instances (id, owner_id) on delete restrict,
  constraint runtime_launch_exchanges_expiry_check check (expires_at > exchanged_at)
);
create index runtime_launch_exchanges_instance_idx
  on web_lab_control.runtime_launch_exchanges (instance_id, exchanged_at desc);
create index runtime_launch_exchanges_expiry_idx
  on web_lab_control.runtime_launch_exchanges (expires_at);
create trigger runtime_launch_exchanges_append_only
  before update or delete on web_lab_control.runtime_launch_exchanges
  for each row execute function web_lab_control.reject_immutable_row_change();
alter table web_lab_control.runtime_launch_exchanges enable row level security;
revoke all on web_lab_control.runtime_launch_exchanges from public, anon, authenticated;
grant select, insert on web_lab_control.runtime_launch_exchanges to service_role;
