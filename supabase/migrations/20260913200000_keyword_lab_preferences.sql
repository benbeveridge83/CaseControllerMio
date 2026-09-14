-- Uses the existing owner-only firm RLS; does not replace V317 column settings.
alter table public.mio_ads_preferences
 add column keyword_lab jsonb not null default '{}'::jsonb
 check (jsonb_typeof(keyword_lab) = 'object');
