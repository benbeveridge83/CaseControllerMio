# CPS Navigator

Staff resource at `#cps_navigator`, beside DFPS / CPS Appeals. The Vite mount registers the page, sidebar entry, and lazy route using both `canOpenPage` and `isFirmStaffMember`. Existing resources are unchanged.

`src/cps/cps-navigator.html` contains the approved process outline: 14 stages, eight service topics, attorney/parent perspectives, search, rights index, linked authority shelf, and stage printing. The trusted bundled document is embedded with `srcDoc` so its styles and SVG IDs cannot collide with the app. No remote content or case data is inserted. It intentionally retains access to scripts, source popups, and its own print document. If future work introduces untrusted content, revisit this trust boundary.

`src/cps/CPSNavigator.jsx` owns the iframe and route-specific body class; unmount removes both. `src/cps/cps-navigator.css` adapts the actual app sidebar/main shell on phones. The original simulated sidebar was removed. Legal content and the October 29, 2026 research date were retained, while design-preview labels were changed to research-outline labels. Detailed service case law and procedural templates remain planned.

## Verification — October 31, 2026

- `node --test tests/cps-navigator.test.js`: 3 passed. Staff/permission denial, existing-route preservation, stage transitions, parent guidance, service/rights/source paths, safe search, and print handler are covered.
- `npm run build`: passed, including Mio's browser syntax build check.
- `node --test tests/*.test.js`: 596 passed, 3 failed. All three reproduce on unchanged base `4a9eb2c`:
  - `appeals-content.test.js`: “research catalog covers every section with complete, uniquely identified issue guides” — existing `supp-icwa-concurrent-findings: appellant` assertion.
  - `appeals-render.test.js`: “resource opens with navigable sections, both perspectives, and current-law guidance” — stale October 29 date expectation.
  - `formspree-render.test.js`: “real React components render contact details, row controls, engagement options and retainer default” — stale “Send fee agreement for e-signature” expectation.
- Independent code review: no blocking or minor findings.
- Browser QA of the built real wrapper/resource in a local Mio-layout fixture: desktop visual inspection, 390px phone shell, parent/service controls, working mobile navigation, no outer horizontal overflow, and body-class/iframe cleanup. Print action was exercised without application errors; physical/PDF print output was not captured.
- Production browser is signed out. No authenticated production data was accessed or changed during verification.

## Publishing

Use the existing `benbeveridge83/CaseControllerMio` Git integration with Vercel project `case-controller-mio`. This change has no backend or migration requirements. Revert its integration commit to roll back.
