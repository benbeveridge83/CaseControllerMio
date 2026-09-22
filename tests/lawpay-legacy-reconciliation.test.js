// Legacy Bulk Billing reconciliation: the dry run writes nothing, automatic linking needs the
// immutable provider identity plus consistent amount/direction/matter/account evidence, conflicts
// and unresolved cases wait for a human, and a rerun links nothing new. Synthetic fixtures only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as reconciliation from '../src/mioLawPayLegacyReconciliation.js'

const fixturePath = new URL('./fixtures/lawpay-legacy-reconciliation-synthetic.json', import.meta.url)
const fixture = () => JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const planFor = (over = {}) => reconciliation.legacyReconciliationPlan({ ...fixture(), ...over })

test('a link needs immutable provider identity plus consistent amount, direction, matter and account', () => {
  const data = fixture()
  const before = JSON.stringify(data)
  const plan = reconciliation.legacyReconciliationPlan(data)
  assert.equal(JSON.stringify(data), before, 'planning must not change the evidence it was given')
  assert.deepEqual(plan.summary, { total: 8, matched: 3, already_linked: 0, unresolved: 2, conflicting: 3 })
  assert.deepEqual(plan.matched.map((item) => item.legacy.key).sort(), [
    'legacy_attribution_record:rec-bravo',
    'legacy_attribution_record:rec-charlie',
    'legacy_trust_entry:entry-bravo',
  ])
  for (const item of plan.matched) {
    assert.equal(item.link.posts_money, false, 'a link never posts money')
    assert.equal(item.link.source, reconciliation.RECONCILIATION_LINK_SOURCE)
    assert.ok(item.evidence.includes('provider id matches'))
    assert.ok(item.canonical.classification_id)
  }
})

test('a conflicting or unresolved case is never linked automatically', () => {
  const plan = planFor()
  const conflicts = Object.fromEntries(plan.conflicting.map((item) => [item.legacy.id, item.conflicts]))
  assert.deepEqual(conflicts['rec-delta'], ['amount_mismatch'], 'a different amount is a conflict, never a link')
  assert.deepEqual(conflicts['rec-golf'], ['canonical_account_not_established'], 'an unresolved canonical account is a conflict, never a link')
  assert.deepEqual(conflicts['entry-echo'], ['multiple_canonical_classifications'], 'two canonical records for one payment need a human')
  const reasons = plan.unresolved.map((item) => item.reason).join(' ')
  assert.match(reasons, /no immutable LawPay provider id/)
  assert.match(reasons, /holds no classification/)
  assert.deepEqual(plan.posting_actions, [], 'the plan holds no money movement at all')
})

test('the dry run writes nothing and never calls the link writer', async () => {
  const plan = planFor()
  const result = await reconciliation.applyLegacyReconciliation({ plan, link: () => { throw new Error('a dry run must never call the link writer') } })
  assert.equal(result.ok, true)
  assert.equal(result.dry_run, true)
  assert.deepEqual(result.linked, [])
  assert.match(result.report, /nothing was written and nothing was posted/)
  assert.match(result.report, /cases 8 · linkable 3 · already linked 0 · unresolved 2 · conflicting 3/)
  assert.match(result.report, /conflict legacy_attribution_record rec-delta/)
  assert.match(result.report, /review\s+legacy_attribution_record rec-no-provider \(no provider id\)/)
})

test('applying links the matched cases only, and a rerun links nothing new', async () => {
  const data = fixture()
  const first = reconciliation.legacyReconciliationPlan(data)
  const links = []
  const applied = await reconciliation.applyLegacyReconciliation({
    plan: first,
    dryRun: false,
    at: '2026-09-22T00:00:00Z',
    link: async (entry) => { links.push(entry); return { ok: true } },
  })
  assert.equal(applied.ok, true)
  assert.equal(applied.linked.length, 3)
  assert.ok(links.every((entry) => entry.posts_money === false), 'every link states that it posts no money')
  assert.ok(links.every((entry) => entry.linked_at === '2026-09-22T00:00:00Z'))
  const second = reconciliation.legacyReconciliationPlan({ ...data, links })
  assert.equal(second.summary.matched, 0, 'nothing is linkable twice')
  assert.equal(second.summary.already_linked, 3)
  assert.equal(second.conflicting.length, 3, 'conflicts stay conflicts on the second run')
  assert.equal(second.unresolved.length, 2, 'unresolved cases stay unresolved on the second run')
  const again = await reconciliation.applyLegacyReconciliation({ plan: second, dryRun: false, link: async () => { throw new Error('a rerun must not write anything') } })
  assert.deepEqual(again.linked, [])
})

test('a refused link is reported and nothing else happens', async () => {
  const plan = planFor()
  const result = await reconciliation.applyLegacyReconciliation({ plan, dryRun: false, link: async () => ({ ok: false, error: 'That classification is already linked to another legacy row.' }) })
  assert.equal(result.ok, false)
  assert.equal(result.refused.length, 3)
  assert.match(result.refused[0].reason, /already linked to another legacy row/)
})

test('the tool has no posting capability to misuse', () => {
  assert.deepEqual(Object.keys(reconciliation).filter((name) => /post|correction|ledgerPlan|refund/i.test(name)), [])
  assert.match(reconciliation.RECONCILIATION_LINK_SOURCE, /reconciliation/)
})
