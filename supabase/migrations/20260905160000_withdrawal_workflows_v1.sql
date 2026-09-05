-- Additive only. Existing matters, old checklists, mail and filings are untouched.
create table if not exists public.mio_withdrawal_workflows (
 owner_id uuid not null references auth.users(id), matter_id uuid not null,
 revision bigint not null default 0 check(revision>=0),
 state jsonb not null default '{}'::jsonb check(jsonb_typeof(state)='object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,matter_id)
);
create table if not exists public.mio_withdrawal_events (
 owner_id uuid not null, matter_id uuid not null, event_id uuid not null, revision bigint not null,
 event jsonb not null check(jsonb_typeof(event)='object'), state_after jsonb not null,
 recorded_at timestamptz not null default now(), primary key(owner_id,event_id),
 unique(owner_id,matter_id,revision),
 foreign key(owner_id,matter_id) references public.mio_withdrawal_workflows(owner_id,matter_id)
);
alter table public.mio_withdrawal_workflows enable row level security;
alter table public.mio_withdrawal_events enable row level security;
create policy mio_withdrawal_read_own on public.mio_withdrawal_workflows for select to authenticated using((select auth.uid())=owner_id);
create policy mio_withdrawal_events_read_own on public.mio_withdrawal_events for select to authenticated using((select auth.uid())=owner_id);
revoke all on public.mio_withdrawal_workflows,public.mio_withdrawal_events from anon,authenticated;
grant select on public.mio_withdrawal_workflows,public.mio_withdrawal_events to authenticated;
create or replace function public.mio_save_withdrawal_v1(p_owner_id uuid,p_matter_id uuid,p_expected_revision bigint,p_state jsonb,p_event_id uuid,p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.mio_withdrawal_workflows; old_event public.mio_withdrawal_events; entry record; key_name text;
begin
 if auth.uid() is null or auth.uid() is distinct from p_owner_id then raise exception 'Account mismatch.' using errcode='42501'; end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'Expected revision is required.' using errcode='22023'; end if;
 -- Matches the existing authenticated SELECT scope of public.matters; no anonymous lookup.
 if not exists(select 1 from public.matters where id=p_matter_id) then raise exception 'Matter not found.' using errcode='22023'; end if;
 if jsonb_typeof(p_state) is distinct from 'object' or p_state->>'matter_id' is distinct from p_matter_id::text or p_state->>'schema_version' is distinct from '1' or jsonb_typeof(p_state->'steps') is distinct from 'object' then raise exception 'Invalid workflow.' using errcode='22023'; end if;
 if coalesce(p_state->>'status','') not in ('active','complete') then raise exception 'Invalid workflow status.' using errcode='22023'; end if;
 if jsonb_typeof(p_event) is distinct from 'object' or coalesce(p_event->>'type','')='' or p_event_id is null then raise exception 'Audit event required.' using errcode='22023'; end if;
 if octet_length(p_state::text)>524288 or octet_length(p_event::text)>65536 then raise exception 'Store document bytes outside workflow state.' using errcode='22023'; end if;
 foreach key_name in array array['decision','drafting','filing','service','client_signature','opposing_signature','agreed_submission','setting','notice','hearing','signed_order','setting_cleanup','reply_review','status_update','closeout_email','close_workflow'] loop
  if jsonb_typeof(p_state->'steps'->key_name) is distinct from 'object' then raise exception 'Required step missing: %',key_name using errcode='22023'; end if;
 end loop;
 insert into public.mio_withdrawal_workflows(owner_id,matter_id) values(p_owner_id,p_matter_id) on conflict do nothing;
 select * into r from public.mio_withdrawal_workflows where owner_id=p_owner_id and matter_id=p_matter_id for update;
 select * into old_event from public.mio_withdrawal_events where owner_id=p_owner_id and event_id=p_event_id;
 if found then
  if old_event.matter_id<>p_matter_id or old_event.event<>p_event or old_event.state_after<>p_state then raise exception 'Event ID reused with different content.' using errcode='22023'; end if;
  return to_jsonb(r);
 end if;
 if r.revision<>p_expected_revision then raise exception 'Workflow changed in another window. Refresh before saving.' using errcode='40001'; end if;
 if r.state->>'status'='complete' then raise exception 'Closed workflows cannot be modified.' using errcode='22023'; end if;
 for entry in select key,value from jsonb_each(p_state->'steps') loop
  if coalesce(entry.value->>'status','') not in ('not_started','needs_action','needs_approval','waiting','complete','cancelled') then raise exception 'Invalid step status.' using errcode='22023'; end if;
  if entry.value->>'status'='complete' then
   if coalesce(entry.value#>>'{evidence,reference}','')='' then raise exception 'Completion evidence required.' using errcode='22023'; end if;
   if r.state->'steps'->entry.key->>'status' is distinct from 'complete' and (p_event->>'type' is distinct from 'step_update' or p_event->>'step_id' is distinct from entry.key or p_event->>'confirmed' is distinct from 'true') then raise exception 'Explicit completion confirmation required.' using errcode='22023'; end if;
  end if;
 end loop;
 if p_state#>>'{steps,status_update,status}'='complete' and r.state#>>'{steps,status_update,status}' is distinct from 'complete' and not exists(select 1 from public.matters where id=p_matter_id and case_status='Order Need to Close') then raise exception 'Matter status was not updated.' using errcode='22023'; end if;
 if p_state#>>'{steps,signed_order,status}'='complete' and coalesce(p_state#>>'{steps,signed_order,evidence,document_id}','')='' then raise exception 'Actual signed-order document required.' using errcode='22023'; end if;
 if p_state#>>'{steps,closeout_email,status}'='complete' and (coalesce(p_state#>>'{closeout,sent_at}','')='' or p_state#>>'{closeout,links_verified}' is distinct from 'true' or p_state#>>'{closeout,delivery_confirmed}' is distinct from 'true') then raise exception 'Verified sending, client links and delivery are required.' using errcode='22023'; end if;
 if p_state#>>'{closeout,links_verified}'='true' then
  foreach key_name in array array['invoices','efilings','documents'] loop
   if coalesce(p_state->'closeout'->'links'->>key_name,'') !~ '^https://[^[:space:]]+$' then raise exception 'Client links must use HTTPS.' using errcode='22023'; end if;
  end loop;
 end if;
 if p_state->>'status'='complete' and (p_state#>>'{steps,setting_cleanup,status}' not in ('not_started','complete','cancelled') or p_state#>>'{steps,reply_review,status}' not in ('not_started','complete','cancelled') or p_state#>>'{steps,close_workflow,status}' is distinct from 'complete' or p_state#>>'{steps,signed_order,status}' is distinct from 'complete' or p_state#>>'{steps,status_update,status}' is distinct from 'complete' or p_state#>>'{steps,closeout_email,status}' is distinct from 'complete') then raise exception 'Closeout requirements are incomplete.' using errcode='22023'; end if;
 update public.mio_withdrawal_workflows set state=p_state,revision=r.revision+1,updated_at=clock_timestamp() where owner_id=p_owner_id and matter_id=p_matter_id returning * into r;
 insert into public.mio_withdrawal_events(owner_id,matter_id,event_id,revision,event,state_after) values(p_owner_id,p_matter_id,p_event_id,r.revision,p_event,p_state);
 return to_jsonb(r);
end;
$$;
revoke all on function public.mio_save_withdrawal_v1(uuid,uuid,bigint,jsonb,uuid,jsonb) from public,anon;
grant execute on function public.mio_save_withdrawal_v1(uuid,uuid,bigint,jsonb,uuid,jsonb) to authenticated;
