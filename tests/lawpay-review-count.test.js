// The one number the centralized LawPay review queue and its persistent notification share.
// Synthetic records only; no network and no writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { actionableReviewCount } from '../src/mioLawPayClassification.js'

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

test('an empty queue reports zero', () => {
  assert.equal(actionableReviewCount({}).count, 0)
})
