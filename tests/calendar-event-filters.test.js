import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CALENDAR_SHOW_ALL,
  calendarEventMatchesStatusFilters,
  calendarStatusFilterShows,
  calendarStatusHiddenEventCount
} from '../src/mioCalendarEventFilters.js'

const caseOptions = ['Open', 'Closed - Final']
const matterOptions = ['Active', 'Closed']

test('a blank status value is never filtered out by a status filter', () => {
  assert.equal(calendarStatusFilterShows(null, caseOptions, ''), true)
  assert.equal(calendarStatusFilterShows(['Open'], caseOptions, ''), true)
  assert.equal(calendarStatusFilterShows([], caseOptions, ''), true, 'a blank value cannot be the explicitly de-selected value')
  assert.equal(calendarStatusFilterShows(undefined, matterOptions, '   '), true)
})

test('the calendar keeps its hide-closed default and still respects explicit selections', () => {
  assert.equal(calendarStatusFilterShows(null, caseOptions, 'Open'), true)
  assert.equal(calendarStatusFilterShows(null, caseOptions, 'Closed - Final'), false, 'unconfigured filter hides closed matters')
  assert.equal(calendarStatusFilterShows(['Open'], caseOptions, 'Closed - Final'), false, 'a de-selected known status stays hidden')
  assert.equal(calendarStatusFilterShows([CALENDAR_SHOW_ALL], caseOptions, 'Closed - Final'), true, 'Show all overrides the hide-closed default')
})

test('selecting every known status behaves exactly like all', () => {
  assert.equal(calendarStatusFilterShows(['Open', 'Closed - Final'], caseOptions, 'Closed - Final'), true)
  assert.equal(calendarStatusFilterShows([], caseOptions, 'Open'), false, 'None hides every statused event')
  assert.equal(calendarStatusFilterShows([CALENDAR_SHOW_ALL], [], 'anything'), true, 'no known options can never hide a row')
})

test('an event whose matter is missing is never hidden by a status filter', () => {
  assert.equal(calendarEventMatchesStatusFilters({ matter: null, caseFilter: [], matterFilter: [], caseOptions, matterOptions }), true)
  assert.equal(calendarEventMatchesStatusFilters({ matter: undefined, caseFilter: ['Open'], matterFilter: ['Active'], caseOptions, matterOptions }), true)
})

test('matter and case status filters both apply to a known matter', () => {
  const matter = { case_status: 'Open', matter_status: 'Active' }
  assert.equal(calendarEventMatchesStatusFilters({ matter, caseFilter: null, matterFilter: null, caseOptions, matterOptions }), true)
  assert.equal(calendarEventMatchesStatusFilters({ matter, caseFilter: null, matterFilter: ['Closed'], caseOptions, matterOptions }), false)
  assert.equal(calendarEventMatchesStatusFilters({ matter, caseFilter: [CALENDAR_SHOW_ALL], matterFilter: [CALENDAR_SHOW_ALL], caseOptions, matterOptions }), true)
  assert.equal(calendarEventMatchesStatusFilters({ matter: { case_status: 'Open', matter_status: '' }, caseFilter: ['Open'], matterFilter: ['Closed'], caseOptions, matterOptions }), true)
})

test('counts only in-range events that the status filters hide', () => {
  const events = [
    { id: 'closed', start_date: '2026-09-21', matter_id: 'm-closed' },
    { id: 'open', start_date: '2026-09-21', matter_id: 'm-open' },
    { id: 'other-month', start_date: '2026-11-04', matter_id: 'm-closed' },
    { id: 'undated', start_date: '1900-01-01', matter_id: 'm-closed' },
    { id: 'no-matter', start_date: '2026-09-21', matter_id: '' }
  ]
  const matters = new Map([['m-closed', { case_status: 'Closed - Final', matter_status: 'Closed' }], ['m-open', { case_status: 'Open', matter_status: 'Active' }]])
  const hidden = calendarStatusHiddenEventCount({
    events,
    matterFor: (event) => matters.get(event.matter_id) || null,
    caseFilter: null,
    matterFilter: null,
    caseOptions,
    matterOptions,
    includes: (event) => event.start_date.startsWith('2026-09')
  })
  assert.equal(hidden, 1)
})
