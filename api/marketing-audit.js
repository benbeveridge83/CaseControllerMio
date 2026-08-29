function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

async function requireFirmUser(req) {
  const authorization = String(req.headers.authorization || '')
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw Object.assign(new Error('Missing Mio session token.'), { statusCode: 401 })
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!supabaseUrl || !supabaseAnonKey) throw Object.assign(new Error('Server Supabase auth variables are not configured.'), { statusCode: 500 })
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey } })
  if (!response.ok) throw Object.assign(new Error('Your Mio session could not be verified.'), { statusCode: 401 })
  const user = await response.json()
  const email = String(user?.email || '').trim().toLowerCase()
  if (!email.endsWith('@beveridgelawfirm.com')) throw Object.assign(new Error('Marketing reporting is limited to Beveridge Law Firm staff accounts.'), { statusCode: 403 })
  return user
}

function trimReport(report = {}, provider = '') {
  if (!report || typeof report !== 'object') return null
  if (provider === 'google') return {
    range: report.range, account: report.account, overview: report.overview,
    campaigns: (report.campaigns || []).slice(0, 25), searchTerms: (report.searchTerms || []).slice(0, 75),
    keywords: (report.keywords || []).slice(0, 50), conversionActions: report.conversionActions || [],
    devices: report.devices || [], warnings: report.warnings || []
  }
  return {
    range: report.range, account: report.account, page: report.page, overview: report.overview,
    campaigns: (report.campaigns || []).slice(0, 25), adSets: (report.adSets || []).slice(0, 40),
    ads: (report.ads || []).slice(0, 60), platforms: report.platforms || [], devices: report.devices || [],
    regions: (report.regions || []).slice(0, 30), warnings: report.warnings || []
  }
}

async function runAiAudit(input) {
  const apiKey = process.env.OPENAI_API_KEY || ''
  if (!apiKey) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'), { statusCode: 400 })
  const model = process.env.OPENAI_MARKETING_AUDIT_MODEL || process.env.OPENAI_GOOGLE_ADS_MODEL || 'gpt-5.6-luna'
  const instructions = `You are the cross-channel paid advertising auditor for a small Texas law firm. Compare the supplied Google Ads and Meta Ads reports. The firm cares about actual qualified calls, successful forms, consultations, signed clients, and cost per qualified outcome. Platform conversions and Meta lead actions are signals, not proof of a retained client. Identify exactly where money is going, which platform/campaigns are efficient or wasteful, whether conversion tracking may be broken, and what should be changed first. Do not recommend increasing budget until tracking and current traffic quality justify it. Distinguish facts from inferences. Give: (1) executive summary, (2) spend/outcome comparison, (3) highest-priority problems, (4) exact recommended actions for Google and Meta separately, and (5) what additional lead-quality data from Mio would improve the decision. Never claim you changed either ad account; all integrations are read-only.`
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, instructions, input: JSON.stringify(input), max_output_tokens: 2600 })
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI returned ${response.status}.`)
  const direct = typeof payload?.output_text === 'string' ? payload.output_text : ''
  const nested = Array.isArray(payload?.output) ? payload.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map((item) => item?.text || item?.output_text || '').filter(Boolean).join('\n') : ''
  return direct || nested || 'The AI audit completed but returned no text.'
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Use POST.' })
  try {
    await requireFirmUser(req)
    const google = trimReport(req.body?.google, 'google')
    const meta = trimReport(req.body?.meta, 'meta')
    if (!google && !meta) return json(res, 400, { ok: false, error: 'At least one advertising report is required.' })
    const audit = await runAiAudit({ google, meta })
    return json(res, 200, { ok: true, audit })
  } catch (error) {
    console.error('Marketing audit route error:', error)
    return json(res, error?.statusCode || 500, { ok: false, error: error?.message || 'Marketing audit failed.' })
  }
}
