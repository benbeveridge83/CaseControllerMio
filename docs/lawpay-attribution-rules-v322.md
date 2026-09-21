# Attributing LawPay payments taken outside Mio (V322)

Payments taken directly in LawPay (virtual terminal or the generic payment page) carry no Mio
invoice reference, so the reconciliation list can only name the payer and amount. The deposit
account is known for these charges — Mio resolves it from the charge's own `account_id`
(`configured_account` in `raw.mio_account_key_source`) — so the review line now states
**Trust** or **Operating** for every row. What Mio still must not do is guess *which matter*
the money belongs to. That is a deliberate human decision, and this feature records it.

## The three destinations

Each unlinked charge can be attributed to exactly one of:

1. **A matter** — the money is associated with that matter.
2. **A PNC** — the charge is that PNC consultation fee or retainer. Only matters that are
   actually in a PNC stage are offered (`PNC- Need to Consult` → `consult`,
   `Consult- Need to Client` → `engage`), and the record stores `pnc_workflow_id` (the PNC row
   key) with `pnc_kind` read from the matter status, never inferred from the amount. The PNC
   association is optional and never implied by the matter.
3. **Neither** — a recorded decision (consultation taken outside Mio, a refund, not a client
   payment) that requires a written reason.

## Money rules (implemented in `src/mioLawPayAttribution.js`)

- A **trust** charge attributed to a matter becomes a **trust-deposit ledger row** for that
  matter: `direction:'in'`, `transaction_type:'lawpay'`, `lawpay_transaction_id` set to the
  provider transaction ID, dated from the charge. This is the same row shape the existing
  trust ledger uses, and `clientFinanceLedgerRows` already dedupes the gateway-derived row
  against a manual row sharing that `lawpay_transaction_id`, so the deposit appears once in the
  matter trust balance, matter accounting, and the firm trust rollup.
- A **refund, reversal, or chargeback** becomes money **out** (`direction:'out'`,
  `transaction_type:'refund'`), reducing the client's trust balance by the same amount.
- An **operating** charge never touches a trust balance. It is recorded for accounting
  attribution (`entry_kind:'operating_association'`) and shown as operating activity, because a
  consultation fee is firm money.
- An **undetermined account** ("Account not reported") is **refused**, not assumed: Mio cannot
  tell trust money from operating money, so it will not post either.
- Only **completed** charges can be attributed. Pending, void, and unsuccessful charges are
  left alone.
- **Idempotent by provider ID**: `duplicateLawPayAttribution()` refuses to post a charge that
  already has a trust-ledger row, even at a different amount, so two open windows cannot
  double-post one payment.
- **Nothing is automatic.** No payer-name matching, no inference from amounts.

## The picker on the client dashboard and Bulk billing

The reconciliation list (`LawPay reconciliation - N invoice issue(s), N unlinked transaction(s)`)
now offers the decision instead of only describing the problem:

- Every line names the deposit account LawPay recorded (**Trust**, **Operating**, or
  **Account not reported**).
- **Categorize this payment** opens the picker: decision (belongs to a matter / PNC
  consultation or retainer / neither), a matter search and list, and a required reason for
  "neither". The picker repeats the account and states exactly what saving will do, for example
  "This posts a trust deposit for the selected matter under the LawPay provider ID, so the same
  charge can never post twice."
- **Save attribution** writes through the same verified cloud path the trust ledger and manual
  trust entries already use: read the latest stored rows, refuse a duplicate by provider ID,
  save, read back, verify, then update the screen. A decision that cannot be verified removes the
  trust entry it posted rather than leaving unexplained money, and says so if even that rollback
  fails.
- Decided charges show as attributed (`Trust - trust deposit - <matter>`), stop saying "require
  review", and keep **Review attribution again** for a changed mind.
- An **operating** charge is recorded for attribution and never moves trust. An **unresolved**
  account is refused with the reason, and no record is written.
- Decisions are stored in `caseMioLawPayAttribution` (cloud state, mirrored locally) next to the
  ledger entry, so the audit trail and the money agree.

## State

The rules module and its tests are complete: `tests/lawpay-attribution.test.js` covers trust
deposits, refunds out of trust, operating charges staying out of trust, the unresolved-account
refusal, pending charges, missing matter/PNC/reason, PNC workflow linkage, duplicate refusal,
and the trust/operating split for every configured LawPay account. `finance-review-v314.yml`
runs it, along with `tests/finance-v314-integration.test.js` (composed-source wiring) and
`tests/finance-v314-browser.mjs`, which drives the real production bundle through all four
outcomes: matter trust deposit, operating record, "neither" with a required reason, and refusal
for an unresolved account.

No financial posting happens in the browser: the gap between the provider record and Mio's
ledger stays explicit and auditable.

