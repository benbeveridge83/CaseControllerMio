do $$ begin
 assert (select amount_paid=200 and balance=0 from mio_invoices where invoice_number='MIO-2026-900002'),'concurrent invoice total';
 assert (select (raw->>'received_amount_cents')::bigint=20000 from lawpay_payment_requests where invoice_number='MIO-2026-900002'),'concurrent request total';
 assert (select count(*)=2 from mio_invoice_events where invoice_id='10000000-0000-4000-8000-000000000002'),'no duplicate payment events';
end $$;
select 'concurrent distinct payments and duplicate replay passed' as result;
