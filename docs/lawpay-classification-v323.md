# LawPay classification, deposit-account mapping and atomic posting (V323)

## What this release adds

Nothing here charges, refunds or transfers money. It records what a verified provider
transaction did, once, and keeps an audit trail of corrections.

**Rules (`src/mioLawPayAccounts.js`, `src/mioLawPayClassification.js`)**

- Provider account IDs are opaque: never lowercased, padded or trimmed. The only coercion is
  null-safe string conversion, so a numeric provider ID matches its configured string while
  `"ACCT-1"` never matches `"acct-1"` and `" acct-1"` never matches `"acct-1"`.
- The account comes from exactly three sources, in order: a recorded manual verification with
  evidence, the provider account ID through the firm's mapping, or the Mio payment link that
  created the charge. It is never inferred from a payer, an amount, a matter or an invoice.
- Ownership, actual account, and category/direction are three separate decisions. The
  interface says **money in** / **money out**. A matter association never implies trust, and a
  consultation label never proves the money reached operating.
- A missing account can be saved with an evidence reference, an explanation and the confirming
  user, and is labelled **Manually verified** — never "Reported by LawPay".
- Gross payment, processor fee and net settlement stay separate. A client trust credit is the
  gross amount and is never reduced by a processing fee.
- Review statuses keep **recorded in Mio** distinct from **matched to bank settlement or
  statement**; nothing here sets the bank-matched state automatically.

**Database (`supabase/migrations/20260922090000_lawpay_classification_v323.sql`)**

- `mio_lawpay_accounts` — administrator mapping from a provider account ID to the firm's own
  account, reusing the existing bank-account IDs and roles Mio already holds.
- `mio_lawpay_classifications` — the recorded decision: ownership, actual account and how it
  was established, category and direction, amounts, optional invoice, manual-verification
  evidence, posting status, matched entry, and the link to the record it corrects.
- `mio_lawpay_ledger_entries` — the trust-side postings and their reversals.
- `mio_post_lawpay_classification_v323`, `mio_save_lawpay_classification_v323`,
  `mio_correct_lawpay_classification_v323`, `mio_match_lawpay_classification_v323`,
  `mio_map_lawpay_account_v323` — service-role only; browsers and anonymous sessions cannot
  read or write any of these tables (RLS on, grants revoked).
- The **posting identity is the provider's transaction ID**. It is immutable: resolving or
  correcting the trust/operating account never changes it, and a second webhook, rescan,
  retry or tab cannot post again. A partial unique index on the identity backs up the
  advisory lock, so the guarantee holds even if two sessions race.
- Amounts are always derived from the stored provider record, never from the caller. Posting
  writes classification, ledger entry, posting status and any invoice event in one
  transaction.

## Verified

- `node --test tests/lawpay-classification-v323.test.js` — 16 rule tests.
- `tests/sql/lawpay-classification-v323-behavior.sql` on an isolated PostgreSQL: posting once,
  retry and webhook replay posting nothing more, an unestablished account refused while a saved
  review item is kept, pending and void never posting, a refused posting rolling back
  completely, a correction reversing the old entry and netting to zero, a refused correction
  leaving the recorded posting intact, matching validated against the stored entry (wrong
  amount, opposite direction, another account's ledger and an already-matched entry all
  refused), a refund reducing trust once with an unverified original-payment relationship left
  flagged, and a refunded total on a charge never creating a ledger entry by itself.
- Two overlapping sessions racing on the same provider transaction: one posts, the other is
  told it is already accounted for, and exactly one posting and one ledger entry remain.
  Reproduced locally against PostgreSQL 18 and repeated in CI (`finance-review-v314.yml`).

## Diagnostics (implemented, administrator only)

`lawpay-gateway` now supports a read-only `diagnostics` action using
`supabase/functions/_shared/lawpay-accounts-v323.js`:

- It requires an authenticated session **and** a recognised firm finance administrator
  (`MIO_FINANCE_ADMIN_EMAILS`, defaulting to `ben@beveridgelawfirm.com`). Anyone else receives
  403 and no diagnostics.
- It reads the stored provider records and the `mio_lawpay_accounts` mapping and returns counts
  plus last-four identifiers only: provenance counts, whether the provider reported `account_id`
  as a string, a number or not at all, how many rows carry a refunded total, the distinct
  masked provider accounts with how many rows each, which of them are **unmapped**, the
  configured accounts, mapping problems and duplicates, and the provider payload **field names**
  seen. It never returns a payer, an amount, an email, a reference, a raw payload or a full
  account identifier.
- It works before the migration is applied too: without the mapping table it falls back to the
  environment keys and reports `mapping_table_available: false`.
- Tested in `tests/lawpay-accounts-v323-shared.test.js` (authorization, exact-ID resolution,
  inactive mappings shadowing the environment seed, and redaction).

Deploying it is the only step that needs the Supabase CLI, and it must be deployed **alone** —
no other gateway change is part of this authorization:

```
supabase functions deploy lawpay-gateway --project-ref vnnkxqpyndidnjbrbywz
```

Then, signed in as a finance administrator, `lawpay-gateway` action `diagnostics` answers why a
transaction says "Account not reported". Until it is deployed, the account-mapping cause cannot
be confirmed from inside Mio, and every other statement here is limited to synthetic data.

## Not implemented yet — the application is unchanged

The gateway actions that record money (`save`, `post`, `correct`, `match`, `map_account`) and
the review interface that calls them are **not written**. Consequences:

- No user-visible screen has changed, and the preview deployment behaves exactly as before.
- Until the interface exists, no transaction can be classified or recorded from the browser.

Next steps, in order: (1) add those gateway actions with authenticated-administrator
authorization at the endpoint (a service-role RPC does not authorize its caller); (2) wire the
review panel and merge posted trust entries into the matter dashboard, accounting ledger,
withdrawal page and PNC views so the four surfaces agree and derived rows are suppressed once
posted; (3) add the browser flow test (categorize, save, reload, balances) and a preview.

## Limitations, stated plainly

- Mio does not keep a general ledger. These are single-entry rows with an explicit account and
  direction, not debits and credits.
- Operating postings are recorded on the classification rather than as a second operating
  total, so existing derived operating figures are not double counted. There is no separate
  operating ledger entry for a consultation payment.
- Automated bank matching and three-way trust reconciliation are deliberately out of scope.
- A refund's link to its original payment is stored only when it is verified; until then it is
  flagged for review and the relationship is never guessed.
- The mapping table is populated by an administrator. No provider account-listing endpoint
  could be verified from this environment, so nothing here assumes one exists.

## Production deployment steps

1. Apply `supabase/migrations/20260922090000_lawpay_classification_v323.sql` in an isolated
   development database first (CI does this on every pull request), then in production.
2. No data migration and no backfill is required: nothing posts until a reviewer records a
   transaction.
3. The gateway actions must be deployed before the interface that uses them; the interface must
   not be released while the actions are missing.
4. Verify afterwards that all three new tables exist — `mio_lawpay_accounts`,
   `mio_lawpay_classifications` and `mio_lawpay_ledger_entries` — that their grants exclude `anon`
   and `authenticated`, and that `mio_lawpay_accounts` holds the firm's provider-account mapping.

## Reviewing and recording from the matter Finances page (increment 4)

The Matter Dashboard → Finances page carries the workflow: **LawPay payment classification**.
Each stored charge shows whether LawPay reported its deposit account, or says *Account not
reported* plainly, and asks for the three decisions separately — ownership (this matter, a PNC
consultation, or neither with a reason), the actual deposit account, and the transaction type —
then shows a preview of exactly what would be written, including the trust balance change, before
anything is written. Four actions are offered per payment: **Save for later**, **Confirm and
record**, **Match the existing entry** (links an entry Mio already has, posting nothing) and
**Leave for now**. An account nobody has established cannot be recorded: the preview says so, the
record button is unavailable, and the payment can still be saved for later. A provider account can
be mapped once for all of its transactions from the same row.

Everything the panel does goes through the `lawpay-gateway` function, which authorizes the caller
at the endpoint (`MIO_FINANCE_ADMIN_EMAILS`) and then calls a service-role function. A service-role
function does not authorize anybody by itself, and the browser never sends an amount: the gateway
and the database take the amount from the stored `lawpay_transactions` row.

### Money reaching the balances

A recorded (posted) entry is added to the trust ledger that the matter dashboard, the accounting
view, the withdrawal page, Bulk billing and the PNC trust view all read, and the derived LawPay row
for the same provider transaction is suppressed so the money appears exactly once. Suppression does
not assume one identifier form: it resolves every recorded provider transaction against the stored
transactions themselves. Reversals contribute nothing.

`singleCountProviderPayments` also fixed a real pre-existing defect in the invoice reconciliation
arithmetic: a charge that reported a refunded total *and* had its own refund record was being
reduced twice, which understated what the client had paid. Only an **immutable provider
identifier** now decides that a refund row and a charge's refunded total are the same money — an
identical amount in the same account is not proof, because two unrelated refunds can share an
amount. Each charge is counted once net of its own reported total, an unlinked refund row is
subtracted only to the extent it *exceeds* the refunded totals already recorded in that account
(which cannot be the same money), and every unlinked refund is reported for review rather than
resolved silently.

### Diagnostics are their own function

`supabase functions deploy lawpay-gateway` deploys the **whole** gateway function, not one action.
Now that the gateway also carries the actions that record money, a "diagnostics only" release can
no longer be a gateway release. The read-only, redacted diagnostics therefore live in
`lawpay-account-diagnostics`, a function that contains no action which records, corrects, matches
or maps anything. Only that function may be described as a diagnostics-only deployment, and only
when the deployed revision differs from production by nothing else.

### What was verified

- `tests/lawpay-classification-v323.test.js` (17 tests) and `tests/lawpay-accounts-v323-shared.test.js`
  (3 tests): the rules, the refund counting, the account registry.
- `tests/sql/lawpay-classification-v323-behavior.sql` on isolated PostgreSQL: post once, retry and
  webhook replay no-ops, unestablished account refused, correction reverses and links, refund
  reduces trust once, and the two-session posting race that must produce exactly one posting and
  one ledger entry.
- `tests/lawpay-classification-v323-browser.mjs` against the real production bundle with synthetic
  data and an intercepting synthetic service: the Finances page lists the payments, names a
  reported account, states an unreported one, refuses an unverified account and accepts a verified
  one, shows the preview, saves without writing, remembers the saved decision after a reload,
  records it, moves the matter trust balance by exactly the recorded amount, shows the payment once
  in the accounting view with a matching running trust balance, refuses a second recording, and
  agrees with the Bulk billing trust figure the withdrawal rows are built from.
- The existing suites were re-run unchanged: `finance-v314-browser.mjs`,
  `withdrawal-finance-parity-browser.mjs`, and the finance/pnc unit tests.

### Remaining limitations

- Not applied to production and not deployed: the migration and both functions are ready for review
  only. No live accounting record was touched.
- Correction of a recorded classification is available in the panel: change the decisions, state a
  reason, read the reversal and replacement effects, and confirm. The previous posting, its ledger
  entry and its reversal stay linked in the audit history. A correction that cannot post leaves the
  original posting unchanged.
- The deposit-account mapping table is filled by an administrator. No provider account-listing
  endpoint could be verified from this environment, so none is assumed.
- Bulk billing and the withdrawal page round their trust column to whole dollars; the recorded
  amount is compared after that rounding.

## Exactly what production receives (complete inventory)

Nothing is applied or deployed yet; this is the whole change set for review.

Database, from `supabase/migrations/20260922090000_lawpay_classification_v323.sql` (one file):

| Object | Kind | Notes |
| --- | --- | --- |
| `public.mio_lawpay_accounts` | table | provider account id → firm account key, bank account, role, label, active flag, verified by/at. RLS enabled. |
| `public.mio_lawpay_classifications` | table | one decision per provider transaction: ownership, matter, PNC, actual account, provenance, category, direction, money-out, currency, amount, fee, net, invoice, explanation, original link, posting status, posted at, matched entry, correction link, created/updated. RLS enabled. |
| `public.mio_lawpay_ledger_entries` | table | the posted money: entry kind (trust entry, operating association, reversal), direction, account, matter, amount, currency, occurred at, provider account, reversal link, created by. RLS enabled. |
| `mio_lawpay_classifications_identity_active` | unique index | one active classification per provider transaction. |
| `mio_lawpay_classifications_matched_entry` | unique index | an existing entry can be matched by one transaction only. |
| `mio_lawpay_classifications_transaction`, `mio_lawpay_classifications_matter`, `mio_lawpay_ledger_entries_identity` | indexes | lookups by transaction, matter and identity. |
| `mio_lawpay_ledger_entries_once` | unique index | one entry of each kind per classification. |
| `mio_lawpay_ledger_entries_reversal_once` | unique index | one reversal per reversed entry — this is what makes a correction single. |
| `public.mio_lawpay_write_posting_v323(uuid,text)` | function, `security definer` | internal posting helper. Execute revoked from `public`, `anon`, `authenticated`; no grant is issued, so only the definer's own context calls it. |
| `public.mio_post_lawpay_classification_v323(jsonb,text)` | function, `security definer` | records a payment once; refuses a non-established account; advisory lock plus the unique index make a replay a no-op. Execute revoked from `public`, `anon`, `authenticated`; granted to `service_role`. |
| `public.mio_save_lawpay_classification_v323(jsonb,text)` | function, `security definer` | saves a decision without posting. Same grants. |
| `public.mio_correct_lawpay_classification_v323(jsonb,text,text)` | function, `security definer` | reverses the previous posting once, posts the replacement once, links them, and rolls the whole correction back if the replacement is refused. Same grants. |
| `public.mio_match_lawpay_classification_v323(jsonb,uuid,text)` | function, `security definer` | links an existing entry instead of posting; validates amount, direction, matter and single use. Same grants. |
| `public.mio_map_lawpay_account_v323(jsonb,text)` | function, `security definer` | stores the firm's provider-account mapping. Same grants. |

No row-level-security *policies* are created anywhere: the three tables have RLS **enabled** with
`revoke all ... from public, anon, authenticated`, so no client role can read or write them
directly. All access goes through the service-role functions. No `anon`/`authenticated` grant and
no policy is part of this change.

Edge Functions (each is deployed as a whole function):

| Function | Contains | Safe to deploy alone? |
| --- | --- | --- |
| `lawpay-account-diagnostics` (new) | one read-only, administrator-only action returning aggregated, redacted account diagnostics. No action records, corrects, matches or maps anything. | Yes, and only if the deployed revision differs from production by nothing else. |
| `lawpay-gateway` (changed) | the existing `health`, `create_link` and sync actions, plus the new `review`, `save`, `post`, `correct`, `match` and `map_account` actions, each requiring a firm finance administrator. The `diagnostics` action has moved out to the function above. | No — this is a whole-function deploy and it records money. It is held for approval. |

Function environment variables the deployment needs (unchanged names, no new secret types):
`MIO_FINANCE_ADMIN_EMAILS` (who may review or record), `LAWPAY_SECRET_KEY`,
`LAWPAY_ACCOUNT_OPERATING`, `LAWPAY_ACCOUNT_TRUST`, `LAWPAY_ACCOUNT_ECHECK_OPERATING`,
`LAWPAY_ACCOUNT_ECHECK_TRUST`, `LAWPAY_ACCOUNT_CLIENTCREDIT_TRUST`, `SUPABASE_URL` (or `URL`),
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (or `SERVICE_ROLE_KEY`).

Frontend: the Matter Dashboard → Finances classification panel, its rules module and one Vite
transform (`mio-v323-lawpay-classification.js`). It is released only after both functions answer.




## Rollout order, and how to revert

1. **Migration.** Apply `20260922090000_lawpay_classification_v323.sql` on an isolated database
   first (CI already does this on every pull request), then in production. It only creates objects;
   no existing row is read, changed or deleted, and nothing posts by itself.
2. **Diagnostics.** Deploy `lawpay-account-diagnostics` alone and review its output with the
   administrator account: which provider accounts appear, which are unmapped, and whether the
   transaction counts match LawPay. This changes no money, and it is reverted by redeploying the
   previous revision of that function (nothing else calls it yet).
3. **Account mapping.** Record the firm's provider-account mapping (the mapping action, or the map
   control in the panel once the interface is live). Verify each account key against the bank before
   relying on it. A wrong mapping is corrected by saving the row again: it is data, not schema.
4. **Gateway.** Deploy `lawpay-gateway` with the financial actions. Verify **read-only** first:
   `action: 'review'` must return the stored transactions, classifications and entries, and a
   non-administrator must be refused. Do not record a live payment as a deployment check: the first
   live recording happens only on a transaction the firm administrator selects and approves, after
   the read-only checks pass. Account mapping and any live classification are production financial
   data changes and are made only with the firm's explicit approval.
5. **Interface.** Release the panel only after step 4's read-only checks pass. Until then the panel
   shows a gateway error rather than pretending the workflow works.
6. **Read-only verification.** Confirm: no row in the three new tables was written by a client role
   (`select` still revoked); `review` returns the expected counts; the rest of Mio's finances are
   unchanged (trust balances, pending cards, invoices) because nothing posts until a reviewer
   records a transaction.
7. **If verification fails.** Stop and roll back the *release*, not the data: redeploy the previous
   `lawpay-gateway` revision and roll the frontend back, and leave the three new tables and their
   rows in place — they hold the audit trail, and they are empty until something is recorded. A
   wrong *classification* is never deleted: open the payment, choose the right ownership, account
   and category, state the reason and confirm, and the previous entry is reversed once with the
   replacement posted once, both linked. The same correction is available as the service-role
   function `mio_correct_lawpay_classification_v323`. Tables are dropped only as a deliberate,
   separately approved removal of the feature *and* only after the records they hold have been
   exported — never as a routine rollback.
