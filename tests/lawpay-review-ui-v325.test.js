// UI wiring guards for the simplified manual-review flow. Browser coverage exercises the built
// bundle; these checks make the intended controls and shared predicate explicit in the fast suite.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const panel = fs.readFileSync(new URL('../src/MioLawPayClassificationPanel.jsx', import.meta.url), 'utf8')
const alert = fs.readFileSync(new URL('../src/MioLawPayAlerts.jsx', import.meta.url), 'utf8')
const transform = fs.readFileSync(new URL('../mio-v323-lawpay-classification.js', import.meta.url), 'utf8')

test('queue and notification both consume the canonical review evidence', () => {
  assert.match(panel, /actionableReviewCount/)
  assert.match(alert, /review_cutover_date/)
  assert.match(alert, /legacy_recorded_transaction_ids/)
  assert.match(transform, /review_cutover_date/)
  assert.match(transform, /legacy_recorded_transaction_ids/)
})

test('the queue separates technical linkage exceptions from manual classifications', () => {
  assert.match(panel, /Mio-linked payments needing reconciliation/)
  assert.match(panel, /technical_exceptions/)
  assert.match(panel, /defaultClassificationDraft/)
})

test('PNC association is an optional dropdown and the payer is never retyped', () => {
  assert.match(panel, /No PNC selected \(optional\)/)
  assert.match(panel, /pncOptions/)
  assert.doesNotMatch(panel, /placeholder="PNC consultation or workflow name"/)
})

test('matter selection offers a client-or-cause search and descriptive labels', () => {
  assert.match(panel, /Search matters for/)
  assert.match(panel, /matterChoiceLabel/)
  assert.doesNotMatch(panel, /Invoice for \{payer\}/)
})

test('refund review compares LawPay with existing Mio refunds and never offers a duplicate post for a discrepancy', () => {
  assert.match(panel, /refund_ledger_issues/)
  assert.match(panel, /Do not record another refund/)
  assert.match(panel, /difference/)
  assert.match(alert, /legacy_refund_entries/)
  assert.match(transform, /legacy_refund_entries/)
  assert.match(transform, /transaction_type\|\|''\)\.toLowerCase\(\)===\s*'client_refund'/)
})

test('a genuinely unlinked refund cannot be matched to an arbitrary first charge', () => {
  assert.match(panel, /Original charge for refund/)
  assert.match(panel, /refundChargeIds/)
  assert.match(panel, /resolveRefund\(effect\.refund_id, 'same_refund',[^)]*refundChargeIds\[effect\.refund_id\]/)
  assert.doesNotMatch(panel, /classifications \|\| \[\]\)\.find\(\(record\).*\?\.gateway_transaction_id/)
})
