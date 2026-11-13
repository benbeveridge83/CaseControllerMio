-- Default the matter name to "Case Type + Cause Number" for existing open cases.
-- New and edited matters already receive this default in the Mio UI; this backfill
-- brings the existing open cases in line. Only open matters that have at least a
-- case type or a cause number are touched, so the required name is never blanked.
update public.matters
set name = btrim(
  coalesce(nullif(btrim(coalesce(matter_type, '')), ''), '') || ' ' ||
  coalesce(nullif(btrim(coalesce(cause_number, '')), ''), '')
)
where is_active is not false
  and not (
    lower(coalesce(case_status, '') || ' ' || coalesce(matter_status, '')) ~ '(closed|inactive|archived|dismissed)'
  )
  and (
    nullif(btrim(coalesce(matter_type, '')), '') is not null
    or nullif(btrim(coalesce(cause_number, '')), '') is not null
  );
