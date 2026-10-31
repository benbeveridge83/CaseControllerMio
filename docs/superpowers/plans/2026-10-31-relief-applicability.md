# Requested Relief Applicability Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configurable applicability on rows, Settings preview filters, and saved builder contexts.
**Architecture:** Pure matching model, reusable React editors, existing App integration and cloud state.
**Tech Stack:** React, Vite, Node test runner.
**Spec:** docs/superpowers/specs/2026-10-31-relief-applicability.md

## Global Constraints
- Keep existing tree and recent template-opening fix.
- Preserve existing rows and selections; no seeded legal classifications.
- Existing cloud save/hydration handles group settings.

## Review Focus
- Empty vs absent selection; absent must retain legacy visibility.
- Parent/child intersections must match the same option within each group.
- Renaming/archiving must preserve IDs and constraints.
- Builder context survives save/reopen and template snapshots.
- Filter changes must not silently discard selected options or text.

### Task 1: Matching model and controls
Files: src/reliefApplicability.js, src/ReliefApplicability.jsx, tests/relief-applicability.test.js, tests/relief-applicability-ui.test.js.
- [x] Write failing tests for legacy/unrestricted, None, OR/AND, inherited intersection, cycles, archived definitions, immutable selections.
- [x] Implement default groups, normalization, effectiveApplicability(row, rows, groups), visibleReliefIds(rows, groups, context), and checkbox/group management components.
- [x] Verify model and component callbacks with node --test.

### Task 2: Integrate with Settings and builders
Files: src/App.jsx, tests/relief-applicability-integration.test.js.
- [x] Add failing integration tests for normalization/snapshots, Settings create/edit, hydration and builder context save/reopen.
- [x] Add groups cloud state, Filter groups subtab, row editor and preview filters; route add-row controls into the full form.
- [x] Persist context in issue/relief/template payloads and filter only rendering/selection paths; show retained excluded selections for review.
- [x] Run targeted tests, repository suite and production build. Review complete branch before handoff.

## Verification and decisions
- Independent review completed. Fixed excluded-option deletion when unchecking a filtered ancestor; regression failed first, then passed.
- Reused matching IDs across recursive renders and built the row index once per match. A 1,000-row synthetic tree matches in about 1.7 ms per pass.
- Excluded issues and options are both disclosed. The explicit removal button removes option selections only; issue inclusion continues to use the existing tree workflow. This avoids silently changing existing descendant-expansion semantics.
- Legacy snapshots without applicability inherit matching master-row rules when opened. Explicit snapshot rules remain unchanged.
- 25 targeted tests pass, including the existing template opening tests. Full suite: 568 passed, 3 failed. All three failures reproduced on unchanged main: appeals-content catalog coverage, appeals-render date label, formspree-render fee-agreement label.
- Production build passes. Browser visual QA was not run; real Settings JSX, React checkbox/management callbacks, and persistence functions were exercised by automated tests.
- New rows use the full Settings form rather than the former name-only prompt so applicability can be selected before saving. Shared groups are cloud-backed through the existing persistence path.
