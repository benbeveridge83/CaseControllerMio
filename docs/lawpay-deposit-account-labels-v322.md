# LawPay deposit account on every reviewed transaction (V322)

Client-reported problem: the LawPay reconciliation list named a payer and an amount but never
said which account the money went into, so an operating consultation fee and a trust retainer
payment looked identical in the only place they are reviewed. The deposit account was already
known and stored; the review screen simply discarded it.

## What Mio already records

Every stored row in `lawpay_transactions` carries `account_key` (the firm's own key) and
`account_id` (the provider account). `storeProviderTransaction` in
`supabase/functions/_shared/lawpay-v314.js` resolves the key in this order:

1. the configured account whose ID equals the transaction's `account_id` (the charge itself),
2. the matched `lawpay_payment_requests` row (the link that created the charge),
3. the previously stored value.

The provenance is kept in `raw.mio_account_key_source` as `configured_account`,
`payment_request`, or `unresolved`. `unresolved` means Mio cannot name the account, and it says
so rather than guessing. The configured keys are `operating`, `trust`, `echeck_operating`,
`echeck_trust`, and `clientcredit_trust` (`supabase/functions/lawpay-gateway/index.ts`).

Trust and operating are never interchangeable: a trust payment moves client money and appears
in the trust ledger, an operating payment does not. `lib/pnc.js` already splits them the same
way when it verifies consult and retainer payments.

## What changed

- `src/mioFinanceReview.js` exports `transactionAccountKey()` and `lawPayAccountLabel()`, and
  every row returned by `auditLawPayRecords()` now carries `account` and `account_label` for
  both invoice issues and unlinked transactions.
- `src/mioFinanceReviewApp.inc` prints that label on each reconciliation line, e.g.
  `Bravo Synthetic: $5,000 - Trust - No Mio invoice reference...`.
- The LawPay tab tables (`src/App.jsx`) show the same friendly labels instead of raw keys
  (`operating`, `echeck_trust`), and fall back to the last four digits of the provider account
  ID when Mio cannot classify it.
- `lawPayAccountLabel()` maps `trust`, `echeck_trust`, and `clientcredit_trust` to Trust
  variants, `operating` and `echeck_operating` to Operating variants, and reports
  `Account not reported` for an unresolved or unknown key.

## Deliberately unchanged

- No automatic attribution. Mio still refuses to guess a matter from a payer name; the account
  label tells you where the money landed, not which matter it should be posted to.
- No financial writes. The reconciliation panel and the scan remain read-only unless the
  authenticated gateway posts a transaction through `mio_store_lawpay_transaction_v314`.

## Verification

`tests/finance-v314.test.js` asserts the audit carries the account, that unresolved keys report
`Account not reported`, and the label mapping for every configured key. `tests/finance-v314-browser.mjs`
drives a production bundle against synthetic data and asserts that a trust charge, an operating
charge, and an unresolved-account charge each render their own label in the reconciliation list
(`finance-test-results/lawpay-reconciliation-accounts.png`); browser fixture writes and external
calls remain zero.
