# Drafting and withdrawal rollout

## Release order

1. Drafting components (V278): populated editable previews; per-file instance overrides; explicit shared-default editing; case-type/style defaults and reset; shared inline/global settings; reviewable field suggestions.
2. Withdrawal workspace (V279): action-first dashboard, separate action and withdrawal-entry clocks, parallel agreed/hearing routes, evidence and approval gates, module handoffs and audit history.

The production branch must not receive V279 before the additive migration in `supabase/migrations/20260905160000_withdrawal_workflows_v1.sql` has been reviewed and applied. The connected tool blocked the attempted database migration on September 5, 2026. No workaround was used. New database tables were not confirmed created, and no client workflow data was migrated.

## Existing matters

The older graph and checklist are preserved. Initialize a workflow and confirm its actual current progress. An unavailable historical withdrawal-entry date remains Unknown until the attorney records the date and its source. A checked legacy checklist alone is not proof of filing, service, a court signature, or client delivery.

## What module synchronization means

Saved drafting documents request review. A submitted filing is not clerk acceptance. A successful Outlook send request is not delivery confirmation. New messages in linked conversations request review when synchronized. Refreshing the page alone is not an always-on court, signature, or email monitoring service. The existing Outlook connection and eFile helper remain required for their respective operations.

The final email requires a selected signed-order document and attorney-verified client-accessible HTTPS links to invoices, filings, and the complete client file. Links are not automatically made public. No outgoing email, filing, court cancellation, or matter-status change is performed by this code rollout.

## Deliberately not represented as finished automation

Automatic seven-day billing candidate discovery, external e-signature collection/webhooks, autonomous signed-order monitoring, and scheduled outbound reminders still require separate provider/workflow implementation. Current timers bring a waiting item back into Needs me; they do not independently send reminder emails. Calendar and Need to Set handoffs still require review of the actual module records and evidence.

## Verification

Domain tests cover both clocks, priority sorting, replies, overdue waiting, parallel-track attention, explicit signed-order evidence, delivery gates, stale-account protection, and write conflicts. Browser tests use only synthetic matters and intercept external requests; they do not send real mail or filings.
