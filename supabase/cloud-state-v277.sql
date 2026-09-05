-- Schema source for the applied cloud_state_v277_recovery_and_guarded_writes migration.
-- Additive only: no existing case, invoice, or document data is moved or deleted.
create table if not exists public.case_mio_browser_recovery (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 key text not null, raw_value text not null,
 origin text not null default '', reason text not null default 'legacy-browser',
 captured_at timestamptz not null default clock_timestamp()
);
alter table public.case_mio_browser_recovery enable row level security;
create index if not exists case_mio_browser_recovery_user_time_idx on public.case_mio_browser_recovery(user_id,captured_at desc);
drop policy if exists mio_recovery_select_own on public.case_mio_browser_recovery;
create policy mio_recovery_select_own on public.case_mio_browser_recovery for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists mio_recovery_insert_own on public.case_mio_browser_recovery;
create policy mio_recovery_insert_own on public.case_mio_browser_recovery for insert to authenticated with check ((select auth.uid())=user_id);
revoke all on public.case_mio_browser_recovery from anon;
revoke update,delete on public.case_mio_browser_recovery from authenticated;
grant select,insert on public.case_mio_browser_recovery to authenticated;
grant all on public.case_mio_browser_recovery to service_role;

create or replace function public.mio_cloud_state_write_v277(
 p_user_id uuid,p_key text,p_raw text,p_expected_at timestamptz default null,
 p_expected_exists boolean default false,p_delete boolean default false,p_origin text default ''
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 current_row public.case_mio_user_state%rowtype;
 saved_row public.case_mio_user_state%rowtype;
 exists_now boolean; parsed jsonb;
begin
 if auth.uid() is null or auth.uid()<>p_user_id then
  raise exception 'Account changed. Sign in to the original account before saving.' using errcode='42501';
 end if;
 if p_key is null or length(p_key)=0 or length(p_key)>500 then
  raise exception 'Invalid state key.' using errcode='22023';
 end if;
 if p_key ~* '(auth-token|msal|supabasesession|access_token|refresh_token)' then
  raise exception 'Authentication credentials are not application state.' using errcode='22023';
 end if;
 select * into current_row from public.case_mio_user_state where user_id=p_user_id and key=p_key for update;
 exists_now:=found;
 if exists_now and not p_delete and current_row.raw_value is not distinct from p_raw then
  return jsonb_build_object('key',p_key,'raw_value',current_row.raw_value,'updated_at',current_row.updated_at);
 end if;
 if exists_now is distinct from p_expected_exists or (exists_now and current_row.updated_at is distinct from p_expected_at) then
  raise exception 'Cloud state changed in another tab or device. This edit was not allowed to overwrite it.' using errcode='40001';
 end if;
 if p_delete then
  delete from public.case_mio_user_state where user_id=p_user_id and key=p_key;
  return jsonb_build_object('key',p_key,'deleted',true);
 end if;
 begin parsed:=p_raw::jsonb; exception when invalid_text_representation then parsed:=null; end;
 if jsonb_typeof(parsed)='string' then parsed:=null; end if;
 if exists_now then
  update public.case_mio_user_state set raw_value=p_raw,json_value=parsed,origin=p_origin,updated_at=clock_timestamp()
   where user_id=p_user_id and key=p_key returning * into saved_row;
 else
  insert into public.case_mio_user_state(user_id,key,raw_value,json_value,origin,updated_at)
   values(p_user_id,p_key,p_raw,parsed,p_origin,clock_timestamp())
   on conflict(user_id,key) do nothing returning * into saved_row;
  if not found then raise exception 'Cloud state was created in another tab. Reload before saving.' using errcode='40001'; end if;
 end if;
 return jsonb_build_object('key',p_key,'raw_value',saved_row.raw_value,'updated_at',saved_row.updated_at);
end; $$;
revoke all on function public.mio_cloud_state_write_v277(uuid,text,text,timestamptz,boolean,boolean,text) from public,anon;
grant execute on function public.mio_cloud_state_write_v277(uuid,text,text,timestamptz,boolean,boolean,text) to authenticated;
