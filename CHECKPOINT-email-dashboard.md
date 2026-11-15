# Email dashboard — checkpoint

## Recovery
The prior email-dashboard implementation (11/14 ChatGPT session) was **not
recoverable**. No branch, commit, stash, dangling object, worktree, checkpoint
file, or local session contains it — it exists only in the unavailable ChatGPT
workspace. The feature was reimplemented on top of `origin/main`.

## Where it lives
- Branch: `feature/email-dashboard`
- Feature commit: `8d3833e5672f689a1c5066ed88c43ef0ff39224e`
- Base: `77b2a15` (`origin/main`)

## Changed files
- `api/email/dashboard.js` — one serverless function, actions via `?action=`
- `lib/email/categories.js` `matching.js` `folders.js` `resolution.js` — pure, shared
- `lib/email/classify.js` — OpenAI Responses API (`OPENAI_API_KEY`)
- `lib/email/tokenStore.js` — multi-mailbox tokens (Supabase service role)
- `lib/email/graphMail.js` — Graph mail / calendar / OneDrive helpers
- `src/email/EmailDashboard.jsx` `emailClient.js` `emailDashboard.css`
- `mio-v331-email-dashboard.js` — Vite mount plugin
- `vite.config.js` — registered `emailDashboardMount()`
- `supabase/migrations/20261115000000_email_dashboard_v1.sql`
- `tests/email-dashboard.test.js`

## Checks and outcomes
- `node --test tests/email-dashboard.test.js` → **7 pass, 0 fail**
- `npm run build` → **success** (EmailDashboard chunk code-split, 15.8 kB)
- `node --test tests/*.test.js` → **613 tests, 610 pass, 3 fail**. The 3 failures
  (`appeals-content`, `appeals-render`, `formspree-render`) are **pre-existing**:
  they fail identically on clean `origin/main` (`77b2a15`).

## Deployment fix (12-function limit)
The first production deploy was rejected: "No more than 12 Serverless Functions
can be added to a Deployment on the Hobby plan." Fixed by consolidating the API
into 11 functions while preserving every original URL via `vercel.json` rewrites:

- `api/clio.js` — dispatches the 6 old `/api/clio/*` handlers (moved to `lib/clio/handlers/`)
- `api/microsoft.js` — dispatches `/api/microsoft/callback|oauth-start|status`
  (`/api/microsoft/sync` stays its own function so the cron is untouched)
- `api/paralegal.js` — dispatches `/api/paralegal` + `calendar-actions` + `email-actions`

Commit: `a177ae77449aa7c3aa02381af7bbe84aaecd8962`

## Deployment (verified live)
- Production deployment **READY**, commit `a177ae7` on `main` (matches the push).
- Live `https://case-controller-mio.vercel.app` serves the new build
  (`index-DFzcKrcp.js`), the EmailDashboard chunk returns HTTP 200.
- Old URLs verified: `/api/microsoft/status` → 401, `/api/microsoft/callback` → 307
  redirect, `/api/clio/matters` → 401, `/api/paralegal` → 405, `/api/paralegal/email-actions` → 405
  (all route correctly; none return "unknown action").

## Remaining blockers (require Ben)
1. Apply migration `supabase/migrations/20261115000000_email_dashboard_v1.sql`
   (`supabase db push`). Until then the folder/resolution tables do not exist.
2. Server env vars (Vercel): `OPENAI_API_KEY`, `MICROSOFT_CLIENT_ID`,
   `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT`, `MICROSOFT_OAUTH_STATE_SECRET`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `EMAIL_REDIRECT_URI`
   (default `https://case-controller-mio.vercel.app/api/email/dashboard?action=connect_callback`).
   Add that redirect URI to the Azure AD app registration.
3. Signed-in verification of the live dashboard (connect mailboxes, folders,
   By Matter, multi-category resolution, calendar/OneDrive context) requires
   Ben's Microsoft session.
