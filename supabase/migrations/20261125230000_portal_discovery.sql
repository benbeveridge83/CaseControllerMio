-- Portal discovery is private and accessed only through the authenticated portal handler.
create table if not exists public.mio_portal_discovery_sets (
 id uuid primary key default gen_random_uuid(),
 matter_id uuid not null references public.matters(id),
 client_id uuid not null references public.clients(id),
 recipient_email text not null,
 source_user_id uuid not null references auth.users(id),
 source_set_id text not null,
 title text not null,
 discovery_type text not null check (discovery_type in ('production','interrogatories','disclosures','admissions')),
 client_instructions text not null default '',
 client_response_due date,
 requests jsonb not null default '[]' check (jsonb_typeof(requests)='array'),
 published_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revoked_at timestamptz,
 unique(matter_id,source_set_id)
);
create index if not exists mio_portal_discovery_matter on public.mio_portal_discovery_sets(matter_id,recipient_email);
create table if not exists public.mio_portal_discovery_answers (
 set_id uuid not null references public.mio_portal_discovery_sets(id),
 request_id text not null,
 client_answer text not null default '',
 client_comments text not null default '',
 rfp_status text not null default '',
 needs_help boolean not null default false,
 version integer not null default 0,
 attorney_response text not null default '',
 updated_at timestamptz not null default now(),
 primary key(set_id,request_id)
);
create table if not exists public.mio_portal_discovery_files (
 id uuid primary key default gen_random_uuid(),
 set_id uuid not null references public.mio_portal_discovery_sets(id),
 request_id text not null,
 path text not null unique,
 filename text not null,
 content_type text not null,
 size_bytes bigint not null check (size_bytes between 1 and 26214400),
 status text not null default 'uploading' check (status in ('uploading','ready')),
 created_at timestamptz not null default now()
);
create index if not exists mio_portal_discovery_file_set on public.mio_portal_discovery_files(set_id,request_id);
alter table public.mio_portal_discovery_sets enable row level security;
alter table public.mio_portal_discovery_answers enable row level security;
alter table public.mio_portal_discovery_files enable row level security;
revoke all on public.mio_portal_discovery_sets,public.mio_portal_discovery_answers,public.mio_portal_discovery_files from anon,authenticated;
grant all on public.mio_portal_discovery_sets,public.mio_portal_discovery_answers,public.mio_portal_discovery_files to service_role;

create or replace function public.mio_portal_discovery_save_answer(p_set uuid,p_request text,p_version integer,p_answer text,p_comments text,p_status text,p_help boolean)
returns public.mio_portal_discovery_answers language plpgsql set search_path=public as $$
declare result public.mio_portal_discovery_answers;
begin
 if not exists(select 1 from public.mio_portal_discovery_sets s,jsonb_array_elements(s.requests) r where s.id=p_set and s.revoked_at is null and r->>'id'=p_request) then raise exception 'Request is no longer available'; end if;
 insert into public.mio_portal_discovery_answers(set_id,request_id) values(p_set,p_request) on conflict do nothing;
 update public.mio_portal_discovery_answers set client_answer=p_answer,client_comments=p_comments,rfp_status=p_status,needs_help=p_help,version=version+1,updated_at=now()
 where set_id=p_set and request_id=p_request and version=p_version returning * into result;
 if not found then raise sqlstate 'PT409' using message='This answer changed in another window. Your text is still here. Compare it with the saved answer before retrying.'; end if;
 return result;
end $$;
revoke all on function public.mio_portal_discovery_save_answer(uuid,text,integer,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.mio_portal_discovery_save_answer(uuid,text,integer,text,text,text,boolean) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portal-discovery','portal-discovery',false,26214400,array['application/pdf','image/jpeg','image/png','image/heic','image/heif','text/plain','text/csv','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
