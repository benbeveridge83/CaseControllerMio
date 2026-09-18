# Cloud-save conflict repair

## Behavior

- Confirmed writes notify same-account tabs through BroadcastChannel. Messages contain an account ID and invalidation type, not record contents or credentials.
- Receiving tabs verify user-scoped record timestamps in Supabase. Focus, connectivity restoration, and a visible-tab one-minute check also detect saves from another device.
- Only clean, visible tabs without pending account edits, a dialog, or focused input automatically reload. Any input/change conservatively disables automatic reload for the remainder of that page lifetime: legacy forms do not expose a reliable universal saved-draft signal. These tabs offer an explicit refresh instead.
- Known display preferences use bounded, guarded rebasing. Business records retain strict version-conflict protection. Preference logic is now in the store rather than injected only during a production build.
- Saved work has no persistent bottom banner. Failed saves name their records; conflicts offer a verified recovery backup before selecting the newer cloud value. Recovery copies are not automatically applied to live case data.
- Selecting a cloud value leaves a reload-required notice and blocks stale component writes to that key until reload. It never forces a reload after asynchronous recovery while the user could be typing another draft.

## Verification

Run `node --test tests/*.test.js` and `npm run build`.
Unit coverage includes shared-backend two-tab preference saves, competing billing edits, account-isolated BroadcastChannel notifications, pending/draft guards, recovery verification failure, retained reload notices, and rendered status controls.

`tests/cloud-tabs-browser.mjs` additionally checks the bundled app's clean-tab reload, hidden saved banner, and preservation of a typed draft. Existing startup/browser tests now wait on the workspace readiness attributes instead of the removed saved-state banner.

Browser execution was blocked in this workspace: Chromium was absent and the download timed out/returned HTTP 502. Browser tests must run in CI or an environment with Chromium before treating end-to-end behavior as verified.

No database migration, production data change, or dependency change is required. Existing tabs need the deployed update; preserve their pending edits before reloading them.
