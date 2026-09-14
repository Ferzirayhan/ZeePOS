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
  /**
   * Tanda klaim lintas tab (ISO timestamp). Cart yang sedang diklaim tetap tersimpan
   * di storage (crash-safe), hanya disembunyikan dari daftar sampai di-acknowledge,
   * di-rollback, atau klaimnya kedaluwarsa (CLAIM_TTL_MS).
   */
  claimed_at?: string | null
}

export type HoldCartPayload = Omit<HeldCart, 'id' | 'tenant_id' | 'created_at' | 'label' | 'customer_id' | 'customer_nama' | 'claimed_at'> & {
  label?: string
  customer_id?: number | null
  customer_nama?: string | null
}

type HoldPayload = HoldCartPayload

interface HeldCartStore {
  activeTenantId: string | null
  cartsByTenant: Record<string, HeldCart[]>
  heldCarts: HeldCart[]
  setActiveTenant: (tenantId: string | null) => void
  holdCurrentCart: (payload: HoldPayload) => Promise<string>
  resumeHeldCart: (id: string) => Promise<HeldCart | null>
  acknowledgeResume: (id: string) => Promise<void>
  rollbackResume: (id: string) => Promise<void>
  deleteHeldCart: (id: string) => Promise<void>
  clearAllHeldCarts: () => Promise<void>
  clearForLogout: () => void
}

const STORAGE_KEY = 'zeepos_held_carts'
const CLAIM_TTL_MS = 5 * 60 * 1000

type CartsByTenant = Record<string, HeldCart[]>

function safeStorage(): Storage {
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage
  const memory = new Map<string, string>()
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value) },
    removeItem: (key: string) => { memory.delete(key) },
  } as Storage
}

function supportsWebLocks(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
}function withTenantLock<T>(tenantId: string, fn: () => T): Promise<T> {
  if (supportsWebLocks()) {
    return navigator.locks.request(`zeepos_held_carts:${tenantId}`, fn)
  }
  return Promise.resolve(fn())
}

/**
 * Baca snapshot storage persist secara mentah. Array kosong adalah KEBENARAN
 * (semua cart sudah diklaim/dihapus tab lain) — bukan kegagalan storage.
 */
function readPersistedCarts(): CartsByTenant {
  try {
    const raw = safeStorage().getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { state?: { cartsByTenant?: CartsByTenant }; version?: number }
    return parsed?.state?.cartsByTenant ?? {}
  } catch {
    return {}
  }
}

function writePersistedCarts(cartsByTenant: CartsByTenant): void {
  safeStorage().setItem(STORAGE_KEY, JSON.stringify({ state: { cartsByTenant }, version: 2 }))
}

function isClaimActive(cart: HeldCart): boolean {
  if (!cart.claimed_at) return false
  const claimedMs = Date.parse(cart.claimed_at)
  return !Number.isNaN(claimedMs) && Date.now() - claimedMs < CLAIM_TTL_MS
}

export const useHeldCartStore = create<HeldCartStore>()(
  persist(
    (set, get) => ({
      activeTenantId: null,
      cartsByTenant: {},
      heldCarts: [],

      setActiveTenant: (tenantId) => set((state) => ({
        activeTenantId: tenantId,
        heldCarts: tenantId ? (state.cartsByTenant[tenantId] ?? []).filter((cart) => !isClaimActive(cart)) : [],
      })),

      holdCurrentCart: (payload) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return Promise.reject(new Error('Tenant aktif diperlukan untuk menahan pesanan'))

        return withTenantLock(tenantId, () => {
          // Gabungkan dengan storage terbaru agar perubahan tab lain tidak tertimpa
          const merged = readPersistedCarts()
          const current = merged[tenantId] ?? get().cartsByTenant[tenantId] ?? []
          const id = `HOLD-${Date.now()}-${Math.random().toString(36).slice(2)}`
          const newHeld: HeldCart = {
            ...payload,
            id,
            tenant_id: tenantId,
            label: payload.label?.trim() || `Pesanan #${current.length + 1}`,
            created_at: new Date().toISOString(),
            customer_id: payload.customer_id ?? null,
            customer_nama: payload.customer_nama ?? null,
            claimed_at: null,
          }
          const next = [newHeld, ...current]
          merged[tenantId] = next
          writePersistedCarts(merged)
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
          return id
        })
      },

      resumeHeldCart: (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return Promise.resolve(null)

        return withTenantLock(tenantId, () => {
          // Storage persist adalah sumber kebenaran lintas tab — termasuk saat isinya kosong.
          // Memory hanya fallback jika storage benar-benar tidak terbaca.
          const merged = readPersistedCarts()
          const storageCarts = merged[tenantId]
          const memoryCarts = get().cartsByTenant[tenantId] ?? []
          const source = storageCarts ?? memoryCarts
          const target = source.find((cart) => cart.id === id && cart.tenant_id === tenantId) ?? null

          if (!target) {
            // Sudah diklaim/dihapus tab lain — sinkronkan memory agar UI ikut berubah
            const nextMemory = memoryCarts.filter((cart) => cart.id !== id)
            if (nextMemory.length !== memoryCarts.length) {
              set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: nextMemory }, heldCarts: nextMemory }))
            }
            return null
          }

          // Cart yang sedang diklaim tab lain (belum kedaluwarsa) tidak bisa diklaim ulang
          if (isClaimActive(target)) return null

          // Klaim tanpa merusak data: tandai claimed_at, tetap tersimpan di storage.
          // Crash setelah klaim → klaim kedaluwarsa → cart muncul kembali di daftar.
          const next = source.map((cart) =>
            cart.id === id ? { ...cart, claimed_at: new Date().toISOString() } : cart,
          )
          merged[tenantId] = next
          try {
            writePersistedCarts(merged)
          } catch {
            return null // gagal persist = jangan klaim
          }

          const visible = next.filter((cart) => !isClaimActive(cart))
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: visible }))
          return target
        })
      },

      acknowledgeResume: (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return Promise.resolve()

        return withTenantLock(tenantId, () => {
          // Konfirmasi restore sukses: cart benar-benar dikeluarkan dari daftar
          const merged = readPersistedCarts()
          const source = merged[tenantId] ?? get().cartsByTenant[tenantId] ?? []
          const next = source.filter((cart) => cart.id !== id)
          merged[tenantId] = next
          try {
            writePersistedCarts(merged)
          } catch {
            // storage gagal — tetap bersihkan memory tab ini
          }
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
        })
      },

      rollbackResume: (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return Promise.resolve()

        return withTenantLock(tenantId, () => {
          // Restore gagal: lepaskan tanda klaim agar cart muncul kembali di daftar
          const merged = readPersistedCarts()
          const source = merged[tenantId] ?? get().cartsByTenant[tenantId] ?? []
          const next = source.map((cart) =>
            cart.id === id && cart.claimed_at ? { ...cart, claimed_at: null } : cart,
          )
          merged[tenantId] = next
          try {
            writePersistedCarts(merged)
          } catch {
            // storage gagal — tetap bersihkan memory tab ini
          }
          const visible = next.filter((cart) => !isClaimActive(cart))
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: visible }))
        })
      },

      deleteHeldCart: (id) => {
        const tenantId = get().activeTenantId
        if (!tenantId) return Promise.resolve()

        return withTenantLock(tenantId, () => {
          // Gabungkan dengan storage terbaru sebelum menulis (anti lost update)
          const merged = readPersistedCarts()
          const source = merged[tenantId] ?? get().cartsByTenant[tenantId] ?? []
          const next = source.filter((cart) => cart.id !== id)
          merged[tenantId] = next
          writePersistedCarts(merged)
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
        })
      },

      clearAllHeldCarts: () => {
        const tenantId = get().activeTenantId
        if (!tenantId) {
          set({ heldCarts: [] })
          return Promise.resolve()
        }

        return withTenantLock(tenantId, () => {
          const merged = readPersistedCarts()
          merged[tenantId] = []
          writePersistedCarts(merged)
          set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: [] }, heldCarts: [] }))
        })
      },

      clearForLogout: () => set({ activeTenantId: null, cartsByTenant: {}, heldCarts: [] }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => safeStorage()),
      partialize: (state) => ({ cartsByTenant: state.cartsByTenant }),
      migrate: (persisted, version) => version < 2 ? { cartsByTenant: {}, heldCarts: [], activeTenantId: null } : persisted as HeldCartStore,
    },
  ),
)
