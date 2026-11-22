# Client Portal Implementation Plan
Approved scope: docs/superpowers/specs/2026-11-22-client-portal-design.md

1. Server-only credentials, grants, one-use tokens, sessions and rate limits. Use Node scrypt and HttpOnly Secure cookies; test identity, revocation and expired tokens.
2. Scoped API: staff invitations from office@beveridgelawfirm.com, registration/login/reset, assignments, existing BoldSign signing/downloads, issued invoices/PDFs/LawPay current-balance links.
3. Staff navigation and matter-dashboard entry points; explicit intake assignment; client Intake and Payments screens.
4. Test/build, review, additive migration validation, feature-branch PR. Do not send rollout invitations or claim production success without verification.

Ruling: dedicated server-owned portal credentials replace shared Supabase Auth because legacy authenticated RLS permits access to unrelated firm records. New portal accounts are reused across their explicitly authorized matters; legacy Enforcement login remains separate.
Workspace interruption: local workspace became unavailable during implementation. Local tests had 12 passing cases and one completed build before the last edits. Recover source through GitHub; rerun all checks in CI before completion.
