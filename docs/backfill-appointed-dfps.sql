-- =============================================================================
-- Backfill the "Appointed" classification for all court-appointed DFPS matters.
-- TO RUN: Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--
-- Idempotent: re-running re-asserts DFPS appointments while preserving any
-- non-DFPS matter settings and any manual overrides you have since saved.
--
-- Effect: each DFPS matter becomes { appointed: true, included: false,
-- shareTrust: false } in mioWeeklyBillingSettingsV1, so Weekly Billing and
-- trust-based withdrawal review exclude them by default. You can still flip a
-- matter's "Weekly Billing" checkbox back on in Settings for an exception
-- (this does not change its Appointed flag).
-- =============================================================================

do $$
declare
  dfps jsonb;
begin
  select coalesce(jsonb_object_agg(id::text, jsonb_build_object('appointed', true, 'included', false, 'shareTrust', false)), '{}'::jsonb)
    into dfps
    from public.matters where matter_type ilike 'dfps%';

  insert into public.case_mio_user_state (user_id, key, json_value, raw_value, origin, updated_at)
  values ('726c048e-cc35-4364-b17f-acaf64bcf293'::uuid, 'mioWeeklyBillingSettingsV1',
          jsonb_build_object('matters', dfps), jsonb_build_object('matters', dfps)::text,
          'appointed_backfill', now())
  on conflict (user_id, key) do update
  set json_value = jsonb_build_object('matters', (case_mio_user_state.json_value->'matters') || dfps),
      raw_value  = jsonb_build_object('matters', (case_mio_user_state.json_value->'matters') || dfps)::text,
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
