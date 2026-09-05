import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vnnkxqpyndidnjbrbywz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZubmt4cXB5bmRpZG5qYnJieXd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODA5MjksImV4cCI6MjA5MzE1NjkyOX0.MHxhT_mLzMZv6r4mvOcNvtR_kGcsY1yuXhYWL2luntI'

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
