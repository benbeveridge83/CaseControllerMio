do $$ begin
  assert (select count(*) = 1 from public.mio_weekly_trust_postings where idempotency_key='wk-concurrency-0001');
  assert (select amount_paid=100 and balance=0 and status='paid' from public.mio_invoices where invoice_number='MIO-WB-CONC');
  assert (select count(*) = 1 from public.mio_invoice_events where invoice_id='cccccccc-0000-4000-8000-000000000004');
end $$;
select 'weekly billing atomic concurrency passed' as result;
