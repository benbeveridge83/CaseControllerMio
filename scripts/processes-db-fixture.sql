-- Isolated CI database ONLY. Never apply this file to a live Mio database.
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;
insert into auth.users values('00000000-0000-4000-8000-000000003140'),('00000000-0000-4000-8000-000000003141');
create table public.mio_documents(user_id uuid,id text,matter_id text,primary key(user_id,id));
create table public.mio_billing_entries(user_id uuid,id text,matter_id text,client_id text,user_member_id text,entry_date date,description text,matter_status text,matter_step text,billing_time numeric,rate numeric,amount numeric,do_not_bill boolean,payload jsonb,created_at timestamptz,updated_at timestamptz,primary key(user_id,id));
