-- Explicit staff enrollment: client-portal accounts cannot create PNC records.
create table if not exists public.mio_pnc_staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table public.mio_pnc_staff enable row level security;
revoke all on public.mio_pnc_staff from public,anon,authenticated;
grant select on public.mio_pnc_staff to authenticated;
create policy pnc_staff_read_self on public.mio_pnc_staff for select to authenticated using ((select auth.uid())=user_id);
insert into public.mio_pnc_staff(user_id)
 select id from auth.users where email_confirmed_at is not null and lower(email) like '%@beveridgelawfirm.com'
 on conflict do nothing;

-- PNC workflow: user-owned, separate from legacy matter and billing records.
create table if not exists public.mio_pnc_workflows (
  matter_id uuid primary key references public.matters(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  client_id uuid not null references public.clients(id),
  creation_key uuid not null,
  config jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,creation_key)
);
alter table public.mio_pnc_workflows enable row level security;
revoke all on public.mio_pnc_workflows from anon;
revoke all on public.mio_pnc_workflows from public;
grant select,insert,update on public.mio_pnc_workflows to authenticated;
create policy pnc_select_own on public.mio_pnc_workflows for select to authenticated using ((select auth.uid())=user_id and exists(select 1 from public.mio_pnc_staff staff where staff.user_id=(select auth.uid())));
create policy pnc_insert_own on public.mio_pnc_workflows for insert to authenticated with check ((select auth.uid())=user_id and exists(select 1 from public.mio_pnc_staff staff where staff.user_id=(select auth.uid())));
create policy pnc_update_own on public.mio_pnc_workflows for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id and exists(select 1 from public.mio_pnc_staff staff where staff.user_id=(select auth.uid())));
create index if not exists mio_pnc_owner_idx on public.mio_pnc_workflows(user_id,updated_at);
create or replace function public.mio_create_pnc_v313(p_key uuid,p_first text,p_last text,p_email text,p_phone text,p_case_type text,p_existing_client uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.clients; m public.matters; w public.mio_pnc_workflows;
begin
 if auth.uid() is null or p_key is null or not exists(select 1 from public.mio_pnc_staff where user_id=auth.uid()) then raise exception 'Sign in to create a PNC.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_key::text,0));
 select * into w from public.mio_pnc_workflows where user_id=auth.uid() and creation_key=p_key;
 if found then return jsonb_build_object('workflow',to_jsonb(w)); end if;
 if trim(coalesce(p_first,''))='' or trim(coalesce(p_last,''))='' or coalesce(p_email,'') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'First name, last name and a valid email are required.'; end if;
 if not exists(select 1 from public.setting_options where category='matter_type' and name=p_case_type and is_active) then raise exception 'Choose an existing case type.'; end if;
 if not exists(select 1 from public.setting_options where category='matter_status' and name='PNC- Need to Consult' and is_active) then raise exception 'The PNC matter status is missing from Settings.'; end if;
 if p_existing_client is not null then
  select * into c from public.clients where id=p_existing_client and lower(trim(email))=lower(trim(p_email));
  if not found then raise exception 'The selected client does not match this email.'; end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)),0));
  if exists(select 1 from public.clients where lower(trim(email))=lower(trim(p_email))) then raise exception 'A client with this email exists. Choose that client to avoid a duplicate.'; end if;
  insert into public.clients(first_name,last_name,email,phone,is_active) values(trim(p_first),trim(p_last),lower(trim(p_email)),trim(p_phone),true) returning * into c;
 end if;
 insert into public.matters(client_id,name,matter_type,matter_status,case_status,is_active) values(c.id,trim(p_first)||' '||trim(p_last)||' - '||p_case_type,p_case_type,'PNC- Need to Consult','Open',true) returning * into m;
 insert into public.mio_pnc_workflows(matter_id,user_id,client_id,creation_key) values(m.id,auth.uid(),c.id,p_key) returning * into w;
 return jsonb_build_object('workflow',to_jsonb(w),'matter',to_jsonb(m),'client',to_jsonb(c));
end $$;
revoke all on function public.mio_create_pnc_v313(uuid,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.mio_create_pnc_v313(uuid,text,text,text,text,text,uuid) to authenticated;

grant select,insert,update on public.mio_client_intake_requests to authenticated;
grant select on public.mio_client_intake_submissions to authenticated;
revoke all on public.mio_client_intake_requests,public.mio_client_intake_submissions from anon;

-- Anonymous intake uses a random 256-bit bearer token. No answers or contact
-- information are returned. The minimal elevated function is in a private schema.
create schema if not exists mio_private;
revoke all on schema mio_private from public;
grant usage on schema mio_private to anon,authenticated;
create or replace function mio_private.intake_token_access_v313(p_token text,p_answers jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.mio_client_intake_requests; question jsonb;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid or expired intake link.'; end if;
 select * into r from public.mio_client_intake_requests where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
 if not found or r.expires_at<now() or r.status not in ('pending','submitted','approved') then raise exception 'Invalid or expired intake link.'; end if;
 if p_answers is not null and r.status='pending' then
  if jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>250000 then raise exception 'Invalid intake answers.'; end if;
  for question in select value from jsonb_array_elements(coalesce(r.template_snapshot->'questions','[]'::jsonb)) loop
   if coalesce((question->>'required')::boolean,false) and trim(coalesce(p_answers->>(question->>'key'),''))='' then raise exception 'Required answer: %',question->>'label'; end if;
  end loop;
  insert into public.mio_client_intake_submissions(request_id,answers) values(r.id,p_answers);
  update public.mio_client_intake_requests set status='submitted',submitted_at=now(),updated_at=now() where id=r.id returning * into r;
 end if;
 return jsonb_build_object('request',jsonb_build_object('id',r.id,'title',r.title,'template_snapshot',r.template_snapshot,'status',case when r.status='approved' then 'submitted' else r.status end,'submitted_at',r.submitted_at));
end $$;
revoke all on function mio_private.intake_token_access_v313(text,jsonb) from public;
grant execute on function mio_private.intake_token_access_v313(text,jsonb) to anon,authenticated;
create or replace function public.mio_intake_access_v313(p_token text,p_answers jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$select mio_private.intake_token_access_v313(p_token,p_answers)$$;
revoke all on function public.mio_intake_access_v313(text,jsonb) from public;
grant execute on function public.mio_intake_access_v313(text,jsonb) to anon,authenticated;
