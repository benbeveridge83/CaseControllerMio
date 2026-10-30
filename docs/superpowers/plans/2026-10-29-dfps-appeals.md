# DFPS / CPS Appeals Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Research is delegated by independent legal subject; implementation is performed in the main task.

**Goal:** Add a detailed, source-backed, navigable Texas termination-appeals resource to Mio's left sidebar.

**Architecture:** Lazy-loaded React resource page with static researched content, pure search utilities, account-scoped local bookmarks, and existing staff access checks. No matter data or new backend.

**Tech Stack:** Existing React 19, Vite, plain JavaScript/CSS, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-dfps-appeals-design.md`

## Global Constraints

- Preserve the current app and its transform plugins; integrate through a checked mount plugin without editing App.jsx.
- No new runtime dependency, database migration, external write API, or client-data integration.
- Production merge/deployment remains subject to the user's earlier separate-approval instruction.

## Review Focus

- Searches must include authority citations and hidden detail text, normalize punctuation, and combine section/bookmark filters.
- Stored bookmarks may be malformed, unavailable, or belong to another signed-in user.
- Former statutory letters and effective dates cannot silently become current law.
- Staff navigation and route guards must both apply, including direct hash entry by an outside account.
- Narrow screens, keyboard access, no-result search, and print output must remain readable.

## Task 1: Research catalog and search model

**Files:** `src/appeals/data/*.js`, `src/appeals/appealsCatalog.js`, `src/appeals/appealsModel.js`, `tests/appeals-resource.test.js`.

**Interfaces:** Catalog exports `APPEAL_ISSUES`, `APPEAL_SECTIONS`, `APPEAL_GROUPS`, `RESEARCH_DATE`; model exports `filterAppealIssues(issues, options)`, `parseSavedIssueIds(raw, validIds)`, and `buildIssueText(issue, perspective)`.

- [x] Write and run failing behavioral tests for search, safe bookmark parsing, and printable text.
- [x] Implement helpers and import independently researched issue arrays with stable IDs and primary-source links.
- [x] Validate unique IDs, complete issue fields, recognized sections, source URLs, coverage, and explicit version distinctions.

## Task 2: Resource interface and application integration

**Files:** `src/appeals/MioAppealsResource.jsx`, `src/appeals/appeals.css`, `mio-dfps-appeals-mount.js`, `vite.config.js`.

**Interfaces:** `MioAppealsResource({ userId })` renders the complete resource. The parent keys the component by authenticated user ID.

- [x] Add render/navigation tests for the opening view and detail structure.
- [x] Build overview, section/subsection tree, search, role selector, issue detail, sources, bookmarks, print, and responsive styling.
- [x] Register `dfps_appeals`, staff-only sidebar link, and guarded lazy route.
- [x] Verify browser navigation, searching, filtering, persistence, role changes, mobile layout, and printing.

## Task 3: Review and deliver review branch

**Files:** Tests and evidence under ignored `test-results/`; this plan records results.

- [x] Run complete existing node test suite and production build; identify any pre-existing failures separately.
- [x] Run targeted lint and independent code/content review; fix material findings.
Delivery gate: after local verification, publish the feature branch and a draft PR containing the full catalog and verification summary. The PR records publication status; production approval remains a separate user decision.

## Implementation ledger

- Fresh clone on isolated `feat/dfps-appeals-resource-20261029` branch from `8b15e9d`.
- Ruling: follow existing build-time page mount plugins instead of editing the 63,000-line App.jsx; preserve anchor checks and lazy route guards.
- Baseline: 82/84 test files passed in sandbox; browser-syntax failed because spawnSync is restricted. Elevated recheck passes browser-syntax. The existing formspree-render test still fails its expected “Send fee agreement for e-signature” label before feature integration; no PNC files modified.
- Search/bookmark/copy helper tests: observed failing before implementation, then all four passed. Mount test: failed before implementation, then passed.

- Independent code review: fixed same-tab hash navigation/sidebar reset, actual Mio cloud-wrapper responsive and print targeting, inherited text alignment, and mobile first-link interception. The Team-link regression failed before the final spacing fix and passed afterward.
- Full node suite after interface fixes: 545 tests, 544 passed. Sole failure remains the previously confirmed Formspree fee-agreement label assertion.
- Final legal integration: 53 procedure, 51 merits, and 46 trial/briefing guides (150 total); 401 authority references; all 16 sections populated. Legal review corrections and two substantive ICWA cards included.
- Final catalog/model/mount/render checks and targeted lint passed.
- Production build passed in 23.21 seconds; appeals payload is lazy-loaded (477.30 kB uncompressed, 119.23 kB gzip).
- Final fixture browser run passed all 150 guides, citation search, perspectives, bookmarks/account isolation, deep links, same-tab navigation, print, empty states, and mobile layout with zero browser errors.
- Final built-app integration at port 4174 passed staff navigation, the lazy route, real-shell mobile geometry, print isolation, Team-link exit/style cleanup, and outside-account denial; no real external writes.
- Desktop and mobile screenshots visually inspected. Test evidence remains under ignored test-results/.
