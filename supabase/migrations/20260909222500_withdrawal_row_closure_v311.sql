-- Close only the tracking row. This does not certify completion of any legal step.
-- The original step-completion RPC and all its signed-order gates are unchanged.
create or replace function public.mio_close_withdrawal_row_v311(
 p_owner_id uuid, p_matter_id uuid, p_expected_revision bigint,
 p_state jsonb, p_event_id uuid, p_event jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
 r public.mio_withdrawal_workflows; audit public.mio_withdrawal_events;
 next_state jsonb; note text; previous_writer text;
begin
 if auth.uid() is null or auth.uid() is distinct from p_owner_id then
  raise exception 'Account mismatch.' using errcode='42501';
 end if;
 if p_expected_revision is null or p_expected_revision<0 or p_event_id is null then
  raise exception 'Revision and audit event required.' using errcode='22023';
 end if;
 if p_event->>'type' is distinct from 'workflow_complete' or p_event->>'confirmed' is distinct from 'true'
    or p_event->>'workspace_version' is distinct from '1' then
  raise exception 'Explicit row-closure confirmation required.' using errcode='22023';
 end if;
 note=btrim(coalesce(p_event->>'note',''));
 if length(note) not between 1 and 4000 or octet_length(p_event::text)>65536 then
  raise exception 'Provide a row-closure note of 1 to 4000 characters.' using errcode='22023';
 end if;
 select * into r from public.mio_withdrawal_workflows
  where owner_id=p_owner_id and matter_id=p_matter_id for update;
 if not found then raise exception 'Initialize this withdrawal first.' using errcode='22023'; end if;
 select * into audit from public.mio_withdrawal_events where owner_id=p_owner_id and event_id=p_event_id;
 if found then
  if audit.matter_id<>p_matter_id or audit.event<>p_event then
   raise exception 'Audit event ID reused.' using errcode='22023';
  end if;
  return to_jsonb(r);
 end if;
 if r.revision<>p_expected_revision then
  raise exception 'Workflow changed in another window. Refresh before saving.' using errcode='40001';
 end if;
 if r.state->>'status' is distinct from 'active' or r.state->>'paused'='true' then
  raise exception 'Resume an active withdrawal before closing the row.' using errcode='22023';
 end if;
 -- Deliberately ignore the client's proposed p_state. Only the row metadata below
 -- can change. Steps, evidence, notes, documents, definitions and client links remain identical.
 next_state=r.state || jsonb_build_object('status','complete','paused',false,'paused_at',null,
  'completed_at',clock_timestamp(),'completion_mode','manual_row','completion_note',note);
 previous_writer=current_setting('mio.block_writer',true);
 perform set_config('mio.block_writer','v305',true);
 update public.mio_withdrawal_workflows set state=next_state,revision=r.revision+1,updated_at=clock_timestamp()
  where owner_id=p_owner_id and matter_id=p_matter_id returning * into r;
 perform set_config('mio.block_writer',coalesce(previous_writer,''),true);
 insert into public.mio_withdrawal_events(owner_id,matter_id,event_id,revision,event,state_after)
  values(p_owner_id,p_matter_id,p_event_id,r.revision,p_event,r.state);
 return to_jsonb(r);
end $function$;
revoke all on function public.mio_close_withdrawal_row_v311(uuid,uuid,bigint,jsonb,uuid,jsonb) from public, anon;
grant execute on function public.mio_close_withdrawal_row_v311(uuid,uuid,bigint,jsonb,uuid,jsonb) to authenticated;

-- The now-buildable V310 action must also be accepted when saving workflow definitions.
do $migration$
declare ddl text; old_list text := '''approve'',''draft_document'',''efile_document'',''draft_email''';
begin
 select pg_get_functiondef('public.mio_save_workflow_blocks_v1(uuid,uuid,bigint,jsonb,uuid,jsonb)'::regprocedure) into ddl;
 if position('''mailform''' in ddl)=0 then
  if position(old_list in ddl)=0 then raise exception 'Workflow action validation has changed; review migration.'; end if;
  execute replace(ddl,old_list,'''approve'',''draft_document'',''efile_document'',''mailform'',''draft_email''');
 end if;
end $migration$;
notify pgrst, 'reload schema';
