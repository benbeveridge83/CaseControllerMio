-- Provider ingestion and payment posting are one transaction. Browsers cannot call
-- these RPCs directly. No bank transfer or payment-provider write occurs here.
create or replace function public.mio_reconcile_lawpay_transaction_v314(p_transaction_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tx public.lawpay_transactions%rowtype;
  req public.lawpay_payment_requests%rowtype;
  inv public.mio_invoices%rowtype;
  prior public.mio_invoice_events%rowtype;
  invoice_no text;
  prior_count integer;
  matched_count integer;
  net_amount numeric;
  change_amount numeric;
  next_paid numeric;
  received bigint;
  amounts jsonb;
  ids jsonb;
  paid_date timestamptz;
begin
  select * into tx from public.lawpay_transactions where gateway_transaction_id=p_transaction_id for update;
  if not found then raise exception 'Provider transaction not found'; end if;
  if upper(tx.transaction_type) <> 'CHARGE' then
    return jsonb_build_object('status','review','reason','Refund/reversal retained for review; never double-applied alongside a refunded charge');
  end if;
  if upper(tx.status) not in ('COMPLETED','COMPLETE','SETTLED','SUCCEEDED','SUCCESS','PAID','CAPTURED') then
    return jsonb_build_object('status','pending_or_unsuccessful');
  end if;
  if upper(coalesce(tx.currency,'USD')) <> 'USD' then return jsonb_build_object('status','review','reason','Unsupported currency'); end if;
  invoice_no := upper(coalesce(nullif(tx.raw->>'mio_invoice_number',''),nullif(tx.raw->>'invoice_number',''),substring(tx.reference from '(?i)(MIO-[0-9]{4}-[0-9]+)')));
  select * into req from public.lawpay_payment_requests where id::text=tx.raw->>'mio_payment_request_id' for update;
  if req.id is not null then
    invoice_no := coalesce(upper(nullif(req.invoice_number,'')),invoice_no);
    select coalesce(sum(greatest(0,coalesce(t.amount_cents,0)-coalesce(t.amount_refunded_cents,0))),0),
      coalesce(jsonb_object_agg(t.gateway_transaction_id,greatest(0,coalesce(t.amount_cents,0)-coalesce(t.amount_refunded_cents,0))),'{}'::jsonb),
      coalesce(jsonb_agg(t.gateway_transaction_id),'[]'::jsonb),max(t.occurred_at)
      into received,amounts,ids,paid_date
      from public.lawpay_transactions t
      where t.raw->>'mio_payment_request_id'=req.id::text and upper(t.transaction_type)='CHARGE'
      and upper(t.status) in ('COMPLETED','COMPLETE','SETTLED','SUCCEEDED','SUCCESS','PAID','CAPTURED');
    update public.lawpay_payment_requests set
      status=case when received>=amount_cents then 'paid' when received>0 then 'partial' else 'created' end,
      paid_at=paid_date,gateway_transaction_id=p_transaction_id,
      raw=coalesce(raw,'{}'::jsonb)||jsonb_build_object('received_amount_cents',received,'transaction_amounts',amounts,'transaction_ids',ids,'latest_transaction',tx.raw)
      where id=req.id;
  end if;
  if coalesce(invoice_no,'')='' then return jsonb_build_object('status','unlinked'); end if;
  select count(*) into matched_count from public.mio_invoices where upper(invoice_number)=invoice_no;
  if matched_count<>1 then return jsonb_build_object('status','review','reason','Missing or ambiguous invoice reference','invoice_number',invoice_no); end if;
  select * into inv from public.mio_invoices where upper(invoice_number)=invoice_no for update;
  if req.id is not null and coalesce(req.matter_id,'')<>coalesce(inv.matter_id,'') then
    return jsonb_build_object('status','review','reason','Matter mismatch');
  end if;
  if inv.status in ('void','draft') then return jsonb_build_object('status','review','reason','Invoice requires approval or is void'); end if;
  select count(*) into prior_count from public.mio_invoice_events where invoice_id=inv.id and event_type='lawpay_payment_recorded' and provider_event_id=p_transaction_id;
  if prior_count>1 then return jsonb_build_object('status','review','reason','Duplicate payment events require review'); end if;
  select * into prior from public.mio_invoice_events where invoice_id=inv.id and event_type='lawpay_payment_recorded' and provider_event_id=p_transaction_id;
  net_amount := greatest(0,coalesce(tx.amount_cents,0)-coalesce(tx.amount_refunded_cents,0))/100.0;
  change_amount := net_amount-coalesce(prior.amount,0);
  next_paid := round(coalesce(inv.amount_paid,0)+change_amount,2);
  if next_paid < -0.005 or next_paid > inv.total+0.005 then
    return jsonb_build_object('status','review','reason','Payment exceeds invoice balance or reversal needs reconciliation','invoice_number',invoice_no);
  end if;
  if abs(change_amount)>0.0001 then
    update public.mio_invoices set amount_paid=greatest(0,next_paid),balance=greatest(0,total-next_paid),
      status=case when total-next_paid<=0.005 then 'paid' else 'outstanding' end,
      payment_request_id=coalesce(req.id::text,payment_request_id),updated_at=now() where id=inv.id;
  end if;
  if prior.id is null then
    insert into public.mio_invoice_events(invoice_id,user_id,event_type,amount,provider_event_id,details,occurred_at)
    values(inv.id,inv.user_id,'lawpay_payment_recorded',net_amount,p_transaction_id,
      jsonb_build_object('payment_request_id',req.id,'gateway_transaction_id',p_transaction_id,'status',tx.status,'amount',net_amount,'source','atomic_lawpay_v314'),tx.occurred_at);
  elsif prior.amount is distinct from net_amount then
    update public.mio_invoice_events set amount=net_amount,details=coalesce(details,'{}'::jsonb)||jsonb_build_object('amount',net_amount,'status',tx.status,'reconciled_at',now(),'source','atomic_lawpay_v314') where id=prior.id;
  end if;
  return jsonb_build_object('status','posted','invoice_number',invoice_no,'net_amount',net_amount,'change_amount',change_amount);
end $$;
revoke all on function public.mio_reconcile_lawpay_transaction_v314(text) from public, anon, authenticated;
grant execute on function public.mio_reconcile_lawpay_transaction_v314(text) to service_role;

create or replace function public.mio_store_lawpay_transaction_v314(p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  transaction_id text := p_row->>'gateway_transaction_id';
  old_tx public.lawpay_transactions%rowtype;
  new_modified timestamptz := coalesce(nullif(p_row->>'modified_at','')::timestamptz,nullif(p_row->>'occurred_at','')::timestamptz);
begin
  if coalesce(transaction_id,'')='' then raise exception 'Transaction ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mio-lawpay:'||transaction_id,0));
  select * into old_tx from public.lawpay_transactions where gateway_transaction_id=transaction_id for update;
  if old_tx.id is not null and coalesce(old_tx.modified_at,old_tx.occurred_at)>new_modified then
    return jsonb_build_object('status','stale_ignored');
  end if;
  -- Preserve a terminal completed state when a duplicate timestamp carries an older authorization.
  if old_tx.id is not null and coalesce(old_tx.modified_at,old_tx.occurred_at)=new_modified
    and upper(old_tx.status)='COMPLETED' and upper(p_row->>'status') in ('AUTHORIZED','PENDING','PROCESSING') then
    return jsonb_build_object('status','stale_ignored');
  end if;
  insert into public.lawpay_transactions(gateway_transaction_id,gateway_event_id,occurred_at,modified_at,transaction_type,status,account_id,account_key,amount_cents,amount_refunded_cents,currency,reference,payer_name,payer_email,payment_method_type,last_four,raw,synced_at)
  values(transaction_id,nullif(p_row->>'gateway_event_id',''),(p_row->>'occurred_at')::timestamptz,new_modified,p_row->>'transaction_type',p_row->>'status',p_row->>'account_id',coalesce(p_row->>'account_key',''),(p_row->>'amount_cents')::bigint,coalesce((p_row->>'amount_refunded_cents')::bigint,0),coalesce(p_row->>'currency','USD'),coalesce(p_row->>'reference',''),coalesce(p_row->>'payer_name',''),coalesce(p_row->>'payer_email',''),coalesce(p_row->>'payment_method_type',''),coalesce(p_row->>'last_four',''),coalesce(p_row->'raw','{}'::jsonb),now())
  on conflict(gateway_transaction_id) do update set
    gateway_event_id=coalesce(excluded.gateway_event_id,lawpay_transactions.gateway_event_id),occurred_at=excluded.occurred_at,modified_at=excluded.modified_at,
    transaction_type=excluded.transaction_type,status=excluded.status,account_id=excluded.account_id,account_key=excluded.account_key,
    amount_cents=excluded.amount_cents,amount_refunded_cents=excluded.amount_refunded_cents,currency=excluded.currency,reference=excluded.reference,
    payer_name=excluded.payer_name,payer_email=excluded.payer_email,payment_method_type=excluded.payment_method_type,last_four=excluded.last_four,raw=excluded.raw,synced_at=now();
  return public.mio_reconcile_lawpay_transaction_v314(transaction_id);
end $$;
revoke all on function public.mio_store_lawpay_transaction_v314(jsonb) from public, anon, authenticated;
grant execute on function public.mio_store_lawpay_transaction_v314(jsonb) to service_role;
