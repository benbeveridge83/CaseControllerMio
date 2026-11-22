import process from 'node:process'
import { categorizeLines, validateLines } from '../lib/appointed-categorize.js'
export const config = { maxDuration: 120 }
function send(res, code, data) {
  res.status(code).setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data))
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST.' })
  try {
    const authorization = String(req.headers.authorization || '')
    if (!/^Bearer \S+$/i.test(authorization)) return send(res, 401, { ok: false, error: 'Sign in to Mio before categorizing.' })
    const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
    const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !key) return send(res, 503, { ok: false, error: 'Mio’s server authentication is not configured.' })
    const auth = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: authorization, apikey: key }, signal: AbortSignal.timeout(12000) })
    if (!auth.ok) return send(res, 401, { ok: false, error: 'Your Mio session expired. Sign in again.' })
    const user = await auth.json()
    if (!user.email_confirmed_at || !String(user.email || '').toLowerCase().endsWith('@beveridgelawfirm.com')) return send(res, 403, { ok: false, error: 'Appointed billing is limited to verified firm staff.' })
    if (req.body?.action !== 'categorize') return send(res, 400, { ok: false, error: 'Unknown appointed billing action.' })
    const lines = validateLines(req.body.lines)
    return send(res, 200, { ok: true, lines: await categorizeLines(lines) })
  } catch (error) {
    // Preserve privileged descriptions: do not log request bodies or provider payloads.
    return send(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'Categorization failed. Your entries were kept; retry or review them manually.' })
  }
}
