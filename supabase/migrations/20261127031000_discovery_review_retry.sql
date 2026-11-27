-- A lost HTTP acknowledgment must not make an identical saved review look conflicted.
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
 if v.version<>p_review_version then
  if v.version=p_review_version+1 and v.client_version=p_client_version and v.review=p_review and v.updated_by=p_staff then return v; end if;
  raise sqlstate 'PT409' using message='Another staff member changed this review. Your edits are still here; compare before retrying.';
 end if;
 update public.mio_portal_discovery_reviews set review=p_review,client_version=p_client_version,version=version+1,updated_at=now(),updated_by=p_staff where set_id=p_set and request_id=p_request returning * into v;
 -- Preserve compatibility with existing private attorney-revision displays.
 update public.mio_portal_discovery_answers set attorney_response=case when p_review->>'response_mode'='attorney' then p_review->>'attorney_response' else '' end where set_id=p_set and request_id=p_request;
 return v;
end $$;
revoke all on function public.mio_portal_discovery_save_review(uuid,text,integer,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.mio_portal_discovery_save_review(uuid,text,integer,integer,jsonb,uuid) to service_role;
