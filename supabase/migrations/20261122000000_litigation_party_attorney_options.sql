-- Litigation Parties by Matter: seed Party Type + Attorney Type options with colors.
-- Idempotent and safe to rerun: preserves existing option IDs and historical assignments;
-- only adds values that are missing. Colors are editable defaults; a neutral fallback is used
-- in the UI whenever color is null.

-- 1) Party Type — add the requested combined roles and Children. Do not delete existing values.
insert into public.setting_options (category, name, is_active, color, sort_order)
select 'party_type', v.name, true, v.color, v.sort_order
from (values
  ('Petitioner / Counter-Respondent', '#7c3aed', 6),
  ('Respondent / Counter-Petitioner', '#db2777', 7),
  ('Petitioner / Cross-Respondent', '#0891b2', 8),
  ('Respondent / Cross-Petitioner', '#ea580c', 9),
  ('Children', '#16a34a', 10)
) as v(name, color, sort_order)
where not exists (
  select 1 from public.setting_options so
  where so.category = 'party_type' and so.name = v.name
);

-- Assign defaults to the existing Petitioner / Respondent rows (preserve their ids).
update public.setting_options set color = '#2563eb' where category = 'party_type' and name = 'Petitioner' and color is null;
update public.setting_options set color = '#dc2626' where category = 'party_type' and name = 'Respondent' and color is null;

-- 2) Attorney Type — seed the four assignment types.
insert into public.setting_options (category, name, is_active, color, sort_order)
select 'attorney_type', v.name, true, v.color, v.sort_order
from (values
  ('Party Attorney', '#0ea5e9', 1),
  ('Attorney ad Litem', '#8b5cf6', 2),
  ('Amicus Attorney', '#f59e0b', 3),
  ('Guardian ad Litem', '#14b8a6', 4)
) as v(name, color, sort_order)
where not exists (
  select 1 from public.setting_options so
  where so.category = 'attorney_type' and so.name = v.name
);
