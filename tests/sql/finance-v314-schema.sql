-- Synthetic schema for isolated PostgreSQL CI; never run this against Mio.
create role anon;
create role authenticated;
create role service_role;
create table public.mio_invoices(id uuid primary key default gen_random_uuid(),user_id uuid,invoice_number text,invoice_type text,matter_id text,status text,total numeric,amount_paid numeric default 0,balance numeric,payment_request_id text,updated_at timestamptz);
create table public.mio_invoice_events(id uuid primary key default gen_random_uuid(),invoice_id uuid references public.mio_invoices(id),user_id uuid,event_type text,amount numeric,provider_event_id text,details jsonb,occurred_at timestamptz);
create table public.lawpay_payment_requests(id uuid primary key default gen_random_uuid(),invoice_number text,matter_id text,amount_cents bigint,status text,paid_at timestamptz,gateway_transaction_id text,raw jsonb default '{}');
create table public.lawpay_transactions(id uuid primary key default gen_random_uuid(),gateway_transaction_id text unique,gateway_event_id text,occurred_at timestamptz,modified_at timestamptz,transaction_type text,status text,account_id text,account_key text,amount_cents bigint,amount_refunded_cents bigint default 0,currency text,reference text,payer_name text,payer_email text,payment_method_type text,last_four text,raw jsonb,synced_at timestamptz);
insert into public.mio_invoices(id,invoice_number,invoice_type,matter_id,status,total,amount_paid,balance,payment_request_id) values
('10000000-0000-4000-8000-000000000001','MIO-2026-900001','services','synthetic-a','outstanding',2562.50,1550,1012.50,'20000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000002','MIO-2026-900002','services','synthetic-b','outstanding',200,0,200,'20000000-0000-4000-8000-000000000002'),
('10000000-0000-4000-8000-000000000003','MIO-2026-900003','services','synthetic-c','outstanding',50,0,50,'20000000-0000-4000-8000-000000000003'),
('10000000-0000-4000-8000-000000000004','MIO-2026-900004','services','synthetic-d','outstanding',50,0,50,'20000000-0000-4000-8000-000000000004');
insert into public.lawpay_payment_requests(id,invoice_number,matter_id,amount_cents,status)
select payment_request_id::uuid,invoice_number,matter_id,(balance*100)::bigint,'created' from public.mio_invoices;
create function fixture_row(provider_id text,number integer,cents bigint,modified text default '2026-09-09T16:00:00Z',status text default 'COMPLETED',refunded bigint default 0) returns jsonb language sql as $$
 select jsonb_build_object('gateway_transaction_id',provider_id,'occurred_at','2026-09-09T15:13:36Z','modified_at',modified,'transaction_type','CHARGE','status',status,'account_id','synthetic-operating','account_key','operating','amount_cents',cents,'amount_refunded_cents',refunded,'currency','USD','reference','MIO-2026-'||(900000+number),'raw',jsonb_build_object('mio_payment_request_id','20000000-0000-4000-8000-'||lpad(number::text,12,'0'),'mio_invoice_number','MIO-2026-'||(900000+number)))
$$;
