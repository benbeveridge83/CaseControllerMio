// Supabase-backed durable review storage for the Need to Set controller.
// Service-role only: the mio_paralegal_reviews table has no public RLS policies.
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_SUPABASE_URL } from '../../src/mioSupabasePublic.js'

function serverConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || PUBLIC_SUPABASE_URL || '',
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY || ''
  }
}

export function createSupabaseReviews({ url, serviceKey, supabase = null, env = process.env } = {}) {
  const cfg = url && serviceKey ? { url, serviceKey } : serverConfig(env)
  if (!cfg.url || !cfg.serviceKey) {
    throw Object.assign(new Error('Supabase service role is not configured for review storage.'), { code: 'REVIEWS_STORE_NOT_CONFIGURED' })
  }
  const db = supabase || createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  async function save(ownerId, record) {
    const { error } = await db.from('mio_paralegal_reviews').upsert({
      id: record.id,
      owner_id: ownerId,
      task_id: record.taskId,
      action: record.action,
      email: record.email,
      task: record.task,
      created_at: record.createdAt,
      expires_at: record.expiresAt
    })
    if (error) throw Object.assign(new Error('Could not save the review.'), { code: 'REVIEWS_SAVE_FAILED', cause: error })
    return true
  }

  async function load(ownerId, id) {
    const { data, error } = await db.from('mio_paralegal_reviews').select('*').eq('id', id).maybeSingle()
    if (error) throw Object.assign(new Error('Could not load the review.'), { code: 'REVIEWS_LOAD_FAILED', cause: error })
    if (!data || data.owner_id !== ownerId) return null
    return {
      id: data.id,
      ownerId: data.owner_id,
      taskId: data.task_id,
      action: data.action,
      email: data.email,
      task: data.task,
      createdAt: data.created_at,
      expiresAt: data.expires_at
    }
  }

  return Object.freeze({ save, load })
}
