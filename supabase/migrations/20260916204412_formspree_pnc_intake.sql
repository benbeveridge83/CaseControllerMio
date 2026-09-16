-- Review-first conversion: ingesting a lead never creates a client or matter.
-- Limit the lead inbox to enrolled firm staff, excluding client portal accounts.
drop policy if exists mio_formspree_leads_read on public.mio_formspree_leads;
create policy mio_formspree_leads_read on public.mio_formspree_leads for select to authenticated using (exists(select 1 from public.mio_pnc_staff where user_id=(select auth.uid())));
drop policy if exists mio_formspree_leads_update on public.mio_formspree_leads;
create policy mio_formspree_leads_update on public.mio_formspree_leads for update to authenticated using (exists(select 1 from public.mio_pnc_staff where user_id=(select auth.uid()))) with check (exists(select 1 from public.mio_pnc_staff where user_id=(select auth.uid())));

-- Repair display fields on historical submissions without creating records.
with fields as (
 select id,case when jsonb_typeof(raw_submission->'submission')='object' then raw_submission->'submission' when jsonb_typeof(raw_submission->'data')='object' then raw_submission->'data' else raw_submission end s from public.mio_formspree_leads
)
update public.mio_formspree_leads l set
 full_name=coalesce(nullif(l.full_name,''),s->>'name',s->>'full_name'),
 email=coalesce(nullif(l.email,''),s->>'email',s->>'_replyto'),
 phone=coalesce(nullif(l.phone,''),s->>'phone',s->>'telephone'),
 county=coalesce(nullif(l.county,''),s->>'county'),
 family_type=coalesce(nullif(l.family_type,''),s->>'family-type',s->>'family_type',s->>'case_type'),
 matter_kind=coalesce(nullif(l.matter_kind,''),s->>'matter',s->>'matter_kind',s->>'matter_type'),
 message=coalesce(nullif(l.message,''),s->>'message',s->>'details')
from fields where l.id=fields.id;

create or replace function public.mio_approve_formspree_lead(p_lead_id uuid,p_first text,p_last text,p_email text,p_phone text,p_case_type text,p_matter_name text,p_notes text,p_existing_client uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.mio_formspree_leads; c public.clients; m public.matters; w public.mio_pnc_workflows;
begin
 if auth.uid() is null or not exists(select 1 from public.mio_pnc_staff where user_id=auth.uid()) then raise exception 'Firm staff sign-in required.'; end if;
 select * into l from public.mio_formspree_leads where id=p_lead_id for update;
 if not found then raise exception 'Submission not found.'; end if;
 if l.matter_id is not null then
  select * into m from public.matters where id=l.matter_id;
  return jsonb_build_object('matter',to_jsonb(m),'already_created',true);
 end if;
 if l.status='spam' then raise exception 'Reopen this submission before approving it.'; end if;
 if trim(coalesce(p_first,''))='' or trim(coalesce(p_matter_name,''))='' then raise exception 'Client first name and matter name are required.'; end if;
 if trim(coalesce(p_email,''))<>'' and p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correct the email address or leave it blank.'; end if;
 if not exists(select 1 from public.setting_options where category='matter_type' and name=p_case_type and is_active) then raise exception 'Choose an active case type.'; end if;
 if trim(coalesce(p_email,''))<>'' then perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)),0)); end if;
 if p_existing_client is not null then
  select * into c from public.clients where id=p_existing_client and lower(trim(email))=lower(trim(p_email));
  if not found then raise exception 'Selected client does not match this email.'; end if;
 else
  if trim(coalesce(p_email,''))<>'' and exists(select 1 from public.clients where lower(trim(email))=lower(trim(p_email))) then raise exception 'A client with this email already exists. Select the existing client in the preview.'; end if;
  insert into public.clients(first_name,last_name,email,phone,is_active) values(trim(p_first),trim(coalesce(p_last,'')),nullif(lower(trim(p_email)),''),nullif(trim(p_phone),''),true) returning * into c;
 end if;
 insert into public.matters(client_id,name,matter_type,matter_status,case_status,is_active,notes)
 values(c.id,trim(p_matter_name),p_case_type,'PNC- Need to Consult','Open',true,coalesce(p_notes,'')) returning * into m;
 insert into public.mio_pnc_workflows(matter_id,user_id,client_id,creation_key) values(m.id,auth.uid(),c.id,l.id) returning * into w;
 update public.mio_formspree_leads set matter_id=m.id,status='converted',addressed_at=now(),addressed_by=auth.uid() where id=l.id;
 return jsonb_build_object('matter',to_jsonb(m),'client',to_jsonb(c),'workflow',to_jsonb(w));
end $$;
revoke all on function public.mio_approve_formspree_lead(uuid,text,text,text,text,text,text,text,uuid) from public,anon;
grant execute on function public.mio_approve_formspree_lead(uuid,text,text,text,text,text,text,text,uuid) to authenticated;
