-- Harden Equal Parenting Research public reads.
-- Use a SECURITY INVOKER view with column-level anonymous grants and RLS,
-- rather than a SECURITY DEFINER projection.

drop policy if exists research_publications_anon_published on public.research_publications;
create policy research_publications_anon_published
on public.research_publications for select to anon
using (editorial_status = 'published');

drop policy if exists research_studies_anon_published on public.research_studies;
create policy research_studies_anon_published
on public.research_studies for select to anon
using (
  extraction_status = 'verified'
  and exists (
    select 1 from public.research_publications p
    where p.id = research_studies.publication_id
      and p.editorial_status = 'published'
  )
);

drop policy if exists research_access_links_anon_published on public.research_access_links;
create policy research_access_links_anon_published
on public.research_access_links for select to anon
using (
  is_public = true
  and (link_type <> 'mio_public_copy' or redistribution_permitted = true)
  and exists (
    select 1 from public.research_publications p
    where p.id = research_access_links.publication_id
      and p.editorial_status = 'published'
  )
);

drop policy if exists research_metrics_anon_published on public.research_metrics;
create policy research_metrics_anon_published
on public.research_metrics for select to anon
using (
  exists (
    select 1 from public.research_publications p
    where p.id = research_metrics.publication_id
      and p.editorial_status = 'published'
  )
);

revoke all on public.research_publications from anon;
grant select (
  id, slug, title, authors_text, publication_year, journal_or_publisher, doi,
  source_type, country_text, citation_text, abstract_summary,
  overall_findings_summary, limitations_summary, what_it_supports,
  what_it_does_not_establish, finding_direction, topics,
  evidence_strength_score, impact_score, equal_parenting_relevance_score,
  historical_field_importance_score, published_at
) on public.research_publications to anon;

revoke all on public.research_studies from anon;
grant select (
  id, publication_id, study_label, country_text, sample_size, child_age_text,
  age_min, age_max, parenting_time_definition, shared_time_min_percent,
  shared_time_max_percent, exact_or_near_50_50, comparator, study_design,
  outcomes_measured, controls_summary, longitudinal, pre_separation_controls,
  conflict_controls, ses_controls, effect_size_summary, result_direction,
  result_summary, key_limitation, causal_claim_strength, extraction_status
) on public.research_studies to anon;

revoke all on public.research_access_links from anon;
grant select (
  publication_id, link_type, url, access_status, license_text,
  redistribution_permitted, is_preferred, checked_at, is_public
) on public.research_access_links to anon;

revoke all on public.research_metrics from anon;
grant select (
  publication_id, provider, metric_type, metric_value, source_url, captured_at
) on public.research_metrics to anon;

create or replace view public.research_public_catalog
with (security_invoker = true, security_barrier = true)
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
revoke all on public.research_public_catalog from anon, authenticated;
grant select on public.research_public_catalog to anon, authenticated;
