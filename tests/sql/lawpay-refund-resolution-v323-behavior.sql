-- LawPay refund resolution behaviour (V323, fifth increment) on an isolated synthetic database.
--
-- This suite is self-contained. It creates its own provider transactions with IDs that appear
-- nowhere else ('refund-suite-*'), and every assertion counts only rows whose identifiers begin
-- with that prefix, so it neither depends on nor perturbs the state the other suites leave behind.
\set ON_ERROR_STOP on

do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

insert into public.lawpay_transactions(gateway_transaction_id,transaction_type,status,account_id,account_key,amount_cents,amount_refunded_cents,currency,occurred_at,reference,payer_name,raw) values
  ('refund-suite-charge','CHARGE','COMPLETED','refund-suite-acct','refund_suite_trust',500000,10000,'USD','2026-08-01T10:00:00Z','refund-suite-ref','Refund Suite Payer','{}'),
  ('refund-suite-refund-one','REFUND','COMPLETED','refund-suite-acct','refund_suite_trust',10000,0,'USD','2026-08-02T10:00:00Z','refund-suite-ref-1','Refund Suite Payer','{}'),
  ('refund-suite-refund-two','REFUND','COMPLETED','refund-suite-acct','refund_suite_trust',10000,0,'USD','2026-08-03T10:00:00Z','refund-suite-ref-2','Refund Suite Payer','{}'),
  ('refund-suite-voided','REFUND','VOID','refund-suite-acct','refund_suite_trust',10000,0,'USD','2026-08-04T10:00:00Z','refund-suite-ref-3','Refund Suite Payer','{}')
on conflict (gateway_transaction_id) do nothing;

do $$
declare
  v_first jsonb;
  v_again jsonb;
  v_corrected jsonb;
  v_mine constant text[] := array['refund-suite-charge','refund-suite-refund-one','refund-suite-refund-two'];
  v_count integer;
  v_effect bigint;
begin
  -- The charge is recorded first, so a separate refund has a posting to belong to.
  perform public.mio_post_lawpay_classification_v323(jsonb_build_object(
    'gateway_transaction_id','refund-suite-charge','ownership','matter','matter_id','refund-suite-matter',
    'actual_account_key','trust','account_source','reported_by_lawpay','category','trust_deposit'),'ben@firm');

  -- Nothing has been decided about the two unlinked refunds yet, so neither has an effect.
  select count(*) into v_count from public.mio_lawpay_refund_resolutions where refund_transaction_id like 'refund-suite-%';
  if v_count <> 0 then raise exception 'this suite must start with no decisions of its own, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries where identity like 'refund-suite-%';
  if v_count <> 1 then raise exception 'only the charge posting may exist to start with, found %', v_count; end if;

  -- "Same refund already reflected on this charge": a stored decision with its evidence and author,
  -- and no money of its own.
  v_first := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','refund-suite-refund-one','charge_transaction_id','refund-suite-charge','resolution','same_refund',
    'evidence_reference','refund suite reference 90210 appears on the charge and the refund'),'ben@firm');
  if v_first->>'status' <> 'resolved' then raise exception 'expected resolved, got %', v_first->>'status'; end if;
  if (v_first->>'ledger_effect_cents')::bigint <> 0 then raise exception 'a same-refund decision must not move money, got %', v_first->>'ledger_effect_cents'; end if;
  if v_first->>'superseded_resolution_id' is not null then raise exception 'the first decision supersedes nothing'; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries
    where identity like 'refund-suite-%' and entry_kind in ('refund_effect','refund_reversal');
  if v_count <> 0 then raise exception 'a same-refund decision must create no refund entry, found %', v_count; end if;

  -- Retrying it changes nothing at all.
  v_again := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','refund-suite-refund-one','charge_transaction_id','refund-suite-charge','resolution','same_refund',
    'evidence_reference','refund suite reference 90210 appears on the charge and the refund'),'ben@firm');
  if v_again->>'status' <> 'unchanged' then raise exception 'a repeated decision must be unchanged, got %', v_again->>'status'; end if;
  select count(*) into v_count from public.mio_lawpay_refund_resolutions where refund_transaction_id like 'refund-suite-%';
  if v_count <> 1 then raise exception 'a repeated decision must not add a record, found %', v_count; end if;

  -- "Separate refund" on the second, equal, unlinked refund: its own effect, exactly once, while the
  -- charge keeps its own reported refunded total.
  v_corrected := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','refund-suite-refund-two','charge_transaction_id','refund-suite-charge','resolution','separate_refund',
    'evidence_reference','provider report lists 100.00 as a second, separate refund'),'jo@firm');
  if v_corrected->>'status' <> 'resolved' then raise exception 'expected resolved, got %', v_corrected->>'status'; end if;
  if (v_corrected->>'ledger_effect_cents')::bigint <> -10000 then raise exception 'a separate refund must move its own amount once, got %', v_corrected->>'ledger_effect_cents'; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries
    where identity = 'refund-suite-refund-two' and entry_kind = 'refund_effect';
  if v_count <> 1 then raise exception 'a separate refund must create exactly one effect, found %', v_count; end if;
  select coalesce(sum(case when direction = 'out' then -amount_cents else amount_cents end),0) into v_effect
    from public.mio_lawpay_ledger_entries where identity = any(v_mine);
  if v_effect <> 490000 then raise exception 'charge 5000.00 less its reported 100.00 less the separate 100.00 must be 4800.00, got %', v_effect; end if;
  -- Correcting that decision into "same refund": the earlier effect is reversed once and linked,
  -- the new decision links to the one it supersedes, and the earlier record is preserved.
  v_again := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','refund-suite-refund-two','charge_transaction_id','refund-suite-charge','resolution','same_refund',
    'evidence_reference','refund suite reference 90210 covers both the charge and this refund'),'ben@firm');
  if v_again->>'status' <> 'resolved' then raise exception 'expected resolved, got %', v_again->>'status'; end if;
  if v_again->>'superseded_resolution_id' is null then raise exception 'the correction must link to the decision it supersedes'; end if;
  if (v_again->>'ledger_effect_cents')::bigint <> 0 then raise exception 'a same-refund decision adds no effect of its own'; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries
    where identity = 'refund-suite-refund-two' and entry_kind = 'refund_reversal';
  if v_count <> 1 then raise exception 'the previous effect must be reversed exactly once, found %', v_count; end if;
  select coalesce(sum(case when direction = 'out' then -amount_cents else amount_cents end),0) into v_effect
    from public.mio_lawpay_ledger_entries where identity = any(v_mine);
  if v_effect <> 500000 then raise exception 'once both refunds are reflected on the charge, only the charge remains: expected 5000.00, got %', v_effect; end if;
  select count(*) into v_count from public.mio_lawpay_refund_resolutions
    where refund_transaction_id = 'refund-suite-refund-two' and superseded_at is null;
  if v_count <> 1 then raise exception 'exactly one decision may be active, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_refund_resolutions where refund_transaction_id = 'refund-suite-refund-two';
  if v_count <> 2 then raise exception 'the superseded decision must be preserved, found % records', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_refund_resolutions
    where refund_transaction_id = 'refund-suite-refund-two' and superseded_at is not null and corrects_resolution_id is null;
  if v_count <> 0 then raise exception 'a superseded decision must be linked from the decision that replaced it'; end if;

  -- Retrying the correction is a no-op: no second reversal, no second effect.
  v_first := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','refund-suite-refund-two','charge_transaction_id','refund-suite-charge','resolution','same_refund',
    'evidence_reference','refund suite reference 90210 covers both the charge and this refund'),'ben@firm');
  if v_first->>'status' <> 'unchanged' then raise exception 'a retried correction must be unchanged, got %', v_first->>'status'; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries where identity = 'refund-suite-refund-two';
  if v_count <> 2 then raise exception 'a retry must leave exactly the effect and its reversal, found %', v_count; end if;

  -- A voided refund and any other transaction outside this suite are untouched by what it does.
  select count(*) into v_count from public.mio_lawpay_refund_resolutions where refund_transaction_id = 'refund-suite-voided';
  if v_count <> 0 then raise exception 'a voided refund must not need a decision'; end if;

  -- Resolutions without evidence, or without an author, are refused.
  begin
    perform public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
      'refund_transaction_id','refund-suite-refund-one','resolution','separate_refund','evidence_reference',''),'ben@firm');
    raise exception 'a resolution without evidence must be refused';
  exception when others then
    if position('Record what establishes the relationship' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
      'refund_transaction_id','refund-suite-refund-one','resolution','separate_refund','evidence_reference','refund suite report line 2'),'');
    raise exception 'a resolution without an author must be refused';
  exception when others then
    if position('could not tell who resolved' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
      'refund_transaction_id','refund-suite-absent','resolution','separate_refund','evidence_reference','refund suite report line 3'),'ben@firm');
    raise exception 'a refund that is not stored must be refused';
  exception when others then
    if position('not stored in Mio' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
      'refund_transaction_id','refund-suite-refund-one','resolution','something_else','evidence_reference','refund suite report line 4'),'ben@firm');
    raise exception 'an unknown resolution must be refused';
  exception when others then
    if position('already reflected on the charge or is a separate refund' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

select 'V323 refund resolution behaviour passed' as result;

