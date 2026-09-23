-- Step-6 verification, READ-ONLY. Run after creating the two mappings, before the optional step 7.
--
-- Verified by CI: this file is executed on the isolated PostgreSQL database by
-- .github/workflows/finance-review-v314.yml, after the V323 and V324 migrations, so it must parse and
-- run as well as being read-only.
--
-- Confirms: exactly two mapping rows exist, both active, with the expected masked identifiers and the
-- proposed Mio account keys; no transaction carries a resolution history yet, which is the proof that
-- creating a mapping wrote nothing to lawpay_transactions; the transaction count and the number of
-- rows already carrying a stored account key are unchanged; and the classification, ledger and refund
-- tables are still empty.
--
-- Only SELECTs, read-only CTEs and catalog reads. It writes nothing.

with lines as (
  select 1 as ord, 'A. mappings' as item, 'masked identifier / Mio account / active' as detail,
         coalesce((select string_agg('..... ' || right(a.provider_account_id, 4) || ' -> ' || a.account_key || '  active=' || a.is_active::text
                                     || case when a.is_active then '' else ' (stop)' end, ' | ' order by a.provider_account_id)
                   from public.mio_lawpay_accounts a), 'no mapping rows (stop)') as verdict
  union all select 2, 'A. mappings', 'count, and the two expected masked identifiers',
         (select count(*)::text || ' row(s); masked ids: ' || coalesce(string_agg('.....' || right(a.provider_account_id, 4), ', ' order by a.provider_account_id), 'none') from public.mio_lawpay_accounts a)
         || case when (select count(*) from public.mio_lawpay_accounts) = 2
                  and (select count(*) from public.mio_lawpay_accounts where right(provider_account_id, 4) in ('PvRA', 'B88Q')) = 2
                  and (select count(*) from public.mio_lawpay_accounts where is_active) = 2
                 then '  (as proposed)' else '  (stop: expected exactly two active mappings, for .....PvRA and .....B88Q)' end
  union all select 3, 'B. no writes to transactions', 'rows carrying a resolution history',
         (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where raw ? 'mio_account_resolution_history'$q$, false, true, '')))[1]::text
         || case when (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where raw ? 'mio_account_resolution_history'$q$, false, true, '')))[1]::text = '0'
                 then '  (good: the mapping wrote nothing)' else '  (stop: only step 7, on approval, may write one)' end
  union all select 4, 'B. no writes to transactions', 'lawpay_transactions size and stored-key rows',
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.lawpay_transactions', false, true, '')))[1]::text || ' transactions'
         || ', ' || (xpath('/row/c/text()', query_to_xml($q$select count(*) as c from public.lawpay_transactions where coalesce(account_key,'') <> ''$q$, false, true, '')))[1]::text || ' with a stored account key'
         || '  (both must equal the step-2 figures: 59 and 16 at the last check)'
  union all select 5, 'C. untouched tables', 'classifications / ledger entries / refund resolutions',
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_classifications', false, true, '')))[1]::text || ' / '
         || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_ledger_entries', false, true, '')))[1]::text || ' / '
         || (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.mio_lawpay_refund_resolutions', false, true, '')))[1]::text
         || '  (all three must be 0)'
)
select item, detail, verdict from lines order by ord;