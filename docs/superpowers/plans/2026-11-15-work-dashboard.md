# Compact work dashboard implementation plan

Goal: deliver the approved wide dashboard with compact billing on the top left,
10 scrollable trust matters on the top right, daily workflow, three matter queues,
five email queues, and a full-width calendar / matter timeline / checklist panel.

Architecture: a Vite mount bridge connects a separate React dashboard to existing
App state and native detail renderers. Billing uses the existing persisted ledger;
green rows derive from saved task-specific entries, never from opening a window.
Mail comes from the existing email dashboard API and selected mailbox folders.

1. Add tested pure selectors for local dates, weekly allocation, task billing identity,
   task-specific mail and conversation inheritance. Test duplicate mail IDs across
   mailboxes, ambiguous matter contacts, unrelated events, and midnight rollover.
2. Build the compact dashboard component and bridge. Reuse native setting details,
   focused orders, matter service workspace, native time entry and daily workflow.
   Keep per-task green status persistent through saved billing and limited to today.
3. Add shared email categories/cache and readonly conversation retrieval. Show a
   quiet envelope for existing threads, prominent unread count for unreviewed mail;
   open all related messages in a window without automatically sending mail.
4. Run targeted, UI, transformed-build and full regression checks. Review the final
   branch, publish to the existing Mio repository and verify the production build.

Constraints: staff-only route; preserve existing page permissions; no pooled trust,
pending deposits or expenses counted as earned time; no secrets in client code;
no fake financial data or records; preserve current email folder selections.

Progress: baseline targeted checks 26/26 passed. Fresh clone and isolated feature
branch created from main 2e470de. Existing email API uses Settings/Orders/General;
the service/draft categories are extensions, not a second classification system.

Completed implementation: native matter-specific settings/orders/service details;
native time entry with form-scoped row identity and confirmed cloud-save markers;
today/week financial summaries with one trust allocation per matter per period;
five email queues and task envelopes using shared, user/mailbox-scoped categories;
existing native thread inheritance, unread review and complete conversation paging;
native planning toggles; daily workflow; 10-at-a-time sorted trust list.

Additional user instruction implemented: compact Withdrawals box at top left,
using the native withdrawal snapshot and current next-action/status labels.
Click opens that matter in the existing withdrawal workflow.

Independent review corrections: close full-queue overlay before opening a task;
refresh parent date at midnight; bind billing origin to each form rather than a
stale global ref; require successful invoice/billing refresh for ready finances;
match against all authorized matters enriched with native counsel contacts;
ignore empty compose placeholders; retain native mailbox/unread semantics;
deduplicate linked unread counts; follow conversation pages; reject stale thread
responses. These fixes were checked with model, native-adapter and React DOM tests.

Validation: production build successful. Focused checks 37 passed / 0 failed.
Full regression suite: 625 checks, 622 passed, same 3 baseline failures in
appeals-content, appeals-render and formspree-render. No appeal or Formspree files
were changed. Billing and mail schemas verified on the linked Mio database;
no schema migration needed. Browser engine could not launch under this workspace's
socket restrictions, so interactive checks used React + jsdom instead. Signed-in
production mailbox verification requires the user's session and was not simulated.
