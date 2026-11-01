import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReliefGroups, reliefOptionIssueId, reliefOptionPath } from '../src/discoveryRelief/buildReliefGroups.js'

const options = [
  { id: 'rr-substantive', parent_id: '', name: 'Substantive', is_relief_option: false },
  { id: 'rr-sapcr', parent_id: 'rr-substantive', name: 'SAPCR', is_relief_option: false },
  { id: 'rr-possession-access', parent_id: 'rr-sapcr', name: 'Possession and Access', is_relief_option: false },
  { id: 'rr-support', parent_id: 'rr-sapcr', name: 'Support', is_relief_option: false },
  { id: 'opt-5050', parent_id: 'rr-possession-access', name: '50/50 possession', is_relief_option: true },
  { id: 'opt-neither-pays', parent_id: 'rr-support', name: 'Neither parent pays', is_relief_option: true }
]

const parties = [
  { id: 'p-client', label: 'Client', name: 'Jane Client', source: 'client' },
  { id: 'p-opp', label: 'Opposing Party', name: 'John Opposing', source: 'opposing' }
]

const reliefs = [
  { id: 'relief-1', matter_id: 'matter-a', relief_type: 'client_relief', name: 'My relief', selected_option_ids: ['opt-5050', 'opt-neither-pays'], litigation_track_id: 'track-1' },
  { id: 'relief-2', matter_id: 'matter-a', relief_type: 'opposing_relief', name: 'Their relief', selected_option_ids: [], litigation_track_id: 'track-1' },
  { id: 'relief-3', matter_id: 'other-matter', relief_type: 'client_relief', name: 'Other', selected_option_ids: ['opt-5050'] }
]

test('buildReliefGroups emits one group per selected option on the requested side', () => {
  const groups = buildReliefGroups({ reliefs, options, matterId: 'matter-a', direction: 'ours', parties })
  assert.equal(groups.length, 2)
  const byOption = Object.fromEntries(groups.map((g) => [g.option_id, g]))
  assert.ok(byOption['opt-5050'])
  assert.ok(byOption['opt-neither-pays'])
})

test('each group carries its issue, ancestor issues, roles, and track', () => {
  const groups = buildReliefGroups({ reliefs, options, matterId: 'matter-a', direction: 'ours', parties })
  const possession = groups.find((g) => g.option_id === 'opt-5050')
  assert.equal(possession.issue_id, 'rr-possession-access')
  assert.ok(possession.issue_ids.includes('rr-possession-access'))
  assert.ok(possession.issue_ids.includes('rr-sapcr'))
  assert.equal(possession.source_side, 'ours')
  assert.equal(possession.roles.requesting, 'Jane Client')
  assert.equal(possession.roles.responding, 'John Opposing')
  assert.equal(possession.track_id, 'track-1')
})

test('opposing relief is excluded from ours and shown as an unmapped group for theirs', () => {
  const ours = buildReliefGroups({ reliefs, options, matterId: 'matter-a', direction: 'ours', parties })
  assert.ok(!ours.some((g) => g.label.includes('Their relief')))

  const theirs = buildReliefGroups({ reliefs, options, matterId: 'matter-a', direction: 'theirs', parties })
  assert.equal(theirs.length, 1)
  assert.equal(theirs[0].id, 'relief-relief-2-unmapped')
  assert.equal(theirs[0].option_id, '')
  assert.equal(theirs[0].source_side, 'theirs')
})

test('relief from another matter is excluded', () => {
  const groups = buildReliefGroups({ reliefs, options, matterId: 'matter-a', direction: 'ours', parties })
  assert.ok(!groups.some((g) => g.id.includes('relief-3')))
})

test('reliefOptionIssueId and reliefOptionPath resolve the hierarchy', () => {
  assert.equal(reliefOptionIssueId('opt-5050', options), 'rr-possession-access')
  assert.equal(reliefOptionPath('opt-neither-pays', options), 'Substantive > SAPCR > Support > Neither parent pays')
})
