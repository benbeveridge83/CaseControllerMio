// Microsoft identity platform (v2.0) OAuth helpers for delegated Graph access.

const AUTHORIZE_URL = (tenant) => `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0/authorize`
const TOKEN_URL = (tenant) => `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0/token`

export const MICROSOFT_GRAPH_SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'Mail.ReadWrite', 'Mail.Send'
]

function requireConfig({ clientId, clientSecret, redirectUri }) {
  if (!clientId || !clientSecret || !redirectUri) {
    throw Object.assign(new Error('Microsoft OAuth client_id, client_secret, and redirect_uri are required.'), { code: 'MS_AUTH_NOT_CONFIGURED' })
  }
}

export function buildAuthorizationUrl({ clientId, redirectUri, tenant = 'common', scopes = MICROSOFT_GRAPH_SCOPES, state, loginHint }) {
  if (!clientId || !redirectUri) {
    throw Object.assign(new Error('Microsoft OAuth client_id and redirect_uri are required.'), { code: 'MS_AUTH_NOT_CONFIGURED' })
  }
  const url = new URL(AUTHORIZE_URL(tenant))
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('response_mode', 'query')
  if (state) url.searchParams.set('state', state)
  if (loginHint) url.searchParams.set('login_hint', loginHint)
  return url.toString()
}

export async function exchangeCodeForToken({ clientId, clientSecret, redirectUri, tenant = 'common', code, fetchImpl = fetch }) {
  requireConfig({ clientId, clientSecret, redirectUri })
  if (!code) throw Object.assign(new Error('An authorization code is required.'), { code: 'MS_AUTH_NO_CODE' })
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code
  })
  return postToken({ tenant, body, fetchImpl })
}

export async function refreshAccessToken({ clientId, clientSecret, tenant = 'common', refreshToken, fetchImpl = fetch }) {
  requireConfig({ clientId, clientSecret, redirectUri: 'unused' })
  if (!refreshToken) throw Object.assign(new Error('A refresh token is required.'), { code: 'MS_AUTH_NO_REFRESH' })
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  return postToken({ tenant, body, fetchImpl })
}

async function postToken({ tenant, body, fetchImpl }) {
  const response = await fetchImpl(TOKEN_URL(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20000)
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error_description || data?.error || `Microsoft token request failed with status ${response.status || 'unknown'}.`
    throw Object.assign(new Error(message), { code: data?.error || 'MS_TOKEN_FAILED', statusCode: response.status || 502 })
  }
  return data
}

export function normalizeTokenResponse(data, { accountEmail = '' } = {}) {
  const expiresIn = Number(data?.expires_in)
  return {
    accessToken: data?.access_token || '',
    refreshToken: data?.refresh_token || '',
    idToken: data?.id_token || '',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : '',
    scopes: String(data?.scope || '').split(' ').filter(Boolean),
    accountEmail
  }
}
