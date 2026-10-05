# E-Filing Foundation — Implementation Review Packet

Status: starter work complete; no live Tyler integration. UI is standalone and not
yet mounted into the matter page.

## 1. Files changed (all new)

- `src/efiling/mioEfilingModel.js`
- `src/efiling/mioEfilingSettings.js`
- `src/efiling/mioEfilingFlags.js`
- `src/efiling/mioEfilingValidation.js`
- `src/efiling/mioEfilingAutoFill.js`
- `src/efiling/mioEfilingProvider.js`
- `src/efiling/mioEfilingRepository.js`
- `src/efiling/MioEfilingPanel.jsx`
- `src/efiling/mioEfiling.css`
- `supabase/migrations/20261002130000_efiling_drafts_v1.sql`
- `tests/mio-efiling-{model,validation,autofill,provider,flags,render}.test.js`
- `docs/efiling-foundation-traceup.md`
- `docs/efiling-tyler-mapping.md`
- `docs/efiling-review-packet.md` (this file)

No existing files were modified.

## 2. Migration summary

`supabase/migrations/20261002130000_efiling_drafts_v1.sql`:

- `public.mio_efiling_drafts` (owner_id, matter_id, document_id text, revision,
  `draft jsonb`).
- `public.mio_efiling_events` (owner_id, matter_id, draft_id, event_type, `event jsonb`).
- RLS enabled with read-own policies for authenticated users.
- `public.mio_save_efiling_draft_v1(...)` security-definer RPC (optimistic revision
  check + audit event), mirroring the existing withdrawal workflow RPC.

**Applied locally?** No. The file exists only in the repo; it has not been applied
to any Supabase environment. Live submission is gated by feature flags regardless.

## 3. Test commands and results

```
node --test tests/mio-efiling-*.test.js   # 20 passed, 0 failed
npx eslint src/efiling tests/mio-efiling-*.test.js   # clean (exit 0)
npm run build                              # succeeds (289 modules transformed)
```

## 4. Manual test path (no Tyler credentials)

- `node --test tests/mio-efiling-render.test.js` renders `MioEfilingPanel.jsx`
  through Vite SSR and asserts the shell, "Mock provider — no live filing occurs"
  label, and the disabled Stage/Production controls.
- To view the panel interactively, mount `MioEfilingPanel` in the matter page with
  `provider = createMockEfilingProvider()` and
  `repository = createInMemoryEfilingRepository()`. The panel is mock-labeled and
  Stage/Production submit are disabled with visible reasons.

## 5. Existing assumptions

- `public.matters` (`id, name, client_id, cause_number, matter_type, case_status,
  matter_status, court_id, opposing_*` flat fields, nested `courts(*)`, `clients(*)`).
- `public.courts` (`court_name, county, …`).
- `public.documents` collection (`id, matter_id, name/file_name, file_url`/upload payload).
- `public.team_members` (`first_name, last_name, email, is_active, page_access`).
- `public.calendar_events` for the Matter Timelines view.
- `public.setting_options` for category/name settings.
- Drafting profile signature block (`draftingProfile.signature_blocks[].bar_number`) for the bar number.
- Cloud-store key/value persistence pattern (mirrored for the new draft tables).

## 6. Missing Mio data fields for auto-fill

| Field | Present in Mio? | Where it lives | New setting/mapping needed? |
| --- | --- | --- | --- |
| county | Yes | `courts.county` (via `matters.court_id`) | No (auto-fill falls back to `matter.county` first) |
| court | Yes | `courts.court_name` | No |
| cause number | Yes | `matters.cause_number` | No |
| case type/category | Yes (partial) | `matters.matter_type`; `case_category` is not a guaranteed column | Add `case_category` mapping if Tyler needs a distinct category |
| filing attorney | Yes | `team_members` (name, email) + default | Add a default filing attorney setting |
| attorney bar number | **No** (not on `team_members`) | drafting profile signature block `bar_number` | Yes — read from signature block or add a per-attorney bar number |
| parties | Yes (partial) | `matters.opposing_party*` flat fields + structured `parties` | No (but normalize the source) |
| opposing counsel | Yes | `matters.opposing_counsel*` + structured party counsel | No |
| e-service contacts | **No** (derived) | inferred from opposing counsel/parties | Yes — dedicated service-contact list or Tyler lookup |
| default payment account | **No** | — | Yes — e-filing settings (after TOGA) |
| document type | **No** (only file name) | `documents.file_name`/`name` | Yes — document-type → filing-code mapping |
| filing code mapping | **No** | — | Yes — `settings.filingCodeMappings` |
| selected document PDF path/source | Yes (partial) | `documents.file_url` / `uploadMioDocumentFile` payload | Align field name with auto-fill (`url \|\| file_url \|\| storage_path`) |
| matter e-file folder / OneDrive source | Yes | `matters.efile_folder` + OneDrive import config | No |

**Top gaps to close:** attorney bar number, default payment account, e-service
contacts, document-type → filing-code mapping, and the exact document PDF path field.

## 7. Recommended next coding step

After Tyler TCP/Stage access is approved: (1) apply the migration, (2) mount
`MioEfilingPanel` in the matter page behind `EFILING_ENABLED` with the mock label,
and (3) add the missing settings fields above. Live Tyler calls stay stubbed until
certificate, Stage account, Review Tool, and TOGA are complete.

