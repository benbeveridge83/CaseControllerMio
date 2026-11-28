-- Tyler ECF5 filing receipts and e-service results. Additive and fail-closed.
-- Receipts are the clerk receipt, fee receipt, file-stamped documents and
-- rejection notices that must be attached to the correct matter. Service
-- results are the per-recipient delivery outcomes for e-service.
create table if not exists public.mio_efiling_filing_receipts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  matter_id text not null check (length(trim(matter_id)) between 1 and 256),
  submission_id uuid references public.mio_efiling_submissions(id) on delete restrict,
  kind text not null check (kind in ('clerk_receipt','fee_receipt','file_stamped_document','rejection_notice')),
  storage_path text not null check (length(trim(storage_path)) between 1 and 2048),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  file_name text,
  received_at timestamptz not null default clock_timestamp()
);
create index if not exists mio_efiling_filing_receipts_owner_matter_idx
  on public.mio_efiling_filing_receipts(owner_id, matter_id, received_at desc);

create table if not exists public.mio_efiling_service_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  matter_id text not null check (length(trim(matter_id)) between 1 and 256),
  submission_id uuid references public.mio_efiling_submissions(id) on delete restrict,
  service_contact_id text not null check (length(trim(service_contact_id)) between 1 and 256),
  outcome text not null check (outcome in ('delivered','failed','pending')),
  recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists mio_efiling_service_results_owner_matter_idx
  on public.mio_efiling_service_results(owner_id, matter_id, recorded_at desc);

alter table public.mio_efiling_filing_receipts enable row level security;
alter table public.mio_efiling_service_results enable row level security;
revoke all on public.mio_efiling_filing_receipts, public.mio_efiling_service_results from public, anon, authenticated;
grant select on public.mio_efiling_filing_receipts, public.mio_efiling_service_results to authenticated;
create policy mio_efiling_filing_receipts_owner_read on public.mio_efiling_filing_receipts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy mio_efiling_service_results_owner_read on public.mio_efiling_service_results for select to authenticated
  using (owner_id = (select auth.uid()));

-- Server-side writes happen through the service role (or a future service-only RPC);
-- the browser never inserts receipts or service results.
grant select, insert, update, delete on public.mio_efiling_filing_receipts, public.mio_efiling_service_results to service_role;
