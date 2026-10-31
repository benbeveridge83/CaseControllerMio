# Track Relief Defaults Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Requested Relief opens in the matter and litigation track's context automatically.
**Architecture:** Shared order_type filter IDs drive track metadata and issue applicability. Pure helpers resolve destination defaults and protect saved contexts; App wires these helpers into existing cloud-backed state and UI.
**Tech Stack:** React/Vite, JavaScript, Node tests, existing Supabase state sync.
**Spec:** docs/superpowers/specs/2026-10-31-track-relief-defaults.md

## Global Constraints
- No new database columns; use existing matter extras and track state.
- Do not delete or trim saved selected issues, options, or text when filtering.
- Keep Discovery requests/responses separate from litigation order types.

## Review Focus
- Reused relief/template from another matter must adopt destination defaults.
- Saved explicit empty/None contexts must survive reopening.
- Default final tracks must keep classification after normalization and reload.
- Custom/archived type identities must survive rename and existing-track editing.
- New-track creation from relief setup must select the new track and its defaults.

### Task 1: Shared types and context resolution
**Files:** src/reliefTrackContext.js, src/reliefApplicability.js, tests/relief-track-context.test.js
**Interfaces:** litigationOrderType(track), reliefContextDefaults(extra, track, groups), initialReliefContext({saved, sourceContext, defaults}), reliefTypeChoices(groups, groupId, selected).
- [x] Write and run failing behavior tests for defaults, reuse, legacy, archives, Other, saved All/None.
- [x] Implement pure helpers and backward-compatible Other choice normalization.
- [x] Run Node tests for new helpers and existing applicability tests.

### Task 2: Matter, track and relief integration
**Files:** src/App.jsx, src/ReliefApplicability.jsx, tests/relief-track-integration.test.js, tests/relief-track-browser.mjs
**Interfaces:** Task 1 helper exports; existing matter extras and litigation track state.
- [x] Write failing integration tests for normalizing tracks, inherited builder filters, saved overrides, new-track assignment and type choices.
- [x] Wire proceeding editor, shared track choices, compact setup and restore defaults.
- [x] Run focused tests, full Node suite and production build; exercise browser flows with synthetic local fixtures.
- [x] Review whole diff, correct material findings, commit and publish through GitHub/Vercel, verify production asset and deployment status.

## Verification and review
- Focused relief suite: 47 passed.
- Full Node suite: 596 tests, 593 passed; three unchanged baseline failures in appeals-content (supp-icwa-concurrent-findings appellant coverage), appeals-render (date text), and formspree-render (fee-agreement label).
- Production build passed.
- Browser tests passed with synthetic authentication and intercepted network traffic: track/party defaults, shared custom types, Other exclusion from All, saved overrides and hidden selections, restoring defaults, track creation from both setup and builder, matter proceeding saved and reloaded. Existing inline-row browser regression passed.
- Independent review found two issues, both corrected with failing-then-passing regressions: stale callback after new track creation, and archived filter group blocking metadata choices. No unresolved findings.
- Existing linked checkouts and approved implementation/publish scope were retained; matter proceeding uses the established cloud-backed extra-info record, avoiding a new database column.
- Publication is recorded by the PR/merge and deployment status.
