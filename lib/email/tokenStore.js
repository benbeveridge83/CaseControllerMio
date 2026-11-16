// Multi-mailbox Microsoft token storage for the email dashboard.
// Server-side only: uses the Supabase service role so tokens are never readable
// by the browser (the table has no public RLS policies).

import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '../../src/mioSupabasePublic.js'

function serverConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || '',
  }
}

export function createEmailTokenStore({ url, serviceKey, supabase = null, env = process.env } = {}) {
  const cfg = url && serviceKey ? { url, serviceKey } : serverConfig(env)
  if (!cfg.url || !cfg.serviceKey) {
    throw Object.assign(new Error('Supabase service role is not configured for email token storage.'), { code: 'EMAIL_STORE_NOT_CONFIGURED' })
  }
  const db = supabase || createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  function mapRow(row) {
    return {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      idToken: row.id_token,
      expiresAt: row.expires_at,
      scopes: (row.scopes || '').split(' ').filter(Boolean),
      accountEmail: row.account_email,
      displayName: row.display_name,
    }
  }

  async function save(userId, accountEmail, token) {
    const { error } = await db.from('mio_email_tokens').upsert({
      user_id: userId,
      account_email: String(accountEmail || '').trim().toLowerCase(),
      access_token: token.accessToken,
      refresh_token: token.refreshToken || null,
      id_token: token.idToken || null,
      expires_at: token.expiresAt ? new Date(token.expiresAt).toISOString() : null,
      scopes: Array.isArray(token.scopes) ? token.scopes.join(' ') : String(token.scopes || ''),
      display_name: token.displayName || null,
      updated_at: new Date().toISOString(),
    })
    if (error) throw Object.assign(new Error('Could not store email tokens.'), { code: 'EMAIL_STORE_SAVE_FAILED', cause: error })
    return true
  }

  async function load(userId, accountEmail) {
    const { data, error } = await db
      .from('mio_email_tokens')
      .select('*')
      .eq('user_id', userId)
      .eq('account_email', String(accountEmail || '').trim().toLowerCase())
      .maybeSingle()
    if (error) throw Object.assign(new Error('Could not load email tokens.'), { code: 'EMAIL_STORE_LOAD_FAILED', cause: error })
    if (!data) return null
    return mapRow(data)
  }

  async function listForUser(userId) {
    const { data, error } = await db.from('mio_email_tokens').select('*').eq('user_id', userId).order('account_email')
    if (error) throw Object.assign(new Error('Could not list email tokens.'), { code: 'EMAIL_STORE_LIST_FAILED', cause: error })
    return (data || []).map(mapRow)
  }

  async function remove(userId, accountEmail) {
    const { error } = await db
      .from('mio_email_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('account_email', String(accountEmail || '').trim().toLowerCase())
    if (error) throw Object.assign(new Error('Could not remove email tokens.'), { code: 'EMAIL_STORE_REMOVE_FAILED', cause: error })
    return true
  }

  return Object.freeze({ save, load, listForUser, remove })
}
