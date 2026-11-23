-- Same-matter payments may post while the separate cross-matter switch is off.
\set ON_ERROR_STOP on

update public.case_mio_user_state set json_value=json_value ||
  '{"enableAtomicWeeklyTrustPosting":false}'::jsonb
where key='mioWeeklyBillingSettingsV1';

do $$ begin
  assert has_function_privilege('authenticated',
    'public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz)','execute');
  assert not has_function_privilege('anon',
    'public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz)','execute');
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-v3-cross-blocked','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000004',
      1000,'2026-11-21T00:00:00+00');
    raise exception 'expected cross-matter gate refusal';
  exception when others then
    if sqlerrm not like '%Cross-matter atomic posting is not enabled%' then raise; end if;
  end;
end $$;

insert into public.mio_invoices
  (id,user_id,invoice_number,invoice_type,matter_id,client_id,status,total,amount_paid,balance,updated_at)
values ('cccccccc-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000aa',
  'MIO-WB-V3-SAME','services','bbbbbbbb-0000-4000-8000-000000000005',
  'aaaaaaaa-0000-4000-8000-000000000001','outstanding',25,0,25,
  '2026-11-21T00:00:00+00');

do $$ declare result jsonb; begin
  result:=public.mio_post_weekly_trust_payment_v1(
    'wk-v3-same-0001','bbbbbbbb-0000-4000-8000-000000000005',
    'bbbbbbbb-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000010',
    2500,'2026-11-21T00:00:00+00');
  assert result->>'status'='ledger_posted',result::text;
  assert (select status='paid' and balance=0 and amount_paid=25 from public.mio_invoices
    where id='cccccccc-0000-4000-8000-000000000010');
  assert (select count(*)=1 from public.mio_weekly_trust_postings
    where idempotency_key='wk-v3-same-0001');
  assert (select count(*)=1 from public.mio_invoice_events
    where invoice_id='cccccccc-0000-4000-8000-000000000010' and event_type='trust_applied');
  assert (select count(*)=1 from public.case_mio_user_state,
    jsonb_array_elements(json_value) x where key='caseMioTrustTransactions'
    and x->>'idempotency_key'='weekly-billing:wk-v3-same-0001');
  result:=public.mio_post_weekly_trust_payment_v1(
    'wk-v3-same-0001','bbbbbbbb-0000-4000-8000-000000000005',
    'bbbbbbbb-0000-4000-8000-000000000005','cccccccc-0000-4000-8000-000000000010',
    2500,'2026-11-21T00:00:00+00');
  assert result->>'status'='already_posted',result::text;
  assert (select count(*)=1 from public.mio_weekly_trust_postings
    where idempotency_key='wk-v3-same-0001');
end $$;
