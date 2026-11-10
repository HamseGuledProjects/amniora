alter table public.linux_generation_provenance
  add column if not exists assessment_contract_hash text,
  add column if not exists assessment_quality_hash text;

create index if not exists linux_generation_provenance_assessment_contract_hash_idx
  on public.linux_generation_provenance (assessment_contract_hash)
  where assessment_contract_hash is not null;

create index if not exists linux_generation_provenance_assessment_quality_hash_idx
  on public.linux_generation_provenance (assessment_quality_hash)
  where assessment_quality_hash is not null;
