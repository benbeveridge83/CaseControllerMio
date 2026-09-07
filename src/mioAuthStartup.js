// Subscribe only after SDK initialization. Never await Supabase work inside an auth callback.
// No token reads, storage deletion, offline defaults, or authentication bypasses here.
export function observeMioAuth(auth, { onSession, onError, timeoutMs = 15000 }) {
  let active = true
  let sessionReceived = false
  let authEventReceived = false
  let subscription
  const pending = new Set()
  const report = error => {
    if (active && !sessionReceived) onError(error instanceof Error ? error : new Error(String(error)))
  }
  const watchdog = setTimeout(() => report(new Error(
    'Sign-in verification timed out. Retry to reload sign-in; no saved records have been changed.'
  )), timeoutMs)
  const deliver = session => {
    if (!active) return
    sessionReceived = true
    clearTimeout(watchdog)
    onSession(session || null)
  }
  const enqueue = session => {
    const timer = setTimeout(() => { pending.delete(timer); deliver(session) }, 0)
    pending.add(timer)
  }
  void (async () => {
    const result = await auth.getSession()
    if (!active) return
    if (result.error) throw result.error
    // Registering during an expiring session's initialization caused the old SDK
    // to deadlock. Keep this ordering even with the fixed, lockless SDK.
    subscription = auth.onAuthStateChange((_event, session) => {
      authEventReceived = true
      enqueue(session)
    }).data.subscription
    if (!authEventReceived) deliver(result.data?.session)
  })().catch(error => { clearTimeout(watchdog); report(error) })
  return () => {
    active = false
    clearTimeout(watchdog)
    pending.forEach(clearTimeout)
    pending.clear()
    subscription?.unsubscribe()
  }
}
