// Calendar actions for the Paralegal: create/update linked events with dedup.
import { requireParalegalUser } from '../../lib/paralegal/auth.js'
import { createMicrosoftTokenStore } from '../../lib/paralegal/microsoft/tokenStore.js'
import { createEvent, updateEvent, listEvents } from '../../lib/paralegal/microsoft/graph.js'

const TIME_ZONE = 'Central Standard Time'

function eventBody(body = {}) {
  return {
    subject: String(body.subject || '').slice(0, 500),
    start: { dateTime: body.start, timeZone: body.timeZone || TIME_ZONE },
    end: { dateTime: body.end, timeZone: body.timeZone || TIME_ZONE },
    location: body.location ? { displayName: String(body.location).slice(0, 500) } : undefined,
    transactionId: body.transactionId || undefined
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const user = await requireParalegalUser(req)
    const method = (req.method || 'GET').toUpperCase()
    if (method === 'POST') return create(req, res, user)
    if (method === 'PATCH') return update(req, res, user)
    if (method === 'GET') return availability(req, res, user)
    return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Calendar action failed.' })
  }
}

async function create(req, res, user) {
  const token = await createMicrosoftTokenStore().load(user.id)
  if (!token) return res.status(409).json({ ok: false, error: 'Connect Outlook before creating calendar events.' })
  const { status, data } = await createEvent({ accessToken: token.accessToken, event: eventBody(req.body || {}) })
  return res.status(201).json({ ok: true, status, event: data })
}

async function update(req, res, user) {
  const eventId = String((req.body || {}).eventId || '')
  if (!eventId) return res.status(400).json({ ok: false, error: 'An eventId is required to update.' })
  const token = await createMicrosoftTokenStore().load(user.id)
  if (!token) return res.status(409).json({ ok: false, error: 'Connect Outlook before updating calendar events.' })
  const { status, data } = await updateEvent({ accessToken: token.accessToken, eventId, patch: eventBody(req.body || {}) })
  return res.status(200).json({ ok: true, status, event: data })
}

async function availability(req, res, user) {
  const token = await createMicrosoftTokenStore().load(user.id)
  if (!token) return res.status(200).json({ ok: true, connected: false, events: [] })
  const { data } = await listEvents({ accessToken: token.accessToken, query: { $select: 'id,subject,start,end,isAllDay', $top: 100 } })
  return res.status(200).json({ ok: true, connected: true, events: (data && data.value) || [] })
}
