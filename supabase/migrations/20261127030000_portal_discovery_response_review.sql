-- Original discovery references stay in the matter's existing document library.
alter table public.mio_portal_discovery_sets add column if not exists source_document_id text;
create table if not exists public.mio_portal_discovery_reviews (
 set_id uuid not null references public.mio_portal_discovery_sets(id),
 request_id text not null,
 review jsonb not null default '{}'::jsonb,
 client_version integer not null default 0,
 version integer not null default 0,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 primary key(set_id,request_id)
);
alter table public.mio_portal_discovery_reviews enable row level security;
revoke all on public.mio_portal_discovery_reviews from anon,authenticated;
grant all on public.mio_portal_discovery_reviews to service_role;

create or replace function public.mio_portal_discovery_sources(p_sets uuid[],p_include_data boolean default false)
returns table(set_id uuid,document jsonb) language sql stable security definer set search_path=public as $$
 select s.id, case when p_include_data then jsonb_build_object('id',d->>'id','matter_id',d->>'matter_id','file_name',coalesce(d->>'file_name',d->>'name'),'file_type',d->>'file_type','file_size',d->'file_size','storage_path',coalesce(d->>'storage_path',d->>'file_path'),'file_data',d->>'file_data')
 else jsonb_build_object('id',d->>'id','filename',coalesce(d->>'file_name',d->>'name'),'size_bytes',d->'file_size') end
 from public.mio_portal_discovery_sets s
 left join public.case_mio_user_state n on n.user_id=s.source_user_id and n.key='caseMioRespondingDiscoverySets'
 left join lateral (select item from jsonb_array_elements(case when jsonb_typeof(coalesce(n.json_value,n.raw_value::jsonb))='array' then coalesce(n.json_value,n.raw_value::jsonb) else '[]'::jsonb end) item where item->>'id'=s.source_set_id and item->>'matter_id'=s.matter_id::text limit 1) native on true
 join public.case_mio_user_state docs on docs.user_id=s.source_user_id and docs.key='caseControllerDocuments'
 cross join lateral jsonb_array_elements(case when jsonb_typeof(coalesce(docs.json_value,docs.raw_value::jsonb))='array' then coalesce(docs.json_value,docs.raw_value::jsonb) else '[]'::jsonb end) d
 where s.id=any(p_sets) and s.revoked_at is null and d->>'id'=coalesce(nullif(s.source_document_id,''),native.item->>'document_id') and d->>'matter_id'=s.matter_id::text
 and (nullif(coalesce(d->>'storage_path',d->>'file_path'),'') is not null or d->>'file_data' like 'data:%;base64,%');
$$;
revoke all on function public.mio_portal_discovery_sources(uuid[],boolean) from public,anon,authenticated;
grant execute on function public.mio_portal_discovery_sources(uuid[],boolean) to service_role;

create or replace function public.mio_portal_discovery_review_context(p_user uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('personal',coalesce((select coalesce(json_value,raw_value::jsonb) from public.case_mio_user_state where user_id=p_user and key='caseMioDiscoveryPersonalV1'),'{}'::jsonb),'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t->>'id','name',coalesce(t->>'name',t->>'document_type'),'has_files',jsonb_array_length(coalesce(t->'files','[]'::jsonb))>0)) from public.case_mio_user_state u cross join lateral jsonb_array_elements(u.json_value) t where u.user_id=p_user and u.key='caseMioDraftingTemplates' and coalesce(t->>'is_active','true')<>'false' and coalesce(t->>'status','')<>'retired'),'[]'::jsonb));
$$;
revoke all on function public.mio_portal_discovery_review_context(uuid) from public,anon,authenticated;
grant execute on function public.mio_portal_discovery_review_context(uuid) to service_role;

create or replace function public.mio_portal_discovery_save_review(p_set uuid,p_request text,p_client_version integer,p_review_version integer,p_review jsonb,p_staff uuid)
returns public.mio_portal_discovery_reviews language plpgsql security definer set search_path=public as $$
declare a public.mio_portal_discovery_answers; v public.mio_portal_discovery_reviews; current_text text;
begin
 perform 1 from public.mio_portal_discovery_sets where id=p_set and revoked_at is null for share;
 if not found then raise exception 'Discovery set unavailable'; end if;
 select r->>'request_text' into current_text from public.mio_portal_discovery_sets s cross join lateral jsonb_array_elements(s.requests) r where s.id=p_set and s.revoked_at is null and r->>'id'=p_request;
 if not found or current_text is distinct from p_review->>'request_text' then raise sqlstate 'PT409' using message='The request changed. Refresh and review its current wording.'; end if;
 insert into public.mio_portal_discovery_answers(set_id,request_id) values(p_set,p_request) on conflict do nothing;
 select * into a from public.mio_portal_discovery_answers where set_id=p_set and request_id=p_request for update;
 if a.version<>p_client_version then raise sqlstate 'PT409' using message='The client answer changed. Refresh and review it before saving approval.'; end if;
 insert into public.mio_portal_discovery_reviews(set_id,request_id) values(p_set,p_request) on conflict do nothing;
 select * into v from public.mio_portal_discovery_reviews where set_id=p_set and request_id=p_request for update;
 if v.version<>p_review_version then raise sqlstate 'PT409' using message='Another staff member changed this review. Your edits are still here; compare before retrying.'; end if;
 update public.mio_portal_discovery_reviews set review=p_review,client_version=p_client_version,version=version+1,updated_at=now(),updated_by=p_staff where set_id=p_set and request_id=p_request returning * into v;
 -- Preserve compatibility with existing private attorney-revision displays.
 update public.mio_portal_discovery_answers set attorney_response=case when p_review->>'response_mode'='attorney' then p_review->>'attorney_response' else '' end where set_id=p_set and request_id=p_request;
 return v;
end $$;
revoke all on function public.mio_portal_discovery_save_review(uuid,text,integer,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.mio_portal_discovery_save_review(uuid,text,integer,integer,jsonb,uuid) to service_role;

create table if not exists public.mio_portal_discovery_response_drafts (
 id uuid primary key,
 set_id uuid not null references public.mio_portal_discovery_sets(id),
 path text not null unique,
 filename text not null,
 kind text not null check (kind in ('working','reviewed')),
 request_versions jsonb not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists mio_portal_discovery_draft_set on public.mio_portal_discovery_response_drafts(set_id,created_at desc);
alter table public.mio_portal_discovery_response_drafts enable row level security;
revoke all on public.mio_portal_discovery_response_drafts from anon,authenticated;
grant all on public.mio_portal_discovery_response_drafts to service_role;
