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
2. **A PNC** — the charge is that PNC consultation fee or retainer (`mio_pnc_workflows`, with
   the consult/retainer request ids already in its state). The PNC association is optional and
   never implied by the matter.
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

## State

The rules module and its tests are complete: `tests/lawpay-attribution.test.js` covers trust
deposits, refunds out of trust, operating charges staying out of trust, the unresolved-account
refusal, pending charges, missing matter/PNC/reason, PNC workflow linkage, duplicate refusal,
and the trust/operating split for every configured LawPay account. `finance-review-v314.yml`
runs it.

Remaining before this is usable from the client dashboard: the panel picker (matter search,
PNC list, neither + reason), writing the trust row through the existing verified cloud path
(`saveMioStateKeyNow` → read-back verification → rollback, as used by trust-payment reversal),
recording the decision alongside the transaction, and showing decided charges as attributed
rather than "require review". No financial posting happens in the browser: the gap between the
provider record and Mio's ledger stays explicit and auditable.
