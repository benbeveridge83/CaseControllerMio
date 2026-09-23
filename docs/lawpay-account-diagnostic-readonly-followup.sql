-- Follow-up to docs/lawpay-account-diagnostic-readonly.sql, READ-ONLY. Paste on its own
-- (the SQL Editor shows only the last statement's result, so run one file at a time).
--
-- Question it answers: for each masked provider account identifier, which Mio account did the money
-- actually reach, and how do we know? The rows Mio created from a payment link already carry the
-- Mio account key, so the payment-link rows name the account for the identifier that produced them.
-- That is the evidence a trust/operating mapping is proposed from — never a guess from the payer,
-- the amount, a matter or an invoice.
--
-- Only SELECT statements and read-only CTEs. No insert, update, delete, truncate, drop, alter,
-- create, grant, revoke, do block, temporary function or rpc call. Masked identifiers and counts
-- only: no full IDs, no payer or client names, no emails, no references, no amounts, no payloads.

with f as (
  select
    nullif(coalesce(j->>'account_id',''),'')         as account_id,
    coalesce(j->>'account_key','')                   as account_key,
    coalesce(j->>'transaction_type','')              as tx_type,
    coalesce(j->>'status','')                        as tx_status,
    coalesce(j->'raw'->>'mio_account_key_source','') as raw_source,
    coalesce(j->'raw'->>'mio_payment_request_id','') as raw_request_id,
    left(coalesce(j->>'occurred_at',''), 7)          as occurred_month
  from (select to_jsonb(x) as j from public.lawpay_transactions x) t
),
lines as (
  select 1 as ord, 'masked provider account' as masked_provider_account, 'stored Mio account' as stored_mio_account,
         'provenance' as provenance, 'transactions' as transactions, 'from payment links' as from_payment_links,
         'refunds/reversals' as refunds, 'completed-like' as completed_like, 'months  first..last' as span
  union all
  select 2,
         case when account_id is null then '(none supplied)'
              when length(account_id) <= 4 then '.....'
              else '.....' || right(account_id, 4) end,
         case when account_key = '' then '(none stored)' else account_key end,
         coalesce(nullif(raw_source,''),'not_recorded'),
         count(*)::text,
         count(*) filter (where raw_request_id <> '')::text,
         count(*) filter (where tx_type in ('REFUND','REVERSAL','CHARGEBACK'))::text,
         count(*) filter (where tx_status in ('COMPLETED','COMPLETE','SETTLED','SUCCEEDED','SUCCESS','PAID','REFUNDED'))::text,
         coalesce(min(occurred_month),'(none)') || ' .. ' || coalesce(max(occurred_month),'(none)')
  from f
  group by 2,3,4
)
select masked_provider_account, stored_mio_account, provenance, transactions, from_payment_links,
       refunds, completed_like, span
from lines
order by ord, transactions desc;
