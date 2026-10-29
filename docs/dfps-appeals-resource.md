# DFPS / CPS Appeals resource

## Where it lives

The staff sidebar entry is **DFPS / CPS Appeals**, at `#dfps_appeals`. Individual issues can be opened with `#dfps_appeals?issue=<stable-id>`. `mio-dfps-appeals-mount.js` follows Mio's existing Vite mount-plugin pattern and checks every insertion anchor. The page is lazy-loaded and guarded by both page access and the existing firm-staff check.

The catalog is separate from the interface:

- `src/appeals/data/procedure.js`: jurisdiction, deadlines, petition/service, findings, and records.
- `src/appeals/data/merits.js`: sufficiency, predicates, best interest, special statutory routes, and conservatorship.
- `src/appeals/data/trialBrief.js`: evidence, trial procedure, counsel, briefs, harm, and remedies.
- `src/appeals/appealsSections.js`: section/group navigation and research date.

## Catalog snapshot — October 29, 2026

The initial catalog contains **150 issue guides in 16 sections**, with **401 authority references across 136 source URLs**. Ninety-one source URLs contain judicial opinions; a URL count is not a claim that each is a different decision. All guides have governing authority, and 112 include at least one judicial decision. Rule/statute-only entries identify the lack of a verified directly on-point decision where relevant.

| Research stage | Guides |
| --- | ---: |
| Jurisdiction, deadlines, and pleadings | 33 |
| Findings, order, and appellate record | 20 |
| Trial procedure, evidence, and counsel | 35 |
| Sufficiency, predicates, best interest, special routes, and conservatorship | 51 |
| Briefing, harm, and remedies | 11 |

Independent legal review specifically checked the 2023/2025 statutory transitions, current rule triggers, the 2026 J.D.H./C.S./K.N./H.S. decisions, and separate conservatorship relief. Review corrections include §161.101(a)'s statutory-language pleading permission, the Horrocks motion-for-new-trial limitation on rendition, the additional-party notice deadline, and two substantive ICWA guides. This review was not a comprehensive citator check.

## Entry requirements

Each stable issue ID includes a category/subcategory, title, summary, governing rule, appellant arguments, appellee responses, preservation, standard of review, record checklist, potential relief, qualifications, tags, and sources. Every source identifies its type, citation, direct URL, and the particular proposition supported. A general procedural case is not presented as a termination-specific holding. Where no directly on-point decision was verified, that gap is stated.

When adding or updating law, read the primary source and its transition provisions. Do not silently replace former statutory letters. In particular, distinguish H.B. 116's pending-trial-court transition from H.B. 1151's filing-date transition. Keep statutory findings in the judgment separate from Rule 296–299a findings and from sufficiency of the underlying proof. Preserve bench/jury differences and the distinction between correctable omissions and reversible harm.

This is a researched issue map, not an automated citator or deadline calculator. The research date identifies the source review, not a guarantee against later decisions or amendments.

## Saved issues and privacy

Bookmarks contain only valid catalog issue IDs and use a per-user browser-storage key. They are not tied to a matter and are not a completed-review checklist. If browser storage is unavailable, the interface states that bookmarks last only for the visit. The parent keys the component by authenticated user ID, preventing another account from inheriting component state. No new database table, API, or client-record access is involved.

## Verification

Run the project's existing unit suite with `node --test tests/*.test.js` and the build with `npm run build`. New tests cover search, catalog integrity/version coverage, safe saved-state parsing, rendered navigation, and mount guards.

`tests/appeals-browser.mjs` uses the local fixture and verifies navigation, citation search, perspective changes, bookmarks, reload/deep links, print output, no-result handling, and narrow-screen layout. Start Vite on port 4173 first.

`tests/appeals-integration-browser.mjs` verifies the built app at port 4174, including the real sidebar, lazy route, mobile shell, and denial of the staff resource to an outside synthetic account. All external requests are intercepted. Set `APPEALS_CHROME_PATH` if a test-browser executable is already installed; the scripts otherwise use Playwright's default browser. They create evidence under ignored `test-results/`.

### Verified results

- Final catalog/model/mount/render tests passed.
- Targeted ESLint passed for the new source, mount plugin, unit tests, and fixture.
- Production build passed; the appeals resource is a separate lazy-loaded chunk. Existing main-bundle size warnings remain.
- Fixture browser checks passed with all 150 guides, no browser errors, and blocked external traffic.
- Built-app integration checks passed at desktop and 390px widths, including actual sidebar navigation, print styling, leaving the route, and the outside-account guard. Synthetic auth and request interception prevented real external writes.
- Full existing test suite: **544 passed / 545 total**. The sole failure is the pre-existing Formspree render assertion for “Send fee agreement for e-signature,” confirmed before feature integration. No Formspree/PNC implementation was changed.

## Deployment

The implementation is prepared for review on a feature branch. The user's earlier Mio instruction requires separate approval before production merge/deployment.
