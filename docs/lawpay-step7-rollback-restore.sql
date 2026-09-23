-- ============================================================================
-- THE ONLY WRITE IN THIS FILE IS THE SINGLE UPDATE IN PART 2, AND IT RUNS ONLY
-- ON APPROVAL, ONLY AS THE ROLLBACK FOR STEP 7.
--
-- Part 1 is read-only and shows exactly what Part 2 would change.
-- Part 3 is read-only and confirms the restore afterwards.
--
-- Part 2 restores each transaction's account classification and provenance from the
-- history the V324 function recorded before replacing them. It names account_key and
-- two keys inside raw, and no money column, status, reference, payer, client, matter
-- or invoice field. The same statement is exercised by
-- tests/sql/lawpay-provider-account-resolution-v324-behavior.sql, which asserts that
-- the restore returns every row to its previous account.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- PART 1 (READ-ONLY). What the rollback would change, for the whole table.
-- Replace nothing here; this is the preview.
-- ---------------------------------------------------------------------------
select
  '.....' || right(t.gateway_transaction_id, 4)                                   as masked_transaction,
  left(coalesce(t.occurred_at::text, ''), 7)                                      as occurred_month,
  '.....' || right(coalesce(t.account_id, ' '), 4)                                as masked_provider_account,
  coalesce(nullif(t.account_key, ''), '(none)')                                   as current_account_key,
  coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_account_key', '(unknown)') as would_restore_to,
  coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_source', '(none)')        as would_restore_provenance,
  jsonb_array_length(t.raw->'mio_account_resolution_history')                     as history_entries
from public.lawpay_transactions t
where jsonb_array_length(coalesce(t.raw->'mio_account_resolution_history', '[]'::jsonb)) > 0
order by t.gateway_transaction_id;


-- ---------------------------------------------------------------------------
-- PART 2 (THE WRITE, ON APPROVAL ONLY). Roll back the re-resolution for one
-- identifier. Substitute the full provider account identifier in both places
-- before running: '<full id ending PvRA>' or '<full id ending B88Q>'.
--
-- Do not run this unless the plan's step 7 rollback is being invoked. It touches
-- no money column and creates no financial entry.
-- ---------------------------------------------------------------------------
-- update public.lawpay_transactions t
-- set account_key = coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_account_key', ''),
--     raw = jsonb_set(
--             jsonb_set(t.raw, '{mio_account_key_source}', to_jsonb(coalesce((t.raw->'mio_account_resolution_history')->(jsonb_array_length(t.raw->'mio_account_resolution_history') - 1)->>'from_source', '')), true),
--             '{mio_account_resolution_history}',
--             (t.raw->'mio_account_resolution_history') - (jsonb_array_length(t.raw->'mio_account_resolution_history') - 1),
--             true)
-- where t.account_id = '<full id ending PvRA>'
--   and jsonb_array_length(coalesce(t.raw->'mio_account_resolution_history', '[]'::jsonb)) > 0;


-- ---------------------------------------------------------------------------
-- PART 3 (READ-ONLY). Confirmation after the restore: the identifier's rows are
-- back to no account, no history remains for it, and the money columns are as they
-- were (compare the transaction count and the stored-key count with section A/B of
-- docs/lawpay-step6-verification-readonly.sql).
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.lawpay_transactions where jsonb_array_length(coalesce(raw->'mio_account_resolution_history', '[]'::jsonb)) > 0) as rows_still_carrying_history,
  (select count(*) from public.lawpay_transactions where coalesce(account_key, '') <> '')                                                                  as rows_with_a_stored_account_key,
  (select count(*) from public.mio_lawpay_classifications)                                                                                                  as classification_rows,
  (select count(*) from public.mio_lawpay_ledger_entries)                                                                                                   as ledger_rows,
  (select count(*) from public.mio_lawpay_refund_resolutions)                                                                                               as refund_resolution_rows;
