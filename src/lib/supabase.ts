import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import {
  SUPABASE_REQUEST_TIMEOUT_MS,
  createTimeoutFetch,
} from './fetchWithTimeout'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * `global.fetch` kustom memberi deadline pada SELURUH lalu lintas HTTP klien
 * ini sekaligus: PostgREST, RPC, storage, dan `auth.*` — termasuk
 * `auth.getSession()` yang menjadi akar cacat 1.8. Realtime memakai WebSocket
 * dan tidak melewati `fetch`, jadi tidak terpengaruh.
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS),
  },
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
