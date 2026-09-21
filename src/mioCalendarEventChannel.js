// Cross-tab calendar invalidation. Messages carry no case data: an open calendar
// only learns that it should re-read calendar_events from Supabase.
export function createMioCalendarEventChannel({ Channel = globalThis.BroadcastChannel, channelName = 'mio-calendar-events-v321' } = {}) {
  const listeners = new Set()
  let closed = false
  const channel = typeof Channel === 'function' ? new Channel(channelName) : null
  channel?.unref?.()
  if (channel) {
    channel.onmessage = ({ data }) => {
      if (closed || data?.type !== 'calendar-changed') return
      listeners.forEach((listener) => {
        try { listener() } catch { /* one stale view must not block the others */ }
      })
    }
  }
  return {
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify() {
      if (closed) return false
      try { channel?.postMessage({ type: 'calendar-changed' }) } catch { return false }
      return Boolean(channel)
    },
    close() {
      closed = true
      listeners.clear()
      channel?.close()
    }
  }
}

export const mioCalendarEventChannel = createMioCalendarEventChannel()
