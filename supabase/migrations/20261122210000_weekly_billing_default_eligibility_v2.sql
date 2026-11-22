-- Align atomic posting with the review screen's default eligibility.
-- Keep authenticated execution revoked; this migration does not activate posting.
create or replace function public.mio_post_weekly_trust_payment_v1(
  p_idempotency_key text, p_source_matter_id text,
  p_destination_matter_id text, p_invoice_id uuid,
  p_amount_cents bigint, p_expected_invoice_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  actor uuid := auth.uid();
  fp text;
  existing public.mio_weekly_trust_postings%rowtype;
  inv public.mio_invoices%rowtype;
  src public.matters%rowtype;
  dest public.matters%rowtype;
  prefs jsonb;
  trust_row public.case_mio_user_state%rowtype;
  opening jsonb;
  cutover date;
  opening_amount numeric;
  manual_delta numeric;
  provider_delta numeric;
  available numeric;
  running numeric;
  posted uuid := gen_random_uuid();
  ledger jsonb;
  nextpaid numeric;
  item jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if length(coalesce(p_idempotency_key,'')) not between 8 and 160
     or p_source_matter_id is null or p_destination_matter_id is null or p_invoice_id is null
     or p_amount_cents is null or p_amount_cents <= 0
     or p_expected_invoice_updated_at is null then
    raise exception 'Complete payment request and current invoice version required';
  end if;
  fp:=md5(p_source_matter_id||':'||p_destination_matter_id||':'||
          p_invoice_id::text||':'||p_amount_cents::text);
  perform pg_advisory_xact_lock(hashtextextended('mio-weekly-trust:'||actor::text,0));
  select * into existing from public.mio_weekly_trust_postings
    where user_id=actor and idempotency_key=p_idempotency_key;
  if found then
    if existing.request_hash <> fp then raise exception 'Idempotency key reused for different payment'; end if;
    return jsonb_build_object('status','already_posted','posting_id',existing.id,
      'amount_cents',existing.amount_cents,'bank_transfer_executed',false);
  end if;
  select json_value into prefs from public.case_mio_user_state
    where user_id=actor and key='mioWeeklyBillingSettingsV1' for update;
  if coalesce(prefs->>'enableAtomicWeeklyTrustPosting','false') <> 'true' then
    raise exception 'Atomic posting is not enabled; remain in review mode';
  end if;
  -- The destination uses the same default eligibility as the review screen:
  -- explicit Weekly Billing override, then appointed/DFPS, closed, and test
  -- defaults. Source trust may be shared from an excluded matter when the
  -- owner explicitly verifies its agreement and leaves Share Trust enabled.
  select * into src from public.matters where id::text=p_source_matter_id;
  if not found then raise exception 'Source matter is missing'; end if;
  select * into dest from public.matters where id::text=p_destination_matter_id and is_active is true;
  if not found then raise exception 'Destination matter is missing or inactive'; end if;
  if not coalesce(
    (prefs->'matters'->p_destination_matter_id->>'included')::boolean,
    not coalesce(
      (prefs->'matters'->p_destination_matter_id->>'appointed')::boolean,
      lower(btrim(coalesce(dest.matter_type,'')))='dfps'
    )
    and lower(btrim(coalesce(dest.case_status,''))) not in ('closed','dismissed')
    and btrim(dest.name) !~* '^test'
  ) then
    raise exception 'Destination matter is excluded from weekly billing';
  end if;
  if src.client_id is null or dest.client_id is null or src.client_id<>dest.client_id then
    raise exception 'Verified same-client identity is required';
  end if;
  if p_source_matter_id<>p_destination_matter_id and
     (coalesce(prefs->'matters'->p_source_matter_id->>'shareTrust','false')<>'true'
      or coalesce(prefs->'matters'->p_source_matter_id->>'agreementAuthorized','false')<>'true') then
    raise exception 'Source trust sharing and signed agreement must be verified';
  end if;
  select * into inv from public.mio_invoices where id=p_invoice_id and user_id=actor for update;
  if not found or inv.matter_id<>p_destination_matter_id or
      inv.invoice_type<>'services' or inv.status not in ('outstanding','partially_paid') or
      inv.client_id is null or inv.client_id<>dest.client_id::text then
    raise exception 'Invoice is not verified eligible service Work OB';
  end if;
  if inv.updated_at is distinct from p_expected_invoice_updated_at then
    raise exception 'Invoice changed since approval; refresh payment review';
  end if;
  if round(coalesce(inv.total-inv.amount_paid,0)*100)::bigint <> round(coalesce(inv.balance,0)*100)::bigint then
    raise exception 'Invoice paid amount and balance do not reconcile';
  end if;
  if round(coalesce(inv.total,0)*100)::bigint <
      round(coalesce(inv.amount_paid,0)*100)::bigint + p_amount_cents
      or round(coalesce(inv.balance,0)*100)::bigint < p_amount_cents then
    raise exception 'Invoice has insufficient unpaid Work OB';
  end if;
  select * into trust_row from public.case_mio_user_state
    where user_id=actor and key='caseMioTrustTransactions' for update;
  if not found or jsonb_typeof(trust_row.json_value)<>'array' then
    raise exception 'Current recorded trust ledger unavailable';
  end if;
  select json_value into opening from public.case_mio_user_state
    where user_id=actor and key='caseMioFinanceOpeningBalances';
  if jsonb_typeof(opening)<>'object' then raise exception 'Opening trust balances unavailable'; end if;
  select nullif(trim(both '"' from coalesce(raw_value,'')),'')::date
    into cutover from public.case_mio_user_state
    where user_id=actor and key='caseMioBillingCutoverDate';
  if cutover is null then raise exception 'Billing cutover date unavailable'; end if;
  -- Older LawPay reconciliation may have received trust funds without adding
  -- them to the classified ledger. Refuse posting until those transactions
  -- are classified or explicitly mirrored in the recorded manual ledger.
  if exists (
    select 1 from public.lawpay_transactions t
    where (t.account_key in ('trust','echeck_trust','clientcredit_trust')
      or exists (select 1 from public.mio_lawpay_accounts a
        where a.provider_account_id=t.account_id
          and a.account_key in ('trust','echeck_trust','clientcredit_trust')
          and a.verified_at is not null))
      and t.currency='USD' and t.amount_cents>0
      and upper(coalesce(t.transaction_type,'CHARGE')) not in ('REFUND','REVERSAL','CHARGEBACK','CREDIT')
      and lower(t.status) in ('completed','settled','succeeded','success')
      and t.occurred_at::date>cutover
      and not exists (select 1 from public.mio_lawpay_ledger_entries e
        where e.identity=t.gateway_transaction_id)
      and not exists (select 1 from jsonb_array_elements(trust_row.json_value) x
        where x->>'lawpay_transaction_id'=t.gateway_transaction_id)
  ) then
    raise exception 'Unclassified LawPay trust transactions require reconciliation';
  end if;
  if exists (
    select 1 from public.lawpay_transactions t
    where t.account_key in ('trust','echeck_trust','clientcredit_trust')
      and t.currency='USD' and t.amount_cents>0
      and lower(t.status) in ('completed','settled','succeeded','success')
      and t.occurred_at::date>cutover
      and not exists (select 1 from public.mio_lawpay_accounts a
        where a.provider_account_id=t.account_id
          and a.account_key in ('trust','echeck_trust','clientcredit_trust')
          and a.verified_at is not null)
  ) then
    raise exception 'LawPay trust settlement account is not verified';
  end if;
  -- Refunds can have an empty account_key even when LawPay settled them to
  -- a verified trust account. Never count the related charge without its outflow.
  if exists (
    select 1 from public.lawpay_transactions t
    where upper(coalesce(t.transaction_type,'')) in ('REFUND','REVERSAL','CHARGEBACK','CREDIT')
      and t.currency='USD' and t.amount_cents>0
      and lower(t.status) in ('completed','settled','succeeded','success')
      and t.occurred_at::date>cutover
      and (t.account_key in ('trust','echeck_trust','clientcredit_trust')
        or exists (select 1 from public.mio_lawpay_accounts a
          where a.provider_account_id=t.account_id
            and a.account_key in ('trust','echeck_trust','clientcredit_trust')
            and a.verified_at is not null))
      and not exists (select 1 from public.mio_lawpay_ledger_entries e
        where e.identity=t.gateway_transaction_id and e.direction='out'
          and e.amount_cents=t.amount_cents
          and e.account_key in ('trust','echeck_trust','clientcredit_trust'))
      and not exists (select 1 from jsonb_array_elements(trust_row.json_value) x
        where x->>'lawpay_transaction_id'=t.gateway_transaction_id
          and x->>'direction'='out')
  ) then
    raise exception 'Unreconciled LawPay trust refunds require reconciliation';
  end if;
  opening_amount:=coalesce((opening->p_source_matter_id->>'matter_trust_funds')::numeric,
                           (opening->p_source_matter_id->>'trust_running_balance')::numeric,0);
  manual_delta:=0;
  for item in select value from jsonb_array_elements(trust_row.json_value) t(value)
      where value->>'matter_id'=p_source_matter_id loop
    if coalesce(item->>'date',left(coalesce(item->>'created_at',''),10)) > cutover::text then
      if item->>'direction' not in ('in','out') or
         (item->>'amount')::numeric < 0 then
        raise exception 'Unverifiable recorded trust transaction';
      end if;
      manual_delta:=manual_delta +
        (case when item->>'direction'='out' then -1 else 1 end)*(item->>'amount')::numeric;
    end if;
  end loop;
  -- The classified provider ledger contains reconciled trust deposits/refunds.
  -- Suppress only the provider entry already mirrored by a manual row.
  -- Suppressing the entire provider ledger when any one manual row has a
  -- LawPay ID would silently omit unrelated trust deposits.
  select coalesce(sum(case when e.direction='out' then -e.amount_cents else e.amount_cents end),0)/100.0
    into provider_delta from public.mio_lawpay_ledger_entries e
    where e.matter_id=p_source_matter_id and
      e.account_key in ('trust','echeck_trust','clientcredit_trust') and
      e.currency='USD' and e.occurred_at::date>cutover
      and not exists (
        select 1 from jsonb_array_elements(trust_row.json_value) x
        where x->>'matter_id'=p_source_matter_id
          and x->>'lawpay_transaction_id'=e.identity
          and coalesce(x->>'date',left(coalesce(x->>'created_at',''),10))>cutover::text
      );
  available:=round(opening_amount+manual_delta+provider_delta,2);
  if available<0 or round(available*100)::bigint < p_amount_cents then
    raise exception 'Reconciled trust funds are insufficient or ambiguous';
  end if;
  nextpaid:=round(inv.amount_paid+p_amount_cents/100.0,2);
  ledger:=jsonb_build_object('id',posted::text,'matter_id',p_source_matter_id,
    'source_matter_id',p_source_matter_id,'target_matter_id',p_destination_matter_id,
    'client_id',src.client_id::text,'date',current_date::text,'created_at',now()::text,
    'direction','out','transaction_type','operating_transfer',
    'amount',p_amount_cents/100.0,'invoice_id',p_invoice_id::text,
    'idempotency_key','weekly-billing:'||p_idempotency_key,
    'reference',inv.invoice_number,'source','Mio weekly billing atomic ledger',
    'memo','Applied trust to earned service invoice; physical bank movement separately reconciled');
  insert into public.mio_weekly_trust_postings
    (id,user_id,idempotency_key,request_hash,source_matter_id,destination_matter_id,invoice_id,amount_cents,minimum_paid_cents,ledger_record)
  values (posted,actor,p_idempotency_key,fp,p_source_matter_id,p_destination_matter_id,p_invoice_id,p_amount_cents,round(nextpaid*100)::bigint,ledger);
  update public.mio_invoices set amount_paid=nextpaid,balance=round(total-nextpaid,2),
    status=case when round(total-nextpaid,2)<=0 then 'paid' else 'outstanding' end,
    updated_at=now() where id=inv.id;
  update public.case_mio_user_state set
    json_value=jsonb_build_array(ledger)||trust_row.json_value,
    raw_value=(jsonb_build_array(ledger)||trust_row.json_value)::text,
    origin='mio_weekly_trust_atomic_posting',updated_at=now()
    where user_id=actor and key='caseMioTrustTransactions';
  insert into public.mio_invoice_events(invoice_id,user_id,event_type,amount,details,occurred_at)
    values(p_invoice_id,actor,'trust_applied',p_amount_cents/100.0,
      jsonb_build_object('source','weekly_billing_atomic_v1','posting_id',posted,
        'source_matter_id',p_source_matter_id,'destination_matter_id',p_destination_matter_id,
        'bank_transfer_executed',false),now());
  return jsonb_build_object('status','ledger_posted','posting_id',posted,
    'amount_cents',p_amount_cents,'bank_transfer_executed',false);
end $$;
revoke all on function public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz)
  from public,anon,authenticated;
