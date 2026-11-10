create table if not exists public.lab_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lab_id uuid not null references public.labs(id) on delete cascade,
  generated_lab_id uuid null references public.generated_labs(id) on delete set null,
  public_reference text not null default ('FBK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  rating text not null check (rating in ('poor', 'fair', 'good', 'excellent')),
  improvement_note text null check (improvement_note is null or char_length(improvement_note) <= 1500),
  lab_title text not null check (char_length(lab_title) <= 240),
  lab_category text not null check (char_length(lab_category) <= 80),
  lab_difficulty text not null check (char_length(lab_difficulty) <= 40),
  lab_duration text not null check (char_length(lab_duration) <= 40),
  lab_created_at timestamptz null,
  app_environment text not null check (char_length(app_environment) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, lab_id),
  unique (public_reference)
);

create table if not exists public.lab_complaints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lab_id uuid not null references public.labs(id) on delete cascade,
  generated_lab_id uuid null references public.generated_labs(id) on delete set null,
  public_reference text not null default ('CMP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  category text not null check (
    category in (
      'incorrect_or_contradictory_evidence',
      'task_cannot_be_completed',
      'grading_problem',
      'offensive_or_inappropriate_content',
      'privacy_or_security_concern',
      'export_or_download_problem',
      'other'
    )
  ),
  description text not null check (char_length(description) between 1 and 3000),
  task_reference text null check (task_reference is null or char_length(task_reference) <= 100),
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'dismissed')),
  lab_title text not null check (char_length(lab_title) <= 240),
  lab_category text not null check (char_length(lab_category) <= 80),
  lab_difficulty text not null check (char_length(lab_difficulty) <= 40),
  lab_duration text not null check (char_length(lab_duration) <= 40),
  lab_created_at timestamptz null,
  app_environment text not null check (char_length(app_environment) <= 40),
  notification_status text not null default 'not_configured' check (
    notification_status in ('not_configured', 'pending', 'sent', 'failed')
  ),
  notification_attempts integer not null default 0 check (notification_attempts >= 0),
  notification_last_attempt_at timestamptz null,
  notification_error_code text null check (notification_error_code is null or char_length(notification_error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (public_reference)
);

create index if not exists lab_feedback_user_lab_idx
  on public.lab_feedback (user_id, lab_id);

create index if not exists lab_feedback_lab_created_idx
  on public.lab_feedback (lab_id, created_at desc);

create index if not exists lab_feedback_admin_created_idx
  on public.lab_feedback (created_at desc, lab_difficulty);

create index if not exists lab_complaints_user_lab_idx
  on public.lab_complaints (user_id, lab_id, created_at desc);

create index if not exists lab_complaints_admin_status_created_idx
  on public.lab_complaints (status, created_at desc);

create index if not exists lab_complaints_admin_category_created_idx
  on public.lab_complaints (category, created_at desc);

create index if not exists lab_complaints_admin_difficulty_created_idx
  on public.lab_complaints (lab_difficulty, created_at desc);

alter table public.lab_feedback enable row level security;
alter table public.lab_complaints enable row level security;

revoke all on table public.lab_feedback from public, anon, authenticated;
revoke all on table public.lab_complaints from public, anon, authenticated;

grant select, insert, update on table public.lab_feedback to authenticated;
grant select, insert on table public.lab_complaints to authenticated;
grant all on table public.lab_feedback to service_role;
grant all on table public.lab_complaints to service_role;

drop policy if exists "Learners can read their own lab feedback"
  on public.lab_feedback;
create policy "Learners can read their own lab feedback"
  on public.lab_feedback
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Learners can create their own lab feedback"
  on public.lab_feedback;
create policy "Learners can create their own lab feedback"
  on public.lab_feedback
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Learners can update their own lab feedback"
  on public.lab_feedback;
create policy "Learners can update their own lab feedback"
  on public.lab_feedback
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Learners can read their own lab complaints"
  on public.lab_complaints;
create policy "Learners can read their own lab complaints"
  on public.lab_complaints
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Learners can create their own lab complaints"
  on public.lab_complaints;
create policy "Learners can create their own lab complaints"
  on public.lab_complaints
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'new'
    and notification_attempts = 0
  );

drop policy if exists "Learners cannot update lab complaints"
  on public.lab_complaints;
create policy "Learners cannot update lab complaints"
  on public.lab_complaints
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists "Learners cannot delete lab complaints"
  on public.lab_complaints;
create policy "Learners cannot delete lab complaints"
  on public.lab_complaints
  for delete
  to authenticated
  using (false);

create or replace function public.set_lab_feedback_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lab_feedback_set_updated_at
  on public.lab_feedback;
create trigger lab_feedback_set_updated_at
before update on public.lab_feedback
for each row
execute function public.set_lab_feedback_updated_at();

drop trigger if exists lab_complaints_set_updated_at
  on public.lab_complaints;
create trigger lab_complaints_set_updated_at
before update on public.lab_complaints
for each row
execute function public.set_lab_feedback_updated_at();

comment on table public.lab_feedback is
  'Learner-owned saved-lab rating feedback. One current record per learner and saved lab.';

comment on table public.lab_complaints is
  'Learner-owned saved-lab complaints for admin triage. Learner submissions are append-only after creation.';
