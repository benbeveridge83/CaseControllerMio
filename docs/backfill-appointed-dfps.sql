-- =============================================================================
-- Backfill the "Appointed" classification for all court-appointed DFPS matters.
-- TO RUN: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--
-- Idempotent and non-destructive:
--   * Preserves every existing top-level weekly-billing setting (minimumWip,
--     enableAtomicWeeklyTrustPosting, and any others).
--   * Preserves every deliberate per-matter exception already saved — a DFPS
--     matter that already has a setting (e.g. an "included: true" billing
--     override, or an explicit "appointed: false") is left exactly as-is.
--   * Only adds the default { appointed: true, included: false, shareTrust: false }
--     to DFPS matters that are not already present in the settings.
--
-- Effect: each DFPS matter becomes appointed/excluded by default, so Weekly
-- Billing and trust-based withdrawal review exclude them. You can still flip a
-- matter's "Weekly Billing" checkbox back on in Settings for an exception
-- (this does not change its Appointed flag).
-- =============================================================================

do $$
declare
  dfps jsonb;
  merged jsonb;
begin
  select coalesce(jsonb_object_agg(id::text, jsonb_build_object('appointed', true, 'included', false, 'shareTrust', false)), '{}'::jsonb)
    into dfps
    from public.matters where matter_type ilike 'dfps%';

  -- Existing matter settings win on any key collision; DFPS defaults only fill gaps.
  merged := dfps || coalesce(
    (select json_value->'matters' from public.case_mio_user_state
      where user_id = '726c048e-cc35-4364-b17f-acaf64bcf293' and key = 'mioWeeklyBillingSettingsV1'),
    '{}'::jsonb);

  insert into public.case_mio_user_state (user_id, key, json_value, raw_value, origin, updated_at)
  values ('726c048e-cc35-4364-b17f-acaf64bcf293'::uuid, 'mioWeeklyBillingSettingsV1',
          jsonb_build_object('matters', merged), jsonb_build_object('matters', merged)::text,
          'appointed_backfill', now())
  on conflict (user_id, key) do update
  set json_value = coalesce(case_mio_user_state.json_value, '{}'::jsonb) || jsonb_build_object('matters', merged),
      raw_value  = (coalesce(case_mio_user_state.json_value, '{}'::jsonb) || jsonb_build_object('matters', merged))::text,
      origin     = 'appointed_backfill',
      updated_at = now();
end $$;

-- Report how many matters are now marked appointed.
select count(*) as appointed_matter_count
from public.case_mio_user_state s
cross join lateral jsonb_each(s.json_value->'matters') m(key, value)
where s.user_id = '726c048e-cc35-4364-b17f-acaf64bcf293'
  and s.key = 'mioWeeklyBillingSettingsV1'
  and (m.value->>'appointed')::boolean is true;
