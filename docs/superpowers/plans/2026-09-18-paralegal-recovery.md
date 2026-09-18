# Paralegal Need to Set Recovery Plan

## Approved design
The user approved Paralegal v0.1 focused on Need to Set: explain saved task status, identify next steps, and prepare actions for human review. The visual workflow and eventual voice interface must share the same underlying operations. Do not deploy to production as part of this isolated recovery patch.

## Verified starting point
On 2026-09-18 the feature branch was at b91716f73d21d5fd70ee93b168266c950a68b462. Its only change from 0aa8c94637a9b3a6319c46dd1a7b8eec09c7d051 was .github/workflows/paralegal-preview-check.yml. The proposed src/paralegal/need-to-set-controller.mjs was absent. Previous attempted writes are not completed work.

## This checkpoint
Build and verify a provider-neutral controller and its tests. This is a backend foundation, NOT a working chat interface or deployed agent. No live client records, email, calendar, database schema, or production branch changes are authorized by this patch.

- [ ] Create tests/paralegal-controller.test.mjs. Exercise current task reads, authenticated scope, exact IDs, draft-only reviews, account changes, changed records, expired reviews, and failed persistence.
- [ ] Run node --test tests/paralegal-controller.test.mjs and capture the expected missing-implementation failure.
- [ ] Create src/paralegal/need-to-set-controller.mjs. Export createNeedToSetController({getSession,readTasks,composeEmail,reviews,now}) and PARALEGAL_TOOLS. Required adapters: getSession() -> {ownerId,ready}; readTasks(ownerId) -> authorized task array; composeEmail(ownerId,task,instruction) -> {to,subject,body}; reviews.save(ownerId,record) and reviews.load(ownerId,id).
- [ ] Run node --test tests/paralegal-controller.test.mjs until all behavioral tests pass. Keep synthetic fixtures only. No sender or workflow-mutation tool is allowed.
- [ ] Commit the controller and tests on this feature branch. Re-read each saved file and verify its content hash.
- [ ] Update the isolated workflow to require these tests, then inspect the resulting run. Record exactly which checks ran.

## Work after this checkpoint
Connect the controller to the existing cloud store and Need to Set functions; add authenticated model orchestration and a mobile-friendly conversation/review UI; verify an isolated preview; then obtain approval for production deployment. Voice, automated reply monitoring, actual sends, calendar writes, and computer control are not implemented by this checkpoint.
