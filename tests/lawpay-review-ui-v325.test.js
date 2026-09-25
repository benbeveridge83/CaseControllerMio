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
