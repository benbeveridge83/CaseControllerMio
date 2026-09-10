# Mio Processes - approved design

Ben approved extracting reusable process blocks from Withdrawal into a standalone Processes page on 2026-09-10, with drag/drop, series/parallel execution, explicit waiting messages, approvals, billing, and an Orders-style dated icon history.

## Boundaries
The Processes page owns reusable definitions and matter-specific runs. Existing Withdrawal records, Orders activities, and the legacy Workflow saved-view page are preserved. Withdrawal is available as a starter definition and its existing editor remains compatible. There is no destructive automatic conversion or re-execution of historic tasks.

## Builder
A palette contains Email, E-file, Snail Mail, Signature, Draft, Review, Save file, Wait, Calendar, Status, Approval, Notification, and Manual blocks. Drag a palette item onto a canvas; drag existing cards to arrange them. Connect output/input handles (with keyboard-accessible alternatives). Multiple outgoing edges are parallel branches. Incoming edges can require all or any predecessors. New blocks added after the selected block default to completion-triggered series. Editing layout does not change dependencies. Cycles and dangling edges are rejected.

Each block has an icon, action, input documents/folder/template/recipient configuration, start trigger, approval policy, explicit ready/approval/waiting/completed messages, and optional billing minutes/description. Process templates are versioned snapshots; edits never rewrite running work. Save durable state in Supabase, not localStorage. Add start-date/manual/event triggers without pretending a closed browser is an unattended worker.

## Running work
A matter may have multiple named process runs. The dashboard shows every active blocker, who is responsible, elapsed time, and approvals first. Completing a predecessor activates eligible successors, not necessarily permission to send a filing or message. Approval is on by default for outgoing communications, signatures, filings and status changes. Save-file and notification actions may execute without approval when explicitly configured. Email drafting is editable in the run and sends through the existing Microsoft connection. E-file, Snail Mail, drafting and signatures reuse existing integrations rather than a second provider stack.

Only successful actions create completion or action-performed events. Opening a module is a handoff, not proof of sending/filing/signing. Waiting for a response is distinct from waiting for attorney approval. Users may confirm externally completed work with a reference; automatic provider signals must be matched to their run/step before advancing. A claimed external action is never silently retried after an ambiguous failure.

## Billing and history
Optional billing is configured per block (minutes and description; disabled until configured), recorded only on a successful action/completion, never on activation or opening an editor. A unique run/block billing identity and a database transaction prevent repeated clicks, replies or refresh from billing twice. Actual billing rows use existing Mio billing storage and rates. Dates are local calendar dates. Each history item has block icon, event label, exact timestamp, actor/reference, billing amount/time where applicable. History is separate from the planned flow and is append-only.

## Persistence and safety
Owner-scoped RLS on definitions and runs. Optimistic revision checks and action claims prevent lost updates and double sends across tabs. Durable events and billing write atomically. Validate documents belong to the selected matter before sending/saving. Do not enable scheduled unattended sending, migrate old work, or send test communications to real clients during verification.

## Verification
Pure-model tests cover series, parallel joins, manual/date/event triggers, approval gates, blocked inputs, immutable snapshots, pause, completed-event idempotency, billing dedupe, and history ordering. Browser tests cover palette drop, node drag, connectors, block properties, save/reload, run creation, waiting summaries, draft email editing and dated icon history using synthetic data. Build plus existing Withdrawal/cloud/billing regressions must pass before release. Verify production deployment separately from source commit.
