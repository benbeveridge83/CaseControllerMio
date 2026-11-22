# Weekly Billing & Trust Payments — Release Gates

Status: **BACKEND VERIFIED, NOT RELEASED**. The atomic trust-posting RPC is implemented, covered by isolated-Postgres behavior/concurrency tests, and wired into the UI behind an `enableAtomicWeeklyTrustPosting` gate (off by default; the RPC's execute grant is also revoked by default). It records an accounting allocation only and does not move bank funds. Nothing has been run against production.

## Required sequence
1. Select qualifying unbilled WIP above the configurable threshold, respecting appointment and explicit matter overrides.
2. Re-read the exact billing entry IDs and amounts, descriptions, dates, invoice associations, and current matter eligibility immediately before creating invoices. Generate each invoice **once** through Mio's existing invoice creation machinery, then verify committed invoice IDs and Work OB.
3. Refresh reconciled client/matter trust funds and all posted, unpaid or partially paid service invoices. Exclude trust replenishment invoices, disputed/unearned amounts, holds, pending funds, stale data, and withdrawals already released.
4. Show the user exact proposed disbursements per invoice and source matter, with cross-matter payments conspicuously identified. Approval is per run; changing Billing/Share Trust permanently must be a separate explicit save.
5. Execute only on **explicit final approval**, within a server-side transactional posting boundary. Posting must write a durable immutable audit trail for source trust, destination invoice, amount, authorization identity/evidence, bank/account postings or provider transfer ID, and reconciliation.
6. Refresh and verify remaining Work OB and all authorized available trust (including permitted same-client funding) before suggesting administrative withdrawal. Marking withdrawal must never automatically terminate representation.

## Non-negotiable backend payment contract
- Atomically lock or serialize by affected trust source and invoice, refresh balances and invoice state under those locks, and enforce balance >= amount, amount > 0, no overpayment, and invoice earned/collectible.
- Require a unique server-enforced idempotency key for each approved payment; duplicate/concurrent requests must return the prior result, not post again.
- Check authenticated user ownership/authorization, verified same-client identity, applicable signed fee agreement, client/property restrictions, and all holds on every attempt. Do not use display balances or UI flags as authority.
- Cross-matter receipts must identify *both* originating trust ledger/matter and destination invoice/matter. A same-matter payment cannot substitute for a cross-matter posting.
- Record a balanced debit/credit or equivalent accounting entries and reconcile against bank/provider transfers; never mark an invoice paid solely because the browser initiated a request.
- Return a durable result with posted/declined/uncertain status. An uncertain response must be reconciled, never blindly retried.

## Current implementation boundaries (PR #38)
- `src/mioWeeklyBillingData.js`: read-only WIP and Work OB data adapter.
- `src/mioWeeklyBillingModel.js`: pure proposal engine, verified invoice-level allocation calculations, **no financial postings**.
- `src/MioWeeklyBilling.jsx`: review and cloud settings, same-matter handoff to Mio's existing trust payment flow, and an explicit **atomic trust posting** action gated behind `enableAtomicWeeklyTrustPosting` (off by default). The UI states the RPC records an accounting allocation only and does not move bank funds.
- `src/mioWeeklyWithdrawal.inc`: approval-gated administrative withdrawal marking, not a representation withdrawal.
- The existing invoice-review handoff may require user to complete invoicing separately; the one-button end-to-end sequence is **not completed**.
- `supabase/migrations/20261121180000_weekly_billing_atomic_posting_v1.sql`: the atomic, idempotent `mio_post_weekly_trust_payment_v1` RPC plus immutable-posting triggers. Execute is revoked for `authenticated`; a separate grant is required to go live.
- `tests/sql/weekly-billing-atomic-{schema,behavior,concurrency}.sql`: isolated-Postgres coverage of idempotency, exactly-once concurrency, fail-closed validation, and rollback. Wired into `.github/workflows/weekly-billing-review.yml`.
- Cross-matter posting still requires per-matter `agreementAuthorized` (verified signed fee agreement) and `shareTrust`. No data currently carries these flags, so cross-matter is blocked by design.

## Acceptance tests before release
- $150 threshold with accumulated subthreshold WIP, old Work OB, duplicate WIP records and concurrent re-runs.
- Own-matter fees paid before any cross-matter fee, oldest eligible outside invoice first, partial payments and multiple funded sources.
- Appointed cases excluded by default while explicit eligible overrides remain possible; other exclusions remain persisted and effective.
- Source Share Trust unchecked prevents outgoing funding but leaves its own invoices payable.
- No payment for another client, missing identity, absent signed authorization, unresolved trust, disputed fees, held funds, or overdrawn source.
- Idempotency and concurrency test: two simultaneous approvals cannot double-post and a lost network response cannot cause replay.
- Reversal/failed transfer and accounting reconciliation tests, then a dry-run using representative real matters without moving money.
- CI tests and production build pass; independent human verifies a simulated invoice/payment/withdrawal run, then explicitly approves enabling live transfers.

## Production activation sequence
1. Backfill the `appointed` classification (new-matter entry / settings / bulk backfill). Currently no matter carries an appointed flag, and 23 DFPS matters would not be excluded.
2. In Weekly Billing Settings, set `agreementAuthorized` only for matters whose signed fee agreement authorizes cross-matter transfers.
3. Apply `supabase/migrations/20261121180000_weekly_billing_atomic_posting_v1.sql`.
4. Grant execute: `grant execute on function public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz) to authenticated;`
5. Enable `enableAtomicWeeklyTrustPosting` in Settings.
6. Run a dry-run with real matters (no posting), then one supervised live batch, reconciling against LawPay.

Maintain distinct release states: `review_safe`, `backend_verified`, `live_authorized`. Only a successful backend verification and authorized release can advance beyond `review_safe`.
