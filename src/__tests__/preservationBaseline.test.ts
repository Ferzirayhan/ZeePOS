/**
 * Preservation baseline — Property 2 (design.md), klausa 3.3, 3.4, 3.5, 3.8,
 * 3.11, 3.12, 3.13 (bugfix.md).
 *
 * METODOLOGI: observation-first. Setiap nilai yang diasersi di berkas ini
 * DIAMATI lebih dulu pada kode BELUM diperbaiki (harness sementara, keluarannya
 * ditempel ke `.kiro/specs/zeepos-remaining-bug-fixes/verification-notes.md`),
 * baru kemudian direkam sebagai ekspektasi. Tidak ada satu pun angka di sini
 * yang ditulis dari asumsi; termasuk nilai yang terlihat "aneh" (mis. subtotal
 * TURUN saat menyeberangi ambang tier) — direkam apa adanya karena inilah
 * perilaku yang wajib dipertahankan setelah fix.
 *
 * Semua uji di berkas ini HARUS LOLOS pada kode belum diperbaiki.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { Session } from '@supabase/supabase-js'

import posPageSource from '../pages/POSPage.tsx?raw'
import initialSchemaSql from '../../supabase/migrations/001_initial_schema.sql?raw'
import productDiscountSql from '../../supabase/migrations/035_product_discount.sql?raw'
import productVariantsSql from '../../supabase/migrations/036_product_variants.sql?raw'
import multiTenantSql from '../../supabase/migrations/037_multi_tenant.sql?raw'
import tenantHardeningSql from '../../supabase/migrations/039_security_and_tenant_hardening.sql?raw'

import { useCartStore } from '../stores/cartStore'
import { getISOEndOfDay, getISOExclusiveEndOfDay, getISOStartOfDay } from '../utils/date'
import { ReceiptPrint } from '../components/pos/ReceiptPrint'
import type { DiscountTier } from '../types'
import type { Profile, ProductUnit, ProductWithCategory, Transaction, TransactionItem } from '../types/database'

// ---------------------------------------------------------------------------
// Fixture bersama
// ---------------------------------------------------------------------------

function mockProduct(overrides: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    id: 1,
    nama: 'Gelas Plastik',
    harga_jual: 1250,
    harga_beli: 900,
    diskon_produk_persen: 2,
    product_group_id: null,
    stok: 100000,
    stok_minimum: 5,
    stok_status: 'aman',
    is_active: true,
    sku: 'GLS-001',
    barcode: null,
    category_id: 1,
    category_nama: 'Gelas',
    satuan: 'pcs',
    deskripsi: null,
    foto_url: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

/** Tier diskon berbasis BASE QTY, sama seperti yang dipakai RPC checkout. */
const TIERS: DiscountTier[] = [
  { min_qty: 12, diskon_persen: 5 },
  { min_qty: 60, diskon_persen: 10 },
]

function mockUnit(overrides: Partial<ProductUnit> = {}): ProductUnit {
  return {
    id: 91,
    tenant_id: 'tenant-aaa',
    product_id: 1,
    nama_satuan: 'dus',
    rasio: 12,
    harga_beli: 10000,
    harga_jual: 14000,
    is_default: false,
    ...overrides,
  }
}

function resetCart() {
  useCartStore.getState().clearCart()
  useCartStore.getState().setPpnPersen(0)
}

function baseDemand(): number {
  return useCartStore.getState().items.reduce((sum, item) => sum + item.qty * Number(item.rasio ?? 1), 0)
}

// ---------------------------------------------------------------------------
// 3.4 — qty bulat pada satuan diskret (properti paling berisiko regresi, klaster D)
// ---------------------------------------------------------------------------

describe('preservation 3.4 — qty bulat 1..999 pada satuan diskret', () => {
  beforeEach(resetCart)

  /**
   * Domain rapat: seluruh qty bulat 1..999 dijalankan, lalu hasilnya diringkas
   * ke checksum agregat + anchor. Checksum adalah nilai TERAMATI, jadi satu
   * pergeseran pembulatan di mana pun dalam 999 titik akan menggagalkan uji ini.
   */
  it('mempertahankan subtotal & diskon_item_persen untuk seluruh qty 1..999', () => {
    let sumSubtotal = 0
    let sumDiskon = 0
    const observed = new Map<number, { subtotal: number; diskon: number }>()

    for (let qty = 1; qty <= 999; qty += 1) {
      resetCart()
      useCartStore.getState().addItem(mockProduct(), TIERS)
      useCartStore.getState().updateQty(1, qty)
      const line = useCartStore.getState().items[0]

      expect(line.qty).toBe(qty)
      expect(Number.isInteger(line.subtotal)).toBe(true)

      sumSubtotal += line.subtotal
      sumDiskon += line.diskon_item_persen
      observed.set(qty, { subtotal: line.subtotal, diskon: line.diskon_item_persen })
    }

    // Checksum teramati atas 999 titik (harga 1.250, diskon produk 2%, tier 12→5%, 60→10%).
    expect(sumSubtotal).toBe(562050612)
    expect(sumDiskon).toBe(9662)

    // Anchor teramati, termasuk pembulatan setengah-ke-atas pada qty 13
    // (13 × 1.250 × 0,95 = 15.437,5 → 15.438).
    expect(observed.get(1)).toEqual({ subtotal: 1225, diskon: 2 })
    expect(observed.get(11)).toEqual({ subtotal: 13475, diskon: 2 })
    expect(observed.get(12)).toEqual({ subtotal: 14250, diskon: 5 })
    expect(observed.get(13)).toEqual({ subtotal: 15438, diskon: 5 })
    expect(observed.get(59)).toEqual({ subtotal: 70063, diskon: 5 })
    expect(observed.get(60)).toEqual({ subtotal: 67500, diskon: 10 })
    expect(observed.get(999)).toEqual({ subtotal: 1123875, diskon: 10 })

    // TERAMATI, BUKAN ASUMSI: subtotal TURUN saat menyeberangi ambang tier
    // (qty 59 → 70.063, qty 60 → 67.500). Perilaku ini direkam apa adanya
    // sebagai baseline; ia tidak boleh "dikoreksi" oleh perubahan numpad.
    expect(observed.get(60)!.subtotal).toBeLessThan(observed.get(59)!.subtotal)

    // Diskon efektif hanya berpindah di dua ambang, dan tidak pernah turun.
    const switchPoints = [...observed.entries()]
      .filter(([qty, row]) => qty === 1 || row.diskon !== observed.get(qty - 1)!.diskon)
      .map(([qty, row]) => ({ qty, diskon: row.diskon }))
    expect(switchPoints).toEqual([
      { qty: 1, diskon: 2 },
      { qty: 12, diskon: 5 },
      { qty: 60, diskon: 10 },
    ])
  })

  it('menolak qty melebihi stok agregat lintas satuan dengan pesan yang sama', () => {
    const product = mockProduct({ stok: 100 })
    const dus = mockUnit()

    useCartStore.getState().addItem(product, TIERS) // 1 pcs → base 1
    useCartStore.getState().addItem(product, TIERS, dus) // 1 dus → base 12

    const [pcsLine, dusLine] = useCartStore.getState().items
    expect(pcsLine).toMatchObject({ qty: 1, rasio: 1, subtotal: 1225, diskon_item_persen: 2, satuan: 'pcs' })
    expect(dusLine).toMatchObject({
      qty: 1,
      rasio: 12,
      unit_id: 91,
      subtotal: 13300,
      diskon_item_persen: 5,
      satuan: 'dus',
      nama_produk: 'Gelas Plastik (dus)',
    })
    expect(useCartStore.getState().subtotal).toBe(14525)

    // 8 dus = 96 base, + 1 pcs = 97 ≤ 100 → diterima.
    useCartStore.getState().updateQty(1, 8, 91)
    expect(baseDemand()).toBe(97)

    // dus ke-9 butuh 108 + 1 → ditolak, pesan memakai label satuan line.
    expect(() => useCartStore.getState().addItem(product, TIERS, dus)).toThrow(
      'Qty Gelas Plastik (dus) melebihi stok',
    )
    expect(() => useCartStore.getState().updateQty(1, 9, 91)).toThrow(
      'Qty Gelas Plastik (dus) melebihi stok',
    )

    // Line pcs masih boleh naik sampai total base tepat 100, lalu ditolak.
    useCartStore.getState().updateQty(1, 4)
    expect(baseDemand()).toBe(100)
    expect(() => useCartStore.getState().addItem(product, TIERS)).toThrow(
      'Qty Gelas Plastik melebihi stok',
    )

    // Penolakan TIDAK mengubah state.
    expect(useCartStore.getState().items.map((item) => item.qty)).toEqual([4, 8])
  })

  /**
   * Property-based (fast-check): keranjang acak multi-satuan dari produk yang
   * sama. Invarian `Σ(qty × rasio) ≤ stok_dasar` harus berlaku setelah SETIAP
   * operasi, dan operasi yang ditolak tidak boleh mengubah state.
   *
   * **Validates: Requirements 3.4**
   */
  it('invarian Σ(qty × rasio) ≤ stok_dasar bertahan untuk keranjang acak', () => {
    const opArb = fc.record({
      unitIndex: fc.integer({ min: 0, max: 3 }),
      kind: fc.constantFrom('add' as const, 'update' as const),
      qty: fc.integer({ min: 1, max: 40 }),
    })

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 400 }), fc.array(opArb, { minLength: 1, maxLength: 25 }), (stok, ops) => {
        resetCart()
        const product = mockProduct({ stok })
        const units: Array<ProductUnit | null> = [
          null,
          mockUnit({ id: 91, nama_satuan: 'dus', rasio: 12, harga_jual: 14000 }),
          mockUnit({ id: 92, nama_satuan: 'lusin', rasio: 6, harga_jual: 7000 }),
          mockUnit({ id: 93, nama_satuan: 'bal', rasio: 24, harga_jual: 27000 }),
        ]

        for (const op of ops) {
          const unit = units[op.unitIndex]
          const before = useCartStore.getState().items.map((item) => ({ ...item }))
          try {
            if (op.kind === 'add') {
              useCartStore.getState().addItem(product, TIERS, unit)
            } else {
              useCartStore.getState().updateQty(1, op.qty, unit?.id ?? null)
            }
          } catch {
            // Operasi ditolak: state wajib utuh.
            expect(useCartStore.getState().items).toEqual(before)
          }

          expect(baseDemand()).toBeLessThanOrEqual(stok)
          for (const item of useCartStore.getState().items) {
            expect(item.qty).toBeGreaterThan(0)
            expect(Number.isInteger(item.subtotal)).toBe(true)
          }
        }

        return true
      }),
      { numRuns: 200 },
    )
  })
})

// ---------------------------------------------------------------------------
// 3.3 — idempotensi checkout (logika lastCheckoutFingerprintRef)
// ---------------------------------------------------------------------------

/**
 * Cermin logika `POSPage.handleProcessPayment` baris ~768–786 (dibaca apa adanya
 * dari sumber, bukan dirancang ulang). Penjaga teks di bawah mengikat cermin ini
 * ke sumber aslinya: bila daftar field fingerprint atau syarat rotasi di POSPage
 * berubah, penjaga gagal dan cermin ini harus diperbarui bersamaan.
 */
interface CheckoutPayload {
  items: Array<{ product_id: number; unit_id?: number | null; qty: number; harga_satuan: number }>
  subtotal: number
  diskon_persen: number
  diskon_amount: number
  total: number
  metode_bayar: string
  uang_diterima: number
  customer_id: number | null
}

function buildCheckoutFingerprint(payload: CheckoutPayload): string {
  return JSON.stringify({
    items: payload.items.map((i) => `${i.product_id}:${i.unit_id ?? 'b'}:${i.qty}:${i.harga_satuan}`),
    subtotal: payload.subtotal,
    diskon_persen: payload.diskon_persen,
    diskon_amount: payload.diskon_amount,
    total: payload.total,
    metode_bayar: payload.metode_bayar,
    uang_diterima: payload.metode_bayar === 'tunai' ? payload.uang_diterima : null,
    customer_id: payload.customer_id,
  })
}

function createCheckoutKeyRef(nonces: string[]) {
  let key: string | null = null
  let fingerprint: string | null = null
  let nonceIndex = 0

  return {
    /** Mengembalikan kunci yang dipakai attempt ini + apakah kunci dirotasi. */
    attempt(payload: CheckoutPayload) {
      const current = buildCheckoutFingerprint(payload)
      let keyRotated = false
      if (!key || fingerprint !== current) {
        key = `zeepos-${nonces[nonceIndex++]}`
        fingerprint = current
        keyRotated = true
      }
      return { key: key as string, keyRotated }
    },
    /** Reset setelah commit sukses (POSPage melakukannya di jalur sukses). */
    onSuccess() {
      key = null
      fingerprint = null
    },
  }
}

describe('preservation 3.3 — idempotensi checkout & rotasi kunci', () => {
  const basePayload: CheckoutPayload = {
    items: [{ product_id: 1, unit_id: 91, qty: 2, harga_satuan: 14000 }],
    subtotal: 26600,
    diskon_persen: 0,
    diskon_amount: 0,
    total: 26600,
    metode_bayar: 'tunai',
    uang_diterima: 30000,
    customer_id: null,
  }

  it('percobaan ulang payload identik memakai kunci yang sama', () => {
    const ref = createCheckoutKeyRef(['n1', 'n2', 'n3'])

    const first = ref.attempt(basePayload)
    const retry = ref.attempt({ ...basePayload, items: [{ ...basePayload.items[0] }] })

    expect(first).toEqual({ key: 'zeepos-n1', keyRotated: true })
    expect(retry).toEqual({ key: 'zeepos-n1', keyRotated: false })
  })

  it('payload yang berubah merotasi kunci', () => {
    const ref = createCheckoutKeyRef(['n1', 'n2', 'n3', 'n4'])
    expect(ref.attempt(basePayload).key).toBe('zeepos-n1')

    // qty berubah
    expect(ref.attempt({ ...basePayload, items: [{ ...basePayload.items[0], qty: 3 }], subtotal: 39900, total: 39900 }))
      .toEqual({ key: 'zeepos-n2', keyRotated: true })

    // uang diterima berubah (relevan hanya untuk tunai)
    expect(ref.attempt({ ...basePayload, items: [{ ...basePayload.items[0], qty: 3 }], subtotal: 39900, total: 39900, uang_diterima: 50000 }))
      .toEqual({ key: 'zeepos-n3', keyRotated: true })

    // pelanggan berubah
    expect(ref.attempt({ ...basePayload, items: [{ ...basePayload.items[0], qty: 3 }], subtotal: 39900, total: 39900, uang_diterima: 50000, customer_id: 7 }))
      .toEqual({ key: 'zeepos-n4', keyRotated: true })
  })

  it('uang_diterima tidak masuk fingerprint untuk metode non-tunai', () => {
    const ref = createCheckoutKeyRef(['n1', 'n2'])
    const qris = { ...basePayload, metode_bayar: 'qris', uang_diterima: 0 }
    expect(ref.attempt(qris).key).toBe('zeepos-n1')
    expect(ref.attempt({ ...qris, uang_diterima: 999999 })).toEqual({ key: 'zeepos-n1', keyRotated: false })
  })

  it('kunci dibuang setelah commit sukses sehingga nota berikutnya memakai kunci baru', () => {
    const ref = createCheckoutKeyRef(['n1', 'n2'])
    expect(ref.attempt(basePayload).key).toBe('zeepos-n1')
    ref.onSuccess()
    expect(ref.attempt(basePayload)).toEqual({ key: 'zeepos-n2', keyRotated: true })
  })

  it('POSPage hari ini memakai daftar field & syarat rotasi yang sama dengan cermin di atas', () => {
    // Daftar field fingerprint teramati di POSPage (urutan dipertahankan).
    expect(posPageSource).toMatch(
      /const currentFingerprint = JSON\.stringify\(\{\s*items: items\.map\(\(i\) => `\$\{i\.product_id\}:\$\{i\.unit_id \?\? 'b'\}:\$\{i\.qty\}:\$\{i\.harga_satuan\}`\),\s*subtotal,\s*diskon_persen,\s*diskon_amount,\s*total,\s*metode_bayar,\s*uang_diterima: metode_bayar === 'tunai' \? uang_diterima : null,\s*customer_id: selectedCustomer\?\.id \?\? null,\s*\}\)/,
    )
    // Syarat rotasi.
    expect(posPageSource).toMatch(
      /if \(!checkoutIdempotencyKeyRef\.current \|\| lastCheckoutFingerprintRef\.current !== currentFingerprint\) \{/,
    )
    expect(posPageSource).toMatch(/checkoutIdempotencyKeyRef\.current = `zeepos-\$\{nonce\}`/)
    // Retry identik melewati validasi katalog/stok frontend supaya request tetap
    // sampai ke lookup idempotensi server (recovery respons hilang).
    expect(posPageSource).toMatch(/if \(keyRotated\) \{/)
    // Reset kunci hanya di jalur sukses.
    expect(posPageSource).toMatch(
      /checkoutIdempotencyKeyRef\.current = null\s*lastCheckoutFingerprintRef\.current = null/,
    )
  })
})

// ---------------------------------------------------------------------------
// 3.5 — jalur offline: checkout mati, katalog cache sebagai referensi
// ---------------------------------------------------------------------------

describe('preservation 3.5 — jalur offline', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() })
  })

  it('POSPage menonaktifkan checkout saat offline dan menyajikan katalog cache', () => {
    // Guard awal handleProcessPayment.
    expect(posPageSource).toMatch(
      /if \(!isOnline\) \{\s*pushToast\(\{\s*title: 'Checkout dinonaktifkan',\s*description: 'Transaksi tidak dapat diproses saat offline\. Katalog tersedia untuk referensi saja\.'/,
    )
    // Dua tombol checkout ikut dinonaktifkan (desktop & mobile).
    expect(posPageSource).toContain('disabled={items.length === 0 || !isOnline}')
    expect(posPageSource).toContain('disabled={processingPayment || items.length === 0 || !isOnline}')
    // Status online berasal dari hook jaringan yang sama. Baseline memakai
    // `const isOnline = useOnlineStatus()`; sejak task 10.3/10.4 POSPage memakai
    // bentuk objek `useNetworkStatus()` agar dapat memicu probe ulang setelah
    // checkout gagal. Yang dijaga tetap sama: SATU sumber status online yang
    // masih berakar pada navigator.onLine, dan `isOnline` sebagai nama yang
    // dipakai guard checkout di atas.
    expect(posPageSource).toContain(
      'const { isOnline, revalidate: revalidateNetwork } = useNetworkStatus()',
    )
    // Probe ulang dipanggil setelah checkout gagal, bukan menggantikan guard offline.
    expect(posPageSource).toMatch(/revalidateNetwork\(\)/)
    // Katalog cache dipakai sebagai fallback baca, dan ditulis setiap muat sukses.
    expect(posPageSource).toContain('getCachedCatalogProducts<ProductWithCategory>(tenantId)')
    expect(posPageSource).toMatch(/void cacheCatalogProducts\(/)
  })

  it('katalog cache per tenant tetap terbaca saat jaringan mati', async () => {
    const { cacheCatalogProducts, getCachedCatalogProducts, getCatalogCacheFreshness } = await import('../utils/offlineDb')
    const tenantId = 'tenant-aaa'

    await cacheCatalogProducts(
      [
        { id: 1, nama: 'Gelas Plastik', harga_jual: 1250, stok: 100 },
        { id: 2, nama: 'Tali Rafia', harga_jual: 14225, stok: 30 },
      ],
      tenantId,
    )

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false, writable: true })
    try {
      const cached = await getCachedCatalogProducts<{ id: number; nama: string }>(tenantId)
      expect(cached.map((row) => row.nama).sort()).toEqual(['Gelas Plastik', 'Tali Rafia'])
      expect(await getCatalogCacheFreshness(tenantId)).toBeTypeOf('number')
      // Tenant lain tidak pernah melihat cache tenant ini.
      expect(await getCachedCatalogProducts('tenant-bbb')).toEqual([])
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: true, writable: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 3.8 — batas rentang laporan WIB (inklusif bawah / eksklusif atas)
// ---------------------------------------------------------------------------

describe('preservation 3.8 — batas rentang laporan', () => {
  it('merekam keluaran getISOStartOfDay/getISOExclusiveEndOfDay untuk tanggal batas', () => {
    const observed = [
      ['2026-01-31', '2026-01-31T00:00:00+07:00', '2026-02-01T00:00:00+07:00'],
      ['2026-02-28', '2026-02-28T00:00:00+07:00', '2026-03-01T00:00:00+07:00'],
      ['2024-02-28', '2024-02-28T00:00:00+07:00', '2024-02-29T00:00:00+07:00'], // tahun kabisat
      ['2024-02-29', '2024-02-29T00:00:00+07:00', '2024-03-01T00:00:00+07:00'],
      ['2026-04-30', '2026-04-30T00:00:00+07:00', '2026-05-01T00:00:00+07:00'],
      ['2026-12-31', '2026-12-31T00:00:00+07:00', '2027-01-01T00:00:00+07:00'], // pergantian tahun
      ['2026-09-13', '2026-09-13T00:00:00+07:00', '2026-09-14T00:00:00+07:00'],
    ] as const

    for (const [input, start, exclusiveEnd] of observed) {
      expect(getISOStartOfDay(input)).toBe(start)
      expect(getISOExclusiveEndOfDay(input)).toBe(exclusiveEnd)
      expect(getISOEndOfDay(input)).toBe(`${input}T23:59:59+07:00`)
      // Transaksi pada detik terakhir hari tidak boleh hilang.
      expect(Date.parse(getISOExclusiveEndOfDay(input))).toBeGreaterThan(Date.parse(getISOEndOfDay(input)))
    }
  })

  it('mempertahankan perilaku input tepi yang teramati', () => {
    expect(getISOStartOfDay('')).toBe('')
    expect(getISOExclusiveEndOfDay('')).toBe('')
    // Input tidak valid menghasilkan string kosong (bukan throw, bukan Invalid Date).
    expect(getISOExclusiveEndOfDay('not-a-date')).toBe('')
    // Timestamp tanpa penanda zona diberi offset WIB, bukan ditafsir sebagai UTC.
    expect(getISOStartOfDay('2026-09-13T10:30:00')).toBe('2026-09-13T10:30:00+07:00')
    // Timestamp lengkap tetap dipetakan ke awal hari BERIKUTNYA.
    expect(getISOExclusiveEndOfDay('2026-09-13T10:30:00+07:00')).toBe('2026-09-14T00:00:00+07:00')
  })

  /**
   * Property-based (fast-check): untuk tanggal kalender acak, jendela
   * [start, exclusiveEnd) selalu tepat 24 jam dan batas atasnya adalah awal hari
   * berikutnya. WIB tanpa DST, jadi 24 jam adalah nilai eksak.
   *
   * **Validates: Requirements 3.8**
   */
  it('jendela [bawah, atas) selalu tepat 24 jam untuk tanggal acak', () => {
    const dateArb = fc
      .tuple(fc.integer({ min: 2020, max: 2035 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }))
      .map(([year, month, day]) => {
        const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
        const safeDay = Math.min(day, maxDay)
        return `${year}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
      })

    fc.assert(
      fc.property(dateArb, (dateStr) => {
        const start = getISOStartOfDay(dateStr)
        const end = getISOExclusiveEndOfDay(dateStr)

        expect(start).toBe(`${dateStr}T00:00:00+07:00`)
        expect(end).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\+07:00$/)
        expect(Date.parse(end) - Date.parse(start)).toBe(86_400_000)
        expect(Date.parse(end)).toBeGreaterThan(Date.parse(getISOEndOfDay(dateStr)))
        return true
      }),
      { numRuns: 500 },
    )
  })
})

// ---------------------------------------------------------------------------
// 3.13 — struk browser tetap rekonsiliasi
// ---------------------------------------------------------------------------

describe('preservation 3.13 — struk browser (ReceiptPrint)', () => {
  const transaction = {
    id: 501,
    nomor_nota: 'INV-20260913-0007',
    kasir_id: 'kasir-uuid',
    subtotal: 80725,
    diskon_persen: 0,
    diskon_amount: 0,
    ppn_persen: 0,
    ppn_amount: 0,
    total: 80725,
    metode_bayar: 'tunai',
    uang_diterima: 100000,
    kembalian: 19275,
    catatan: 'Meja 4',
    status: 'selesai',
    payment_status: 'dibayar',
    paid_at: '2026-09-13T03:00:00.000Z',
    payment_reference: null,
    confirmed_by: null,
    idempotency_key: 'zeepos-abc',
    created_at: '2026-09-13T03:00:00.000Z',
  } as unknown as Transaction

  const items = [
    {
      id: 1,
      transaction_id: 501,
      product_id: 1,
      nama_produk: 'Gelas Plastik (dus)',
      harga_satuan: 14000,
      harga_beli: 10000,
      qty: 5,
      subtotal: 66500, // sudah termasuk diskon item 5%
      laba_kotor: null,
      diskon_item_persen: 5,
      rasio: 12,
      base_qty: 60,
      nama_satuan: 'dus',
    },
    {
      id: 2,
      transaction_id: 501,
      product_id: 2,
      nama_produk: 'Tali Rafia',
      harga_satuan: 14225,
      harga_beli: 9000,
      qty: 1,
      subtotal: 14225,
      laba_kotor: null,
      diskon_item_persen: 0,
      rasio: 1,
      base_qty: 1,
      nama_satuan: 'pcs',
    },
  ] as unknown as TransactionItem[]

  const cashier = { id: 'kasir-uuid', nama: 'Sari', role: 'kasir' } as unknown as Profile

  function renderReceipt() {
    return render(
      createElement(ReceiptPrint, {
        transaction,
        items,
        settings: { nama_toko: 'Toko Plastik Ratih', header_struk: 'Struk Pembelian', footer_struk: 'Terima kasih' },
        cashier,
      }),
    )
  }

  it('merekonsiliasi baris item dengan subtotal setelah diskon', () => {
    const { container } = renderReceipt()
    const text = container.textContent ?? ''

    // Baris berdiskon menampilkan harga BRUTO di kanan, lalu baris diskon negatif.
    expect(text).toContain('5 dus x Rp 14.000')
    expect(text).toContain('Rp 70.000')
    expect(text).toContain('Diskon 5%')
    expect(text).toContain('-Rp 3.500')
    // Baris tanpa diskon menampilkan subtotal langsung.
    expect(text).toContain('1 pcs x Rp 14.225')
    expect(text).toContain('Rp 14.225')

    // Rekonsiliasi: Σ(bruto − diskon) = subtotal transaksi.
    const gross = items.reduce((sum, item) => sum + Math.round(Number(item.qty) * Number(item.harga_satuan)), 0)
    const discounts = items.reduce(
      (sum, item) => sum + Math.max(0, Math.round(Number(item.qty) * Number(item.harga_satuan) - Number(item.subtotal))),
      0,
    )
    expect(gross).toBe(84225)
    expect(discounts).toBe(3500)
    expect(gross - discounts).toBe(Number(transaction.subtotal))
  })

  it('mencetak satuan, kembalian, dan catatan pesanan', () => {
    const { container } = renderReceipt()
    const text = container.textContent ?? ''

    expect(text).toContain('Bayar')
    expect(text).toContain('Rp 100.000')
    expect(text).toContain('Kembali')
    expect(text).toContain('Rp 19.275')
    expect(text).toContain('Catatan')
    expect(text).toContain('Meja 4')
    expect(text).toContain('SubtotalRp 80.725')
    expect(text).toContain('TotalRp 80.725')
  })
})

// ---------------------------------------------------------------------------
// Property 6 — daftar kolom katalog POS hari ini
// ---------------------------------------------------------------------------

describe('preservation Property 6 — kolom products_with_category hari ini', () => {
  /**
   * Daftar TERAMATI (diturunkan dari DDL repo, bukan dari asumsi): view masih
   * `SELECT p.*` sehingga kolomnya = seluruh kolom tabel `products` + dua kolom
   * turunan. Setelah 067 mengganti `p.*` dengan daftar eksplisit, HANYA
   * `harga_beli` yang boleh hilang dari daftar ini.
   */
  const OBSERVED_VIEW_COLUMNS = [
    // kolom tabel products (001_initial_schema)
    'id',
    'sku',
    'barcode',
    'nama',
    'deskripsi',
    'category_id',
    'satuan',
    'harga_beli',
    'harga_jual',
    'stok',
    'stok_minimum',
    'foto_url',
    'is_active',
    'created_at',
    'updated_at',
    // tambahan migrasi berikutnya
    'diskon_produk_persen', // 035
    'product_group_id', // 036
    'tenant_id', // 037
    // kolom turunan view
    'category_nama',
    'stok_status',
  ] as const

  function productsTableColumns(): string[] {
    const ddl = initialSchemaSql.slice(initialSchemaSql.indexOf('CREATE TABLE products ('))
    const body = ddl.slice(ddl.indexOf('(') + 1, ddl.indexOf(');'))
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('--'))
      .map((line) => line.split(/\s+/)[0])
  }

  it('view masih memakai p.* sehingga kolomnya mengikuti tabel products', () => {
    const viewBlock = tenantHardeningSql.slice(
      tenantHardeningSql.indexOf('CREATE VIEW products_with_category'),
      tenantHardeningSql.indexOf('DROP VIEW IF EXISTS transactions_with_kasir'),
    )
    expect(viewBlock).toContain('security_invoker = true')
    expect(viewBlock).toContain('p.*')
    expect(viewBlock).toContain('c.nama AS category_nama')
    expect(viewBlock).toMatch(/END AS stok_status/)
  })

  it('merekam daftar kolom katalog POS sebagai daftar nama eksplisit', () => {
    const fromDdl = [
      ...productsTableColumns(),
      'diskon_produk_persen',
      'product_group_id',
      'tenant_id',
      'category_nama',
      'stok_status',
    ]
    expect([...OBSERVED_VIEW_COLUMNS].sort()).toEqual([...fromDdl].sort())
    expect(OBSERVED_VIEW_COLUMNS).toHaveLength(20)

    // Kolom tambahan memang berasal dari migrasi yang disebut.
    expect(productDiscountSql).toMatch(/ADD COLUMN IF NOT EXISTS diskon_produk_persen/)
    expect(productVariantsSql).toMatch(/ADD COLUMN IF NOT EXISTS product_group_id/)
    expect(multiTenantSql).toMatch(/ALTER TABLE products ADD COLUMN tenant_id/)
  })

  it('kolom yang diwajibkan Property 6 semuanya ada hari ini', () => {
    for (const column of [
      'id', 'nama', 'sku', 'barcode', 'satuan', 'harga_jual', 'stok', 'stok_minimum',
      'stok_status', 'diskon_produk_persen', 'foto_url', 'category_id', 'category_nama',
      'is_active', 'product_group_id',
    ]) {
      expect(OBSERVED_VIEW_COLUMNS).toContain(column)
    }
  })

  it('kolom di luar daftar wajib Property 6 yang tetap dipakai jalur baca hari ini', async () => {
    const productsApiSource = (await import('../api/products.ts?raw')).default
    // Default sort halaman produk adalah `updated_at` DI ATAS view, jadi kolom
    // ini ikut dipakai meski tidak tercantum di daftar wajib Property 6.
    expect(productsApiSource).toContain(".from('products_with_category')")
    expect(productsApiSource).toMatch(/\.order\(filters\.sortBy \?\? 'updated_at'/)
    expect(OBSERVED_VIEW_COLUMNS).toContain('updated_at')
    // `created_at` adalah opsi sortBy yang sah di API yang sama.
    expect(productsApiSource).toMatch(/sortBy\?: 'nama' \| 'harga_jual' \| 'harga_beli' \| 'stok' \| 'created_at'/)
    expect(OBSERVED_VIEW_COLUMNS).toContain('created_at')
  })
})

// ---------------------------------------------------------------------------
// 3.12 — perilaku sesi, cache offline, logout, StrictMode
// ---------------------------------------------------------------------------

type TableResult = { data: unknown; error: { message: string } | null }

const authMockState = {
  session: null as Session | null,
  sessionError: null as { message: string } | null,
  profiles: { data: null, error: null } as TableResult,
  tenants: { data: null, error: null } as TableResult,
  signOutError: null as { message: string } | null,
  listeners: [] as Array<(event: string, session: Session | null) => void>,
  onAuthStateChangeCalls: 0,
}

const supabaseMock = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: authMockState.session }, error: authMockState.sessionError })),
    onAuthStateChange: vi.fn((cb: (event: string, session: Session | null) => void) => {
      authMockState.onAuthStateChangeCalls += 1
      authMockState.listeners.push(cb)
      return { data: { subscription: { unsubscribe: vi.fn() } } }
    }),
    signOut: vi.fn(async () => ({ error: authMockState.signOutError })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
  },
  from: vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => (table === 'profiles' ? authMockState.profiles : authMockState.tenants),
      }),
    }),
  })),
  rpc: vi.fn(),
}

vi.mock('../lib/supabase', () => ({ supabase: supabaseMock }))

describe('preservation 3.12 — sesi, cache offline, logout, StrictMode', () => {
  const TENANT = 'tenant-aaa'
  const SESSION = { user: { id: 'user-1' }, access_token: 'tok' } as unknown as Session
  const PROFILE = { id: 'user-1', nama: 'Sari', role: 'kasir', tenant_id: TENANT }
  const TENANT_ROW = { id: TENANT, nama: 'Toko Ratih' }

  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() })
    localStorage.clear()
    vi.clearAllMocks()
    vi.resetModules()
    authMockState.session = SESSION
    authMockState.sessionError = null
    authMockState.profiles = { data: PROFILE, error: null }
    authMockState.tenants = { data: TENANT_ROW, error: null }
    authMockState.signOutError = null
    authMockState.listeners = []
    authMockState.onAuthStateChangeCalls = 0
  })

  afterEach(() => {
    localStorage.clear()
  })

  async function bootstrap() {
    const { useAuthStore } = await import('../stores/authStore')
    const offlineDb = await import('../utils/offlineDb')
    const { useHeldCartStore } = await import('../stores/heldCartStore')
    const { useCartStore: cart } = await import('../stores/cartStore')

    await useAuthStore.getState().initialize()
    await offlineDb.cacheCatalogProducts([{ id: 1, nama: 'Gelas Plastik' }], TENANT)
    useHeldCartStore.getState().setActiveTenant(TENANT)
    await useHeldCartStore.getState().holdCurrentCart({
      items: [],
      diskon_persen: 0,
      use_ppn: false,
      ppn_persen: 11,
      metode_bayar: 'tunai',
      total: 0,
    })
    cart.getState().setPpnPersen(11)

    return { useAuthStore, offlineDb, useHeldCartStore, cart }
  }

  it('kegagalan ambil profil mempertahankan sesi dan cache offline', async () => {
    const { useAuthStore, offlineDb, useHeldCartStore, cart } = await bootstrap()

    expect(useAuthStore.getState().session).toBeTruthy()
    expect(useAuthStore.getState().user).toMatchObject({ id: 'user-1', role: 'kasir' })
    expect(useAuthStore.getState().tenant).toMatchObject({ id: TENANT })
    expect(useAuthStore.getState().isAdmin).toBe(false)
    expect(useAuthStore.getState().needsOnboarding).toBe(false)

    authMockState.profiles = { data: null, error: { message: 'FetchError: network down' } }
    authMockState.listeners.forEach((cb) => cb('TOKEN_REFRESHED', SESSION))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const state = useAuthStore.getState()
    expect(state.session).toBeTruthy()
    expect(state.error).toBe('FetchError: network down')
    // Kegagalan pengambilan profil BUKAN pergantian akun: profil & tenant lama
    // dipertahankan dan pengguna tidak didorong ke onboarding.
    expect(state.user).toMatchObject({ id: 'user-1' })
    expect(state.needsOnboarding).toBe(false)
    // Data perangkat utuh — tepat saat jaringan bermasalah dan cache dibutuhkan.
    expect(await offlineDb.getCachedCatalogProducts(TENANT)).toHaveLength(1)
    expect(useHeldCartStore.getState().heldCarts).toHaveLength(1)
    expect(cart.getState().ppn_persen).toBe(11)
  })

  it('logout membersihkan data perangkat meski signOut gagal', async () => {
    const { useAuthStore, offlineDb, useHeldCartStore, cart } = await bootstrap()

    authMockState.signOutError = { message: 'Failed to fetch' }
    await expect(useAuthStore.getState().logout()).rejects.toThrow('Failed to fetch')

    const state = useAuthStore.getState()
    expect(state.session).toBeNull()
    expect(state.user).toBeNull()
    expect(state.tenant).toBeNull()
    expect(state.isAdmin).toBe(false)
    expect(state.error).toBe('Failed to fetch')
    expect(await offlineDb.getCachedCatalogProducts(TENANT)).toEqual([])
    expect(useHeldCartStore.getState().heldCarts).toEqual([])
    expect(useHeldCartStore.getState().activeTenantId).toBeNull()
    expect(cart.getState().items).toEqual([])
    expect(cart.getState().ppn_persen).toBe(0)
  })

  it('sesi berakhir lewat event auth membersihkan cache tenant', async () => {
    const { useAuthStore, offlineDb, useHeldCartStore } = await bootstrap()

    authMockState.listeners.forEach((cb) => cb('SIGNED_OUT', null))
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(useAuthStore.getState().session).toBeNull()
    expect(await offlineDb.getCachedCatalogProducts(TENANT)).toEqual([])
    expect(useHeldCartStore.getState().heldCarts).toEqual([])
  })

  it('StrictMode (initialize dipanggil dua kali) hanya mendaftarkan satu listener', async () => {
    const { useAuthStore } = await import('../stores/authStore')

    await Promise.all([useAuthStore.getState().initialize(), useAuthStore.getState().initialize()])
    await useAuthStore.getState().initialize()

    expect(authMockState.onAuthStateChangeCalls).toBe(1)
    expect(supabaseMock.auth.getSession).toHaveBeenCalledTimes(1)
  })
})
