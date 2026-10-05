-- Additive only. E-filing drafts and activity events for the direct Tyler EFSP
-- integration foundation. No live submission path is enabled by this migration;
-- production and stage submission remain gated by feature flags in the app.

create table if not exists public.mio_efiling_drafts (
  id uuid not null default gen_random_uuid() primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  matter_id uuid not null,
  document_id text,
  schema_version text not null default 'efiling-draft-v1',
  revision bigint not null default 0 check (revision >= 0),
  draft jsonb not null default '{}'::jsonb check (jsonb_typeof(draft) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mio_efiling_events (
  id uuid not null default gen_random_uuid() primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  matter_id uuid not null,
  draft_id uuid references public.mio_efiling_drafts(id) on delete cascade,
  event_type text not null,
  event jsonb not null default '{}'::jsonb check (jsonb_typeof(event) = 'object'),
  recorded_at timestamptz not null default now()
);

create index if not exists mio_efiling_drafts_owner_matter_idx on public.mio_efiling_drafts (owner_id, matter_id);
create index if not exists mio_efiling_events_owner_matter_idx on public.mio_efiling_events (owner_id, matter_id);

alter table public.mio_efiling_drafts enable row level security;
alter table public.mio_efiling_events enable row level security;

create policy mio_efiling_drafts_read_own on public.mio_efiling_drafts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy mio_efiling_events_read_own on public.mio_efiling_events
  for select to authenticated using ((select auth.uid()) = owner_id);

revoke all on public.mio_efiling_drafts, public.mio_efiling_events from anon, authenticated;
grant select on public.mio_efiling_drafts, public.mio_efiling_events to authenticated;

create or replace function public.mio_save_efiling_draft_v1(
  p_owner_id uuid,
  p_draft_id uuid,
  p_matter_id uuid,
  p_expected_revision bigint,
  p_draft jsonb,
  p_event_type text,
  p_event jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.mio_efiling_drafts;
begin
  if auth.uid() is null or auth.uid() is distinct from p_owner_id then
    raise exception 'Account mismatch.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_draft) is distinct from 'object' then
    raise exception 'Invalid draft.' using errcode = '22023';
  end if;
  if coalesce(p_draft ->> 'matterId', '') = '' then
    raise exception 'Matter is required.' using errcode = '22023';
  end if;
  if octet_length(p_draft::text) > 524288 then
    raise exception 'Store document bytes outside the draft.' using errcode = '22023';
  end if;

  if p_draft_id is not null then
    select * into r from public.mio_efiling_drafts where id = p_draft_id and owner_id = p_owner_id;
    if found then
      if r.revision <> coalesce(p_expected_revision, 0) then
        raise exception 'Draft changed in another window. Refresh before saving.' using errcode = '40001';
      end if;
      update public.mio_efiling_drafts
        set draft = p_draft,
            matter_id = p_matter_id,
            document_id = nullif(p_draft ->> 'documentId', ''),
            revision = r.revision + 1,
            updated_at = clock_timestamp()
        where id = p_draft_id
        returning * into r;
    else
      insert into public.mio_efiling_drafts (id, owner_id, matter_id, document_id, schema_version, revision, draft)
      values (p_draft_id, p_owner_id, p_matter_id, nullif(p_draft ->> 'documentId', ''), 'efiling-draft-v1', 1, p_draft)
      returning * into r;
    end if;
  else
    insert into public.mio_efiling_drafts (owner_id, matter_id, document_id, schema_version, revision, draft)
    values (p_owner_id, p_matter_id, nullif(p_draft ->> 'documentId', ''), 'efiling-draft-v1', 1, p_draft)
    returning * into r;
  end if;

  if coalesce(p_event_type, '') <> '' then
    insert into public.mio_efiling_events (owner_id, matter_id, draft_id, event_type, event)
    values (p_owner_id, p_matter_id, r.id, p_event_type, p_event);
  end if;

  return to_jsonb(r);
end;
$$;

revoke all on function public.mio_save_efiling_draft_v1(uuid, uuid, uuid, bigint, jsonb, text, jsonb) from public, anon;
grant execute on function public.mio_save_efiling_draft_v1(uuid, uuid, uuid, bigint, jsonb, text, jsonb) to authenticated;
