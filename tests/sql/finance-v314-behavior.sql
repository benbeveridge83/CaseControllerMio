-- Run only on the isolated fixture created by finance-v314-schema.sql.
do $$ declare result jsonb; begin
  result:=public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-a',1,101250));
  assert result->>'status'='posted',result::text;
  assert (select amount_paid=2562.50 and balance=0 and status='paid' from mio_invoices where invoice_number='MIO-2026-900001');
  result:=public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-a',1,101250));
  assert (result->>'change_amount')::numeric=0,'replay must not double count';
  assert (select count(*)=1 from mio_invoice_events where provider_event_id='synthetic-a');
  assert (select (raw->>'received_amount_cents')::bigint=101250 from lawpay_payment_requests where invoice_number='MIO-2026-900001');
  result:=public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-a',1,101250,'2026-09-09T14:00:00Z','AUTHORIZED'));
  assert result->>'status'='stale_ignored';
  assert (select status='COMPLETED' from lawpay_transactions where gateway_transaction_id='synthetic-a');
  -- A refunded charge changes only the LawPay component; prior trust remains.
  result:=public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-a',1,101250,'2026-09-10T16:00:00Z','COMPLETED',1250));
  assert (select amount_paid=2550 and balance=12.50 from mio_invoices where invoice_number='MIO-2026-900001');
  assert (select amount=1000 from mio_invoice_events where provider_event_id='synthetic-a');
  perform public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-a',1,101250,'2026-09-10T16:00:00Z','COMPLETED',1250));
  assert (select amount_paid=2550 from mio_invoices where invoice_number='MIO-2026-900001');
  result:=public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-pending',3,5000,'2026-09-09T16:00:00Z','AUTHORIZED'));
  assert result->>'status'='pending_or_unsuccessful';
  assert (select amount_paid=0 from mio_invoices where invoice_number='MIO-2026-900003');
  perform public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-pending',3,5000,'2026-09-10T16:00:00Z'));
  assert (select amount_paid=50 from mio_invoices where invoice_number='MIO-2026-900003');
  result:=public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-overpayment',3,10000,'2026-09-11T16:00:00Z'));
  assert result->>'status'='review';
  assert (select amount_paid=50 from mio_invoices where invoice_number='MIO-2026-900003');
  assert not has_function_privilege('authenticated','public.mio_store_lawpay_transaction_v314(jsonb)','execute');
  assert not has_function_privilege('anon','public.mio_store_lawpay_transaction_v314(jsonb)','execute');
  assert has_function_privilege('service_role','public.mio_store_lawpay_transaction_v314(jsonb)','execute');
end $$;
-- Force failure at the last write. Receipt, request and invoice must ALL roll back.
create function fail_fixture_event() returns trigger language plpgsql as $$ begin if new.provider_event_id='synthetic-failure' then raise exception 'fixture failure'; end if; return new; end $$;
create trigger fail_fixture_event before insert on mio_invoice_events for each row execute function fail_fixture_event();
do $$ begin
  begin
    perform public.mio_store_lawpay_transaction_v314(fixture_row('synthetic-failure',4,5000));
    raise exception 'expected injected failure';
  exception when others then
    if sqlerrm <> 'fixture failure' then raise; end if;
  end;
  assert not exists(select 1 from lawpay_transactions where gateway_transaction_id='synthetic-failure');
  assert (select amount_paid=0 and balance=50 from mio_invoices where invoice_number='MIO-2026-900004');
  assert (select status='created' and raw='{}'::jsonb from lawpay_payment_requests where invoice_number='MIO-2026-900004');
end $$;
select 'atomic replay, stale protection, pending, refund delta, overpayment, privileges and rollback passed' as result;
