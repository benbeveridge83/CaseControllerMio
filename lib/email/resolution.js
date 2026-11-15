// Per-category resolution for email dashboard messages.
//
// A message keeps its single source identity (the provider message id) even
// when it appears under several categories. Resolution is stored per
// (message, category) so resolving one category leaves the others pending, and
// the state survives reloads because it is persisted by the server.

export function resolutionKey(messageId, category) {
  return `${String(messageId)}::${String(category)}`
}

export function categoryStatesFor(message = {}, categories = [], resolutions = {}) {
  const messageId = message.id || message.messageId || ''
  return (Array.isArray(categories) ? categories : []).map((category) => {
    const entry = resolutions[resolutionKey(messageId, category)] || {}
    return { category, resolved: Boolean(entry.resolved), resolvedAt: entry.resolvedAt || null }
  })
}

export function isResolved(resolutions = {}, messageId, category) {
  const entry = resolutions[resolutionKey(messageId, category)]
  return Boolean(entry?.resolved)
}

export function setResolved(resolutions = {}, messageId, category, resolved, resolvedAt = null) {
  const key = resolutionKey(messageId, category)
  const next = { ...resolutions }
  if (resolved) {
    next[key] = { messageId: String(messageId), category, resolved: true, resolvedAt: resolvedAt || new Date().toISOString() }
  } else {
    delete next[key]
  }
  return next
}

export function toIndex(rows = []) {
  const index = {}
  for (const row of rows || []) {
    const messageId = row.message_id ?? row.messageId ?? ''
    const category = row.category ?? ''
    index[resolutionKey(messageId, category)] = {
      messageId,
      category,
      resolved: Boolean(row.resolved),
      resolvedAt: row.resolved_at || row.resolvedAt || null,
    }
  }
  return index
}

export function openCount(messageId, categories = [], resolutions = {}) {
  return categoryStatesFor({ id: messageId }, categories, resolutions).filter((state) => !state.resolved).length
}

export function isFullyResolved(message = {}, categories = [], resolutions = {}) {
  const states = categoryStatesFor(message, categories, resolutions)
  return states.length > 0 && states.every((state) => state.resolved)
}
