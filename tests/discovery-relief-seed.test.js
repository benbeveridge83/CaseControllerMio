import test from 'node:test'
import assert from 'node:assert/strict'
import { SEED_GENERAL, SEED_LIBRARY, SEED_MAPPINGS } from '../src/discoveryRelief/seed.js'
import { isDiscoveryType, isSourceSide } from '../src/discoveryRelief/types.js'

test('seed library items have unique ids and valid discovery types', () => {
  const ids = new Set()
  for (const item of SEED_LIBRARY) {
    assert.ok(!ids.has(item.id), `duplicate seed id ${item.id}`)
    ids.add(item.id)
    assert.ok(isDiscoveryType(item.type), `${item.id} has invalid type`)
    assert.ok(item.text.trim().length > 0, `${item.id} has empty text`)
  }
})

test('every seed mapping references a real library item and a valid side', () => {
  const ids = new Set(SEED_LIBRARY.map((item) => item.id))
  for (const mapping of SEED_MAPPINGS) {
    assert.ok(ids.has(mapping.library_item_id), `mapping references unknown item ${mapping.library_item_id}`)
    assert.ok(isSourceSide(mapping.source_side), 'mapping has invalid source side')
    assert.ok(mapping.issue_id, 'mapping is missing an issue id')
  }
})

test('every general seed references a real library item', () => {
  const ids = new Set(SEED_LIBRARY.map((item) => item.id))
  for (const ref of SEED_GENERAL) {
    assert.ok(ids.has(ref.id), `general references unknown item ${ref.id}`)
  }
})

test('the seed composes for the Ellis possession + support groups', async () => {
  const { composeOutgoingRequests } = await import('../src/discoveryRelief/compose.js')
  const groups = [
    { id: 'g-possession', kind: 'relief', label: 'Possession — 50/50', issue_id: 'rr-possession-access', option_id: 'rr-possession-schedule', source_side: 'ours', roles: { responding: 'Opposing Party' } },
    { id: 'g-support', kind: 'relief', label: 'Support — neither parent pays', issue_id: 'rr-support', option_id: 'rr-support', source_side: 'ours', roles: { responding: 'Opposing Party' } },
    { id: 'g-general', kind: 'general', label: 'General discovery', source_side: 'ours' }
  ]
  const result = composeOutgoingRequests({ groups, mappings: SEED_MAPPINGS, library: SEED_LIBRARY, general: SEED_GENERAL })
  assert.equal(result.included.length, SEED_LIBRARY.length)
  assert.equal(result.counts.roggs, 4)
  assert.equal(result.counts.rfp, 4)
})
