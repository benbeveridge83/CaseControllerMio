// E-Filing draft model and constants for the direct Tyler EFSP integration
// foundation. This is the internal draft shape used before live Tyler submission
// exists. It is deliberately database-ready: each field maps 1:1 to the
// public.mio_efiling_drafts.draft jsonb column so persistence can be turned on
// without reshaping the object.

export const EFILING_SCHEMA_VERSION = 'efiling-draft-v1'

export const EFILING_JURISDICTION_STATE = 'TX'
export const EFILING_JURISDICTION_STATE_NAME = 'Texas'

export const EFILING_MODES = Object.freeze({
  efile_only: Object.freeze({ value: 'efile_only', label: 'E-File Only', serviceRequired: false }),
  efile_and_serve: Object.freeze({ value: 'efile_and_serve', label: 'E-File & Serve', serviceRequired: true }),
  eserve_only: Object.freeze({ value: 'eserve_only', label: 'E-Serve Only', serviceRequired: true }),
})

export const EFILING_MODE_VALUES = Object.freeze(Object.keys(EFILING_MODES))

export const EFILING_DOCUMENT_SECURITY = Object.freeze(['public', 'sensitive', 'confidential'])

export const EFILING_DRAFT_STATUS = Object.freeze({
  draft: 'draft',
  ready: 'ready',
  submitted: 'submitted',
  accepted: 'accepted',
  rejected: 'rejected',
})

export const EFILING_VALIDATION_STATUS = Object.freeze({
  valid: 'valid',
  incomplete: 'incomplete',
  blocked: 'blocked',
})

export const EFILING_SERVICE_CONTACT_STATUS = Object.freeze({
  unvalidated: 'unvalidated',
  valid: 'valid',
  incomplete: 'incomplete',
})

export const EFILING_FEE_STATUS = Object.freeze({
  not_calculated: 'not_calculated',
  calculating: 'calculating',
  calculated: 'calculated',
  no_fee: 'no_fee',
  error: 'error',
})

export function efilingId(prefix = 'efiling') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function filingModeLabel(mode) {
  return EFILING_MODES[mode]?.label || String(mode || '')
}

export function isEfilingMode(mode) {
  return Object.hasOwn(EFILING_MODES, mode)
}

export function isServiceMode(mode) {
  return Boolean(EFILING_MODES[mode]?.serviceRequired)
}

export function createEmptyEfilingDraft(overrides = {}) {
  const now = new Date().toISOString()
  return {
    id: efilingId('draft'),
    schemaVersion: EFILING_SCHEMA_VERSION,
    matterId: '',
    documentId: '',
    selectedDocumentName: '',
    selectedDocumentUrlOrPath: '',
    filingMode: '',
    jurisdictionState: EFILING_JURISDICTION_STATE,
    county: '',
    court: '',
    courtLocationId: '',
    causeNumber: '',
    caseCategory: '',
    caseType: '',
    caseId: '',
    filerUserId: '',
    filingAttorneyId: '',
    filingAttorneyName: '',
    filingAttorneyBarNumber: '',
    filingCode: '',
    filingCodeId: '',
    filingDescription: '',
    documentSecurity: 'public',
    leadDocumentId: '',
    attachments: [],
    serviceRecipients: [],
    serviceContacts: [],
    excludedRecipients: [],
    serviceContactValidationStatus: EFILING_SERVICE_CONTACT_STATUS.unvalidated,
    paymentAccountId: '',
    paymentAccountLabel: '',
    feeCalculationStatus: EFILING_FEE_STATUS.not_calculated,
    estimatedFees: 0,
    feeBreakdown: [],
    feeWaiver: false,
    initialFiling: false,
    target: 'mock',
    validationStatus: EFILING_VALIDATION_STATUS.incomplete,
    validationIssues: [],
    tylerEnvelopeId: '',
    tylerFilingId: '',
    tylerStatus: '',
    tylerStatusLastCheckedAt: '',
    tylerRejectionReason: '',
    stampedDocumentUrl: '',
    receiptUrl: '',
    createdAt: now,
    updatedAt: now,
    submittedAt: '',
    acceptedAt: '',
    rejectedAt: '',
    ...overrides,
  }
}
