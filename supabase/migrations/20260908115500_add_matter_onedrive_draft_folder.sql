alter table public.matters
  add column if not exists draft_folder text;
