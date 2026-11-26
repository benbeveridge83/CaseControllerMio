-- Retain unfinished upload intents for recovery without showing canceled uploads.
alter table public.mio_portal_discovery_files add column if not exists abandoned_at timestamptz;
