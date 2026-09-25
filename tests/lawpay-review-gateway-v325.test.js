// The review response must carry the immutable evidence needed to distinguish an actual manual
// decision from a Mio-created payment that is already linked or recorded. Source-level guards keep
// a future cleanup from silently dropping one evidence source from the Edge Function bundle.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inheritRefundEvidence, providerRefundChargeId, storedStateValue, transactionLinkage } from '../supabase/functions/_shared/lawpay-review-v325.js'

const gateway = fs.readFileSync(new URL('../supabase/functions/lawpay-gateway/index.ts', import.meta.url), 'utf8')
const shared = fs.readFileSync(new URL('../supabase/functions/_shared/lawpay-review-v325.js', import.meta.url), 'utf8')

test('review hydrates payment requests, invoices, invoice events and the finance opening date', () => {
  assert.match(gateway, /from\('lawpay_payment_requests'\)/)
  assert.match(gateway, /from\('mio_invoices'\)/)
  assert.match(gateway, /from\('mio_invoice_events'\)/)
  assert.match(gateway, /caseMioBillingCutoverDate/)
  assert.match(gateway, /review_cutover_date/)
  assert.match(gateway, /review_linkage/)
})

test('review recognizes only exact legacy transaction ids from stored records', () => {
  assert.match(gateway, /caseMioTrustTransactions/)
  assert.match(gateway, /lawpay_transaction_id/)
  assert.match(gateway, /legacy_recorded_transaction_ids/)
  assert.match(gateway, /caseMioLawPayAttribution/)
  assert.match(gateway, /legacy_attributed_transaction_ids/)
})

test('review linkage proves reconciliation with an exact provider event id', () => {
  assert.match(gateway, /transactionLinkage/)
  assert.match(shared, /provider_event_id/)
  assert.match(shared, /gateway_transaction_id/)
  assert.match(shared, /text\(item\.invoice_id\) === text\(invoice\.id\)/)
  const linkage = transactionLinkage(
    { gateway_transaction_id: 'provider-kevin', raw: { mio_payment_request_id: 'request-kevin', mio_invoice_number: 'MIO-2026-1400', mio_matter_id: 'matter-kevin' } },
    [{ id: 'request-kevin', invoice_number: 'MIO-2026-1400', matter_id: 'matter-kevin', client_id: 'client-kevin', status: 'paid' }],
    [{ id: 'invoice-kevin', invoice_number: 'MIO-2026-1400', matter_id: 'matter-kevin', client_id: 'client-kevin', status: 'paid' }],
    [{ id: 'event-kevin', invoice_id: 'invoice-kevin', event_type: 'lawpay_payment_recorded', provider_event_id: 'provider-kevin' }],
  )
  assert.deepEqual(linkage, {
    payment_request_id: 'request-kevin', request_found: true, payment_request_status: 'paid',
    invoice_number: 'MIO-2026-1400', invoice_id: 'invoice-kevin', invoice_status: 'paid', invoice_event_id: 'event-kevin',
    matter_id: 'matter-kevin', client_id: 'client-kevin', reconciled: true, conflict: '',
  })
})

test('linkage never treats an event for a different invoice as reconciliation', () => {
  const linkage = transactionLinkage(
    { gateway_transaction_id: 'provider-1', raw: { mio_payment_request_id: 'request-1', mio_matter_id: 'matter-1' } },
    [{ id: 'request-1', invoice_number: 'MIO-1', matter_id: 'matter-1' }],
    [{ id: 'invoice-1', invoice_number: 'MIO-1', matter_id: 'matter-1' }],
    [{ id: 'wrong-event', invoice_id: 'invoice-2', event_type: 'lawpay_payment_recorded', provider_event_id: 'provider-1' }],
  )
  assert.equal(linkage.reconciled, false)
  assert.match(linkage.conflict, /different invoice/)
})

test('state values preserve JSON arrays and the fixed finance opening date', () => {
  assert.deepEqual(storedStateValue({ raw_value: '[{"lawpay_transaction_id":"provider-1"}]' }, []), [{ lawpay_transaction_id: 'provider-1' }])
  assert.equal(storedStateValue({ json_value: '2026-08-09' }, ''), '2026-08-09')
})

test('a LawPay refund inherits immutable matter and account evidence from its charge', () => {
  const charge = {
    gateway_transaction_id: 'charge-dobbins', resolved_account_key: 'trust', resolved_account_source: 'registry',
    review_linkage: { payment_request_id: 'request-dobbins', matter_id: 'matter-dobbins', client_id: 'client-dobbins', invoice_id: 'invoice-dobbins', reconciled: true, conflict: '' },
  }
  const refund = { gateway_transaction_id: 'refund-dobbins', transaction_type: 'REFUND', account_key: '', resolved_account_key: '', raw: { charge_id: 'charge-dobbins' }, review_linkage: {} }
  assert.equal(providerRefundChargeId(refund), 'charge-dobbins')
  const hydrated = inheritRefundEvidence(refund, charge)
  assert.equal(hydrated.refund_charge_id, 'charge-dobbins')
  assert.equal(hydrated.resolved_account_key, 'trust')
  assert.equal(hydrated.review_linkage.matter_id, 'matter-dobbins')
  assert.equal(hydrated.review_linkage.payment_request_id, 'request-dobbins')
  assert.equal(hydrated.review_linkage.reconciled, true)
})

test('gateway returns only the normalized refund entries needed for reconciliation', () => {
  assert.match(gateway, /legacy_refund_entries/)
  assert.match(gateway, /transaction_type.*client_refund/)
  assert.match(gateway, /inheritRefundEvidence/)
})
