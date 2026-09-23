-- V324: recognizing the deposit account LawPay already supplied.
--
-- One narrow function. After an administrator has mapped a provider account identifier once, this
-- re-states the account classification and its provenance for the transactions that already carry
-- that identifier. It cannot post money, move a balance, select a client, matter or PNC, apply
-- anything to an invoice, issue a refund or create a financial entry: the only columns it writes
-- are lawpay_transactions.account_key and the provenance key inside lawpay_transactions.raw.
-- Amounts, statuses, refund totals, references and payer fields are not named in the update.
--
-- The identifier stays opaque: it is compared exactly as stored, never trimmed or lowercased.
-- It refuses to write anything unless the caller is named and public.mio_lawpay_accounts holds an
-- ACTIVE row for exactly this provider identifier and this Mio account key, so a missing mapping, an
-- inactive mapping, or a mapping into a different account updates zero rows. Nothing here creates a
-- mapping or a second account system.
--
-- NOT APPLIED. Recorded here for review and for the CI behaviour suite.

create or replace function public.mio_reresolve_lawpay_accounts_v324(p_provider_account_id text, p_account_key text, p_actor text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_allowed text[] := array['operating','trust','echeck_operating','echeck_trust','clientcredit_trust'];
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_masked text := '';
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
begin
  if coalesce(p_provider_account_id, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'A provider account identifier is required.', 'updated', 0, 'unchanged', 0);
  end if;
  if not (coalesce(p_account_key, '') = any(v_allowed)) then
    return jsonb_build_object('ok', false, 'error', 'That Mio account key is not one of the configured LawPay deposit accounts.', 'updated', 0, 'unchanged', 0);
  end if;
  -- Every row this function writes carries an audit history entry naming who changed it, so an
  -- anonymous caller is refused before any row is touched.
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'Mio could not tell who is re-resolving these transactions, so nothing was written.', 'updated', 0, 'unchanged', 0);
  end if;
  v_masked := case when length(p_provider_account_id) > 4 then '••••' || right(p_provider_account_id, 4) else p_provider_account_id end;

  -- The administrator mapping is the only authority for naming an account, so an exact and active row
  -- must exist for this provider identifier AND this Mio account key. A missing mapping, an inactive
  -- mapping, and a mapping that points at a different account are each refused, updating zero rows and
  -- writing no history.
  if not exists (select 1 from public.mio_lawpay_accounts a
                 where a.provider_account_id = p_provider_account_id
                   and a.account_key = p_account_key
                   and a.is_active) then
    return jsonb_build_object(
      'ok', false,
      'error', case when exists (select 1 from public.mio_lawpay_accounts a
                                 where a.provider_account_id = p_provider_account_id and a.is_active)
                    then 'An active mapping for this provider account points at a different Mio account, so nothing was written.'
                    else 'No active mapping exists for this provider account and Mio account, so nothing was written.' end,
      'provider_account_last4', v_masked,
      'account_key', p_account_key,
      'updated', 0,
      'unchanged', 0,
      'posts_money', false,
      'balances_changed', false
    );
  end if;

  select count(*) into v_unchanged
  from public.lawpay_transactions t
  where t.account_id = p_provider_account_id and coalesce(t.account_key, '') = p_account_key;

  -- The previous account classification and provenance are appended to the row's own history before
  -- they are replaced, so this update is reversible from the data alone and the audit trail keeps
  -- both sides of the change.
  update public.lawpay_transactions t
  set account_key = p_account_key,
      raw = jsonb_set(
              jsonb_set(coalesce(t.raw, '{}'::jsonb), '{mio_account_key_source}', to_jsonb('configured_account'::text), true),
              '{mio_account_resolution_history}',
              coalesce(t.raw->'mio_account_resolution_history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'at', now(),
                'actor', v_actor,
                'from_account_key', coalesce(t.account_key, ''),
                'from_source', coalesce(t.raw->>'mio_account_key_source', ''),
                'to_account_key', p_account_key,
                'reason', 'provider account mapping')),
              true)
  where t.account_id = p_provider_account_id and coalesce(t.account_key, '') <> p_account_key;
  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'ok', true,
    'version', 324,
    'provider_account_last4', v_masked,
    'account_key', p_account_key,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'posts_money', false,
    'balances_changed', false,
    'actor', v_actor
  );
end $$;

revoke all on function public.mio_reresolve_lawpay_accounts_v324(text,text,text) from public, anon, authenticated;
grant execute on function public.mio_reresolve_lawpay_accounts_v324(text,text,text) to service_role;

comment on function public.mio_reresolve_lawpay_accounts_v324(text,text,text) is
  'Restates the account classification and provenance of transactions already carrying a mapped LawPay provider account identifier, and only when a named actor and an active, exactly matching row in mio_lawpay_accounts both exist. Writes no money and moves no balance.';
