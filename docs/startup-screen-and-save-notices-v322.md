# Startup screen and save notices

The first screen a Mio user sees is now a product screen, not a diagnostic report, and
saved work is never announced.

## Startup screen

- `src/MioStartupScreen.jsx` renders one branded card (Mio / Case Controller wordmark),
  a plain-language title, and a thin progress bar. It replaces the previous white page
  that printed `Loading Mio from Supabase`, `Cloud data must load before edits are
  enabled`, `Loaded 196 of 222 saved records`, `Reading cloud records in parallel`, and
  the `Cloud startup 304.1 - sign-in recovery / cloud-verified tab reuse` build label.
- Customer-facing copy never names the storage backend: `Checking your sign-in session…`,
  `Reading your saved records…`, and `Loading your saved records… N of M`. `Retry loading`
  stays available as a quiet button.
- Engineering detail is unchanged but only renders when diagnostics are enabled:
  `?mioDebug=1` on the URL, or `localStorage.caseMioStartupDiagnostics = '1'`. See
  `src/mioStartupView.js`.
- Nothing about cloud verification changed: edits stay disabled until every saved record
  has been read and verified, the workspace stays hidden through `[data-mio-cloud-phase]`,
  and `Retry loading` still reloads a timed-out sign-in instead of retrying behind it.

## Save notices

- Saved work shows no notice. A save in progress shows a small pill (`Saving changes…`),
  and a record resolved to a cloud version shows a one-line pill with
  `Refresh saved data`.
- The detailed card is reserved for a save that did not complete. Its wording is shorter,
  its footprint is smaller, and it keeps `Use newer cloud version`, `Retry save`,
  `Preserve my edits and reload`, and the verified-backup note.
- Because identical-value and independent-row conflicts are now repaired silently
  (docs/cloud-conflict-auto-repair-v322.md), this card appears far less often than before.

## Verification

- `tests/cloud-startup-view.test.js`: diagnostics hidden by default, shown with
  `?mioDebug=1` or the storage flag, and never in the customer-facing text; progress text
  and percentage behavior.
- `tests/cloud-startup-browser.mjs`: the bundled app shows `[data-mio-startup="loading"]`,
  its status text is customer-facing, and neither `Supabase` nor `Cloud startup` appears
  on that screen.
- `tests/cloud-tabs-browser.mjs`: a saved workspace still shows no `Cloud save status`
  panel in the bundled app.
- `tests/cloud-status.test.js`: the conflict card, the retry path, and the
  `Refresh saved data` pill render with their action labels.

No database migration, production data change, or dependency change is required.
