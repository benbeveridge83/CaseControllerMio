// Email dashboard API — one serverless function for the whole feature.
//
// Actions are dispatched by ?action= so the feature adds a single Vercel
// function instead of many (the project already sits near Vercel's per-plan
// function ceiling). Old Microsoft/Clio routes are untouched.
//
//   status           GET    list connected mailboxes + scopes
//   connect_start    POST   build a Microsoft OAuth URL for a mailbox
//   connect_callback GET    OAuth redirect target (exchange code, save token)
//   disconnect       POST   remove a connected mailbox
//   folders          GET    list mail folders for the connected mailboxes
//   messages         GET    list messages for the selected folders
//   message          GET    one message (with body)
//   classify         POST   AI classification (real DeepSeek + Graph context)
//   draft            POST   AI draft suggestion
//   settings         GET/POST folder selection
//   resolve          POST   set per-category resolution
//   resolutions      GET    read resolution state

import { requireParalegalUser } from '../../lib/paralegal/auth.js'
import { buildAuthorizationUrl, exchangeCodeForToken, normalizeTokenResponse } from '../../lib/paralegal/microsoft/oauth.js'
import { signOAuthState, verifyOAuthState } from '../../lib/paralegal/microsoft/state.js'
import { createEmailTokenStore } from '../../lib/email/tokenStore.js'
import * as graphMail from '../../lib/email/graphMail.js'
import { classifyEmail, draftReply } from '../../lib/email/classify.js'
import { EMAIL_CATEGORIES, normalizeCategories } from '../../lib/email/categories.js'
import { toIndex } from '../../lib/email/resolution.js'
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '../../src/mioSupabasePublic.js'

const PRIMARY_MAILBOX = 'ben@beveridgelawfirm.com'
export const DEFAULT_MAILBOXES = ['ben@beveridgelawfirm.com', 'service@beveridgelawfirm.com', 'office@beveridgelawfirm.com', 'billing@beveridgelawfirm.com']

// Mail.Read / Mail.Read.Shared for reading any mailbox; Mail.ReadWrite / Send for
// future send (gated by an explicit user action — this task never auto-sends);
// Calendars.Read + Files.Read.All power classification/draft context.
const EMAIL_GRAPH_SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'Mail.Read', 'Mail.ReadWrite', 'Mail.Read.Shared', 'Mail.ReadWrite.Shared', 'Mail.Send',
  'Calendars.Read', 'Files.Read.All',
]

function redirectUri(env = process.env) {
  const explicit = String(env.EMAIL_REDIRECT_URI || '').trim().replace(/\/$/, '')
  if (explicit) return explicit + '?action=connect_callback'
  // Vercel injects VERCEL_URL (the deployment host) automatically; fall back to
  // the production domain. The exact value must be registered in Azure AD.
  const host = String(env.VERCEL_URL || 'case-controller-mio.vercel.app').trim().replace(/\/$/, '')
  return `https://${host}/api/email/dashboard?action=connect_callback`
}

function clientConfig(env = process.env) {
  return {
    clientId: env.MICROSOFT_CLIENT_ID || '',
    clientSecret: env.MICROSOFT_CLIENT_SECRET || '',
    tenant: env.MICROSOFT_TENANT || 'common',
  }
}

function serverSupabase(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || PUBLIC_SUPABASE_URL || ''
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

function normalizeMessage(raw, accountEmail, folderId) {
  return {
    id: String(raw.id || ''),
    subject: String(raw.subject || ''),
    from: raw.from?.emailAddress?.address || raw.from?.address || '',
    to: (raw.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean),
    cc: (raw.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean),
    receivedDateTime: String(raw.receivedDateTime || ''),
    hasAttachments: Boolean(raw.hasAttachments),
    isRead: Boolean(raw.isRead),
    folderId: String(folderId || ''),
    accountEmail: String(accountEmail || '').trim().toLowerCase(),
    bodyPreview: String(raw.bodyPreview || ''),
    body: String(raw.body?.content || ''),
    bodyType: String(raw.body?.contentType || ''),
  }
}

async function tokenForMailbox(store, userId, mailbox) {
  const own = await store.load(userId, mailbox)
  if (own) return { token: own, base: '/me' }
  if (mailbox !== PRIMARY_MAILBOX) {
    const primary = await store.load(userId, PRIMARY_MAILBOX)
    if (primary) return { token: primary, base: `/users/${mailbox}` }
  }
  return null
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const action = String((req.query && req.query.action) || 'status')
  try {
    if (action === 'connect_callback') return connectCallback(req, res)
    const user = await requireParalegalUser(req)
    if (action === 'connect_start') return connectStart(req, res, user)
    switch (action) {
      case 'status': return status(req, res, user)
      case 'disconnect': return disconnect(req, res, user)
      case 'folders': return folders(req, res, user)
      case 'messages': return messages(req, res, user)
      case 'message': return message(req, res, user)
      case 'classify': return classify(req, res, user)
      case 'draft': return draft(req, res, user)
      case 'settings': return settings(req, res, user)
      case 'resolve': return resolve(req, res, user)
      case 'resolutions': return resolutions(req, res, user)
      default: return res.status(400).json({ ok: false, error: 'Unknown action.' })
    }
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Email dashboard request failed.' })
  }
}

function missingScopes(scopes = []) {
  const have = new Set((scopes || []).map((s) => s.toLowerCase()))
  const required = ['Mail.Read', 'Calendars.Read', 'Files.Read.All']
  return required.filter((s) => !have.has(s.toLowerCase()))
}

async function status(_req, res, user) {
  const store = createEmailTokenStore()
  const tokens = await store.listForUser(user.id)
  const accounts = tokens.map((t) => ({
    accountEmail: t.accountEmail,
    displayName: t.displayName || '',
    connected: true,
    scopes: t.scopes,
    missingScopes: missingScopes(t.scopes),
  }))
  const connectedEmails = new Set(accounts.map((a) => a.accountEmail))
  const available = DEFAULT_MAILBOXES.map((mailbox) => ({ accountEmail: mailbox, connected: connectedEmails.has(mailbox) }))
  return res.status(200).json({ ok: true, accounts, available, categories: EMAIL_CATEGORIES })
}

async function connectStart(req, res, user) {
  const account = String((req.body && req.body.account) || PRIMARY_MAILBOX).trim().toLowerCase()
  if (!account.endsWith('@beveridgelawfirm.com')) return res.status(400).json({ ok: false, error: 'Only @beveridgelawfirm.com mailboxes can be connected.' })
  const { clientId, tenant } = clientConfig()
  if (!clientId) return res.status(503).json({ ok: false, error: 'Microsoft OAuth is not configured on the server.' })
  const state = signOAuthState({ userId: user.id, accountEmail: account })
  const url = buildAuthorizationUrl({
    clientId,
    redirectUri: redirectUri(),
    tenant,
    scopes: EMAIL_GRAPH_SCOPES,
    state,
    loginHint: account,
  })
  return res.status(200).json({ ok: true, url })
}

async function connectCallback(req, res) {
  const { code, state, error, error_description } = req.query || {}
  const back = (q) => res.redirect('/#email' + q)
  if (error) return back('?error=' + encodeURIComponent(error_description || error))
  if (!code || !state) return back('?error=missing_code')
  const payload = verifyOAuthState(state, process.env.MICROSOFT_OAUTH_STATE_SECRET)
  if (!payload?.userId || !payload?.accountEmail) return back('?error=invalid_state')
  const { clientId, clientSecret, tenant } = clientConfig()
  const token = await exchangeCodeForToken({
    clientId, clientSecret, redirectUri: redirectUri(), tenant, code,
  })
  const normalized = normalizeTokenResponse(token, { accountEmail: payload.accountEmail })
  const store = createEmailTokenStore()
  let displayName = payload.accountEmail
  try {
    const me = await graphMail.getMe({ accessToken: normalized.accessToken })
    displayName = me?.data?.displayName || me?.data?.mail || payload.accountEmail
  } catch { /* keep account email */ }
  await store.save(payload.userId, payload.accountEmail, { ...normalized, displayName })
  return back('?connected=1')
}

async function disconnect(req, res, user) {
  const account = String((req.body && req.body.account) || '').trim().toLowerCase()
  if (!account) return res.status(400).json({ ok: false, error: 'A mailbox is required.' })
  await createEmailTokenStore().remove(user.id, account)
  return res.status(200).json({ ok: true })
}

async function folders(req, res, user) {
  const store = createEmailTokenStore()
  const result = []
  for (const accountEmail of DEFAULT_MAILBOXES) {
    const connection = await tokenForMailbox(store, user.id, accountEmail)
    if (!connection) continue
    try {
      const { data } = await graphMail.listMailFolders({ accessToken: connection.token.accessToken, accountEmail: connection.base === '/me' ? '' : accountEmail })
      const folders = (data.value || []).map((f) => ({ id: f.id, name: f.displayName, childFolderCount: f.childFolderCount || 0, accountEmail }))
      result.push({ accountEmail, folders })
    } catch { /* skip a mailbox that cannot be read yet */ }
  }
  return res.status(200).json({ ok: true, folders: result })
}

async function messages(req, res, user) {
  const store = createEmailTokenStore()
  const db = serverSupabase()
  const settingsRows = db ? (await readSettings(db, user.id)).rows : []
  const settings = toSettingsMap(settingsRows)
  const out = []
  const seen = new Set()
  for (const accountEmail of DEFAULT_MAILBOXES) {
    const connection = await tokenForMailbox(store, user.id, accountEmail)
    if (!connection) continue
    const chosen = settings[accountEmail] && settings[accountEmail].length ? settings[accountEmail] : ['inbox']
    for (const folderId of chosen) {
      let page
      try {
        page = await graphMail.listFolderMessages({ accessToken: connection.token.accessToken, accountEmail: connection.base === '/me' ? '' : accountEmail, folderId })
      } catch (err) {
        if (String(err.statusCode) === '404') continue
        throw err
      }
      for (const raw of page.data.value || []) {
        const msg = normalizeMessage(raw, accountEmail, folderId)
        if (!msg.id || seen.has(msg.id)) continue
        seen.add(msg.id)
        out.push(msg)
      }
    }
  }
  out.sort((a, b) => (b.receivedDateTime || '').localeCompare(a.receivedDateTime || ''))
  return res.status(200).json({ ok: true, messages: out })
}

async function message(req, res, user) {
  const id = String((req.query && req.query.id) || '')
  const accountEmail = String((req.query && req.query.accountEmail) || '')
  if (!id) return res.status(400).json({ ok: false, error: 'A message id is required.' })
  const store = createEmailTokenStore()
  const connection = accountEmail ? await tokenForMailbox(store, user.id, accountEmail) : null
  const token = connection?.token || (await store.listForUser(user.id))[0]
  if (!token) return res.status(409).json({ ok: false, error: 'Connect a mailbox first.' })
  const { data } = await graphMail.getMessage({ accessToken: token.accessToken, accountEmail: connection?.base === '/me' ? '' : accountEmail, messageId: id })
  return res.status(200).json({ ok: true, message: normalizeMessage(data, accountEmail, data.parentFolderId || '') })
}

async function buildContext(user, message, matterName) {
  const store = createEmailTokenStore()
  const accountEmail = message.accountEmail || PRIMARY_MAILBOX
  const connection = await tokenForMailbox(store, user.id, accountEmail)
  if (!connection) return {}
  const base = connection.base === '/me' ? '' : accountEmail
  const context = {}
  try {
    const start = new Date(Date.now() - 86400000).toISOString()
    const end = new Date(Date.now() + 14 * 86400000).toISOString()
    const cal = await graphMail.getCalendarView({ accessToken: connection.token.accessToken, accountEmail: base, startDateTime: start, endDateTime: end })
    context.calendar = (cal.data.value || []).map((e) => ({ subject: e.subject, start: e.start?.dateTime, end: e.end?.dateTime }))
  } catch { /* calendar context is best-effort */ }
  try {
    const q = matterName || message.subject || ''
    if (q) {
      const drive = await graphMail.searchOneDrive({ accessToken: connection.token.accessToken, accountEmail: base, query: q })
      context.onedrive = (drive.data.value || []).map((i) => ({ name: i.name, webUrl: i.webUrl }))
    }
  } catch { /* OneDrive context is best-effort */ }
  return context
}

async function classify(req, res, user) {
  const message = (req.body && req.body.message) || {}
  if (!message.id && !message.subject) return res.status(400).json({ ok: false, error: 'A message is required.' })
  const context = await buildContext(user, message, (req.body && req.body.matterName) || '')
  const result = await classifyEmail({ message, context })
  return res.status(200).json({ ok: true, ...result })
}

async function draft(req, res, user) {
  const message = (req.body && req.body.message) || {}
  if (!message.id && !message.subject) return res.status(400).json({ ok: false, error: 'A message is required.' })
  const matterName = (req.body && req.body.matterName) || ''
  const context = await buildContext(user, message, matterName)
  const result = await draftReply({ message, context: { ...context, matterName } })
  return res.status(200).json({ ok: true, ...result })
}

function toSettingsMap(rows = []) {
  const settings = {}
  for (const row of rows) {
    const account = String(row.account_email).trim().toLowerCase()
    const folderId = String(row.folder_id)
    if (!account || !folderId) continue
    if (row.enabled === false) continue
    if (!settings[account]) settings[account] = []
    settings[account].push(folderId)
  }
  return settings
}

async function readSettings(db, userId) {
  const { data, error } = await db.from('mio_email_folder_settings').select('account_email, folder_id, folder_name, enabled').eq('user_id', userId)
  return { rows: data || [], error }
}

async function settings(req, res, user) {
  const db = serverSupabase()
  if (!db) return res.status(503).json({ ok: false, error: 'Supabase is not configured on the server.' })
  if (req.method === 'GET') {
    const { rows, error } = await readSettings(db, user.id)
    if (error) throw Object.assign(new Error('Could not load folder settings.'), { statusCode: 500 })
    return res.status(200).json({ ok: true, settings: toSettingsMap(rows) })
  }
  if (req.method === 'POST') {
    const accountEmail = String((req.body && req.body.accountEmail) || '').trim().toLowerCase()
    const selections = Array.isArray((req.body && req.body.selections)) ? req.body.selections : []
    if (!accountEmail) return res.status(400).json({ ok: false, error: 'A mailbox is required.' })
    const rows = selections.map((s) => ({
      user_id: user.id,
      account_email: accountEmail,
      folder_id: String(s.folderId || s.folder_id || ''),
      folder_name: String(s.folderName || s.folder_name || ''),
      enabled: s.enabled !== false,
      updated_at: new Date().toISOString(),
    }))
    const { error: delErr } = await db.from('mio_email_folder_settings').delete().eq('user_id', user.id).eq('account_email', accountEmail)
    if (delErr) throw Object.assign(new Error('Could not clear folder settings.'), { statusCode: 500 })
    if (rows.length) {
      const { error } = await db.from('mio_email_folder_settings').upsert(rows)
      if (error) throw Object.assign(new Error('Could not save folder settings.'), { statusCode: 500 })
    }
    return res.status(200).json({ ok: true, settings: toSettingsMap(rows) })
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed.' })
}

async function resolve(req, res, user) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' })
  const db = serverSupabase()
  if (!db) return res.status(503).json({ ok: false, error: 'Supabase is not configured on the server.' })
  const messageId = String((req.body && req.body.messageId) || '')
  const category = normalizeCategories([req.body && req.body.category])[0]
  const resolved = Boolean(req.body && req.body.resolved)
  if (!messageId || !category) return res.status(400).json({ ok: false, error: 'messageId and category are required.' })
  if (resolved) {
    const { error } = await db.from('mio_email_resolutions').upsert({
      user_id: user.id, message_id: messageId, category,
      resolved: true, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    if (error) throw Object.assign(new Error('Could not save resolution.'), { statusCode: 500 })
  } else {
    const { error } = await db.from('mio_email_resolutions').delete().eq('user_id', user.id).eq('message_id', messageId).eq('category', category)
    if (error) throw Object.assign(new Error('Could not clear resolution.'), { statusCode: 500 })
  }
  return res.status(200).json({ ok: true })
}

async function resolutions(req, res, user) {
  const db = serverSupabase()
  if (!db) return res.status(503).json({ ok: false, error: 'Supabase is not configured on the server.' })
  const { data, error } = await db.from('mio_email_resolutions').select('message_id, category, resolved, resolved_at').eq('user_id', user.id)
  if (error) throw Object.assign(new Error('Could not load resolutions.'), { statusCode: 500 })
  return res.status(200).json({ ok: true, resolutions: toIndex(data || []) })
}
