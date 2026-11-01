// Background mailbox sync: delta reconciliation for connected mailboxes.
// Invoked by Vercel cron (x-vercel-cron: 1). Server-side only.
import { createMicrosoftTokenStore } from '../../lib/paralegal/microsoft/tokenStore.js'
import { createMicrosoftSyncState } from '../../lib/paralegal/microsoft/syncState.js'
import { graphRequest, deltaMessages } from '../../lib/paralegal/microsoft/graph.js'
import { createDeltaTracker } from '../../lib/paralegal/microsoft/sync.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const headers = req.headers || {}
    const isCron = String(headers['x-vercel-cron'] || (typeof headers.get === 'function' ? headers.get('x-vercel-cron') : '') || '') === '1'
    if (!isCron) return res.status(403).json({ ok: false, error: 'This endpoint runs on a schedule only.' })

    const store = createMicrosoftTokenStore()
    const syncState = createMicrosoftSyncState()
    const tokens = await store.list()
    const processed = []

    for (const token of tokens) {
      if (token.expiresAt && Date.parse(token.expiresAt) <= Date.now()) continue // stale token; refresh handled by the request path
      const { cursor } = await syncState.load(token.userId)
      const { data: page } = cursor
        ? await graphRequest({ accessToken: token.accessToken, path: cursor })
        : await deltaMessages({ accessToken: token.accessToken, query: { $select: 'id,subject,receivedDateTime' } })
      const tracker = createDeltaTracker({ cursor })
      const { added, cursor: nextCursor } = tracker.applyDeltaPage(page || {})
      if (nextCursor) await syncState.save(token.userId, nextCursor)
      processed.push({ userId: token.userId, added: added.length })
    }

    return res.status(200).json({ ok: true, processed })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Mailbox sync failed.' })
  }
}
