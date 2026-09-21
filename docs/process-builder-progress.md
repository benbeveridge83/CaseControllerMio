# Execution ledger — plan: docs/superpowers/plans/2026-09-21-process-builder-v1.md

Execution: native, selected by Ben. Subagent polish deferred per his instruction.

Ruling: prioritize a usable saved builder and isolated status simulator before live provider enablement, following the latest request to begin working with blocks and refine them. This is a first milestone, not completion of the entire runtime specification. Cost: live background processes remain unavailable until server authorization/worker implementation.

Ruling: use the existing revision-aware Supabase cloud-state service for draft definitions in the first milestone; no new schema is necessary to let Ben create and save processes. The eventual job/instance tables remain in the approved plan. Cost: draft list is saved as one versioned value rather than normalized rows.

Pre-flight: model fields and graph are consumed by canvas/properties and simulator; use one shared schema. Simulator has no provider imports or live action dispatch. Existing withdrawal schema remains untouched.

Pre-flight: old browser Graph tokens cannot authorize background workers. Do not publish or imply live activation in this milestone.

Progress: worktree created; first milestone implementation started.

First milestone complete locally: shared definition model, drag/keyboard canvas, connections with cycle checks, five block property panels, merge-field picker, named drafts and page metadata, existing account-storage adapter, and isolated lifecycle simulator. Settings integration changes only three App lines.

Verification: baseline 282 tests passed. Final full suite 291/291 passed; focused builder/model/simulation suite 9/9 passed; changed-file ESLint passed; production build passed (existing large-chunk/plugin-duration warnings). Browser fixture passed edits for all five types, acknowledged save/reload, email lifecycle, keyboard movement, cycle rejection, save-error retention, and 480px layout.

Ruling: no subagent review on this first milestone; Ben selected native and said subagent polish could follow. Native code review performed; cost: no independent reviewer yet.

Ruling: browser validation uses a synthetic standalone fixture with the real builder and a mock persistence boundary. The compiled Settings integration reuses the existing cloud service, whose tests pass, but no live account data was written. Cost: live sign-in/save smoke check remains a release verification step.

Outstanding from full plan: actual row/instance tables, background jobs, server Microsoft authorization, live calendar and reply integrations, document and filing execution, custom navigation pages and reviewed billing-entry linkage. These are not claimed complete. The UI explicitly labels the shipped milestone design/test only.

Release: not pushed, merged, or deployed. Awaiting review of this concrete implementation and authorization for deployment.
