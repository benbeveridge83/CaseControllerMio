import crypto from 'node:crypto'

const META_API_VERSION = process.env.META_API_VERSION || 'v25.0'
const DEFAULT_FACEBOOK_PAGE_URL = 'https://www.facebook.com/BeveridgeBlawg/'

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function cleanAdAccountId(value = '') {
  return String(value || '').replace(/^act_/i, '').replace(/[^0-9]/g, '')
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateRange(days) {
  const validDays = [7, 14, 30, 90].includes(Number(days)) ? Number(days) : 30
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (validDays - 1))
  const asDate = (date) => date.toISOString().slice(0, 10)
  return { days: validDays, start: asDate(start), end: asDate(end) }
}

async function requireFirmUser(req) {
  const authorization = String(req.headers.authorization || '')
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw Object.assign(new Error('Missing Mio session token.'), { statusCode: 401 })

  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseAnonKey) throw Object.assign(new Error('Server Supabase auth variables are not configured.'), { statusCode: 500 })

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey }
  })
  if (!response.ok) throw Object.assign(new Error('Your Mio session could not be verified.'), { statusCode: 401 })
  const user = await response.json()
  const email = String(user?.email || '').trim().toLowerCase()
  if (!email.endsWith('@beveridgelawfirm.com')) throw Object.assign(new Error('Meta Ads reporting is limited to Beveridge Law Firm staff accounts.'), { statusCode: 403 })
  return user
}

function metaAppSecretProof(accessToken) {
  const secret = process.env.META_APP_SECRET || ''
  if (!secret || !accessToken) return ''
  return crypto.createHmac('sha256', secret).update(accessToken).digest('hex')
}

async function graphGet(path, params = {}, { paginate = false, maxPages = 12 } = {}) {
  const accessToken = process.env.META_ACCESS_TOKEN || ''
  if (!accessToken) throw new Error('META_ACCESS_TOKEN is not configured.')
  const proof = metaAppSecretProof(accessToken)
  const search = new URLSearchParams()
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    search.set(key, typeof value === 'string' ? value : JSON.stringify(value))
  })
  if (proof) search.set('appsecret_proof', proof)
  let url = `https://graph.facebook.com/${META_API_VERSION}/${String(path || '').replace(/^\//, '')}?${search.toString()}`
  const collected = []
  let lastPayload = null

  for (let page = 0; page < maxPages && url; page += 1) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload?.error) {
      const message = payload?.error?.error_user_msg || payload?.error?.message || `Meta Marketing API returned ${response.status}.`
      const code = payload?.error?.code ? ` (code ${payload.error.code})` : ''
      throw new Error(`${message}${code}`)
    }
    lastPayload = payload
    if (Array.isArray(payload?.data)) collected.push(...payload.data)
    if (!paginate || !payload?.paging?.next) break
    url = payload.paging.next
  }

  if (paginate) return collected
  return lastPayload || {}
}

function actionMap(actions = []) {
  const map = {}
  for (const row of Array.isArray(actions) ? actions : []) {
    const key = String(row?.action_type || '')
    if (!key) continue
    map[key] = number(row?.value)
  }
  return map
}

function maxAction(map = {}, candidates = []) {
  return candidates.reduce((max, key) => Math.max(max, number(map?.[key])), 0)
}

function derivedActions(actions = []) {
  const map = actionMap(actions)
  const leads = maxAction(map, [
    'lead',
    'onsite_conversion.lead_grouped',
    'onsite_conversion.lead',
    'offsite_conversion.fb_pixel_lead'
  ])
  const messages = maxAction(map, [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.messaging_first_reply',
    'messaging_conversation_started_7d'
  ])
  const contacts = maxAction(map, ['contact', 'offsite_conversion.fb_pixel_contact'])
  const appointments = maxAction(map, ['schedule', 'offsite_conversion.fb_pixel_schedule'])
  const landingPageViews = maxAction(map, ['landing_page_view'])
  const linkClicks = maxAction(map, ['link_click'])
  return { actions: map, leads, messages, contacts, appointments, landingPageViews, linkClicks }
}

function insightRow(row = {}) {
  const spend = number(row.spend)
  const clicks = number(row.clicks)
  const inlineLinkClicks = number(row.inline_link_clicks)
  const derived = derivedActions(row.actions)
  const leads = derived.leads
  const leadSignals = Math.max(leads, derived.messages, derived.contacts, derived.appointments)
  return {
    impressions: number(row.impressions),
    reach: number(row.reach),
    clicks,
    inlineLinkClicks,
    ctr: number(row.ctr) / 100,
    linkCtr: number(row.inline_link_click_ctr) / 100,
    cpc: number(row.cpc),
    cpm: number(row.cpm),
    spend,
    frequency: number(row.frequency),
    leads,
    leadSignals,
    messages: derived.messages,
    contacts: derived.contacts,
    appointments: derived.appointments,
    landingPageViews: derived.landingPageViews,
    actionLinkClicks: derived.linkClicks,
    costPerLead: leads > 0 ? spend / leads : 0,
    actions: derived.actions
  }
}

async function safeGraph(section, path, params, warnings, options = {}) {
  try {
    return await graphGet(path, params, options)
  } catch (error) {
    warnings.push({ section, message: error?.message || String(error) })
    return options.paginate ? [] : {}
  }
}

async function accountInfo() {
  const accountId = cleanAdAccountId(process.env.META_AD_ACCOUNT_ID || '')
  if (!accountId) throw new Error('META_AD_ACCOUNT_ID is not configured.')
  const payload = await graphGet(`act_${accountId}`, {
    fields: 'id,account_id,name,account_status,currency,timezone_name,business_name,amount_spent'
  })
  return {
    id: String(payload?.account_id || accountId),
    resourceId: String(payload?.id || `act_${accountId}`),
    name: payload?.name || '',
    accountStatus: payload?.account_status || '',
    currency: payload?.currency || '',
    timeZone: payload?.timezone_name || '',
    businessName: payload?.business_name || ''
  }
}

async function buildReport(days) {
  const accountId = cleanAdAccountId(process.env.META_AD_ACCOUNT_ID || '')
  if (!accountId) throw new Error('META_AD_ACCOUNT_ID is not configured.')
  const range = dateRange(days)
  const timeRange = { since: range.start, until: range.end }
  const warnings = []
  const account = await accountInfo()
  const insightsPath = `act_${accountId}/insights`
  const baseFields = 'impressions,reach,clicks,inline_link_clicks,inline_link_click_ctr,ctr,cpc,cpm,spend,frequency,actions'

  const overviewPayload = await safeGraph('overview', insightsPath, {
    level: 'account', time_range: timeRange, fields: baseFields, limit: 50
  }, warnings)
  const overview = insightRow(Array.isArray(overviewPayload?.data) ? overviewPayload.data[0] || {} : {})

  const dailyPayload = await safeGraph('daily', insightsPath, {
    level: 'account', time_range: timeRange, time_increment: 1,
    fields: `date_start,date_stop,${baseFields}`, limit: 500
  }, warnings)
  const daily = (dailyPayload?.data || []).map((row) => ({ date: row.date_start || '', ...insightRow(row) })).sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const campaignStatic = await safeGraph('campaign settings', `act_${accountId}/campaigns`, {
    fields: 'id,name,status,effective_status,objective,buying_type,daily_budget,lifetime_budget,budget_remaining', limit: 500
  }, warnings, { paginate: true })
  const campaignById = new Map(campaignStatic.map((row) => [String(row.id || ''), row]))

  const campaignRows = await safeGraph('campaign insights', insightsPath, {
    level: 'campaign', time_range: timeRange,
    fields: `campaign_id,campaign_name,${baseFields}`, limit: 500
  }, warnings, { paginate: true })
  const campaigns = campaignRows.map((row) => {
    const meta = campaignById.get(String(row.campaign_id || '')) || {}
    return {
      id: String(row.campaign_id || ''),
      name: row.campaign_name || meta.name || '',
      status: meta.status || '',
      effectiveStatus: meta.effective_status || '',
      objective: meta.objective || '',
      buyingType: meta.buying_type || '',
      dailyBudget: number(meta.daily_budget) / 100,
      lifetimeBudget: number(meta.lifetime_budget) / 100,
      ...insightRow(row)
    }
  }).sort((a, b) => b.spend - a.spend)

  const adSetRows = await safeGraph('ad set insights', insightsPath, {
    level: 'adset', time_range: timeRange,
    fields: `campaign_id,campaign_name,adset_id,adset_name,${baseFields}`, limit: 500
  }, warnings, { paginate: true })
  const adSets = adSetRows.map((row) => ({
    campaignId: String(row.campaign_id || ''), campaignName: row.campaign_name || '',
    id: String(row.adset_id || ''), name: row.adset_name || '', ...insightRow(row)
  })).sort((a, b) => b.spend - a.spend)

  const adRows = await safeGraph('ad insights', insightsPath, {
    level: 'ad', time_range: timeRange,
    fields: `campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,${baseFields}`, limit: 500
  }, warnings, { paginate: true })
  const ads = adRows.map((row) => ({
    campaignId: String(row.campaign_id || ''), campaignName: row.campaign_name || '',
    adSetId: String(row.adset_id || ''), adSetName: row.adset_name || '',
    id: String(row.ad_id || ''), name: row.ad_name || '', ...insightRow(row)
  })).sort((a, b) => b.spend - a.spend)

  const platformRows = await safeGraph('platform breakdown', insightsPath, {
    level: 'account', time_range: timeRange, breakdowns: 'publisher_platform',
    fields: baseFields, limit: 100
  }, warnings, { paginate: true })
  const platforms = platformRows.map((row) => ({ platform: row.publisher_platform || 'unknown', ...insightRow(row) })).sort((a, b) => b.spend - a.spend)

  const deviceRows = await safeGraph('device breakdown', insightsPath, {
    level: 'account', time_range: timeRange, breakdowns: 'device_platform',
    fields: baseFields, limit: 100
  }, warnings, { paginate: true })
  const devices = deviceRows.map((row) => ({ device: row.device_platform || 'unknown', ...insightRow(row) })).sort((a, b) => b.spend - a.spend)

  const regionRows = await safeGraph('region breakdown', insightsPath, {
    level: 'account', time_range: timeRange, breakdowns: 'region',
    fields: baseFields, limit: 200
  }, warnings, { paginate: true })
  const regions = regionRows.map((row) => ({ region: row.region || 'unknown', ...insightRow(row) })).sort((a, b) => b.spend - a.spend)

  return {
    ok: true,
    apiVersion: META_API_VERSION,
    range,
    account,
    page: {
      id: process.env.META_PAGE_ID || '',
      url: process.env.META_PAGE_URL || DEFAULT_FACEBOOK_PAGE_URL,
      label: process.env.META_PAGE_LABEL || 'Beveridge Blawg'
    },
    overview,
    daily,
    campaigns,
    adSets,
    ads,
    platforms,
    devices,
    regions,
    warnings,
    fetchedAt: new Date().toISOString()
  }
}

function connectionMissing() {
  const missing = []
  if (!cleanAdAccountId(process.env.META_AD_ACCOUNT_ID || '')) missing.push('META_AD_ACCOUNT_ID')
  if (!process.env.META_ACCESS_TOKEN) missing.push('META_ACCESS_TOKEN')
  return missing
}

async function runAiAudit(report) {
  const apiKey = process.env.OPENAI_API_KEY || ''
  if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'), { statusCode: 400 })
  const model = process.env.OPENAI_META_ADS_MODEL || process.env.OPENAI_GOOGLE_ADS_MODEL || 'gpt-5.6-luna'
  const instructions = `You are the Meta Ads auditor for a small Texas law firm. Analyze only the supplied Facebook/Instagram advertising report. The firm cares about qualified phone calls, successful lead forms, consultations, signed clients, and minimizing wasted spend. Treat Meta-reported lead actions as platform-reported outcomes, not proof of a qualified client. Examine campaigns, ad sets, ads, placements/platforms, devices, regions, frequency, click costs, and conversion signals. Flag tracking ambiguity, audience/creative fatigue, expensive non-converting spend, and weak traffic. Do not recommend raising budget unless tracking and lead quality justify it. Distinguish facts from inferences. Give a concise executive summary, prioritized findings, and exact next actions. Never claim you changed the account; this route is read-only.`
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, instructions, input: JSON.stringify(report), max_output_tokens: 2200 })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI returned ${response.status}.`)
  const direct = typeof payload?.output_text === 'string' ? payload.output_text : ''
  const nested = Array.isArray(payload?.output) ? payload.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map((item) => item?.text || item?.output_text || '').filter(Boolean).join('\n') : ''
  return direct || nested || 'The AI audit completed but returned no text.'
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  try {
    await requireFirmUser(req)
    const action = String(req.query?.action || 'status').toLowerCase()

    if (action === 'status') {
      const missing = connectionMissing()
      if (missing.length) return json(res, 200, {
        ok: true, configured: false, connected: false, missing,
        apiVersion: META_API_VERSION, aiConfigured: Boolean(process.env.OPENAI_API_KEY),
        page: { id: process.env.META_PAGE_ID || '', url: process.env.META_PAGE_URL || DEFAULT_FACEBOOK_PAGE_URL, label: process.env.META_PAGE_LABEL || 'Beveridge Blawg' }
      })
      try {
        const account = await accountInfo()
        return json(res, 200, {
          ok: true, configured: true, connected: true, missing: [], account,
          apiVersion: META_API_VERSION, aiConfigured: Boolean(process.env.OPENAI_API_KEY),
          page: { id: process.env.META_PAGE_ID || '', url: process.env.META_PAGE_URL || DEFAULT_FACEBOOK_PAGE_URL, label: process.env.META_PAGE_LABEL || 'Beveridge Blawg' }
        })
      } catch (error) {
        return json(res, 200, {
          ok: true, configured: true, connected: false, missing: [], error: error?.message || String(error),
          apiVersion: META_API_VERSION, aiConfigured: Boolean(process.env.OPENAI_API_KEY),
          page: { id: process.env.META_PAGE_ID || '', url: process.env.META_PAGE_URL || DEFAULT_FACEBOOK_PAGE_URL, label: process.env.META_PAGE_LABEL || 'Beveridge Blawg' }
        })
      }
    }

    if (action === 'report') {
      if (connectionMissing().length) return json(res, 400, { ok: false, error: `Meta Ads server configuration is incomplete: ${connectionMissing().join(', ')}` })
      return json(res, 200, await buildReport(req.query?.days))
    }

    if (action === 'audit') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST for the AI audit.' })
      const report = req.body?.report
      if (!report || typeof report !== 'object') return json(res, 400, { ok: false, error: 'A Meta Ads report is required.' })
      return json(res, 200, { ok: true, audit: await runAiAudit(report) })
    }

    return json(res, 404, { ok: false, error: 'Unknown Meta Ads action.' })
  } catch (error) {
    console.error('Meta Ads API route error:', error)
    return json(res, error?.statusCode || 500, { ok: false, error: error?.message || 'Meta Ads request failed.' })
  }
}
