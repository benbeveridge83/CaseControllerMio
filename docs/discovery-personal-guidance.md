# Personal discovery guidance, chat, and Word placement

Extend the existing walkthrough so Ben can save his preferred objection and privilege examples, teach recognition and response style, ask follow-up discovery questions, learn what each authority supports, and add his own Word language even when AI identifies no objection.

## Design

- Add **My rules & examples** and **Discovery chat** tabs. Store the personal profile and recent chat in Mio's existing authenticated, per-user cloud store; require acknowledged saves and preserve edits on failure. No schema migration or new external service.
- A profile has general style instructions and enabled/disabled examples: discovery type, title, example request, preferred objection, preferred privilege, recognition guidance, response guidance, and optional linked authority IDs. Saved rules guide analysis and chat, without becoming verified law or permission to invent facts/citations.
- Add a visible, paraphrased proposition beside every authority, including exact discovery-level qualifications for numeric limits. AI returns only registry IDs for supporting citations.
- Separate AI privilege text/authority from ordinary objection text/authority. Every request has manual **Add privilege** and **Add objection** controls before or after analysis. User edits are not overwritten by AI; context/rule changes discard only unedited AI drafts.
- Objections go between the request and response. Privileges default to **before the request**, following the user's literal placement instruction; offer **after request, before objection** as an explicit option. Show the selected order before download. Each privilege label identifies its request. Preserve original request/response text, tables, headers, and signatures. Safely split simple inline request/response paragraphs, rejecting complex unsupported splits.
- Add a five-stop drafting-threshold slider, from every supportable ground to strongest grounds only, with server-enforced minimum qualitative scores (1, 25, 50, 70, 85). Each objection and privilege has an independently editable 0–100 strength slider. Scores are qualitative, not probabilities or guaranteed court outcomes. User-entered annotations remain available at every setting.
- Keep request documents in memory. Save only user-authored reusable guidance and recent chat to the user's account. Chat uses the selected rule regime, discovery level, case context, and enabled guidance; it does not silently send the entire uploaded document.

## Implementation plan

1. **Model/storage:** `src/discovery/personal.js`, `drafts.js`, `model.js`; tests for profile bounds, active-rule filtering, account/save failures, authority summaries, preservation of manual overrides, and explicit annotation selection.
2. **AI:** `lib/discovery-objections.js`, `lib/discovery-objections-handler.js`; extend the strict analysis schema with privilege fields and applicable personal-rule IDs; add grounded follow-up chat. Test unsupported citations, incomplete results, oversized history and style instructions reaching both actions.
3. **Word:** `src/discovery/documents.js`; selected privileges and objections, selectable privilege placement, before-response insertion, safe inline splitting and unchanged package parts. Update old placement tests and add new real OOXML round trips.
4. **UI:** split authority, personal rules, chat and per-request editing into focused components. Connect saved settings, manual annotations, clear errors, source summaries and Word-order preview. Browser-test rule saving/reload, chat follow-ups, no-objection manual additions, selection, output ordering and mobile layout.
5. **Review/publish:** independent whole-change review, targeted regression fixes, production build and existing relevant tests; publish through GitHub to Vercel and verify deployed assets/authenticated endpoint protection. Live AI remains dependent on an authorized signed-in session and existing server credentials.

## Review focus

- A failed or conflicting save never appears saved or erases the editor; account changes cannot save to another user.
- A manual objection/privilege survives later AI analysis and is exportable despite a proper/no-objection assessment.
- Custom examples are unverified drafting guidance; unknown authority IDs and invented case citations must fail validation.
- Inline Word paragraphs, table cells, and request-only sets put selected annotations at the requested boundaries without deleting response text.
- Chat failures preserve the user's question and history; replies cannot be attributed to a changed regime/context or account.

## Verification record

Model/storage: complete. Four focused profile, save acknowledgement, manual-override and citation tests passed after initial RED.

AI: complete. Ten analysis/chat tests passed, including threshold enforcement, separate privilege authority/strength, unknown rule rejection and grounded history validation. New chat/threshold tests initially failed before implementation.

Word: complete. Nineteen OOXML tests passed. Changed placement and new inline/privilege cases failed before the exporter implementation. Existing package-part, table, numbering, footer and stale-anchor tests remain green.

UI: integrated browser check passed against the real production build with synthetic authenticated API responses. Verified saved guidance reload, chat retry and follow-up history, manual language on proper requests, score sliders, threshold invalidation, both Word orders, unchanged original responses and mobile width. No browser page errors. Independent review complete. All four Important findings were fixed in one pass and covered by regression tests; no deferred findings.

Build: passed. Focused unit tests: 37/37. Full suite: 490/491; only the pre-existing fee-agreement-label assertion failed. Exported Word rendered to one clean page for visual inspection.

Design decision: “sure to be sustained” is presented as the strongest available threshold, without promising a judicial result. Broad mode searches every request but does not fabricate a ground. Privilege placement is selectable to accommodate the user's explicit before-request instruction and the alternate after-request reading.

Existing baseline: dc9ab95; the unrelated fee-agreement-label assertion in tests/formspree-render.test.js failed on unchanged main in the previous task.


## Independent review and fixes

- Unsupported citations in AI reasons, response guidance, facts, withholding and strength explanations: expanded validation across all displayed fields, with reporter/non-adversarial case patterns and known-rule checks that understand curated pinpoint ranges. Regression tests RED→GREEN.
- Concurrent chat conversations entering generic independent-record merging: save a versioned conversation object so divergent histories retain strict conflicts. Regression reproduces the old invalid merge and passes with the envelope.
- Failed profile saves appearing acknowledged after remount: separate confirmed AI guidance from recoverable pending editor values; show pending status and keep Save available. Chat also restores its unsaved notice. Unit and real-app browser regressions pass.
- Guidance save racing analysis/chat: shared workspace lock while acknowledgement is pending. Delayed-write browser regression failed before the fix, passed after it, and verifies both AI surfaces are disabled.

Final browser run additionally verified failed personal/chat saves remain visible and recoverable after leaving/reopening the walkthrough. All test inputs and accounts were synthetic. Production AI replies and live account switching were not exercised because the available live browser was signed out. Current legal sources were researched when building the walkthrough; source validation does not replace substantive attorney review or a citator check.
