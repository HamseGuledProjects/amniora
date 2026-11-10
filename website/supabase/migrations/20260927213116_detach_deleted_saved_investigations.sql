-- Retain private Web Lab history when its learner-owned Saved Investigation is deleted.
-- owner_id remains immutable and authoritative; only the optional public.labs link detaches.
alter table web_lab_control.web_lab_builds
  drop constraint web_lab_builds_saved_owner_fk,
  alter column saved_lab_id drop not null;

-- The original append-only trigger also sees the referential action's internal UPDATE.
-- Permit only the exact non-null -> null relationship detach; every other update/delete
-- remains rejected for this table and for every other table using this function.
create or replace function web_lab_control.reject_immutable_row_change()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_table_schema = 'web_lab_control' and
     tg_table_name = 'web_lab_builds' and
     tg_op = 'UPDATE' and
     old.saved_lab_id is not null and
     new.saved_lab_id is null and
     (to_jsonb(new) - 'saved_lab_id') = (to_jsonb(old) - 'saved_lab_id') then
    return new;
  end if;

  raise exception 'immutable_web_lab_record' using errcode = 'P0001';
end;
$$;

alter table web_lab_control.web_lab_builds
  add constraint web_lab_builds_saved_owner_fk
  foreign key (saved_lab_id, owner_id)
  references public.labs (id, user_id)
  on update restrict
  on delete set null (saved_lab_id);
