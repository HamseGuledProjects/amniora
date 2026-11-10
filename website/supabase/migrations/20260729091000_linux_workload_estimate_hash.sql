alter table public.linux_generation_provenance
  add column if not exists workload_estimate_hash text;

create index if not exists linux_generation_provenance_workload_estimate_hash_idx
  on public.linux_generation_provenance (workload_estimate_hash)
  where workload_estimate_hash is not null;
