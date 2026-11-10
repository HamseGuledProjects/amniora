alter table public.linux_generation_provenance
  add column if not exists workload_report_hash text;

create index if not exists linux_generation_provenance_workload_hash_idx
  on public.linux_generation_provenance (workload_report_hash)
  where workload_report_hash is not null;
