// Minimal Microsoft Graph v1.0 client for the Paralegal email/calendar scope.
// Note: sendMail returns HTTP 202 Accepted, which is not proof of delivery.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export async function graphRequest({ accessToken, path, method = 'GET', body, query = {}, fetchImpl = fetch }) {
  if (!accessToken) throw Object.assign(new Error('Microsoft access token is missing.'), { code: 'MS_NO_TOKEN' })
  const url = new URL(path.startsWith('http') ? path : GRAPH_BASE + path)
  for (const [key, value] of Object.entries(query)) {
    if (value != null) url.searchParams.set(key, String(value))
  }
  const response = await fetchImpl(url.toString(), {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000)
  })
  const text = await response.text().catch(() => '')
  let data = {}
  try { data = text ? JSON.parse(text) : {} } catch {}
  if (!response.ok) {
    const message = data?.error?.message || `Microsoft Graph request failed with status ${response.status || 'unknown'}.`
    throw Object.assign(new Error(message), { code: 'MS_GRAPH_FAILED', statusCode: response.status || 502, body: data })
  }
  return { status: response.status, data }
}

// Mail
export function getMe({ accessToken, fetchImpl }) {
  return graphRequest({ accessToken, path: '/me', fetchImpl })
}
export function listMessages({ accessToken, query = {}, fetchImpl }) {
  return graphRequest({ accessToken, path: '/me/messages', query, fetchImpl })
}
export function listSentMessages({ accessToken, query = {}, fetchImpl }) {
  return graphRequest({ accessToken, path: '/me/mailFolders/SentItems/messages', query, fetchImpl })
}
export function getMessage({ accessToken, messageId, fetchImpl }) {
  return graphRequest({ accessToken, path: `/me/messages/${encodeURIComponent(messageId)}`, fetchImpl })
}
export function createReplyDraft({ accessToken, messageId, reply, fetchImpl }) {
  return graphRequest({ accessToken, path: `/me/messages/${encodeURIComponent(messageId)}/createReply`, method: 'POST', body: reply, fetchImpl })
}
export function updateDraft({ accessToken, draftId, patch, fetchImpl }) {
  return graphRequest({ accessToken, path: `/me/messages/${encodeURIComponent(draftId)}`, method: 'PATCH', body: patch, fetchImpl })
}
export function sendDraft({ accessToken, draftId, fetchImpl }) {
  return graphRequest({ accessToken, path: `/me/messages/${encodeURIComponent(draftId)}/send`, method: 'POST', fetchImpl })
}
export function sendMail({ accessToken, message, fetchImpl }) {
  return graphRequest({ accessToken, path: '/me/sendMail', method: 'POST', body: { message, saveToSentItems: true }, fetchImpl })
}
export function deltaMessages({ accessToken, query = {}, fetchImpl }) {
  return graphRequest({ accessToken, path: '/me/mailFolders/inbox/messages/delta', query, fetchImpl })
}

// Change-notification subscriptions
export function createSubscription({ accessToken, subscription, fetchImpl }) {
  return graphRequest({ accessToken, path: '/subscriptions', method: 'POST', body: subscription, fetchImpl })
}
export function renewSubscription({ accessToken, subscriptionId, expirationDateTime, fetchImpl }) {
  return graphRequest({ accessToken, path: `/subscriptions/${encodeURIComponent(subscriptionId)}`, method: 'PATCH', body: { expirationDateTime }, fetchImpl })
}
export function deleteSubscription({ accessToken, subscriptionId, fetchImpl }) {
  return graphRequest({ accessToken, path: `/subscriptions/${encodeURIComponent(subscriptionId)}`, method: 'DELETE', fetchImpl })
}
