// Background mail sync primitives: idempotent delta reconciliation and
// change-notification handling. Pure and provider-agnostic (no side effects).

export function createDeltaTracker({ cursor = null, seen = new Set() } = {}) {
  let currentCursor = cursor
  const seenIds = new Set(seen)

  function applyDeltaPage(page = {}) {
    const messages = Array.isArray(page.value) ? page.value : []
    const added = []
    for (const message of messages) {
      const id = message?.id
      if (!id || seenIds.has(id)) continue
      seenIds.add(id)
      added.push(message)
    }
    if (typeof page['@odata.nextLink'] === 'string') currentCursor = page['@odata.nextLink']
    else if (typeof page['@odata.deltaLink'] === 'string') currentCursor = page['@odata.deltaLink']
    return { added, cursor: currentCursor }
  }

  return Object.freeze({
    applyDeltaPage,
    cursor: () => currentCursor,
    hasSeen: (id) => seenIds.has(id)
  })
}

export function classifyNotification(notification = {}) {
  const resourceData = notification.resourceData || notification.resource || {}
  return {
    changeType: notification.changeType || '',
    resource: notification.resource || '',
    id: resourceData.id || '',
    clientState: notification.clientState || '',
    subscriptionId: notification.subscriptionId || ''
  }
}

// A duplicate or out-of-order notification must not produce a duplicate action.
export function isDuplicateNotification(notification, seenIds) {
  const { id, changeType } = classifyNotification(notification)
  if (!id || !changeType) return true
  const key = `${changeType}:${id}`
  if (seenIds.has(key)) return true
  seenIds.add(key)
  return false
}
