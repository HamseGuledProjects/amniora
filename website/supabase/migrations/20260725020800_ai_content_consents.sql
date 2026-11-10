create table if not exists public.ai_content_consents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_type text not null check (feature_type in ('lab_generation', 'tutor_chat')),
  consent_version text not null,
  notice_version text not null,
  accepted_at timestamptz not null default now(),
  chat_id uuid null references public.ai_conversations(id) on delete set null,
  lab_request_id uuid null references public.generated_labs(id) on delete set null,
  ip_hash text null,
  user_agent text null,
  revoked_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_content_consent_tokens (
  id uuid primary key,
  consent_id uuid not null references public.ai_content_consents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_type text not null check (feature_type in ('lab_generation', 'tutor_chat')),
  token_hash text not null unique,
  environment text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null
);

create index if not exists ai_content_consents_user_feature_idx
  on public.ai_content_consents(user_id, feature_type, accepted_at desc);

create index if not exists ai_content_consents_chat_idx
  on public.ai_content_consents(chat_id)
  where chat_id is not null;

create index if not exists ai_content_consents_lab_request_idx
  on public.ai_content_consents(lab_request_id)
  where lab_request_id is not null;

create index if not exists ai_content_consent_tokens_lookup_idx
  on public.ai_content_consent_tokens(id, user_id, feature_type)
  where consumed_at is null;

alter table public.ai_content_consents enable row level security;
alter table public.ai_content_consent_tokens enable row level security;

drop policy if exists "Users may read their own AI content consents"
  on public.ai_content_consents;
create policy "Users may read their own AI content consents"
  on public.ai_content_consents
  for select
  using (auth.uid() = user_id);

drop policy if exists "No browser writes to AI content consents"
  on public.ai_content_consents;
create policy "No browser writes to AI content consents"
  on public.ai_content_consents
  for insert
  with check (false);

drop policy if exists "No browser token reads"
  on public.ai_content_consent_tokens;
create policy "No browser token reads"
  on public.ai_content_consent_tokens
  for select
  using (false);

drop policy if exists "No browser token writes"
  on public.ai_content_consent_tokens;
create policy "No browser token writes"
  on public.ai_content_consent_tokens
  for insert
  with check (false);
