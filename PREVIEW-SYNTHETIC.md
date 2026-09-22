# Hosted synthetic preview (this branch only)

This branch exists to give you a clickable preview of the LawPay classification workflow without any
production access. **Nothing here is merged into `fix/lawpay-classification-v323` or `main`.**

## What makes it self-contained

| Piece | Only on this branch |
| --- | --- |
| `src/mioSyntheticPreview.js` | The synthetic data service: sign-in, the finance tables and both Edge Functions answered from memory. Installed only when `import.meta.env.VITE_MIO_SYNTHETIC === '1'`. |
| `src/mioSupabasePublic.js` | Points at `https://synthetic-preview.invalid`, a host that cannot resolve. |
| `vite.preview.config.js` | Defines `VITE_MIO_SYNTHETIC = '1'`, installs the adapter, builds `dist-preview`, and **fails the build** if the output names the firm's project reference, URL or key. |
| `vercel.json` | `buildCommand: npm run build:synthetic`, `outputDirectory: dist-preview`, so the Vercel Git integration builds the synthetic app for this branch. |
| `package.json` | `build:synthetic` script. |
| `tests/preview-synthetic-smoke.mjs` | Proves the built preview runs, serves three synthetic transactions, shows the panel, and refuses a request to the live project. |

Verified from the built bundle: **0** occurrences of the production project reference, the production
URL or the published key; the synthetic host is present; and a request to the live project is
answered with 403 by the adapter, while the configured host cannot resolve at all.

## Click-through (everything is invented data)

1. Open the preview URL. It signs in as `preview.admin@example.invalid` (synthetic).
2. **Billing → Bulk Billing**, then open **Alpha Synthetic** to reach the matter dashboard.
3. On **Finances**, find **LawPay payment classification**: three payments need a decision —
   `Alpha Synthetic` (reported account, eCheck IOLTA trust), `Yasmine Said` (*Account not
   reported*), `Pending Payer` (authorised only, so it cannot be recorded).
4. Click **Choose what this payment is** on `Yasmine Said`: choose *This matter*, the matter, the
   transaction type, then verify the actual account with evidence — the record button is
   unavailable until you do — and press **Save for later**.
5. Reload the page: the saved decision is still there (server persistence).
6. On `Alpha Synthetic`, choose **Trust deposit — money in** and read the preview, then
   **Confirm and record**. The matter trust balance moves by exactly $5,000, and the payment shows
   **Recorded in Mio**.
7. Press **Confirm and record** again: it is refused, because a recorded payment is never recorded
   twice. **Match the existing entry** links an entry Mio already has instead of posting.
8. In the correction block, change the decisions, choose the account the money actually reached,
   give a reason and read the reversal/replacement preview, then **Confirm correction**: the trust
   credit is taken back once, the replacement posts once, and the audit history keeps both.
9. Correct it back to trust to see the balance restored, and the accounting view agree with the
   matter balance.

Corrections change only this browser tab's in-memory records: reloading the preview returns it to
its seeded state.
