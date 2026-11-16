import { normalizeNeedToSetSnapshot } from './need-to-set-snapshot.js'

export async function askParalegal({auth, fetchImpl = fetch, message, history = [], snapshot = []}) {
  const sessionResult = await auth.getSession()
  if (sessionResult?.error) throw sessionResult.error
  const token = sessionResult?.data?.session?.access_token
  if (!token) throw new Error('Sign in to Mio before using Paralegal.')
  const normalized = normalizeNeedToSetSnapshot(snapshot)
  const response = await fetchImpl('/api/paralegal', {
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({message:String(message || ''),history, snapshot:normalized})
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'Paralegal could not complete that request.')
  return data
}
