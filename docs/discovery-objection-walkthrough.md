# Discovery objection walkthrough

Build Ben's requested Texas discovery page inside the existing authenticated Mio app. Select RFP, RFD, Roggs or RFA; read the governing scope and allowed/prohibited requests; browse concrete examples; analyze pasted requests or Word requests/responses; review and edit each suggested objection; download a Word copy with **OBJECTION:** and the objection beneath the matching response.

## Design and implementation plan

The feature uses the existing React app, Supabase sign-in and OpenAI Responses API configuration. A curated, linked Texas authority collection supplies both the guide and AI instructions. Family-case filing-date regimes are explicit. Analysis returns a reasoned assessment, facts needed, suggested language, authority IDs and the answer/production still required. No authority is invented or supplied by an uploaded document. A request can be proper, objectionable in part, objectionable, or need more facts; a privilege claim is distinguished from an ordinary objection.

1. `src/discovery/authorities.json` and `model.js`: current rules, source provenance, category filtering and validation. Test regime selection, unsupported citations and request/result identity matching.
2. `src/discovery/documents.js`: local DOCX/text parsing, request and response boundaries, preserved OOXML export. Test repeated numbers in mixed sets, multiline answers, automatic numbering, tables, signature boundaries and bold objection placement. Preserve originals. Reject ambiguous/unsupported export mappings rather than inserting at the wrong position. Legacy binary .doc requires Save As .docx.
3. `lib/discovery-objections.js` and `lib/discovery-objections-handler.js`: authenticated, bounded analysis and optional AI extraction with strict structured output, server-owned source registry, `store:false`, timeout and clear connection errors. Follow the existing callback/rewrite integration convention without increasing the deployed function count. Tests cover authorization, malformed/partial AI results, missing credentials, citations, and allowed requests receiving no objection.
4. `src/DiscoveryObjections.jsx` and CSS: rules → examples → analyze/review flow, clear request mapping, individual selection and editable objections, import/export. Scope/type changes invalidate old results. Keep document content in this workspace's memory; downloads are user initiated. Integrate navigation and an entry button on Discovery.
5. Verify focused tests and relevant existing tests, production build, and browser flows with synthetic requests. Review code before publishing. Publish through the existing GitHub → Vercel path and check deployment evidence.

## Review focus

- Family Rule 194a is distinct from ordinary Rule 194 and older case regimes.
- Quoted instructions in requests/documents are data, never system instructions.
- Partial or duplicate AI results must not shift objections to other requests.
- Original responses, headers, tables, numbering and signatures survive DOCX export.
- A failure or stale result never appears as a completed analysis or exports an unchecked objection.

## Execution record

- Fresh isolated checkout from main `d992ef7`; feature branch `feat/discovery-objection-walkthrough`.
- Existing Mio uses React/Vite, Supabase Auth and server-only OpenAI Responses API. Preserve those conventions.
- Vercel connector denied access to existing project scope; no CLI credentials available. Continue implementation and use GitHub deployment/status evidence where available; report runtime verification limits.
- Reviewed supplied forms and current primary Texas sources: 30 request categories, 39 linked authorities, and explicit current/2021/legacy disclosure regimes. Source files and confidential document text are not published.
- Independent code review reproduced and resolved Word boundary defects. Regression coverage includes nonconsecutive questions, soft breaks/tabs, cross-references, numbered witness names, multiple pairs in one paragraph, and contradictory/omitted AI ranges.
- Focused discovery and affected server-handler tests: 33 passed. Production build passed. Browser flow passed for type/regime selection, searchable examples, four Word request/response pairs, partial-batch recovery, proper requests with no objection, unresolved-placeholder blocking, selected-only export, regime invalidation and mobile layout. No browser page errors.
- Exported synthetic Word output was rendered and visually reviewed: bold OBJECTION label below the matching original response, selected objections only, existing responses preserved.
- The initial full suite had 468 passes and one pre-existing failure in `tests/formspree-render.test.js` (old fee-agreement label). Reproduced the same failure on unchanged main `d992ef7`; no unrelated PNC changes included.
- Browser/provider boundaries were synthetic. Live authenticated AI credentials and model access still require deployment verification; the page exposes clear service errors rather than a fabricated result.
