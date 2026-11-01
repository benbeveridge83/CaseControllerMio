import test from 'node:test'
import assert from 'node:assert/strict'
import { composeOutgoingRequests } from '../src/discoveryRelief/compose.js'
import { exactDuplicateKey } from '../src/discoveryRelief/dedupe.js'

// Ellis-like pilot: our relief is 50-50 possession and neither parent paying support.
const library = [
  { id: 'lib-income', type: 'rfp', text: 'Produce all documents reflecting your income and earning capacity for the last twelve months.' },
  { id: 'lib-schedule', type: 'roggs', text: 'Describe your proposed work and caregiving schedule and the exchange logistics you propose.' },
  { id: 'lib-general-contacts', type: 'roggs', text: 'Identify every person with knowledge of relevant facts and describe what each knows.' }
]

const mappings = [
  // The same income item supports both the support and the possession options.
  { id: 'map-income-support', option_id: 'rr-support', source_side: 'ours', library_item_id: 'lib-income' },
  { id: 'map-income-possession', option_id: 'rr-possession-schedule', source_side: 'ours', library_item_id: 'lib-income' },
  { id: 'map-schedule', option_id: 'rr-possession-schedule', source_side: 'ours', library_item_id: 'lib-schedule' }
]

const groups = [
  { id: 'g-support', kind: 'relief', label: 'Support — neither parent pays', option_id: 'rr-support', issue_id: 'rr-support', source_side: 'ours', roles: { responding: 'Opposing Party' } },
  { id: 'g-possession', kind: 'relief', label: 'Possession Schedule — 50/50', option_id: 'rr-possession-schedule', issue_id: 'rr-possession-access', source_side: 'ours', roles: { responding: 'Opposing Party' } },
  { id: 'g-general', kind: 'general', label: 'General discovery', source_side: 'ours' }
]

test('a shared request appears once and is referenced under the other relief', () => {
  const result = composeOutgoingRequests({ groups, mappings, library, general: [{ id: 'lib-general-contacts' }] })
  const incomeRequests = result.included.filter((r) => r.item_id === 'lib-income')
  assert.equal(incomeRequests.length, 1)
  assert.equal(incomeRequests[0].number, 1)
  // The retained request carries relief links for both reliefs.
  assert.equal(incomeRequests[0].relief_links.length, 2)
  assert.ok(incomeRequests[0].relief_links.some((link) => link.group_id === 'g-support'))
  assert.ok(incomeRequests[0].relief_links.some((link) => link.group_id === 'g-possession'))

  const support = result.groups.find((g) => g.id === 'g-support')
  const possession = result.groups.find((g) => g.id === 'g-possession')
  assert.equal(support.requests.some((r) => r.item_id === 'lib-income'), true)
  // The duplicate is a muted reference under the second relief, not a request.
  assert.equal(possession.requests.some((r) => r.item_id === 'lib-income'), false)
  assert.equal(possession.references.some((ref) => ref.item_id === 'lib-income'), true)

  const duplicateRefs = result.groups.flatMap((g) => g.references).filter((ref) => ref.item_id === 'lib-income')
  assert.equal(duplicateRefs.length, 1)
  assert.match(duplicateRefs[0].reason, /RFP 1/)
})

test('requests are numbered independently per instrument type', () => {
  const result = composeOutgoingRequests({ groups, mappings, library, general: [{ id: 'lib-general-contacts' }] })
  const rfp = result.included.filter((r) => r.type === 'rfp')
  const roggs = result.included.filter((r) => r.type === 'roggs')
  assert.equal(rfp.length, 1)
  assert.equal(roggs.length, 2) // schedule + general contacts
  assert.deepEqual(rfp.map((r) => r.number), [1])
  assert.deepEqual(roggs.map((r) => r.number), [1, 2])
  assert.equal(result.counts.rfp, 1)
  assert.equal(result.counts.roggs, 2)
})

test('the General group contributes requests with no relief link', () => {
  const result = composeOutgoingRequests({ groups, mappings, library, general: [{ id: 'lib-general-contacts' }] })
  const general = result.groups.find((g) => g.kind === 'general')
  assert.ok(general)
  assert.equal(general.requests.length, 1)
  assert.equal(general.requests[0].item_id, 'lib-general-contacts')
  assert.equal(general.requests[0].relief_links[0].issue_id, '')
  assert.equal(general.requests[0].relief_links[0].option_id, '')
})

test('theirs-side mappings do not leak into ours groups', () => {
  const result = composeOutgoingRequests({
    groups,
    mappings: [
      ...mappings,
      { id: 'map-theirs', option_id: 'rr-support', source_side: 'theirs', library_item_id: 'lib-schedule' }
    ],
    library,
    general: []
  })
  const support = result.groups.find((g) => g.id === 'g-support')
  assert.equal(support.requests.some((r) => r.item_id === 'lib-schedule'), false)
})

test('persisted selections toggle off a request and edit another, renumbering output', () => {
  const incomeKey = exactDuplicateKey({ type: 'rfp', text: 'Produce all documents reflecting your income and earning capacity for the last twelve months.', recipient: 'Opposing Party', timePeriod: '', scope: '' })
  const scheduleKey = exactDuplicateKey({ type: 'roggs', text: 'Describe your proposed work and caregiving schedule and the exchange logistics you propose.', recipient: 'Opposing Party', timePeriod: '', scope: '' })
  const result = composeOutgoingRequests({
    groups, mappings, library, general: [{ id: 'lib-general-contacts' }],
    selections: [
      { key: incomeKey, included: false },
      { key: scheduleKey, text: 'Describe your proposed work schedule (edited).' }
    ]
  })
  assert.equal(result.included.some((r) => r.item_id === 'lib-income'), false)
  assert.ok(!result.counts.rfp)
  const schedule = result.included.find((r) => r.item_id === 'lib-schedule')
  assert.ok(schedule)
  assert.equal(schedule.text, 'Describe your proposed work schedule (edited).')
  assert.equal(schedule.number, 1)
  assert.equal(result.counts.roggs, 2)
})
