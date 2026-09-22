# Cloud-save conflict repair

## Behavior

- Confirmed writes notify same-account tabs through BroadcastChannel. Messages contain an account ID and invalidation type, not record contents or credentials.
- Receiving tabs verify user-scoped record timestamps in Supabase. Focus, connectivity restoration, and a visible-tab one-minute check also detect saves from another device.
- Only clean, visible tabs without pending account edits, a dialog, or focused input automatically reload. Any input/change conservatively disables automatic reload for the remainder of that page lifetime: legacy forms do not expose a reliable universal saved-draft signal. These tabs offer an explicit refresh instead.
- Automatic refresh is now paced so a window is never reloaded in a loop: the window must have been ready for `quietAfterReadyMs` (8 seconds) before the first automatic reload, another tab changing only display preferences (`caseMioStickyFilter:*`, expanded rows, column widths) never reloads this window, and one window reloads at most once per `minAutoReloadGapMs` (2 minutes). The last automatic reload time is kept in that tab's `sessionStorage` (`mioAutoReloadAtV321`), so a reload chain cannot repeat every few seconds. A change detected inside either window is re-checked after the window instead of being dropped, and a record this tab resolved to its cloud version still requires a reload.
- Known display preferences use bounded, guarded rebasing. Business records retain strict version-conflict protection: a genuine two-sided edit of one record still stops and asks. A rejected write whose value the cloud already holds, or that only adds rows of its own, is now repaired instead of reported (docs/cloud-conflict-auto-repair-v322.md). Preference logic is now in the store rather than injected only during a production build.
- `mioCloudStore.status()` reports `changedKeys` (record names only, never values) and `reloadRequired` so a tab can decide whether the newest cloud records affect it.
- Saved work has no persistent bottom banner. The startup screen and the save notices are now customer-facing rather than diagnostic (docs/startup-screen-and-save-notices-v322.md). Failed saves name their records; conflicts offer a verified recovery backup before selecting the newer cloud value. Recovery copies are not automatically applied to live case data.
- Selecting a cloud value leaves a reload-required notice and blocks stale component writes to that key until reload. It never forces a reload after asynchronous recovery while the user could be typing another draft.

## Verification

Run `node --test tests/*.test.js` and `npm run build`.
Unit coverage includes shared-backend two-tab preference saves, competing billing edits, account-isolated BroadcastChannel notifications, pending/draft guards, recovery verification failure, retained reload notices, and rendered status controls. `tests/cloud-sync.test.js` additionally covers display-preference-only changes, the startup quiet window, and the per-tab reload guard.

`tests/cloud-tabs-browser.mjs` additionally checks the bundled app's clean-tab reload, hidden saved banner, and preservation of a typed draft. Existing startup/browser tests now wait on the workspace readiness attributes instead of the removed saved-state banner.

Browser execution now runs in this workspace (Chromium is installed): `tests/cloud-startup-browser.mjs`, `tests/cloud-tabs-browser.mjs`, and `tests/cloud-conflict-repair.test.js` were executed against a production build with a 216-record synthetic account containing a 3.5 MB record. Cold start required 73 read requests; a warm second window reused the open tab's records in 1 request with no disk writes.

No database migration, production data change, or dependency change is required. Existing tabs need the deployed update; preserve their pending edits before reloading them.
