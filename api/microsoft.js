// Consolidated Microsoft API. One Vercel function dispatches the old
// /api/microsoft/callback, /oauth-start, /status URLs via vercel.json rewrites
// (?action=...), preserving the OAuth callback and all query strings. The
// /api/microsoft/sync cron endpoint stays its own function.
import { requireParalegalUser } from '../lib/paralegal/auth.js'
import { buildAuthorizationUrl, exchangeCodeForToken, normalizeTokenResponse } from '../lib/paralegal/microsoft/oauth.js'
import { signOAuthState, verifyOAuthState } from '../lib/paralegal/microsoft/state.js'
import { createMicrosoftTokenStore } from '../lib/paralegal/microsoft/tokenStore.js'
import { createEmailTokenStore } from '../lib/email/tokenStore.js'
import { getMe as graphGetMe } from '../lib/email/graphMail.js'

export default async function handler(req, res) {
  const action = String(req.query?.action || '')
  if (action === 'callback') return callback(req, res)
  if (action === 'oauth_start') return oauthStart(req, res)
  if (action === 'status') return status(req, res)
  return res.status(404).json({ ok: false, error: 'Unknown Microsoft action.' })
}

// The OAuth state carries `accountEmail` only for the email dashboard flow; the
// paralegal flow carries only `userId`. Use it to route the redirect back to the
// correct app view.
function targetForState(state) {
  try {
    const payload = verifyOAuthState(state, process.env.MICROSOFT_OAUTH_STATE_SECRET)
    if (payload?.accountEmail) return 'email'
  } catch { /* fall through */ }
  return 'microsoft'
}

async function callback(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  const state = req.query?.state
  try {
    const { code, error, error_description } = req.query || {}
    if (error) return res.redirect('/#' + targetForState(state) + '?error=' + encodeURIComponent(error_description || error))
    if (!code || !state) return res.redirect('/#microsoft?error=missing_code')
    const payload = verifyOAuthState(state, process.env.MICROSOFT_OAUTH_STATE_SECRET)
    if (!payload?.userId) return res.redirect('/#microsoft?error=invalid_state')
    const token = await exchangeCodeForToken({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI,
      tenant: process.env.MICROSOFT_TENANT || 'common',
      code,
    })
    if (payload.accountEmail) {
      // Email dashboard flow: store into the multi-mailbox token table.
      const normalized = normalizeTokenResponse(token, { accountEmail: payload.accountEmail })
      const store = createEmailTokenStore()
      let displayName = payload.accountEmail
      try {
        const me = await graphGetMe({ accessToken: normalized.accessToken })
        displayName = me?.data?.displayName || me?.data?.mail || payload.accountEmail
      } catch { /* keep account email */ }
      await store.save(payload.userId, payload.accountEmail, { ...normalized, displayName })
      return res.redirect('/#email?connected=1')
    }
    await createMicrosoftTokenStore().save(payload.userId, normalizeTokenResponse(token))
    return res.redirect('/#microsoft?connected=1')
  } catch (error) {
    return res.redirect('/#' + targetForState(state) + '?error=' + encodeURIComponent(error.message || 'callback_failed'))
  }
}

async function oauthStart(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const user = await requireParalegalUser(req)
    const clientId = process.env.MICROSOFT_CLIENT_ID
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI
    if (!clientId || !redirectUri) {
      return res.status(503).json({ ok: false, error: 'Microsoft OAuth is not configured on the server.' })
    }
    const state = signOAuthState({ userId: user.id }, process.env.MICROSOFT_OAUTH_STATE_SECRET)
    const url = buildAuthorizationUrl({
      clientId,
      redirectUri,
      tenant: process.env.MICROSOFT_TENANT || 'common',
      loginHint: user.email,
      state,
    })
    return res.status(200).json({ ok: true, url })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Microsoft OAuth could not start.' })
  }
}

async function status(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const user = await requireParalegalUser(req)
    const token = await createMicrosoftTokenStore().load(user.id)
    if (!token) return res.status(200).json({ ok: true, connected: false })
    return res.status(200).json({
      ok: true,
      connected: true,
      accountEmail: token.accountEmail || '',
      scopes: token.scopes || [],
      expiresAt: token.expiresAt || '',
    })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Microsoft status check failed.' })
  }
}
