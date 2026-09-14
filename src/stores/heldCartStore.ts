import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { CartItem } from '../types'
import type { MetodeBayar } from '../types/database'

export interface HeldCart {
  id: string
  tenant_id: string
  label: string
  created_at: string
  items: CartItem[]
  diskon_persen: number
  use_ppn: boolean
  ppn_persen: number
  metode_bayar: MetodeBayar
  total: number
  customer_id: number | null
  customer_nama: string | null
}

type HoldPayload = Omit<HeldCart, 'id' | 'tenant_id' | 'created_at' | 'label' | 'customer_id' | 'customer_nama'> & {
  label?: string
  customer_id?: number | null
  customer_nama?: string | null
}

interface HeldCartStore {
  activeTenantId: string | null
  cartsByTenant: Record<string, HeldCart[]>
  heldCarts: HeldCart[]
  setActiveTenant: (tenantId: string | null) => void
  holdCurrentCart: (payload: HoldPayload) => string
  resumeHeldCart: (id: string) => Promise<HeldCart | null>
  deleteHeldCart: (id: string) => void
  clearAllHeldCarts: () => void
  clearForLogout: () => void
}

function supportsWebLocks(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
}

function safeStorage(): Storage {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage
  const memory = new Map<string, string>()
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  } as Storage
}

export const useHeldCartStore = create<HeldCartStore>()(
  persist(
    (set, get) => ({
      activeTenantId: null,
      cartsByTenant: {},
      heldCarts: [],

      setActiveTenant: (tenantId) => set((state) => ({
        activeTenantId: tenantId,
        heldCarts: tenantId ? (state.cartsByTenant[tenantId] ?? []) : [],
      })),

      holdCurrentCart: (payload) => {
        const tenantId = get().activeTenantId
        if (!tenantId) throw new Error('Tenant aktif diperlukan untuk menahan pesanan')
        const current = get().cartsByTenant[tenantId] ?? []
        const id = `HOLD-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const newHeld: HeldCart = {
          ...payload,
          id,
          tenant_id: tenantId,
          label: payload.label?.trim() || `Pesanan #${current.length + 1}`,
          created_at: new Date().toISOString(),
          customer_id: payload.customer_id ?? null,
          customer_nama: payload.customer_nama ?? null,
        }
        const next = [newHeld, ...current]
        set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
        return id
      },

      resumeHeldCart: async (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return null

        // Klaim atomik lintas tab: storage persist adalah sumber kebenaran bersama,
        // memory state hanya cache. Web Locks memberi mutual exclusion antar tab;
        // tanpa Web Locks, read-storage-first tetap mempersempit jendela race.
        const claimHeldCart = async (): Promise<HeldCart | null> => {
          let storageCarts: HeldCart[] = []
          try {
            const raw = safeStorage().getItem('zeepos_held_carts')
            const parsed = raw ? JSON.parse(raw) : null
            storageCarts = parsed?.state?.cartsByTenant?.[tenantId] ?? []
          } catch {
            storageCarts = []
          }

          const memoryCarts = get().cartsByTenant[tenantId] ?? []
          // Storage lebih dipercaya; memory hanya fallback jika storage kosong/rusak
          const source = storageCarts.length > 0 ? storageCarts : memoryCarts
          const target = source.find((cart) => cart.id === id && cart.tenant_id === tenantId) ?? null

          if (!target) {
            // Sudah diklaim tab lain atau sudah dihapus — singkirkan dari memory agar UI sinkron
            const current = memoryCarts.filter((cart) => cart.id !== id)
            if (current.length !== memoryCarts.length) {
              set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: current }, heldCarts: current }))
            }
            return null
          }

          const next = source.filter((cart) => cart.id !== id)

          // Tulis storage dulu (truth lintas tab), lalu sinkronkan memory
          try {
            const raw = safeStorage().getItem('zeepos_held_carts')
            const parsed = raw ? JSON.parse(raw) : null
            const byTenant = { ...(parsed?.state?.cartsByTenant ?? {}), [tenantId]: next }
            safeStorage().setItem('zeepos_held_carts', JSON.stringify({ state: { cartsByTenant: byTenant }, version: 2 }))
          } catch {
            // Gagal menulis storage: jangan klaim — return null agar tidak diproses dua kali
            return null
          }

          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
          return target
        }

        if (supportsWebLocks()) {
          return navigator.locks.request(`zeepos_held_carts:${tenantId}`, claimHeldCart)
        }
        return claimHeldCart()
      },

      deleteHeldCart: (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return
        const next = (get().cartsByTenant[tenantId] ?? []).filter((cart) => cart.id !== id)
        set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
      },

      clearAllHeldCarts: () => {
        const tenantId = get().activeTenantId
        if (!tenantId) return set({ heldCarts: [] })
        set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: [] }, heldCarts: [] }))
      },

      clearForLogout: () => set({ activeTenantId: null, cartsByTenant: {}, heldCarts: [] }),
    }),
    {
      name: 'zeepos_held_carts',
      version: 2,
      storage: createJSONStorage(() => safeStorage()),
      partialize: (state) => ({ cartsByTenant: state.cartsByTenant }),
      migrate: (persisted, version) => version < 2 ? { cartsByTenant: {}, heldCarts: [], activeTenantId: null } : persisted as HeldCartStore,
    },
  ),
)
