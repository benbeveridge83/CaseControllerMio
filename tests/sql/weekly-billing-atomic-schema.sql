-- Synthetic schema for isolated PostgreSQL CI; never run this against Mio.
-- Mirrors the columns the weekly-billing atomic posting migration references.

create role anon;
create role authenticated;

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select '00000000-0000-4000-8000-0000000000aa'::uuid
$$;

create table public.matters (
  id uuid primary key,
  client_id uuid,
  name text not null,
  is_active boolean default true,
  matter_type text,
  case_status text
);

create table public.mio_invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  invoice_number text not null,
  invoice_type text not null,
  matter_id text not null,
  client_id text,
  status text not null,
  total numeric not null,
  amount_paid numeric not null default 0,
  balance numeric not null,
  updated_at timestamptz not null default now()
);

create table public.mio_invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.mio_invoices(id),
  user_id uuid not null,
  event_type text not null,
  amount numeric,
  provider_event_id text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table public.mio_lawpay_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  identity text not null,
  classification_id uuid not null,
  entry_kind text not null,
  direction text not null,
  account_key text not null,
  matter_id text not null,
  amount_cents bigint not null,
  currency text not null,
  occurred_at timestamptz not null,
  provider_account_id text not null,
  reverses_entry_id uuid,
  created_by text not null,
  created_at timestamptz not null default now(),
  refund_resolution_id uuid
);

create table public.lawpay_transactions (
  gateway_transaction_id text primary key,
  account_id text,
  account_key text,
  currency text,
  amount_cents bigint,
  transaction_type text,
  status text,
  occurred_at timestamptz
);

create table public.mio_lawpay_accounts (
  provider_account_id text primary key,
  account_key text,
  verified_at timestamptz
);

create table public.case_mio_user_state (
  user_id uuid not null,
  key text not null,
  raw_value text,
  json_value jsonb,
  origin text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- One funded source, one owed destination, one low-trust source, one other-client
-- matter, and a dedicated source for the concurrency race.
insert into public.matters (id, client_id, name) values
  ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','Funded Source'),
  ('bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','Owed Destination'),
  ('bbbbbbbb-0000-4000-8000-000000000003','aaaaaaaa-0000-4000-8000-000000000001','Low Trust Source'),
  ('bbbbbbbb-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000002','Other Client Matter'),
  ('bbbbbbbb-0000-4000-8000-000000000005','aaaaaaaa-0000-4000-8000-000000000001','Concurrency Source');

insert into public.mio_invoices (id, user_id, invoice_number, invoice_type, matter_id, client_id, status, total, amount_paid, balance, updated_at) values
  ('cccccccc-0000-4000-8000-000000000001','00000000-0000-4000-8000-0000000000aa','MIO-WB-SRC','services','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','outstanding',200,0,200,'2026-11-21T00:00:00+00'),
  ('cccccccc-0000-4000-8000-000000000002','00000000-0000-4000-8000-0000000000aa','MIO-WB-DST','services','bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','outstanding',500,0,500,'2026-11-21T00:00:00+00'),
  ('cccccccc-0000-4000-8000-000000000003','00000000-0000-4000-8000-0000000000aa','MIO-WB-OTHER','services','bbbbbbbb-0000-4000-8000-000000000004','aaaaaaaa-0000-4000-8000-000000000002','outstanding',300,0,300,'2026-11-21T00:00:00+00'),
  ('cccccccc-0000-4000-8000-000000000004','00000000-0000-4000-8000-0000000000aa','MIO-WB-CONC','services','bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000001','outstanding',100,0,100,'2026-11-21T00:00:00+00');

insert into public.case_mio_user_state (user_id, key, json_value, raw_value) values
  ('00000000-0000-4000-8000-0000000000aa','caseMioFinanceOpeningBalances',
   '{"bbbbbbbb-0000-4000-8000-000000000001":{"matter_trust_funds":1000.00},"bbbbbbbb-0000-4000-8000-000000000002":{"matter_trust_funds":0},"bbbbbbbb-0000-4000-8000-000000000003":{"matter_trust_funds":100.00},"bbbbbbbb-0000-4000-8000-000000000004":{"matter_trust_funds":0},"bbbbbbbb-0000-4000-8000-000000000005":{"matter_trust_funds":150.00}}'::jsonb, null),
  ('00000000-0000-4000-8000-0000000000aa','caseMioBillingCutoverDate', null, '2026-08-09'),
  ('00000000-0000-4000-8000-0000000000aa','caseMioTrustTransactions', '[]'::jsonb, null),
  ('00000000-0000-4000-8000-0000000000aa','mioWeeklyBillingSettingsV1',
   '{"enableAtomicWeeklyTrustPosting":true,"matters":{"bbbbbbbb-0000-4000-8000-000000000001":{"included":true,"shareTrust":true,"agreementAuthorized":true},"bbbbbbbb-0000-4000-8000-000000000002":{"included":true},"bbbbbbbb-0000-4000-8000-000000000003":{"included":true,"shareTrust":true,"agreementAuthorized":true},"bbbbbbbb-0000-4000-8000-000000000004":{"included":true,"shareTrust":true,"agreementAuthorized":true},"bbbbbbbb-0000-4000-8000-000000000005":{"included":true,"shareTrust":true,"agreementAuthorized":true}}}'::jsonb, null);
