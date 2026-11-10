create table if not exists public.lab_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  difficulty text not null,
  duration text not null,
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'completed', 'failed')),
  resulting_lab_id uuid null references public.labs(id) on delete set null,
  usage_reservation_id uuid null references public.ai_usage_reservations(id) on delete set null,
  safe_error_code text null,
  safe_error_message text null,
  retryable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  failed_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create unique index if not exists lab_generation_jobs_one_active_per_user_idx
  on public.lab_generation_jobs(user_id)
  where status in ('queued', 'generating');

create index if not exists lab_generation_jobs_user_created_idx
  on public.lab_generation_jobs(user_id, created_at desc);

alter table public.lab_generation_jobs enable row level security;

revoke all on table public.lab_generation_jobs from public, anon, authenticated;
grant select on table public.lab_generation_jobs to authenticated;
grant all on table public.lab_generation_jobs to service_role;

create policy "Users can read their own lab generation jobs"
  on public.lab_generation_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);
