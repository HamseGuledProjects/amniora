-- STAGING TEST HARNESS ONLY : NEVER APPLY TO PRODUCTION
-- Read-only catalog verification for Patch 1B.

select
  'table' as kind,
  c.relname as name,
  c.relrowsecurity::text as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ai_usage', 'ai_usage_reservations')
union all
select
  'index',
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'ai_usage_user_week_unique',
    'ai_usage_reservations_user_week_idx'
  )
union all
select
  'function',
  p.proname,
  concat(
    'owner=', pg_get_userbyid(p.proowner),
    '; security_definer=', p.prosecdef,
    '; args=', pg_get_function_identity_arguments(p.oid),
    '; config=', coalesce(array_to_string(p.proconfig, ','), '')
  )
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'reserve_ai_usage',
    'finalize_ai_usage_reservation',
    'release_ai_usage_reservation'
  )
order by kind, name;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'reserve_ai_usage',
    'finalize_ai_usage_reservation',
    'release_ai_usage_reservation'
  )
order by routine_name, grantee;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'ai_usage_reservations'
order by grantee, privilege_type;
