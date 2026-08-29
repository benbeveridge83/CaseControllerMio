import crypto from 'node:crypto'

const GOOGLE_ADS_API_VERSION = 'v25'
const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'

function cleanCustomerId(value = '') {
  return String(value || '').replace(/[^0-9]/g, '')
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function serviceAccountConfig() {
  const raw = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON || ''
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.client_email || !parsed?.private_key) throw new Error('The JSON must include client_email and private_key.')
    return parsed
  } catch (error) {
    throw new Error(`GOOGLE_ADS_SERVICE_ACCOUNT_JSON is not valid service-account JSON: ${error.message}`)
  }
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
  if (!email.endsWith('@beveridgelawfirm.com')) throw Object.assign(new Error('Google Ads reporting is limited to Beveridge Law Firm staff accounts.'), { statusCode: 403 })
  return user
}

async function googleAccessToken() {
  const serviceAccount = serviceAccountConfig()
  if (!serviceAccount) throw new Error('GOOGLE_ADS_SERVICE_ACCOUNT_JSON is not configured.')
  const now = Math.floor(Date.now() / 1000)
  const encodedHeader = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const encodedPayload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: GOOGLE_ADS_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }))
  const unsigned = `${encodedHeader}.${encodedPayload}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), serviceAccount.private_key)
  const assertion = `${unsigned}.${base64url(signature)}`
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.access_token) throw new Error(payload?.error_description || payload?.error || 'Google did not issue an access token for the service account.')
  return payload.access_token
}

function googleAdsHeaders(accessToken) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN || ''
  }
  const loginCustomerId = cleanCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '')
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId
  return headers
}

async function googleAdsSearch(accessToken, query) {
  const customerId = cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')
  if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID is not configured.')
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: googleAdsHeaders(accessToken),
    body: JSON.stringify({ query })
  })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : [] } catch { payload = [] }
  if (!response.ok) {
    const detail = payload?.error?.details?.[0]?.errors?.[0]?.message || payload?.error?.message || text || `Google Ads API returned ${response.status}.`
    throw new Error(detail)
  }
  const batches = Array.isArray(payload) ? payload : [payload]
  return batches.flatMap((batch) => Array.isArray(batch?.results) ? batch.results : [])
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function micros(value) {
  return number(value) / 1_000_000
}

function metricRow(metrics = {}) {
  const conversions = number(metrics.conversions)
  const cost = micros(metrics.costMicros)
  return {
    impressions: number(metrics.impressions),
    clicks: number(metrics.clicks),
    ctr: number(metrics.ctr),
    averageCpc: micros(metrics.averageCpc),
    cost,
    conversions,
    allConversions: number(metrics.allConversions),
    conversionRate: number(metrics.conversionsFromInteractionsRate),
    costPerConversion: conversions > 0 ? micros(metrics.costPerConversion) || cost / conversions : 0
  }
}

function dateRange(days) {
  const validDays = [7, 14, 30, 90].includes(Number(days)) ? Number(days) : 30
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (validDays - 1))
  const asDate = (date) => date.toISOString().slice(0, 10)
  return { days: validDays, start: asDate(start), end: asDate(end) }
}

function dateWhere(range) {
  return `segments.date BETWEEN '${range.start}' AND '${range.end}'`
}

async function safeQuery(accessToken, section, query, warnings) {
  try {
    return await googleAdsSearch(accessToken, query)
  } catch (error) {
    warnings.push({ section, message: error?.message || String(error) })
    return []
  }
}

async function accountInfo(accessToken) {
  const rows = await googleAdsSearch(accessToken, `
    SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone
    FROM customer
    LIMIT 1
  `)
  const customer = rows[0]?.customer || {}
  return {
    id: String(customer.id || cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')),
    descriptiveName: customer.descriptiveName || '',
    currencyCode: customer.currencyCode || '',
    timeZone: customer.timeZone || ''
  }
}

async function buildReport(days) {
  const accessToken = await googleAccessToken()
  const range = dateRange(days)
  const warnings = []
  const account = await accountInfo(accessToken)

  const overviewRows = await safeQuery(accessToken, 'overview', `
    SELECT metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM customer
    WHERE ${dateWhere(range)}
  `, warnings)
  const overview = metricRow(overviewRows[0]?.metrics || {})

  const dailyRows = await safeQuery(accessToken, 'daily', `
    SELECT segments.date, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM customer
    WHERE ${dateWhere(range)}
    ORDER BY segments.date DESC
  `, warnings)
  const daily = dailyRows.map((row) => ({ date: row.segments?.date || '', ...metricRow(row.metrics || {}) }))

  const campaignRows = await safeQuery(accessToken, 'campaigns', `
    SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
           campaign.bidding_strategy_type, campaign_budget.amount_micros,
           metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM campaign
    WHERE ${dateWhere(range)} AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `, warnings)
  const campaigns = campaignRows.map((row) => ({
    id: String(row.campaign?.id || ''),
    name: row.campaign?.name || '',
    status: row.campaign?.status || '',
    advertisingChannelType: row.campaign?.advertisingChannelType || '',
    biddingStrategyType: row.campaign?.biddingStrategyType || '',
    dailyBudget: micros(row.campaignBudget?.amountMicros),
    ...metricRow(row.metrics || {})
  }))

  const keywordRows = await safeQuery(accessToken, 'keywords', `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_criterion.criterion_id, ad_group_criterion.status,
           ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
           metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM keyword_view
    WHERE ${dateWhere(range)} AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `, warnings)
  const keywords = keywordRows.map((row) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: row.campaign?.name || '',
    adGroupId: String(row.adGroup?.id || ''),
    adGroupName: row.adGroup?.name || '',
    criterionId: String(row.adGroupCriterion?.criterionId || ''),
    status: row.adGroupCriterion?.status || '',
    keyword: row.adGroupCriterion?.keyword?.text || '',
    matchType: row.adGroupCriterion?.keyword?.matchType || '',
    ...metricRow(row.metrics || {})
  }))

  const searchTermRows = await safeQuery(accessToken, 'search terms', `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           search_term_view.search_term, segments.search_term_match_type,
           metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM search_term_view
    WHERE ${dateWhere(range)}
    ORDER BY metrics.cost_micros DESC
  `, warnings)
  const searchTerms = searchTermRows.map((row) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: row.campaign?.name || '',
    adGroupId: String(row.adGroup?.id || ''),
    adGroupName: row.adGroup?.name || '',
    searchTerm: row.searchTermView?.searchTerm || '',
    matchType: row.segments?.searchTermMatchType || '',
    ...metricRow(row.metrics || {})
  }))

  const conversionStaticRows = await safeQuery(accessToken, 'conversion action settings', `
    SELECT conversion_action.id, conversion_action.resource_name, conversion_action.name,
           conversion_action.type, conversion_action.status, conversion_action.origin,
           conversion_action.category, conversion_action.primary_for_goal,
           conversion_action.include_in_conversions_metric, conversion_action.phone_call_duration_seconds
    FROM conversion_action
    ORDER BY conversion_action.name
  `, warnings)
  const conversionMetricRows = await safeQuery(accessToken, 'conversion action metrics', `
    SELECT segments.conversion_action, segments.conversion_action_name,
           metrics.conversions, metrics.all_conversions
    FROM customer
    WHERE ${dateWhere(range)}
    ORDER BY metrics.all_conversions DESC
  `, warnings)
  const metricByResource = new Map(conversionMetricRows.map((row) => [String(row.segments?.conversionAction || ''), {
    conversions: number(row.metrics?.conversions),
    allConversions: number(row.metrics?.allConversions),
    name: row.segments?.conversionActionName || ''
  }]))
  const metricByName = new Map(conversionMetricRows.map((row) => [String(row.segments?.conversionActionName || '').toLowerCase(), {
    conversions: number(row.metrics?.conversions),
    allConversions: number(row.metrics?.allConversions)
  }]))
  const conversionActions = conversionStaticRows.map((row) => {
    const action = row.conversionAction || {}
    const metrics = metricByResource.get(String(action.resourceName || '')) || metricByName.get(String(action.name || '').toLowerCase()) || {}
    return {
      id: String(action.id || ''),
      resourceName: action.resourceName || '',
      name: action.name || '',
      type: action.type || '',
      status: action.status || '',
      origin: action.origin || '',
      category: action.category || '',
      primaryForGoal: Boolean(action.primaryForGoal),
      includeInConversionsMetric: Boolean(action.includeInConversionsMetric),
      phoneCallDurationSeconds: number(action.phoneCallDurationSeconds),
      conversions: number(metrics.conversions),
      allConversions: number(metrics.allConversions)
    }
  })

  const deviceRows = await safeQuery(accessToken, 'devices', `
    SELECT segments.device, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM customer
    WHERE ${dateWhere(range)}
    ORDER BY metrics.cost_micros DESC
  `, warnings)
  const devices = deviceRows.map((row) => ({ device: row.segments?.device || 'UNKNOWN', ...metricRow(row.metrics || {}) }))

  return { ok: true, apiVersion: GOOGLE_ADS_API_VERSION, range, account, overview, daily, campaigns, keywords, searchTerms, conversionActions, devices, warnings, fetchedAt: new Date().toISOString() }
}

function connectionMissing() {
  const missing = []
  if (!cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')) missing.push('GOOGLE_ADS_CUSTOMER_ID')
  if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN')
  if (!process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON) missing.push('GOOGLE_ADS_SERVICE_ACCOUNT_JSON')
  return missing
}

async function runAiAudit(report) {
  const apiKey = process.env.OPENAI_API_KEY || ''
  if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'), { statusCode: 400 })
  const model = process.env.OPENAI_GOOGLE_ADS_MODEL || 'gpt-5.6-luna'
  const instructions = `You are the Google Ads auditor for a small Texas law firm. Analyze only the supplied Google Ads report. The firm cares about actual phone calls, successful web forms, qualified consultations, signed clients, and minimizing wasted spend. Be skeptical of reported zero conversions when tracking may be broken. Do not recommend raising budget unless the current traffic and conversion tracking justify it. Identify concrete campaign, keyword, search-term, device, and conversion-tracking issues. Distinguish facts from inferences. Give a concise executive summary, then prioritized findings, then exact recommended next actions. Never claim you changed the account; this tool is read-only.`
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
      const serviceAccount = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON ? serviceAccountConfig() : null
      if (missing.length) return json(res, 200, { ok: true, configured: false, connected: false, missing, serviceAccountEmail: serviceAccount?.client_email || '', apiVersion: GOOGLE_ADS_API_VERSION, aiConfigured: Boolean(process.env.OPENAI_API_KEY) })
      try {
        const accessToken = await googleAccessToken()
        const account = await accountInfo(accessToken)
        return json(res, 200, { ok: true, configured: true, connected: true, missing: [], account, serviceAccountEmail: serviceAccount?.client_email || '', apiVersion: GOOGLE_ADS_API_VERSION, aiConfigured: Boolean(process.env.OPENAI_API_KEY) })
      } catch (error) {
        return json(res, 200, { ok: true, configured: true, connected: false, missing: [], error: error?.message || String(error), serviceAccountEmail: serviceAccount?.client_email || '', apiVersion: GOOGLE_ADS_API_VERSION, aiConfigured: Boolean(process.env.OPENAI_API_KEY) })
      }
    }

    if (action === 'report') {
      if (connectionMissing().length) return json(res, 400, { ok: false, error: `Google Ads server configuration is incomplete: ${connectionMissing().join(', ')}` })
      const report = await buildReport(req.query?.days)
      return json(res, 200, report)
    }

    if (action === 'audit') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST for the AI audit.' })
      const report = req.body?.report
      if (!report || typeof report !== 'object') return json(res, 400, { ok: false, error: 'A Google Ads report is required.' })
      const audit = await runAiAudit(report)
      return json(res, 200, { ok: true, audit })
    }

    return json(res, 404, { ok: false, error: 'Unknown Google Ads action.' })
  } catch (error) {
    console.error('Google Ads API route error:', error)
    return json(res, error?.statusCode || 500, { ok: false, error: error?.message || 'Google Ads request failed.' })
  }
}
