-- Behavior for public.mio_post_weekly_trust_payment_v1 on the isolated fixture.
\set ON_ERROR_STOP on

-- 1. Feature gate disabled refuses posting and changes nothing.
do $$ begin
  update public.case_mio_user_state
     set json_value = json_value || '{"enableAtomicWeeklyTrustPosting": false}'::jsonb
   where user_id='00000000-0000-4000-8000-0000000000aa' and key='mioWeeklyBillingSettingsV1';
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-gate-0001','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
      50000,'2026-11-21T00:00:00+00');
    raise exception 'expected gate refusal';
  exception when others then
    if sqlerrm not like '%not enabled%' then raise; end if;
  end;
  assert (select count(*) = 0 from public.mio_weekly_trust_postings);
  update public.case_mio_user_state
     set json_value = json_value || '{"enableAtomicWeeklyTrustPosting": true}'::jsonb
   where user_id='00000000-0000-4000-8000-0000000000aa' and key='mioWeeklyBillingSettingsV1';
end $$;

-- 2. Different client identity is refused.
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-client-0001','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000004','cccccccc-0000-4000-8000-000000000003',
      30000,'2026-11-21T00:00:00+00');
    raise exception 'expected client refusal';
  exception when others then
    if sqlerrm not like '%same-client%' then raise; end if;
  end;
end $$;

-- 3. Insufficient reconciled trust is refused.
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-funds-0001','bbbbbbbb-0000-4000-8000-000000000003',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
      50000,'2026-11-21T00:00:00+00');
    raise exception 'expected funds refusal';
  exception when others then
    if sqlerrm not like '%insufficient%' then raise; end if;
  end;
end $$;

-- 4. Missing signed cross-matter agreement is refused.
do $$ begin
  update public.case_mio_user_state
     set json_value = jsonb_set(json_value, '{matters,bbbbbbbb-0000-4000-8000-000000000001,agreementAuthorized}', 'false'::jsonb)
   where user_id='00000000-0000-4000-8000-0000000000aa' and key='mioWeeklyBillingSettingsV1';
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-agree-0001','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
      50000,'2026-11-21T00:00:00+00');
    raise exception 'expected agreement refusal';
  exception when others then
    if sqlerrm not like '%agreement%' then raise; end if;
  end;
  update public.case_mio_user_state
     set json_value = jsonb_set(json_value, '{matters,bbbbbbbb-0000-4000-8000-000000000001,agreementAuthorized}', 'true'::jsonb)
   where user_id='00000000-0000-4000-8000-0000000000aa' and key='mioWeeklyBillingSettingsV1';
end $$;

-- 5. Stale invoice version (changed updated_at) is refused.
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-stale-0001','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
      50000,'2026-11-20T00:00:00+00');
    raise exception 'expected stale refusal';
  exception when others then
    if sqlerrm not like '%changed since%' then raise; end if;
  end;
end $$;

-- 6. Same-matter payment posts without any sharing/agreement requirement.
do $$ declare result jsonb; begin
  result := public.mio_post_weekly_trust_payment_v1(
    'wk-behavior-same-0001','bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',
    20000,'2026-11-21T00:00:00+00');
  assert result->>'status' = 'ledger_posted', result::text;
  assert (select amount_paid=200 and balance=0 and status='paid' from public.mio_invoices where invoice_number='MIO-WB-SRC');
  assert (select count(*) = 1 from public.mio_weekly_trust_postings where idempotency_key='wk-behavior-same-0001');
end $$;

-- 7. Cross-matter payment posts and records a durable ledger entry.
do $$ declare result jsonb; begin
  result := public.mio_post_weekly_trust_payment_v1(
    'wk-behavior-cross-0001','bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
    50000,'2026-11-21T00:00:00+00');
  assert result->>'status' = 'ledger_posted', result::text;
  assert (select amount_paid=500 and balance=0 and status='paid' from public.mio_invoices where invoice_number='MIO-WB-DST');
  assert (select count(*) = 1 from public.mio_weekly_trust_postings where idempotency_key='wk-behavior-cross-0001');
  assert (select json_value->0->>'transaction_type' = 'operating_transfer' and json_value->0->>'invoice_id' = 'cccccccc-0000-4000-8000-000000000002'
            from public.case_mio_user_state where key='caseMioTrustTransactions');
  assert (select count(*) = 1 from public.mio_invoice_events where invoice_id='cccccccc-0000-4000-8000-000000000002' and event_type='trust_applied');
end $$;

-- 8. Idempotent replay of the same payment returns already_posted and does not double-post.
do $$ declare result jsonb; begin
  result := public.mio_post_weekly_trust_payment_v1(
    'wk-behavior-cross-0001','bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
    50000,'2026-11-21T00:00:00+00');
  assert result->>'status' = 'already_posted', result::text;
  assert (select amount_paid=500 from public.mio_invoices where invoice_number='MIO-WB-DST');
  assert (select count(*) = 1 from public.mio_weekly_trust_postings where idempotency_key='wk-behavior-cross-0001');
end $$;

-- 9. Reusing an idempotency key for a different payment is refused.
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-cross-0001','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000002',
      40000,'2026-11-21T00:00:00+00');
    raise exception 'expected key reuse refusal';
  exception when others then
    if sqlerrm not like '%different payment%' then raise; end if;
  end;
end $$;

-- 10. The RPC remains disabled for the authenticated role until release authorization.
do $$ begin
  assert not has_function_privilege('authenticated','public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz)','execute');
  assert not has_function_privilege('anon','public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz)','execute');
end $$;

select 'weekly billing atomic posting behavior passed' as result;
