# Weekly Billing & Trust Payments — Release Gates

Status: **RELEASE BLOCKED — TRUST CLASSIFICATION INCOMPLETE**. The atomic trust-posting RPC is implemented and tested in isolated PostgreSQL. The production RPC is not installed or granted. It records an accounting allocation only and does not move bank funds. A read-only production audit found completed post-cutover LawPay trust transactions absent from the classified and manual ledgers. Reconcile them before posting can be enabled. No weekly trust posting has been run in production.

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
- Cross-matter posting requires per-matter `agreementAuthorized` (verified signed fee agreement) and `shareTrust`. The attorney must confirm the agreement before checking this setting.
- The payment preview requires an explicit per-run trust-source verification and separate approval of each payment. A server readiness RPC leaves the atomic setting disabled until the posting function's execute grant is released.
- The server rejects all posting while a completed post-cutover LawPay trust transaction remains unclassified and not mirrored by its transaction ID in the manual ledger. This is a firmwide fail-closed gate; reconcile the observed records before release.

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
1. Reconcile and classify the post-cutover LawPay trust transactions still missing from both the classified and manual ledgers; verify matter ownership, bank receipt/refunds, and avoid duplicate entries.
2. Review signed fee agreements for any cross-matter source and mark `agreementAuthorized` only when authorized. Verify each trust source against bank records and any restrictions.
3. Apply `supabase/migrations/20261121180000_weekly_billing_atomic_posting_v1.sql` with execute still revoked, and verify the schema and read-only readiness check.
4. Run a dry-run using real matters and verify that invoice balances, trust balances, and all proposed allocations agree with Bulk Billing and bank records.
5. Grant execute: `grant execute on function public.mio_post_weekly_trust_payment_v1(text,text,text,uuid,bigint,timestamptz) to authenticated;`
6. Enable `enableAtomicWeeklyTrustPosting` in Settings. Approve each proposed payment in one supervised live batch; reconcile Mio's accounting allocation and the separate trust-to-operating bank transfer.

Maintain distinct release states: `review_safe`, `backend_verified`, `live_authorized`. Only a successful backend verification and authorized release can advance beyond `review_safe`.
