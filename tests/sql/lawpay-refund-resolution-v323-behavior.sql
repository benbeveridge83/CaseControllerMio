-- LawPay refund resolution behaviour (V323, fifth increment), on an isolated synthetic database.
--
-- The fixture already holds a charge that reports its own refunded total ('lawpay-refunded-charge',
-- 3,000.00 refunded) and a separate refund row in the same provider account
-- ('lawpay-refund-2', 250.00) with no immutable link between them. Nothing may be netted across
-- them on account of the shared account: the refund is unresolved until a finance administrator
-- resolves it, and then it either adds its own effect or adds none.
\set ON_ERROR_STOP on

do $$
declare
  v_first jsonb;
  v_again jsonb;
  v_corrected jsonb;
  v_entries integer;
  v_effect bigint;
begin
  -- The charge is recorded first, so a separate refund has a posting to belong to.
  perform public.mio_post_lawpay_classification_v323(jsonb_build_object(
    'gateway_transaction_id','lawpay-refunded-charge','ownership','matter','matter_id','matter-south',
    'actual_account_key','trust','account_source','reported_by_lawpay','category','trust_deposit'),'ben@firm');

  -- "Separate refund": its own money movement, exactly once, while the charge keeps its own
  -- reported refunded total.
  v_first := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','lawpay-refund-2','charge_transaction_id','','resolution','separate_refund',
    'evidence_reference','provider report lists this 250.00 refund separately from the charge'),'ben@firm');
  if v_first->>'status' <> 'resolved' then raise exception 'expected resolved, got %', v_first->>'status'; end if;
  if (v_first->>'ledger_effect_cents')::bigint <> -25000 then raise exception 'a separate refund must move its own amount once, got %', v_first->>'ledger_effect_cents'; end if;
  if v_first->>'superseded_resolution_id' is not null then raise exception 'the first decision supersedes nothing'; end if;
  select count(*) into v_entries from public.mio_lawpay_ledger_entries where identity = 'lawpay-refund-2' and entry_kind = 'refund_effect';
  if v_entries <> 1 then raise exception 'a separate refund must create exactly one ledger effect, found %', v_entries; end if;
  select coalesce(sum(case when direction = 'out' then -amount_cents else amount_cents end),0) into v_effect
    from public.mio_lawpay_ledger_entries where identity in ('lawpay-refunded-charge','lawpay-refund-2');
  if v_effect <> 275000 then raise exception 'charge 3000.00 less the separate 250.00 must be 2750.00, got %', v_effect; end if;

  -- Retrying the identical decision changes nothing and moves no money again.
  v_again := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','lawpay-refund-2','charge_transaction_id','','resolution','separate_refund',
    'evidence_reference','provider report lists this 250.00 refund separately from the charge'),'ben@firm');
  if v_again->>'status' <> 'unchanged' then raise exception 'a repeated decision must be unchanged, got %', v_again->>'status'; end if;
  select count(*) into v_entries from public.mio_lawpay_ledger_entries where identity = 'lawpay-refund-2';
  if v_entries <> 1 then raise exception 'a retry must not add a ledger effect, found %', v_entries; end if;
  select count(*) into v_entries from public.mio_lawpay_refund_resolutions where refund_transaction_id = 'lawpay-refund-2';
  if v_entries <> 1 then raise exception 'a repeated decision must not add a record, found %', v_entries; end if;
  -- Correcting it to "same refund": the earlier effect is reversed once, linked, and the new
  -- decision links to the decision it supersedes.
  v_corrected := public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
    'refund_transaction_id','lawpay-refund-2','charge_transaction_id','lawpay-refunded-charge','resolution','same_refund',
    'evidence_reference','provider reference 90210 appears on both the charge and the refund'),'jo@firm');
  if v_corrected->>'status' <> 'resolved' then raise exception 'expected resolved, got %', v_corrected->>'status'; end if;
  if v_corrected->>'superseded_resolution_id' is null then raise exception 'the correction must link to the decision it supersedes'; end if;
  if (v_corrected->>'ledger_effect_cents')::bigint <> 0 then raise exception 'a same-refund decision adds no effect of its own'; end if;
  select count(*) into v_entries from public.mio_lawpay_ledger_entries where identity = 'lawpay-refund-2' and entry_kind = 'refund_reversal';
  if v_entries <> 1 then raise exception 'the previous effect must be reversed exactly once, found %', v_entries; end if;
  select coalesce(sum(case when direction = 'out' then -amount_cents else amount_cents end),0) into v_effect
    from public.mio_lawpay_ledger_entries where identity in ('lawpay-refunded-charge','lawpay-refund-2');
  if v_effect <> 300000 then raise exception 'once the refund is the same money, only the charge remains: expected 3000.00, got %', v_effect; end if;
  select count(*) into v_entries from public.mio_lawpay_refund_resolutions where refund_transaction_id = 'lawpay-refund-2' and superseded_at is null;
  if v_entries <> 1 then raise exception 'exactly one decision may be active, found %', v_entries; end if;
  select count(*) into v_entries from public.mio_lawpay_refund_resolutions where refund_transaction_id = 'lawpay-refund-2';
  if v_entries <> 2 then raise exception 'the earlier decision must be preserved, found % records', v_entries; end if;

  -- A resolution without evidence, or without an author, is refused.
  begin
    perform public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
      'refund_transaction_id','lawpay-refund-2','resolution','separate_refund','evidence_reference',''),'ben@firm');
    raise exception 'a resolution without evidence must be refused';
  exception when others then
    if position('Record what establishes the relationship' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.mio_resolve_lawpay_refund_v323(jsonb_build_object(
      'refund_transaction_id','lawpay-refund-2','resolution','separate_refund','evidence_reference','report line 2'),'');
    raise exception 'a resolution without an author must be refused';
  exception when others then
    if position('could not tell who resolved' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

select 'V323 refund resolution behaviour passed' as result;

