-- V325: a consultation can be recorded without forcing the reviewer to create or select a PNC
-- workflow. The optional workflow id is still stored when supplied. Every amount, account,
-- eligibility, duplicate, invoice and concurrency guard remains the V323 posting contract.
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

comment on function public.mio_post_lawpay_classification_v323(jsonb,text) is
  'Records one verified LawPay effect exactly once. A PNC workflow association is optional; all financial and duplicate guards remain enforced.';
