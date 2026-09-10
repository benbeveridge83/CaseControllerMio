# Processes Implementation Plan

> For agentic workers: execute with superpowers:executing-plans, test-driven development, and verification before completion.

**Goal:** Deliver the standalone drag-and-drop process designer and matter-specific process runner approved by Ben.
**Architecture:** Separate block catalog/pure transition model, owner-scoped Supabase repository, visual React workspace, and guarded adapters into existing Mio actions. Preserve existing screens/history; expose the Withdrawal definition as a reusable starter.
**Tech Stack:** Existing React/Vite, native pointer/drag events and SVG edges, Supabase PostgreSQL, Node test runner and Playwright. No new runtime dependency.
**Spec:** docs/superpowers/specs/2026-09-10-process-builder-design.md

## Global constraints
- No localStorage persistence. Never execute actions just by editing templates.
- No automatic destructive conversion of Withdrawal/Orders records.
- No billing on activation or mere provider handoff. Unique run/block billing keys.
- Approvals default on for external effects; uncertain sends are not silently retried.
- Existing Workflow saved-view page remains available.

## Task 1 - Model and block catalog
Files: src/processes/model.js, tests/process-model.test.js.
Interfaces: newDefinition(name), newBlock(type,position), validateDefinition(def), createRun(def,matter,at), transition(run,event,at), attention(run,at), fromWithdrawal(def).
- [ ] Write Node tests; `assert.equal(createRun(def,matter,at).steps[first.id].status,'approval')`; finish predecessor and assert both parallel successors activate while an all-join remains blocked.
- [ ] Run `node --test tests/process-model.test.js` and observe missing model/behavior.
- [ ] Implement immutable definitions, validated DAG transitions, approval/start gates, source references, billing intents and dated history.
- [ ] Repeat tests until green, including duplicate event/complete tests and pause guards.

## Task 2 - Repository and billing transaction
Files: src/processes/repository.js, supabase/migrations/20260910230000_processes_v314.sql, tests/process-repository.test.js.
Interfaces: load(), saveDefinition(def,revision), start(def,matter), dispatch(run,event); each resolves to the persisted record, never optimistic success before save.
- [ ] Test revision conflicts and successful-event-only billing at the repository boundary.
- [ ] Add owner RLS, revision-CAS save functions, unique billing identities and append-only event transaction against mio_billing_entries.
- [ ] Verify migration schema and transaction rollback behavior without touching client work.

## Task 3 - Visual workspace
Files: src/processes/Processes.jsx, src/processes/Builder.jsx, src/processes/RunPanel.jsx, src/processes/processes.css, scripts/test-processes-browser.mjs.
- [ ] Write browser tests for palette drag/drop, move, connect, properties, save/reload, new run, approval/waiting messages and history.
- [ ] Implement click alternatives to all drag actions, SVG connectors, parallel/all/any joins, inline email drafting, block billing and notification fields, activity chain and all-blocker summaries.
- [ ] Show dirty state and explicit save failures; preserve drafts on provider errors.

## Task 4 - Integration
Files: mio-v314-processes.js, src/processes/appAdapters.inc, vite.config.js.
- [ ] Inspect actual App anchors and test every guarded replacement against the current source.
- [ ] Inject Processes navigation/route, existing state and provider callbacks. Preserve all old routes.
- [ ] Reuse drafting, e-filing, snail mail, signature, Microsoft mail and OneDrive save functions with matter validation and explicit action receipts. Opening a workspace produces a handoff only.
- [ ] Reuse Withdrawal definition without overwriting existing runs; expose entry point from Withdrawal settings.

## Task 5 - Release evidence
Files: .github/workflows/processes-v314.yml, docs/processes-v314-verification.md.
- [ ] Run model/repository/browser tests, production build, existing workflow/cloud/withdrawal/PNC regressions.
- [ ] Inspect resulting UI screenshots and fix observed errors.
- [ ] Review changes for permission, duplicate-send, duplicate-billing and retention risks.
- [ ] Merge only tested code; verify deployment status and production route. Report any remaining configuration limits explicitly.
