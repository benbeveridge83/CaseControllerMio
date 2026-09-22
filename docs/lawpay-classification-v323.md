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

## Not implemented yet — the application is unchanged

The gateway actions (`diagnostics`, `map_account`, `save`, `post`, `correct`, `match`) and the
review interface that calls them are **not written**. Consequences:

- No user-visible screen has changed, and the preview deployment behaves exactly as before.
- The account-mapping failure cannot yet be confirmed from inside Mio. The redacted
  `diagnostics` action is still a design, not a shipped endpoint.
- Until the interface exists, no transaction can be classified or recorded from the browser.

Next steps, in order: (1) add the gateway actions with authenticated-administrator
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
4. Verify afterwards that `mio_lawpay_classifications` and `mio_lawpay_ledger_entries` exist,
   that their grants exclude `anon` and `authenticated`, and that `mio_lawpay_accounts` holds
   the firm's provider-account mapping.
