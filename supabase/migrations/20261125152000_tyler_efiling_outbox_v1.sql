-- Tyler EFSP durable outbound reservation. No network sender is activated.
create table if not exists public.mio_efiling_outbox (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 matter_id text not null check (length(trim(matter_id)) between 1 and 256),
 environment text not null check (environment in ('stage','production')),
 idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 256),
 fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
 state text not null default 'reserved' check (state in ('reserved','uncertain','confirmed')),
 envelope_id text,
 filing_ids text[] not null default '{}'::text[],
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (owner_id, environment, idempotency_key)
);
create index if not exists mio_efiling_outbox_owner_matter_idx
 on public.mio_efiling_outbox (owner_id, matter_id, updated_at desc);
alter table public.mio_efiling_outbox enable row level security;
revoke all on public.mio_efiling_outbox from public, anon, authenticated;
grant select, insert, update on public.mio_efiling_outbox to service_role;

-- Return acquired=true only for the first durable reservation.
-- Every subsequent request with the same key is blocked from network delivery.
create or replace function public.mio_reserve_efiling_outbound_v1(
 p_owner_id uuid, p_matter_id text, p_environment text,
 p_idempotency_key text, p_fingerprint text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.mio_efiling_outbox%rowtype; created boolean := false;
begin
 if p_owner_id is null or
    not exists (select 1 from auth.users where id=p_owner_id) or
    p_matter_id is null or length(trim(p_matter_id)) not between 1 and 256 or
    p_environment not in ('stage','production') or
    p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 256 or
    p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
  raise exception 'Invalid outbound reservation' using errcode='22023';
 end if;
 insert into public.mio_efiling_outbox(owner_id,matter_id,environment,idempotency_key,fingerprint)
 values(p_owner_id,p_matter_id,p_environment,p_idempotency_key,p_fingerprint)
 on conflict(owner_id,environment,idempotency_key) do nothing returning * into r;
 if found then
  created := true;
 else
  select * into r from public.mio_efiling_outbox
   where owner_id=p_owner_id and environment=p_environment and idempotency_key=p_idempotency_key;
  if r.id is null or r.fingerprint<>p_fingerprint or r.matter_id<>p_matter_id then
   raise exception 'Conflicting outbound reservation' using errcode='23505';
  end if;
 end if;
 return jsonb_build_object('acquired',created,'id',r.id,'fingerprint',r.fingerprint,
  'state',r.state);
end; $$;
revoke all on function public.mio_reserve_efiling_outbound_v1(uuid,text,text,text,text)
 from public,anon,authenticated;
grant execute on function public.mio_reserve_efiling_outbound_v1(uuid,text,text,text,text)
 to service_role;

-- Confirmation happens after a verified Tyler response. This function binds
-- the outbox, original owner and confirmed Tyler IDs transactionally.
create or replace function public.mio_confirm_efiling_outbound_v1(
 p_owner_id uuid, p_environment text, p_idempotency_key text,
 p_fingerprint text, p_envelope_id text, p_filing_ids text[], p_draft_id text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.mio_efiling_outbox%rowtype; filing uuid; fid text;
begin
 select * into r from public.mio_efiling_outbox where owner_id=p_owner_id
  and environment=p_environment and idempotency_key=p_idempotency_key
  for update;
 if not found or r.fingerprint is distinct from p_fingerprint then
  raise exception 'Missing outbound reservation' using errcode='23503';
 end if;
 if p_filing_ids is null or cardinality(p_filing_ids) not between 1 and 100 or
    exists(select 1 from unnest(p_filing_ids) as t(fid) where t.fid is null or length(trim(t.fid)) not between 1 and 256) or
    (select count(distinct t.fid) from unnest(p_filing_ids) as t(fid)) <> cardinality(p_filing_ids) then
   raise exception 'Invalid Tyler filing IDs' using errcode='22023';
 end if;
 if r.state='confirmed' then
  if r.envelope_id is distinct from p_envelope_id or r.filing_ids is distinct from p_filing_ids then
   raise exception 'Conflicting confirmed Tyler identifiers' using errcode='23505';
  end if;
 else
  foreach fid in array p_filing_ids loop
   filing := public.mio_register_efiling_submission_v1(
    r.owner_id, r.matter_id,r.environment,p_envelope_id,fid,p_draft_id);
  end loop;
  update public.mio_efiling_outbox set state='confirmed',
   envelope_id=p_envelope_id,filing_ids=p_filing_ids,updated_at=clock_timestamp()
   where id=r.id;
 end if;
 return jsonb_build_object('confirmed',true,'reservation_id',r.id,
  'envelope_id',p_envelope_id,'filing_ids',to_jsonb(p_filing_ids));
end; $$;
revoke all on function public.mio_confirm_efiling_outbound_v1(uuid,text,text,text,text,text[],text)
 from public,anon,authenticated;
grant execute on function public.mio_confirm_efiling_outbound_v1(uuid,text,text,text,text,text,text)
 to service_role;

-- An ambiguous send may be marked uncertain for manual reconciliation;
-- it must never be returned to an automatically retryable state.
create or replace function public.mio_mark_efiling_outbound_uncertain_v1(
 p_owner_id uuid,p_environment text,p_idempotency_key text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed int;
begin
 update public.mio_efiling_outbox set state='uncertain',updated_at=clock_timestamp()
  where owner_id=p_owner_id and environment=p_environment
    and idempotency_key=p_idempotency_key and state='reserved';
 get diagnostics changed = row_count;
 return changed=1;
end; $$;
revoke all on function public.mio_mark_efiling_outbound_uncertain_v1(uuid,text,text)
 from public,anon,authenticated;
grant execute on function public.mio_mark_efiling_outbound_uncertain_v1(uuid,text,text)
 to service_role;
