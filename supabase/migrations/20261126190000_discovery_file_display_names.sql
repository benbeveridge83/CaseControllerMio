-- Names are display metadata; private object paths and request links stay intact.
alter table public.mio_portal_discovery_files
 add column if not exists original_filename text,
 add column if not exists folder_name text,
 add column if not exists relative_path text;
