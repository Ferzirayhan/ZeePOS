import { create } from 'zustand'
import type { Session, Subscription } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Tenant } from '../types/database'

interface AuthState {
  user: Profile | null
  tenant: Tenant | null
  session: Session | null
  loading: boolean
  initialized: boolean
  error: string | null
  isAdmin: boolean
  needsOnboarding: boolean
  initialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  registerTenant: (tenantName: string, tenantSlug: string, userName: string, username: string) => Promise<void>
  logout: () => Promise<void>
  getProfile: (userId?: string) => Promise<Profile | null>
  getTenant: (tenantId?: string) => Promise<Tenant | null>
  clearError: () => void
}

let authSubscription: Subscription | null = null

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  tenant: null,
  session: null,
  loading: true,
  initialized: false,
  error: null,
  isAdmin: false,
  needsOnboarding: false,

  initialize: async () => {
    if (get().initialized) {
      return
    }

    set({ loading: true, error: null })

    const { data, error } = await supabase.auth.getSession()

    if (error) {
      set({
        loading: false,
        initialized: true,
        error: error.message,
        session: null,
        user: null,
        tenant: null,
        isAdmin: false,
      })
      return
    }

    const session = data.session
    const profile = session?.user?.id
      ? await get().getProfile(session.user.id)
      : null
    const tenant = profile?.tenant_id
      ? await get().getTenant(profile.tenant_id)
      : null

    set({
      session,
      user: profile,
      tenant,
      isAdmin: profile?.role === 'admin',
      needsOnboarding: session != null && !profile,
      loading: false,
      initialized: true,
    })

    if (!authSubscription) {
      const { data: authListener } = supabase.auth.onAuthStateChange(
        (_event, nextSession) => {
          void (async () => {
            const nextProfile = nextSession?.user?.id
              ? await get().getProfile(nextSession.user.id)
              : null
            const nextTenant = nextProfile?.tenant_id
              ? await get().getTenant(nextProfile.tenant_id)
              : null

            set({
              session: nextSession,
              user: nextProfile,
              tenant: nextTenant,
              isAdmin: nextProfile?.role === 'admin',
              needsOnboarding: nextSession != null && !nextProfile,
              loading: false,
              initialized: true,
            })
          })()
        },
      )

      authSubscription = authListener.subscription
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null })

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      set({
        loading: false,
        error: 'Email atau password salah',
        session: null,
        user: null,
        isAdmin: false,
      })
      throw error
    }

    const profile = data.user?.id ? await get().getProfile(data.user.id) : null

    set({
      session: data.session,
      user: profile,
      isAdmin: profile?.role === 'admin',
      needsOnboarding: data.session != null && !profile,
      loading: false,
      error: null,
    })
  },

  signup: async (email, password) => {
    set({ loading: true, error: null })

    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      set({ loading: false, error: error.message })
      throw error
    }

    set({
      session: data.session,
      user: null,
      isAdmin: false,
      needsOnboarding: true,
      loading: false,
      error: null,
    })
  },

  registerTenant: async (tenantName, tenantSlug, userName, username) => {
    set({ loading: true, error: null })

    const { error } = await supabase.rpc('register_tenant', {
      p_tenant_name: tenantName,
      p_tenant_slug: tenantSlug,
      p_user_name: userName,
      p_username: username,
    })

    if (error) {
      set({ loading: false, error: error.message })
      throw error
    }

    const profile = await get().getProfile()
    const tenant = profile?.tenant_id ? await get().getTenant(profile.tenant_id) : null

    set({
      user: profile,
      tenant,
      isAdmin: profile?.role === 'admin',
      needsOnboarding: false,
      loading: false,
      error: null,
    })
  },

  logout: async () => {
    set({ loading: true, error: null })

    const { error } = await supabase.auth.signOut()

    if (error) {
      set({ loading: false, error: error.message })
      throw error
    }

    set({
      session: null,
      user: null,
      tenant: null,
      isAdmin: false,
      needsOnboarding: false,
      loading: false,
      error: null,
    })
  },

  getProfile: async (userId) => {
    const targetUserId = userId ?? get().session?.user.id

    if (!targetUserId) {
      return null
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .maybeSingle()

    if (error) {
      set({ error: error.message })
      return null
    }

    return data
  },

  getTenant: async (tenantId) => {
    const targetTenantId = tenantId ?? get().user?.tenant_id

    if (!targetTenantId) {
      return null
    }

    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', targetTenantId)
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return data
  },

  clearError: () => set({ error: null }),
}))
