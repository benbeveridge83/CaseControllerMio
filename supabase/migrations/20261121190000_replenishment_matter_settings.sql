-- Standalone trust replenishment preferences; no dependency on weekly billing.
-- Apply only after validating the current matter authorization and deployment pipeline.
create table if not exists public.mio_replenishment_matter_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  matter_id uuid not null references public.matters(id) on delete cascade,
  replenishment_enabled boolean not null default true,
  primary_replenishment_matter boolean not null default true,
  covered_matter_ids uuid[] not null default '{}',
  minimum_trust numeric(12,2) check (minimum_trust is null or minimum_trust >= 0),
  target_trust numeric(12,2) check (target_trust is null or target_trust >= 0),
  withdrawal_flagged boolean not null default false,
  withdrawal_flagged_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id,matter_id),
  constraint trust_target_gte_minimum check (target_trust is null or minimum_trust is null or target_trust >= minimum_trust)
);
alter table public.mio_replenishment_matter_settings enable row level security;
revoke all on public.mio_replenishment_matter_settings from anon,authenticated;
grant select,insert,update on public.mio_replenishment_matter_settings to authenticated;
create policy "replenishment select own" on public.mio_replenishment_matter_settings
 for select to authenticated using ((select auth.uid()) = user_id and exists(select 1 from public.matters m where m.id = matter_id));
create policy "replenishment insert own" on public.mio_replenishment_matter_settings
 for insert to authenticated with check ((select auth.uid()) = user_id and exists(select 1 from public.matters m where m.id = matter_id));
create policy "replenishment update own" on public.mio_replenishment_matter_settings
 for update to authenticated using ((select auth.uid()) = user_id and exists(select 1 from public.matters m where m.id = matter_id))
 with check ((select auth.uid()) = user_id and exists(select 1 from public.matters m where m.id = matter_id));
create index if not exists mio_replenishment_settings_matter_idx on public.mio_replenishment_matter_settings (matter_id);
-- This table contains NO transfer authorizations. Invoice issuance and email sending remain separate gated operations.
