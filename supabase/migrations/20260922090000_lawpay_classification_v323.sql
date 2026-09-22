-- LawPay classification, deposit-account mapping and atomic posting (V323).
--
-- Nothing in this migration charges, refunds or transfers money. These objects record what a
-- verified provider transaction did, exactly once, and keep an audit trail of corrections.
-- Mio does not keep a general ledger: a trust posting is a single-entry row with an explicit
-- account and direction, and an operating posting is recorded on the classification itself
-- (plus an invoice event only when an invoice is specifically identified), so no existing
-- derived operating total is counted twice.
--
-- The posting identity is the provider's transaction ID. It is immutable: resolving or
-- correcting which trust/operating account the money moved through never changes it, and a
-- second webhook, rescan or retry about the same transaction cannot post again.

create table if not exists public.mio_lawpay_accounts(
  provider_account_id text primary key,
  account_key text not null,
  bank_account_id text not null default '',
  bank_role text not null default '',
  label text not null default '',
  last4 text not null default '',
  is_active boolean not null default true,
  verified_by text not null default '',
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint mio_lawpay_accounts_key_check check (account_key in ('operating','trust','echeck_operating','echeck_trust','clientcredit_trust')),
  constraint mio_lawpay_accounts_role_check check (bank_role in ('','trust','operating','other'))
);

create table if not exists public.mio_lawpay_classifications(
  id uuid primary key default gen_random_uuid(),
  identity text not null,
  gateway_transaction_id text not null,
  provider_account_id text not null default '',
  ownership text not null,
  matter_id text not null default '',
  pnc_workflow_id text not null default '',
  other_reason text not null default '',
  actual_account_key text not null default '',
  account_source text not null default '',
  account_evidence text not null default '',
  account_explanation text not null default '',
  account_verified_by text not null default '',
  account_verified_at timestamptz,
  category text not null,
  direction text not null default '',
  money_out boolean not null default false,
  currency text not null default 'USD',
  amount_cents bigint not null default 0,
  processor_fee_cents bigint,
  net_settlement_cents bigint,
  invoice_id uuid,
  explanation text not null default '',
  original_transaction_id text not null default '',
  original_link_verified boolean not null default false,
  posting_status text not null default 'saved',
  posted_at timestamptz,
  matched_entry_id text not null default '',
  matched_entry_source text not null default '',
  corrects_classification_id uuid references public.mio_lawpay_classifications(id),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mio_lawpay_classifications_ownership_check check (ownership in ('matter','pnc','other_unresolved')),
  constraint mio_lawpay_classifications_direction_check check (direction in ('','in','out','none')),
  constraint mio_lawpay_classifications_status_check check (posting_status in ('saved','awaiting_posting','posted','matched','reversed'))
);

-- A financial event is posted or matched at most once. Correcting a classification reverses
-- the old row and posts a linked new one, so exactly one active row exists per identity.
create unique index if not exists mio_lawpay_classifications_identity_active
  on public.mio_lawpay_classifications(identity) where posting_status in ('posted','matched');
-- One stored ledger entry may account for one transaction only.
create unique index if not exists mio_lawpay_classifications_matched_entry
  on public.mio_lawpay_classifications(matched_entry_id) where matched_entry_id <> '';
create index if not exists mio_lawpay_classifications_transaction
  on public.mio_lawpay_classifications(gateway_transaction_id);
create index if not exists mio_lawpay_classifications_matter
  on public.mio_lawpay_classifications(matter_id) where matter_id <> '';

create table if not exists public.mio_lawpay_ledger_entries(
  id uuid primary key default gen_random_uuid(),
  identity text not null,
  classification_id uuid not null references public.mio_lawpay_classifications(id),
  entry_kind text not null,
  direction text not null,
  account_key text not null default '',
  matter_id text not null default '',
  amount_cents bigint not null,
  currency text not null default 'USD',
  occurred_at timestamptz not null default now(),
  provider_account_id text not null default '',
  reverses_entry_id uuid references public.mio_lawpay_ledger_entries(id),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  constraint mio_lawpay_ledger_entries_direction_check check (direction in ('in','out'))
);
-- One entry of each kind per classification, and one reversal per reversed entry.
create unique index if not exists mio_lawpay_ledger_entries_once
  on public.mio_lawpay_ledger_entries(classification_id, entry_kind);
create unique index if not exists mio_lawpay_ledger_entries_reversal_once
  on public.mio_lawpay_ledger_entries(reverses_entry_id) where reverses_entry_id is not null;
create index if not exists mio_lawpay_ledger_entries_identity
  on public.mio_lawpay_ledger_entries(identity);

alter table public.mio_lawpay_accounts enable row level security;
alter table public.mio_lawpay_classifications enable row level security;
alter table public.mio_lawpay_ledger_entries enable row level security;
-- Review data is reached through the gateway, which authorises the caller. Browsers and
-- anonymous sessions cannot read or write these tables directly.
revoke all on public.mio_lawpay_accounts, public.mio_lawpay_classifications, public.mio_lawpay_ledger_entries from public, anon, authenticated;

-- Posting amounts are always derived from the stored provider record, never from the caller.
-- The function is one transaction: classification, ledger entry, posting status and any
-- invoice event commit together or not at all.
create or replace function public.mio_lawpay_write_posting_v323(p_classification_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.mio_lawpay_classifications%rowtype;
  tx public.lawpay_transactions%rowtype;
  v_entry_id uuid;
  v_entry_kind text;
  v_direction text;
  v_trust_delta bigint := 0;
  v_money_out boolean;
  v_type text;
begin
  select * into c from public.mio_lawpay_classifications where id = p_classification_id for update;
  if not found then raise exception 'Classification not found.'; end if;
  select * into tx from public.lawpay_transactions where gateway_transaction_id = c.gateway_transaction_id for update;
  if not found then raise exception 'The stored LawPay transaction is missing, so nothing can be posted.'; end if;
  v_type := upper(coalesce(tx.transaction_type,''));
  v_money_out := v_type in ('REFUND','REVERSAL','CHARGEBACK','CREDIT');
  v_direction := case when c.category in ('client_refund','chargeback') or v_money_out then 'out' else 'in' end;
  if c.category = 'other' then
    if c.direction = '' then return jsonb_build_object('status','needs_direction','reason','Say whether this Other transaction moved money in or out.'); end if;
    v_direction := c.direction;
  end if;
  if position('trust' in c.actual_account_key) > 0 then
    v_entry_kind := case c.category when 'trust_deposit' then 'trust_deposit' when 'client_refund' then 'trust_refund' when 'chargeback' then 'trust_refund' else 'trust_other' end;
    insert into public.mio_lawpay_ledger_entries(identity,classification_id,entry_kind,direction,account_key,matter_id,amount_cents,currency,occurred_at,provider_account_id,created_by)
    values (c.identity,c.id,v_entry_kind,v_direction,c.actual_account_key,c.matter_id,greatest(0,c.amount_cents),c.currency,coalesce(tx.occurred_at,now()),coalesce(tx.account_id,''),p_actor)
    returning id into v_entry_id;
    v_trust_delta := case when v_direction = 'out' then -abs(c.amount_cents) else abs(c.amount_cents) end;
  end if;
  -- An invoice is applied only when one is specifically identified, and only as an operating
  -- payment event: a trust deposit is client money and never pays an invoice.
  if c.invoice_id is not null and c.category in ('consultation_payment','earned_fee_payment') then
    if not exists(select 1 from public.mio_invoices where id = c.invoice_id) then raise exception 'The selected invoice no longer exists.'; end if;
    if exists(select 1 from public.mio_invoices where id = c.invoice_id and c.matter_id <> '' and coalesce(matter_id,'') <> c.matter_id) then
      raise exception 'The selected invoice belongs to a different matter.';
    end if;
    if not exists(select 1 from public.mio_invoice_events where provider_event_id = c.identity) then
      insert into public.mio_invoice_events(invoice_id,user_id,event_type,amount,provider_event_id,details,occurred_at)
      values (c.invoice_id,null,'lawpay_payment_recorded',c.amount_cents/100.0,c.identity,
        jsonb_build_object('source','lawpay_classification_v323','classification_id',c.id,'account_key',c.actual_account_key,'provider_transaction_id',c.gateway_transaction_id),coalesce(tx.occurred_at,now()));
    end if;
  end if;
  update public.mio_lawpay_classifications set posting_status='posted',posted_at=now(),updated_at=now(),
    amount_cents=greatest(0,coalesce(tx.amount_cents,0)),currency=coalesce(nullif(tx.currency,''),'USD'),money_out=v_money_out
    where id = c.id;
  return jsonb_build_object('status','posted','classification_id',c.id,'ledger_entry_id',v_entry_id,'entry_kind',coalesce(v_entry_kind,''),
    'trust_delta_cents',v_trust_delta,'amount_cents',greatest(0,coalesce(tx.amount_cents,0)),'account_key',c.actual_account_key);
end $$;
revoke all on function public.mio_lawpay_write_posting_v323(uuid,text) from public, anon, authenticated;

-- Record (post) one classified LawPay transaction. Refuses a second posting of the same
-- provider transaction, whatever produced the call: a webhook replay, a rescan, a retry,
-- another tab, or a re-classification that has not been corrected first.
create or replace function public.mio_post_lawpay_classification_v323(p_classification jsonb, p_actor text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tx public.lawpay_transactions%rowtype;
  v_existing public.mio_lawpay_classifications%rowtype;
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_provider_id text := trim(coalesce(p_classification->>'gateway_transaction_id',''));
  v_category text := trim(coalesce(p_classification->>'category',''));
  v_ownership text := trim(coalesce(p_classification->>'ownership',''));
  v_account text := trim(coalesce(p_classification->>'actual_account_key',''));
  v_source text := trim(coalesce(p_classification->>'account_source',''));
  v_matter text := trim(coalesce(p_classification->>'matter_id',''));
  v_pnc text := trim(coalesce(p_classification->>'pnc_workflow_id',''));
  v_other text := trim(coalesce(p_classification->>'other_reason',''));
  v_explanation text := trim(coalesce(p_classification->>'explanation',''));
  v_invoice uuid := nullif(trim(coalesce(p_classification->>'invoice_id','')),'')::uuid;
  v_family text;
  v_id uuid;
begin
  if v_actor is null then raise exception 'Mio could not tell who is recording this transaction.'; end if;
  if v_provider_id = '' then raise exception 'A provider transaction ID is required.'; end if;
  select * into tx from public.lawpay_transactions where gateway_transaction_id = v_provider_id for update;
  if not found then raise exception 'LawPay transaction % is not stored in Mio, so it cannot be recorded.', v_provider_id; end if;
  if upper(coalesce(tx.status,'')) not in ('COMPLETED','COMPLETE','SETTLED','SUCCEEDED','SUCCESS','PAID','CAPTURED') then
    return jsonb_build_object('status','not_postable','reason','LawPay reports this transaction as '||coalesce(nullif(upper(tx.status),''),'unknown')||', so it is kept for review and nothing posts.');
  end if;
  if v_category = 'void' then return jsonb_build_object('status','no_money_moved','reason','A void or cancellation moves no money, so nothing posts.'); end if;
  if v_category not in ('trust_deposit','consultation_payment','earned_fee_payment','client_refund','chargeback','other') then raise exception 'Choose the transaction type before recording it.'; end if;
  if v_ownership not in ('matter','pnc','other_unresolved') then raise exception 'Choose whether this transaction belongs to a matter, to a PNC consultation, or to neither.'; end if;
  if v_ownership = 'matter' and v_matter = '' then raise exception 'Select the matter this transaction belongs to.'; end if;
  if v_ownership = 'pnc' and v_pnc = '' then raise exception 'Select the PNC this transaction belongs to.'; end if;
  if v_ownership = 'other_unresolved' and v_other = '' then raise exception 'Say why this transaction belongs to neither, so the decision stays reviewable.'; end if;
  if v_category = 'other' and v_explanation = '' then raise exception 'Explain this Other transaction type.'; end if;
  if v_account = '' then
    return jsonb_build_object('status','account_not_established','reason','The deposit account is not established yet. Record the actual trust or operating account with supporting evidence, then record the transaction.');
  end if;
  v_family := case when position('trust' in v_account) > 0 then 'trust' when position('operating' in v_account) > 0 then 'operating' else '' end;
  if v_family = '' then raise exception 'Choose an actual trust or operating account.'; end if;
  if v_category = 'trust_deposit' and v_family <> 'trust' then raise exception 'A trust deposit cannot be recorded against the operating account.'; end if;
  if v_category in ('consultation_payment','earned_fee_payment') and v_family <> 'operating' then raise exception 'An operating payment cannot be recorded against the trust account.'; end if;
  if v_invoice is not null and v_category not in ('consultation_payment','earned_fee_payment') then raise exception 'An invoice can be applied only to a consultation or earned-fee payment.'; end if;
  if v_source = 'manually_verified' then
    if trim(coalesce(p_classification->>'account_evidence','')) = '' then raise exception 'Record the LawPay transaction or report, or the bank-statement reference, that supports this account.'; end if;
    if trim(coalesce(p_classification->>'account_explanation','')) = '' then raise exception 'Explain how the account was confirmed, so the decision stays reviewable.'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mio-lawpay-posting:'||v_provider_id,0));
  select * into v_existing from public.mio_lawpay_classifications where identity = v_provider_id and posting_status in ('posted','matched');
  if found then
    return jsonb_build_object('status','already_posted','classification_id',v_existing.id,'posted_at',v_existing.posted_at,
      'reason','This transaction is already accounted for in Mio, so nothing else posts. Use a linked correction if the classification is wrong.');
  end if;
  insert into public.mio_lawpay_classifications(identity,gateway_transaction_id,provider_account_id,ownership,matter_id,pnc_workflow_id,other_reason,
    actual_account_key,account_source,account_evidence,account_explanation,account_verified_by,account_verified_at,category,direction,money_out,currency,
    amount_cents,processor_fee_cents,net_settlement_cents,invoice_id,explanation,original_transaction_id,original_link_verified,posting_status,created_by)
  values (v_provider_id,v_provider_id,coalesce(tx.account_id,''),v_ownership,v_matter,v_pnc,v_other,
    v_account,case when v_source in ('reported_by_lawpay','payment_request','manually_verified') then v_source else '' end,
    coalesce(p_classification->>'account_evidence',''),coalesce(p_classification->>'account_explanation',''),
    case when v_source = 'manually_verified' then v_actor else '' end,case when v_source = 'manually_verified' then now() else null end,
    v_category,coalesce(p_classification->>'direction',''),false,coalesce(nullif(tx.currency,''),'USD'),
    greatest(0,coalesce(tx.amount_cents,0)),
    case when p_classification ? 'processor_fee_cents' then (p_classification->>'processor_fee_cents')::bigint else null end,
    case when p_classification ? 'net_settlement_cents' then (p_classification->>'net_settlement_cents')::bigint else null end,
    v_invoice,v_explanation,trim(coalesce(p_classification->>'original_transaction_id','')),
    coalesce((p_classification->>'original_link_verified')::boolean,false),'awaiting_posting',v_actor)
  returning id into v_id;
  return public.mio_lawpay_write_posting_v323(v_id,v_actor) || jsonb_build_object('identity',v_provider_id,'provider_account_id',coalesce(tx.account_id,''));
end $$;
revoke all on function public.mio_post_lawpay_classification_v323(jsonb,text) from public, anon, authenticated;
grant execute on function public.mio_post_lawpay_classification_v323(jsonb,text) to service_role;

-- Save for later: parks a decision without posting anything and without marking the
-- transaction accounted for.
create or replace function public.mio_save_lawpay_classification_v323(p_classification jsonb, p_actor text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tx public.lawpay_transactions%rowtype;
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_provider_id text := trim(coalesce(p_classification->>'gateway_transaction_id',''));
  v_source text := trim(coalesce(p_classification->>'account_source',''));
  v_existing public.mio_lawpay_classifications%rowtype;
  v_id uuid;
begin
  if v_actor is null then raise exception 'Mio could not tell who is saving this classification.'; end if;
  select * into tx from public.lawpay_transactions where gateway_transaction_id = v_provider_id for update;
  if not found then raise exception 'LawPay transaction % is not stored in Mio.', v_provider_id; end if;
  perform pg_advisory_xact_lock(hashtextextended('mio-lawpay-posting:'||v_provider_id,0));
  select * into v_existing from public.mio_lawpay_classifications where identity = v_provider_id and posting_status in ('posted','matched');
  if found then
    return jsonb_build_object('status','already_posted','classification_id',v_existing.id,'reason','This transaction is already accounted for, so the saved decision was not changed.');
  end if;
  update public.mio_lawpay_classifications set posting_status='reversed',updated_at=now()
    where identity = v_provider_id and posting_status in ('saved','awaiting_posting');
  insert into public.mio_lawpay_classifications(identity,gateway_transaction_id,provider_account_id,ownership,matter_id,pnc_workflow_id,other_reason,
    actual_account_key,account_source,account_evidence,account_explanation,account_verified_by,account_verified_at,category,direction,currency,
    amount_cents,processor_fee_cents,net_settlement_cents,invoice_id,explanation,posting_status,created_by)
  values (v_provider_id,v_provider_id,coalesce(tx.account_id,''),coalesce(nullif(trim(coalesce(p_classification->>'ownership','')),''),'other_unresolved'),
    trim(coalesce(p_classification->>'matter_id','')),trim(coalesce(p_classification->>'pnc_workflow_id','')),trim(coalesce(p_classification->>'other_reason','')),
    trim(coalesce(p_classification->>'actual_account_key','')),v_source,
    coalesce(p_classification->>'account_evidence',''),coalesce(p_classification->>'account_explanation',''),
    case when v_source = 'manually_verified' then v_actor else '' end,case when v_source = 'manually_verified' then now() else null end,
    coalesce(nullif(trim(coalesce(p_classification->>'category','')),''),'other'),coalesce(p_classification->>'direction',''),coalesce(nullif(tx.currency,''),'USD'),
    greatest(0,coalesce(tx.amount_cents,0)),
    case when p_classification ? 'processor_fee_cents' then (p_classification->>'processor_fee_cents')::bigint else null end,
    case when p_classification ? 'net_settlement_cents' then (p_classification->>'net_settlement_cents')::bigint else null end,
    nullif(trim(coalesce(p_classification->>'invoice_id','')),'')::uuid,trim(coalesce(p_classification->>'explanation','')),'saved',v_actor)
  returning id into v_id;
  return jsonb_build_object('status','saved','classification_id',v_id,'identity',v_provider_id);
end $$;
revoke all on function public.mio_save_lawpay_classification_v323(jsonb,text) from public, anon, authenticated;
grant execute on function public.mio_save_lawpay_classification_v323(jsonb,text) to service_role;

alter table public.mio_lawpay_classifications add column if not exists matched_at timestamptz;

-- Correct a recorded classification with linked entries: the previous ledger row is reversed
-- (never deleted or overwritten), the previous classification is marked reversed, and the
-- corrected decision posts as a new record linked to the one it replaces.
create or replace function public.mio_correct_lawpay_classification_v323(p_classification jsonb, p_reason text, p_actor text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_reason text := trim(coalesce(p_reason,''));
  v_provider_id text := trim(coalesce(p_classification->>'gateway_transaction_id',''));
  v_previous public.mio_lawpay_classifications%rowtype;
  v_entry public.mio_lawpay_ledger_entries%rowtype;
  v_category text := trim(coalesce(p_classification->>'category',''));
  v_account text := trim(coalesce(p_classification->>'actual_account_key',''));
  v_new_id uuid;
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Mio could not tell who is correcting this transaction.'; end if;
  if v_reason = '' then raise exception 'Explain why the recorded classification is being corrected.'; end if;
  if v_provider_id = '' then raise exception 'A provider transaction ID is required.'; end if;
  select * into v_previous from public.mio_lawpay_classifications
    where identity = v_provider_id and posting_status = 'posted' order by posted_at desc limit 1 for update;
  if not found then raise exception 'Only a recorded transaction can be corrected.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mio-lawpay-posting:'||v_provider_id,0));
  select * into v_entry from public.mio_lawpay_ledger_entries where classification_id = v_previous.id and entry_kind <> 'reversal' order by created_at limit 1;
  if found then
    if exists(select 1 from public.mio_lawpay_ledger_entries where reverses_entry_id = v_entry.id) then raise exception 'This posting has already been corrected.'; end if;
    insert into public.mio_lawpay_ledger_entries(identity,classification_id,entry_kind,direction,account_key,matter_id,amount_cents,currency,occurred_at,provider_account_id,reverses_entry_id,created_by)
    values (v_entry.identity,v_previous.id,'reversal',case when v_entry.direction = 'in' then 'out' else 'in' end,v_entry.account_key,v_entry.matter_id,v_entry.amount_cents,v_entry.currency,v_entry.occurred_at,v_entry.provider_account_id,v_entry.id,v_actor);
  end if;
  update public.mio_lawpay_classifications set posting_status = 'reversed', updated_at = now() where id = v_previous.id;
  v_result := public.mio_post_lawpay_classification_v323(p_classification,v_actor);
  if coalesce(v_result->>'status','') <> 'posted' then
    -- The whole correction rolls back together: a refused corrected posting must not leave the
    -- previous record reversed. Raising undoes the reversal in the same transaction.
    raise exception 'The corrected classification was refused: %', coalesce(v_result->>'reason','unknown reason');
  end if;
  v_new_id := (v_result->>'classification_id')::uuid;
  update public.mio_lawpay_classifications set corrects_classification_id = v_previous.id, updated_at = now() where id = v_new_id;
  return v_result || jsonb_build_object('corrected_classification_id',v_previous.id,'reversed_entry_id',v_entry.id,'reason',v_reason);
end $$;
revoke all on function public.mio_correct_lawpay_classification_v323(jsonb,text,text) from public, anon, authenticated;
grant execute on function public.mio_correct_lawpay_classification_v323(jsonb,text,text) to service_role;

-- Match an existing stored entry to this transaction instead of posting another one. The entry
-- must exist, be the same amount and direction, and belong to the same matter; an entry already
-- matched by another transaction is refused, so choosing "match" cannot account for an
-- unrelated transaction.
create or replace function public.mio_match_lawpay_classification_v323(p_classification jsonb, p_owner uuid, p_actor text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  tx public.lawpay_transactions%rowtype;
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_provider_id text := trim(coalesce(p_classification->>'gateway_transaction_id',''));
  v_entry_id text := trim(coalesce(p_classification->>'matched_entry_id',''));
  v_source text := trim(coalesce(p_classification->>'matched_entry_source',''));
  v_matter text := trim(coalesce(p_classification->>'matter_id',''));
  v_direction text;
  v_entry_amount bigint;
  v_entry_matter text;
  v_entry_direction text;
  v_id uuid;
begin
  if v_actor is null then raise exception 'Mio could not tell who is matching this transaction.'; end if;
  if v_provider_id = '' then raise exception 'A provider transaction ID is required.'; end if;
  if v_entry_id = '' then raise exception 'Select the existing ledger entry this transaction matches.'; end if;
  if v_source not in ('lawpay_ledger','trust_ledger') then raise exception 'Choose which stored ledger the matched entry came from.'; end if;
  select * into tx from public.lawpay_transactions where gateway_transaction_id = v_provider_id for update;
  if not found then raise exception 'LawPay transaction % is not stored in Mio.', v_provider_id; end if;
  v_direction := case when upper(coalesce(tx.transaction_type,'')) in ('REFUND','REVERSAL','CHARGEBACK','CREDIT') then 'out' else 'in' end;
  perform pg_advisory_xact_lock(hashtextextended('mio-lawpay-posting:'||v_provider_id,0));
  if exists(select 1 from public.mio_lawpay_classifications where identity = v_provider_id and posting_status in ('posted','matched')) then
    return jsonb_build_object('status','already_posted','reason','This transaction is already accounted for in Mio, so nothing was matched.');
  end if;
  if exists(select 1 from public.mio_lawpay_classifications where matched_entry_id = v_entry_id) then
    return jsonb_build_object('status','entry_already_matched','reason','That ledger entry already accounts for a different LawPay transaction.');
  end if;
  if v_source = 'lawpay_ledger' then
    select amount_cents,matter_id,direction into v_entry_amount,v_entry_matter,v_entry_direction
      from public.mio_lawpay_ledger_entries where id::text = v_entry_id and entry_kind <> 'reversal';
    if v_entry_amount is null then return jsonb_build_object('status','entry_not_found','reason','That Mio ledger entry could not be found, so nothing was matched.'); end if;
  else
    select (coalesce((element->>'amount')::numeric,0) * 100)::bigint,coalesce(element->>'matter_id',''),
        case when element->>'direction' in ('in','out') then element->>'direction' when coalesce((element->>'amount')::numeric,0) < 0 then 'out' else 'in' end
      into v_entry_amount,v_entry_matter,v_entry_direction
      from public.case_mio_user_state s,
           lateral jsonb_array_elements(coalesce(s.json_value, (s.raw_value)::jsonb)) element
      where s.user_id = p_owner and s.key = 'caseMioTrustTransactions' and element->>'id' = v_entry_id
      limit 1;
    if v_entry_amount is null then return jsonb_build_object('status','entry_not_found','reason','That trust ledger entry could not be found for this account, so nothing was matched.'); end if;
  end if;
  if abs(v_entry_amount) <> greatest(0,coalesce(tx.amount_cents,0)) then
    raise exception 'The selected entry is not the same amount as this LawPay transaction, so it cannot account for it.';
  end if;
  if v_entry_direction is distinct from v_direction then
    raise exception 'The selected entry moves money the other way, so it cannot account for this transaction.';
  end if;
  if v_matter <> '' and coalesce(v_entry_matter,'') <> '' and v_entry_matter <> v_matter then
    raise exception 'The selected entry belongs to a different matter.';
  end if;
  insert into public.mio_lawpay_classifications(identity,gateway_transaction_id,provider_account_id,ownership,matter_id,other_reason,
    actual_account_key,account_source,category,direction,currency,amount_cents,explanation,posting_status,matched_entry_id,matched_entry_source,matched_at,created_by)
  values (v_provider_id,v_provider_id,coalesce(tx.account_id,''),coalesce(nullif(trim(coalesce(p_classification->>'ownership','')),''),'other_unresolved'),
    v_matter,trim(coalesce(p_classification->>'other_reason','')),trim(coalesce(p_classification->>'actual_account_key','')),
    trim(coalesce(p_classification->>'account_source','')),coalesce(nullif(trim(coalesce(p_classification->>'category','')),''),'other'),v_direction,
    coalesce(nullif(tx.currency,''),'USD'),greatest(0,coalesce(tx.amount_cents,0)),trim(coalesce(p_classification->>'explanation','')),
    'matched',v_entry_id,v_source,now(),v_actor)
  returning id into v_id;
  return jsonb_build_object('status','matched','classification_id',v_id,'matched_entry_id',v_entry_id,'matched_entry_source',v_source,'identity',v_provider_id);
end $$;
revoke all on function public.mio_match_lawpay_classification_v323(jsonb,uuid,text) from public, anon, authenticated;
grant execute on function public.mio_match_lawpay_classification_v323(jsonb,uuid,text) to service_role;

-- Administrator mapping of a provider account ID onto the firm's own account. IDs are stored
-- and compared exactly as the provider reports them; nothing is lowercased or padded.
create or replace function public.mio_map_lawpay_account_v323(p_mapping jsonb, p_actor text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_provider text := trim(coalesce(p_mapping->>'provider_account_id',''));
  v_key text := trim(coalesce(p_mapping->>'account_key',''));
  v_row public.mio_lawpay_accounts%rowtype;
begin
  if v_actor is null then raise exception 'Mio could not tell who is recording this account mapping.'; end if;
  if v_provider = '' then raise exception 'A LawPay account ID is required.'; end if;
  if v_key not in ('operating','trust','echeck_operating','echeck_trust','clientcredit_trust') then raise exception 'Choose which firm account this LawPay account settles into.'; end if;
  insert into public.mio_lawpay_accounts(provider_account_id,account_key,bank_account_id,bank_role,label,last4,is_active,verified_by,verified_at,updated_at)
  values (v_provider,v_key,trim(coalesce(p_mapping->>'bank_account_id','')),trim(coalesce(p_mapping->>'bank_role','')),trim(coalesce(p_mapping->>'label','')),trim(coalesce(p_mapping->>'last4','')),
    coalesce((p_mapping->>'is_active')::boolean,true),v_actor,now(),now())
  on conflict (provider_account_id) do update set account_key=excluded.account_key,bank_account_id=excluded.bank_account_id,bank_role=excluded.bank_role,
    label=excluded.label,last4=excluded.last4,is_active=excluded.is_active,verified_by=excluded.verified_by,verified_at=now(),updated_at=now()
  returning * into v_row;
  return jsonb_build_object('status','mapped','provider_account_id',v_row.provider_account_id,'account_key',v_row.account_key,'bank_account_id',v_row.bank_account_id,'is_active',v_row.is_active);
end $$;
revoke all on function public.mio_map_lawpay_account_v323(jsonb,text) from public, anon, authenticated;
grant execute on function public.mio_map_lawpay_account_v323(jsonb,text) to service_role;






