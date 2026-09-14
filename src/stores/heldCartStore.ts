import { create } from 'zustand'
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
  /**
   * Token acak pemilik klaim. Hanya pemegang token (pemanggil resumeHeldCart yang
   * sukses) yang boleh acknowledge/rollback. Setelah TTL habis dan tab lain
   * mengambil alih klaim, token tab lama tidak lagi cocok → operasinya ditolak.
   */
  claim_token?: string | null
}

export type HoldCartPayload = Omit<
  HeldCart,
  'id' | 'tenant_id' | 'created_at' | 'label' | 'customer_id' | 'customer_nama' | 'claimed_at' | 'claim_token'
> & {
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
  acknowledgeResume: (id: string, claimToken?: string | null) => Promise<void>
  rollbackResume: (id: string, claimToken?: string | null) => Promise<void>
  deleteHeldCart: (id: string) => Promise<void>
  clearAllHeldCarts: () => Promise<void>
  clearForLogout: () => void
}

const STORAGE_KEY_PREFIX = 'zeepos_held_carts'
const CLAIM_TTL_MS = 5 * 60 * 1000

/**
 * Satu key localStorage PER TENANT. Tenant A dan B tidak lagi berbagi satu objek:
 * operasi tulis tenant A mustahil menimpa snapshot tenant B, dan middleware persist
 * tidak ada sama sekali (hydrasi manual saat ganti tenant) sehingga tidak ada jalur
 * tulis tersembunyi yang bisa menghapus data tenant lain.
 */
function storageKeyForTenant(tenantId: string | null | undefined): string | null {
  if (!tenantId || !/^[A-Za-z0-9_-]+$/.test(tenantId)) return null
  return `${STORAGE_KEY_PREFIX}:${tenantId}`
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

function supportsWebLocks(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function'
}

/**
 * Nomor antrean global untuk browser tanpa Web Locks: tab pertama yang memanggil
 * operasi apa pun memegang lock abadi, memaksa tab lain masuk antrean di belakangnya.
 * Ini pendekatan konservatif — tanpa Web Locks atomicity lintas tab memang tidak bisa
 * dijamin, jadi kami memilih mencegah paralelisme daripada membiarkan lost update.
 */
const fallbackQueue: Array<() => void> = []
let fallbackHeld = false

function runWithFallbackLock<T>(fn: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      try {
        resolve(fn())
      } catch (err) {
        reject(err)
      } finally {
        const next = fallbackQueue.shift()
        if (next) next()
        else fallbackHeld = false
      }
    }
    if (!fallbackHeld) {
      fallbackHeld = true
      run()
    } else {
      fallbackQueue.push(run)
    }
  })
}

async function withTenantLock<T>(tenantId: string, fn: () => T): Promise<T> {
  if (supportsWebLocks()) {
    return navigator.locks.request(`zeepos_held_carts:${tenantId}`, fn)
  }
  return runWithFallbackLock(fn)
}

/**
 * Baca snapshot storage persist tenant ini. Sifat hasil:
 * - key belum pernah ditulis → { carts: null } → memory tab adalah fallback yang sah
 * - isinya array kosong → { carts: [] } → KEBENARAN (semua cart sudah diambil tab lain)
 * - JSON korup / bentuk salah → { carts: [] } → self-heal: snapshot lama TIDAK dipercaya,
 *   tulisan berikutnya menimpa blob korup dengan data yang valid.
 */
function readPersistedCarts(tenantId: string): { carts: HeldCart[] | null } {
  const key = storageKeyForTenant(tenantId)
  if (!key) return { carts: null }
  try {
    const raw = safeStorage().getItem(key)
    if (raw === null) return { carts: null }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { carts: [] }
    return { carts: parsed.filter((c): c is HeldCart => Boolean(c && typeof c === 'object' && typeof (c as HeldCart).id === 'string')) }
  } catch {
    return { carts: [] }
  }
}

function writePersistedCarts(tenantId: string, carts: HeldCart[]): void {
  const key = storageKeyForTenant(tenantId)
  if (!key) throw new Error('Tenant aktif tidak valid')
  safeStorage().setItem(key, JSON.stringify(carts))
}

/**
 * Klaim dengan timestamp masa depan (jam perangkat salah) tidak boleh mengunci cart
 * sangat lama: majukan ke sekarang agar segera kedaluwarsa dan muncul kembali.
 */
function sanitizeClaim(cart: HeldCart): HeldCart {
  if (!cart.claimed_at) return cart
  const ms = Date.parse(cart.claimed_at)
  if (Number.isNaN(ms) || ms > Date.now() + 60_000) {
    return { ...cart, claimed_at: null, claim_token: null }
  }
  return cart
}

function isClaimActive(cart: HeldCart): boolean {
  if (!cart.claimed_at) return false
  const claimedMs = Date.parse(cart.claimed_at)
  if (Number.isNaN(claimedMs)) return false
  if (claimedMs > Date.now()) return false // timestamp masa depan = klaim tidak sah
  return Date.now() - claimedMs < CLAIM_TTL_MS
}

function newClaimToken(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Owner check untuk acknowledge/rollback: jika cart di storage memegang klaim aktif
 * dengan token, pemanggil WAJIB membawa token yang sama. Tab lama yang kehilangan
 * klaim (TTL habis lalu diambil alih tab lain) otomatis ditolak.
 */
function isOwnerOfClaim(stored: HeldCart | undefined, claimToken: string | null | undefined): boolean {
  if (!stored) return false
  if (!stored.claim_token) return true // tidak sedang diklaim (atau legacy tanpa token)
  return Boolean(claimToken) && claimToken === stored.claim_token
}

export const useHeldCartStore = create<HeldCartStore>()((set, get) => ({
  activeTenantId: null,
  cartsByTenant: {},
  heldCarts: [],

  // Hydrasi manual dari key tenant (menggantikan persist middleware): selalu membaca
  // storage terbaru saat ganti tenant, sehingga snapshot memory lintas tenant tidak
  // pernah ikut terbawa.
  setActiveTenant: (tenantId) => {
    const persisted = tenantId ? readPersistedCarts(tenantId) : { carts: null }
    const carts = persisted.carts ?? []
    const visible = carts.filter((cart) => !isClaimActive(cart))
    set((state) => ({
      activeTenantId: tenantId,
      cartsByTenant: tenantId ? { ...state.cartsByTenant, [tenantId]: carts } : state.cartsByTenant,
      heldCarts: visible,
    }))
  },

  holdCurrentCart: (payload) => {
    const tenantId = get().activeTenantId
    if (!tenantId) return Promise.reject(new Error('Tenant aktif diperlukan untuk menahan pesanan'))

    return withTenantLock(tenantId, () => {
      // Gabungkan dengan storage terbaru tenant ini agar perubahan tab lain tidak tertimpa
      const persisted = readPersistedCarts(tenantId)
      const current = persisted.carts ?? get().cartsByTenant[tenantId] ?? []
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
        claim_token: null,
      }
      const next = [newHeld, ...current]
      writePersistedCarts(tenantId, next)
      set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
      return id
    })
  },

  resumeHeldCart: (id) => {
    const tenantId = get().activeTenantId
    if (!tenantId) return Promise.resolve(null)

    return withTenantLock(tenantId, () => {
      // Storage persist adalah sumber kebenaran lintas tab — termasuk saat isinya kosong.
      // Memory hanya fallback jika key memang belum pernah ditulis.
      const persisted = readPersistedCarts(tenantId)
      const storageCarts = persisted.carts
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
      if (isClaimActive(sanitizeClaim(target))) return null

      // Klaim tanpa merusak data: tandai claimed_at + token pemilik, tetap tersimpan.
      // Crash setelah klaim → TTL habis → cart muncul kembali di daftar.
      const claimToken = newClaimToken()
      const next = source.map((cart) =>
        cart.id === id
          ? { ...sanitizeClaim(cart), claimed_at: new Date().toISOString(), claim_token: claimToken }
          : sanitizeClaim(cart),
      )
      try {
        writePersistedCarts(tenantId, next)
      } catch {
        return null // gagal persist = jangan klaim
      }

      const visible = next.filter((cart) => !isClaimActive(cart))
      set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: visible }))
      // Kembalikan cart BESERTA token: hanya pemegang token yang boleh
      // acknowledge/rollback klaim ini setelahnya.
      return { ...target, claimed_at: new Date().toISOString(), claim_token: claimToken }
    })
  },

  acknowledgeResume: (id, claimToken) => {
    const tenantId = get().activeTenantId
    if (!tenantId) return Promise.resolve()

    return withTenantLock(tenantId, () => {
      // Konfirmasi restore sukses: cart dikeluarkan permanen dari daftar parkir.
      const persisted = readPersistedCarts(tenantId)
      const source = persisted.carts ?? get().cartsByTenant[tenantId] ?? []
      const stored = source.find((cart) => cart.id === id)
      if (!isOwnerOfClaim(stored, claimToken)) {
        // Klaim sudah kedaluwarsa & diambil alih tab lain, atau cart sudah dihapus —
        // jangan sentuh cart milik pemilik token baru.
        return
      }
      const next = source.filter((cart) => cart.id !== id)
      try {
        writePersistedCarts(tenantId, next)
      } catch {
        // storage gagal — tetap bersihkan memory tab ini
      }
      set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: next }, heldCarts: next }))
    })
  },

  rollbackResume: (id, claimToken) => {
    const tenantId = get().activeTenantId
    if (!tenantId) return Promise.resolve()

    return withTenantLock(tenantId, () => {
      // Restore gagal: lepaskan tanda klaim agar cart muncul kembali di daftar.
      const persisted = readPersistedCarts(tenantId)
      const source = persisted.carts ?? get().cartsByTenant[tenantId] ?? []
      const stored = source.find((cart) => cart.id === id)
      if (!isOwnerOfClaim(stored, claimToken)) {
        return // klaim sudah diambil alih tab lain — jangan sentuh cart miliknya
      }
      const next = source.map((cart) =>
        cart.id === id ? { ...cart, claimed_at: null, claim_token: null } : cart,
      )
      try {
        writePersistedCarts(tenantId, next)
      } catch {
        // storage gagal — tetap perbarui memory tab ini
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
      const persisted = readPersistedCarts(tenantId)
      const source = persisted.carts ?? get().cartsByTenant[tenantId] ?? []
      const next = source.filter((cart) => cart.id !== id)
      writePersistedCarts(tenantId, next)
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
      writePersistedCarts(tenantId, [])
      set((state) => ({ cartsByTenant: { ...state.cartsByTenant, [tenantId]: [] }, heldCarts: [] }))
    })
  },

  clearForLogout: () => set({ activeTenantId: null, cartsByTenant: {}, heldCarts: [] }),
}))
