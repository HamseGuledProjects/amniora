create schema auth;
create schema web_lab_control;

create table auth.users (id uuid primary key);

create table public.profiles (
  id uuid primary key,
  plan text not null,
  email text
);

create table public.labs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  topic text not null,
  difficulty text not null,
  estimated_time text not null,
  objective text not null,
  scenario text not null,
  tasks jsonb not null,
  hints jsonb not null,
  outcomes jsonb not null,
  completed boolean not null default false
);

create table public.lab_generation_jobs (
  id uuid primary key,
  user_id uuid not null,
  status text not null,
  category text not null,
  difficulty text not null,
  duration text not null,
  resulting_lab_id uuid,
  updated_at timestamptz not null default now()
);

create table web_lab_control.web_lab_builds (
  id uuid primary key default gen_random_uuid(),
  saved_lab_id uuid not null,
  owner_id uuid not null,
  canonical_lab_id text not null,
  seed text not null,
  template_id text not null,
  template_version text not null,
  vulnerability_module_id text not null,
  vulnerability_module_version text not null,
  schema_version integer not null,
  compiler_version text not null,
  runtime_version text not null,
  build_fingerprint text not null,
  learner_bundle_fingerprint text not null,
  canonical_spec text not null,
  derived_from_build_id uuid,
  created_at timestamptz not null default now()
);

create table web_lab_control.security_rate_limit_windows (
  owner_id uuid not null,
  surface text not null,
  window_started_at timestamptz not null,
  request_limit integer not null,
  used_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, surface, window_started_at)
);

create table web_lab_control.security_rate_limit_requests (
  owner_id uuid not null,
  surface text not null,
  idempotency_key text not null,
  request_hash text not null,
  window_started_at timestamptz not null,
  allowed boolean not null,
  primary key (owner_id, surface, idempotency_key)
);

create table web_lab_control.runner_enrollment_capabilities (
  token_hash text primary key
);

alter table public.profiles enable row level security;
alter table public.labs enable row level security;
alter table public.lab_generation_jobs enable row level security;
alter table web_lab_control.web_lab_builds enable row level security;
alter table web_lab_control.security_rate_limit_windows enable row level security;
alter table web_lab_control.security_rate_limit_requests enable row level security;
alter table web_lab_control.runner_enrollment_capabilities enable row level security;
