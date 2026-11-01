// Calendar actions for the Paralegal against Mio's own calendar (Supabase
// `calendar_events`), not Microsoft Graph. Ben uses Mio's calendar, not Outlook.
import { createClient } from '@supabase/supabase-js'
import { requireParalegalUser } from '../../lib/paralegal/auth.js'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY } from '../../src/mioSupabasePublic.js'

function serverConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL,
    key: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PUBLIC_SUPABASE_KEY
  }
}

function userDb(req) {
  const { url, key } = serverConfig()
  const authorization = String(req.headers?.authorization || '')
  return createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
}

// Build a calendar_events row from the request body, only setting provided fields.
function eventRow(body = {}) {
  const row = {}
  if (body.title !== undefined) row.title = String(body.title).slice(0, 500)
  if (body.start_date !== undefined) row.start_date = body.start_date
  if (body.end_date !== undefined) row.end_date = body.end_date
  if (body.start_time !== undefined) row.start_time = body.start_time
  if (body.end_time !== undefined) row.end_time = body.end_time
  if (body.is_active !== undefined) row.is_active = !!body.is_active
  if (body.matter_id !== undefined) row.matter_id = body.matter_id
  return row
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    await requireParalegalUser(req)
    const method = (req.method || 'GET').toUpperCase()
    if (method === 'POST') return create(req, res)
    if (method === 'PATCH') return update(req, res)
    if (method === 'GET') return list(req, res)
    return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Calendar action failed.' })
  }
}

async function create(req, res) {
  const row = eventRow(req.body || {})
  if (!row.title || !row.start_date) return res.status(400).json({ ok: false, error: 'A title and start_date are required.' })
  const db = userDb(req)
  const { data, error } = await db.from('calendar_events').insert([row]).select('id').single()
  if (error) return res.status(400).json({ ok: false, error: error.message })
  return res.status(201).json({ ok: true, event: data })
}

async function update(req, res) {
  const body = req.body || {}
  const eventId = String(body.eventId || body.id || '')
  if (!eventId) return res.status(400).json({ ok: false, error: 'An eventId is required to update.' })
  const db = userDb(req)
  const { data, error } = await db.from('calendar_events').update(eventRow(body)).eq('id', eventId).select('id').maybeSingle()
  if (error) return res.status(400).json({ ok: false, error: error.message })
  if (!data) return res.status(404).json({ ok: false, error: 'Event not found.' })
  return res.status(200).json({ ok: true, event: data })
}

async function list(req, res) {
  const db = userDb(req)
  const { data, error } = await db.from('calendar_events').select('id, title, start_date, end_date, start_time, end_time, is_active, matter_id').order('start_date', { ascending: true }).range(0, 4999)
  if (error) return res.status(400).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, events: data || [] })
}
