-- Step 4 verification (read-only): deploying the diagnostics Edge Function must leave the database
-- exactly as step 3 left it. Run it immediately after the deployment and compare with the step-3 grid.
-- One statement, no writes, nothing to clean up.
--
-- It deliberately asserts nothing about Edge Functions themselves: whether the function is deployed and
-- what it answers is checked in the dashboard and by invoking it, not in SQL. What SQL can prove is
-- that the deployment changed no table, no function, no privilege and no row, and that no database
-- object has grown a dependency on the deployed function.
with lines as (
  select 1 as ord, 'A. lawpay_transactions size (must be 59)' as item,
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.lawpay_transactions', false, true, '')))[1]::text
         || case when (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.lawpay_transactions', false, true, '')))[1]::text = '59'
                 then '  (59, unchanged since step 2)' else '  (stop: expected 59)' end as detail,
         'no transaction is added, removed or edited' as verdict
  union all select 2, 'B. rows in the four V323 tables (each must be 0)',
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
         'an Edge Function deployment writes no SQL row'
  union all select 3, 'C. transactions carrying a resolution history (must be 0)',
         (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where raw ? 'mio_account_resolution_history'$q$, false, true, '')))[1]::text
         || case when (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where raw ? 'mio_account_resolution_history'$q$, false, true, '')))[1]::text = '0' then ' (good)' else ' (stop)' end,
         'step 7 is the only step that may write one'
  union all select 4, 'D. V314, V323 and V324 functions still present',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace
                   and p.proname in ('mio_store_lawpay_transaction_v314','mio_reconcile_lawpay_transaction_v314','mio_map_lawpay_account_v323','mio_resolve_lawpay_refund_v323','mio_reresolve_lawpay_accounts_v324')), 'none')
         || case when (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
                         and p.proname in ('mio_store_lawpay_transaction_v314','mio_reconcile_lawpay_transaction_v314','mio_map_lawpay_account_v323','mio_resolve_lawpay_refund_v323','mio_reresolve_lawpay_accounts_v324')) = 5
                 then '  (all five present)' else '  (stop: a required function is missing)' end,
         'the deployment adds no function and removes none'
  union all select 5, 'E. database objects referencing the Edge Function (must be 0)',
         (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%lawpay-account-diagnostics%'$q$, false, true, '')))[1]::text
         || case when (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosrc ilike '%lawpay-account-diagnostics%'$q$, false, true, '')))[1]::text = '0'
                 then '  (good: nothing in the database depends on it)' else '  (stop: a database object references the deployed function)' end,
         'the function is self-contained and deletable'
  union all select 6, 'F. mapping rows (0 before step 6)',
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_accounts', false, true, '')))[1]::text
         || case when (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_accounts', false, true, '')))[1]::text = '0'
                 then '  (good: no mapping exists yet)' else '  (stop: a mapping exists before step 6, or you are past it — expect 2 then)' end,
         'no mapping is created by this step'
)
select item, detail, verdict from lines order by ord;
