import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TYLER_FILING_STATE, TYLER_RECEIPT_KIND,
  classifyTylerFilingState, classifyTylerIntentState,
  validateTylerFeeAuthorization, validateTylerServiceResult, validateTylerReceipt,
} from '../lib/efiling/tylerFilingOutcome.js'

test('classifies a submission into exactly one user-facing state without conflation', () => {
  assert.equal(classifyTylerFilingState({ submission: { status: 'rejected' } }), TYLER_FILING_STATE.rejected)
  assert.equal(classifyTylerFilingState({ submission: { status: 'accepted' }, serviceDelivered: false }), TYLER_FILING_STATE.accepted)
  assert.equal(classifyTylerFilingState({ submission: { status: 'accepted' }, serviceDelivered: true }), TYLER_FILING_STATE.served)
  assert.equal(classifyTylerFilingState({ submission: { status: 'under_review' } }), TYLER_FILING_STATE.under_review)
  assert.equal(classifyTylerFilingState({ submission: { status: 'submitted' } }), TYLER_FILING_STATE.submitted)
  assert.equal(classifyTylerFilingState({ submission: {} }), TYLER_FILING_STATE.unknown)
  assert.equal(classifyTylerFilingState({}), TYLER_FILING_STATE.unknown)
})

test('a draft intent is never reported as submitted', () => {
  assert.equal(classifyTylerIntentState({ hasSubmission: false }), TYLER_FILING_STATE.drafted)
  assert.equal(classifyTylerIntentState({ hasSubmission: true }), TYLER_FILING_STATE.submitted)
})

test('fee authorization enforces source, account, ceiling and waiver', () => {
  const plan = { paymentAccountId: 'acct-1', maxFeeAmountCents: 35000, feeWaiver: false }
  const ok = validateTylerFeeAuthorization({ feeQuote: { source: 'tyler_stage', verifiedByServer: true, paymentAccountId: 'acct-1', feeAmountCents: 35000, quoteId: 'q-1' }, plan })
  assert.equal(ok.authorized, true)
  assert.equal(ok.billedToClient, true)
  assert.throws(() => validateTylerFeeAuthorization({ feeQuote: { source: 'mock', verifiedByServer: true, paymentAccountId: 'acct-1', feeAmountCents: 1, quoteId: 'q' }, plan }), /verified Tyler Stage/)
  assert.throws(() => validateTylerFeeAuthorization({ feeQuote: { source: 'tyler_stage', verifiedByServer: true, paymentAccountId: 'other', feeAmountCents: 1, quoteId: 'q' }, plan }), /account/)
  assert.throws(() => validateTylerFeeAuthorization({ feeQuote: { source: 'tyler_stage', verifiedByServer: true, paymentAccountId: 'acct-1', feeAmountCents: 35001, quoteId: 'q' }, plan }), /maximum/)
  assert.throws(() => validateTylerFeeAuthorization({ feeQuote: { source: 'tyler_stage', verifiedByServer: true, paymentAccountId: 'acct-1', feeAmountCents: 1, quoteId: 'q' }, plan: { ...plan, feeWaiver: true } }), /waived/)
})

test('service results require a real service-contact ID and known outcome', () => {
  assert.equal(validateTylerServiceResult({ filingMode: 'efile_only' }).served, false)
  assert.throws(() => validateTylerServiceResult({ filingMode: 'efile_only', recipients: [{ serviceContactId: 'c1', outcome: 'delivered' }] }), /E-File Only/)
  assert.equal(validateTylerServiceResult({ filingMode: 'efile_and_serve', recipients: [{ serviceContactId: 'c1', outcome: 'delivered' }] }).served, true)
  assert.throws(() => validateTylerServiceResult({ filingMode: 'efile_and_serve', recipients: [{ outcome: 'delivered' }] }), /service-contact ID/)
  assert.throws(() => validateTylerServiceResult({ filingMode: 'efile_and_serve', recipients: [{ serviceContactId: 'c1', outcome: 'lost' }] }), /outcome/)
})

test('receipts require a kind, matter, path and digest', () => {
  const ok = validateTylerReceipt({ kind: TYLER_RECEIPT_KIND.clerk_receipt, matterId: 'm1', storagePath: 'm1/receipt.pdf', sha256: 'a'.repeat(64) })
  assert.equal(ok.kind, TYLER_RECEIPT_KIND.clerk_receipt)
  assert.throws(() => validateTylerReceipt({ kind: 'bogus', matterId: 'm1', storagePath: 'p', sha256: 'a'.repeat(64) }), /receipt kind/)
  assert.throws(() => validateTylerReceipt({ kind: TYLER_RECEIPT_KIND.fee_receipt, matterId: '', storagePath: 'p', sha256: 'a'.repeat(64) }), /matter/)
  assert.throws(() => validateTylerReceipt({ kind: TYLER_RECEIPT_KIND.fee_receipt, matterId: 'm1', storagePath: '', sha256: 'a'.repeat(64) }), /path/)
  assert.throws(() => validateTylerReceipt({ kind: TYLER_RECEIPT_KIND.fee_receipt, matterId: 'm1', storagePath: 'p', sha256: 'nope' }), /digest/)
})
