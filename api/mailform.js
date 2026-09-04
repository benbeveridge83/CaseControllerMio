import https from 'node:https'
import { Buffer } from 'node:buffer'

const MAILFORM_HOST = 'www.mailform.io'
const MAILFORM_SERVICES = new Set([
  'UPS_NEXT_DAY_AIR',
  'FEDEX_OVERNIGHT',
  'USPS_PRIORITY_EXPRESS',
  'USPS_PRIORITY',
  'USPS_CERTIFIED_PHYSICAL_RECEIPT',
  'USPS_CERTIFIED_RECEIPT',
  'USPS_CERTIFIED',
  'USPS_FIRST_CLASS'
])

function env(name, fallback = '') {
  return String(process.env[name] || fallback || '').trim()
}

function boolEnv(name) {
  return /^(1|true|yes|on)$/i.test(env(name))
}

function json(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function getAction(req) {
  if (req.query?.action) return String(req.query.action)
  try {
    const parsed = new URL(req.url || '/', 'https://mio.local')
    return parsed.searchParams.get('action') || ''
  } catch {
    return ''
  }
}

function getQueryValue(req, key) {
  if (req.query?.[key] != null) return String(req.query[key])
  try {
    const parsed = new URL(req.url || '/', 'https://mio.local')
    return parsed.searchParams.get(key) || ''
  } catch {
    return ''
  }
}

function parseJsonBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body)
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function supabaseConfig() {
  const url = env('SUPABASE_URL') || env('VITE_SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY') || env('VITE_SUPABASE_ANON_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return { url, key }
}

async function verifyMioUser(req) {
  const authorization = String(req.headers?.authorization || '')
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    const error = new Error('Sign in to Mio before using the Mail Center.')
    error.status = 401
    throw error
  }

  const { url, key } = supabaseConfig()
  if (!url || !key) {
    const error = new Error('The server is missing its Supabase URL or publishable/anon key configuration.')
    error.status = 503
    throw error
  }

  const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: key, Authorization: authorization }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.id) {
    const error = new Error('Your Mio session could not be verified. Sign in again.')
    error.status = 401
    throw error
  }

  const email = String(payload.email || '').trim().toLowerCase()
  const allowed = new Set(
    env('MIO_POSTAL_ALLOWED_EMAILS')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  )
  const firmDomain = env('MIO_POSTAL_ALLOWED_DOMAIN', 'beveridgelawfirm.com').toLowerCase()
  const domainAllowed = firmDomain && email.endsWith(`@${firmDomain}`)
  if (!email || (!domainAllowed && !allowed.has(email))) {
    const error = new Error('Your Mio account is not authorized to submit postal mail.')
    error.status = 403
    throw error
  }

  return { id: payload.id, email }
}

function mailformMode() {
  return env('MIO_MAILFORM_MODE', 'test').toLowerCase() === 'live' ? 'live' : 'test'
}

function mailformKey() {
  return mailformMode() === 'live' ? env('MAILFORM_API_KEY') : env('MAILFORM_TEST_API_KEY')
}

function multipartBody(fields) {
  const boundary = `----MioMailform${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  const chunks = []
  Object.entries(fields || {}).forEach(([name, value]) => {
    if (value === undefined || value === null || value === '') return
    const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${String(name).replace(/"/g, '')}"\r\n\r\n${text}\r\n`, 'utf8'))
  })
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return { boundary, body: Buffer.concat(chunks) }
}

function mailformHttp({ method = 'GET', path, fields = null }) {
  const key = mailformKey()
  if (!key) {
    const error = new Error(mailformMode() === 'live' ? 'MAILFORM_API_KEY is not configured.' : 'MAILFORM_TEST_API_KEY is not configured.')
    error.status = 503
    return Promise.reject(error)
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    'User-Agent': 'CaseControllerMio/266'
  }
  let body = null
  if (fields) {
    const multipart = multipartBody(fields)
    body = multipart.body
    headers['Content-Type'] = `multipart/form-data; boundary=${multipart.boundary}`
    headers['Content-Length'] = String(body.length)
  }

  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: MAILFORM_HOST, port: 443, method, path, headers, timeout: 45000 }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let payload = null
        try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { raw } }
        const status = Number(response.statusCode || 500)
        if (status < 200 || status >= 300) {
          const message = payload?.error?.message || payload?.message || `Mailform returned HTTP ${status}.`
          const error = new Error(message)
          error.status = status
          error.payload = payload
          reject(error)
          return
        }
        resolve(payload || {})
      })
    })
    request.on('timeout', () => request.destroy(new Error('Mailform request timed out.')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function requireHttpsSupabaseFile(fileUrl) {
  let parsed
  try { parsed = new URL(String(fileUrl || '')) } catch {
    const error = new Error('The prepared mailing PDF URL is invalid.')
    error.status = 400
    throw error
  }
  if (parsed.protocol !== 'https:') {
    const error = new Error('The mailing PDF must use a secure HTTPS URL.')
    error.status = 400
    throw error
  }

  const { url } = supabaseConfig()
  let projectHost = ''
  try { projectHost = new URL(url).hostname.toLowerCase() } catch {}
  const host = parsed.hostname.toLowerCase()
  const ref = projectHost.endsWith('.supabase.co') ? projectHost.slice(0, -'.supabase.co'.length) : ''
  const allowedHosts = new Set([projectHost, ref ? `${ref}.storage.supabase.co` : ''].filter(Boolean))
  if (!allowedHosts.has(host) || !/\/storage\/v1\/object\//.test(parsed.pathname)) {
    const error = new Error('Mailform may only fetch PDFs from Mio secure Supabase Storage.')
    error.status = 400
    throw error
  }
  return parsed.toString()
}

function cleanAddress(address, label) {
  const value = address && typeof address === 'object' ? address : {}
  const required = ['name', 'address1', 'city', 'state', 'postcode', 'country']
  const missing = required.filter((field) => !String(value[field] || '').trim())
  if (missing.length) {
    const error = new Error(`${label} is missing: ${missing.join(', ')}.`)
    error.status = 400
    throw error
  }
  return {
    name: String(value.name).trim(),
    organization: String(value.organization || '').trim(),
    address1: String(value.address1).trim(),
    address2: String(value.address2 || '').trim(),
    city: String(value.city).trim(),
    state: String(value.state).trim(),
    postcode: String(value.postcode).trim(),
    country: String(value.country || 'US').trim()
  }
}

function toMailformFields(body) {
  const service = String(body?.service || '')
  if (!MAILFORM_SERVICES.has(service)) {
    const error = new Error('Select a supported Mailform service.')
    error.status = 400
    throw error
  }
  const to = cleanAddress(body?.to, 'Recipient address')
  const from = cleanAddress(body?.from, 'Sender address')
  const reference = String(body?.customer_reference || '').trim().slice(0, 64)
  const fields = {
    url: requireHttpsSupabaseFile(body?.url),
    customer_reference: reference,
    service,
    simplex: Boolean(body?.simplex),
    color: Boolean(body?.color),
    flat: Boolean(body?.flat),
    stamp: Boolean(body?.stamp),
    'to.name': to.name,
    'to.organization': to.organization,
    'to.address1': to.address1,
    'to.address2': to.address2,
    'to.city': to.city,
    'to.state': to.state,
    'to.postcode': to.postcode,
    'to.country': to.country,
    'from.name': from.name,
    'from.organization': from.organization,
    'from.address1': from.address1,
    'from.address2': from.address2,
    'from.city': from.city,
    'from.state': from.state,
    'from.postcode': from.postcode,
    'from.country': from.country
  }
  return fields
}

async function statusPayload() {
  const mode = mailformMode()
  const configured = Boolean(mailformKey())
  const base = {
    provider: 'mailform',
    configured,
    mode,
    writesEnabled: boolEnv('MIO_MAIL_WRITES_ENABLED'),
    liveEnabled: boolEnv('MIO_MAIL_LIVE_ENABLED'),
    account: null,
    balance: null
  }
  if (!configured) return base
  try {
    const response = await mailformHttp({ method: 'GET', path: '/app/api/v1/users/me' })
    const account = response?.data || null
    return { ...base, account, balance: account?.balance || null }
  } catch (error) {
    return { ...base, connectionError: error.message || String(error) }
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  try {
    const user = await verifyMioUser(req)
    const action = getAction(req)

    if (action === 'status' && req.method === 'GET') {
      json(res, 200, await statusPayload())
      return
    }

    if (action === 'quote' && req.method === 'POST') {
      const fields = toMailformFields(parseJsonBody(req))
      const payload = await mailformHttp({ method: 'GET', path: '/app/api/v1/rates', fields })
      json(res, 200, payload)
      return
    }

    if (action === 'get' && req.method === 'GET') {
      const orderId = getQueryValue(req, 'order_id').trim()
      if (!/^[A-Za-z0-9:_()\-]+$/.test(orderId) || orderId.length > 180) {
        json(res, 400, { error: 'A valid Mailform order ID is required.' })
        return
      }
      const payload = await mailformHttp({ method: 'GET', path: `/app/api/v1/orders/${encodeURIComponent(orderId)}` })
      json(res, 200, payload)
      return
    }

    if (action === 'send' && req.method === 'POST') {
      if (!boolEnv('MIO_MAIL_WRITES_ENABLED')) {
        json(res, 403, { error: 'Postal-mail writes are locked. Set MIO_MAIL_WRITES_ENABLED=true after test-mode review.' })
        return
      }
      if (mailformMode() === 'live' && !boolEnv('MIO_MAIL_LIVE_ENABLED')) {
        json(res, 403, { error: 'Live postal mail is locked. Set MIO_MAIL_LIVE_ENABLED=true only when you are ready to send real mail.' })
        return
      }
      const body = parseJsonBody(req)
      if (body?.confirm_send !== true) {
        json(res, 400, { error: 'Mio did not receive the final send authorization.' })
        return
      }
      const fields = toMailformFields(body)
      const payload = await mailformHttp({ method: 'POST', path: '/app/api/v1/orders', fields })
      console.info('Mio Mailform order submitted', { user: user.email, mode: mailformMode(), reference: fields.customer_reference, orderId: payload?.data?.id || '' })
      json(res, 200, payload)
      return
    }

    json(res, 404, { error: 'Unknown Mail Center action.' })
  } catch (error) {
    const status = Number(error?.status || 500)
    console.error('Mio Mailform API error', { status, message: error?.message || String(error) })
    json(res, status >= 400 && status <= 599 ? status : 500, { error: error?.message || 'Mailform request failed.' })
  }
}
