import test from 'node:test'
import assert from 'node:assert/strict'
import { readEfilingFlags, assessSubmitReadiness, assertEfilingSubmissionAllowed, stageCredentialsPresent } from '../src/efiling/mioEfilingFlags.js'

test('flags default to mock-only safety', () => {
  const flags = readEfilingFlags({})
  assert.equal(flags.EFILING_ENABLED, true)
  assert.equal(flags.TYLER_EFM_STAGE_ENABLED, false)
  assert.equal(flags.TYLER_EFM_PRODUCTION_ENABLED, false)
  const assessment = assessSubmitReadiness(flags, {})
  assert.equal(assessment.allowed.mock, true)
  assert.equal(assessment.allowed.stage, false)
  assert.equal(assessment.allowed.production, false)
})

test('stage requires flag plus credentials', () => {
  const flags = readEfilingFlags({ TYLER_EFM_STAGE_ENABLED: true })
  const incomplete = assessSubmitReadiness(flags, { certificateStatus: 'pending', stageBaseUrl: '', stageAccountConfigured: false })
  assert.equal(incomplete.allowed.stage, false)
  const complete = assessSubmitReadiness(flags, { certificateStatus: 'ready', stageBaseUrl: 'https://stage.example', stageAccountConfigured: true })
  assert.equal(complete.allowed.stage, true)
})

test('production is never possible without explicit production config', () => {
  const flags = readEfilingFlags({ TYLER_EFM_PRODUCTION_ENABLED: true })
  const assessment = assessSubmitReadiness(flags, { productionEnabled: false, productionBaseUrl: '', certificateStatus: 'ready', toGaConfigured: false })
  assert.equal(assessment.allowed.production, false)
  assert.throws(() => assertEfilingSubmissionAllowed('production', flags, {}), /disabled/)
})

test('disabling e-filing blocks every target', () => {
  const assessment = assessSubmitReadiness(readEfilingFlags({ EFILING_ENABLED: false }), {})
  assert.equal(assessment.allowed.mock, false)
  assert.equal(assessment.allowed.stage, false)
  assert.equal(assessment.allowed.production, false)
  assert.equal(assessment.mode, 'disabled')
})

test('stage credentials helper', () => {
  assert.equal(stageCredentialsPresent({ certificateStatus: 'ready', stageBaseUrl: 'https://x', stageAccountConfigured: true }), true)
  assert.equal(stageCredentialsPresent({ certificateStatus: 'requested', stageBaseUrl: 'https://x', stageAccountConfigured: true }), false)
})
