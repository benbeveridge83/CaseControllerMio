-- Equal Parenting Research editorial schema.
-- Base tables are staff-only. Anonymous/public reads are limited to the
-- published projection in research_public_catalog.

create table if not exists public.research_publications (
  id uuid primary key default gen_random_uuid(),
  inventory_work_id text unique,
  slug text not null unique,
  title text not null,
  authors_text text not null default '',
  publication_year integer check(publication_year between 1800 and 2200),
  journal_or_publisher text,
  doi text,
  source_type text not null check(source_type in (
    'original_empirical','longitudinal','natural_experiment','systematic_review',
    'meta_analysis','narrative_review','consensus_report','methodology_critique','policy_legal','other'
  )),
  admission_route text,
  direct_child_outcome boolean,
  included_nielsen_2018 boolean,
  country_text text,
  citation_text text,
  abstract_summary text,
  overall_findings_summary text,
  limitations_summary text,
  what_it_supports text,
  what_it_does_not_establish text,
  finding_direction text not null default 'mixed' check(finding_direction in (
    'favors_shared','neutral','mixed','conditional_concern','disfavors_shared','methodology_only'
  )),
  topics text[] not null default '{}',
  evidence_strength_score integer check(evidence_strength_score between 0 and 100),
  impact_score integer check(impact_score between 0 and 100),
  equal_parenting_relevance_score integer check(equal_parenting_relevance_score between 0 and 100),
  historical_field_importance_score integer check(historical_field_importance_score between 0 and 100),
  score_notes jsonb not null default '{}'::jsonb,
  editorial_status text not null default 'draft' check(editorial_status in ('draft','needs_review','published','archived')),
  published_at timestamptz,
  citation_verification text,
  internal_notes text,
  inventory_raw jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists research_publications_doi_unique
  on public.research_publications(lower(doi)) where doi is not null and btrim(doi)<>'';
create index if not exists research_publications_status_year
  on public.research_publications(editorial_status,publication_year desc);
create index if not exists research_publications_topics_gin
  on public.research_publications using gin(topics);

create table if not exists public.research_studies (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.research_publications(id) on delete cascade,
  study_label text not null,
  extraction_status text not null default 'unverified' check(extraction_status in ('unverified','verified','needs_review')),
  country_text text,
  sample_size integer check(sample_size is null or sample_size>=0),
  child_age_text text,
  age_min numeric,
  age_max numeric,
  parenting_time_definition text,
  shared_time_min_percent numeric check(shared_time_min_percent is null or shared_time_min_percent between 0 and 100),
  shared_time_max_percent numeric check(shared_time_max_percent is null or shared_time_max_percent between 0 and 100),
  exact_or_near_50_50 boolean,
  comparator text,
  study_design text,
  outcomes_measured text,
  controls_summary text,
  longitudinal boolean,
  pre_separation_controls boolean,
  conflict_controls boolean,
  ses_controls boolean,
  effect_size_summary text,
  result_direction text check(result_direction is null or result_direction in ('favors_shared','neutral','mixed','conditional_concern','disfavors_shared')),
  result_summary text,
  key_limitation text,
  causal_claim_strength text not null default 'not_applicable' check(causal_claim_strength in ('high','moderate','low','very_low','not_applicable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists research_studies_publication on public.research_studies(publication_id);
create index if not exists research_studies_exact_50 on public.research_studies(publication_id,exact_or_near_50_50);

create table if not exists public.research_access_links (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.research_publications(id) on delete cascade,
  link_type text not null,
  url text not null,
  access_status text not null,
  license_text text,
  redistribution_permitted boolean not null default false,
  is_preferred boolean not null default false,
  is_public boolean not null default true,
  checked_at timestamptz,
  unique(publication_id,link_type,url)
);
create index if not exists research_access_links_publication on public.research_access_links(publication_id);

create table if not exists public.research_metrics (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.research_publications(id) on delete cascade,
  provider text not null,
  metric_type text not null,
  metric_value numeric,
  source_url text,
  captured_at timestamptz not null,
  unique(publication_id,provider,metric_type,captured_at)
);
create index if not exists research_metrics_publication on public.research_metrics(publication_id,captured_at desc);

create table if not exists public.research_review_memberships (
  id uuid primary key default gen_random_uuid(),
  review_publication_id uuid not null references public.research_publications(id) on delete cascade,
  included_publication_id uuid not null references public.research_publications(id) on delete cascade,
  included_study_id uuid references public.research_studies(id) on delete set null,
  membership_status text not null default 'included',
  membership_note text,
  verified_at timestamptz,
  unique(review_publication_id,included_publication_id,included_study_id)
);
create index if not exists research_review_memberships_review on public.research_review_memberships(review_publication_id);
create index if not exists research_review_memberships_included on public.research_review_memberships(included_publication_id);

alter table public.research_publications enable row level security;
alter table public.research_studies enable row level security;
alter table public.research_access_links enable row level security;
alter table public.research_metrics enable row level security;
alter table public.research_review_memberships enable row level security;

revoke all on public.research_publications from anon;
revoke all on public.research_studies from anon;
revoke all on public.research_access_links from anon;
revoke all on public.research_metrics from anon;
revoke all on public.research_review_memberships from anon;

revoke all on public.research_publications from authenticated;
revoke all on public.research_studies from authenticated;
revoke all on public.research_access_links from authenticated;
revoke all on public.research_metrics from authenticated;
revoke all on public.research_review_memberships from authenticated;

grant select,insert,update,delete on public.research_publications to authenticated;
grant select,insert,update,delete on public.research_studies to authenticated;
grant select,insert,update,delete on public.research_access_links to authenticated;
grant select,insert,update,delete on public.research_metrics to authenticated;
grant select,insert,update,delete on public.research_review_memberships to authenticated;

create policy research_publications_staff_all on public.research_publications for all to authenticated
 using(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com')
 with check(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com');
create policy research_studies_staff_all on public.research_studies for all to authenticated
 using(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com')
 with check(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com');
create policy research_access_links_staff_all on public.research_access_links for all to authenticated
 using(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com')
 with check(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com');
create policy research_metrics_staff_all on public.research_metrics for all to authenticated
 using(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com')
 with check(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com');
create policy research_review_memberships_staff_all on public.research_review_memberships for all to authenticated
 using(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com')
 with check(lower(coalesce((select auth.jwt())->>'email','')) like '%@beveridgelawfirm.com');

-- This is intentionally a definer projection: anon has no base-table grant.
-- The view exposes only explicitly selected public fields, only published rows,
-- and only public/legal access links. security_barrier prevents caller predicates
-- from being pushed through the projection.
create or replace view public.research_public_catalog
with (security_barrier = true)
as
select
  p.id,
  p.slug,
  p.title,
  p.authors_text,
  p.publication_year,
  p.journal_or_publisher,
  p.doi,
  p.source_type,
  p.country_text,
  p.citation_text,
  p.abstract_summary,
  p.overall_findings_summary,
  p.limitations_summary,
  p.what_it_supports,
  p.what_it_does_not_establish,
  p.finding_direction,
  p.topics,
  p.evidence_strength_score,
  p.impact_score,
  p.equal_parenting_relevance_score,
  p.historical_field_importance_score,
  p.published_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',s.id,
      'study_label',s.study_label,
      'country_text',s.country_text,
      'sample_size',s.sample_size,
      'child_age_text',s.child_age_text,
      'age_min',s.age_min,
      'age_max',s.age_max,
      'parenting_time_definition',s.parenting_time_definition,
      'shared_time_min_percent',s.shared_time_min_percent,
      'shared_time_max_percent',s.shared_time_max_percent,
      'exact_or_near_50_50',s.exact_or_near_50_50,
      'comparator',s.comparator,
      'study_design',s.study_design,
      'outcomes_measured',s.outcomes_measured,
      'controls_summary',s.controls_summary,
      'longitudinal',s.longitudinal,
      'pre_separation_controls',s.pre_separation_controls,
      'conflict_controls',s.conflict_controls,
      'ses_controls',s.ses_controls,
      'effect_size_summary',s.effect_size_summary,
      'result_direction',s.result_direction,
      'result_summary',s.result_summary,
      'key_limitation',s.key_limitation,
      'causal_claim_strength',s.causal_claim_strength
    ) order by s.study_label)
    from public.research_studies s
    where s.publication_id=p.id and s.extraction_status='verified'
  ),'[]'::jsonb) as studies,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'link_type',a.link_type,
      'url',a.url,
      'access_status',a.access_status,
      'license_text',a.license_text,
      'redistribution_permitted',a.redistribution_permitted,
      'is_preferred',a.is_preferred,
      'checked_at',a.checked_at
    ) order by a.is_preferred desc,a.link_type,a.url)
    from public.research_access_links a
    where a.publication_id=p.id
      and a.is_public=true
      and (a.link_type<>'mio_public_copy' or a.redistribution_permitted=true)
  ),'[]'::jsonb) as access_links,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'provider',m.provider,
      'metric_type',m.metric_type,
      'metric_value',m.metric_value,
      'source_url',m.source_url,
      'captured_at',m.captured_at
    ) order by m.captured_at desc)
    from public.research_metrics m
    where m.publication_id=p.id
  ),'[]'::jsonb) as metrics
from public.research_publications p
where p.editorial_status='published';

revoke all on public.research_public_catalog from public;
revoke all on public.research_public_catalog from anon,authenticated;
grant select on public.research_public_catalog to anon,authenticated;
