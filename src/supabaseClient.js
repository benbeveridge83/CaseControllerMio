import { createClient } from '@supabase/supabase-js'

import {PUBLIC_SUPABASE_URL as supabaseUrl,PUBLIC_SUPABASE_KEY as supabaseAnonKey} from './mioSupabasePublic.js'

// Only sign-in credentials may persist in browser storage. Quota fallback never clears app records.
const authStorage = {
  getItem(key) { let session = null; try { session = window.sessionStorage.getItem(key) } catch {}; return session ?? window.localStorage.getItem(key) },
  setItem(key, value) {
    try { window.localStorage.setItem(key, value); window.sessionStorage.removeItem(key) }
    catch (error) {
      if (!['QuotaExceededError','NS_ERROR_DOM_QUOTA_REACHED','SecurityError'].includes(error?.name)) throw error
      window.sessionStorage.setItem(key, value)
      try { window.localStorage.removeItem(key) } catch {}
    }
  },
  removeItem(key) { try { window.localStorage.removeItem(key) } catch {}; try { window.sessionStorage.removeItem(key) } catch {} },
}
export const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { storage: authStorage } })
