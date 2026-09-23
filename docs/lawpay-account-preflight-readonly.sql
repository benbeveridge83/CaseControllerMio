-- Pre-flight for the V324 mapping rollout, READ-ONLY.
-- Paste into: Supabase Dashboard -> the project whose URL is https://vnnkxqpyndndidnjbrbywz.supabase.co
--              -> SQL Editor -> New query.
--
-- Answers three questions and nothing else:
--   1. does any stored provider account identifier carry surrounding whitespace? (the mapping path
--      trims the identifier while the resolution path never rewrites it, so whitespace would break
--      a mapping lookup)
--   2. which V323/V324 objects already exist in this production database?
--   3. is the mapping table present, and does it already hold rows?
--
-- Only SELECT statements, read-only CTEs and catalog reads (to_regclass, pg_proc,
-- information_schema). It contains no insert, update, delete, truncate, drop, alter, create, grant,
-- revoke, do block, temporary function or rpc call, and it touches no table that does not exist.
-- Masked/counts only: no full identifiers, no names, no emails, no references, no payloads.

with ids as (
  select nullif(coalesce(j->>'account_id',''),'') as account_id
  from (select to_jsonb(x) as j from public.lawpay_transactions x) t
),
lines as (
  select 1 as ord, 'A. whitespace preflight' as section,
         'transactions with a supplied identifier' as item, count(*) filter (where account_id is not null)::text as detail from ids
  union all select 2, 'A. whitespace preflight',
         'identifiers that differ from their trimmed form',
         count(*) filter (where account_id is not null and account_id <> btrim(account_id))::text from ids
  union all select 3, 'A. whitespace preflight', 'identifiers with leading whitespace',
         count(*) filter (where account_id is not null and account_id like ' %')::text from ids
  union all select 4, 'A. whitespace preflight', 'identifiers with trailing whitespace',
         count(*) filter (where account_id is not null and account_id like '% ')::text from ids
  union all select 5, 'A. whitespace preflight', 'verdict',
         case when (select count(*) from ids where account_id is not null and account_id <> btrim(account_id)) = 0
              then 'SAFE: no identifier needs trimming, a mapped lookup can match exactly'
              else 'STOP: identifiers carry whitespace, align the mapping path before creating any mapping' end
  union all select 10, 'B. objects already in production', 'table public.mio_lawpay_accounts (the mapping table)',
         case when to_regclass('public.mio_lawpay_accounts') is null then 'ABSENT' else 'present' end
  union all select 11, 'B. objects already in production', 'table public.mio_lawpay_classifications',
         case when to_regclass('public.mio_lawpay_classifications') is null then 'ABSENT' else 'present' end
  union all select 12, 'B. objects already in production', 'table public.mio_lawpay_ledger_entries',
         case when to_regclass('public.mio_lawpay_ledger_entries') is null then 'ABSENT' else 'present' end
  union all select 13, 'B. objects already in production', 'table public.mio_lawpay_refund_resolutions',
         case when to_regclass('public.mio_lawpay_refund_resolutions') is null then 'ABSENT' else 'present' end
  union all select 14, 'B. objects already in production', 'function public.mio_map_lawpay_account_v323',
         coalesce((select 'present (' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'mio_map_lawpay_account_v323' limit 1), 'ABSENT')
  union all select 15, 'B. objects already in production', 'function public.mio_reresolve_lawpay_accounts_v324',
         coalesce((select 'present (' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p
                   join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324' limit 1), 'ABSENT')
  union all select 16, 'B. objects already in production', 'every public function whose name contains lawpay',
         coalesce((select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', '; ' order by p.proname)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname like '%lawpay%'), 'none')
  union all select 17, 'B. objects already in production', 'columns of public.mio_lawpay_accounts',
         coalesce((select string_agg(c.column_name, ', ' order by c.ordinal_position)
                   from information_schema.columns c
                   where c.table_schema = 'public' and c.table_name = 'mio_lawpay_accounts'), 'ABSENT')
)
select section, item, detail from lines order by ord;

-- C. Run this line on its own, and only if row 10 above said 'present', to see whether any mapping
--    already exists. It is read-only:
-- select count(*) as mapping_rows, count(*) filter (where is_active) as active_mapping_rows,
--        string_agg(distinct account_key, ', ' order by account_key) as account_keys from public.mio_lawpay_accounts;
