-- Synthetic schema for isolated PostgreSQL tests; never run this against Mio.
do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create table if not exists public.mio_invoices(id uuid primary key default gen_random_uuid(),user_id uuid,invoice_number text,invoice_type text,matter_id text,status text,total numeric,amount_paid numeric default 0,balance numeric,payment_request_id text,updated_at timestamptz);
create table if not exists public.mio_invoice_events(id uuid primary key default gen_random_uuid(),invoice_id uuid references public.mio_invoices(id),user_id uuid,event_type text,amount numeric,provider_event_id text,details jsonb,occurred_at timestamptz);
create table if not exists public.lawpay_transactions(id uuid primary key default gen_random_uuid(),gateway_transaction_id text unique,gateway_event_id text,occurred_at timestamptz,modified_at timestamptz,transaction_type text,status text,account_id text,account_key text,amount_cents bigint,amount_refunded_cents bigint default 0,currency text,reference text,payer_name text,payer_email text,payment_method_type text,last_four text,raw jsonb,synced_at timestamptz);
create table if not exists public.case_mio_user_state(user_id uuid not null,key text not null,raw_value text,json_value jsonb,updated_at timestamptz default now(),primary key(user_id,key));

insert into public.mio_invoices(id,invoice_number,invoice_type,matter_id,status,total,amount_paid,balance) values
 ('10000000-0000-4000-8000-0000000000c1','MIO-2026-900101','services','matter-south','outstanding',125,0,125),
 ('10000000-0000-4000-8000-0000000000c2','MIO-2026-900102','services','matter-other','outstanding',5000,0,5000)
on conflict (id) do nothing;

-- Provider records. account_id is opaque: two distinct firms' style IDs, one of them numeric-ish.
insert into public.lawpay_transactions(gateway_transaction_id,transaction_type,status,account_id,amount_cents,amount_refunded_cents,currency,occurred_at,raw) values
 ('lawpay-charge-rooney','CHARGE','COMPLETED','acct-91075',500000,0,'USD','2026-09-10T15:00:00Z','{}'),
 ('lawpay-refund-rooney','REFUND','COMPLETED','acct-91075',112000,0,'USD','2026-09-12T10:00:00Z','{}'),
 ('lawpay-consult-south','CHARGE','COMPLETED','acct-91077',12500,0,'USD','2026-09-12T11:00:00Z','{}'),
 ('lawpay-pending-south','CHARGE','PENDING','acct-91077',15000,0,'USD','2026-09-12T12:00:00Z','{}'),
 ('lawpay-refunded-charge','CHARGE','COMPLETED','acct-91075',300000,300000,'USD','2026-09-11T10:00:00Z','{}'),
 ('lawpay-refund-2','REFUND','COMPLETED','acct-91075',25000,0,'USD','2026-09-12T13:00:00Z','{}'),
 ('lawpay-unmapped-charge','CHARGE','COMPLETED','acct-unknown-9',25000,0,'USD','2026-09-13T10:00:00Z','{}')
on conflict (gateway_transaction_id) do nothing;

-- A trust ledger entry that already exists for the Rooney refund, as an opening-balance row.
insert into public.case_mio_user_state(user_id,key,json_value) values
 ('00000000-0000-4000-8000-0000000000aa','caseMioTrustTransactions','[{"id":"opening-trust-row-4","matter_id":"matter-rooney","amount":1120,"direction":"out","source":"Opening balance 2026-08-09"},{"id":"opening-trust-row-5","matter_id":"matter-south","amount":250,"direction":"in","source":"Opening balance 2026-08-09"},{"id":"opening-trust-row-6","matter_id":"matter-south","amount":999,"direction":"in","source":"Opening balance 2026-08-09"}]'::jsonb)
on conflict (user_id,key) do update set json_value = excluded.json_value;
