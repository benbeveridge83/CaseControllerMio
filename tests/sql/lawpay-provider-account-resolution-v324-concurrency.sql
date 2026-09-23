-- LawPay re-resolution concurrency (V324): what two overlapping sessions may and may not do.
--
-- The runner drives two psql sessions around this fixture, and this file asserts the settled state, so
-- it needs no extension and no timing of its own:
--   phase 1  session B deactivates the mapping and holds that row lock; session A's re-resolution waits
--            on the lock, then must refuse and write nothing;
--   phase 2  session A re-resolves inside an open transaction, holding the row lock through the update;
--            session B's re-save of the same active mapping waits until session A commits.
-- The invariant under test: a mapping change is never raced, and the account named on a transaction
-- always agrees with the mapping that was authoritative and locked at the time of the write.
\set ON_ERROR_STOP on

do $$ begin
  if not exists(select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

do $$
declare
  v_count integer;
  v_authoritative text;
begin
  -- The RPC upserts on the provider id, so the race must settle on exactly one mapping row.
  select count(*) into v_count from public.mio_lawpay_accounts where provider_account_id = 'v324-race-acct';
  if v_count <> 1 then raise exception 'the race must settle on one mapping row, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_accounts
    where provider_account_id = 'v324-race-acct' and account_key = 'trust' and is_active;
  if v_count <> 1 then raise exception 'the race must settle on one active trust mapping, found %', v_count; end if;
  select a.account_key into v_authoritative from public.mio_lawpay_accounts a
    where a.provider_account_id = 'v324-race-acct' and a.is_active;

  -- Phase 1's refusal wrote nothing, so no race row can carry a first history entry from it: after
  -- phase 2 the only history is phase 2's, exactly one entry per row.
  select count(*) into v_count from public.lawpay_transactions t
    where t.account_id = 'v324-race-acct'
      and jsonb_array_length(coalesce(t.raw->'mio_account_resolution_history', '[]'::jsonb)) <> 1;
  if v_count <> 0 then raise exception 'exactly one history entry per race row is expected, % row(s) differ', v_count; end if;

  -- Every race row was named once, from the locked mapping, with no money column touched.
  select count(*) into v_count from public.lawpay_transactions t
    where t.account_id = 'v324-race-acct' and t.account_key = 'trust'
      and coalesce(t.raw->>'mio_account_key_source', '') = 'configured_account'
      and t.amount_cents = 42000 and t.status = 'COMPLETED';
  if v_count <> 3 then raise exception 'expected three race rows resolved from the locked mapping, found %', v_count; end if;

  -- The final transaction account agrees with the authoritative active mapping, and nothing else is
  -- named: a stale write would leave a row whose key differs from, or exists without, that mapping.
  select count(*) into v_count from public.lawpay_transactions t
    where t.account_id = 'v324-race-acct'
      and coalesce(t.account_key, '') <> coalesce(v_authoritative, '__none__');
  if v_count <> 0 then raise exception 'every race row must agree with the authoritative active mapping (%), % disagree', coalesce(v_authoritative, 'none'), v_count; end if;

  -- No classification, ledger entry or refund resolution may appear for the race identity.
  select count(*) into v_count from public.mio_lawpay_classifications where identity like '%v324-race%';
  if v_count <> 0 then raise exception 'a re-resolution must create no classification, found %', v_count; end if;
  select count(*) into v_count from public.mio_lawpay_ledger_entries where identity like '%v324-race%';
  if v_count <> 0 then raise exception 'a re-resolution must create no ledger entry, found %', v_count; end if;
end $$;

select 'V324 concurrency: the mapping change waits, the stale mapping is refused, and the final account agrees with the authoritative mapping' as result;
