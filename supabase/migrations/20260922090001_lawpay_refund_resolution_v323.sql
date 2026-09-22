-- LawPay refund relationship resolution (V323, fifth increment).
--
-- A refund LawPay lists separately and a charge's own refunded total may describe the same money,
-- but nothing in Mio may assume it: two unrelated refunds can share an amount, and netting
-- refunded totals across charges that merely share an account understates the refund. Only an
-- immutable provider identifier, or a decision a finance administrator records here, makes one
-- refund out of the two. Until then the refund is excluded from every reconciled balance and is
-- reported as unresolved, with its possible effect.
create table if not exists public.mio_lawpay_refund_resolutions(
  id uuid primary key default gen_random_uuid(),
  refund_transaction_id text not null,
  charge_transaction_id text not null default '',
  identity text not null,
  resolution text not null,
  amount_cents bigint not null default 0,
  currency text not null default 'USD',
  provider_account_id text not null default '',
  account_key text not null default '',
  evidence_reference text not null default '',
  resolved_by text not null default '',
  resolved_at timestamptz not null default now(),
  superseded_at timestamptz,
  corrects_resolution_id uuid references public.mio_lawpay_refund_resolutions(id),
  ledger_entry_id uuid,
  created_at timestamptz not null default now(),
  constraint mio_lawpay_refund_resolutions_resolution_check check (resolution in ('same_refund','separate_refund'))
);
-- One active decision per refund. A later decision supersedes the earlier one and links to it:
-- the earlier decision is never overwritten or removed.
create unique index if not exists mio_lawpay_refund_resolutions_active
on public.mio_lawpay_refund_resolutions(identity) where superseded_at is null;
create index if not exists mio_lawpay_refund_resolutions_refund
on public.mio_lawpay_refund_resolutions(refund_transaction_id);
alter table public.mio_lawpay_ledger_entries
  add column if not exists refund_resolution_id uuid references public.mio_lawpay_refund_resolutions(id);
-- A separate refund is its own ledger effect, exactly once per resolution. The per-classification
-- rule now applies only to entries that are not refund effects.
drop index if exists public.mio_lawpay_ledger_entries_once;
create unique index if not exists mio_lawpay_ledger_entries_once
on public.mio_lawpay_ledger_entries(classification_id, entry_kind) where refund_resolution_id is null;
create unique index if not exists mio_lawpay_ledger_entries_refund_once
on public.mio_lawpay_ledger_entries(refund_resolution_id) where refund_resolution_id is not null;
alter table public.mio_lawpay_refund_resolutions enable row level security;
revoke all on public.mio_lawpay_refund_resolutions from public, anon, authenticated;
create or replace function public.mio_resolve_lawpay_refund_v323(p_resolution jsonb, p_actor text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor text := nullif(trim(coalesce(p_actor,'')),'');
  v_refund text := trim(coalesce(p_resolution->>'refund_transaction_id',''));
  v_charge text := trim(coalesce(p_resolution->>'charge_transaction_id',''));
  v_resolution text := trim(coalesce(p_resolution->>'resolution',''));
  v_evidence text := trim(coalesce(p_resolution->>'evidence_reference',''));
  v_previous public.mio_lawpay_refund_resolutions%rowtype;
  v_tx public.lawpay_transactions%rowtype;
  v_classification public.mio_lawpay_classifications%rowtype;
  v_id uuid;
  v_entry_id uuid := null;
  v_effect bigint := 0;
begin
  if v_actor is null then raise exception 'Mio could not tell who resolved this refund.'; end if;
  if v_refund = '' then raise exception 'This refund has no immutable provider identifier, so it cannot be resolved.'; end if;
  if v_resolution not in ('same_refund','separate_refund') then raise exception 'Choose whether this refund is already reflected on the charge or is a separate refund.'; end if;
  if v_resolution = 'same_refund' and v_charge = '' then raise exception 'A refund can only be recorded as already reflected if the charge is named.'; end if;
  if v_evidence = '' then raise exception 'Record what establishes the relationship: the provider reference, or the report that shows it.'; end if;
  select * into v_tx from public.lawpay_transactions where gateway_transaction_id = v_refund;
  if not found then raise exception 'The refund transaction is not stored in Mio.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mio-lawpay-refund:'||v_refund,0));
  select * into v_previous from public.mio_lawpay_refund_resolutions
    where identity = v_refund and superseded_at is null order by resolved_at desc limit 1 for update;
  if v_previous.id is not null then
    if v_previous.resolution = v_resolution and v_previous.charge_transaction_id = v_charge then
      return jsonb_build_object('status','unchanged','resolution_id',v_previous.id,'resolution',v_previous.resolution);
    end if;
    -- A decision with its own money effect is reversed by the new decision, exactly once, and the
    -- reversal is linked to the entry it reverses instead of deleting anything.
    if v_previous.ledger_entry_id is not null then
      insert into public.mio_lawpay_ledger_entries(identity,classification_id,entry_kind,direction,account_key,matter_id,amount_cents,currency,occurred_at,provider_account_id,reverses_entry_id,refund_resolution_id,created_by)
      select e.identity,e.classification_id,'refund_reversal',case when e.direction = 'out' then 'in' else 'out' end,e.account_key,e.matter_id,e.amount_cents,e.currency,e.occurred_at,e.provider_account_id,e.id,null,v_actor
        from public.mio_lawpay_ledger_entries e where e.id = v_previous.ledger_entry_id
        and not exists(select 1 from public.mio_lawpay_ledger_entries r where r.reverses_entry_id = e.id);
    end if;
    update public.mio_lawpay_refund_resolutions set superseded_at = now() where id = v_previous.id;
  end if;
  insert into public.mio_lawpay_refund_resolutions(refund_transaction_id,charge_transaction_id,identity,resolution,amount_cents,currency,provider_account_id,account_key,evidence_reference,resolved_by,corrects_resolution_id)
  values (v_refund,v_charge,v_refund,v_resolution,greatest(0,coalesce(v_tx.amount_cents,0)),coalesce(nullif(v_tx.currency,''),'USD'),
          coalesce(v_tx.account_id,''),coalesce(v_tx.account_key,''),v_evidence,v_actor,v_previous.id)
  returning id into v_id;
  -- "Separate refund" is its own money movement out of the account that received it; "same refund"
  -- adds nothing, because the charge's own reported total already describes that money.
  if v_resolution = 'separate_refund' then
    v_effect := -greatest(0,coalesce(v_tx.amount_cents,0));
    select * into v_classification from public.mio_lawpay_classifications
      where gateway_transaction_id = v_charge and posting_status in ('posted','reversed','matched')
      order by posted_at desc nulls last, created_at desc limit 1;
    if v_classification.id is not null then
      insert into public.mio_lawpay_ledger_entries(identity,classification_id,entry_kind,direction,account_key,matter_id,amount_cents,currency,occurred_at,provider_account_id,refund_resolution_id,created_by)
      values (v_refund,v_classification.id,'refund_effect','out',
              coalesce(nullif(v_tx.account_key,''),v_classification.actual_account_key),v_classification.matter_id,
              greatest(0,coalesce(v_tx.amount_cents,0)),coalesce(nullif(v_tx.currency,''),'USD'),coalesce(v_tx.occurred_at,now()),
              coalesce(v_tx.account_id,''),v_id,v_actor)
      returning id into v_entry_id;
      update public.mio_lawpay_refund_resolutions set ledger_entry_id = v_entry_id where id = v_id;
    end if;
  end if;
  return jsonb_build_object('status','resolved','resolution_id',v_id,'resolution',v_resolution,
    'refund_transaction_id',v_refund,'charge_transaction_id',v_charge,
    'amount_cents',greatest(0,coalesce(v_tx.amount_cents,0)),'ledger_effect_cents',v_effect,
    'ledger_entry_id',v_entry_id,'superseded_resolution_id',v_previous.id,
    'evidence_reference',v_evidence,'resolved_by',v_actor,'resolved_at',now());
end $$;
revoke all on function public.mio_resolve_lawpay_refund_v323(jsonb,text) from public, anon, authenticated;
grant execute on function public.mio_resolve_lawpay_refund_v323(jsonb,text) to service_role;

