// E-Filing provider adapter interface. UI code depends on this interface only —
// it never hard-codes Tyler SOAP calls. Two implementations are provided:
//   1. createMockEfilingProvider — deterministic fake Texas data for testing.
//   2. createTylerEfilingProvider — a stub that refuses to run until credentials
//      and configuration are present.

import { efilingId, EFILING_FEE_STATUS } from './mioEfilingModel.js'

export const EFILING_PROVIDER_METHODS = Object.freeze([
  'getCourts',
  'getCase',
  'getFilingCodes',
  'getServiceInformation',
  'getPaymentAccounts',
  'calculateFees',
  'submitFiling',
  'getFilingStatus',
  'getStampedDocuments',
])

export const TYLER_EFM_NOT_CONFIGURED_MESSAGE = 'Tyler EFM credentials are not configured. Complete TCP access, X.509 certificate, Stage account, and TOGA setup before enabling live Stage calls.'

export const MOCK_PROVIDER_LABEL = 'Mock provider — no live filing occurs'

function defaultMockCourts() {
  return [
    { id: 'court-311-harris', name: '311th District Court', county: 'Harris', state: 'TX', locationId: '311' },
    { id: 'court-246-harris', name: '246th District Court', county: 'Harris', state: 'TX', locationId: '246' },
    { id: 'court-330-dallas', name: '330th District Court', county: 'Dallas', state: 'TX', locationId: '330' },
    { id: 'court-98-travis', name: '98th District Court', county: 'Travis', state: 'TX', locationId: '98' },
    { id: 'court-150-bexar', name: '150th District Court', county: 'Bexar', state: 'TX', locationId: '150' },
    { id: 'court-324-tarrant', name: '324th District Court', county: 'Tarrant', state: 'TX', locationId: '324' },
  ]
}

function defaultMockFilingCodes() {
  return [
    { id: 'fc-motion', filingCode: 'Motion', filingDescription: 'Motion', caseTypes: ['Divorce', 'SAPCR/Modification', 'DFPS', 'Other'] },
    { id: 'fc-petition', filingCode: 'Petition', filingDescription: 'Petition', caseTypes: ['Divorce', 'SAPCR/Modification', 'DFPS', 'Other'] },
    { id: 'fc-amended-petition', filingCode: 'Amended Petition', filingDescription: 'Amended Petition', caseTypes: ['Divorce', 'SAPCR/Modification'] },
    { id: 'fc-answer', filingCode: 'Answer', filingDescription: 'Original Answer', caseTypes: ['Divorce', 'SAPCR/Modification', 'DFPS'] },
    { id: 'fc-final-decree', filingCode: 'Final Decree', filingDescription: 'Final Decree of Divorce', caseTypes: ['Divorce'] },
    { id: 'fc-order', filingCode: 'Order', filingDescription: 'Order', caseTypes: ['Divorce', 'SAPCR/Modification', 'DFPS', 'Other'] },
    { id: 'fc-notice', filingCode: 'Notice', filingDescription: 'Notice of Setting', caseTypes: ['Divorce', 'SAPCR/Modification', 'DFPS', 'Other'] },
  ]
}

function defaultMockServiceContacts() {
  return [
    { id: 'svc-1', name: 'Counsel, Opposing', email: 'opposing.counsel@example.test', firm: 'Opposing Firm LLP', selected: true },
    { id: 'svc-2', name: 'Paralegal, Opposing', email: 'paralegal@example.test', firm: 'Opposing Firm LLP', selected: false },
  ]
}

function defaultMockPaymentAccounts() {
  return [
    { id: 'acct-firm-trust', label: 'Firm IOLTA Trust Account', lastFour: '•••• 1001', active: true },
    { id: 'acct-firm-operating', label: 'Firm Operating Account', lastFour: '•••• 2002', active: true },
  ]
}

export function createMockEfilingProvider(options = {}) {
  const courts = options.courts || defaultMockCourts()
  const filingCodes = options.filingCodes || defaultMockFilingCodes()
  const serviceContacts = options.serviceContacts || defaultMockServiceContacts()
  const paymentAccounts = options.paymentAccounts || defaultMockPaymentAccounts()
  const clock = options.clock || (() => new Date())

  return {
    mode: 'mock',
    label: MOCK_PROVIDER_LABEL,
    async getCourts(state = 'TX') {
      return courts.filter((court) => !state || court.state === state)
    },
    async getCase(query = '') {
      const q = String(query || '').trim().toLowerCase()
      const court = courts[0] || {}
      return {
        id: 'case-mock-1',
        causeNumber: '2026-00001',
        caseStyle: 'In the Interest of A. Child',
        courtName: court.name,
        county: court.county,
        caseType: 'SAPCR/Modification',
        matched: Boolean(q) && q.length > 2,
      }
    },
    async getFilingCodes(courtId = '', caseType = '') {
      const codes = caseType ? filingCodes.filter((code) => !code.caseTypes || code.caseTypes.includes(caseType)) : filingCodes.slice()
      return codes.map((code) => ({ ...code, courtId: String(courtId || '') }))
    },
    async getServiceInformation(caseId = '') {
      return { caseId: String(caseId || 'case-mock-1'), contacts: serviceContacts.map((contact) => ({ ...contact })) }
    },
    async getPaymentAccounts(firmId = '') {
      return paymentAccounts.map((account) => ({ ...account, firmId: String(firmId || 'firm-mock') }))
    },
    async calculateFees(draft = {}) {
      const baseFee = 15
      const serviceFee = draft.filingMode === 'efile_and_serve' || draft.filingMode === 'eserve_only' ? 5 : 0
      const filingFee = (draft.filingCode === 'Petition' || draft.filingCode === 'Amended Petition') ? 350 : 0
      const total = baseFee + serviceFee + filingFee
      return {
        status: EFILING_FEE_STATUS.calculated,
        estimatedFees: total,
        feeBreakdown: [
          { label: 'E-filing fee', amount: baseFee },
          ...(serviceFee ? [{ label: 'Service fee', amount: serviceFee }] : []),
          ...(filingFee ? [{ label: 'Court filing fee', amount: filingFee }] : []),
        ],
        calculatedAt: clock().toISOString(),
      }
    },
    async submitFiling(draft = {}) {
      const envelopeId = efilingId('envelope')
      const docRef = String(draft.documentId || draft.selectedDocumentName || 'document')
      return {
        tylerEnvelopeId: envelopeId,
        tylerFilingId: efilingId('filing'),
        tylerStatus: 'submitted',
        tylerStatusLastCheckedAt: clock().toISOString(),
        submittedAt: clock().toISOString(),
        receiptUrl: 'https://mock.example.test/receipts/' + envelopeId,
        stampedDocumentUrl: 'https://mock.example.test/stamped/' + docRef + '.pdf',
      }
    },
    async getFilingStatus(envelopeId = '') {
      return {
        tylerEnvelopeId: String(envelopeId || ''),
        tylerStatus: 'submitted',
        tylerStatusLastCheckedAt: clock().toISOString(),
        tylerRejectionReason: '',
      }
    },
    async getStampedDocuments(envelopeId = '') {
      return [{ name: 'stamped-copy.pdf', url: 'https://mock.example.test/stamped/' + envelopeId + '.pdf' }]
    },
  }
}

export function createTylerEfilingProvider(config = {}) {
  const methods = {}
  for (const method of EFILING_PROVIDER_METHODS) {
    methods[method] = async () => {
      throw new Error(TYLER_EFM_NOT_CONFIGURED_MESSAGE)
    }
  }
  return {
    mode: 'tyler',
    label: 'Tyler EFM (stub — not configured)',
    ...methods,
    config,
  }
}

