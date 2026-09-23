# LawPay deposit-account mapping proposal (V324) — PROPOSAL ONLY

Nothing in this document has been executed. No mapping exists, no migration is applied, no Edge
Function is deployed, no transaction has been reclassified, no money has moved and no balance has
changed. It records what the two read-only production diagnostics showed and what they imply, so the
decision is auditable and can be approved (or rejected) item by item.

## What the production diagnostics showed

Run 1 (`docs/lawpay-account-diagnostic-readonly.sql`), 59 stored transactions:

| Finding | Value |
| --- | --- |
| Transactions reviewed | 59 |
| Provider account identifier supplied | 57 |
| Provider account identifier absent | 2 |
| Identifier type as stored in the provider payload | `string=57`, `number=0`, `absent=2` |
| Rows with a Mio payment-request fallback | 16 |
| Rows with a stored Mio account key | 16 (exactly the payment-request rows) |
| Provenance | `not_recorded=37`, `payment_request=16`, `unresolved=6`, `configured_account=0` |
| Ingest path | every row arrived by provider webhook |

Run 2 (`docs/lawpay-account-diagnostic-readonly-followup.sql`), the same 59 rows grouped by masked
identifier × stored Mio account × provenance:

| Masked identifier | Stored Mio account | Provenance | Transactions | From payment links |
| --- | --- | --- | --- | --- |
| `.....PvRA` | trust | payment_request | 12 | 12 |
| `.....PvRA` | (none stored) | not_recorded | 30 | 0 |
| `.....PvRA` | (none stored) | unresolved | 2 | 0 |
| `.....B88Q` | operating | payment_request | 1 | 1 |
| `.....B88Q` | (none stored) | not_recorded | 5 | 0 |
| `.....B88Q` | (none stored) | unresolved | 4 | 0 |
| `.....oIRQ` | trust | payment_request | 1 | 1 |
| `.....PUTQ` | trust | payment_request | 1 | 1 |
| `.....TYqA` | operating | payment_request | 1 | 1 |
| (none supplied) | (none stored) | not_recorded | 2 | 0 |

## Determination

**The live condition is supplied-but-unmapped, not missing.** 41 records carry a provider account
identifier that Mio has never mapped (`.....PvRA` 32, `.....B88Q` 9). Exactly **2** records genuinely
have no identifier (both old `card` transactions with status `closed`), and those two are the only
ones that should ever say *Account not supplied by LawPay — manual verification required*.

The `configured_account=0` line is the proof of the mechanism: not one row in production has ever
resolved **from** a provider identifier. The 16 resolved rows are resolved because a **Mio payment
link** named the account, and the 6 rows carrying `unresolved` prove that the resolution step runs
and finds no mapping.

## Proposed mappings (not created)

Required — these two carry 54 of the 57 supplied transactions:

| Masked identifier | Proposed Mio account | Evidence | Confidence |
| --- | --- | --- | --- |
| `.....PvRA` | `trust` | 12 of its 12 payment-linked rows recorded Mio account `trust` | strong (12/12) |
| `.....B88Q` | `operating` | its single payment-linked row recorded Mio account `operating` | weaker (1/1) |

Optional, recommended so a future charge is named automatically rather than resolved by luck:

| Masked identifier | Proposed Mio account | Evidence |
| --- | --- | --- |
| `.....oIRQ` | `trust` | 1 payment-linked row recorded `trust` |
| `.....PUTQ` | `trust` | 1 payment-linked row recorded `trust` |
| `.....TYqA` | `operating` | 1 payment-linked row recorded `operating` |

Not mappable: the 2 records with no identifier. There is nothing to map, and inventing an account
for them is exactly what must not happen.

Confirmation this proposal still needs from the firm, because a masked last four cannot identify a
LawPay account on its own:

1. `.....PvRA` is the LawPay account that settles into the firm **trust (IOLTA)** account.
2. `.....B88Q` is the LawPay account that settles into the firm **operating** account.
3. `.....oIRQ`, `.....PUTQ` are trust; `.....TYqA` is operating (optional to map at all).
4. The 2 identifier-less records stay unresolved for manual verification.
5. The single `FAILED` charge and the two `closed` records must never post (the existing eligibility
   rules already refuse non-completed statuses; the mapping does not change that).

## What a mapping will and will not do

It will: name the deposit account for **every** existing and future transaction carrying that
identifier, at read time, with no rewrite of the transactions at all; and, once the V324
re-resolution function is applied, restate the stored classification and provenance of the older
rows. It posts no money, moves no balance, selects no client, matter or PNC, applies nothing to an
invoice, issues no refund and creates no financial entry — each planned update states that
explicitly.

It will not: decide ownership, choose the client, matter or PNC, choose what the transaction was,
decide whether a refund is the same refund or a separate one, or mark anything as bank-reconciled.
Those stay the reviewer's decisions, which is the intended boundary: you should not have to
re-identify trust versus operating when LawPay has already said which account the money reached.

## The exact call, when it is approved

The mapping is one row per identifier in the existing `mio_lawpay_accounts` table, written through
the existing function `public.mio_map_lawpay_account_v323` (service role only, so it is reached
through the administrator-only gateway action `map_account`). Its contract, read from
`supabase/migrations/20260922090000_lawpay_classification_v323.sql`:

* requires a non-empty actor (who recorded the mapping) and a non-empty `provider_account_id`;
* requires `account_key` to be one of `operating`, `trust`, `echeck_operating`, `echeck_trust`,
  `clientcredit_trust`;
* accepts optional `bank_account_id`, `bank_role`, `label`, `last4`, `is_active`;
* upserts on `provider_account_id`, so re-running is idempotent and never creates a second account;
* **does not touch `lawpay_transactions` at all** — mapping alone changes no transaction.

```
{ "provider_account_id": "<the full LawPay account id ending PvRA>",
  "account_key": "trust",
  "bank_account_id": "",
  "bank_role": "trust",
  "label": "LawPay trust settlement account",
  "last4": "PvRA",
  "is_active": true }
```

The full identifier is deliberately absent here: it never needs to pass through the assistant or
this document. Take it from LawPay or from the app at the moment of approval.

## Open observations (no action taken)

1. **No numeric identifiers exist in production** (`number=0`). The ingest type-comparison defect
   found in code is therefore not the cause of these symptoms; it remains hardening for a payload
   shape LawPay has not sent yet.
2. **The mapping path trims the identifier; the resolution path never rewrites it.** If any provider
   identifier carried surrounding whitespace, a stored mapping could fail to match it. One read-only
   line settles whether that matters here:
   `select count(*) filter (where account_id <> btrim(account_id)) as ids_with_whitespace, count(*) as rows from public.lawpay_transactions where account_id is not null;`
3. **The six `unresolved` rows** will flip to the mapped account on the next read once the mapping
   exists, and the V324 re-resolution function can restate them in storage.
4. **The four refunds** (all on `.....PvRA`) will carry the trust account once it is mapped, but a
   refund still needs the existing refund-relationship decision (same refund or separate refund)
   before any money is affected. Mapping alone moves nothing.

## Deployment order, all still pending approval

Per `docs/lawpay-classification-v323.md`: the diagnostics function alone (safe to deploy alone), then
the gateway with its financial actions, then the interface; the V324 migration is applied as its own
reviewed step. None of these has been done, and none will be without your approval.

