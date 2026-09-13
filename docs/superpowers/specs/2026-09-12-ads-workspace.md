# Approved Mio ads workspace
User approved the full ad workspace, bulk campaign negatives, per-user column controls, and separate aggregate audience panel on September 12, 2026. AI is strictly advisory. No live ad, campaign, budget, or keyword changes may occur without the user's explicit final authorization.

The Ads pane reads RSA text, pinning, URLs, policy and serving status separately from date-filtered metrics. An illustrative preview, before/after asset review, stale-revision guard and bounded AdService update enable safe editing. Unsupported ad types remain read-only. Existing ad-group search terms are context, not individual-ad attribution. Revisions and bulk approvals are stored in Supabase, as are user column preferences. No local application-state storage is introduced.

Search Terms uses a React-owned table, supports intent/status filters and checkbox selection up to 100 visible terms. A review lists each destination campaign, negative keyword and exact/phrase match before authorization. Duplicate scope-aware negatives are skipped; only read-back-confirmed outcomes resolve rows. Uncertain writes are not retried automatically.

Audience reports are separate aggregate age, Google-reported gender, and location breakdowns for the selected campaign/ad group and dates. Unknown data is not inferred, and no individual demographics are attached to search terms. Before/after comparisons use equal complete-day periods and do not claim causality. Billing, Formspree and other pages remain unchanged.
