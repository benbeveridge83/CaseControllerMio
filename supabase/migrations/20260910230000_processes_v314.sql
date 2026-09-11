-- Additive only. Existing Withdrawal workflows and billing entries are not rewritten.
create table if not exists public.mio_process_records (
 owner_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('template','run')),
 id text not null,
 state jsonb not null,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 primary key(owner_id,kind,id)
);
alter table public.mio_process_records enable row level security;
drop policy if exists mio_process_read_own on public.mio_process_records;
create policy mio_process_read_own on public.mio_process_records for select to authenticated using(owner_id=(select auth.uid()));
revoke all on public.mio_process_records from anon,authenticated;
grant select on public.mio_process_records to authenticated;
create or replace function public.mio_save_process_v314(p_kind text,p_id text,p_revision bigint,p_state jsonb,p_billing jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare who uuid:=auth.uid(); old public.mio_process_records; found_old boolean; rev bigint; hist jsonb; n jsonb; s jsonb; doc jsonb; did text; nid text; hrs numeric; rate_value numeric; amt numeric; bill_id text; bill_payload jsonb;
begin
 if who is null then raise exception 'Sign in first'; end if;
 if p_kind is null or p_id is null or p_revision is null or p_state is null or p_kind not in ('template','run') or p_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$' or p_state->>'id' is distinct from p_id or length(trim(coalesce(p_state->>'name','')))=0 or octet_length(p_state::text)>2097152 then raise exception 'Invalid process record'; end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text||':'||p_kind||':'||p_id,0));
 select * into old from public.mio_process_records where owner_id=who and kind=p_kind and id=p_id for update;
 found_old:=found;
 if (found_old and old.revision<>p_revision) or (not found_old and p_revision<>0) then raise sqlstate 'PT409' using message='Changed in another window'; end if;
 if p_kind='template' then
  if p_state->>'version' is distinct from '2' or jsonb_typeof(p_state->'nodes') is distinct from 'array' or jsonb_array_length(p_state->'nodes') not between 1 and 100 or p_billing is not null then raise exception 'Invalid template'; end if;
 else
  if jsonb_typeof(p_state->'definition'->'nodes') is distinct from 'array' or jsonb_typeof(p_state->'steps') is distinct from 'object' or jsonb_typeof(p_state->'history') is distinct from 'array' or jsonb_array_length(p_state->'history')>4000 or coalesce(p_state->>'matterId','')='' or coalesce(p_state->>'status','') not in ('active','paused','complete','cancelled') then raise exception 'Invalid process run'; end if;
  if found_old then
   if old.state->'definition' is distinct from p_state->'definition' or old.state->>'matterId' is distinct from p_state->>'matterId' or old.state->>'startedAt' is distinct from p_state->>'startedAt' then raise exception 'Running definitions and matter identity are immutable'; end if;
   select coalesce(jsonb_agg(value order by ord),'[]') into hist from jsonb_array_elements(p_state->'history') with ordinality x(value,ord) where ord<=jsonb_array_length(old.state->'history');
   if hist is distinct from old.state->'history' then raise exception 'History cannot be overwritten'; end if;
   for nid,s in select key,value from jsonb_each(old.state->'steps') loop
    if s->>'status'='complete' and p_state#>>array['steps',nid,'status'] is distinct from 'complete' then raise exception 'Completed actions cannot be restarted'; end if;
    if s->>'billingId' is not null and p_state#>>array['steps',nid,'billingId'] is distinct from s->>'billingId' then raise exception 'Billing identity cannot be changed'; end if;
   end loop;
  elsif p_billing is not null then raise exception 'New processes cannot contain billing';
  end if;
  -- Documents may only be attached from this user's documents for this same matter.
  for doc in select value from jsonb_each(coalesce(p_state->'documents','{}')) loop
   if not exists(select 1 from public.mio_documents where user_id=who and id=doc->>'id' and matter_id=p_state->>'matterId') then raise exception 'Document not found in this matter'; end if;
  end loop;
  for s in select value from jsonb_each(p_state->'steps') loop
   for did in select jsonb_array_elements_text(coalesce(s->'config'->'documentIds','[]')) loop
    if not exists(select 1 from public.mio_documents where user_id=who and id=did and matter_id=p_state->>'matterId') then raise exception 'Selected document not found in this matter'; end if;
   end loop;
  end loop;
  if p_billing is not null then
   nid:=p_billing->'payload'->>'process_node_id';
   select value into n from jsonb_array_elements(p_state->'definition'->'nodes') where value->>'id'=nid;
   s:=p_state->'steps'->nid;
   bill_id:='process:'||p_id||':'||nid;
   if n is null or coalesce((n->'billing'->>'enabled')::boolean,false) is not true or s->>'performedAt' is null or s->>'reference' is null or old.state#>>array['steps',nid,'billingId'] is not null or p_billing->>'id' is distinct from bill_id or s->>'billingId' is distinct from bill_id or p_billing->>'matter_id' is distinct from p_state->>'matterId' or coalesce(p_billing->>'user_member_id','')='' then raise exception 'Billing requires a new successful action from this run'; end if;
   hrs:=round((n->'billing'->>'minutes')::numeric/60,6);
   rate_value:=(p_billing->>'rate')::numeric;
   amt:=round(hrs*rate_value,2);
   if hrs is null or rate_value is null or p_billing->>'billing_time' is null or p_billing->>'amount' is null or hrs::text='NaN' or rate_value::text='NaN' or hrs<=0 or hrs>24 or rate_value<0 or rate_value>100000 or (p_billing->>'billing_time')::numeric<>hrs or (p_billing->>'amount')::numeric<>amt then raise exception 'Invalid billing amount'; end if;
   if (p_billing->>'entry_date')::date <> ((s->>'performedAt')::timestamptz at time zone 'America/Chicago')::date then raise exception 'Billing date must match the recorded action'; end if;
   bill_payload:=p_billing->'payload';
   insert into public.mio_billing_entries(user_id,id,matter_id,client_id,user_member_id,entry_date,description,matter_status,matter_step,billing_time,rate,amount,do_not_bill,payload,created_at,updated_at)
   values(who,bill_id,p_state->>'matterId',p_billing->>'client_id',p_billing->>'user_member_id',(p_billing->>'entry_date')::date,p_billing->>'description',p_billing->>'matter_status',p_billing->>'matter_step',hrs,rate_value,amt,false,bill_payload,(s->>'performedAt')::timestamptz,now());
   -- Primary key prevents replay even when clients race; failure rolls back run and bill together.
  end if;
 end if;
 rev:=case when found_old then old.revision+1 else 1 end;
 insert into public.mio_process_records(owner_id,kind,id,state,revision) values(who,p_kind,p_id,p_state,rev)
 on conflict(owner_id,kind,id) do update set state=excluded.state,revision=excluded.revision,updated_at=now();
 return jsonb_build_object('state',p_state,'revision',rev);
end $$;
revoke all on function public.mio_save_process_v314(text,text,bigint,jsonb,jsonb) from public,anon;
grant execute on function public.mio_save_process_v314(text,text,bigint,jsonb,jsonb) to authenticated;
