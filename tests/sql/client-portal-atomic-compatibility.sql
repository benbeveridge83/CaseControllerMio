-- Extend the synthetic weekly-billing fixture; never run against Mio.
\set ON_ERROR_STOP on
begin;
create role service_role bypassrls;
create table auth.users(id uuid primary key,email text);
create table public.clients(id uuid primary key,email text);
create table public.mio_pnc_workflows(matter_id uuid primary key,state jsonb,revision integer,updated_at timestamptz);
create table public.mio_client_intake_requests(id uuid primary key,matter_id text,recipient_email text,title text,template_snapshot jsonb,status text,expires_at timestamptz,submitted_at timestamptz,updated_at timestamptz);
create table public.mio_client_intake_submissions(id uuid primary key default gen_random_uuid(),request_id uuid unique,answers jsonb);
create table public.lawpay_payment_requests(id uuid primary key default gen_random_uuid(),created_by uuid,matter_id text,matter_name text,client_id text,client_name text,payer_name text,payer_email text,account_key text,amount_cents bigint,invoice_number text,reference text,payment_url text,raw jsonb,gateway_transaction_id text);
alter table public.mio_invoices add column client_name text,add column matter_name text,add column issue_date date,add column due_date date,add column payment_url text,add column payment_request_id text,add column line_items jsonb;
alter table public.lawpay_transactions add column raw jsonb,add column reference text;
\ir ../../supabase/migrations/20261122205113_client_portal_intake_payments.sql

insert into public.matters(id,client_id,name) values
 ('bbbbbbbb-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000001','Portal compatibility fixture');
update public.case_mio_user_state set json_value=json_value ||
 '{"bbbbbbbb-0000-4000-8000-000000000006":{"matter_trust_funds":500}}'::jsonb
 where key='caseMioFinanceOpeningBalances';
insert into public.mio_invoices(id,user_id,invoice_number,invoice_type,matter_id,client_id,status,total,amount_paid,balance,updated_at) values
 ('cccccccc-0000-4000-8000-000000000020','00000000-0000-4000-8000-0000000000aa','PORTAL-ATOMIC-TEST','services','bbbbbbbb-0000-4000-8000-000000000006','aaaaaaaa-0000-4000-8000-000000000001','outstanding',100,0,100,'2026-11-21T00:00:00+00');

do $$
declare
 inv uuid='cccccccc-0000-4000-8000-000000000020';
 matter text='bbbbbbbb-0000-4000-8000-000000000006';
 result jsonb;ledger_before jsonb;invoice_version timestamptz;
begin
 -- Exercise the actual current atomic posting function, not a simulated update.
 result:=public.mio_post_weekly_trust_payment_v1('portal-atomic-partial',matter,matter,inv,3500,'2026-11-21T00:00:00+00');
 assert result->>'status'='ledger_posted',result::text;
 assert (select amount_paid=35 and balance=65 and status='outstanding' from public.mio_invoices where id=inv);
 select value into result from public.mio_portal_invoices(matter::uuid) as rows(value) where value->>'id'=inv::text;
 assert (result->>'amount_paid')::numeric=35 and (result->>'balance')::numeric=65;
 -- An amount read before the trust posting must never produce a checkout.
 begin
   perform public.mio_portal_payment_request(inv,'portal:'||inv||':10000','https://secure.lawpay.com/pay?amount=100.00','fixture@example.invalid');
   raise exception 'Stale pre-posting checkout was accepted';
 exception when others then
   if sqlerrm not like '%Invoice balance changed%' then raise;end if;
 end;
 select json_value into ledger_before from public.case_mio_user_state where key='caseMioTrustTransactions';
 select updated_at into invoice_version from public.mio_invoices where id=inv;
 result:=public.mio_portal_payment_request(inv,'portal:'||inv||':6500','https://secure.lawpay.com/pay?amount=65.00','fixture@example.invalid');
 assert (select amount_cents=6500 and account_key='operating' from public.lawpay_payment_requests where id=(result->>'id')::uuid);
 assert (select json_value=ledger_before from public.case_mio_user_state where key='caseMioTrustTransactions');
 assert (select amount_paid=35 and balance=65 and status='outstanding' from public.mio_invoices where id=inv);
 assert (select count(*)=1 from public.mio_invoice_events where invoice_id=inv and event_type='trust_applied');
 -- Portal checkout metadata changes the invoice version: an already approved
 -- staff payment must refresh instead of silently bypassing optimistic locking.
 select updated_at into invoice_version from public.mio_invoices where id=inv;
 result:=public.mio_post_weekly_trust_payment_v1('portal-atomic-paid',matter,matter,inv,6500,invoice_version);
 assert result->>'status'='ledger_posted',result::text;
 assert (select amount_paid=100 and balance=0 and status='paid' from public.mio_invoices where id=inv);
 begin
   perform public.mio_portal_payment_request(inv,'portal:'||inv||':6500','https://secure.lawpay.com/pay?amount=65.00','fixture@example.invalid');
   raise exception 'Fully trust-paid invoice accepted another checkout';
 exception when others then
   if sqlerrm not like '%Invoice unavailable%' then raise;end if;
 end;
 raise notice 'Portal and current atomic trust posting are compatible';
end $$;
rollback;
