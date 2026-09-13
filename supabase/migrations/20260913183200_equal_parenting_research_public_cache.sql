-- Replace the public research view with a physically sanitized cache table.
-- Anonymous users never receive SELECT on the private research source tables.

drop view if exists public.research_public_catalog;

create table if not exists public.research_public_catalog (
  id uuid primary key,
  slug text not null unique,
  title text not null,
  authors_text text not null default '',
  publication_year integer,
  journal_or_publisher text,
  doi text,
  source_type text not null,
  country_text text,
  citation_text text,
  abstract_summary text,
  overall_findings_summary text,
  limitations_summary text,
  what_it_supports text,
  what_it_does_not_establish text,
  finding_direction text not null,
  topics text[] not null default '{}',
  evidence_strength_score integer,
  impact_score integer,
  equal_parenting_relevance_score integer,
  historical_field_importance_score integer,
  published_at timestamptz,
  studies jsonb not null default '[]'::jsonb,
  access_links jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz not null default now()
);

alter table public.research_public_catalog enable row level security;
revoke all on public.research_public_catalog from public, anon, authenticated;
grant select on public.research_public_catalog to anon, authenticated;
drop policy if exists research_public_catalog_read on public.research_public_catalog;
create policy research_public_catalog_read on public.research_public_catalog
for select to anon, authenticated using (true);

-- Anonymous access to private source tables is never required.
revoke all on public.research_publications from anon;
revoke all on public.research_studies from anon;
revoke all on public.research_access_links from anon;
revoke all on public.research_metrics from anon;
drop policy if exists research_publications_anon_published on public.research_publications;
drop policy if exists research_studies_anon_published on public.research_studies;
drop policy if exists research_access_links_anon_published on public.research_access_links;
drop policy if exists research_metrics_anon_published on public.research_metrics;

create or replace function public.research_refresh_public_catalog(p_publication_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.research_publications p
    where p.id = p_publication_id and p.editorial_status = 'published'
  ) then
    delete from public.research_public_catalog where id = p_publication_id;
    return;
  end if;

  insert into public.research_public_catalog (
    id,slug,title,authors_text,publication_year,journal_or_publisher,doi,source_type,
    country_text,citation_text,abstract_summary,overall_findings_summary,
    limitations_summary,what_it_supports,what_it_does_not_establish,
    finding_direction,topics,evidence_strength_score,impact_score,
    equal_parenting_relevance_score,historical_field_importance_score,published_at,
    studies,access_links,metrics,refreshed_at
  )
  select
    p.id,p.slug,p.title,p.authors_text,p.publication_year,p.journal_or_publisher,p.doi,p.source_type,
    p.country_text,p.citation_text,p.abstract_summary,p.overall_findings_summary,
    p.limitations_summary,p.what_it_supports,p.what_it_does_not_establish,
    p.finding_direction,p.topics,p.evidence_strength_score,p.impact_score,
    p.equal_parenting_relevance_score,p.historical_field_importance_score,p.published_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'study_label',s.study_label,'country_text',s.country_text,
        'sample_size',s.sample_size,'child_age_text',s.child_age_text,
        'age_min',s.age_min,'age_max',s.age_max,
        'parenting_time_definition',s.parenting_time_definition,
        'shared_time_min_percent',s.shared_time_min_percent,
        'shared_time_max_percent',s.shared_time_max_percent,
        'exact_or_near_50_50',s.exact_or_near_50_50,'comparator',s.comparator,
        'study_design',s.study_design,'outcomes_measured',s.outcomes_measured,
        'controls_summary',s.controls_summary,'longitudinal',s.longitudinal,
        'pre_separation_controls',s.pre_separation_controls,
        'conflict_controls',s.conflict_controls,'ses_controls',s.ses_controls,
        'effect_size_summary',s.effect_size_summary,'result_direction',s.result_direction,
        'result_summary',s.result_summary,'key_limitation',s.key_limitation,
        'causal_claim_strength',s.causal_claim_strength
      ) order by s.study_label)
      from public.research_studies s
      where s.publication_id=p.id and s.extraction_status='verified'
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_type',a.link_type,'url',a.url,'access_status',a.access_status,
        'license_text',a.license_text,'redistribution_permitted',a.redistribution_permitted,
        'is_preferred',a.is_preferred,'checked_at',a.checked_at
      ) order by a.is_preferred desc,a.link_type,a.url)
      from public.research_access_links a
      where a.publication_id=p.id and a.is_public=true
        and (a.link_type<>'mio_public_copy' or a.redistribution_permitted=true)
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider',m.provider,'metric_type',m.metric_type,'metric_value',m.metric_value,
        'source_url',m.source_url,'captured_at',m.captured_at
      ) order by m.captured_at desc)
      from public.research_metrics m where m.publication_id=p.id
    ),'[]'::jsonb),
    now()
  from public.research_publications p
  where p.id = p_publication_id
  on conflict (id) do update set
    slug=excluded.slug,title=excluded.title,authors_text=excluded.authors_text,
    publication_year=excluded.publication_year,journal_or_publisher=excluded.journal_or_publisher,
    doi=excluded.doi,source_type=excluded.source_type,country_text=excluded.country_text,
    citation_text=excluded.citation_text,abstract_summary=excluded.abstract_summary,
    overall_findings_summary=excluded.overall_findings_summary,
    limitations_summary=excluded.limitations_summary,what_it_supports=excluded.what_it_supports,
    what_it_does_not_establish=excluded.what_it_does_not_establish,
    finding_direction=excluded.finding_direction,topics=excluded.topics,
    evidence_strength_score=excluded.evidence_strength_score,impact_score=excluded.impact_score,
    equal_parenting_relevance_score=excluded.equal_parenting_relevance_score,
    historical_field_importance_score=excluded.historical_field_importance_score,
    published_at=excluded.published_at,studies=excluded.studies,
    access_links=excluded.access_links,metrics=excluded.metrics,refreshed_at=excluded.refreshed_at;
end;
$$;
revoke all on function public.research_refresh_public_catalog(uuid) from public, anon, authenticated;

create or replace function public.research_public_catalog_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare target_id uuid;
begin
  if tg_table_name = 'research_publications' then
    target_id := coalesce(new.id, old.id);
  else
    target_id := coalesce(new.publication_id, old.publication_id);
  end if;
  perform public.research_refresh_public_catalog(target_id);
  return coalesce(new, old);
end;
$$;
revoke all on function public.research_public_catalog_trigger() from public, anon, authenticated;

drop trigger if exists research_publications_refresh_public_catalog on public.research_publications;
create trigger research_publications_refresh_public_catalog
after insert or update or delete on public.research_publications
for each row execute function public.research_public_catalog_trigger();

drop trigger if exists research_studies_refresh_public_catalog on public.research_studies;
create trigger research_studies_refresh_public_catalog
after insert or update or delete on public.research_studies
for each row execute function public.research_public_catalog_trigger();

drop trigger if exists research_access_links_refresh_public_catalog on public.research_access_links;
create trigger research_access_links_refresh_public_catalog
after insert or update or delete on public.research_access_links
for each row execute function public.research_public_catalog_trigger();

drop trigger if exists research_metrics_refresh_public_catalog on public.research_metrics;
create trigger research_metrics_refresh_public_catalog
after insert or update or delete on public.research_metrics
for each row execute function public.research_public_catalog_trigger();

do $$
declare r record;
begin
  for r in select id from public.research_publications where editorial_status='published' loop
    perform public.research_refresh_public_catalog(r.id);
  end loop;
end $$;
