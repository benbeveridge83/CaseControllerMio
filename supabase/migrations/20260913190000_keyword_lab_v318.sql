create table public.mio_ads_keyword_experiments (
 id uuid primary key default gen_random_uuid(),
 account_id text not null,
 campaign_id text not null,
 campaign_name text not null,
 ad_group_id text not null,
 ad_group_name text not null,
 criterion_id text not null,
 criterion_resource_name text not null,
 keyword text not null,
 match_type text not null check(match_type in ('EXACT','PHRASE','BROAD')),
 source text not null check(source in ('manual','planner','search_term')),
 hypothesis text,
 experiment_started_at timestamptz not null,
 approved_by uuid references auth.users(id),
 state text not null check(state in ('proposed','approved','active','paused','promoted_to_core','ended')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(account_id,criterion_resource_name)
);

create table public.mio_ads_keyword_market_cache (
 id uuid primary key default gen_random_uuid(),
 account_id text not null,
 seed_type text not null check(seed_type in ('manual','keyword','search_term','url')),
 normalized_seed text not null,
 location_ids text[] not null default '{}',
 language_id text not null,
 network text not null,
 results jsonb not null check(jsonb_typeof(results)='array'),
 retrieved_at timestamptz not null,
 expires_at timestamptz not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(account_id,seed_type,normalized_seed,location_ids,language_id,network,retrieved_at)
);

create table public.mio_ads_search_term_classifications (
 id uuid primary key default gen_random_uuid(),
 account_id text not null,
 campaign_id text not null,
 ad_group_id text not null,
 search_term text not null,
 classification text not null check(classification in ('relevant','irrelevant','observe','promoted')),
 note text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(account_id,campaign_id,ad_group_id,search_term)
);

create index mio_ads_keyword_experiments_account_updated
 on public.mio_ads_keyword_experiments(account_id,updated_at desc);
create index mio_ads_keyword_market_cache_lookup
 on public.mio_ads_keyword_market_cache(account_id,normalized_seed,retrieved_at desc);
create index mio_ads_search_term_classifications_account_updated
 on public.mio_ads_search_term_classifications(account_id,updated_at desc);

alter table public.mio_ads_keyword_experiments enable row level security;
alter table public.mio_ads_keyword_market_cache enable row level security;
alter table public.mio_ads_search_term_classifications enable row level security;

revoke all on public.mio_ads_keyword_experiments from public, anon, authenticated;
revoke all on public.mio_ads_keyword_market_cache from public, anon, authenticated;
revoke all on public.mio_ads_search_term_classifications from public, anon, authenticated;

grant select, insert on public.mio_ads_keyword_experiments to authenticated;
grant update(state,hypothesis) on public.mio_ads_keyword_experiments to authenticated;
grant select, insert on public.mio_ads_keyword_market_cache to authenticated;
grant update(results,retrieved_at,expires_at) on public.mio_ads_keyword_market_cache to authenticated;
grant select, insert on public.mio_ads_search_term_classifications to authenticated;
grant update(classification,note) on public.mio_ads_search_term_classifications to authenticated;

create policy mio_ads_keyword_experiments_firm_read
 on public.mio_ads_keyword_experiments for select to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_keyword_experiments_firm_insert
 on public.mio_ads_keyword_experiments for insert to authenticated
 with check(created_by=(select auth.uid()) and (approved_by is null or approved_by=(select auth.uid())) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_keyword_experiments_firm_update
 on public.mio_ads_keyword_experiments for update to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com')
 with check(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');

create policy mio_ads_keyword_market_cache_firm_read
 on public.mio_ads_keyword_market_cache for select to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_keyword_market_cache_firm_insert
 on public.mio_ads_keyword_market_cache for insert to authenticated
 with check(created_by=(select auth.uid()) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_keyword_market_cache_firm_update
 on public.mio_ads_keyword_market_cache for update to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com')
 with check(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');

create policy mio_ads_search_term_classifications_firm_read
 on public.mio_ads_search_term_classifications for select to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_search_term_classifications_firm_insert
 on public.mio_ads_search_term_classifications for insert to authenticated
 with check(created_by=(select auth.uid()) and lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');
create policy mio_ads_search_term_classifications_firm_update
 on public.mio_ads_search_term_classifications for update to authenticated
 using(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com')
 with check(lower((select auth.jwt())->>'email') like '%@beveridgelawfirm.com');

create function public.mio_ads_keyword_lab_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
 new.updated_at=now();
 return new;
end;
$$;
revoke all on function public.mio_ads_keyword_lab_touch_updated_at() from public, anon, authenticated;

create trigger mio_ads_keyword_experiments_touch_updated_at
 before update on public.mio_ads_keyword_experiments
 for each row execute function public.mio_ads_keyword_lab_touch_updated_at();
create trigger mio_ads_keyword_market_cache_touch_updated_at
 before update on public.mio_ads_keyword_market_cache
 for each row execute function public.mio_ads_keyword_lab_touch_updated_at();
create trigger mio_ads_search_term_classifications_touch_updated_at
 before update on public.mio_ads_search_term_classifications
 for each row execute function public.mio_ads_keyword_lab_touch_updated_at();

alter table public.mio_ads_changes
 drop constraint if exists mio_ads_changes_kind_check;
alter table public.mio_ads_changes
 add constraint mio_ads_changes_kind_check
 check(kind in ('rsa_update','campaign_negatives','keyword_lab'));
