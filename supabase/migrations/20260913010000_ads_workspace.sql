-- Applied as mio_ads_workspace_preferences_and_history. No client/lead tables changed.
create table if not exists public.mio_ads_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 columns jsonb not null default '["searchTerm","intent","status","campaignName","adGroupName","triggeringKeyword","clicks","cost","conversions"]'::jsonb check(jsonb_typeof(columns)='array'),
 updated_at timestamptz not null default now()
);
alter table public.mio_ads_preferences enable row level security;
revoke all on public.mio_ads_preferences from anon;
grant select,insert,update on public.mio_ads_preferences to authenticated;
create policy mio_ads_preferences_own on public.mio_ads_preferences for all to authenticated
 using(user_id=(select auth.uid()) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com')
 with check(user_id=(select auth.uid()) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create table if not exists public.mio_ads_changes (
 id uuid primary key default gen_random_uuid(), request_key uuid not null,
 account_id text not null, actor_id uuid not null references auth.users(id), actor_email text not null,
 kind text not null check(kind in ('rsa_update','campaign_negatives')),
 status text not null default 'prepared' check(status in ('prepared','verified','unverified','failed','skipped')),
 payload_hash text not null check(length(payload_hash)=64),
 before_snapshot jsonb not null default '{}', after_snapshot jsonb not null default '{}', result jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(account_id,request_key)
);
create index if not exists mio_ads_changes_account_created on public.mio_ads_changes(account_id,created_at desc);
alter table public.mio_ads_changes enable row level security;
revoke all on public.mio_ads_changes from anon,authenticated;
grant select,insert on public.mio_ads_changes to authenticated;
grant update(status,result,updated_at) on public.mio_ads_changes to authenticated;
create policy mio_ads_history_staff_read on public.mio_ads_changes for select to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_history_own_insert on public.mio_ads_changes for insert to authenticated
 with check(actor_id=(select auth.uid()) and actor_email=(select auth.jwt())->>'email' and lower(actor_email) like '%@beveridgelawfirm.com' and status='prepared');
create policy mio_ads_history_own_result on public.mio_ads_changes for update to authenticated
 using(actor_id=(select auth.uid()) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com')
 with check(actor_id=(select auth.uid()) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
