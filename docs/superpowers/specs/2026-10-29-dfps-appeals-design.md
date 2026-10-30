# DFPS / CPS Appeals resource

## Intent

Add an attorney-facing resource to Mio's left navigation for researching, bringing, and defending Texas DFPS parental-termination appeals. The user requested very detailed, easily navigable coverage of procedural and substantive issues, with supporting authorities at the smallest useful issue level.

## Design decisions

Use the existing React/Vite application and hash navigation. A lazy-loaded `dfps_appeals` page will use the existing firm-staff and page-access checks. This is a reference resource, independent of client files and matter records.

The opening view shows five research stages and sixteen sections. A section opens grouped issue summaries; selecting an issue opens a readable detail view. Search covers the complete text and authorities. Readers can switch between appellant, appellee, and both perspectives, save issue bookmarks for their account on this browser, and print the selected issue. Links point to primary statutes, rules, and judicial opinions. Research date and substantive legislative transitions are visible.

Each leaf includes: question/title, short explanation, governing rule, appellant arguments, appellee responses, preservation, standard of review, record audit, remedy, authorities with propositions, and qualifications. Missing on-point decisions are identified rather than fabricated. No automatic deadline calculation or case-specific conclusion is presented.

## Approaches considered

- One long outline: comprehensive but difficult to navigate and compare both sides.
- A graphical process alone: useful for timing, but cannot carry the requested detailed grounds and authorities.
- A searchable issue tree with progressive detail: selected implementation judgment because it supports both breadth and deep research, and fits Mio's existing navigation.

## Constraints

- Preserve the current app and its transform plugins; keep App.jsx changes narrow.
- No new runtime dependency, database migration, external write API, or client-data integration.
- Include current and former statutory labels with accurate transition rules, including H.B. 116 (2025), H.B. 1151 (2025), and the version governing section 161.001(f)/(g).
- Distinguish sufficiency from missing findings, record completion from trial error, jury from bench preservation, and a correctable defect from reversible harm.
- Production merge/deployment remains subject to the user's earlier separate-approval instruction. Complete and verify a review branch and PR first.

## Acceptance

Staff can open the new left-hand tab. A reader can navigate all sections, search a case citation or issue, read both sides and sources, bookmark without crossing user accounts, and print a self-contained issue. Mobile layout remains usable. Unit/content tests, a production build, and browser verification cover these behaviors. Independent review checks code and material research qualifications.
