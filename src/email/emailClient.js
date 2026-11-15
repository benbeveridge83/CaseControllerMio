// Frontend client for the email dashboard API. All calls go through the single
// /api/email/dashboard function with ?action=... and the signed-in Supabase JWT.

import { supabase } from '../supabaseClient.js'

async function sessionToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

async function request(action, { method = 'GET', body, params } = {}) {
  const query = new URLSearchParams({ action })
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null) query.set(key, String(value))
  }
  const accessToken = await sessionToken()
  const res = await fetch(`/api/email/dashboard?${query.toString()}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `Email dashboard request failed (${res.status}).`), { statusCode: res.status })
  return data
}

export const emailClient = {
  status: () => request('status'),
  connectStart: (account) => request('connect_start', { method: 'POST', body: { account } }),
  disconnect: (account) => request('disconnect', { method: 'POST', body: { account } }),
  folders: () => request('folders'),
  messages: () => request('messages'),
  message: (id, accountEmail) => request('message', { params: { id, accountEmail } }),
  classify: (message, matterName) => request('classify', { method: 'POST', body: { message, matterName } }),
  draft: (message, matterName) => request('draft', { method: 'POST', body: { message, matterName } }),
  getSettings: () => request('settings'),
  saveSettings: (accountEmail, selections) => request('settings', { method: 'POST', body: { accountEmail, selections } }),
  resolve: (messageId, category, resolved) => request('resolve', { method: 'POST', body: { messageId, category, resolved } }),
  resolutions: () => request('resolutions'),
}
