# Mio browser persistence audit - September 5, 2026

## Finding

The active App used localStorage for much more than preferences. applyMioCloudStateRecord copied loaded Supabase state into browser storage. saveMioStateKeyNow fell back to localStorage when unauthenticated, loading, or a cloud request failed; one branch returned success despite no cloud write. Newer features also wrote directly. Login quota recovery could clear unverified local records. Browser backups included arbitrary storage keys and could overwrite active cloud records.

Source paths: src/App.jsx, original functions applyMioCloudStateRecord, saveMioStateKeyNow, migrateExistingLocalStateToSupabase, clearMioBrowserCacheForAuthentication, collectMioLocalStorageSnapshot, pushMioLocalStorageBackupToSupabase.

## App-data categories with browser storage paths

Documents and metadata; drafting templates and editor data; settings workspaces; enforcement/violations; service inbox rows and logs; billing entries/invoices/trust state; requested relief and discovery state; graph and table preferences; roadmap, mailing, and e-file job metadata; Google/Meta Ads review logs.

A read-only Supabase aggregate found approximately 16.4 MB of raw user-state values across two accounts. This is NOT a measurement of any specific browser. The migration screen inventories actual record names and byte sizes on the user's own device.

## New behavior

A root boundary reads paginated user-scoped cloud state before App initializers run. The App's legacy Storage-shaped interface is redirected to account-scoped RAM plus Supabase, not the browser's durable Storage. Failed writes remain pending and visible, with retry, before-close warning, and cloud recovery. Guarded writes use optimistic timestamp checks to reject stale values. Existing relational tables and existing cloud file integrations are not moved or deleted.

Legacy browser records require explicit ownership confirmation because old keys were unscoped. Every record is archived and read back before deleting its exact browser value. Missing cloud records are imported with conflict-ignore semantics. Existing cloud values are not overwritten; differing local versions remain in case_mio_browser_recovery. Skipping migration leaves old browser copies untouched, but new app writes still use Supabase.

## Narrow browser exceptions

Supabase/MSAL sign-in credentials, short-lived OAuth redirect state, expiring cross-tab polling leases, and IndexedDB directory-permission handles for user-selected e-file folders. These handles are not document copies. Explicit downloads and the local e-file helper's intentional local staging are separate user-requested file operations.

The source also contains an old base64-embedded Case Planner/Discovery portal with localStorage and IndexedDB file caching. Its decoder importedDiscoRemoveFixHtml has no active caller in the audited App or Vite transforms. This change does not migrate a separate standalone Case Planner site's storage.

## Verification and limits

13 unit tests cover cloud-first loading, no disk mirroring, failed reads/writes, archive/read-back failure, account switching, stale writes, in-flight serialization, pagination, auth exclusion, and fail-closed source integration. Browser tests use synthetic records and intercept remote requests: no actual user's session or client data is used. Production SQL tests exercise authenticated/RLS paths within a rolled-back transaction.

This change does not pretend that RAM is durable. Closing a tab with failed saves can lose unpreserved edits; the UI warns and offers recovery. Old tabs running older code should be closed before migrating. Existing older cloud backup rows containing possible authentication keys were identified by key name only and were not exposed or silently deleted.
