// V327: the Bulk Billing reconciliation hides transactions that are already recorded in Mio,
// while a saved-but-not-recorded classification stays in the list. Synthetic records only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { recordedProviderIds } from '../src/mioLawPayClassification.js'

test('recordedProviderIds recognizes posted/matched classifications and legacy trust/attribution ids', () => {
  const ids = recordedProviderIds({
    classifications: [
      { gateway_transaction_id: 'posted', posting_status: 'posted' },
      { gateway_transaction_id: 'matched', posting_status: 'matched' },
      { gateway_transaction_id: 'saved', posting_status: 'saved' },
      { gateway_transaction_id: 'posted-at', posting_status: 'saved', posted_at: '2026-09-10T00:00:00Z' },
    ],
    legacyRecordedTransactionIds: ['legacy-trust'],
    legacyAttributedTransactionIds: ['legacy-attribution'],
  })
  assert.equal(ids.has('posted'), true, 'a posted classification is recorded')
  assert.equal(ids.has('matched'), true, 'a matched classification is recorded')
  assert.equal(ids.has('posted-at'), true, 'a posted_at timestamp is recorded')
  assert.equal(ids.has('saved'), false, 'a saved classification without posted_at is not recorded')
  assert.equal(ids.has('legacy-trust'), true, 'a legacy trust entry is recorded')
  assert.equal(ids.has('legacy-attribution'), true, 'a legacy attribution decision is recorded')
  assert.equal(ids.has('unknown'), false)
})
