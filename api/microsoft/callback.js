import { exchangeCodeForToken, normalizeTokenResponse } from '../../lib/paralegal/microsoft/oauth.js'
import { verifyOAuthState } from '../../lib/paralegal/microsoft/state.js'
import { createMicrosoftTokenStore } from '../../lib/paralegal/microsoft/tokenStore.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const { code, state, error, error_description } = req.query || {}
    if (error) return res.redirect('/#microsoft?error=' + encodeURIComponent(error_description || error))
    if (!code || !state) return res.redirect('/#microsoft?error=missing_code')
    const payload = verifyOAuthState(state, process.env.MICROSOFT_OAUTH_STATE_SECRET)
    if (!payload?.userId) return res.redirect('/#microsoft?error=invalid_state')
    const token = await exchangeCodeForToken({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI,
      tenant: process.env.MICROSOFT_TENANT || 'common',
      code
    })
    await createMicrosoftTokenStore().save(payload.userId, normalizeTokenResponse(token))
    return res.redirect('/#microsoft?connected=1')
  } catch (error) {
    return res.redirect('/#microsoft?error=' + encodeURIComponent(error.message || 'callback_failed'))
  }
}
