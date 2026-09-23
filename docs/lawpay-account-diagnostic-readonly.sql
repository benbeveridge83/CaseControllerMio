-- LawPay deposit-account diagnostic (V324), READ-ONLY.
-- Paste into: Supabase Dashboard -> the project whose URL is https://vnnkxqpyndidnjbrbywz.supabase.co
--              -> SQL Editor -> New query.
--
-- Only SELECT statements, read-only CTEs and reads of catalog views. It contains no insert, update,
-- delete, truncate, drop, alter, create, grant, revoke, do block, temporary function or rpc call.
-- Every lawpay_transactions field is read through to_jsonb(), so a missing column cannot break it,
-- and nothing here depends on the undeployed V323/V324 migrations.
-- It returns masked identifiers and counts only: no full account or transaction IDs, no payer or
-- client names, no emails, no references, no payload contents, no card or bank information.
--
-- Sections: A = what actually exists in this database, B = one row per masked provider account
-- identifier, C = the individual unresolved records (masked), to identify specific payments.

with t as (
  select to_jsonb(x) as j from public.lawpay_transactions x
),
f as (
  select
    nullif(coalesce(j->>'account_id',''),'')         as account_id,
    coalesce(j->>'account_key','')                   as account_key,
    coalesce(j->>'gateway_event_id','')              as gateway_event_id,
    coalesce(j->>'gateway_transaction_id','')        as tx_id,
    left(coalesce(j->>'occurred_at',''), 7)          as occurred_month,
    jsonb_typeof(j->'raw'->'account_id')             as raw_type,
    coalesce(j->'raw'->>'mio_account_key_source','') as raw_source,
    coalesce(j->'raw'->>'mio_payment_request_id','') as raw_request_id,
    coalesce(j->>'transaction_type','')              as tx_type,
    coalesce(j->>'status','')                        as tx_status
  from t
),
m as (
  select f.*,
    case when account_id is null then '(none supplied)'
         when length(account_id) <= 4 then '.....'
         else '.....' || right(account_id, 4) end    as masked_account,
    case when tx_id = '' then '(unknown)'
         when length(tx_id) <= 4 then '.....'
         else '.....' || right(tx_id, 4) end         as masked_tx
  from f
),
by_account as (
  select masked_account,
         count(*)                                                                   as transactions,
         (account_id is not null)                                                   as supplied,
         coalesce(string_agg(distinct coalesce(raw_type,'absent'), '/'), 'absent')   as raw_types,
         count(*) filter (where account_key <> '')                                  as with_stored_account_key,
         count(*) filter (where raw_request_id <> '')                               as with_payment_request_fallback,
         coalesce(string_agg(distinct coalesce(nullif(raw_source,''),'not_recorded'), '/'), 'not_recorded') as provenance,
         case when count(*) filter (where gateway_event_id <> '') > 0
              then 'webhook_event_present' else 'no_webhook_event' end             as ingest_evidence
  from m
  group by masked_account, (account_id is not null)
),
lines as (
  select 1 as ord, 'A. schema check' as section, 'lawpay_transactions' as line,
         case when to_regclass('public.lawpay_transactions') is null then 'MISSING' else 'present' end as detail
  union all select 2, 'A. schema check', 'lawpay_events (webhook history)',
         case when to_regclass('public.lawpay_events') is null then 'MISSING' else 'present' end
  union all select 3, 'A. schema check', 'lawpay_payment_requests (Mio links)',
         case when to_regclass('public.lawpay_payment_requests') is null then 'MISSING' else 'present' end
  union all select 4, 'A. schema check', 'column lawpay_transactions.account_id',
         coalesce((select 'present' from information_schema.columns c where c.table_schema='public' and c.table_name='lawpay_transactions' and c.column_name='account_id'),'MISSING')
  union all select 5, 'A. schema check', 'column lawpay_transactions.raw',
         coalesce((select 'present' from information_schema.columns c where c.table_schema='public' and c.table_name='lawpay_transactions' and c.column_name='raw'),'MISSING')
  union all select 6, 'A. schema check', 'transactions reviewed',
         (select count(*)::text from f)
  union all select 7, 'A. schema check', 'identifier supplied (any form)',
         (select count(*)::text from f where account_id is not null)
  union all select 8, 'A. schema check', 'identifier absent',
         (select count(*)::text from f where account_id is null)
  union all select 9, 'A. schema check', 'identifier type as stored (string/number/absent)',
         coalesce((select string_agg(x.t || '=' || x.n::text, ', ' order by x.t)
                   from (select coalesce(raw_type,'absent') t, count(*) n from f group by 1) x), 'no rows')
  union all select 10, 'A. schema check', 'payment-request fallback present',
         (select count(*)::text from f where raw_request_id <> '')
  union all select 11, 'A. schema check', 'stored account_key present',
         (select count(*)::text from f where account_key <> '')
  union all select 12, 'A. schema check', 'provenance (raw.mio_account_key_source)',
         coalesce((select string_agg(x.t || '=' || x.n::text, ', ' order by x.t)
                   from (select coalesce(nullif(raw_source,''),'not_recorded') t, count(*) n from f group by 1) x), 'no rows')
  union all select 100 + row_number() over (order by masked_account, supplied), 'B. by masked provider account',
         masked_account || '   [' || transactions::text || ' transaction(s)]',
         'supplied=' || supplied::text || ' | raw type=' || raw_types
         || ' | stored account_key rows=' || with_stored_account_key::text
         || ' | payment-request fallback rows=' || with_payment_request_fallback::text
         || ' | provenance=' || provenance || ' | ingest=' || ingest_evidence
  from by_account
  union all select 500 + row_number() over (order by masked_tx), 'C. records with no stored account (masked)',
         masked_tx || '   ' || coalesce(occurred_month, '(no date)'),
         'account=' || masked_account || ' | supplied=' || (account_id is not null)::text
         || ' | raw type=' || coalesce(raw_type,'absent')
         || ' | provenance=' || coalesce(nullif(raw_source,''), case when account_key <> '' then 'stored_account_key' else 'not_recorded' end)
         || ' | ingest=' || (case when raw_request_id <> '' then 'payment_request_fallback'
                                 when gateway_event_id <> '' then 'webhook_event'
                                 else 'scan_or_unknown' end)
         || ' | provider type=' || tx_type || ' | status=' || tx_status
  from m
  where account_key = ''
)
select section, line, detail from lines order by ord;
