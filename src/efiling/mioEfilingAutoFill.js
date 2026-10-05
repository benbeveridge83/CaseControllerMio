// Auto-fill logic: build an E-Filing draft from existing matter, client, and
// document data so the user only has to fix the missing or uncertain fields.

import { createEmptyEfilingDraft, EFILING_SERVICE_CONTACT_STATUS } from './mioEfilingModel.js'

function text(value) {
  return String(value ?? '').trim()
}

export function suggestFilingCode(settings = {}, matterType = '', documentName = '') {
  const mappings = Array.isArray(settings?.filingCodeMappings) ? settings.filingCodeMappings : []
  const lowerType = text(matterType).toLowerCase()
  const lowerDoc = text(documentName).toLowerCase()
  // Exact matter-type match first, then a keyword match on the document name.
  return mappings.find((mapping) => text(mapping.matterType).toLowerCase() === lowerType)
    || mappings.find((mapping) => {
      const keywords = text(mapping.documentKeywords).toLowerCase()
      return keywords && lowerDoc.includes(keywords)
    })
    || null
}

export function autoFillEfilingDraft({ matter = {}, document = null, filer = {}, settings = {} } = {}) {
  const draft = createEmptyEfilingDraft()
  const courts = matter.courts || {}
  const documentId = text(document?.id) || text(document?.documentId) || ''
  const documentName = text(document?.file_name) || text(document?.name) || text(document?.fileName) || text(document?.title) || ''

  draft.matterId = text(matter.id)
  draft.documentId = documentId
  draft.selectedDocumentName = documentName
  draft.selectedDocumentUrlOrPath = text(document?.url || document?.file_url || document?.storage_path)
  draft.jurisdictionState = text(settings.jurisdictionState) || 'TX'
  draft.county = text(matter.county) || text(courts.county)
  draft.court = text(matter.court_name) || text(courts.court_name)
  draft.courtLocationId = text(courts.id) || text(matter.court_id)
  draft.causeNumber = text(matter.cause_number)
  draft.caseCategory = text(matter.case_category) || text(matter.matter_type)
  draft.caseType = text(matter.matter_type)
  draft.caseId = text(matter.case_id) || text(matter.id)
  draft.filerUserId = text(filer.userId || filer.id)
  draft.filingAttorneyId = text(settings.defaultFilingAttorneyId || filer.attorneyId)
  draft.filingAttorneyName = text(settings.defaultFilingAttorneyName || filer.name)
  draft.filingAttorneyBarNumber = text(settings.defaultFilingAttorneyBarNumber || filer.barNumber)
  draft.filingDescription = documentName
  draft.leadDocumentId = documentId
  draft.paymentAccountId = text(settings.defaultPaymentAccountId)
  draft.paymentAccountLabel = text(settings.defaultPaymentAccountLabel)
  draft.target = text(settings.stageOrProduction) === 'production' ? 'production' : 'stage'

  const filingCode = suggestFilingCode(settings, matter.matter_type, documentName)
  if (filingCode) {
    draft.filingCode = text(filingCode.filingCode)
    draft.filingCodeId = text(filingCode.filingCodeId)
    if (filingCode.filingDescription) draft.filingDescription = text(filingCode.filingDescription)
  }

  // Seed service contacts from matter parties and opposing counsel.
  const contacts = []
  if (text(matter.opposing_counsel_email) || text(matter.opposing_counsel_name)) {
    contacts.push({
      id: `oc-${draft.matterId || 'matter'}`,
      name: text(matter.opposing_counsel_name) || 'Opposing counsel',
      email: text(matter.opposing_counsel_email),
      firm: text(matter.opposing_counsel_firm),
      role: 'opposing_counsel',
      selected: true,
    })
  }
  if (text(matter.opposing_party_email) || text(matter.opposing_party_name)) {
    contacts.push({
      id: `op-${draft.matterId || 'matter'}`,
      name: text(matter.opposing_party_name) || 'Opposing party',
      email: text(matter.opposing_party_email),
      firm: '',
      role: 'opposing_party',
      selected: true,
    })
  }
  draft.serviceContacts = contacts
  draft.serviceContactValidationStatus = contacts.length
    ? EFILING_SERVICE_CONTACT_STATUS.unvalidated
    : EFILING_SERVICE_CONTACT_STATUS.incomplete

  return draft
}
