import test from 'node:test'
import assert from 'node:assert/strict'
import { validateEfilingDraft, isPdfOrConvertible } from '../src/efiling/mioEfilingValidation.js'
import { createEmptyEfilingDraft } from '../src/efiling/mioEfilingModel.js'

function completeDraft() {
  return createEmptyEfilingDraft({
    documentId: 'doc-1',
    selectedDocumentName: 'motion.pdf',
    filingMode: 'efile_and_serve',
    county: 'Harris',
    court: '311th District Court',
    causeNumber: '2026-00001',
    filingAttorneyId: 'atty-1',
    filingAttorneyName: 'Ben',
    filingAttorneyBarNumber: '24000000',
    filingCode: 'Motion',
    paymentAccountId: 'acct-1',
    serviceContacts: [{ id: 'c1', email: 'oc@example.test', selected: true }],
  })
}

test('a complete draft validates clean', () => {
  const result = validateEfilingDraft(completeDraft(), {}, { id: 'doc-1', file_name: 'motion.pdf' })
  assert.equal(result.status, 'valid')
  assert.equal(result.ready, true)
  assert.equal(result.blockingIssues.length, 0)
})

test('missing court/cause/document/mode block', () => {
  const result = validateEfilingDraft(createEmptyEfilingDraft(), {}, null)
  const codes = result.blockingIssues.map((item) => item.code)
  assert.ok(codes.includes('document_missing'))
  assert.ok(codes.includes('court_missing'))
  assert.ok(codes.includes('cause_number_missing'))
  assert.ok(codes.includes('filing_mode_missing'))
  assert.equal(result.status, 'blocked')
})

test('service recipients required only for service modes', () => {
  const document = { id: 'doc-1', file_name: 'motion.pdf' }
  const draft = completeDraft()
  draft.serviceContacts = []
  const serve = validateEfilingDraft(draft, {}, document)
  assert.ok(serve.blockingIssues.some((item) => item.code === 'service_recipients_missing'))

  draft.filingMode = 'efile_only'
  const fileOnly = validateEfilingDraft(draft, {}, document)
  assert.ok(!fileOnly.blockingIssues.some((item) => item.code === 'service_recipients_missing'))
})

test('unresolved filing code and payment account are warnings, not blockers', () => {
  const draft = completeDraft()
  draft.filingCode = ''
  draft.filingCodeId = ''
  draft.paymentAccountId = ''
  draft.paymentAccountLabel = ''
  const result = validateEfilingDraft(draft, {}, { id: 'doc-1', file_name: 'motion.pdf' })
  assert.equal(result.status, 'incomplete')
  assert.ok(result.warnings.some((item) => item.code === 'filing_code_unresolved'))
  assert.ok(result.warnings.some((item) => item.code === 'payment_account_missing'))
})

test('PDF and Word are convertible, images are not', () => {
  assert.equal(isPdfOrConvertible({ file_name: 'a.pdf' }), true)
  assert.equal(isPdfOrConvertible({ file_name: 'a.docx' }), true)
  assert.equal(isPdfOrConvertible({ file_name: 'a.png' }), false)
})
