-- Weekly billing internal trust-to-earned-fees posting. This records accounting
-- allocations only. It does NOT initiate an actual bank-to-bank transfer.
-- Live use is disabled unless an explicit feature gate is enabled in user settings.
create table if not exists public.mio_weekly_trust_postings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idempotency_key text not null,
  source_matter_id text not null,
  destination_matter_id text not null,
  invoice_id uuid not null references public.mio_invoices(id),
  amount_cents bigint not null check (amount_cents > 0),
  request_hash text not null,
  ledger_record jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists mio_weekly_trust_postings_invoice_idx
  on public.mio_weekly_trust_postings (invoice_id, created_at);
alter table public.mio_weekly_trust_postings enable row level security;
drop policy if exists mio_weekly_trust_postings_read_own on public.mio_weekly_trust_postings;
create policy mio_weekly_trust_postings_read_own
  on public.mio_weekly_trust_postings for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.mio_weekly_trust_postings from anon, authenticated;
grant select on public.mio_weekly_trust_postings to authenticated;

-- Existing Mio clients still save the trust JSON state. Reinstate immutable
-- weekly postings whenever an older browser saves a stale trust-state array.
create or replace function public.mio_preserve_weekly_trust_postings_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  p record;
  merged jsonb;
begin
  if new.key <> 'caseMioTrustTransactions' then return new; end if;
  merged := coalesce(new.json_value, case when new.raw_value is not null then new.raw_value::jsonb else '[]'::jsonb end);
  if jsonb_typeof(merged) <> 'array' then
    raise exception 'Trust ledger must remain an array';
  end if;
  for p in select id, ledger_record from public.mio_weekly_trust_postings where user_id=new.user_id order by created_at, id loop
    if not exists (select 1 from jsonb_array_elements(merged) row where row->>'id'=p.id::text) then
      merged:=jsonb_build_array(p.ledger_record)||merged;
    end if;
  end loop;
  new.json_value:=merged;
  new.raw_value:=merged::text;
  return new;
end $$;
drop trigger if exists mio_weekly_preserve_trust_state_v1 on public.case_mio_user_state;
create trigger mio_weekly_preserve_trust_state_v1 before insert or update
  on public.case_mio_user_state for each row
  execute function public.mio_preserve_weekly_trust_postings_v1();
revoke all on function public.mio_preserve_weekly_trust_postings_v1() from public,anon,authenticated;

-- A stale invoice upsert must not erase an immutable weekly trust payment.
create or replace function public.mio_preserve_weekly_invoice_payment_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare guaranteed numeric;
begin
  select coalesce(sum(amount_cents),0)/100.0 into guaranteed
    from public.mio_weekly_trust_postings where invoice_id=new.id and user_id=new.user_id;
  if new.amount_paid < guaranteed - 0.005 or
     (guaranteed > 0 and new.status in ('void','draft')) then
    raise exception 'Cannot erase an already-posted weekly trust payment';
  end if;
  return new;
end $$;
drop trigger if exists mio_weekly_invoice_payment_guard_v1 on public.mio_invoices;
create trigger mio_weekly_invoice_payment_guard_v1 before update
  on public.mio_invoices for each row
  execute function public.mio_preserve_weekly_invoice_payment_v1();
revoke all on function public.mio_preserve_weekly_invoice_payment_v1() from public,anon,authenticated;

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
  if coalesce(prefs->'matters'->p_source_matter_id->>'included','false') <> 'true'
     or coalesce(prefs->'matters'->p_destination_matter_id->>'included','false') <> 'true' then
    raise exception 'Both matters must be explicitly included in weekly billing';
  end if;
  select * into src from public.matters where id::text=p_source_matter_id and is_active is true;
  if not found then raise exception 'Source matter is missing or inactive'; end if;
  select * into dest from public.matters where id::text=p_destination_matter_id and is_active is true;
  if not found then raise exception 'Destination matter is missing or inactive'; end if;
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
  select coalesce(nullif(trim(both '"' from coalesce(raw_value,'')),'')::date,current_date)
    into cutover from public.case_mio_user_state
    where user_id=actor and key='caseMioBillingCutoverDate';
  if cutover is null then raise exception 'Billing cutover date unavailable'; end if;
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
  -- Avoid counting a provider deposit twice if a manual row imported LawPay IDs.
  if exists (select 1 from jsonb_array_elements(trust_row.json_value) x
             where x->>'matter_id'=p_source_matter_id and
                   coalesce(x->>'lawpay_transaction_id','')<>'') then
    provider_delta:=0;
  else
    select coalesce(sum(case when direction='out' then -amount_cents else amount_cents end),0)/100.0
      into provider_delta from public.mio_lawpay_ledger_entries
      where matter_id=p_source_matter_id and
        account_key in ('trust','echeck_trust','clientcredit_trust') and
        currency='USD' and occurred_at::date>cutover;
  end if;
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
    (id,user_id,idempotency_key,request_hash,source_matter_id,destination_matter_id,invoice_id,amount_cents,ledger_record)
  values (posted,actor,p_idempotency_key,fp,p_source_matter_id,p_destination_matter_id,p_invoice_id,p_amount_cents,ledger);
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
-- Keep explicitly disabled until end-to-end simulation and account reconciliation.
-- When released, grant execute only to authenticated, after signed agreement review.
