-- Phase 1.5 research enrichment summaries and provenance.
-- Keep private editorial/source tables private; extend only the sanitized cache
-- with explicitly safe public summary fields.

alter table public.research_publications
  add column if not exists citation_count_current integer check(citation_count_current is null or citation_count_current >= 0),
  add column if not exists citation_count_provider text,
  add column if not exists citation_count_captured_at timestamptz,
  add column if not exists citations_per_year numeric,
  add column if not exists fwci_current numeric,
  add column if not exists influential_citation_count_current integer check(influential_citation_count_current is null or influential_citation_count_current >= 0),
  add column if not exists major_review_count integer not null default 0 check(major_review_count >= 0),
  add column if not exists impact_data_completeness integer check(impact_data_completeness is null or impact_data_completeness between 0 and 100),
  add column if not exists analysis_completion_status text not null default 'needs_enrichment'
    check(analysis_completion_status in ('needs_enrichment','ready_for_editorial_review','verified')),
  add column if not exists analysis_verified_at timestamptz;

alter table public.research_studies
  add column if not exists extraction_source_url text,
  add column if not exists verified_at timestamptz;

create index if not exists research_publications_citations_idx
  on public.research_publications(citation_count_current desc nulls last);
create index if not exists research_publications_impact_idx
  on public.research_publications(impact_score desc nulls last);
create index if not exists research_publications_analysis_status_idx
  on public.research_publications(analysis_completion_status, editorial_status);

alter table public.research_public_catalog
  add column if not exists citation_count_current integer,
  add column if not exists citation_count_provider text,
  add column if not exists citation_count_captured_at timestamptz,
  add column if not exists citations_per_year numeric,
  add column if not exists fwci_current numeric,
  add column if not exists influential_citation_count_current integer,
  add column if not exists major_review_count integer not null default 0,
  add column if not exists impact_data_completeness integer,
  add column if not exists analysis_completion_status text,
  add column if not exists analysis_verified_at timestamptz;

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
    citation_count_current,citation_count_provider,citation_count_captured_at,
    citations_per_year,fwci_current,influential_citation_count_current,
    major_review_count,impact_data_completeness,analysis_completion_status,
    analysis_verified_at,studies,access_links,metrics,refreshed_at
  )
  select
    p.id,p.slug,p.title,p.authors_text,p.publication_year,p.journal_or_publisher,p.doi,p.source_type,
    p.country_text,p.citation_text,p.abstract_summary,p.overall_findings_summary,
    p.limitations_summary,p.what_it_supports,p.what_it_does_not_establish,
    p.finding_direction,p.topics,p.evidence_strength_score,p.impact_score,
    p.equal_parenting_relevance_score,p.historical_field_importance_score,p.published_at,
    p.citation_count_current,p.citation_count_provider,p.citation_count_captured_at,
    p.citations_per_year,p.fwci_current,p.influential_citation_count_current,
    p.major_review_count,p.impact_data_completeness,p.analysis_completion_status,
    p.analysis_verified_at,
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
        'causal_claim_strength',s.causal_claim_strength,
        'extraction_source_url',s.extraction_source_url,'verified_at',s.verified_at
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
    published_at=excluded.published_at,
    citation_count_current=excluded.citation_count_current,
    citation_count_provider=excluded.citation_count_provider,
    citation_count_captured_at=excluded.citation_count_captured_at,
    citations_per_year=excluded.citations_per_year,
    fwci_current=excluded.fwci_current,
    influential_citation_count_current=excluded.influential_citation_count_current,
    major_review_count=excluded.major_review_count,
    impact_data_completeness=excluded.impact_data_completeness,
    analysis_completion_status=excluded.analysis_completion_status,
    analysis_verified_at=excluded.analysis_verified_at,
    studies=excluded.studies,access_links=excluded.access_links,metrics=excluded.metrics,
    refreshed_at=excluded.refreshed_at;
end;
$$;

revoke all on function public.research_refresh_public_catalog(uuid) from public, anon, authenticated;

-- Refresh any already-published records using the expanded safe projection.
do $$
declare r record;
begin
  for r in select id from public.research_publications where editorial_status='published' loop
    perform public.research_refresh_public_catalog(r.id);
  end loop;
end $$;
