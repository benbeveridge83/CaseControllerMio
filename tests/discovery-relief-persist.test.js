import test from 'node:test'
import assert from 'node:assert/strict'
import { discoverySetKey, emptyMatterDiscoverySet, normalizeMatterDiscoverySet, normalizeSelection } from '../src/discoveryRelief/persist.js'

test('discoverySetKey separates matter and direction', () => {
  assert.equal(discoverySetKey('matter-a', 'requests'), 'caseMioDiscoveryReliefSetV1:matter-a:requests')
  assert.equal(discoverySetKey('matter-a', 'responses'), 'caseMioDiscoveryReliefSetV1:matter-a:responses')
})

test('emptyMatterDiscoverySet has sensible defaults', () => {
  const set = emptyMatterDiscoverySet({ matterId: 'matter-a', direction: 'requests' })
  assert.equal(set.matter_id, 'matter-a')
  assert.equal(set.direction, 'requests')
  assert.equal(set.status, 'selected')
  assert.deepEqual(set.selections, [])
})

test('normalizeMatterDiscoverySet coerces fields and preserves selections', () => {
  const set = normalizeMatterDiscoverySet({ matter_id: 'matter-a', status: 'bogus', track_ids: [1, 'x'], selections: [{ key: 'k' }] })
  assert.equal(set.status, 'selected')
  assert.deepEqual(set.track_ids, ['1', 'x'])
  assert.equal(set.selections.length, 1)
})

test('normalizeSelection distinguishes matter-only origin', () => {
  const lib = normalizeSelection({ key: 'a', item_id: 'i', origin: 'library' })
  const matter = normalizeSelection({ key: 'b', item_id: 'i', origin: 'matter' })
  assert.equal(lib.origin, 'library')
  assert.equal(matter.origin, 'matter')
  assert.equal(matter.included, true)
})
