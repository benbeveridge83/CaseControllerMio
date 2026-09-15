import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checklistTimelineDateState,
  checklistTimelineHourLabel,
  compareChecklistTimelineEventsByTime,
  formatChecklistTimelineTime,
  resolveChecklistTimelineClientName
} from '../src/mioChecklistTimeline.js'

test('classifies checklist dates relative to today without considering the clock time', () => {
  const today = new Date(2026, 8, 15, 14, 30)

  assert.equal(checklistTimelineDateState(new Date(2026, 8, 14, 23, 59), today), 'past')
  assert.equal(checklistTimelineDateState(new Date(2026, 8, 15, 0, 1), today), 'today')
  assert.equal(checklistTimelineDateState(new Date(2026, 8, 16, 0, 0), today), 'future')
})

test('shows only the unpadded event hour in the bottom circle', () => {
  assert.equal(checklistTimelineHourLabel('09:30'), '9')
  assert.equal(checklistTimelineHourLabel('10:00:00'), '10')
  assert.equal(checklistTimelineHourLabel('12:45'), '12')
  assert.equal(checklistTimelineHourLabel('00:15'), '12')
  assert.equal(checklistTimelineHourLabel(''), '')
})

test('formats the full start time for hover details', () => {
  assert.equal(formatChecklistTimelineTime('09:30'), '09:30 AM')
  assert.equal(formatChecklistTimelineTime('14:05:00'), '02:05 PM')
  assert.equal(formatChecklistTimelineTime(''), '')
})

test('sorts same-day events from earliest to latest and leaves untimed events last', () => {
  const events = [
    { id: 'untimed', start_time: '' },
    { id: 'noon', start_time: '12:00' },
    { id: 'nine', start_time: '09:30' },
    { id: 'ten', start_time: '10:00' }
  ]

  assert.deepEqual(events.toSorted(compareChecklistTimelineEventsByTime).map((event) => event.id), [
    'nine',
    'ten',
    'noon',
    'untimed'
  ])
})

test('resolves the client already nested on a calendar event matter', () => {
  const matter = { clients: { first_name: 'Briana', last_name: 'Gordon' } }

  assert.equal(resolveChecklistTimelineClientName(matter, []), 'Briana Gordon')
})

test('falls back to the client collection and legacy matter client fields', () => {
  assert.equal(
    resolveChecklistTimelineClientName(
      { client_id: 'client-2' },
      [{ id: 'client-2', first_name: 'Matt', last_name: 'Murski' }]
    ),
    'Matt Murski'
  )
  assert.equal(resolveChecklistTimelineClientName({ client_name: 'Legacy Client' }, []), 'Legacy Client')
})
