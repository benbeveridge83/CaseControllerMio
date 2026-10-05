import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createEfilingRuntime, efilingMatterDocuments, efilingFilerFromTeamMember } from '../src/efiling/mioEfilingRuntime.js'
import { applyEfilingMount } from '../mio-v326-efiling-mount.js'

test('runtime wires the mock provider and in-memory repository and never enables live submission', () => {
  const runtime = createEfilingRuntime({})
  assert.equal(runtime.enabled, true)
  assert.equal(runtime.mode, 'mock')
  assert.equal(runtime.provider.mode, 'mock')
  assert.equal(runtime.repository.mode, 'memory')
  assert.equal(runtime.readiness.allowed.mock, true)
  assert.equal(runtime.readiness.allowed.stage, false)
  assert.equal(runtime.readiness.allowed.production, false)
})

test('runtime respects EFILING_ENABLED=false', () => {
  const runtime = createEfilingRuntime({ flags: { EFILING_ENABLED: false } })
  assert.equal(runtime.enabled, false)
  assert.equal(runtime.readiness.mode, 'disabled')
  assert.equal(runtime.readiness.allowed.mock, false)
})

test('matter documents are filtered to a single matter', () => {
  const docs = [
    { id: 'd1', matter_id: 'm-1' },
    { id: 'd2', matter_id: 'm-2' },
    { id: 'd3', matter_id: 'm-1' },
  ]
  assert.deepEqual(efilingMatterDocuments(docs, 'm-1').map((doc) => doc.id), ['d1', 'd3'])
  assert.deepEqual(efilingMatterDocuments(docs, 'm-2').map((doc) => doc.id), ['d2'])
  assert.deepEqual(efilingMatterDocuments(docs, ''), [])
})

test('filer is derived from a team member', () => {
  const filer = efilingFilerFromTeamMember({ id: 't-1', first_name: 'Ben', last_name: 'Attorney', email: 'ben@example.test', bar_number: '24000000' })
  assert.equal(filer.userId, 't-1')
  assert.equal(filer.name, 'Ben Attorney')
  assert.equal(filer.email, 'ben@example.test')
  assert.equal(filer.barNumber, '24000000')
  assert.deepEqual(efilingFilerFromTeamMember(null), { userId: '', id: '', name: '', email: '', barNumber: '' })
})

test('mount transform injects the panel and the mock runtime into App.jsx', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/App.jsx', import.meta.url)), 'utf8')
  const transformed = applyEfilingMount(source)
  assert.ok(transformed.includes("import MioEfilingPanel from './efiling/MioEfilingPanel.jsx'"))
  assert.ok(transformed.includes('const mioEfilingRuntime = createEfilingRuntime('))
  assert.ok(transformed.includes('<MioEfilingPanel'))
  assert.ok(transformed.includes('provider={mioEfilingRuntime.provider}'))
  assert.ok(transformed.includes('repository={mioEfilingRuntime.repository}'))
  // The existing filings panel render must survive alongside the new mount.
  assert.ok(transformed.includes('renderMatterFilingsPanel(selectedTemplateMatter())'))
  // Idempotency: a second pass must refuse to double-mount.
  assert.throws(() => applyEfilingMount(transformed), /ran twice/)
})
