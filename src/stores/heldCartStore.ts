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
  resumeHeldCart: (id: string) => HeldCart | null
  deleteHeldCart: (id: string) => void
  clearAllHeldCarts: () => void
  clearForLogout: () => void
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

      resumeHeldCart: (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return null

        // Baca langsung dari storage lokal terkini untuk menghindari race condition antar tab
        try {
          const raw = localStorage.getItem('zeepos_held_carts')
          if (raw) {
            const parsed = JSON.parse(raw)
            const storageCarts = parsed?.state?.cartsByTenant?.[tenantId] ?? []
            const storageTarget = storageCarts.find((c: HeldCart) => c.id === id)
            if (!storageTarget) {
              // Sudah di-resume oleh tab lain!
              const current = (get().cartsByTenant[tenantId] ?? []).filter((c) => c.id !== id)
              set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: current }, heldCarts: current }))
              return null
            }
          }
        } catch {
          // fallback ke state memory
        }

        const current = get().cartsByTenant[tenantId] ?? []
        const target = current.find((cart) => cart.id === id && cart.tenant_id === tenantId) ?? null
        if (target) {
          const next = current.filter((cart) => cart.id !== id)
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
        }
        return target
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
