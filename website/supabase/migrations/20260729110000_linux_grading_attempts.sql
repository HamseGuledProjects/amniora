create table if not exists public.linux_grading_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lab_id uuid not null references public.labs(id) on delete cascade,
  generated_lab_id uuid null references public.generated_labs(id) on delete set null,
  task_id text not null,
  idempotency_key text not null,
  learner_answer_hash text not null,
  status text not null check (
    status in (
      'processing',
      'graded',
      'retryable_extraction_failed',
      'rejected_invalid_input',
      'rejected_schema_invalid',
      'rejected_security_boundary',
      'rejected_provenance_mismatch'
    )
  ),
  failure_code text null,
  attempt integer not null default 1 check (attempt >= 1),
  assessment_contract_version text not null,
  assessment_contract_hash text not null,
  extractor_schema_version text not null,
  prompt_template_hash text not null,
  model_configuration_id text not null,
  learner_submission_hash text not null,
  raw_extraction_response_hash text null,
  normalized_typed_submission_hash text null,
  deterministic_score_report_hash text null,
  normalized_typed_submission jsonb null,
  deterministic_score_report jsonb null,
  feedback jsonb not null default '{}'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,
  grading_provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lab_id, task_id, idempotency_key)
);

create index if not exists linux_grading_attempts_lab_task_idx
  on public.linux_grading_attempts (lab_id, task_id, created_at desc);

create index if not exists linux_grading_attempts_user_created_idx
  on public.linux_grading_attempts (user_id, created_at desc);

create index if not exists linux_grading_attempts_contract_hash_idx
  on public.linux_grading_attempts (assessment_contract_hash);

alter table public.linux_grading_attempts enable row level security;

revoke all on table public.linux_grading_attempts from public, anon, authenticated;
grant all on table public.linux_grading_attempts to service_role;

drop policy if exists "No browser reads Linux grading internals"
  on public.linux_grading_attempts;
create policy "No browser reads Linux grading internals"
  on public.linux_grading_attempts
  for select
  to authenticated
  using (false);

drop policy if exists "No browser inserts Linux grading attempts"
  on public.linux_grading_attempts;
create policy "No browser inserts Linux grading attempts"
  on public.linux_grading_attempts
  for insert
  to authenticated
  with check (false);

drop policy if exists "No browser updates Linux grading attempts"
  on public.linux_grading_attempts;
create policy "No browser updates Linux grading attempts"
  on public.linux_grading_attempts
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "No browser deletes Linux grading attempts"
  on public.linux_grading_attempts;
create policy "No browser deletes Linux grading attempts"
  on public.linux_grading_attempts
  for delete
  to authenticated
  using (false);

create or replace function public.set_linux_grading_attempt_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists linux_grading_attempts_set_updated_at
  on public.linux_grading_attempts;
create trigger linux_grading_attempts_set_updated_at
before update on public.linux_grading_attempts
for each row
execute function public.set_linux_grading_attempt_updated_at();

comment on table public.linux_grading_attempts is
  'Server-only Linux learner grading attempt records with typed extraction and deterministic scoring provenance.';
