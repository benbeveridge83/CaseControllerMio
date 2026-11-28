# Tyler ECF5 e-filing — manual reconciliation SOP

This procedure covers envelopes and callbacks whose outcome is **uncertain**
because the network send or the callback recording was interrupted. It is a
manual, operator-driven procedure. **Never automatically resend a filing whose
delivery is uncertain** — resending can create duplicate court filings.

## When to reconcile

Run this procedure when any of the following appear:

- `mio_efiling_outbox.state = 'uncertain'` (a send timed out or errored before a
  verified Tyler response).
- A callback was cryptographically verified but the receipt recorder returned an
  error (a crash between verification and recording, or a database failure).
- An operator notices a filing on the Tyler Stage/Production portal that has no
  matching row in `mio_efiling_submissions`.

## Step 1 — Read the durable outbox (never mutate yet)

For the `idempotency_key` in question, read:

```sql
select id, owner_id, matter_id, environment, idempotency_key, fingerprint,
       state, envelope_id, filing_ids, created_at, updated_at
from public.mio_efiling_outbox
where idempotency_key = :key and environment = :env;
```

- `state = 'confirmed'` → the filing is already recorded; no action needed.
- `state = 'reserved'` → a send may still be in flight; wait and re-check before
  reconciling.
- `state = 'uncertain'` → proceed to Step 2.

## Step 2 — Ask Tyler, do not guess

Log into the Tyler Stage (or Production) portal and look up the filing by the
envelope/filing identifiers the operator captured at send time, or by the
client/cause number. Record exactly what Tyler reports:

- **Filing accepted** → record the Tyler envelope/filing IDs.
- **Filing rejected** → capture the rejection reason and any fee outcome.
- **Not found** → the send never reached Tyler; the envelope was not created.

## Step 3 — Resolve the outbox state

Only after confirming with Tyler:

1. If Tyler accepted the filing, bind the confirmed Tyler IDs to the original
   owner/matter using the service-role RPC `mio_confirm_efiling_outbound_v1`
   (this also writes `mio_efiling_submissions` via
   `mio_register_efiling_submission_v1`). Do **not** fabricate IDs.
2. If Tyler never received the filing, mark the outbox `uncertain` (or leave it
   `reserved`) and open a new, distinct submission with a **new idempotency key**
   only after confirming with the attorney that the filing is still required.
3. If a callback was verified but not recorded, re-drive the callback through the
   normal verifier → processor path; `mio_record_efiling_callback_v1` is
   idempotent and will return `duplicate` without double-writing.

## Rules

- Never auto-retry an uncertain send.
- Never fabricate court, case, party, attorney, payment or service-contact IDs.
- Never convert a "bill to client" UI preference into an unapproved debit.
- Record every manual action in the matter audit trail.
