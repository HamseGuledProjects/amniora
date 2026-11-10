-- Supports a bounded per-learner, same-family acceptance-history lookup.
-- Metadata lives in the existing provenance JSON; no learner evidence is copied.
-- Pre-contract rows cannot be compared safely and form an explicit rollout
-- boundary. Rows claiming the current contract remain fail-closed in code when
-- their fingerprint payload is absent or malformed.
create index if not exists linux_generation_provenance_recent_family_idx
  on public.linux_generation_provenance
  (user_id, (provenance ->> 'incidentFamily'), (provenance ->> 'diversityContractVersion'), created_at desc, id desc);
