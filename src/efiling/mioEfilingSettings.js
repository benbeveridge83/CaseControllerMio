// Default E-Filing settings model. These are placeholders until Tyler Customer
// Portal, X.509 certificate, Stage account, and TOGA configuration are complete.
// No secret credential is ever stored here; only non-secret status and reference
// values (names, IDs, URLs) are kept, mirroring the existing Process Builder rule.

export const EFILING_SETTINGS_SCHEMA_VERSION = 'efiling-settings-v1'

export const EFILING_CERTIFICATE_STATUS = Object.freeze({
  pending: 'pending',
  requested: 'requested',
  ready: 'ready',
  rejected: 'rejected',
})

export function createDefaultEfilingSettings(overrides = {}) {
  return {
    schemaVersion: EFILING_SETTINGS_SCHEMA_VERSION,
    efspName: '',
    jurisdictionState: 'TX',
    stageOrProduction: 'stage',
    stageBaseUrl: '',
    productionBaseUrl: '',
    certificateStatus: EFILING_CERTIFICATE_STATUS.pending,
    callbackUrl: '',
    defaultFilingAttorneyId: '',
    defaultFilingAttorneyName: '',
    defaultFilingAttorneyBarNumber: '',
    defaultPaymentAccountId: '',
    defaultPaymentAccountLabel: '',
    serviceBehavior: 'efile_and_serve',
    courtCountyMappings: [],
    filingCodeMappings: [],
    stageAccountConfigured: false,
    toGaConfigured: false,
    productionEnabled: false,
    ...overrides,
  }
}

export function normalizeEfilingSettings(settings = {}) {
  return {
    ...createDefaultEfilingSettings(),
    ...(settings || {}),
    courtCountyMappings: Array.isArray(settings?.courtCountyMappings) ? settings.courtCountyMappings : [],
    filingCodeMappings: Array.isArray(settings?.filingCodeMappings) ? settings.filingCodeMappings : [],
  }
}
