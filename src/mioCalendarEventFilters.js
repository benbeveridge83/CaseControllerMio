import { caseFilterMatches, caseFilterValues } from './mioStickyFilterValues.js'

export const CALENDAR_SHOW_ALL = '__all__'

function normalizedOptions(options = []) {
  return options.map((option) => (typeof option === 'object' ? option.value ?? option.name : option)).map((value) => String(value ?? ''))
}

function statusText(value) {
  return String(value ?? '').trim()
}

// A status filter may only hide an event whose status value is known and was
// explicitly de-selected. A blank status means the matter record is incomplete,
// not that the user filtered it out; hiding those rows made events created from
// Notification of Service look like they never reached the calendar.
export function calendarStatusFilterShows(selected, options, status) {
  const all = normalizedOptions(options)
  const value = statusText(status)
  if (!value) return true
  const selectedValues = caseFilterValues(selected, all)
  if (Array.isArray(selected) && selected.includes(CALENDAR_SHOW_ALL)) return true
  // "Every known status is selected" behaves exactly like All.
  if (selectedValues.length >= all.length) return true
  return caseFilterMatches(selectedValues, value)
}

export function calendarEventMatchesStatusFilters({ matter, caseFilter, matterFilter, caseOptions = [], matterOptions = [] }) {
  // An event whose matter is not in the loaded matter list cannot be filtered by
  // a status value, so it stays visible instead of vanishing from the calendar.
  if (!matter) return true
  if (!calendarStatusFilterShows(caseFilter, caseOptions, matter.case_status)) return false
  if (!calendarStatusFilterShows(matterFilter, matterOptions, matter.matter_status)) return false
  return true
}

export function calendarStatusHiddenEventCount({ events = [], matterFor, caseFilter, matterFilter, caseOptions = [], matterOptions = [], includes = () => true }) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!includes(event)) return false
    return !calendarEventMatchesStatusFilters({
      matter: (matterFor ? matterFor(event) : null) || null,
      caseFilter,
      matterFilter,
      caseOptions,
      matterOptions
    })
  }).length
}
