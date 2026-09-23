-- Step-3 verification, READ-ONLY. Run after applying the V324 migration, before any Edge Function,
-- mapping, re-resolution or interface work.
--
-- Confirms: the re-resolution function exists with its exact signature; it is a definer function with
-- a pinned search path; it holds no PUBLIC, anon or authenticated grant and does hold the service_role
-- grant; the V323 and V314 functions are still present; and the migration changed no data at all —
-- all four V323 tables remain empty, no transaction carries a resolution history yet, and
-- lawpay_transactions is still the same size.
--
-- Only SELECTs, read-only CTEs and catalog reads. It writes nothing.

with lines as (
  select 1 as ord, 'A. function' as item, 'mio_reresolve_lawpay_accounts_v324' as detail,
         coalesce((select 'present (' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324' limit 1), 'ABSENT (stop)') as verdict
  union all select 2, 'security: definer and pinned search path',
         coalesce((select 'security definer=' || p.prosecdef::text || '  search_path=' || coalesce(array_to_string(p.proconfig, ' '), 'DEFAULT (stop)')
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324' limit 1), 'ABSENT (stop)'),
         case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324'
                             and p.prosecdef and coalesce(array_to_string(p.proconfig, ' '), '') like '%search_path%')
              then 'good' else 'MISSING definer or search_path (stop)' end
  union all select 3, 'privileges: PUBLIC, anon, authenticated must hold no EXECUTE',
         coalesce((select string_agg(p.proname || '=' || case when p.proacl is null then 'DEFAULT (stop)'
                                                              when exists (select 1 from unnest(p.proacl) a where a::text like '=%' or a::text like 'anon=%' or a::text like 'authenticated=%') then 'GRANTED (stop)'
                                                              else 'none' end, ', ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324'), 'ABSENT (stop)'),
         'no inherited execute grant for the browser roles'
  union all select 4, 'privileges: service_role EXECUTE required',
         coalesce((select case when exists (select 1 from unnest(p.proacl) a where a::text like 'service_role=%') then 'present' else 'MISSING (stop)' end
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324'), 'ABSENT (stop)'),
         'the gateway calls it with the service key'
  union all select 5, 'V323 and V314 functions still present',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname in ('mio_map_lawpay_account_v323','mio_resolve_lawpay_refund_v323','mio_store_lawpay_transaction_v314','mio_reconcile_lawpay_transaction_v314')), 'none')
         || case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                         and p.proname in ('mio_map_lawpay_account_v323','mio_resolve_lawpay_refund_v323','mio_store_lawpay_transaction_v314','mio_reconcile_lawpay_transaction_v314')) = 4
                 then '  (all four dependencies present)' else '  (stop: a required dependency is missing)' end,
         'the migration is additive'
  union all select 6, 'rows in the four V323 tables (each must be 0)',
         coalesce((select string_agg(x.t || '=' || x.n || case when x.n = '0' then ' (good)' when x.n like 'absent%' then '' else ' (stop)' end, ', ' order by x.t) from (
             select 'mio_lawpay_accounts' as t, case when to_regclass('public.mio_lawpay_accounts') is null then 'absent (stop)'
                       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_accounts', false, true, '')))[1]::text end as n
             union all select 'mio_lawpay_classifications', case when to_regclass('public.mio_lawpay_classifications') is null then 'absent (stop)'
                       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_classifications', false, true, '')))[1]::text end
             union all select 'mio_lawpay_ledger_entries', case when to_regclass('public.mio_lawpay_ledger_entries') is null then 'absent (stop)'
                       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_ledger_entries', false, true, '')))[1]::text end
             union all select 'mio_lawpay_refund_resolutions', case when to_regclass('public.mio_lawpay_refund_resolutions') is null then 'absent (stop)'
                       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_refund_resolutions', false, true, '')))[1]::text end
           ) x), 'none'),
         'the migration writes no rows'
  union all select 7, 'transactions carrying a resolution history (must be 0 before step 7)',
         (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where raw ? 'mio_account_resolution_history'$q$, false, true, '')))[1]::text || case when (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where raw ? 'mio_account_resolution_history'$q$, false, true, '')))[1]::text = '0' then ' (good)' else ' (stop)' end,
         'only step 7, on approval, may write one'
  union all select 8, 'lawpay_transactions size unchanged',
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.lawpay_transactions', false, true, '')))[1]::text
         || case when (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.lawpay_transactions', false, true, '')))[1]::text = '59'
                 then '  (59, unchanged since step 2)' else '  (stop: expected 59)' end,
         'no transaction is added, removed or edited'
)
select item, detail, verdict from lines order by ord;
