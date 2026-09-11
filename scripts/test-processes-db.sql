\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003140',true);
set local role authenticated;
do $$
declare n jsonb:=jsonb_build_object('id','task','billing',jsonb_build_object('enabled',true,'minutes',1,'description','Review'));
 r jsonb; saved jsonb; bill jsonb; failed boolean;
begin
 r:=jsonb_build_object('id','db-run','name','Database verification','status','active','matterId','test-matter','startedAt','2026-09-10T18:00:00Z','definition',jsonb_build_object('nodes',jsonb_build_array(n)),'steps',jsonb_build_object('task',jsonb_build_object('status','ready','config',jsonb_build_object('documentIds','[]'::jsonb))),'history',jsonb_build_array(jsonb_build_object('type','started')),'documents','{}'::jsonb);
 saved:=public.mio_save_process_v314('run','db-run',0,r);
 if (saved->>'revision')::int<>1 then raise exception 'Missing save receipt';end if;
 failed:=false;begin perform public.mio_save_process_v314('run','db-run',0,r);exception when sqlstate 'PT409' then failed:=true;end;
 if not failed then raise exception 'CAS protection failed';end if;
 r:=jsonb_set(r,'{steps,task,status}','"complete"');r:=jsonb_set(r,'{steps,task,performedAt}','"2026-09-10T18:05:00Z"');r:=jsonb_set(r,'{steps,task,reference}','"Confirmed work"');r:=jsonb_set(r,'{steps,task,billingId}','"process:db-run:task"');
 r:=jsonb_set(r,'{history}',r->'history'||jsonb_build_array(jsonb_build_object('type','completed'),jsonb_build_object('type','billed')));
 bill:=jsonb_build_object('id','process:db-run:task','matter_id','test-matter','user_member_id','test-member','entry_date','2026-09-10','description','Review','billing_time',0.016667,'rate',300,'amount',5,'payload',jsonb_build_object('process_node_id','task'));
 saved:=public.mio_save_process_v314('run','db-run',1,r,bill);
 if (saved->>'revision')::int<>2 then raise exception 'Successful work did not persist';end if;
 failed:=false;begin perform public.mio_save_process_v314('run','db-run',2,r,bill);exception when others then failed:=true;end;
 if not failed then raise exception 'Duplicate billing was allowed';end if;
 failed:=false;begin perform public.mio_save_process_v314('run','db-run',2,jsonb_set(r,'{history}','[]'));exception when others then failed:=true;end;
 if not failed then raise exception 'History overwrite was allowed';end if;
 failed:=false;begin perform public.mio_save_process_v314('run','db-run',2,jsonb_set(r,'{matterId}','"other-matter"'));exception when others then failed:=true;end;
 if not failed then raise exception 'Matter crossover was allowed';end if;
 failed:=false;begin update public.mio_process_records set revision=9 where id='db-run';exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Direct writes bypassed protected RPC';end if;
end $$;
reset role;
do $$begin
 if (select count(*) from public.mio_billing_entries)<>1 then raise exception 'Billing count was not one';end if;
 if (select amount from public.mio_billing_entries limit 1)<>5 then raise exception 'Wrong billing amount';end if;
 if (select revision from public.mio_process_records where id='db-run')<>2 then raise exception 'Failed transaction changed the run';end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000003141',true);
set local role authenticated;
do $$begin if exists(select 1 from public.mio_process_records) then raise exception 'Owner isolation failed';end if;end $$;
reset role;
rollback;
\echo PASS process SQL: CAS, atomic billed result, rounding, duplicate prevention, history and matter immutability, direct-write denial, owner RLS
