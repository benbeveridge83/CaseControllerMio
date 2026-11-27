-- Document requests are scoped to the current matter and client association.
alter table public.mio_portal_settings add column if not exists documents boolean not null default false;
create table public.mio_portal_matter_settings (
 matter_id uuid primary key references public.matters(id) on delete cascade,
 intake boolean not null default true,
 discovery boolean not null default true,
 payments boolean not null default false,
 documents boolean not null default false,
 version integer not null default 1 check(version>0),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
create table public.mio_portal_document_requests (
 id uuid primary key default gen_random_uuid(),
 matter_id uuid not null references public.matters(id) on delete cascade,
 client_id uuid not null references public.clients(id),
 recipient_email text not null,
 title text not null,
 summary text not null default '',
 details text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 closed_at timestamptz
);
create index mio_portal_document_requests_matter on public.mio_portal_document_requests(matter_id,recipient_email);
create table public.mio_portal_document_files (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.mio_portal_document_requests(id) on delete cascade,
 matter_id uuid not null references public.matters(id) on delete cascade,
 path text not null unique,
 filename text not null,
 original_filename text not null,
 content_type text not null,
 size_bytes bigint not null check(size_bytes between 1 and 26214400),
 status text not null default 'uploading' check(status in ('uploading','ready')),
 created_at timestamptz not null default now(),
 removed_at timestamptz
);
create index mio_portal_document_files_request on public.mio_portal_document_files(request_id,status);
alter table public.mio_portal_matter_settings enable row level security;
alter table public.mio_portal_document_requests enable row level security;
alter table public.mio_portal_document_files enable row level security;
revoke all on public.mio_portal_matter_settings,public.mio_portal_document_requests,public.mio_portal_document_files from anon,authenticated;
grant all on public.mio_portal_matter_settings,public.mio_portal_document_requests,public.mio_portal_document_files to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portal-documents','portal-documents',false,26214400,array['application/pdf','image/jpeg','image/png','image/heic','image/heif','text/plain','text/csv','application/zip','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
