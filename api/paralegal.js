// Consolidated Paralegal API. One Vercel function dispatches:
//   /api/paralegal                    -> default (Ask Paralegal, read-only)
//   /api/paralegal/calendar-actions   -> ?action=calendar_actions (rewrite)
//   /api/paralegal/email-actions      -> ?action=email_actions (rewrite)
// All original URLs, methods, query strings, and bodies are preserved.
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { requireParalegalUser } from '../lib/paralegal/auth.js'
import { askClaudeParalegal } from '../lib/paralegal/claude.js'
import { createNeedToSetController } from '../src/paralegal/need-to-set-controller.mjs'
import { createSupabaseReviews } from '../lib/paralegal/reviews.js'
import { composeScheduleEmail } from '../lib/paralegal/emailCompose.js'
import { createMicrosoftTokenStore } from '../lib/paralegal/microsoft/tokenStore.js'
import { sendMail } from '../lib/paralegal/microsoft/graph.js'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_KEY } from '../src/mioSupabasePublic.js'

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  if (action === 'calendar_actions') return calendarActions(req, res)
  if (action === 'email_actions') return emailActions(req, res)
  return askParalegal(req, res)
}

async function askParalegal(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  try {
    await requireParalegalUser(req)
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const result = await askClaudeParalegal({
      gatewayKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      message: body.message,
      history: body.history,
      snapshot: body.snapshot,
    })
    return res.status(200).json({ ok: true, ...result, mode: 'read_only' })
  } catch (error) {
    const status = error.statusCode || (error.code === 'INVALID_MESSAGE' || error.code === 'INVALID_SNAPSHOT' ? 400 : error.code === 'CLAUDE_NOT_CONFIGURED' ? 503 : 500)
    return res.status(status).json({ ok: false, error: error.message || 'Paralegal request failed.' })
  }
}

// Calendar actions for the Paralegal against Mio's own calendar (Supabase
// `calendar_events`), not Microsoft Graph.
function calendarServerConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL,
    key: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PUBLIC_SUPABASE_KEY,
  }
}

function calendarUserDb(req) {
  const { url, key } = calendarServerConfig()
  const authorization = String(req.headers?.authorization || '')
  return createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
}

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

async function calendarActions(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    await requireParalegalUser(req)
    const method = (req.method || 'GET').toUpperCase()
    if (method === 'POST') return createCalendarEvent(req, res)
    if (method === 'PATCH') return updateCalendarEvent(req, res)
    if (method === 'GET') return listCalendarEvents(req, res)
    return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Calendar action failed.' })
  }
}

async function createCalendarEvent(req, res) {
  const row = eventRow(req.body || {})
  if (!row.title || !row.start_date) return res.status(400).json({ ok: false, error: 'A title and start_date are required.' })
  const db = calendarUserDb(req)
  const { data, error } = await db.from('calendar_events').insert([row]).select('id').single()
  if (error) return res.status(400).json({ ok: false, error: error.message })
  return res.status(201).json({ ok: true, event: data })
}

async function updateCalendarEvent(req, res) {
  const body = req.body || {}
  const eventId = String(body.eventId || body.id || '')
  if (!eventId) return res.status(400).json({ ok: false, error: 'An eventId is required to update.' })
  const db = calendarUserDb(req)
  const { data, error } = await db.from('calendar_events').update(eventRow(body)).eq('id', eventId).select('id').maybeSingle()
  if (error) return res.status(400).json({ ok: false, error: error.message })
  if (!data) return res.status(404).json({ ok: false, error: 'Event not found.' })
  return res.status(200).json({ ok: true, event: data })
}

async function listCalendarEvents(req, res) {
  const db = calendarUserDb(req)
  const { data, error } = await db.from('calendar_events').select('id, title, start_date, end_date, start_time, end_time, is_active, matter_id').order('start_date', { ascending: true }).range(0, 4999)
  if (error) return res.status(400).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, events: data || [] })
}

// Approval-gated email actions: prepare a review card, then send on approval.
function revisionFor(row) {
  return createHash('sha256').update(JSON.stringify([row.currentStep, row.latestUpdate, row.waitingOn, row.nextAction])).digest('hex').slice(0, 32)
}

function mapSnapshotToTasks(snapshot = []) {
  return snapshot.map((row) => ({
    id: String(row.id || ''),
    matterId: String(row.matterId || ''),
    revision: revisionFor(row),
    matterName: String(row.matterName || ''),
    status: String(row.stage || ''),
    step: String(row.currentStep || ''),
    waitingOn: String(row.waitingOn || ''),
    nextAction: String(row.nextAction || ''),
    updatedAt: String(row.latestUpdate || ''),
  }))
}

async function emailActions(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  try {
    const user = await requireParalegalUser(req)
    const body = req.body || {}
    if (body.action === 'send_email') return sendEmail(req, res, user, body)
    return prepareEmail(req, res, user, body)
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Email action failed.' })
  }
}

async function prepareEmail(req, res, user, body) {
  const tasks = mapSnapshotToTasks(body.snapshot || [])
  const contacts = body.contacts || {}
  const controller = createNeedToSetController({
    getSession: async () => ({ ownerId: user.id, ready: true }),
    readTasks: async () => tasks,
    composeEmail: async (_account, task, command) => composeScheduleEmail(task, { action: command.action, instruction: command.instruction, contacts }),
    reviews: createSupabaseReviews(),
  })
  const review = await controller.prepare({ taskId: body.taskId, action: body.emailAction, instruction: body.instruction })
  return res.status(200).json({ ok: true, review })
}

async function sendEmail(req, res, user, body) {
  const reviewId = String(body.reviewId || '')
  if (!reviewId) return res.status(400).json({ ok: false, error: 'A reviewId is required to send.' })
  const reviews = createSupabaseReviews()
  const review = await reviews.load(user.id, reviewId)
  if (!review) return res.status(404).json({ ok: false, error: 'Review not found.' })
  if (Date.parse(review.expiresAt) <= Date.now()) return res.status(409).json({ ok: false, error: 'Review expired; prepare a fresh draft.' })
  const token = await createMicrosoftTokenStore().load(user.id)
  if (!token) return res.status(409).json({ ok: false, error: 'Connect Outlook before sending.' })
  const { status } = await sendMail({
    accessToken: token.accessToken,
    message: {
      subject: review.email.subject,
      body: { contentType: 'Text', content: review.email.body },
      toRecipients: review.email.to.map((address) => ({ emailAddress: { address } })),
    },
  })
  return res.status(200).json({ ok: true, status, note: 'Accepted for sending; delivery is confirmed by the provider separately.' })
}
