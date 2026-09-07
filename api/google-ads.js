import crypto from 'node:crypto'

const GOOGLE_ADS_API_VERSION = 'v25'
const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'
const DEFAULT_APPROVER_EMAIL = 'ben@beveridgelawfirm.com'

function cleanCustomerId(value = '') {
  return String(value || '').replace(/[^0-9]/g, '')
}

function cleanId(value = '') {
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

function boolEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
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

function writeModeForUser(user, connected = true) {
  const actorEmail = String(user?.email || '').trim().toLowerCase()
  const serverEnabled = boolEnv(process.env.GOOGLE_ADS_WRITES_ENABLED)
  const configured = String(process.env.GOOGLE_ADS_WRITE_APPROVER_EMAILS || DEFAULT_APPROVER_EMAIL)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  const userAuthorized = Boolean(actorEmail && configured.includes(actorEmail))
  return {
    serverEnabled,
    userAuthorized,
    ready: Boolean(serverEnabled && userAuthorized && connected && connectionMissing().length === 0),
    actorEmail
  }
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
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth2:grant-type:jwt-bearer', assertion })
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

async function googleAdsPost(accessToken, servicePath, body) {
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/${servicePath}`, {
    method: 'POST',
    headers: googleAdsHeaders(accessToken),
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let payload
  try { payload = text ? JSON.parse(text) : {} } catch { payload = {} }
  const requestId = response.headers.get('request-id') || response.headers.get('x-request-id') || ''
  if (!response.ok) {
    const detail = payload?.error?.details?.[0]?.errors?.[0]?.message || payload?.error?.message || text || `Google Ads API returned ${response.status}.`
    const error = new Error(detail)
    error.requestId = requestId
    error.googlePayload = payload
    throw error
  }
  return { payload, requestId }
}

async function googleAdsSearch(accessToken, query) {
  const customerId = cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')
  if (!customerId) throw new Error('GOOGLE_ADS_CUSTOMER_ID is not configured.')
  const { payload } = await googleAdsPost(accessToken, `customers/${customerId}/googleAds:searchStream`, { query })
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
           campaign.bidding_strategy_type, campaign_budget.resource_name,
           campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.reference_count,
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
    budgetResourceName: row.campaignBudget?.resourceName || '',
    dailyBudget: micros(row.campaignBudget?.amountMicros),
    budgetExplicitlyShared: Boolean(row.campaignBudget?.explicitlyShared),
    budgetReferenceCount: number(row.campaignBudget?.referenceCount),
    ...metricRow(row.metrics || {})
  }))

  const adGroupRows = await safeQuery(accessToken, 'ad groups', `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status, ad_group.type,
           metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM ad_group
    WHERE ${dateWhere(range)} AND ad_group.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `, warnings)
  const adGroups = adGroupRows.map((row) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: row.campaign?.name || '',
    id: String(row.adGroup?.id || ''),
    name: row.adGroup?.name || '',
    status: row.adGroup?.status || '',
    type: row.adGroup?.type || '',
    ...metricRow(row.metrics || {})
  }))

  const adRows = await safeQuery(accessToken, 'ads', `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.name,
           ad_group_ad.ad.type, ad_group_ad.ad.final_urls,
           metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc,
           metrics.cost_micros, metrics.conversions, metrics.all_conversions,
           metrics.conversions_from_interactions_rate, metrics.cost_per_conversion
    FROM ad_group_ad
    WHERE ${dateWhere(range)} AND ad_group_ad.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `, warnings)
  const ads = adRows.map((row) => ({
    campaignId: String(row.campaign?.id || ''),
    campaignName: row.campaign?.name || '',
    adGroupId: String(row.adGroup?.id || ''),
    adGroupName: row.adGroup?.name || '',
    id: String(row.adGroupAd?.ad?.id || ''),
    name: row.adGroupAd?.ad?.name || '',
    type: row.adGroupAd?.ad?.type || '',
    finalUrls: Array.isArray(row.adGroupAd?.ad?.finalUrls) ? row.adGroupAd.ad.finalUrls : [],
    status: row.adGroupAd?.status || '',
    ...metricRow(row.metrics || {})
  }))

  const keywordRows = await safeQuery(accessToken, 'keywords', `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_criterion.criterion_id, ad_group_criterion.resource_name,
           ad_group_criterion.status, ad_group_criterion.negative,
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
    resourceName: row.adGroupCriterion?.resourceName || '',
    status: row.adGroupCriterion?.status || '',
    negative: Boolean(row.adGroupCriterion?.negative),
    keyword: row.adGroupCriterion?.keyword?.text || '',
    matchType: row.adGroupCriterion?.keyword?.matchType || '',
    ...metricRow(row.metrics || {})
  }))

  const campaignNegativeRows = await safeQuery(accessToken, 'campaign negatives', `
    SELECT campaign.id, campaign.name, campaign_criterion.criterion_id,
           campaign_criterion.resource_name, campaign_criterion.negative,
           campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign_criterion.negative = TRUE
  `, warnings)
  const campaignNegatives = campaignNegativeRows
    .filter((row) => Boolean(row.campaignCriterion?.keyword?.text))
    .map((row) => ({
      scope: 'campaign',
      campaignId: String(row.campaign?.id || ''),
      campaignName: row.campaign?.name || '',
      adGroupId: '',
      adGroupName: '',
      criterionId: String(row.campaignCriterion?.criterionId || ''),
      resourceName: row.campaignCriterion?.resourceName || '',
      keyword: row.campaignCriterion?.keyword?.text || '',
      matchType: row.campaignCriterion?.keyword?.matchType || ''
    }))

  const adGroupNegativeRows = await safeQuery(accessToken, 'ad group negatives', `
    SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
           ad_group_criterion.criterion_id, ad_group_criterion.resource_name,
           ad_group_criterion.status, ad_group_criterion.negative,
           ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type
    FROM ad_group_criterion
    WHERE ad_group_criterion.negative = TRUE AND ad_group_criterion.status != 'REMOVED'
  `, warnings)
  const adGroupNegatives = adGroupNegativeRows
    .filter((row) => Boolean(row.adGroupCriterion?.keyword?.text))
    .map((row) => ({
      scope: 'ad_group',
      campaignId: String(row.campaign?.id || ''),
      campaignName: row.campaign?.name || '',
      adGroupId: String(row.adGroup?.id || ''),
      adGroupName: row.adGroup?.name || '',
      criterionId: String(row.adGroupCriterion?.criterionId || ''),
      resourceName: row.adGroupCriterion?.resourceName || '',
      keyword: row.adGroupCriterion?.keyword?.text || '',
      matchType: row.adGroupCriterion?.keyword?.matchType || ''
    }))
  const negativeKeywords = [...campaignNegatives, ...adGroupNegatives]

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

  return {
    ok: true,
    apiVersion: GOOGLE_ADS_API_VERSION,
    range,
    account,
    overview,
    daily,
    campaigns,
    adGroups,
    ads,
    keywords,
    negativeKeywords,
    searchTerms,
    conversionActions,
    devices,
    warnings,
    fetchedAt: new Date().toISOString()
  }
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
  const instructions = `You are the Google Ads auditor for a small Texas law firm. Analyze only the supplied Google Ads report. The firm cares about actual phone calls, successful web forms, qualified consultations, signed clients, and minimizing wasted spend. Be skeptical of reported zero conversions when tracking may be broken. Do not recommend raising budget unless the current traffic and conversion tracking justify it. Identify concrete campaign, keyword, search-term, device, and conversion-tracking issues. Distinguish facts from inferences. Give a concise executive summary, then prioritized findings, then exact recommended next actions. This audit route cannot itself change the account; proposed changes still require the separate Mio approval flow.`
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

function normalizeStatus(value, allowed) {
  const status = String(value || '').trim().toUpperCase()
  if (!allowed.includes(status)) throw Object.assign(new Error(`Unsupported status: ${status || '(blank)'}.`), { statusCode: 400 })
  return status
}

function normalizeMatchType(value) {
  return normalizeStatus(value || 'EXACT', ['EXACT', 'PHRASE', 'BROAD'])
}

function normalizeKeyword(value) {
  const keyword = String(value || '').trim().replace(/\s+/g, ' ')
  if (!keyword) throw Object.assign(new Error('A keyword is required.'), { statusCode: 400 })
  if (keyword.length > 80) throw Object.assign(new Error('Google Ads keywords may not exceed 80 characters.'), { statusCode: 400 })
  return keyword
}

function requireId(value, label) {
  const id = cleanId(value)
  if (!id) throw Object.assign(new Error(`${label} is required.`), { statusCode: 400 })
  return id
}

function resourceNameFor(kind, idParts = []) {
  const customerId = cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')
  if (!customerId) throw Object.assign(new Error('GOOGLE_ADS_CUSTOMER_ID is not configured.'), { statusCode: 500 })
  if (kind === 'campaign') return `customers/${customerId}/campaigns/${requireId(idParts[0], 'Campaign ID')}`
  if (kind === 'adGroup') return `customers/${customerId}/adGroups/${requireId(idParts[0], 'Ad group ID')}`
  if (kind === 'adGroupAd') return `customers/${customerId}/adGroupAds/${requireId(idParts[0], 'Ad group ID')}~${requireId(idParts[1], 'Ad ID')}`
  if (kind === 'adGroupCriterion') return `customers/${customerId}/adGroupCriteria/${requireId(idParts[0], 'Ad group ID')}~${requireId(idParts[1], 'Criterion ID')}`
  if (kind === 'conversionAction') return `customers/${customerId}/conversionActions/${requireId(idParts[0], 'Conversion action ID')}`
  throw Object.assign(new Error('Unsupported Google Ads resource type.'), { statusCode: 400 })
}

function validatedExistingResourceName(value, collection) {
  const customerId = cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')
  const resourceName = String(value || '').trim()
  const pattern = new RegExp(`^customers/${customerId}/${collection}/[0-9~]+$`)
  if (!resourceName || !pattern.test(resourceName)) throw Object.assign(new Error(`A valid ${collection} resource name from this Google Ads account is required.`), { statusCode: 400 })
  return resourceName
}

function maxBudgetDollars() {
  const configured = Number(process.env.GOOGLE_ADS_MAX_BUDGET_DOLLARS || 1000)
  return Number.isFinite(configured) && configured > 0 ? configured : 1000
}

function buildMutationPlan(mutation = {}) {
  const type = String(mutation?.type || '').trim()
  const customerId = cleanCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID || '')
  if (!type) throw Object.assign(new Error('A mutation type is required.'), { statusCode: 400 })

  if (type === 'campaign_status') {
    const campaignId = requireId(mutation.campaignId, 'Campaign ID')
    const status = normalizeStatus(mutation.status, ['ENABLED', 'PAUSED'])
    return {
      type,
      summary: `${status === 'PAUSED' ? 'Pause' : 'Enable'} campaign ${campaignId}`,
      servicePath: `customers/${customerId}/campaigns:mutate`,
      operations: [{ update: { resourceName: resourceNameFor('campaign', [campaignId]), status }, updateMask: 'status' }]
    }
  }

  if (type === 'campaign_budget') {
    const dailyBudget = Number(mutation.dailyBudget)
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) throw Object.assign(new Error('Daily budget must be greater than $0.'), { statusCode: 400 })
    if (dailyBudget > maxBudgetDollars()) throw Object.assign(new Error(`Daily budget exceeds Mio's $${maxBudgetDollars().toLocaleString()} safety cap.`), { statusCode: 400 })
    const resourceName = validatedExistingResourceName(mutation.budgetResourceName, 'campaignBudgets')
    return {
      type,
      summary: `Set campaign budget to $${dailyBudget.toFixed(2)} per day`,
      servicePath: `customers/${customerId}/campaignBudgets:mutate`,
      operations: [{ update: { resourceName, amountMicros: Math.round(dailyBudget * 1_000_000).toString() }, updateMask: 'amountMicros' }]
    }
  }

  if (type === 'ad_group_status') {
    const adGroupId = requireId(mutation.adGroupId, 'Ad group ID')
    const status = normalizeStatus(mutation.status, ['ENABLED', 'PAUSED'])
    return {
      type,
      summary: `${status === 'PAUSED' ? 'Pause' : 'Enable'} ad group ${adGroupId}`,
      servicePath: `customers/${customerId}/adGroups:mutate`,
      operations: [{ update: { resourceName: resourceNameFor('adGroup', [adGroupId]), status }, updateMask: 'status' }]
    }
  }

  if (type === 'ad_status') {
    const adGroupId = requireId(mutation.adGroupId, 'Ad group ID')
    const adId = requireId(mutation.adId, 'Ad ID')
    const status = normalizeStatus(mutation.status, ['ENABLED', 'PAUSED'])
    return {
      type,
      summary: `${status === 'PAUSED' ? 'Pause' : 'Enable'} ad ${adId}`,
      servicePath: `customers/${customerId}/adGroupAds:mutate`,
      operations: [{ update: { resourceName: resourceNameFor('adGroupAd', [adGroupId, adId]), status }, updateMask: 'status' }]
    }
  }

  if (type === 'keyword_status') {
    const adGroupId = requireId(mutation.adGroupId, 'Ad group ID')
    const criterionId = requireId(mutation.criterionId, 'Criterion ID')
    const status = normalizeStatus(mutation.status, ['ENABLED', 'PAUSED'])
    return {
      type,
      summary: `${status === 'PAUSED' ? 'Pause' : 'Enable'} keyword criterion ${criterionId}`,
      servicePath: `customers/${customerId}/adGroupCriteria:mutate`,
      operations: [{ update: { resourceName: resourceNameFor('adGroupCriterion', [adGroupId, criterionId]), status }, updateMask: 'status' }]
    }
  }

  if (type === 'remove_keyword') {
    const adGroupId = requireId(mutation.adGroupId, 'Ad group ID')
    const criterionId = requireId(mutation.criterionId, 'Criterion ID')
    return {
      type,
      summary: `Remove keyword criterion ${criterionId}`,
      servicePath: `customers/${customerId}/adGroupCriteria:mutate`,
      operations: [{ remove: resourceNameFor('adGroupCriterion', [adGroupId, criterionId]) }]
    }
  }

  if (type === 'add_keyword') {
    const adGroupId = requireId(mutation.adGroupId, 'Ad group ID')
    const keyword = normalizeKeyword(mutation.keyword)
    const matchType = normalizeMatchType(mutation.matchType)
    return {
      type,
      summary: `Add ${matchType.toLowerCase()} keyword "${keyword}"`,
      servicePath: `customers/${customerId}/adGroupCriteria:mutate`,
      operations: [{ create: { adGroup: resourceNameFor('adGroup', [adGroupId]), status: 'ENABLED', negative: false, keyword: { text: keyword, matchType } } }]
    }
  }

  if (type === 'add_negative_keyword') {
    const keyword = normalizeKeyword(mutation.keyword)
    const matchType = normalizeMatchType(mutation.matchType)
    const scope = String(mutation.scope || 'campaign').trim().toLowerCase()
    if (scope === 'ad_group') {
      const adGroupId = requireId(mutation.adGroupId, 'Ad group ID')
      return {
        type,
        summary: `Add ad-group negative "${keyword}"`,
        servicePath: `customers/${customerId}/adGroupCriteria:mutate`,
        operations: [{ create: { adGroup: resourceNameFor('adGroup', [adGroupId]), status: 'ENABLED', negative: true, keyword: { text: keyword, matchType } } }]
      }
    }
    if (scope !== 'campaign') throw Object.assign(new Error('Negative keyword scope must be campaign or ad_group.'), { statusCode: 400 })
    const campaignId = requireId(mutation.campaignId, 'Campaign ID')
    return {
      type,
      summary: `Add campaign negative "${keyword}"`,
      servicePath: `customers/${customerId}/campaignCriteria:mutate`,
      operations: [{ create: { campaign: resourceNameFor('campaign', [campaignId]), negative: true, keyword: { text: keyword, matchType } } }]
    }
  }

  if (type === 'remove_negative_keyword') {
    const resourceName = String(mutation.resourceName || '').trim()
    if (resourceName.includes('/adGroupCriteria/')) {
      return {
        type,
        summary: `Remove ad-group negative "${String(mutation.keyword || '').trim()}"`,
        servicePath: `customers/${customerId}/adGroupCriteria:mutate`,
        operations: [{ remove: validatedExistingResourceName(resourceName, 'adGroupCriteria') }]
      }
    }
    if (resourceName.includes('/campaignCriteria/')) {
      return {
        type,
        summary: `Remove campaign negative "${String(mutation.keyword || '').trim()}"`,
        servicePath: `customers/${customerId}/campaignCriteria:mutate`,
        operations: [{ remove: validatedExistingResourceName(resourceName, 'campaignCriteria') }]
      }
    }
    throw Object.assign(new Error('A valid negative-keyword resource name is required.'), { statusCode: 400 })
  }

  if (type === 'conversion_primary') {
    const resourceName = mutation.resourceName
      ? validatedExistingResourceName(mutation.resourceName, 'conversionActions')
      : resourceNameFor('conversionAction', [mutation.conversionActionId])
    const primaryForGoal = Boolean(mutation.primaryForGoal)
    return {
      type,
      summary: `${primaryForGoal ? 'Make primary' : 'Make secondary'} conversion action`,
      servicePath: `customers/${customerId}/conversionActions:mutate`,
      operations: [{ update: { resourceName, primaryForGoal }, updateMask: 'primaryForGoal' }]
    }
  }

  if (type === 'conversion_status') {
    const resourceName = mutation.resourceName
      ? validatedExistingResourceName(mutation.resourceName, 'conversionActions')
      : resourceNameFor('conversionAction', [mutation.conversionActionId])
    const status = normalizeStatus(mutation.status, ['ENABLED', 'HIDDEN'])
    return {
      type,
      summary: `${status === 'ENABLED' ? 'Enable' : 'Hide'} conversion action`,
      servicePath: `customers/${customerId}/conversionActions:mutate`,
      operations: [{ update: { resourceName, status }, updateMask: 'status' }]
    }
  }

  throw Object.assign(new Error(`Unsupported Google Ads mutation type: ${type}.`), { statusCode: 400 })
}

function mutationResultResources(payload) {
  const rows = Array.isArray(payload?.results) ? payload.results : []
  return rows.map((row) => row?.resourceName || row?.resource_name || '').filter(Boolean)
}

async function applyApprovedMutation(accessToken, user, body = {}) {
  const writeMode = writeModeForUser(user, true)
  if (!writeMode.serverEnabled) throw Object.assign(new Error('Google Ads live writes are locked on the server.'), { statusCode: 403 })
  if (!writeMode.userAuthorized) throw Object.assign(new Error('Your Mio account is not authorized to approve Google Ads writes.'), { statusCode: 403 })
  if (String(body?.confirmation || '') !== 'APPLY') throw Object.assign(new Error('Explicit APPLY confirmation is required.'), { statusCode: 400 })
  if (!body?.mutation || typeof body.mutation !== 'object' || Array.isArray(body.mutation)) throw Object.assign(new Error('A structured Google Ads mutation is required.'), { statusCode: 400 })

  const plan = buildMutationPlan(body.mutation)
  const validate = await googleAdsPost(accessToken, plan.servicePath, {
    operations: plan.operations,
    validateOnly: true,
    partialFailure: false
  })

  const applied = await googleAdsPost(accessToken, plan.servicePath, {
    operations: plan.operations,
    validateOnly: false,
    partialFailure: false
  })

  const log = {
    type: plan.type,
    summary: plan.summary,
    actorEmail: writeMode.actorEmail,
    reason: String(body?.reason || '').trim().slice(0, 1000),
    validated: true,
    validationRequestId: validate.requestId || '',
    requestId: applied.requestId || '',
    resultResources: mutationResultResources(applied.payload),
    appliedAt: new Date().toISOString()
  }
  console.info('GOOGLE_ADS_LIVE_CHANGE', JSON.stringify(log))
  return { ok: true, applied: true, log }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  try {
    const user = await requireFirmUser(req)
    const action = String(req.query?.action || 'status').toLowerCase()

    if (action === 'status') {
      const missing = connectionMissing()
      const serviceAccount = process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON ? serviceAccountConfig() : null
      if (missing.length) {
        return json(res, 200, {
          ok: true,
          configured: false,
          connected: false,
          missing,
          serviceAccountEmail: serviceAccount?.client_email || '',
          apiVersion: GOOGLE_ADS_API_VERSION,
          aiConfigured: Boolean(process.env.OPENAI_API_KEY),
          writeMode: writeModeForUser(user, false)
        })
      }
      try {
        const accessToken = await googleAccessToken()
        const account = await accountInfo(accessToken)
        return json(res, 200, {
          ok: true,
          configured: true,
          connected: true,
          missing: [],
          account,
          serviceAccountEmail: serviceAccount?.client_email || '',
          apiVersion: GOOGLE_ADS_API_VERSION,
          aiConfigured: Boolean(process.env.OPENAI_API_KEY),
          writeMode: writeModeForUser(user, true)
        })
      } catch (error) {
        return json(res, 200, {
          ok: true,
          configured: true,
          connected: false,
          missing: [],
          error: error?.message || String(error),
          serviceAccountEmail: serviceAccount?.client_email || '',
          apiVersion: GOOGLE_ADS_API_VERSION,
          aiConfigured: Boolean(process.env.OPENAI_API_KEY),
          writeMode: writeModeForUser(user, false)
        })
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

    if (action === 'mutate') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST for Google Ads mutations.' })
      if (connectionMissing().length) return json(res, 400, { ok: false, error: `Google Ads server configuration is incomplete: ${connectionMissing().join(', ')}` })
      const accessToken = await googleAccessToken()
      const result = await applyApprovedMutation(accessToken, user, req.body || {})
      return json(res, 200, result)
    }

    return json(res, 404, { ok: false, error: 'Unknown Google Ads action.' })
  } catch (error) {
    console.error('Google Ads API route error:', error)
    return json(res, error?.statusCode || 500, { ok: false, error: error?.message || 'Google Ads request failed.', requestId: error?.requestId || '' })
  }
}
