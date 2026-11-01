# Paralegal Need to Set Recovery Checkpoint

## Approved design
Paralegal v0.1 starts with Need to Set: explain saved task status, identify next steps, and prepare actions for human review. The visual workflow and eventual voice interface should use the same underlying operations. Keep this development work separate from production until the integration is reviewed and approved.

## Verified starting point
On 2026-09-18 the feature branch was at b91716f73d21d5fd70ee93b168266c950a68b462. Its only change from 0aa8c94637a9b3a6319c46dd1a7b8eec09c7d051 was .github/workflows/paralegal-preview-check.yml. The proposed controller file was absent. Earlier attempted writes were not completed work.

## Completed in this checkpoint
- [x] Added tests/paralegal-controller.test.mjs and observed all 28 tests fail before the implementation existed.
- [x] Added src/paralegal/need-to-set-controller.mjs with createNeedToSetController and PARALEGAL_TOOLS.
- [x] Added three regression tests for storage key ordering, expiry during a slow save, and mutation of an asynchronous command. Observed those three tests fail, then fixed the implementation.
- [x] Ran all 31 tests locally with 31 passed, zero failed, zero skipped.
- [x] Saved the controller and both test files on feature/paralegal-need-to-set-foundation-20260917; re-read the remote files and matched all three Git blob hashes against the locally tested files.
- [x] Replaced the optional test check with mandatory controller syntax, Paralegal tests, locked dependency install, and application-build checks.
- [x] Read GitHub Actions run 35367312528, job 105672772465, at commit 9d93c2f7585eb32380b52f90a22cce24b35b3905. All 31 tests passed and npm run build succeeded.

## What this code actually does
This is a server-side tool controller, not a chat UI or a deployed agent. With trusted adapters supplied, it can list tasks, read an exact task, and prepare/reopen an email review. It rejects missing sessions, account changes, stale tasks, expired reviews, invalid drafts, unsupported commands, and failed persistence. It has no send, approve, execute, calendar-write, filing, or workflow-mutation operation. All tests use synthetic records and example.test addresses.

Required adapters:
- getSession() -> verified {ownerId, ready}. Do not take identity from model arguments.
- readTasks(ownerId) -> authorized fresh tasks with id, matterId, revision, matterName, status, step, waitingOn, nextAction, updatedAt. Descriptive fields can be absent; no status is inferred.
- composeEmail(ownerId, task, command) -> {to, subject, body}. This must be a side-effect-free draft builder, never an email sender.
- reviews.save(ownerId, record) and reviews.load(ownerId, id) -> durable server-owned account-scoped storage. No production storage adapter is installed yet.

The controller imports node:crypto and must not be mounted directly in the browser bundle. Email-address checks are syntactic; they do not establish the correct recipient. The future UI must expose the exact recipient, subject, and body for review. observedAt means retrieval time, not proof that every underlying record was recently updated.

## Verification limits and warnings
The focused controller suite and application build passed. The full pre-existing test suite, a live browser session, authentication integration, and production behavior were not exercised. No independent reviewer agent was available. npm reported 8 dependency vulnerabilities (1 low, 1 moderate, 6 high); Vite reported large-chunk and plugin-timing warnings. No dependencies were changed or automatically repaired in this checkpoint.

## Exact remaining work
1. Inspect the existing Need to Set implementation and expose its current state/actions through authorized adapters, rather than inventing a second workflow. The large src/App.jsx previously exceeded the GitHub file reader; repeated identical fetches did not help. The local runtime also could not resolve raw.githubusercontent.com. A checkout/source artifact through GitHub Actions and download_workflow_artifact is a supported next inspection route, but has not been created by this checkpoint.
2. Add authenticated model orchestration and durable review storage. Check existing server configuration without exposing secret values. Reuse established Mio authorization patterns.
3. Add a mobile-friendly Paralegal conversation and review panel using the same task state as the visual page; test an isolated preview with actual authorized data.
4. Add explicitly approved execution, reply monitoring, and voice in subsequent tested stages. Do not describe the current foundation as already supporting these features.
5. Review the integrated preview before any production deployment.

## Production status
All changes in this checkpoint are on the feature branch. No main-branch merge or production deployment was requested by these tool calls. No live client records, emails, calendars, or database schemas were changed. No further user requirements are needed to understand the next integration step.
