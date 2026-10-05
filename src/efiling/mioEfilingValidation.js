// E-Filing draft validation service. Pure function: it never reads the network,
// the browser, or Supabase. It returns blocking issues, warnings, suggested
// fixes, and an overall status so the UI can show only what is missing or
// uncertain instead of a screen-by-screen eFileTexas clone.

import {
  EFILING_MODES,
  EFILING_VALIDATION_STATUS,
  EFILING_SERVICE_CONTACT_STATUS,
} from './mioEfilingModel.js'

function issue(code, severity, field, message, fix) {
  return { code, severity, field, message, fix: fix || '' }
}

export function isPdfOrConvertible(document = null) {
  if (!document) return false
  const name = String(document.file_name || document.name || document.fileName || '')
  const type = String(document.type || document.mime_type || document.contentType || '')
  if (/\.pdf$/i.test(name) || type === 'application/pdf' || /pdf/i.test(type)) return true
  // Word/RTF/ODT documents are convertible through the existing drafting pipeline.
  return /\.(docx?|doc|rtf|odt)$/i.test(name) || /word|rtf|opendocument|officedocument/i.test(type)
}

function hasText(value) {
  return String(value ?? '').trim().length > 0
}

export function validateEfilingDraft(draft = {}, matter = {}, document = null) {
  const blockingIssues = []
  const warnings = []
  const suggestedFixes = []

  // 1. Document exists and is PDF or convertible to PDF.
  const documentId = hasText(document?.id) ? document.id : hasText(document?.documentId) ? document.documentId : draft.documentId
  if (!hasText(documentId)) {
    blockingIssues.push(issue('document_missing', 'blocking', 'documentId',
      'Select a document to e-file.', 'Choose an eligible PDF or Word document from the matter.'))
  } else if (!isPdfOrConvertible(document) && !hasText(draft.selectedDocumentName)) {
    blockingIssues.push(issue('document_not_pdf', 'blocking', 'documentId',
      'The selected document is not a PDF or a format convertible to PDF.', 'Choose a PDF, or convert the document to PDF first.'))
  }

  // 2. Matter has county, court, and cause number unless treated as an initial filing.
  const initialFiling = draft.initialFiling === true || String(draft.initialFiling) === 'true'
  const county = hasText(draft.county) ? draft.county : (matter?.county || matter?.courts?.county)
  const court = hasText(draft.court) ? draft.court : (matter?.court_name || matter?.courts?.court_name)
  const causeNumber = hasText(draft.causeNumber) ? draft.causeNumber : matter?.cause_number
  if (!initialFiling) {
    if (!hasText(county)) blockingIssues.push(issue('county_missing', 'blocking', 'county',
      'County is missing.', 'Select a county from the matter or court list.'))
    if (!hasText(court)) blockingIssues.push(issue('court_missing', 'blocking', 'court',
      'Court is missing.', 'Select a court from the matter or court list.'))
    if (!hasText(causeNumber)) blockingIssues.push(issue('cause_number_missing', 'blocking', 'causeNumber',
      'Cause number is missing.', 'Enter the cause number, or mark this as an initial filing.'))
  } else {
    warnings.push(issue('initial_filing_exception', 'warning', 'causeNumber',
      'Initial filing: a cause number may not exist yet.', 'Confirm the court and case type before the first filing.'))
  }

  // 3. Filing mode is selected.
  if (!draft.filingMode || !EFILING_MODES[draft.filingMode]) {
    blockingIssues.push(issue('filing_mode_missing', 'blocking', 'filingMode',
      'Filing mode is not selected.', 'Choose E-File, E-File & Serve, or E-Serve Only.'))
  }

  // 4. Filing attorney is selected.
  if (!hasText(draft.filingAttorneyId) && !hasText(draft.filingAttorneyName)) {
    blockingIssues.push(issue('filing_attorney_missing', 'blocking', 'filingAttorneyId',
      'Filing attorney is not selected.', 'Select the filing attorney from your profile or firm settings.'))
  } else if (!hasText(draft.filingAttorneyBarNumber)) {
    warnings.push(issue('bar_number_missing', 'warning', 'filingAttorneyBarNumber',
      'Filing attorney bar number is missing.', 'Add the bar number to the attorney profile.'))
  }

  // 5. Filing code is selected or flagged as unresolved.
  if (!hasText(draft.filingCode) && !hasText(draft.filingCodeId)) {
    warnings.push(issue('filing_code_unresolved', 'warning', 'filingCode',
      'Filing code is not selected.', 'Choose a filing code from the document type mapping.'))
  }

  // 6. Payment account is selected unless no-fee or waiver based.
  const feeWaiver = draft.feeWaiver === true || String(draft.feeWaiver) === 'true'
  const noFee = draft.feeCalculationStatus === 'no_fee'
  if (!feeWaiver && !noFee && !hasText(draft.paymentAccountId) && !hasText(draft.paymentAccountLabel)) {
    warnings.push(issue('payment_account_missing', 'warning', 'paymentAccountId',
      'Payment account is not selected.', 'Select a payment account or mark this filing as no-fee/waiver.'))
  }

  // 7. Service recipients are selected for e-file-and-serve or e-serve-only.
  const serviceRequired = draft.filingMode === 'efile_and_serve' || draft.filingMode === 'eserve_only'
  if (serviceRequired) {
    const contacts = Array.isArray(draft.serviceContacts) ? draft.serviceContacts : []
    const recipients = Array.isArray(draft.serviceRecipients) ? draft.serviceRecipients : []
    const selectedContacts = contacts.filter((contact) => contact.selected !== false && hasText(contact.email))
    const selectedRecipients = recipients.filter((recipient) => recipient.selected !== false)
    if (!selectedContacts.length && !selectedRecipients.length) {
      blockingIssues.push(issue('service_recipients_missing', 'blocking', 'serviceContacts',
        'Service recipients are required for this filing mode.', 'Select at least one service contact or recipient.'))
    } else if (draft.serviceContactValidationStatus === EFILING_SERVICE_CONTACT_STATUS.incomplete) {
      warnings.push(issue('service_contact_incomplete', 'warning', 'serviceContactValidationStatus',
        'Some service contacts may be incomplete.', 'Verify each selected service contact has a valid email.'))
    }
  }

  const status = blockingIssues.length
    ? EFILING_VALIDATION_STATUS.blocked
    : warnings.length
      ? EFILING_VALIDATION_STATUS.incomplete
      : EFILING_VALIDATION_STATUS.valid

  for (const item of [...blockingIssues, ...warnings]) if (item.fix) suggestedFixes.push(item.fix)

  return {
    status,
    ready: status === EFILING_VALIDATION_STATUS.valid,
    blockingIssues,
    warnings,
    suggestedFixes: [...new Set(suggestedFixes)],
  }
}

export function withValidation(draft, matter, document) {
  const result = validateEfilingDraft(draft, matter, document)
  return {
    ...draft,
    validationStatus: result.status,
    validationIssues: [...result.blockingIssues, ...result.warnings],
  }
}

