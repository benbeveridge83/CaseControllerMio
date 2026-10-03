import test from 'node:test'
import assert from 'node:assert/strict'
import { autoFillEfilingDraft, suggestFilingCode } from '../src/efiling/mioEfilingAutoFill.js'

test('autofill maps matter, document, and filer fields', () => {
  const matter = {
    id: 'matter-1',
    cause_number: '2026-12345',
    matter_type: 'Divorce',
    court_name: '311th District Court',
    county: 'Harris',
    courts: { id: 'court-1', county: 'Harris', court_name: '311th District Court' },
    opposing_counsel_email: 'oc@example.test',
    opposing_counsel_name: 'Opposing Counsel',
  }
  const document = { id: 'doc-9', file_name: 'final-decree.pdf' }
  const filer = { userId: 'user-1', name: 'Ben Attorney', barNumber: '24000000' }
  const settings = { jurisdictionState: 'TX', defaultPaymentAccountId: 'acct-1', defaultPaymentAccountLabel: 'Trust' }
  const draft = autoFillEfilingDraft({ matter, document, filer, settings })
  assert.equal(draft.matterId, 'matter-1')
  assert.equal(draft.causeNumber, '2026-12345')
  assert.equal(draft.court, '311th District Court')
  assert.equal(draft.county, 'Harris')
  assert.equal(draft.documentId, 'doc-9')
  assert.equal(draft.leadDocumentId, 'doc-9')
  assert.equal(draft.filingAttorneyName, 'Ben Attorney')
  assert.equal(draft.paymentAccountId, 'acct-1')
  assert.equal(draft.serviceContacts.length, 1)
  assert.equal(draft.serviceContacts[0].email, 'oc@example.test')
})

test('filing code mapping prefers exact matter type then document keyword', () => {
  const settings = {
    filingCodeMappings: [
      { matterType: 'Divorce', filingCode: 'Petition', filingCodeId: 'fc-petition' },
      { matterType: '', documentKeywords: 'decree', filingCode: 'Final Decree', filingCodeId: 'fc-final' },
    ],
  }
  assert.equal(suggestFilingCode(settings, 'Divorce', 'anything.pdf').filingCode, 'Petition')
  assert.equal(suggestFilingCode(settings, 'SAPCR/Modification', 'final-decree.pdf').filingCode, 'Final Decree')
})
