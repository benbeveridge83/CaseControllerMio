# LawPay V324 production rollout plan

**Step 2 is applied and verified in production** (project `vnnkxqpyndidnjbrbywz`). The two V323
migrations are in place and the read-only verification grid met every acceptance criterion: four
row-level-security-enabled tables, every required function with its expected signature, no browser-role
privileges, the required `service_role` privileges, four empty new tables, and 59 unchanged LawPay
transactions.

Steps 3-8 remain unstarted. Each is independently approvable and independently revertible, and none of
them has been applied: no V324 migration, no Edge Function deployed, no mapping created, no transaction
reclassified, no money moved, no balance changed.

## Production state, as established by the read-only preflight (run, results in hand)

| Finding | Result | Consequence |
| --- | --- | --- |
| Whitespace verdict | **SAFE** — 0 of 57 identifiers differ from their trimmed form; 0 leading, 0 trailing | A stored mapping can match the stored identifier exactly; no alignment work is needed before mapping |
| `public.mio_lawpay_accounts` (mapping table) | **ABSENT** | **No mapping can exist until the V323 migration is applied**, because that migration is what creates the table |
| `mio_lawpay_classifications`, `mio_lawpay_ledger_entries`, `mio_lawpay_refund_resolutions` | **ABSENT** | The whole classification workflow is unapplied in production; the interface that uses it cannot be deployed before step 2 |
| `mio_map_lawpay_account_v323` | **ABSENT** | The mapping RPC exists only in the migration |
| `mio_reresolve_lawpay_accounts_v324` | **ABSENT** | Expected until step 3 |
| LawPay functions that do exist | `mio_reconcile_lawpay_transaction_v314(text)`, `mio_store_lawpay_transaction_v314(jsonb)` | The **V314 ingest is live**: that is why the 59 rows exist and why 6 of them carry `mio_account_key_source` |

Read together with the earlier diagnostics, this closes the original question completely: for **41
records the provider account identifier is supplied and production has no mapping table to hold a
mapping for it**, and for **2 records no identifier was supplied at all**. Nothing in the V323/V324
work has ever touched production data — the only live LawPay machinery is the V314-era ingest.

One inference from the data, offered as an inference: the ingest path is live (59 rows carry gateway
event ids), and because it evaluates only the configured `LAWPAY_ACCOUNT_*` secrets, the two
identifiers were never among them — which is exactly what the mapping table is for. Whether the
**Edge Functions** are deployed and at which revision cannot be read from the database at all
(`pg_proc` holds Postgres functions, not Edge Functions); that is checked in the dashboard, under
**Edge Functions**, which lists each function and when it was last updated. Expect
`lawpay-account-diagnostics` to be absent until step 4.

## Decisions this plan implements

| Decision | Value |
| --- | --- |
| Mapping `.....PvRA` | `trust` — pending your confirmation against LawPay |
| Mapping `.....B88Q` | `operating` — pending your confirmation against LawPay |
| The three one-transaction identifiers (`oIRQ`, `PUTQ`, `TYqA`) | **skipped** for now |
| The 2 identifier-less records | left unresolved, for manual verification |
| The `FAILED` charge and the two `closed` records | must remain ineligible for posting |

## Preconditions — read-only, before any change

1. `docs/lawpay-account-preflight-readonly.sql` (paste as its own query). It must report:
   * whitespace verdict **SAFE** (no identifier differs from its trimmed form). If it reports STOP,
     stop: the mapping path trims the identifier while the resolution path never rewrites it, and
     that must be aligned and reviewed before any mapping exists;
   * which V323/V324 objects are already present — **answered: every one of them is absent** (see
     the state section above), so step 2 is **required**, not conditional;
   * the columns of `public.mio_lawpay_accounts` (they must match the mapping call in step 6).
2. `docs/lawpay-account-diagnostic-readonly.sql` (paste as its own query) and keep the output. This
   is the **before** snapshot: 59 transactions, 57 supplied, `configured_account=0`.
3. In the app, note the current trust balance for each matter that holds LawPay money. This is the
   balance that must be **identical** after every step below.

## The boundary this rollout must never cross

It changes the deposit account classification and its provenance, at read time, and (step 7 only) in
storage. It does not post money, move a balance, choose a client, matter or PNC, choose what a
transaction was, decide a refund relationship, apply anything to an invoice, or mark anything as
bank-reconciled. The four refunds on `.....PvRA` will carry trust once mapped, but they still need
the existing refund-relationship decision before any money is affected.

## Step 2 — apply the V323 migrations — **COMPLETED and verified in production**

`supabase/migrations/20260922090000_lawpay_classification_v323.sql` and
`supabase/migrations/20260922090001_lawpay_refund_resolution_v323.sql`.

* **Changes:** creates `mio_lawpay_accounts` (the mapping table), `mio_lawpay_classifications`,
  `mio_lawpay_ledger_entries`, `mio_lawpay_refund_resolutions`, and the functions that validate,
  save, post, correct, match and map. It revokes them from `public, anon, authenticated` and grants
  them to `service_role` only.
* **Verify:** run `docs/lawpay-step2-verification-readonly.sql` (read-only, one statement). It must
  report: all four tables present with row-level security `enabled`; no SELECT, INSERT, UPDATE,
  DELETE, TRUNCATE, REFERENCES or TRIGGER held by PUBLIC, anon or authenticated; `select=true` for
  service_role; the mapping, classification, refund and V314 ingest functions present with their exact
  signatures and service-role only; and `0` rows in all four new tables with `lawpay_transactions`
  unchanged. Any `(stop)` anywhere means stop and send that grid before continuing.
* **Rollback:** it is additive. If nothing has been written yet, drop the functions and then the
  tables (reverse order), reviewed first. Once mappings or classifications exist, dropping the
  tables destroys them — so export them read-only first (the row-count and column queries above).
### How to apply it, exactly

Either route works, and both are done from the dashboard.

1. **SQL Editor, no tooling needed.** Open **SQL Editor → New query**, paste the whole of
   `supabase/migrations/20260922090000_lawpay_classification_v323.sql`, press **Run**. Then re-run
   the preflight and confirm rows 10-13 read `present`, row 14 reads `present (jsonb, text)` and line
   C reads `0` mapping rows. Then repeat with
   `supabase/migrations/20260922090001_lawpay_refund_resolution_v323.sql`. Paste one file at a time,
   because the editor executes exactly what is in its pane and these files carry DDL that must not be
   interleaved with anything else.
2. **CLI, if you prefer it.** `supabase link --project-ref vnnkxqpyndidnjbrbywz`, then
   `supabase db push` with those two migrations in place. Confirm the reference in the dashboard
   first, exactly as in step 4.

Apply the migrations **before** the gateway or the interface are deployed, so that rolling back is a
clean drop of empty objects with no data loss. Re-running the preflight after each file is the whole
verification for this step: it reports which objects now exist, the mapping table's columns, and the
current mapping count.

**Do not use `supabase db push` for a scoped step like this.** It applies every pending migration, so
it would apply later migrations — including the V324 migration — in the same action and exceed the
approval. Paste one reviewed file at a time in the SQL Editor.

## Step 3 — apply the V324 migration

`supabase/migrations/20260923090000_lawpay_provider_account_resolution_v324.sql`.

* **Changes:** one function, `public.mio_reresolve_lawpay_accounts_v324(text,text,text)`. It restates
  the account classification and provenance of transactions already carrying a mapped identifier,
  writes no money, and now **appends the previous values to the row's own
  `raw.mio_account_resolution_history` before replacing them**, so the change is reversible from the
  data alone. It also refuses to write anything unless a named actor and an ACTIVE, exactly matching row in `mio_lawpay_accounts` both exist.
* **Verify:** run `docs/lawpay-step3-verification-readonly.sql` (read-only, one statement; the file is
  executed by CI, so it is already known to parse and run). It must report: the function present;
  `security definer=true` with a pinned `search_path`; no PUBLIC, anon or authenticated EXECUTE grant;
  the `service_role` EXECUTE grant present; the V323 and V314 functions still present; all four V323
  tables still `0`; **no transaction carrying a resolution history** (must be `0`); and
  `lawpay_transactions` still at 59. Any `(stop)`, `ABSENT`, `DISABLED` or `MISSING` verdict, any
  non-zero table, or any other transaction count means stop and report the grid before continuing.
* **Fidelity:** the file is 103 lines, blob 327e275be121486ca119da9e1c5220932678878b at `6f91644`, and begins `-- V324: recognizing the deposit account LawPay already supplied.`; its last statement is the `comment on function` describing what it may write.

* **Rollback:** `drop function public.mio_reresolve_lawpay_accounts_v324(text,text,text);` — nothing
  depends on it, and it changes no data by itself.

## Step 4 — deploy `lawpay-account-diagnostics` alone

```
supabase functions deploy lawpay-account-diagnostics --project-ref vnnkxqpyndidnjbrbywz
```

The project reference must be confirmed against the dashboard first (**Project Settings → General →
Reference ID** must read exactly `vnnkxqpyndidnjbrbywz`); an earlier command of mine contained a
typo, and nothing is deployed until the dashboard confirms it.

* **Changes:** replaces one read-only, redacted, finance-admin-only function. It contains no action
  that records, corrects, matches or maps anything.
* **Verify:** as a finance administrator, the answer must carry `version: 324`, `redacted: true`,
  `mapping_table_available: true` and the masked report with `by_ingest_path`,
  `identifier_supplied_mapped`, `identifier_supplied_unmapped`, `identifier_absent`; a
  non-administrator must be refused with 403. In the app, the panel's **Run LawPay account
  diagnostics** control shows it once the interface is live.
* **Rollback:** redeploy the previous revision, or delete the function — the live V322 front end does
  not call it, so removing it changes nothing for users.

## Step 5 — deploy `lawpay-gateway` (the financial actions)

* **Changes:** adds `review`, `save`, `post`, `correct`, `match` and `map_account`, each requiring a
  firm finance administrator, plus the ingest hardening that compares provider identifiers
  value-wise instead of by JavaScript type.
* **Verify — read-only first:** as an administrator, `review` must return transactions with a
  resolved account key for the 16 payment-request rows and no key for the 41 unresolved ones; an
  unauthorised caller must be refused. Do **not** record a live payment as a deployment check.
  Confirm the preflight counts are unchanged and every matter's trust balance is identical.
* **Rollback:** redeploy the previous gateway revision. Nothing has been written, so this reverts the
  function only.

## Step 6 — create the two mappings, after your confirmation

One row per identifier through the administrator-only `map_account` action, which calls
`public.mio_map_lawpay_account_v323` (service role only):

```
{ "provider_account_id": "<full id ending PvRA>", "account_key": "trust",
  "bank_account_id": "", "bank_role": "trust", "last4": "PvRA",
  "label": "LawPay trust settlement account", "is_active": true }
{ "provider_account_id": "<full id ending B88Q>", "account_key": "operating",
  "bank_account_id": "", "bank_role": "operating", "last4": "B88Q",
  "label": "LawPay operating settlement account", "is_active": true }
```

* **Changes:** two rows in `mio_lawpay_accounts`. The function does not touch
  `lawpay_transactions` at all.
* **Verify:** the preflight's optional line C shows `mapping_rows = 2, active = 2`; the diagnostics
  now show `identifier_supplied_mapped = 2` and those identifiers gone from
  `unmapped_provider_accounts`; in the app the affected rows read **LawPay deposit account: Trust**
  and **LawPay deposit account: Operating**, the 2 identifier-less rows still read **Account not
  supplied by LawPay — manual verification required**, the `FAILED` charge and the two `closed`
  records are still ineligible, and every matter's trust balance is unchanged.
* **Rollback:** set `is_active = false` for those two rows (a reviewed one-line update, or re-map with
  `is_active: false`). Resolution stops immediately and nothing has to be deleted.

## Step 7 — optional, provenance only: restate the older rows

`public.mio_reresolve_lawpay_accounts_v324('<full id ending PvRA>','trust','<your email>')`, and the
same for `.....B88Q` with `operating`.

* **Changes:** for each transaction carrying that identifier, `account_key` and the provenance key in
  `raw`, plus one appended history entry. Nothing else — amounts, statuses, refund totals,
  references, payers, clients and matters are not named in the update.
* **Verify:** the returned `updated` count should be 32 for `PvRA` and 9 for `B88Q` (41 in total),
  with `posts_money: false`, `balances_changed: false` and no new ledger entries; the diagnostics'
  `by_provenance` should show `configured_account = 41` and `unresolved = 0`; trust balances
  unchanged.
* **Rollback:** restore from `raw.mio_account_resolution_history` — for each row write back the newest
  entry's `from_account_key` and `from_source`, and drop that entry. The history is append-only, so
  the restore is exact for every column this function writes; a provenance key that was originally
  absent returns as an empty string, which every reader already coalesces to the same meaning. The
  isolated-PostgreSQL suite (`tests/sql/lawpay-provider-account-resolution-v324-behavior.sql`) proves
  the restore and the re-run from that history alone. A reviewed restore script can be prepared on request.

## Step 8 — deploy the interface

* **Changes:** the classification panel's five provenance labels, the read-only diagnostics control,
  and the resolution that reads the mapping.
* **Verify:** the panel labels match the five required strings; the 16 already-resolved rows behave
  exactly as before; the reconciliation summary counts are unchanged; every matter's trust balance is
  identical to the pre-flight figure; the 2 identifier-less rows show the distinct manual-verification
  message.
* **Rollback:** Vercel → the project → Deployments → the previous production deployment → **Promote to
  production**. Instant, and it touches no data.

## Rollback summary

| Step | Revert action | Data loss risk |
| --- | --- | --- |
| 2 V323 migration | drop the created objects (only if nothing has been written) | high once data exists — export first |
| 3 V324 migration | drop one function | none |
| 4 diagnostics function | redeploy the previous revision, or delete it | none |
| 5 gateway | redeploy the previous revision | none |
| 6 mappings | `is_active = false`, or delete the two new rows | none |
| 7 re-resolution | restore from the appended history | none — the history is append-only |
| 8 interface | promote the previous Vercel deployment | none |

## Out of scope for this rollout

No money is posted, no balance is moved, no client, matter or PNC is selected, no invoice is touched,
no refund relationship is decided, nothing is marked bank-reconciled, the three optional mappings are
not created, the two identifier-less records stay unresolved, and no second account system or backfill
is introduced. The `FAILED` charge and the two `closed` records must never post, which the existing
eligibility rules already enforce and which this rollout does not change.

