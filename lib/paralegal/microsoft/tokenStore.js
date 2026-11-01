// Server-side Microsoft token storage. Uses the Supabase service role so tokens
// are never readable by the browser (the table has no public RLS policies).
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '../../../src/mioSupabasePublic.js'

function serverConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || ''
  }
}

export function createMicrosoftTokenStore({ url, serviceKey, supabase = null, env = process.env } = {}) {
  const cfg = url && serviceKey ? { url, serviceKey } : serverConfig(env)
  if (!cfg.url || !cfg.serviceKey) {
    throw Object.assign(new Error('Supabase service role is not configured for Microsoft token storage.'), { code: 'MS_STORE_NOT_CONFIGURED' })
  }
  const db = supabase || createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  async function save(userId, token) {
    const { error } = await db.from('mio_microsoft_tokens').upsert({
      user_id: userId,
      account_email: token.accountEmail || null,
      access_token: token.accessToken,
      refresh_token: token.refreshToken || null,
      id_token: token.idToken || null,
      expires_at: token.expiresAt ? new Date(token.expiresAt).toISOString() : null,
      scopes: Array.isArray(token.scopes) ? token.scopes.join(' ') : String(token.scopes || ''),
      updated_at: new Date().toISOString()
    })
    if (error) throw Object.assign(new Error('Could not store Microsoft tokens.'), { code: 'MS_STORE_SAVE_FAILED', cause: error })
    return true
  }

  async function load(userId) {
    const { data, error } = await db.from('mio_microsoft_tokens').select('*').eq('user_id', userId).maybeSingle()
    if (error) throw Object.assign(new Error('Could not load Microsoft tokens.'), { code: 'MS_STORE_LOAD_FAILED', cause: error })
    if (!data) return null
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresAt: data.expires_at,
      scopes: (data.scopes || '').split(' ').filter(Boolean),
      accountEmail: data.account_email
    }
  }

  async function remove(userId) {
    const { error } = await db.from('mio_microsoft_tokens').delete().eq('user_id', userId)
    if (error) throw Object.assign(new Error('Could not remove Microsoft tokens.'), { code: 'MS_STORE_REMOVE_FAILED', cause: error })
    return true
  }

  return Object.freeze({ save, load, remove })
}
