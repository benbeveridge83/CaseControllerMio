# Email dashboard connection recovery — 2026-11-16

Production showed zero messages with “AI classification up to date.” Read-only checks confirmed both `mio_email_tokens` and `mio_microsoft_tokens` contain zero records. Vercel access and production Microsoft OAuth configuration are available; no new Vercel authorization is needed.

The dashboard now opens Mailbox settings when no connection exists and shows a prominent Connect Outlook action. It displays Microsoft callback errors, retains successful data when an auxiliary request fails, and provides a refresh button. Inbox is visibly selected by default, consistent with the API. Server requests renew expired access tokens, persist rotated refresh tokens, and return mailbox-specific warnings without losing readable messages from other accounts.

Validation: 16 focused email tests pass; production build passes. A React/jsdom render with mocked disconnected API responses verified the connection prompt, absence of misleading classification status, and visible recoverable sign-in errors.

Remaining user action: open https://case-controller-mio.vercel.app/#email, click Connect Outlook, and complete Microsoft sign-in as ben@beveridgelawfirm.com. Real mailbox retrieval requires that authorization; it has not been verified against live mail. Shared mailboxes also require delegated access in Microsoft 365.
