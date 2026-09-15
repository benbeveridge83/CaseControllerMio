function clientDisplayName(client = {}) {
  return [client?.first_name, client?.last_name].filter(Boolean).join(' ').trim()
}

function normalizedTimeValue(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute, sortValue: hour * 60 + minute }
}

export function checklistTimelineDateState(dateValue, todayValue = new Date()) {
  const date = dateValue instanceof Date ? new Date(dateValue) : new Date(dateValue)
  const today = todayValue instanceof Date ? new Date(todayValue) : new Date(todayValue)
  if (Number.isNaN(date.getTime()) || Number.isNaN(today.getTime())) return 'future'
  date.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  if (date < today) return 'past'
  if (date.getTime() === today.getTime()) return 'today'
  return 'future'
}

export function checklistTimelineHourLabel(timeValue) {
  const parsed = normalizedTimeValue(timeValue)
  if (!parsed) return ''
  return String(parsed.hour % 12 || 12)
}

export function formatChecklistTimelineTime(timeValue) {
  const parsed = normalizedTimeValue(timeValue)
  if (!parsed) return ''
  const suffix = parsed.hour >= 12 ? 'PM' : 'AM'
  const displayHour = parsed.hour % 12 || 12
  return `${String(displayHour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${suffix}`
}

export function compareChecklistTimelineEventsByTime(left = {}, right = {}) {
  const leftTime = normalizedTimeValue(left.start_time)?.sortValue ?? Number.POSITIVE_INFINITY
  const rightTime = normalizedTimeValue(right.start_time)?.sortValue ?? Number.POSITIVE_INFINITY
  return leftTime - rightTime
}

export function resolveChecklistTimelineClientName(matter = {}, clients = []) {
  const nestedClient = Array.isArray(matter?.clients) ? matter.clients[0] : matter?.clients
  const nestedName = clientDisplayName(nestedClient)
  if (nestedName) return nestedName

  const linkedClient = (clients || []).find((client) => String(client.id) === String(matter?.client_id || ''))
  return clientDisplayName(linkedClient) || String(matter?.client_name || matter?.client || '').trim()
}
