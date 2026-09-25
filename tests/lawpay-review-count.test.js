// The one number the centralized LawPay review queue and its persistent notification share.
// Synthetic records only; no network and no writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  actionableReviewCount,
  defaultClassificationDraft,
  derivedClassificationCategory,
  lawPayReviewDisposition,
  matterChoiceLabel,
  validateClassification,
} from '../src/mioLawPayClassification.js'

const tx = (over = {}) => ({ gateway_transaction_id: 't', transaction_type: 'CHARGE', status: 'COMPLETED', amount_cents: 10000, amount_refunded_cents: 0, account_id: 'acct-1', ...over })
const record = (id, posting_status, posted = false) => ({ gateway_transaction_id: id, ownership: 'matter', category: 'trust_deposit', posting_status, posted_at: posted ? '2026-09-10T00:00:00Z' : undefined })

test('excludes pending, authorized, failed, voided and closed transactions', () => {
  const transactions = [
    tx({ gateway_transaction_id: 'a', status: 'AUTHORIZED' }),
    tx({ gateway_transaction_id: 'b', status: 'PENDING' }),
    tx({ gateway_transaction_id: 'c', status: 'FAILED' }),
    tx({ gateway_transaction_id: 'd', status: 'VOIDED' }),
    tx({ gateway_transaction_id: 'e', status: 'CLOSED' }),
    tx({ gateway_transaction_id: 'f', status: 'COMPLETED' }),
  ]
  const result = actionableReviewCount({ transactions })
  assert.equal(result.count, 1)
  assert.deepEqual(result.transactions.map((row) => row.gateway_transaction_id), ['f'])
})

test('excludes already-recorded and already-matched transactions, including a match', () => {
  const transactions = [tx({ gateway_transaction_id: 'posted' }), tx({ gateway_transaction_id: 'matched' }), tx({ gateway_transaction_id: 'fresh' })]
  const classifications = [record('posted', 'posted', true), record('matched', 'matched')]
  const result = actionableReviewCount({ transactions, classifications })
  assert.equal(result.count, 1)
  assert.deepEqual(result.transactions.map((row) => row.gateway_transaction_id), ['fresh'])
})

test('a newer posted record wins over an older saved history row', () => {
  const transaction = tx({ gateway_transaction_id: 'history' })
  const classifications = [record('history', 'posted', true), record('history', 'saved')]
  assert.equal(actionableReviewCount({ transactions: [transaction], classifications }).count, 0)
})

test('a transaction saved for later stays counted', () => {
  const transactions = [tx({ gateway_transaction_id: 'saved' })]
  const classifications = [record('saved', 'saved')]
  assert.equal(actionableReviewCount({ transactions, classifications }).count, 1)
})

test('an actionable refund relationship is counted on top of the transaction decisions', () => {
  const transactions = [
    tx({ gateway_transaction_id: 'charge', amount_cents: 50000 }),
    tx({ gateway_transaction_id: 'refund', transaction_type: 'REFUND', amount_cents: 10000 }),
  ]
  // The refund is already classified (recorded), so it is not counted as a decision, but its
  // relationship to the charge is still unresolved, so it is counted exactly once as a relationship.
  const classifications = [record('refund', 'posted', true)]
  const result = actionableReviewCount({ transactions, classifications })
  assert.equal(result.count, 2) // the unclassified charge + the unresolved refund relationship
  assert.equal(result.refund_relationships.length, 1)
  assert.equal(result.refund_relationships[0].refund_id, 'refund')
})

test('a resolved refund relationship stops counting', () => {
  const transactions = [
    tx({ gateway_transaction_id: 'charge', amount_cents: 50000 }),
    tx({ gateway_transaction_id: 'refund', transaction_type: 'REFUND', amount_cents: 10000 }),
  ]
  const classifications = [record('refund', 'posted', true)]
  const refundResolutions = [{ refund_transaction_id: 'refund', charge_transaction_id: 'charge', resolution: 'same_refund' }]
  const result = actionableReviewCount({ transactions, classifications, refundResolutions })
  assert.equal(result.refund_relationships.length, 0)
  assert.equal(result.count, 1) // only the unclassified charge remains
})

test('a provider-linked refund inherits its original Mio matter and is not an uncategorized transaction', () => {
  const charge = tx({
    gateway_transaction_id: 'charge-dobbins', amount_cents: 140000, amount_refunded_cents: 140000,
    account_key: 'trust', resolved_account_key: 'trust', raw: { mio_matter_id: 'matter-dobbins' },
    review_linkage: { matter_id: 'matter-dobbins', reconciled: true, invoice_id: 'invoice-dobbins' },
  })
  const refund = tx({
    gateway_transaction_id: 'refund-dobbins', transaction_type: 'REFUND', amount_cents: 140000,
    account_key: '', resolved_account_key: '', occurred_at: '2026-09-10T16:00:00Z', raw: { charge_id: 'charge-dobbins' },
  })
  const existingRefundEntries = [{ id: 'mio-refund', matter_id: 'matter-dobbins', direction: 'out', transaction_type: 'client_refund', amount: 1400, date: '2026-09-10' }]
  const result = actionableReviewCount({ transactions: [charge, refund], existingRefundEntries, reviewCutoverDate: '2026-08-09' })
  assert.equal(result.count, 0)
  assert.equal(result.dispositions['refund-dobbins'].state, 'linked_and_complete')
  assert.equal(result.dispositions['refund-dobbins'].matter_id, 'matter-dobbins')
})

test('refund alert counts one completed Mio-versus-LawPay discrepancy but not authorized or historical refunds', () => {
  const charge = tx({
    gateway_transaction_id: 'charge-dobbins', amount_cents: 140000, amount_refunded_cents: 140000,
    account_key: 'trust', resolved_account_key: 'trust', occurred_at: '2026-09-21T15:59:36Z',
    raw: { mio_matter_id: 'matter-dobbins' }, review_linkage: { matter_id: 'matter-dobbins', reconciled: true, invoice_id: 'invoice-dobbins' },
  })
  const refund = tx({
    gateway_transaction_id: 'refund-dobbins', transaction_type: 'REFUND', amount_cents: 140000,
    status: 'COMPLETED', occurred_at: '2026-09-25T16:46:02Z', raw: { charge_id: 'charge-dobbins' },
  })
  const existingRefundEntries = [{ id: 'mio-refund', matter_id: 'matter-dobbins', direction: 'out', transaction_type: 'client_refund', amount: 1399.73, date: '2026-09-25' }]
  const mismatch = actionableReviewCount({ transactions: [charge, refund], existingRefundEntries, reviewCutoverDate: '2026-08-09' })
  assert.equal(mismatch.count, 1)
  assert.equal(mismatch.refund_ledger_issues.length, 1)
  assert.equal(mismatch.refund_ledger_issues[0].difference_cents, 27)

  const authorized = actionableReviewCount({ transactions: [charge, { ...refund, status: 'AUTHORIZED' }], existingRefundEntries, reviewCutoverDate: '2026-08-09' })
  assert.equal(authorized.count, 0)
  const historical = actionableReviewCount({ transactions: [{ ...charge, occurred_at: '2026-06-01T00:00:00Z' }, { ...refund, occurred_at: '2026-06-02T00:00:00Z' }], existingRefundEntries, reviewCutoverDate: '2026-08-09' })
  assert.equal(historical.count, 0)
})

test('one unclassified refund is one review transaction even when its relationship is unresolved', () => {
  const refund = tx({ gateway_transaction_id: 'refund-only', transaction_type: 'REFUND', amount_cents: 10000 })
  const result = actionableReviewCount({ transactions: [refund] })
  assert.equal(result.transactions.length, 1)
  assert.equal(result.refund_relationships.length, 1)
  assert.equal(result.count, 1)
})

test('an empty queue reports zero', () => {
  assert.equal(actionableReviewCount({}).count, 0)
})

test('historical transactions before the Mio finance opening are visible but never called uncategorized', () => {
  const transactions = [
    tx({ gateway_transaction_id: 'historical', occurred_at: '2026-08-08T23:59:59Z' }),
    tx({ gateway_transaction_id: 'current', occurred_at: '2026-08-09T00:00:00Z' }),
  ]
  const result = actionableReviewCount({ transactions, reviewCutoverDate: '2026-08-09' })
  assert.equal(result.count, 1)
  assert.deepEqual(result.transactions.map((row) => row.gateway_transaction_id), ['current'])
  assert.deepEqual(result.historical.map((row) => row.gateway_transaction_id), ['historical'])
  assert.equal(result.dispositions.historical.state, 'historical_out_of_scope')
})

test('a Mio invoice payment with its immutable reconciliation event is already handled', () => {
  const transaction = tx({
    gateway_transaction_id: 'kevin-1400',
    occurred_at: '2026-09-21T12:00:00Z',
    resolved_account_key: 'trust',
    raw: { mio_payment_request_id: 'request-kevin', mio_matter_id: 'matter-kevin', mio_invoice_number: 'MIO-2026-1400' },
    review_linkage: {
      payment_request_id: 'request-kevin', request_found: true, matter_id: 'matter-kevin',
      invoice_number: 'MIO-2026-1400', invoice_id: 'invoice-kevin', invoice_event_id: 'event-kevin', reconciled: true,
    },
  })
  const disposition = lawPayReviewDisposition({ transaction, reviewCutoverDate: '2026-08-09' })
  assert.equal(disposition.state, 'linked_and_complete')
  assert.equal(disposition.actionable, false)
  assert.equal(disposition.matter_id, 'matter-kevin')
  assert.equal(actionableReviewCount({ transactions: [transaction], reviewCutoverDate: '2026-08-09' }).count, 0)
})

test('a linked payment with missing reconciliation evidence is a technical exception, not an uncategorized payment', () => {
  const transaction = tx({
    gateway_transaction_id: 'linked-incomplete',
    occurred_at: '2026-09-21T12:00:00Z',
    resolved_account_key: 'operating',
    raw: { mio_payment_request_id: 'request-1', mio_matter_id: 'matter-1', mio_invoice_number: 'MIO-2026-1' },
    review_linkage: { payment_request_id: 'request-1', request_found: true, matter_id: 'matter-1', invoice_number: 'MIO-2026-1', reconciled: false },
  })
  const result = actionableReviewCount({ transactions: [transaction], reviewCutoverDate: '2026-08-09' })
  assert.equal(result.count, 0)
  assert.equal(result.technical_exceptions.length, 1)
  assert.equal(result.dispositions['linked-incomplete'].state, 'linked_incomplete')
  assert.equal(result.dispositions['linked-incomplete'].matter_id, 'matter-1')
})

test('an exact legacy financial entry excludes the provider transaction without hiding unrelated rows', () => {
  const transactions = [tx({ gateway_transaction_id: 'legacy' }), tx({ gateway_transaction_id: 'fresh' })]
  const result = actionableReviewCount({ transactions, legacyRecordedTransactionIds: ['legacy'] })
  assert.equal(result.count, 1)
  assert.deepEqual(result.transactions.map((row) => row.gateway_transaction_id), ['fresh'])
  assert.equal(result.dispositions.legacy.state, 'already_recorded')
})

test('stored Mio linkage seeds the matter, invoice and deterministic transaction type', () => {
  const transaction = tx({
    gateway_transaction_id: 'kevin-1400',
    resolved_account_key: 'operating',
    raw: { mio_matter_id: 'matter-kevin', mio_invoice_number: 'MIO-2026-1400' },
    review_linkage: { matter_id: 'matter-kevin', invoice_id: 'invoice-kevin', invoice_number: 'MIO-2026-1400' },
  })
  assert.deepEqual(defaultClassificationDraft({ transaction }), {
    ownership: 'matter', matter_id: 'matter-kevin', pnc_workflow_id: '', category: 'earned_fee_payment', invoice_id: 'invoice-kevin',
  })
})

test('matter and consultation choices derive the only sensible incoming transaction type', () => {
  assert.equal(derivedClassificationCategory({ transaction: tx(), ownership: 'matter', accountKey: 'trust' }), 'trust_deposit')
  assert.equal(derivedClassificationCategory({ transaction: tx(), ownership: 'matter', accountKey: 'operating' }), 'earned_fee_payment')
  assert.equal(derivedClassificationCategory({ transaction: tx(), ownership: 'pnc', accountKey: 'operating' }), 'consultation_payment')
  assert.equal(derivedClassificationCategory({ transaction: tx(), ownership: 'pnc', accountKey: 'trust' }), '')
})

test('a consultation may be recorded without retyping a PNC name or choosing a workflow', () => {
  const result = validateClassification({
    mode: 'post',
    record: { ownership: 'pnc', category: 'consultation_payment' },
    transaction: tx(),
    resolvedAccount: { account_key: 'operating', provenance: 'reported_by_lawpay' },
    pnc: null,
  })
  assert.equal(result.ok, true)
  assert.equal(result.errors.some((message) => /Select the PNC/.test(message)), false)
})

test('matter choices identify the client, matter and cause number', () => {
  assert.equal(matterChoiceLabel({
    id: 'matter-1', name: 'Enforcement', cause_number: 'DF-24-100',
    clients: { first_name: 'Kevin', last_name: 'Dobbins' },
  }), 'Kevin Dobbins — Enforcement — DF-24-100')
})
