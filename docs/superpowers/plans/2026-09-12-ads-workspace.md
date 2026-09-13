# Ads workspace implementation plan
**Goal:** ship the approved workflow while retaining mandatory human authorization.
**Architecture:** isolated worktree; bounded API handler using existing credentials; tested domain/service modules; native React panes installed with fail-closed Vite anchors; RLS-protected Supabase tables.
**Spec:** docs/superpowers/specs/2026-09-12-ads-workspace.md

1. Test and implement lib/ads/model.js: RSA bounds, pins, URLs, negative scope/match dedupe, metrics, columns. Run `node --test tests/ads-workspace-model.test.js` before and after implementation.
2. Test and implement lib/ads/service.js, transport.js, http.js and api/ads-workspace.js: validation-before-write, stale revision, exact request idempotency, per-item results and fresh read-back; immutable input snapshots and advisory-only AI. Run `node --test tests/ads-workspace-service.test.js`.
3. Apply and verify supabase/migrations/20260913010000_ads_workspace.sql: own-user preferences, staff-readable histories, no anonymous permissions, status/result-only own updates.
4. Build src/ads components: table, batch review, editor, audience and history. Remove the old imperative DOM enhancer mount. Add checked mio-v317-ads-workspace.js transform after V315, leaving unrelated panes intact.
5. Run offline browser tests on actual compiled components with synthetic data; validate checkbox/approval reset, scope, filtering, columns, read-only AI, mobile layout and no console errors. Run integration and baseline Google/Formspree tests and full production build.
6. Persist reviewed code to a feature branch; run GitHub CI; inspect changed-file list; fast-forward main only on passing tests; confirm Vercel deployment. Never publish test changes to the actual Google Ads account.

Local verification completed: 40 selected tests passed; offline Chromium interaction tests passed; production build succeeded. Hosted CI must repeat these checks on the exact committed content before integration. Authenticated live-account rendering still requires a user session; no ad was mutated to test the feature.
