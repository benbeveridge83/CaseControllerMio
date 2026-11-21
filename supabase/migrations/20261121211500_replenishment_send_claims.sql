-- Durable, owner-scoped idempotency claims for private-client replenishment sends.
-- A claim never authorizes money movement or sends mail; it prevents duplicate approvals.
create table if not exists public.mio_replenishment_send_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  matter_id uuid not null references public.matters(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('new','reminder')),
  status text not null default 'claimed' check (status in ('claimed','sent','needs_review')),
  invoice_id uuid,
  claimed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,matter_id,fingerprint)
);
alter table public.mio_replenishment_send_claims enable row level security;
revoke all on public.mio_replenishment_send_claims from anon,authenticated;
grant select,insert,update on public.mio_replenishment_send_claims to authenticated;
create policy "replenishment claim read own" on public.mio_replenishment_send_claims
 for select to authenticated using ((select auth.uid())=user_id and exists(select 1 from public.matters m where m.id=matter_id));
create policy "replenishment claim create own" on public.mio_replenishment_send_claims
 for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.matters m where m.id=matter_id));
create policy "replenishment claim update own" on public.mio_replenishment_send_claims
 for update to authenticated using ((select auth.uid())=user_id and exists(select 1 from public.matters m where m.id=matter_id))
 with check ((select auth.uid())=user_id and exists(select 1 from public.matters m where m.id=matter_id));
create index if not exists mio_replenishment_claims_review_idx
 on public.mio_replenishment_send_claims (user_id,status,claimed_at desc);
