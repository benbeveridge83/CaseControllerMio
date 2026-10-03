// Mock-only e-filing runtime. This is the single place that wires the mock
// provider and the in-memory repository together for the matter-page mount.
//
// It never constructs or calls the Tyler provider (createTylerEfilingProvider).
// Stage and Production submission stay gated by mioEfilingFlags.js: the runtime
// reports the readiness assessment and the panel renders those controls disabled
// until the matching flags and credentials are configured.

import { createMockEfilingProvider } from './mioEfilingProvider.js'
import { createInMemoryEfilingRepository } from './mioEfilingRepository.js'
import { readEfilingFlags, assessSubmitReadiness } from './mioEfilingFlags.js'
import { normalizeEfilingSettings } from './mioEfilingSettings.js'

export function createEfilingRuntime({ flags = {}, settings = {} } = {}) {
  const resolvedFlags = readEfilingFlags(flags)
  const resolvedSettings = normalizeEfilingSettings(settings)
  const readiness = assessSubmitReadiness(resolvedFlags, resolvedSettings)
  return {
    provider: createMockEfilingProvider(),
    repository: createInMemoryEfilingRepository(),
    flags: resolvedFlags,
    settings: resolvedSettings,
    readiness,
    enabled: resolvedFlags.EFILING_ENABLED === true,
    mode: readiness.mode,
  }
}

export function efilingMatterDocuments(documents = [], matterId = '') {
  return (Array.isArray(documents) ? documents : []).filter(
    (doc) => String(doc?.matter_id || '') === String(matterId || ''),
  )
}

export function efilingFilerFromTeamMember(teamMember = null) {
  const member = teamMember || {}
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
  return {
    userId: member.id || member.user_id || '',
    id: member.id || member.user_id || '',
    name: name || member.email || '',
    email: member.email || '',
    barNumber: member.bar_number || member.barNumber || '',
  }
}
