# CPS Navigator Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the approved integration.

**Goal:** Publish the approved CPS Navigator as a working Mio tab.

**Architecture:** A guarded Vite mount registers the staff sidebar and route. A lazy React wrapper embeds the trusted static resource, with route-scoped mobile shell CSS and cleanup.

**Tech Stack:** Existing React 19, Vite 8, node:test, jsdom.

**Spec:** docs/superpowers/specs/2026-10-31-cps-navigator.md

## Global Constraints
- Preserve the approved content and planned-research labels.
- No backend, dependency, or existing resource changes.
- Publish to the existing Mio Git/Vercel production project.

## Review Focus
- Outside accounts must not render the tab or route.
- Modified link clicks must retain native browser behavior.
- Small screens must retain working app navigation and resource access.
- Resource styles and handlers must not persist after leaving the route.
- Printing and external authority links must work from the embedded document.

### Task 1: Add and verify the resource
**Files:** Create src/cps/CPSNavigator.jsx, src/cps/cps-navigator.html, src/cps/cps-navigator.css, mio-cps-navigator-mount.js, tests/cps-navigator.test.js; modify vite.config.js.
**Interfaces:** applyCPSNavigatorMount(source) returns transformed App source; CPSNavigator renders a titled document iframe.
- [x] Test the missing integration, staff guards, stage/service navigation, perspectives, and search behavior.
- [x] Add the guarded route and approved resource; remove mock sidebar and adapt outline labels.
- [x] Run targeted tests and production build; compare known baseline failures separately.
- [x] Inspect desktop/mobile preview, printing, links, and route cleanup.
- [ ] Obtain final code review; commit and publish through existing Git deployment; verify live resource.

## Progress
- Fresh feature checkout from main 4a9eb2c; user explicitly approved implementation and publishing.
- Baseline: appeals mount/resource tests pass; appeals-render has an existing stale October 29 assertion against October 30 content. Leave unrelated tests/content unchanged.

- Implementation and review complete at 1df6f69. Verification details and existing failures are recorded in docs/cps-navigator.md. Local browser fixtures confirm mobile layout and cleanup; signed-in production and printed output are not part of the completed browser checks.
