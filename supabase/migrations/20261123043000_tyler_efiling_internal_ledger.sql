-- Internal Tyler ECF5 filing ledger. Additive, non-filing, and fail-closed.
-- Matter IDs use text because Mio's in-app matter keys are not guaranteed UUIDs.
create table if not exists public.mio_efiling_submissions (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 matter_id text not null check (length(trim(matter_id)) between 1 and 256),
 draft_id text,
 environment text not null check (environment in ('stage','production')),
 provider text not null default 'tyler' check (provider = 'tyler'),
 envelope_id text not null check (length(trim(envelope_id)) between 1 and 256),
 filing_id text not null check (length(trim(filing_id)) between 1 and 256),
 status text not null default 'submitted' check (status in ('submitted','under_review','accepted','rejected','unknown')),
 status_details text,
 submitted_at timestamptz not null default now(),
 reviewed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique (environment, envelope_id, filing_id)
);
create index if not exists mio_efiling_submissions_owner_matter_idx
 on public.mio_efiling_submissions(owner_id,matter_id,updated_at desc);

create table if not exists public.mio_efiling_callback_receipts (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public.mio_efiling_submissions(id) on delete restrict,
 environment text not null check(environment in ('stage','production')),
 message_id text not null check(length(trim(message_id)) between 1 and 256),
 envelope_id text not null,
 filing_id text not null,
 outcome text not null check(outcome in ('accepted','rejected','under_review','unknown')),
 reviewer_comments text,
 completion_date timestamptz,
 payload_sha256 text not null check(payload_sha256 ~ '^[a-f0-9]{64}$'),
 received_at timestamptz not null default clock_timestamp(),
 unique(environment,message_id)
);
create index if not exists mio_efiling_callback_receipts_submission_idx
 on public.mio_efiling_callback_receipts(submission_id,received_at desc);

create table if not exists public.mio_efiling_status_audit (
 id bigint generated always as identity primary key,
 submission_id uuid not null references public.mio_efiling_submissions(id) on delete restrict,
 owner_id uuid not null references auth.users(id) on delete cascade,
 matter_id text not null,
 receipt_id uuid references public.mio_efiling_callback_receipts(id) on delete restrict,
 from_status text,
 to_status text not null,
 event_type text not null,
 recorded_at timestamptz not null default clock_timestamp()
);
create index if not exists mio_efiling_status_audit_owner_matter_idx
 on public.mio_efiling_status_audit(owner_id,matter_id,recorded_at desc);

alter table public.mio_efiling_submissions enable row level security;
alter table public.mio_efiling_callback_receipts enable row level security;
alter table public.mio_efiling_status_audit enable row level security;
revoke all on public.mio_efiling_submissions, public.mio_efiling_callback_receipts, public.mio_efiling_status_audit from public,anon,authenticated;
grant select on public.mio_efiling_submissions, public.mio_efiling_status_audit to authenticated;
create policy mio_efiling_submissions_owner_read on public.mio_efiling_submissions for select to authenticated
 using (owner_id = (select auth.uid()));
create policy mio_efiling_audit_owner_read on public.mio_efiling_status_audit for select to authenticated
 using (owner_id = (select auth.uid()));

-- Service-only atomic ledger write. The public Data API must never allow
-- client-side creation of a "Tyler" submission or callback.
create or replace function public.mio_record_efiling_callback_v1(
 p_environment text, p_message_id text, p_envelope_id text, p_filing_id text,
 p_outcome text, p_payload_sha256 text, p_comments text default null,
 p_completion_date timestamptz default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 s public.mio_efiling_submissions%rowtype;
 prior public.mio_efiling_callback_receipts%rowtype;
 receipt public.mio_efiling_callback_receipts%rowtype;
 old_status text;
begin
 if p_environment not in ('stage','production') or
    p_outcome not in ('accepted','rejected','under_review','unknown') or
    p_message_id is null or length(trim(p_message_id)) not between 1 and 256 or
    p_envelope_id is null or length(trim(p_envelope_id)) not between 1 and 256 or
    p_filing_id is null or length(trim(p_filing_id)) not between 1 and 256 or
    p_payload_sha256 !~ '^[a-f0-9]{64}$' then
     raise exception 'Invalid Tyler callback metadata' using errcode='22023';
 end if;
 -- A matching outbound submission is mandatory; the message cannot choose
 -- an owner or matter from untrusted callback attributes.
 select * into s from public.mio_efiling_submissions
  where environment=p_environment and envelope_id=p_envelope_id and filing_id=p_filing_id
  for update;
 if not found then raise exception 'Unknown outgoing filing' using errcode='23503'; end if;
 select * into prior from public.mio_efiling_callback_receipts
  where environment=p_environment and message_id=p_message_id;
 if found then
   if prior.submission_id<>s.id or prior.payload_sha256<>p_payload_sha256 or prior.outcome<>p_outcome then
      raise exception 'Conflicting Tyler callback message ID' using errcode='23505';
   end if;
   return jsonb_build_object('duplicate',true,'submission_id',s.id,'status',s.status);
 end if;
 -- Final decisions cannot be overridden by late out-of-order notifications.
 if s.status in ('accepted','rejected') and p_outcome <> s.status then
   raise exception 'Final filing decision cannot be overwritten' using errcode='23514';
 end if;
 insert into public.mio_efiling_callback_receipts(
  submission_id,environment,message_id,envelope_id,filing_id,outcome,reviewer_comments,completion_date,payload_sha256
 ) values (s.id,p_environment,p_message_id,p_envelope_id,p_filing_id,p_outcome,left(p_comments,10000),p_completion_date,p_payload_sha256)
 returning * into receipt;
 old_status:=s.status;
 -- Unknown does not destroy a previously known review status.
 if p_outcome <> 'unknown' and p_outcome <> s.status then
  update public.mio_efiling_submissions
   set status=p_outcome,status_details=left(p_comments,10000),
       reviewed_at=case when p_outcome in ('accepted','rejected') then coalesce(p_completion_date,clock_timestamp()) else reviewed_at end,
       updated_at=clock_timestamp()
   where id=s.id;
 end if;
 insert into public.mio_efiling_status_audit(
  submission_id,owner_id,matter_id,receipt_id,from_status,to_status,event_type
 ) values (s.id,s.owner_id,s.matter_id,receipt.id,old_status,
  case when p_outcome='unknown' then old_status else p_outcome end,'tyler_nfrc_received');
 return jsonb_build_object('duplicate',false,'submission_id',s.id,
  'status',case when p_outcome='unknown' then old_status else p_outcome end);
end; $$;

revoke all on function public.mio_record_efiling_callback_v1(text,text,text,text,text,text,text,timestamptz)
 from public,anon,authenticated;
grant execute on function public.mio_record_efiling_callback_v1(text,text,text,text,text,text,text,timestamptz)
 to service_role;
