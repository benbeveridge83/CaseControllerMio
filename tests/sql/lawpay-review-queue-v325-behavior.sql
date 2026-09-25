-- V325: an operating consultation can be recorded without inventing a PNC workflow association.
-- The fixture is rolled back, so the verification queries that follow still see their clean state.
\set ON_ERROR_STOP on
begin;

insert into public.lawpay_transactions(
  gateway_transaction_id,transaction_type,status,account_id,account_key,amount_cents,
  amount_refunded_cents,currency,occurred_at,reference,payer_name,payment_method_type,last_four,raw
) values (
  'v325-suite-pnc-optional','CHARGE','COMPLETED','v325-suite-operating','operating',12500,
  0,'USD','2026-09-25T10:00:00Z','v325-suite-reference','V325 Consultation','card','4242','{}'
);

do $$
declare
  result jsonb;
  retry jsonb;
  transaction_before text;
  transaction_after text;
begin
  select md5(concat_ws('|',amount_cents,amount_refunded_cents,status,reference,payer_name,currency,transaction_type,occurred_at::text))
    into transaction_before from public.lawpay_transactions where gateway_transaction_id='v325-suite-pnc-optional';

  result := public.mio_post_lawpay_classification_v323(jsonb_build_object(
    'gateway_transaction_id','v325-suite-pnc-optional',
    'ownership','pnc',
    'pnc_workflow_id','',
    'actual_account_key','operating',
    'account_source','reported_by_lawpay',
    'category','consultation_payment'
  ),'v325-suite@firm.invalid');

  if result->>'status' <> 'posted' then raise exception 'an optional-PNC consultation must post, got %',result; end if;
  if (select count(*) from public.mio_lawpay_classifications where identity='v325-suite-pnc-optional' and ownership='pnc' and pnc_workflow_id='' and category='consultation_payment' and posting_status='posted') <> 1 then
    raise exception 'the consultation must be recorded once with an optional blank PNC association';
  end if;
  if exists(select 1 from public.mio_lawpay_ledger_entries where identity='v325-suite-pnc-optional') then
    raise exception 'an operating consultation must not move a matter trust balance';
  end if;
  if exists(select 1 from public.mio_invoice_events where provider_event_id='v325-suite-pnc-optional') then
    raise exception 'a consultation with no selected invoice must not apply itself to an invoice';
  end if;

  retry := public.mio_post_lawpay_classification_v323(jsonb_build_object(
    'gateway_transaction_id','v325-suite-pnc-optional','ownership','pnc',
    'actual_account_key','operating','account_source','reported_by_lawpay','category','consultation_payment'
  ),'v325-suite@firm.invalid');
  if retry->>'status' <> 'already_posted' then raise exception 'a retry must be refused as already posted, got %',retry; end if;
  if (select count(*) from public.mio_lawpay_classifications where identity='v325-suite-pnc-optional' and posting_status='posted') <> 1 then
    raise exception 'a retry must not create a second posted classification';
  end if;

  select md5(concat_ws('|',amount_cents,amount_refunded_cents,status,reference,payer_name,currency,transaction_type,occurred_at::text))
    into transaction_after from public.lawpay_transactions where gateway_transaction_id='v325-suite-pnc-optional';
  if transaction_after <> transaction_before then raise exception 'classification must not change the stored provider money or identity fields'; end if;
end $$;

rollback;
select 'V325 optional PNC association: posted once, no trust or invoice effect, provider row unchanged' as result;
