import { create } from 'zustand'
import type { Session, Subscription } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Tenant } from '../types/database'
import { clearCatalogCache } from '../utils/offlineDb'
import { useHeldCartStore } from './heldCartStore'
import { useCartStore } from './cartStore'
import { hasAuthIdentityChanged } from './authIdentity'

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
  reinitialize: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  registerTenant: (tenantName: string, tenantSlug: string, userName: string, username: string) => Promise<void>
  logout: () => Promise<void>
  getProfile: (userId?: string) => Promise<Profile | null>
  getTenant: (tenantId?: string) => Promise<Tenant | null>
  clearError: () => void
}

let authSubscription: Subscription | null = null
/**
 * Dipegang sejak panggilan pertama (bukan setelah await) supaya React StrictMode
 * yang memanggil effect dua kali tidak mendaftarkan dua listener auth. Listener
 * ganda membuat setiap event auth dieksekusi dua kali — termasuk pembersihan
 * data lokal.
 */
let initializePromise: Promise<void> | null = null

/**
 * Hasil pengambilan data yang MEMBEDAKAN "tidak ada barisnya" dari "gagal
 * mengambil". Perbedaan ini menentukan apakah data lokal perangkat boleh
 * dihapus, jadi tidak boleh dikaburkan menjadi sekadar `null`.
 */
type FetchResult<T> = { ok: true; data: T | null } | { ok: false; error: string }

async function fetchProfileResult(userId: string): Promise<FetchResult<Profile>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, data }
}

async function fetchTenantResult(tenantId: string): Promise<FetchResult<Tenant>> {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', tenantId)
    .maybeSingle()

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, data }
}



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

    // Guard re-entrancy SEBELUM await pertama: `initialized` baru bernilai true
    // setelah beberapa await, sehingga dua pemanggilan beruntun (React
    // StrictMode memanggil effect dua kali) bisa lolos dan mendaftarkan dua
    // listener auth yang menjalankan setiap event dua kali.
    if (initializePromise) {
      return initializePromise
    }

    initializePromise = (async () => {
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
      const profileResult = session?.user?.id
        ? await fetchProfileResult(session.user.id)
        : ({ ok: true, data: null } as FetchResult<Profile>)
      const profile = profileResult.ok ? profileResult.data : null
      const tenantResult = profile?.tenant_id
        ? await fetchTenantResult(profile.tenant_id)
        : ({ ok: true, data: null } as FetchResult<Tenant>)
      const tenant = tenantResult.ok ? tenantResult.data : null

      set({
        session,
        user: profile,
        tenant,
        isAdmin: profile?.role === 'admin',
        // Onboarding hanya bila profil memang TIDAK ADA. Kegagalan pengambilan
        // profil tidak boleh mendorong pengguna ke form pembuatan toko baru.
        needsOnboarding: session != null && profileResult.ok && !profile,
        loading: false,
        initialized: true,
        error: profileResult.ok ? null : profileResult.error,
      })

      if (!authSubscription) {
        const { data: authListener } = supabase.auth.onAuthStateChange(
          (_event, nextSession) => {
            void (async () => {
              const previousUserId = get().session?.user.id ?? null
              const previousTenantId = get().tenant?.id ?? null

              // Sesi berakhir: bersihkan seluruh data lokal tenant.
              if (!nextSession) {
                void clearCatalogCache(previousTenantId ?? undefined)
                useHeldCartStore.getState().clearForLogout()
                useCartStore.getState().clearCart()
                useCartStore.getState().setPpnPersen(0)

                set({
                  session: null,
                  user: null,
                  tenant: null,
                  isAdmin: false,
                  needsOnboarding: false,
                  loading: false,
                  initialized: true,
                })
                return
              }

              const nextProfileResult = await fetchProfileResult(nextSession.user.id)

              // Gagal mengambil profil (jaringan putus, PostgREST 5xx) BUKAN
              // pergantian akun. Dulu kasus ini menghapus cache katalog offline,
              // pesanan parkir, dan keranjang aktif lalu melempar kasir ke
              // onboarding padahal sesinya masih sah — tepat saat jaringan
              // bermasalah, yaitu saat cache offline paling dibutuhkan.
              if (!nextProfileResult.ok) {
                set({
                  session: nextSession,
                  loading: false,
                  initialized: true,
                  error: nextProfileResult.error,
                })
                return
              }

              const nextProfile = nextProfileResult.data
              const nextTenantResult = nextProfile?.tenant_id
                ? await fetchTenantResult(nextProfile.tenant_id)
                : ({ ok: true, data: null } as FetchResult<Tenant>)

              if (!nextTenantResult.ok) {
                set({
                  session: nextSession,
                  user: nextProfile,
                  isAdmin: nextProfile?.role === 'admin',
                  loading: false,
                  initialized: true,
                  error: nextTenantResult.error,
                })
                return
              }

              const nextTenant = nextTenantResult.data
              const identityChanged = hasAuthIdentityChanged(
                previousUserId,
                previousTenantId,
                nextSession.user.id,
                nextTenant?.id ?? null,
              )
              // Profil benar-benar tidak terlihat lagi (akun dinonaktifkan atau
              // dipindah tenant): data lokal tenant lama harus tetap dihapus.
              const identityLost = previousUserId !== null && nextProfile === null

              if (identityChanged || identityLost) {
                void clearCatalogCache(previousTenantId ?? undefined)
                useHeldCartStore.getState().clearForLogout()
                useCartStore.getState().clearCart()
                useCartStore.getState().setPpnPersen(0)
              }

              set({
                session: nextSession,
                user: nextProfile,
                tenant: nextTenant,
                isAdmin: nextProfile?.role === 'admin',
                needsOnboarding: !nextProfile,
                loading: false,
                initialized: true,
                error: null,
              })
            })()
          },
        )

        authSubscription = authListener.subscription
      }
    })()

    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  },

  /**
   * Jalur percobaan ulang untuk `AuthProvider` ketika pemulihan sesi melewati
   * batas waktu. `initialize()` sengaja menolak berjalan dua kali (penjaga
   * `initialized` + `initializePromise` yang mencegah langganan auth ganda),
   * jadi percobaan ulang butuh pintu eksplisit yang membuka penjaga itu.
   *
   * Yang TIDAK disentuh: `authSubscription`. Pendaftaran listener tetap sekali
   * seumur hidup halaman (klausa 3.12) — listener ganda membuat setiap event
   * auth, termasuk pembersihan data lokal, dieksekusi dua kali.
   */
  reinitialize: async () => {
    initializePromise = null
    set({ initialized: false, loading: true, error: null })

    await get().initialize()
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
        tenant: null,
        isAdmin: false,
      })
      throw error
    }

    const profile = data.user?.id ? await get().getProfile(data.user.id) : null
    // Tenant WAJIB di-set di sini. Sebelumnya login tidak menyentuh `tenant`
    // sama sekali, sehingga (a) konsumen yang membaca `tenant` melihat null pada
    // render pertama sampai event auth async selesai, dan (b) tenant milik akun
    // SEBELUMNYA masih tersimpan — sempat dipakai sebagai kunci cache katalog
    // dan pesanan parkir oleh pengguna yang baru login.
    const tenant = profile?.tenant_id ? await get().getTenant(profile.tenant_id) : null

    set({
      session: data.session,
      user: profile,
      tenant,
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

    // Clear all device-local tenant data on logout. Pembersihan dilakukan
    // TANPA SYARAT: signOut yang gagal (jaringan mati — kondisi normal untuk
    // kasir di perangkat bersama) dulu membuat fungsi ini return lebih awal,
    // meninggalkan cache katalog IndexedDB dan pesanan parkir milik kasir
    // sebelumnya di perangkat. Di-await supaya reload cepat setelah logout
    // tidak berlomba dengan penghapusan cache.
    await clearCatalogCache()
    useHeldCartStore.getState().clearForLogout()
    useCartStore.getState().clearCart()
    useCartStore.getState().setPpnPersen(0)

    set({
      session: null,
      user: null,
      tenant: null,
      isAdmin: false,
      needsOnboarding: false,
      loading: false,
      error: error ? error.message : null,
    })

    if (error) {
      throw error
    }
  },

  getProfile: async (userId) => {
    const targetUserId = userId ?? get().session?.user.id

    if (!targetUserId) {
      return null
    }

    const result = await fetchProfileResult(targetUserId)

    if (!result.ok) {
      set({ error: result.error })
      return null
    }

    return result.data
  },

  getTenant: async (tenantId) => {
    const targetTenantId = tenantId ?? get().user?.tenant_id

    if (!targetTenantId) {
      return null
    }

    const result = await fetchTenantResult(targetTenantId)

    return result.ok ? result.data : null
  },

  clearError: () => set({ error: null }),
}))
