// Feature flags and safety gates for the direct Tyler EFSP integration.
// Mock mode is always available for testing. Stage and Production submission are
// disabled until explicitly enabled AND the corresponding credentials/config are
// present. This module is pure and does not read any browser or network state.

export const EFILING_FLAG_NAMES = Object.freeze([
  'EFILING_ENABLED',
  'TYLER_EFM_STAGE_ENABLED',
  'TYLER_EFM_PRODUCTION_ENABLED',
])

export const EFILING_FLAG_DEFAULTS = Object.freeze({
  EFILING_ENABLED: true,
  TYLER_EFM_STAGE_ENABLED: false,
  TYLER_EFM_PRODUCTION_ENABLED: false,
})

export function coerceEfilingBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return Boolean(fallback)
}

export function readEfilingFlags(env = {}) {
  const out = { ...EFILING_FLAG_DEFAULTS }
  for (const name of EFILING_FLAG_NAMES) {
    const raw = env[name]
    if (raw === undefined || raw === null || raw === '') continue
    out[name] = coerceEfilingBoolean(raw, EFILING_FLAG_DEFAULTS[name])
  }
  return out
}

export function stageCredentialsPresent(settings = {}) {
  return Boolean(
    settings?.certificateStatus === 'ready' &&
    String(settings?.stageBaseUrl || '').trim() &&
    settings?.stageAccountConfigured === true
  )
}

export function productionCredentialsPresent(settings = {}) {
  return Boolean(
    settings?.productionEnabled === true &&
    String(settings?.productionBaseUrl || '').trim() &&
    settings?.certificateStatus === 'ready' &&
    settings?.toGaConfigured === true
  )
}

export function assessSubmitReadiness(flags = {}, settings = {}) {
  const resolved = { ...EFILING_FLAG_DEFAULTS, ...(flags || {}) }
  const allowed = { mock: false, stage: false, production: false }
  const reasons = []
  if (!resolved.EFILING_ENABLED) {
    reasons.push('E-filing is disabled by EFILING_ENABLED.')
    return { allowed, reasons, mode: 'disabled' }
  }
  allowed.mock = true
  if (resolved.TYLER_EFM_STAGE_ENABLED) {
    if (stageCredentialsPresent(settings)) allowed.stage = true
    else reasons.push('Stage is enabled, but the X.509 certificate, Stage base URL, and Stage account configuration are incomplete.')
  } else {
    reasons.push('Tyler Stage submission is disabled until TYLER_EFM_STAGE_ENABLED is set and Stage credentials are configured.')
  }
  if (resolved.TYLER_EFM_PRODUCTION_ENABLED) {
    if (productionCredentialsPresent(settings)) allowed.production = true
    else reasons.push('Production is enabled, but production base URL, certificate, and TOGA configuration are incomplete.')
  } else {
    reasons.push('Production submission is disabled until TYLER_EFM_PRODUCTION_ENABLED is explicitly enabled.')
  }
  const mode = allowed.production ? 'production' : allowed.stage ? 'stage' : 'mock'
  return { allowed, reasons, mode }
}

export function assertEfilingSubmissionAllowed(target, flags = {}, settings = {}) {
  const assessment = assessSubmitReadiness(flags, settings)
  if (target === 'production') {
    if (!assessment.allowed.production) throw new Error('Production submission is disabled until Tyler production credentials and configuration are explicitly enabled.')
    return assessment
  }
  if (target === 'stage') {
    if (!assessment.allowed.stage) throw new Error('Stage submission is disabled until the X.509 certificate, Stage base URL, and Stage account configuration are present.')
    return assessment
  }
  if (target === 'mock') return assessment
  throw new Error(`Unknown e-filing submission target: ${target}`)
}

export function submissionTargetLabel(target) {
  if (target === 'production') return 'Tyler Production'
  if (target === 'stage') return 'Tyler Stage'
  if (target === 'mock') return 'Mock (no live filing)'
  return String(target || '')
}
