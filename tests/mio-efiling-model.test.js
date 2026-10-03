import test from 'node:test'
import assert from 'node:assert/strict'
import { createEmptyEfilingDraft, filingModeLabel, isServiceMode, isEfilingMode, EFILING_MODES } from '../src/efiling/mioEfilingModel.js'

test('empty draft has database-ready defaults', () => {
  const draft = createEmptyEfilingDraft()
  assert.equal(draft.schemaVersion, 'efiling-draft-v1')
  assert.equal(draft.jurisdictionState, 'TX')
  assert.equal(draft.filingMode, '')
  assert.equal(draft.documentSecurity, 'public')
  assert.equal(draft.feeCalculationStatus, 'not_calculated')
  assert.ok(Array.isArray(draft.attachments))
  assert.ok(Array.isArray(draft.serviceContacts))
  assert.ok(draft.id.startsWith('draft-'))
})

test('overrides win and filing mode helpers are correct', () => {
  const draft = createEmptyEfilingDraft({ filingMode: 'efile_and_serve', causeNumber: '2026-1' })
  assert.equal(draft.causeNumber, '2026-1')
  assert.equal(filingModeLabel('efile_only'), 'E-File Only')
  assert.equal(isServiceMode('efile_only'), false)
  assert.equal(isServiceMode('eserve_only'), true)
  assert.equal(isEfilingMode('nope'), false)
})

test('filing mode catalog matches the three required modes', () => {
  assert.deepEqual(Object.keys(EFILING_MODES), ['efile_only', 'efile_and_serve', 'eserve_only'])
})
