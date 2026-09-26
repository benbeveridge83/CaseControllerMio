// V327: the Bulk Billing reconciliation hides transactions that are already recorded in Mio,
// while a saved-but-not-recorded classification stays in the list. Synthetic records only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { recordedProviderIds } from '../src/mioLawPayClassification.js'

test('recordedProviderIds recognizes every recorded source and excludes a saved-only classification', () => {
  const ids = recordedProviderIds({
    classifications: [
      { gateway_transaction_id: 'posted', posting_status: 'posted' },
      { gateway_transaction_id: 'matched', posting_status: 'matched' },
      { gateway_transaction_id: 'posted-at', posting_status: 'saved', posted_at: '2026-09-10T00:00:00Z' },
      { gateway_transaction_id: 'saved', posting_status: 'saved' },
    ],
    ledgerEntries: [
      { identity: 'acct-1:ledger-identity' },
      { gateway_transaction_id: 'ledger-gateway-id' },
    ],
    trustTransactions: [{ lawpay_transaction_id: 'trust-tx' }],
    attributions: [{ gateway_transaction_id: 'attribution-tx' }],
    legacyRecordedTransactionIds: ['legacy-trust'],
    legacyAttributedTransactionIds: ['legacy-attribution'],
  })
  // finished classifications
  assert.equal(ids.has('posted'), true, 'a posted classification is recorded')
  assert.equal(ids.has('matched'), true, 'a matched classification is recorded')
  assert.equal(ids.has('posted-at'), true, 'a posted_at timestamp is recorded')
  assert.equal(ids.has('saved'), false, 'a saved-only classification is not recorded')
  // ledger entries
  assert.equal(ids.has('ledger-identity'), true, 'a ledger entry identity suffix is recorded')
  assert.equal(ids.has('ledger-gateway-id'), true, 'a ledger entry gateway_transaction_id is recorded')
  // Mio trust transactions and legacy attribution records
  assert.equal(ids.has('trust-tx'), true, 'a trust transaction lawpay_transaction_id is recorded')
  assert.equal(ids.has('attribution-tx'), true, 'an attribution gateway_transaction_id is recorded')
  // gateway-hydrated legacy ids
  assert.equal(ids.has('legacy-trust'), true, 'a legacy recorded id is recorded')
  assert.equal(ids.has('legacy-attribution'), true, 'a legacy attributed id is recorded')
  assert.equal(ids.has('unknown'), false)
})

