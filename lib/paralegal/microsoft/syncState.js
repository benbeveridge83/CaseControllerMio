// Per-user, per-folder delta cursor persistence for background mailbox sync.
// Service-role only, like the token store.
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '../../../src/mioSupabasePublic.js'

function serverConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || ''
  }
}

export function createMicrosoftSyncState({ url, serviceKey, supabase = null, env = process.env } = {}) {
  const cfg = url && serviceKey ? { url, serviceKey } : serverConfig(env)
  if (!cfg.url || !cfg.serviceKey) {
    throw Object.assign(new Error('Supabase service role is not configured for sync state.'), { code: 'SYNC_STORE_NOT_CONFIGURED' })
  }
  const db = supabase || createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  async function load(userId, folder = 'inbox') {
    const { data, error } = await db.from('mio_microsoft_sync_state').select('cursor, last_sync_at').eq('user_id', userId).eq('folder', folder).maybeSingle()
    if (error) throw Object.assign(new Error('Could not load sync state.'), { code: 'SYNC_LOAD_FAILED', cause: error })
    return { cursor: data?.cursor || null, lastSyncAt: data?.last_sync_at || null }
  }

  async function save(userId, cursor, folder = 'inbox') {
    const { error } = await db.from('mio_microsoft_sync_state').upsert({
      user_id: userId,
      folder,
      cursor,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    if (error) throw Object.assign(new Error('Could not save sync state.'), { code: 'SYNC_SAVE_FAILED', cause: error })
    return true
  }

  return Object.freeze({ load, save })
}
