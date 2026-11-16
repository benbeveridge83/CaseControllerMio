import { refreshAccessToken, normalizeTokenResponse } from '../paralegal/microsoft/oauth.js'

// Renew before Graph reads; keep rotated credentials on the server.
export async function usableEmailToken(store, userId, accountEmail, { env = process.env, refresh = refreshAccessToken } = {}) {
  const token = await store.load(userId, accountEmail)
  if (!token) return null
  if (token.expiresAt && Date.parse(token.expiresAt) > Date.now() + 60000) return token
  if (!token.refreshToken) throw Object.assign(new Error(`Reconnect ${accountEmail} in Mailbox settings to resume loading emails.`), { statusCode: 409 })
  let result
  try {
    result = await refresh({ clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenant: env.MICROSOFT_TENANT || 'common', refreshToken: token.refreshToken })
  } catch {
    throw Object.assign(new Error(`Could not renew the Outlook connection for ${accountEmail}. Reconnect it in Mailbox settings.`), { statusCode: 409 })
  }
  const next = normalizeTokenResponse(result, { accountEmail })
  if (!next.accessToken) throw Object.assign(new Error(`Reconnect ${accountEmail} in Mailbox settings.`), { statusCode: 409 })
  next.refreshToken ||= token.refreshToken
  next.idToken ||= token.idToken
  if (!next.scopes.length) next.scopes = token.scopes
  next.displayName = token.displayName
  await store.save(userId, accountEmail, next)
  return next
}
