# E-Filing Foundation — Trace-up and Deliverable

This documents the "starter work" for the Mio-side Texas e-filing integration
(direct Tyler EFSP path). It builds the internal draft, validation, UI, and
provider-adapter structure so Tyler EFM can be plugged in later. **No live Tyler
submission is implemented.**

## 1. Trace-up of existing code reused

| Area | Existing location | Reused? | Notes |
| --- | --- | --- | --- |
| Matter data | `public.matters` (via `src/App.jsx` `fetchMatters`) | Reuse | `id, name, client_id, cause_number, matter_type, case_status, matter_status, court_id`, nested `courts(*)` and `clients(*)` |
| Court data | `public.courts` (`court_name, county, court_phone, …`) | Reuse | Auto-fill source for county/court |
| Documents | `public.documents` (fields `id, matter_id, file_name, …`) | Reuse | Lead-document source; PDF/convertible check in validation |
| Timeline/activity | `public.calendar_events` (`event_category, event_subcategory, title, start_date, …`) | Reuse | `mioEfilingRepository.efilingEventToTimelineRow` maps an e-filing event to a Matter Timelines row |
| Persistence pattern | `mio_withdrawal_workflows` migration (RLS + security-definer RPC) | Mirror | New `mio_efiling_drafts`/`mio_efiling_events` + `mio_save_efiling_draft_v1` follow the same shape |
| ID helper | `mioEfileAgentId` / `lib/process/model.js` `newId` | Mirror | `efilingId()` in the model |
| Existing e-file (browser agent) | `mio-local-efile-helper.cjs` + eFile page in `src/App.jsx` | Separate | Playwright eFileTexas path; the new foundation is the *direct* integration and does not touch it |
| Process Builder e-file block | `lib/process/model.js` + `src/process/BlockTypeFields.jsx` | Concept reuse | Already models `mode, court, cause, filingCode, recipients, paymentAccount` |

## 2. Files changed (new)

- `src/efiling/mioEfilingModel.js` — `EfilingDraft` model, constants, factory.
- `src/efiling/mioEfilingValidation.js` — `validateEfilingDraft(draft, matter, document)`.
- `src/efiling/mioEfilingAutoFill.js` — auto-fill from matter/document/filer/settings.
- `src/efiling/mioEfilingProvider.js` — provider interface + mock provider + Tyler stub.
- `src/efiling/mioEfilingFlags.js` — feature flags and safety gates.
- `src/efiling/mioEfilingSettings.js` — default settings model.
- `src/efiling/mioEfilingRepository.js` — in-memory + Supabase persistence plan + timeline mapping.
- `src/efiling/MioEfilingPanel.jsx` — standalone e-filing draft review UI shell.
- `src/efiling/mioEfiling.css` — panel styles.
- `supabase/migrations/20261002130000_efiling_drafts_v1.sql` — tables + RLS + RPC.
- `tests/mio-efiling-*.test.js` (6 files) — 20 unit/render tests.

No existing files were modified.

## 3. Database changes

New migration `supabase/migrations/20261002130000_efiling_drafts_v1.sql`:

- `public.mio_efiling_drafts` — owner, matter, document ref, revision, `draft jsonb`.
- `public.mio_efiling_events` — owner, matter, draft, `event_type`, `event jsonb`.
- RLS enabled; read-own policies for authenticated users.
- `public.mio_save_efiling_draft_v1(...)` security-definer RPC with optimistic
  revision check and audit-event write (mirrors the withdrawal workflow RPC).

This migration is **additive** and is not yet applied to any environment.

## 4. E-Filing Draft model

`createEmptyEfilingDraft()` returns a database-ready object covering every field
from the instruction (Section 6): identity/timestamps, `matterId/documentId`,
`filingMode` (`efile_only | efile_and_serve | eserve_only`), jurisdiction/county/
court/cause/case fields, filer/attorney, filing code/description/security,
attachments, service recipients/contacts, payment account and fee state,
validation state, Tyler envelope/status fields, and stamped/receipt URLs.

## 5. UI components

`src/efiling/MioEfilingPanel.jsx` — the "Matter-level e-filing UI shell":

- Document selector, filing-mode buttons (E-File / E-File & Serve / E-Serve Only).
- Auto-filled field grid (county, court, cause number, case type, attorney, bar
  number, filing code, filing description, security, payment account).
- Service-contact list for service modes.
- Validation summary (blocking vs warning).
- Mock fee calculation and mock filing-code/court/payment-account selectors.
- Save draft, validate, mock submit, and **disabled** Stage/Production submit.

It is standalone and must be mounted by the matter page. Suggested wiring (next
session): import the panel and pass `matter`, `documents`, `filer`, `settings`,
`flags`, `provider = createMockEfilingProvider()`, and
`repository = createSupabaseEfilingRepository(supabase)`.

## 6. Provider adapter

Interface methods: `getCourts(state)`, `getCase(query)`,
`getFilingCodes(courtId, caseType)`, `getServiceInformation(caseId)`,
`getPaymentAccounts(firmId)`, `calculateFees(draft)`, `submitFiling(draft)`,
`getFilingStatus(envelopeId)`, `getStampedDocuments(envelopeId)`.

- **Mock** (`createMockEfilingProvider`): fake Texas courts, filing codes
  (filtered by case type), service contacts, payment accounts, deterministic fee
  breakdowns, and a fake envelope on submit. Clearly labeled "no live filing".
- **Tyler stub** (`createTylerEfilingProvider`): every method throws
  `"Tyler EFM credentials are not configured. Complete TCP access, X.509 certificate, Stage account, and TOGA setup before enabling live Stage calls."`

## 7. Validation rules

`validateEfilingDraft` returns `{ status, ready, blockingIssues, warnings, suggestedFixes }`:

- Document exists and is PDF/convertible (blocking).
- County, court, cause number present (blocking) unless initial filing (warning).
- Filing mode selected (blocking).
- Filing attorney selected (blocking); bar number (warning).
- Filing code selected or unresolved (warning).
- Payment account selected unless no-fee/waiver (warning).
- Service recipients selected for e-file-and-serve / e-serve-only (blocking).

## 8. Feature flags / safety gates

- `EFILING_ENABLED=true` (default), `TYLER_EFM_STAGE_ENABLED=false`,
  `TYLER_EFM_PRODUCTION_ENABLED=false`.
- `assessSubmitReadiness(flags, settings)` and `assertEfilingSubmissionAllowed(...)`:
  mock is allowed when enabled; Stage requires the flag **and** certificate/URL/
  account config; Production requires the flag **and** production/TOGA config.
- The UI renders Stage/Production submit buttons disabled with visible reasons.

## 9. How to test without Tyler credentials

```
node --test tests/mio-efiling-*.test.js
npx eslint src/efiling tests/mio-efiling-*.test.js
```

The render test loads `MioEfilingPanel.jsx` through Vite SSR and asserts the
shell, mock label, and safety-gated controls render. All provider/validation/
flag behavior is covered by pure unit tests. `npm run build` still succeeds.

## 10. Still blocked pending Tyler TCP/STAGE access

- Real Tyler SOAP/EFM calls, Stage/Production submission, and stamped-copy
  retrieval (the Tyler provider remains a stub).
- Stage base URL, X.509 certificate status, TOGA/payment configuration, and
  callback URL (settings placeholders only).
- Mounting the panel into the matter page and wiring the Supabase repository
  (requires the migration to be applied first).
