-- =============================================================================
-- LawPay V324 rollout — map the two confirmed provider accounts, then re-resolve
-- their transactions. ONE statement (a DO block): read-only preconditions run
-- first, the writes are transactional, and any failed check raises and rolls the
-- whole block back. It is safe and idempotent if accidentally re-run.
--
-- WHAT IT WRITES (nothing else):
--   1. One active mapping  ••••PvRA  -> trust     (via mio_map_lawpay_account_v323)
--   2. One active mapping  ••••B88Q  -> operating (via mio_map_lawpay_account_v323)
--   3. Re-resolution for those two identifiers only (mio_reresolve_lawpay_accounts_v324),
--      which updates ONLY lawpay_transactions.account_key and two keys inside raw
--      (the provenance mio_account_key_source and the append-only resolution history).
--
-- It posts no money, moves no balance, selects no matter or PNC, and touches no
-- invoice, classification, ledger entry or refund resolution. Amounts, statuses,
-- references, payers and the other identifiers (including the two identifier-less
-- records) are untouched.
--
-- The full identifiers are read inside the database and are NEVER printed; only the
-- masked suffixes (••••PvRA / ••••B88Q) appear in output.
--
-- TO RUN: Supabase Dashboard -> project vnnkxqpyndidnjbrbywz -> SQL Editor ->
--         New query -> paste this whole file -> Run. It is one statement, so it
--         commits atomically (or rolls back atomically on any failure).
-- =============================================================================

DO $$
DECLARE
  -- The operator named in the audit trail. Change to the actual operator's email
  -- (the firm finance administrator) if it is not this one.
  v_actor text := 'ben@beveridgelawfirm.com';

  v_pvra  text;
  v_b88q  text;
  v_n     integer;
  v_map   jsonb;
  v_rr_p  jsonb;
  v_rr_b  jsonb;

  v_total_before  integer;
  v_total_after   integer;
  v_absent_before integer;
  v_absent_after  integer;
  v_fp_before     text;
  v_fp_after      text;
BEGIN
  IF coalesce(nullif(btrim(v_actor), ''), '') = '' THEN
    RAISE EXCEPTION 'Set v_actor to the operator''s email before running this.';
  END IF;

  ---------------------------------------------------------------------------
  -- 1. READ-ONLY PRECONDITIONS (any failure stops before anything is written)
  ---------------------------------------------------------------------------

  -- 1a. The two RPCs must exist with their expected signatures.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'mio_map_lawpay_account_v323' AND p.pronargs = 2) THEN
    RAISE EXCEPTION 'mio_map_lawpay_account_v323(jsonb,text) is missing. Stop.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'mio_reresolve_lawpay_accounts_v324' AND p.pronargs = 3) THEN
    RAISE EXCEPTION 'mio_reresolve_lawpay_accounts_v324(text,text,text) is missing. Stop.';
  END IF;

  -- 1b. Exactly one distinct full identifier ends in PvRA, and exactly one in B88Q.
  SELECT count(DISTINCT account_id) INTO v_n
    FROM public.lawpay_transactions WHERE right(coalesce(account_id, ''), 4) = 'PvRA';
  IF v_n = 0 THEN RAISE EXCEPTION 'No provider identifier ends in PvRA. Stop.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'More than one distinct provider identifier ends in PvRA (%). Stop.', v_n; END IF;
  SELECT DISTINCT account_id INTO v_pvra
    FROM public.lawpay_transactions WHERE right(coalesce(account_id, ''), 4) = 'PvRA';

  SELECT count(DISTINCT account_id) INTO v_n
    FROM public.lawpay_transactions WHERE right(coalesce(account_id, ''), 4) = 'B88Q';
  IF v_n = 0 THEN RAISE EXCEPTION 'No provider identifier ends in B88Q. Stop.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'More than one distinct provider identifier ends in B88Q (%). Stop.', v_n; END IF;
  SELECT DISTINCT account_id INTO v_b88q
    FROM public.lawpay_transactions WHERE right(coalesce(account_id, ''), 4) = 'B88Q';

  -- 1c. The evidence must not be mixed: no transaction for either identifier may
  --     already carry a non-empty stored account key that contradicts the
  --     confirmed mapping.
  IF EXISTS (SELECT 1 FROM public.lawpay_transactions
             WHERE account_id = v_pvra
               AND coalesce(account_key, '') <> ''
               AND account_key <> 'trust') THEN
    RAISE EXCEPTION 'Evidence is mixed for ••••PvRA: a stored account key other than trust exists. Stop.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lawpay_transactions
             WHERE account_id = v_b88q
               AND coalesce(account_key, '') <> ''
               AND account_key <> 'operating') THEN
    RAISE EXCEPTION 'Evidence is mixed for ••••B88Q: a stored account key other than operating exists. Stop.';
  END IF;

  -- 1d. Do not silently overwrite a reviewed decision: if either identifier already
  --     has a mapping that points at a different account, stop.
  IF EXISTS (SELECT 1 FROM public.mio_lawpay_accounts a
             WHERE a.provider_account_id = v_pvra AND a.account_key <> 'trust') THEN
    RAISE EXCEPTION 'An existing mapping for ••••PvRA points at a different account. Stop.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mio_lawpay_accounts a
             WHERE a.provider_account_id = v_b88q AND a.account_key <> 'operating') THEN
    RAISE EXCEPTION 'An existing mapping for ••••B88Q points at a different account. Stop.';
  END IF;

  -- 1e. Snapshot the state that must NOT change: the whole table's row count, the
  --     identifier-less count, and a fingerprint of every column except account_key
  --     and raw (the only two things the re-resolution is allowed to write).
  v_total_before  := (SELECT count(*) FROM public.lawpay_transactions);
  v_absent_before := (SELECT count(*) FROM public.lawpay_transactions WHERE coalesce(account_id, '') = '');
  v_fp_before := (
    SELECT md5(string_agg(x.f, E'\n' ORDER BY x.f)) FROM (
      SELECT
        gateway_transaction_id || '|' || coalesce(gateway_event_id, '') || '|'
        || coalesce(occurred_at::text, '') || '|' || coalesce(modified_at::text, '') || '|'
        || coalesce(transaction_type, '') || '|' || coalesce(status, '') || '|'
        || coalesce(account_id, '') || '|' || coalesce(amount_cents, 0)::text || '|'
        || coalesce(amount_refunded_cents, 0)::text || '|' || coalesce(currency, '') || '|'
        || coalesce(reference, '') || '|' || coalesce(payer_name, '') || '|'
        || coalesce(payer_email, '') || '|' || coalesce(payment_method_type, '') || '|'
        || coalesce(last_four, '') || '|' || coalesce(synced_at::text, '') AS f
      FROM public.lawpay_transactions
    ) x
  );

  ---------------------------------------------------------------------------
  -- 2. THE WRITES (one transaction; any later exception rolls all of this back)
  ---------------------------------------------------------------------------

  -- 2a. Map ••••PvRA -> trust
  v_map := public.mio_map_lawpay_account_v323(
             jsonb_build_object('provider_account_id', v_pvra,
                                'account_key', 'trust',
                                'bank_account_id', '',
                                'bank_role', 'trust',
                                'label', 'LawPay trust settlement account',
                                'last4', right(v_pvra, 4),
                                'is_active', true),
             v_actor);
  IF coalesce(v_map->>'status', '') <> 'mapped' THEN
    RAISE EXCEPTION '••••PvRA mapping failed: %', v_map::text;
  END IF;

  -- 2b. Map ••••B88Q -> operating
  v_map := public.mio_map_lawpay_account_v323(
             jsonb_build_object('provider_account_id', v_b88q,
                                'account_key', 'operating',
                                'bank_account_id', '',
                                'bank_role', 'operating',
                                'label', 'LawPay operating settlement account',
                                'last4', right(v_b88q, 4),
                                'is_active', true),
             v_actor);
  IF coalesce(v_map->>'status', '') <> 'mapped' THEN
    RAISE EXCEPTION '••••B88Q mapping failed: %', v_map::text;
  END IF;

  -- 2c/2d. Re-resolve only after both mappings succeeded.
  v_rr_p := public.mio_reresolve_lawpay_accounts_v324(v_pvra, 'trust', v_actor);
  IF coalesce(v_rr_p->>'ok', 'false') <> 'true' THEN
    RAISE EXCEPTION '••••PvRA re-resolution failed: %', v_rr_p::text;
  END IF;

  v_rr_b := public.mio_reresolve_lawpay_accounts_v324(v_b88q, 'operating', v_actor);
  IF coalesce(v_rr_b->>'ok', 'false') <> 'true' THEN
    RAISE EXCEPTION '••••B88Q re-resolution failed: %', v_rr_b::text;
  END IF;

  ---------------------------------------------------------------------------
  -- 3. VERIFICATION (any failure raises and rolls the whole block back)
  ---------------------------------------------------------------------------

  -- 3a. Only account_key and raw may have changed.
  v_total_after  := (SELECT count(*) FROM public.lawpay_transactions);
  v_absent_after := (SELECT count(*) FROM public.lawpay_transactions WHERE coalesce(account_id, '') = '');
  v_fp_after := (
    SELECT md5(string_agg(x.f, E'\n' ORDER BY x.f)) FROM (
      SELECT
        gateway_transaction_id || '|' || coalesce(gateway_event_id, '') || '|'
        || coalesce(occurred_at::text, '') || '|' || coalesce(modified_at::text, '') || '|'
        || coalesce(transaction_type, '') || '|' || coalesce(status, '') || '|'
        || coalesce(account_id, '') || '|' || coalesce(amount_cents, 0)::text || '|'
        || coalesce(amount_refunded_cents, 0)::text || '|' || coalesce(currency, '') || '|'
        || coalesce(reference, '') || '|' || coalesce(payer_name, '') || '|'
        || coalesce(payer_email, '') || '|' || coalesce(payment_method_type, '') || '|'
        || coalesce(last_four, '') || '|' || coalesce(synced_at::text, '') AS f
      FROM public.lawpay_transactions
    ) x
  );

  IF v_total_before IS DISTINCT FROM v_total_after THEN
    RAISE EXCEPTION 'lawpay_transactions row count changed (% -> %). Rollback.', v_total_before, v_total_after;
  END IF;
  IF v_fp_before IS DISTINCT FROM v_fp_after THEN
    RAISE EXCEPTION 'A column other than account_key/raw changed. Rollback.';
  END IF;

  -- 3b. No classification, ledger entry or refund resolution may exist.
  IF EXISTS (SELECT 1 FROM public.mio_lawpay_classifications) THEN
    RAISE EXCEPTION 'A classification row appeared. Rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mio_lawpay_ledger_entries) THEN
    RAISE EXCEPTION 'A ledger entry appeared. Rollback.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mio_lawpay_refund_resolutions) THEN
    RAISE EXCEPTION 'A refund resolution appeared. Rollback.';
  END IF;

  ---------------------------------------------------------------------------
  -- 4. VERIFICATION GRID (masked only)
  ---------------------------------------------------------------------------
  RAISE NOTICE '================ V324 mapping + re-resolution ================';
  RAISE NOTICE 'Actor: %', v_actor;
  RAISE NOTICE 'lawpay_transactions total: before=% after=%', v_total_before, v_total_after;
  RAISE NOTICE 'identifier-absent rows (untouched): before=% after=%', v_absent_before, v_absent_after;
  RAISE NOTICE 'immutable fingerprint unchanged: %', (v_fp_before IS NOT DISTINCT FROM v_fp_after);
  RAISE NOTICE 'mappings now active:';
  RAISE NOTICE '  % -> %  (is_active=%  verified_by=%)',
     '••••' || right(v_pvra, 4),
     (SELECT account_key FROM public.mio_lawpay_accounts WHERE provider_account_id = v_pvra),
     (SELECT is_active::text FROM public.mio_lawpay_accounts WHERE provider_account_id = v_pvra),
     (SELECT verified_by FROM public.mio_lawpay_accounts WHERE provider_account_id = v_pvra);
  RAISE NOTICE '  % -> %  (is_active=%  verified_by=%)',
     '••••' || right(v_b88q, 4),
     (SELECT account_key FROM public.mio_lawpay_accounts WHERE provider_account_id = v_b88q),
     (SELECT is_active::text FROM public.mio_lawpay_accounts WHERE provider_account_id = v_b88q),
     (SELECT verified_by FROM public.mio_lawpay_accounts WHERE provider_account_id = v_b88q);
  RAISE NOTICE 're-resolution ••••PvRA (trust):     updated=% unchanged=% posts_money=% balances_changed=%',
     v_rr_p->>'updated', v_rr_p->>'unchanged', v_rr_p->>'posts_money', v_rr_p->>'balances_changed';
  RAISE NOTICE 're-resolution ••••B88Q (operating): updated=% unchanged=% posts_money=% balances_changed=%',
     v_rr_b->>'updated', v_rr_b->>'unchanged', v_rr_b->>'posts_money', v_rr_b->>'balances_changed';
  RAISE NOTICE 'V323 tables: classifications=% ledger_entries=% refund_resolutions=% (all must be 0)',
     (SELECT count(*) FROM public.mio_lawpay_classifications),
     (SELECT count(*) FROM public.mio_lawpay_ledger_entries),
     (SELECT count(*) FROM public.mio_lawpay_refund_resolutions);
  RAISE NOTICE '================ DONE ================';
END $$;


-- =============================================================================
-- ROLLBACK (run ONLY to undo this step). Read first; paste only what you need
-- into a fresh query. The restore statement is identical to
-- docs/lawpay-step7-rollback-restore.sql and is exercised by
-- tests/sql/lawpay-provider-account-resolution-v324-behavior.sql.
-- =============================================================================

-- (a) Deactivate the two mappings (resolution stops immediately; nothing deleted):
--     UPDATE public.mio_lawpay_accounts SET is_active = false
--       WHERE right(provider_account_id, 4) IN ('PvRA', 'B88Q');

-- (b) Restore account_key + provenance + history from the append-only history,
--     per identifier. Substitute the full identifier in both places:
--     UPDATE public.lawpay_transactions t
--     SET account_key = coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_account_key', ''),
--         raw = jsonb_set(
--                 jsonb_set(t.raw, '{mio_account_key_source}',
--                     to_jsonb(coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_source', '')), true),
--                 '{mio_account_resolution_history}',
--                 (t.raw->'mio_account_resolution_history') - (jsonb_array_length(t.raw->'mio_account_resolution_history') - 1),
--                 true)
--     WHERE t.account_id = '<full id ending PvRA>'
--       AND jsonb_array_length(coalesce(t.raw->'mio_account_resolution_history', '[]'::jsonb)) > 0;
--     -- repeat for '<full id ending B88Q>'.

-- (c) Once (a) and (b) are done and verified, delete the two mapping rows:
--     DELETE FROM public.mio_lawpay_accounts WHERE right(provider_account_id, 4) IN ('PvRA', 'B88Q');

-- =============================================================================
-- IDEMPOTENCE: re-running the DO block above is safe. The mapping upsert
-- re-asserts the same rows, the re-resolution updates 0 rows (account_key already
-- equals the mapped key) and appends no history, and every verification still
-- passes. If a run was interrupted, re-running from the start completes it.
-- =============================================================================


