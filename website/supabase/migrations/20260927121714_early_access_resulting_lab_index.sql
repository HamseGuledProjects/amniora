-- pg-delta: transaction=false
-- Early Access B3. PostgreSQL requires CONCURRENTLY outside a transaction.
create index concurrently if not exists lab_generation_jobs_resulting_lab_id_idx
  on public.lab_generation_jobs (resulting_lab_id)
  where resulting_lab_id is not null;
