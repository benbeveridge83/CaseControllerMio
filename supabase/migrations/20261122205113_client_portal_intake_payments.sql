-- Server-only portal credentials avoid legacy broad authenticated database policies.
create table public.mio_portal_accounts(email text primary key check(email=lower(trim(email))),password_hash text,password_version integer not null default 0,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.mio_portal_grants(matter_id uuid not null references public.matters(id) on delete cascade,email text not null references public.mio_portal_accounts(email),client_id uuid not null references public.clients(id),invited_by uuid not null references auth.users(id),invited_at timestamptz not null default now(),accepted_at timestamptz,revoked_at timestamptz,delivery_status text not null default 'not_sent',delivery_error text,primary key(matter_id,email));
create table public.mio_portal_tokens(token_hash text primary key,email text not null references public.mio_portal_accounts(email),matter_id uuid references public.matters(id) on delete cascade,purpose text not null check(purpose in ('invite','reset')),created_at timestamptz not null default now(),expires_at timestamptz not null,used_at timestamptz,revoked_at timestamptz);
create index mio_portal_tokens_email_idx on public.mio_portal_tokens(email,matter_id,purpose);
create table public.mio_portal_sessions(token_hash text primary key,email text not null references public.mio_portal_accounts(email),password_version integer not null,created_at timestamptz not null default now(),expires_at timestamptz not null);
create index mio_portal_sessions_expiry_idx on public.mio_portal_sessions(expires_at);
create table public.mio_portal_rate_limits(key_hash text primary key,attempts integer not null,window_started timestamptz not null default now());
create table public.mio_portal_events(id uuid primary key default gen_random_uuid(),matter_id uuid references public.matters(id) on delete cascade,email text not null,event_type text not null,actor_id uuid,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
do $$ declare t text; begin foreach t in array array['mio_portal_accounts','mio_portal_grants','mio_portal_tokens','mio_portal_sessions','mio_portal_rate_limits','mio_portal_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end $$;
create function public.mio_portal_rate_limit(p_key text,p_max integer default 10) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;begin
 insert into public.mio_portal_rate_limits(key_hash,attempts) values(p_key,1) on conflict(key_hash) do update set attempts=case when mio_portal_rate_limits.window_started<now()-interval '15 minutes' then 1 else mio_portal_rate_limits.attempts+1 end,window_started=case when mio_portal_rate_limits.window_started<now()-interval '15 minutes' then now() else mio_portal_rate_limits.window_started end returning attempts into n;
 return n<=p_max;end $$;
create function public.mio_portal_redeem(p_hash text,p_password_hash text default null,p_session_email text default null) returns text language plpgsql security invoker set search_path='' as $$
declare t public.mio_portal_tokens;a public.mio_portal_accounts;g public.mio_portal_grants;begin
 select * into t from public.mio_portal_tokens where token_hash=p_hash for update;
 if not found or t.expires_at<=now() or t.used_at is not null or t.revoked_at is not null then raise exception 'Invalid or expired link';end if;
 select * into a from public.mio_portal_accounts where email=t.email for update;
 if t.purpose='invite' then
  select * into g from public.mio_portal_grants where matter_id=t.matter_id and email=t.email for update;
  if not found or g.revoked_at is not null or not exists(select 1 from public.matters m join public.clients c on c.id=m.client_id where m.id=g.matter_id and m.client_id=g.client_id and lower(trim(c.email))=t.email) then raise exception 'Invitation no longer applies';end if;
  if a.password_hash is null then
   if p_password_hash is null then raise exception 'Choose a password';end if;
   update public.mio_portal_accounts set password_hash=p_password_hash,password_version=password_version+1,updated_at=now() where email=t.email;
  elsif p_session_email is distinct from t.email then raise exception 'Sign in with your existing account before accepting';end if;
  update public.mio_portal_grants set accepted_at=now() where matter_id=t.matter_id and email=t.email;
 else
  if p_password_hash is null then raise exception 'Choose a password';end if;
  update public.mio_portal_accounts set password_hash=p_password_hash,password_version=password_version+1,updated_at=now() where email=t.email;
  delete from public.mio_portal_sessions where email=t.email;
 end if;
 update public.mio_portal_tokens set used_at=now() where token_hash=p_hash;
 update public.mio_portal_tokens set revoked_at=now() where email=t.email and purpose=t.purpose and matter_id is not distinct from t.matter_id and token_hash<>p_hash and used_at is null;
 return t.email;end $$;
create function public.mio_portal_submit_intake(p_request uuid,p_matter uuid,p_email text,p_answers jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.mio_client_intake_requests;q jsonb;begin
 select * into r from public.mio_client_intake_requests where id=p_request and matter_id=p_matter::text and lower(trim(recipient_email))=p_email for update;
 if not found or r.expires_at<=now() or r.status not in ('pending','submitted','approved') then raise exception 'Form unavailable or expired';end if;
 if r.status<>'pending' then return true;end if;
 if jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>250000 then raise exception 'Invalid intake answers';end if;
 for q in select value from jsonb_array_elements(coalesce(r.template_snapshot->'questions','[]'::jsonb)) loop
 if coalesce((q->>'required')::boolean,false) and trim(coalesce(p_answers->>(q->>'key'),'')) in ('','[]','null') then raise exception 'Required answer: %',q->>'label';end if;end loop;
 if exists(select 1 from jsonb_object_keys(p_answers) a(k) where not exists(select 1 from jsonb_array_elements(r.template_snapshot->'questions') q where q->>'key'=a.k)) then raise exception 'Unknown answer field';end if;
 insert into public.mio_client_intake_submissions(request_id,answers) values(r.id,p_answers);
 update public.mio_client_intake_requests set status='submitted',submitted_at=now(),updated_at=now() where id=r.id;
 return true;end $$;
create function public.mio_portal_payment_request(p_invoice uuid,p_key text,p_url text,p_email text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare i public.mio_invoices;r public.lawpay_payment_requests;cents bigint;acct text;begin
 select * into i from public.mio_invoices where id=p_invoice for update;
 if not found or i.status not in ('outstanding','sent','issued','partial','overdue','unpaid','partially_paid') then raise exception 'Invoice unavailable';end if;
 cents=round(greatest(0,i.total-coalesce(i.amount_paid,0))*100);
 if cents<=0 or p_key<>('portal:'||i.id::text||':'||cents::text) then raise exception 'Invoice balance changed. Refresh before paying';end if;
 acct=case when i.invoice_type='trust_request' then 'trust' else 'operating' end;
 select * into r from public.lawpay_payment_requests where raw->>'portal_key'=p_key limit 1;
 if not found then
 insert into public.lawpay_payment_requests(created_by,matter_id,matter_name,client_id,client_name,payer_name,payer_email,account_key,amount_cents,invoice_number,reference,payment_url,raw) values(i.user_id,i.matter_id,coalesce(i.matter_name,''),i.client_id,coalesce(i.client_name,''),coalesce(i.client_name,''),p_email,acct,cents,i.invoice_number,i.invoice_number,p_url,jsonb_build_object('portal_key',p_key,'invoice_id',i.id)) returning * into r;
 update public.mio_invoices set payment_url=p_url,payment_request_id=r.id::text,updated_at=now() where id=i.id;
 end if;
 return jsonb_build_object('id',r.id,'payment_url',r.payment_url);end $$;
create function public.mio_portal_signature_status(p_matter uuid,p_document text,p_status text) returns boolean language plpgsql security invoker set search_path='' as $$ begin
 if p_status not in ('signed','declined','expired','revoked','awaiting_signature') then raise exception 'Invalid status';end if;
 update public.mio_pnc_workflows set state=jsonb_set(state,'{signature,status}',to_jsonb(p_status)),revision=revision+1,updated_at=now() where matter_id=p_matter and state->'signature'->>'id'=p_document;
 return found;end $$;
revoke all on function public.mio_portal_rate_limit(text,integer),public.mio_portal_redeem(text,text,text),public.mio_portal_submit_intake(uuid,uuid,text,jsonb),public.mio_portal_payment_request(uuid,text,text,text),public.mio_portal_signature_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.mio_portal_rate_limit(text,integer),public.mio_portal_redeem(text,text,text),public.mio_portal_submit_intake(uuid,uuid,text,jsonb),public.mio_portal_payment_request(uuid,text,text,text),public.mio_portal_signature_status(uuid,text,text) to service_role;
