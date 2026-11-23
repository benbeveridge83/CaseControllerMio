# Client Portal: Intake and Payments
Date: 2026-11-22
Status: Approved; implemented on feature/client-portal-intake-payments; release validation in progress.

## Intent
Give firm staff one place to manage each matter's client portal, and give invited clients access to their fee agreement, assigned intake forms, and outstanding invoices.

## Verified current code
Examined main at a5f346e0da8135f34028887f1eaf6aba6ea10575.
- src/App.jsx has isClientPortalMember, clientMatterPermissions, clientPortalPageMatterRows, and an Enforcement-oriented outside-user experience. No general Client Portal staff page or dashboard tab was found.
- The existing internal dashboard has Fee Agreement and Finances tabs; these are staff workflows, not suitable for direct client exposure.
- lib/pnc.js supports BoldSign signature requests, reminders, verification, and signed PDF downloads. Some actions are currently limited to consultation/engagement stages.
- Secure intake uses mio_client_intake_requests and /api/client-intake. Assignment must remain an explicit staff action.
- Existing LawPay links and invoice workflows are the sources to reuse. Live configuration and database access have not yet been verified.

## Approach
Recommended: Extend the existing React/Vite app and Supabase authentication with a dedicated client portal and narrowly scoped server endpoints. Reuse current agreement, intake, invoice, and payment records.
A separate portal app would duplicate authentication and synchronization without serving the requested initial scope. Embedding the current staff dashboard would expose staff actions and data the client does not need. No new signing or payment provider is proposed.

## Staff experience
1. Add Client Portal to the main navigation page/menu. List matters with client name, email, invitation/account status, agreement status, intake status, and outstanding invoice balance. Include search, open portal, and send/resend invitation.
2. Add Client Portal to each matter's client dashboard. Show the same staff portal view scoped to that matter, including invitation controls and an explicit client-view preview.
3. Show invitation recipient and sender. Send from office@beveridgelawfirm.com through the existing authorized Microsoft connection, log success/failure and sent time, and do not claim success on an API failure. No invitations are sent automatically as part of rollout.
4. Provide assignment controls for intake forms. Portal invitation alone does not assign or send a form.

## Client account
Invitation goes to the client email on the matter. That email is the username; clients choose a password after following a secure expiring invitation link. Existing accounts sign in without creating duplicates or resetting their password. Provide sign-in, sign-out, and password recovery. Bind access to verified account identity and explicit matter grants, not a client-supplied email or matter ID.
Proposed default: one account can access multiple explicitly authorized matters through a matter selector. An invitation grants only the selected matter. Staff may resend/revoke invitations and revoke portal access.

## Client Intake section
- Fee agreement: show existing signed status and allow downloading the signed PDF; otherwise provide access to the matter's prepared signing request using BoldSign. Do not generate a duplicate agreement when one already exists.
- If no agreement is prepared, show that it is awaiting the firm; portal registration does not create a signature request.
- Intake forms: list only forms explicitly assigned/sent by staff, showing pending/submitted status and the existing response workflow. Do not expose template catalogs or unrelated assignments.
- Signed agreements must remain downloadable after conversion to an active client; existing stage restrictions must not hide signed documents.
Proposed default: use BoldSign's supported secure signing experience rather than a second signature system.

## Client Payments section
Always available, independent of intake assignment or completion. Automatically list issued outstanding invoices for the authorized matter with invoice number, date, total, applied payments, remaining balance, and view/download/pay actions. Exclude drafts, void invoices, and unbilled work.
Reuse invoice documents and LawPay payment requests tied to the invoice. Pay the current remaining balance. Show pending payments distinctly; use existing confirmed payment reconciliation to update balances and avoid duplicate posting. A browser return from LawPay is not payment confirmation.
Proposed default: retain paid issued invoices in a downloadable history.

## Authorization and boundaries
Client endpoints return only the client's published portal data. Enforce access in backend/database rules, including document downloads, intake answers, agreements, invoices, and payment link creation. Never grant clients firm/staff privileges or reuse staff financial management controls. Missing/expired/revoked grants deny access.
Scope excludes new document exchange, discovery tools, messaging, and the separate public enforcement self-service product.

## Validation and delivery
Verify invitation creation, resend, expiration, redemption and account reuse; both staff entry points; staff-assigned intake visibility; signing and signed downloads for active matters; invoice view/download/pay with partial and pending payments; and denial of access to another matter. Use test identities and provider test facilities where available. Verify existing Enforcement access remains available.
Implementation will require auth/schema changes and Microsoft, BoldSign and LawPay integration checks. Report any configuration blocker specifically. Do not describe the feature as live until deployment and end-to-end verification succeed.

## Approval
User approved the written scope on November 22, 2026 and instructed continued implementation.
