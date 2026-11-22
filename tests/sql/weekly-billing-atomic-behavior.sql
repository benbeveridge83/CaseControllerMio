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
  begin
    update public.case_mio_user_state set json_value='[]'::jsonb
      where key='caseMioTrustTransactions';
    raise exception 'expected stale trust ledger refusal';
  exception when others then
    if sqlerrm not like '%Trust ledger changed%' then raise; end if;
  end;
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

-- 11. One mirrored LawPay entry must not suppress a different provider deposit.
-- Preserve the full invoice paid amount when a legacy upsert arrives afterward.
insert into public.lawpay_transactions (gateway_transaction_id,account_key,currency,amount_cents,status,occurred_at)
values ('unclassified-fixture','trust','USD',5000,'COMPLETED','2026-11-21T00:00:00+00');
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-unclassified-0001','bbbbbbbb-0000-4000-8000-000000000005',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000004',
      10000,'2026-11-21T00:00:00+00');
    raise exception 'expected unclassified trust refusal';
  exception when others then
    if sqlerrm not like '%Unclassified LawPay%' then raise; end if;
  end;
end $$;
delete from public.lawpay_transactions where gateway_transaction_id='unclassified-fixture';

insert into public.lawpay_transactions (gateway_transaction_id,account_id,account_key,currency,amount_cents,status,occurred_at)
values ('unmapped-fixture','unverified-account','trust','USD',5000,'COMPLETED','2026-11-21T00:00:00+00');
insert into public.mio_lawpay_ledger_entries
  (identity,classification_id,entry_kind,direction,account_key,matter_id,amount_cents,currency,occurred_at,provider_account_id,created_by)
values ('unmapped-fixture',gen_random_uuid(),'trust_deposit','in','trust','bbbbbbbb-0000-4000-8000-000000000005',
  5000,'USD','2026-11-21T00:00:00+00','unverified-account','fixture');
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-unmapped-0001','bbbbbbbb-0000-4000-8000-000000000005',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000004',
      10000,'2026-11-21T00:00:00+00');
    raise exception 'expected unverified settlement account refusal';
  exception when others then
    if sqlerrm not like '%settlement account is not verified%' then raise; end if;
  end;
end $$;
delete from public.mio_lawpay_ledger_entries where identity='unmapped-fixture';
delete from public.lawpay_transactions where gateway_transaction_id='unmapped-fixture';

-- A completed refund with an empty account_key still belongs to a verified
-- trust settlement account. An unmatched refund must block all posting.
insert into public.mio_lawpay_accounts (provider_account_id,account_key,verified_at)
values ('refund-trust-fixture','trust',now());
-- A completed charge may likewise omit its trust label; the verified
-- settlement account still makes it a required ledger item.
insert into public.lawpay_transactions
  (gateway_transaction_id,account_id,account_key,currency,amount_cents,transaction_type,status,occurred_at)
values ('unlabeled-charge-fixture','refund-trust-fixture','','USD',5000,'CHARGE','COMPLETED','2026-11-21T00:00:00+00');
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-unlabeled-0001','bbbbbbbb-0000-4000-8000-000000000005',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000004',
      10000,'2026-11-21T00:00:00+00');
    raise exception 'expected unlabeled trust charge refusal';
  exception when others then
    if sqlerrm not like '%Unclassified LawPay trust transactions%' then raise; end if;
  end;
end $$;
delete from public.lawpay_transactions where gateway_transaction_id='unlabeled-charge-fixture';
insert into public.lawpay_transactions
  (gateway_transaction_id,account_id,account_key,currency,amount_cents,transaction_type,status,occurred_at)
values ('unreconciled-refund-fixture','refund-trust-fixture','','USD',2000,'REFUND','COMPLETED','2026-11-21T00:00:00+00');
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-behavior-refund-0001','bbbbbbbb-0000-4000-8000-000000000005',
      'bbbbbbbb-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000004',
      10000,'2026-11-21T00:00:00+00');
    raise exception 'expected unreconciled trust refund refusal';
  exception when others then
    if sqlerrm not like '%Unreconciled LawPay trust refunds%' then raise; end if;
  end;
  assert (select count(*)=0 from public.mio_weekly_trust_postings
    where idempotency_key='wk-behavior-refund-0001');
end $$;
delete from public.lawpay_transactions where gateway_transaction_id='unreconciled-refund-fixture';
delete from public.mio_lawpay_accounts where provider_account_id='refund-trust-fixture';

insert into public.mio_invoices (id,user_id,invoice_number,invoice_type,matter_id,client_id,status,total,amount_paid,balance,updated_at)
values ('cccccccc-0000-4000-8000-000000000005','00000000-0000-4000-8000-0000000000aa',
  'MIO-WB-MIXED','services','bbbbbbbb-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001',
  'partially_paid',200,60,140,'2026-11-21T00:00:00+00');
update public.case_mio_user_state
   set json_value=jsonb_build_array(jsonb_build_object('matter_id','bbbbbbbb-0000-4000-8000-000000000003',
      'date','2026-11-21','direction','in','amount',25,'lawpay_transaction_id','mirrored-lawpay'))||json_value
 where key='caseMioTrustTransactions';
insert into public.mio_lawpay_ledger_entries
  (identity,classification_id,entry_kind,direction,account_key,matter_id,amount_cents,currency,occurred_at,provider_account_id,created_by)
values
  ('mirrored-lawpay',gen_random_uuid(),'trust_deposit','in','trust','bbbbbbbb-0000-4000-8000-000000000003',2500,'USD','2026-11-21T00:00:00+00','trust-fixture','fixture'),
  ('other-lawpay',gen_random_uuid(),'trust_deposit','in','trust','bbbbbbbb-0000-4000-8000-000000000003',3000,'USD','2026-11-21T00:00:00+00','trust-fixture','fixture');
do $$ declare result jsonb; begin
  result:=public.mio_post_weekly_trust_payment_v1(
    'wk-behavior-mixed-0001','bbbbbbbb-0000-4000-8000-000000000003',
    'bbbbbbbb-0000-4000-8000-000000000003','cccccccc-0000-4000-8000-000000000005',
    14000,'2026-11-21T00:00:00+00');
  assert result->>'status'='ledger_posted', result::text;
  assert (select amount_paid=200 and balance=0 from public.mio_invoices where invoice_number='MIO-WB-MIXED');
  begin
    update public.mio_invoices set amount_paid=140,balance=60,status='outstanding'
      where invoice_number='MIO-WB-MIXED';
    raise exception 'expected stale paid balance refusal';
  exception when others then
    if sqlerrm not like '%Cannot erase%' then raise; end if;
  end;
end $$;

select 'weekly billing atomic posting behavior passed' as result;
