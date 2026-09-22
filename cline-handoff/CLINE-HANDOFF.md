# Cline handoff: Case Controller Mio process builder v1

Repository: `benbeveridge83/CaseControllerMio`

Base commit: `920d003340db7d9ebc213d928d12f3a78d2084dd`

Completed implementation commit: `22c9de7`

## What to do

1. Open the current CaseControllerMio repository and fetch the latest `main`.
2. Create a new branch named `feature/process-builder-v1-20260921`.
3. Apply the three numbered patch files in order with `git am`.
4. If `main` has moved since base commit `920d003`, resolve conflicts without discarding newer changes. The only existing application file changed is `src/App.jsx`; that change adds an import, a Settings tab button, and the process-builder panel.
5. Run the verification commands below.
6. Review the feature in the browser under **Settings → Process Builder**.
7. Commit any conflict-resolution changes, push the branch, open a pull request, merge it after checks pass, and verify the Vercel production deployment.

## Verification

```bash
npm ci --ignore-scripts
node --test tests/*.test.js
npx eslint lib/process src/process tests/process-*.test.js
npm run build
```

The prior verified result was 291 passing tests, successful lint, successful production build, and a passing browser fixture test. The optional browser test is:

```bash
CHROMIUM_PATH=/path/to/chromium node tests/process-builder-browser.mjs
```

## Scope already implemented

- Reusable visual blocks: Email, Calendar, Draft, E-file/E-serve, and Save File.
- Block activation, inputs, outputs, completion conditions, status messages, and billing settings.
- Email fields for From, To, CC, subject, body, merge tokens, attachments, review, and wait states.
- Drafting template selection and mappings.
- Calendar availability configuration.
- E-file/e-serve configuration.
- Save destination and naming configuration.
- Dragging, connecting, validation, persistence, duplication, and simulation.
- Settings integration using Mio's existing cloud store.

## Important limitation

This is the approved first milestone: a functional builder/configuration UI with simulation. It does not yet execute live email, calendar, drafting, OneDrive, e-filing, e-service, or billing actions, and it does not yet create custom live navigation pages. Keep the existing in-app milestone notice accurate.

Read `process-builder-release.md` and `process-builder-progress.md` before making changes.
