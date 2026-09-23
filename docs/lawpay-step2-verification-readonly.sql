-- Step-2 verification, READ-ONLY. Run straight after the two V323 migrations, then stop.
-- Confirms: the four tables exist with row-level security on; PUBLIC, anon and authenticated hold
-- none of SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on any of them; service_role
-- holds the SELECT it needs (anything else it holds is reported, not required); every mapping,
-- classification, refund and V314 ingest function exists with its exact signature and is service-role
-- only; and all four new tables are empty while lawpay_transactions is untouched. Only SELECTs, read-only CTEs and catalog reads. It writes nothing.

with lines as (
  select 1 as ord, 'A. tables' as section, 'public.mio_lawpay_accounts' as item, coalesce(to_regclass('public.mio_lawpay_accounts')::text, 'ABSENT') as detail
  union all select 2, 'A. tables', 'public.mio_lawpay_classifications', coalesce(to_regclass('public.mio_lawpay_classifications')::text, 'ABSENT')
  union all select 3, 'A. tables', 'public.mio_lawpay_ledger_entries', coalesce(to_regclass('public.mio_lawpay_ledger_entries')::text, 'ABSENT')
  union all select 4, 'A. tables', 'public.mio_lawpay_refund_resolutions', coalesce(to_regclass('public.mio_lawpay_refund_resolutions')::text, 'ABSENT')
  union all select 5, 'A. tables', 'row-level security',
         case when to_regclass('public.mio_lawpay_accounts') is null then 'cannot check: a table is missing'
              else coalesce((select string_agg(c.relname || '=' || case when c.relrowsecurity then 'enabled' else 'DISABLED' end, ', ' order by c.relname)
                             from pg_class c join pg_namespace n on n.oid = c.relnamespace
                             where n.nspname = 'public' and c.relname in ('mio_lawpay_accounts','mio_lawpay_classifications','mio_lawpay_ledger_entries','mio_lawpay_refund_resolutions')), 'none found') end
  union all select 6, 'B. functions', 'mapping: mio_map_lawpay_account_v323',
         coalesce((select 'present (' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mio_map_lawpay_account_v323' limit 1), 'ABSENT')
  union all select 7, 'B. functions', 'classification: save, post, correct, match',
         coalesce((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('mio_save_lawpay_classification_v323','mio_post_lawpay_classification_v323','mio_correct_lawpay_classification_v323','mio_match_lawpay_classification_v323')), 'ABSENT')
  union all select 8, 'B. functions', 'refund: mio_resolve_lawpay_refund_v323',
         coalesce((select 'present (' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mio_resolve_lawpay_refund_v323' limit 1), 'ABSENT')
  union all select 9, 'B. functions', 'V314 ingest must still be present',
         coalesce((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('mio_store_lawpay_transaction_v314','mio_reconcile_lawpay_transaction_v314')), 'ABSENT - the live ingest path is gone, stop')
  union all select 10, 'B. functions', 'every public function whose name contains lawpay',
         coalesce((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like '%lawpay%'), 'none')
  union all select 11, 'C. privileges',
         'tables: PUBLIC, anon and authenticated must hold NONE of SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER',
         case when to_regclass('public.mio_lawpay_accounts') is null then 'cannot check: a table is missing (stop)'
              else coalesce((select string_agg(t.obj || ' -> ' || case when coalesce(v.held,'') = '' then 'none held (good)' else v.held || ' GRANTED (stop)' end, ' | ' order by t.obj)
                             from (values ('public.mio_lawpay_accounts'),('public.mio_lawpay_classifications'),
                                          ('public.mio_lawpay_ledger_entries'),('public.mio_lawpay_refund_resolutions')) t(obj)
                             left join lateral (
                               select string_agg(distinct a.privilege_type || ' via ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, ', ' order by a.privilege_type || ' via ' || case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end) as held
                               from pg_class c
                               join pg_namespace n on n.oid = c.relnamespace
                               cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                               where n.nspname = split_part(t.obj, '.', 1)
                                 and c.relname = split_part(t.obj, '.', 2)
                                 and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
                             ) v on true), 'none found') end
  union all select 12, 'C. privileges',
         'tables: service_role must hold SELECT; any other privilege it holds is reported, not required',
         case when to_regclass('public.mio_lawpay_accounts') is null then 'cannot check: a table is missing (stop)'
              else coalesce((select string_agg(t.obj || '  select=' || has_table_privilege('service_role', t.obj, 'SELECT')::text
                                               || case when has_table_privilege('service_role', t.obj, 'SELECT') then '' else ' (stop)' end
                                               || coalesce('  also holds: ' || (select string_agg(a.privilege_type, ', ' order by a.privilege_type)
                                                                                from pg_class c
                                                                                join pg_namespace n on n.oid = c.relnamespace
                                                                                cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                                                                                where n.nspname = 'public' and c.relname = split_part(t.obj, '.', 2)
                                                                                  and pg_get_userbyid(a.grantee) = 'service_role' and a.privilege_type <> 'SELECT'), '')
                                               , ' | ' order by t.obj)
                             from (values ('public.mio_lawpay_accounts'),('public.mio_lawpay_classifications'),
                                          ('public.mio_lawpay_ledger_entries'),('public.mio_lawpay_refund_resolutions')) t(obj)), 'none') end
  union all select 13, 'C. privileges', 'V323 functions: any PUBLIC, anon or authenticated EXECUTE grant?',
         coalesce((select string_agg(p.proname || '=' || case when p.proacl is null then 'DEFAULT (stop)'
                                                              when exists (select 1 from unnest(p.proacl) a where a::text like '=%' or a::text like 'anon=%' or a::text like 'authenticated=%') then 'GRANTED (stop)'
                                                              else 'none' end, ', ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like '%lawpay%v32%'), 'no V323 function found')
  union all select 14, 'C. privileges', 'V323 functions: service_role EXECUTE grant (required)?',
         coalesce((select string_agg(p.proname || '=' || case when exists (select 1 from unnest(p.proacl) a where a::text like 'service_role=%') then 'yes' else 'MISSING (stop)' end, ', ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like '%lawpay%v32%'), 'no V323 function found')
  union all select 20, 'D. rows (each of the four must be 0)', 'mio_lawpay_accounts (provider account mappings)',
         case when to_regclass('public.mio_lawpay_accounts') is null then 'table absent'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_accounts', false, true, '')))[1]::text end
  union all select 21, 'D. rows (each of the four must be 0)', 'mio_lawpay_classifications',
         case when to_regclass('public.mio_lawpay_classifications') is null then 'table absent'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_classifications', false, true, '')))[1]::text end
  union all select 22, 'D. rows (each of the four must be 0)', 'mio_lawpay_ledger_entries',
         case when to_regclass('public.mio_lawpay_ledger_entries') is null then 'table absent'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_ledger_entries', false, true, '')))[1]::text end
  union all select 23, 'D. rows (each of the four must be 0)', 'mio_lawpay_refund_resolutions',
         case when to_regclass('public.mio_lawpay_refund_resolutions') is null then 'table absent'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_refund_resolutions', false, true, '')))[1]::text end
  union all select 24, 'D. rows (each of the four must be 0)', 'lawpay_transactions unchanged (expect the current count, 59 at the last check)',
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.lawpay_transactions', false, true, '')))[1]::text
)
select section, item, detail from lines order by ord;

