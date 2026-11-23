-- Default inclusion must match the review UI; source sharing is independent.
\set ON_ERROR_STOP on

insert into public.matters (id,client_id,name,matter_type,case_status) values
  ('bbbbbbbb-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000001','Open recipient','SAPCR/Modification','Open'),
  ('bbbbbbbb-0000-4000-8000-000000000007','aaaaaaaa-0000-4000-8000-000000000001','DFPS recipient','DFPS','Open'),
  ('bbbbbbbb-0000-4000-8000-000000000008','aaaaaaaa-0000-4000-8000-000000000001','Closed recipient','Divorce','Closed'),
  ('bbbbbbbb-0000-4000-8000-000000000009','aaaaaaaa-0000-4000-8000-000000000001','test recipient','Other','Open');

insert into public.mio_invoices
  (id,user_id,invoice_number,invoice_type,matter_id,client_id,status,total,amount_paid,balance,updated_at)
select ('cccccccc-0000-4000-8000-00000000000'||right(m.id::text,1))::uuid,
  '00000000-0000-4000-8000-0000000000aa'::uuid,
  'MIO-WB-DEFAULT-'||right(m.id::text,1),'services',m.id::text,m.client_id::text,
  'outstanding',50,0,50,'2026-11-21T00:00:00+00'::timestamptz
from public.matters m where m.id::text like 'bbbbbbbb-0000-4000-8000-00000000000_'
  and right(m.id::text,1) in ('6','7','8','9');

-- The source can be excluded from invoicing while still sharing its trust.
update public.case_mio_user_state
set json_value=jsonb_set(json_value,'{matters,bbbbbbbb-0000-4000-8000-000000000001,included}','false'::jsonb)
where key='mioWeeklyBillingSettingsV1';

do $$ declare result jsonb; begin
  result:=public.mio_post_weekly_trust_payment_v1(
    'wk-default-open-0001','bbbbbbbb-0000-4000-8000-000000000001',
    'bbbbbbbb-0000-4000-8000-000000000006','cccccccc-0000-4000-8000-000000000006',
    5000,'2026-11-21T00:00:00+00');
  assert result->>'status'='ledger_posted', result::text;
end $$;

-- An unmarked DFPS matter, closed matter, and test matter are excluded by default.
do $$ declare destination text; invoice uuid; begin
  foreach destination in array array[
    'bbbbbbbb-0000-4000-8000-000000000007',
    'bbbbbbbb-0000-4000-8000-000000000008',
    'bbbbbbbb-0000-4000-8000-000000000009'
  ] loop
    invoice:=('cccccccc-0000-4000-8000-00000000000'||right(destination,1))::uuid;
    begin
      perform public.mio_post_weekly_trust_payment_v1(
        'wk-default-refuse-'||right(destination,1),
        'bbbbbbbb-0000-4000-8000-000000000001',destination,invoice,
        1000,'2026-11-21T00:00:00+00');
      raise exception 'expected default exclusion';
    exception when others then
      if sqlerrm not like '%Destination matter is excluded%' then raise; end if;
    end;
  end loop;
  assert (select count(*)=0 from public.mio_weekly_trust_postings
    where idempotency_key like 'wk-default-refuse-%');
end $$;

-- A deliberate appointment override makes DFPS eligible; disabling Share Trust
-- on the source still blocks the cross-matter payment.
update public.case_mio_user_state
set json_value=jsonb_set(json_value,
  '{matters,bbbbbbbb-0000-4000-8000-000000000007}',
  '{"appointed":false}'::jsonb)
where key='mioWeeklyBillingSettingsV1';
update public.case_mio_user_state
set json_value=jsonb_set(json_value,
  '{matters,bbbbbbbb-0000-4000-8000-000000000001,shareTrust}','false'::jsonb)
where key='mioWeeklyBillingSettingsV1';
do $$ begin
  begin
    perform public.mio_post_weekly_trust_payment_v1(
      'wk-default-share-off-0001','bbbbbbbb-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000007','cccccccc-0000-4000-8000-000000000007',
      1000,'2026-11-21T00:00:00+00');
    raise exception 'expected source sharing refusal';
  exception when others then
    if sqlerrm not like '%sharing and signed agreement%' then raise; end if;
  end;
end $$;

-- A migration must not release the RPC.
do $$ begin
  assert not has_function_privilege('authenticated',
    'public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz)','execute');
end $$;
