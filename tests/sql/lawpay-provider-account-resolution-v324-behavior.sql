-- LawPay provider-account mapping and re-resolution behaviour (V324) on an isolated synthetic
-- database. Self-contained: every row it creates is prefixed 'v324-suite-', and every assertion
-- counts only rows with that prefix, so it neither depends on nor perturbs the other suites.
--
-- It asserts exactly the promises the rollout plan makes:
--   * the previous account classification and provenance are recorded before they are replaced;
--   * re-running changes nothing and does not grow the history;
--   * the documented restore works, using only that history;
--   * no money column changes and no classification, ledger entry or refund resolution is created;
--   * an unknown account key, and an empty provider identifier, are refused rather than stored;
--   * the mapping RPC accepts the payload shape the rollout will use, is idempotent, and
--     deactivating a mapping is a working rollback.
\set ON_ERROR_STOP on

do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- Two supplied identifiers (one with recorded provenance, one without), one identifier-less record,
-- one FAILED charge and one closed card record, so every condition in the diagnostics is represented.
insert into public.lawpay_transactions(gateway_transaction_id,transaction_type,status,account_id,account_key,amount_cents,amount_refunded_cents,currency,occurred_at,reference,payer_name,payment_method_type,last_four,raw) values
  ('v324-suite-a1','CHARGE','COMPLETED','v324-suite-acct-A','',100000,0,'USD','2026-09-01T10:00:00Z','v324-suite-r1','V324 Suite Payer','eCheck','4242','{"mio_account_key_source":"unresolved"}'),
  ('v324-suite-a2','CHARGE','COMPLETED','v324-suite-acct-A','',200000,0,'USD','2026-09-02T10:00:00Z','v324-suite-r2','V324 Suite Payer','card','1881','{}'),
  ('v324-suite-a3','REFUND','COMPLETED','v324-suite-acct-A','',50000,0,'USD','2026-09-03T10:00:00Z','v324-suite-r3','V324 Suite Payer','eCheck','4242','{"mio_account_key_source":"unresolved"}'),
  ('v324-suite-a4','CHARGE','FAILED','v324-suite-acct-A','',90000,0,'USD','2026-09-05T10:00:00Z','v324-suite-r4','V324 Suite Payer','eCheck','4242','{}'),
  ('v324-suite-b1','CHARGE','COMPLETED','v324-suite-acct-B','',70000,0,'USD','2026-09-04T10:00:00Z','v324-suite-r5','V324 Suite Payer','eCheck','4242','{}'),
  ('v324-suite-none','card','closed','','',1000,0,'USD','2021-07-01T10:00:00Z','v324-suite-r6','V324 Suite Payer','card','0000','{}')
on conflict (gateway_transaction_id) do nothing;

do $$
declare
  v_first jsonb;
  v_second jsonb;
  v_unknown jsonb;
  v_mapped jsonb;
  v_count integer;
  v_before text;
  v_after text;
  v_prefix constant text := 'v324-suite-%';
  v_actor constant text := 'suite@example.invalid';
begin
  select count(*) into v_count from public.lawpay_transactions where gateway_transaction_id like v_prefix;
  if v_count <> 6 then raise exception 'expected the six suite transactions, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_classifications where identity like '%v324-suite-%';
  if v_count <> 0 then raise exception 'the suite must start with no classification of its own, found %', v_count; end if;

  -- A total fingerprint of every column that must never change, over the suite rows only.
  select md5(string_agg(concat_ws('|', gateway_transaction_id, amount_cents, amount_refunded_cents, status, reference, payer_name, currency, last_four, payment_method_type, transaction_type, occurred_at::text), ',' order by gateway_transaction_id))
    into v_before
  from public.lawpay_transactions where gateway_transaction_id like v_prefix;

  -- Resolving one identifier changes its rows and nothing else.
  v_first := public.mio_reresolve_lawpay_accounts_v324('v324-suite-acct-A','trust',v_actor);
  if (v_first->>'ok')::boolean is not true then raise exception 'the re-resolution must succeed, got %', v_first; end if;
  if (v_first->>'updated')::integer <> 4 then raise exception 'expected four updated rows for this identifier, got %', v_first->>'updated'; end if;
  if (v_first->>'unchanged')::integer <> 0 then raise exception 'nothing should have been unchanged yet, got %', v_first->>'unchanged'; end if;
  if (v_first->>'posts_money')::boolean is not false then raise exception 'the function must state that it posts no money'; end if;

  select count(*) into v_count from public.lawpay_transactions
    where account_id = 'v324-suite-acct-A' and account_key = 'trust' and coalesce(raw->>'mio_account_key_source','') = 'configured_account';
  if v_count <> 4 then raise exception 'every row of that identifier must carry the mapped account, found %', v_count; end if;
  select count(*) into v_count from public.lawpay_transactions
    where gateway_transaction_id = 'v324-suite-none' and account_key = '' and raw ? 'mio_account_resolution_history';
  if v_count <> 0 then raise exception 'a record with no provider identifier must never be resolved'; end if;
  select count(*) into v_count from public.lawpay_transactions where account_id = 'v324-suite-acct-B' and account_key <> '';
  if v_count <> 0 then raise exception 'an unmapped identifier must stay unresolved'; end if;

  -- History: the previous values were recorded before they were replaced.
  select count(*) into v_count from public.lawpay_transactions
    where account_id = 'v324-suite-acct-A'
      and jsonb_typeof(raw->'mio_account_resolution_history') = 'array'
      and jsonb_array_length(raw->'mio_account_resolution_history') = 1
      and (raw->'mio_account_resolution_history')->0->>'to_account_key' = 'trust'
      and coalesce((raw->'mio_account_resolution_history')->0->>'from_account_key','') = ''
      and coalesce((raw->'mio_account_resolution_history')->0->>'actor','') = v_actor;
  if v_count <> 4 then raise exception 'each resolved row must record what it replaced, found %', v_count; end if;

  -- Re-running changes nothing and does not grow the history.
  v_second := public.mio_reresolve_lawpay_accounts_v324('v324-suite-acct-A','trust',v_actor);
  if (v_second->>'updated')::integer <> 0 then raise exception 'a second run must update nothing, got %', v_second->>'updated'; end if;
  if (v_second->>'unchanged')::integer <> 4 then raise exception 'a second run must report four unchanged rows, got %', v_second->>'unchanged'; end if;
  select count(*) into v_count from public.lawpay_transactions
    where account_id = 'v324-suite-acct-A' and jsonb_array_length(raw->'mio_account_resolution_history') <> 1;
  if v_count <> 0 then raise exception 'a second run must not grow the history, found % rows with a longer history', v_count; end if;

  -- The documented restore, using only the history the function recorded.
  update public.lawpay_transactions t
  set account_key = coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_account_key',''),
      raw = jsonb_set(
              jsonb_set(t.raw, '{mio_account_key_source}', to_jsonb(coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_source','')), true),
              '{mio_account_resolution_history}',
              (t.raw->'mio_account_resolution_history') - (jsonb_array_length(t.raw->'mio_account_resolution_history') - 1),
              true)
  where t.account_id = 'v324-suite-acct-A' and jsonb_array_length(coalesce(t.raw->'mio_account_resolution_history','[]'::jsonb)) > 0;
  select count(*) into v_count from public.lawpay_transactions
    where account_id = 'v324-suite-acct-A' and account_key = '' and jsonb_array_length(coalesce(raw->'mio_account_resolution_history','[]'::jsonb)) = 0;
  if v_count <> 4 then raise exception 'the restore must return every row to its previous account, found %', v_count; end if;

  -- And it can be applied again, which is what makes the pair safe to repeat.
  v_first := public.mio_reresolve_lawpay_accounts_v324('v324-suite-acct-A','trust',v_actor);
  if (v_first->>'updated')::integer <> 4 then raise exception 'the re-resolution must be repeatable after a restore, got %', v_first->>'updated'; end if;

  -- Nothing else moved: no money column, no classification, no ledger entry, no refund resolution.
  select md5(string_agg(concat_ws('|', gateway_transaction_id, amount_cents, amount_refunded_cents, status, reference, payer_name, currency, last_four, payment_method_type, transaction_type, occurred_at::text), ',' order by gateway_transaction_id))
    into v_after
  from public.lawpay_transactions where gateway_transaction_id like v_prefix;
  if v_after <> v_before then raise exception 're-resolution must not change any money column, status, reference or payer field'; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries where identity like '%v324-suite-%';
  if v_count <> 0 then raise exception 're-resolution must create no ledger entry, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_classifications where identity like '%v324-suite-%';
  if v_count <> 0 then raise exception 're-resolution must create no classification, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_refund_resolutions where refund_transaction_id like v_prefix;
  if v_count <> 0 then raise exception 're-resolution must create no refund resolution, found %', v_count; end if;

  -- Refusals: an unknown account key, an empty provider identifier, and an identifier nothing carries.
  v_unknown := public.mio_reresolve_lawpay_accounts_v324('v324-suite-acct-A','nonsense',v_actor);
  if (v_unknown->>'ok')::boolean is not false then raise exception 'an unknown Mio account key must be refused'; end if;
  v_unknown := public.mio_reresolve_lawpay_accounts_v324('','trust',v_actor);
  if (v_unknown->>'ok')::boolean is not false then raise exception 'an empty provider identifier must be refused'; end if;
  v_unknown := public.mio_reresolve_lawpay_accounts_v324('v324-suite-unknown','trust',v_actor);
  if (v_unknown->>'ok')::boolean is not true or (v_unknown->>'updated')::integer <> 0 then raise exception 'an identifier nothing carries must update nothing, got %', v_unknown; end if;

  -- The mapping the rollout will create: payload shape, idempotency, and its rollback.
  v_mapped := public.mio_map_lawpay_account_v323(jsonb_build_object('provider_account_id','v324-suite-acct-A','account_key','trust','bank_account_id','','bank_role','trust','label','LawPay trust settlement account','last4','Suite A','is_active',true), v_actor);
  if v_mapped->>'status' <> 'mapped' then raise exception 'the mapping RPC must accept the rollout payload shape, got %', v_mapped; end if;
  select count(*) into v_count from public.mio_lawpay_accounts where provider_account_id = 'v324-suite-acct-A' and account_key = 'trust' and is_active;
  if v_count <> 1 then raise exception 'expected exactly one active mapping, found %', v_count; end if;
  perform public.mio_map_lawpay_account_v323(jsonb_build_object('provider_account_id','v324-suite-acct-A','account_key','trust','is_active',true), v_actor);
  select count(*) into v_count from public.mio_lawpay_accounts where provider_account_id = 'v324-suite-acct-A';
  if v_count <> 1 then raise exception 're-mapping must upsert, never duplicate, found %', v_count; end if;
  perform public.mio_map_lawpay_account_v323(jsonb_build_object('provider_account_id','v324-suite-acct-A','account_key','trust','is_active',false), v_actor);
  select count(*) into v_count from public.mio_lawpay_accounts where provider_account_id = 'v324-suite-acct-A' and is_active;
  if v_count <> 0 then raise exception 'deactivating a mapping must stop it resolving, found % still active', v_count; end if;
  perform public.mio_map_lawpay_account_v323(jsonb_build_object('provider_account_id','v324-suite-acct-A','account_key','trust','is_active',true), v_actor);

  -- Privileges: service_role only, no PUBLIC, anon or authenticated grant.
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324'
      and (p.proacl is null
        or exists (select 1 from unnest(p.proacl) a where a::text like '=%' or a::text like 'anon=%' or a::text like 'authenticated=%'));
  if v_count <> 0 then raise exception 'the re-resolution function must hold no PUBLIC, anon or authenticated grant'; end if;
  select count(*) into v_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mio_reresolve_lawpay_accounts_v324'
      and exists (select 1 from unnest(p.proacl) a where a::text like 'service_role=%');
  if v_count <> 1 then raise exception 'service_role must hold execute on the re-resolution function'; end if;

  -- The FAILED and closed records keep their status; nothing here makes them postable.
  select count(*) into v_count from public.lawpay_transactions where gateway_transaction_id = 'v324-suite-a4' and status = 'FAILED';
  if v_count <> 1 then raise exception 'a FAILED charge must stay FAILED'; end if;
  select count(*) into v_count from public.lawpay_transactions where gateway_transaction_id = 'v324-suite-none' and status = 'closed' and account_key = '';
  if v_count <> 1 then raise exception 'a closed record must stay closed and unresolved'; end if;
end $$;

select 'V324 behaviour: history recorded, re-run and restore safe, no money moved, refusals enforced, mapping payload accepted' as result;


