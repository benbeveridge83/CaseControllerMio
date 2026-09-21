import test from 'node:test'
import assert from 'node:assert/strict'

const load = () => import('../src/mioLawPayAttribution.js')
const matter = { id: 'matter-joseph', name: 'Joseph South', client_id: 'client-joseph' }
const charge = (over = {}) => ({ gateway_transaction_id: 'provider-joseph-5000', occurred_at: '2026-09-09T15:13:36Z', transaction_type: 'CHARGE', status: 'COMPLETED', account_key: 'trust', amount_cents: 500000, payer_name: 'Joseph South', reference: '', raw: {}, ...over })

test('attributing a trust charge to a matter posts a trust deposit that accounting can read', async () => {
  const { lawPayAttributionEntry } = await load()
  const result = lawPayAttributionEntry({ transaction: charge(), decision: 'matter', matter, actor: 'ben@beveridgelawfirm.com', occurredAt: '2026-09-21T20:00:00Z' })
  assert.equal(result.ok, true)
  assert.equal(result.entry.matter_id, matter.id)
  assert.equal(result.entry.client_id, matter.client_id)
  assert.equal(result.entry.direction, 'in')
  assert.equal(result.entry.transaction_type, 'lawpay')
  assert.equal(result.entry.amount, 5000)
  assert.equal(result.entry.date, '2026-09-09')
  assert.equal(result.entry.lawpay_transaction_id, 'provider-joseph-5000')
  assert.equal(result.entry.attribution_key, 'provider-joseph-5000')
  assert.match(result.entry.memo, /Digital payment through LawPay attributed to Joseph South/)
  assert.equal(result.record.entry_kind, 'trust_deposit')
  assert.equal(result.record.account_label, 'Trust')
  assert.equal(result.record.attributed_by, 'ben@beveridgelawfirm.com')
})

test('an operating charge is recorded but never posted into a trust balance', async () => {
  const { lawPayAttributionEntry } = await load()
  const result = lawPayAttributionEntry({ transaction: charge({ account_key: 'operating', amount_cents: 12500, payer_name: 'Yasmine Said' }), decision: 'matter', matter })
  assert.equal(result.ok, true)
  assert.equal(result.entry, null)
  assert.equal(result.operating, true)
  assert.equal(result.record.entry_kind, 'operating_association')
  assert.equal(result.record.account_label, 'Operating')
  assert.match(result.record.note, /never moves trust/)
})

test('a refund or reversal attributed to a matter takes money back out of trust', async () => {
  const { lawPayAttributionEntry } = await load()
  const result = lawPayAttributionEntry({ transaction: charge({ transaction_type: 'REFUND', amount_cents: 15000 }), decision: 'matter', matter })
  assert.equal(result.ok, true)
  assert.equal(result.entry.direction, 'out')
  assert.equal(result.entry.transaction_type, 'refund')
  assert.equal(result.entry.amount, 150)
  assert.equal(result.record.entry_kind, 'trust_refund')
})

test('an undetermined deposit account is refused instead of assumed', async () => {
  const { lawPayAttributionEntry } = await load()
  const result = lawPayAttributionEntry({ transaction: charge({ account_key: '', raw: { mio_account_key_source: 'unresolved' } }), decision: 'matter', matter })
  assert.equal(result.ok, false)
  assert.match(result.error, /Account not reported/)
  assert.match(result.error, /cannot tell trust money from operating money/)
  assert.equal(result.entry, undefined)
})

test('incomplete charges, missing destinations, and a missing reason are refused', async () => {
  const { lawPayAttributionEntry } = await load()
  assert.match(lawPayAttributionEntry({ transaction: charge({ status: 'PENDING' }), decision: 'matter', matter }).error, /Only a completed/)
  assert.match(lawPayAttributionEntry({ transaction: charge(), decision: 'matter' }).error, /Select the matter/)
  assert.match(lawPayAttributionEntry({ transaction: charge(), decision: 'pnc', matter }).error, /Associate a PNC only when/)
  assert.match(lawPayAttributionEntry({ transaction: charge(), decision: 'neither' }).error, /Say why/)
  assert.match(lawPayAttributionEntry({ transaction: charge(), decision: '' }).error, /Choose whether/)
  assert.match(lawPayAttributionEntry({ transaction: {}, decision: 'matter', matter }).error, /no stable provider ID/)
})

test('neither records a reviewable decision and posts nothing', async () => {
  const { lawPayAttributionEntry, lawPayAttributionSummary } = await load()
  const result = lawPayAttributionEntry({ transaction: charge({ account_key: 'operating', amount_cents: 100000, payer_name: 'Shalonda Jamal' }), decision: 'neither', reason: 'Consultation fee taken directly in LawPay' })
  assert.equal(result.ok, true)
  assert.equal(result.entry, null)
  assert.equal(result.matter, null)
  assert.equal(result.record.matter_id, undefined)
  assert.equal(lawPayAttributionSummary(result.record), 'Operating - decided: neither (Consultation fee taken directly in LawPay)')
})

test('a PNC association carries the PNC workflow and kind', async () => {
  const { lawPayAttributionEntry, lawPayAttributionSummary } = await load()
  const pnc = { id: 'pnc-workflow-1', kind: 'consult' }
  const result = lawPayAttributionEntry({ transaction: charge({ account_key: 'operating', amount_cents: 12500 }), decision: 'pnc', matter, pnc })
  assert.equal(result.record.decision, 'pnc')
  assert.equal(result.record.pnc_workflow_id, 'pnc-workflow-1')
  assert.equal(result.record.pnc_kind, 'consult')
  assert.equal(lawPayAttributionSummary(result.record, { pncLabel: 'PNC - Joseph South' }), 'Operating - operating record - PNC - Joseph South')
})

test('a charge already in the trust ledger is never posted twice', async () => {
  const { duplicateLawPayAttribution, lawPayAttributionState } = await load()
  const rows = [{ id: 'row-1', matter_id: matter.id, lawpay_transaction_id: 'provider-joseph-5000', amount: 5000 }]
  assert.equal(duplicateLawPayAttribution(rows, charge()), true)
  assert.equal(duplicateLawPayAttribution(rows, charge({ amount_cents: 499900 })), true)
  assert.equal(duplicateLawPayAttribution(rows, charge({ gateway_transaction_id: 'provider-other' })), false)
  assert.equal(duplicateLawPayAttribution([{ id: 'legacy', payment_request_id: 'x' }], charge()), false)
  assert.equal(lawPayAttributionState([{ gateway_transaction_id: 'provider-joseph-5000' }], charge()), 'attributed')
  assert.equal(lawPayAttributionState([], charge()), 'undecided')
  assert.equal(lawPayAttributionState([{ gateway_transaction_id: 'other' }], {}), 'undecided')
})

test('account kinds split trust from operating for every configured LawPay account', async () => {
  const { accountKind, transactionMoneyOut, MONEY_OUT_TYPES } = await load()
  assert.equal(accountKind('trust'), 'trust')
  assert.equal(accountKind('ECHECK_TRUST'), 'trust')
  assert.equal(accountKind('clientcredit_trust'), 'trust')
  assert.equal(accountKind('operating'), 'operating')
  assert.equal(accountKind('echeck_operating'), 'operating')
  assert.equal(accountKind(''), '')
  assert.equal(transactionMoneyOut({ transaction_type: 'refund' }), true)
  assert.equal(transactionMoneyOut({ transaction_type: 'CHARGEBACK' }), true)
  assert.deepEqual(MONEY_OUT_TYPES, ['REFUND', 'REVERSAL', 'CHARGEBACK'])
  assert.equal(transactionMoneyOut({ transaction_type: 'CHARGE' }), false)
})
