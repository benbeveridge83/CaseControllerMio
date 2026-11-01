import { requireParalegalUser } from '../../lib/paralegal/auth.js'
import { buildAuthorizationUrl } from '../../lib/paralegal/microsoft/oauth.js'
import { signOAuthState } from '../../lib/paralegal/microsoft/state.js'

export default async function handler(req, res) {
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
      state
    })
    return res.redirect(url)
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || 'Microsoft OAuth could not start.' })
  }
}
