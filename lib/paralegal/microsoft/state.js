// HMAC-signed OAuth state to bind the Microsoft redirect back to a Mio user.
import { createHmac, timingSafeEqual } from 'node:crypto'

function encode(payload, secret) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(json).digest('base64url')
  return `${json}.${sig}`
}

function decode(value, secret) {
  if (!value || typeof value !== 'string') return null
  const dot = value.indexOf('.')
  if (dot === -1) return null
  const json = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(json).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try { return JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) } catch { return null }
}

export function signOAuthState(payload, secret = process.env.MICROSOFT_OAUTH_STATE_SECRET) {
  if (!secret) throw Object.assign(new Error('OAuth state secret is not configured.'), { code: 'MS_STATE_NOT_CONFIGURED' })
  return encode(payload, secret)
}

export function verifyOAuthState(value, secret = process.env.MICROSOFT_OAUTH_STATE_SECRET) {
  if (!secret) return null
  return decode(value, secret)
}
