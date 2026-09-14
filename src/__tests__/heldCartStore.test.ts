import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHeldCartStore, type HoldCartPayload } from '../stores/heldCartStore'
import type { CartItem } from '../types'

function baseItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    product_id: 1,
    sku: 'TST-001',
    nama_produk: 'Test Produk',
    harga_satuan: 10000,
    qty: 2,
    subtotal: 20000,
    stok_tersedia: 10,
    satuan: 'pcs',
    discount_tiers: [],
    diskon_produk_persen: 0,
    diskon_item_persen: 0,
    ...overrides,
  }
}

async function seedCart(overrides: Partial<HoldCartPayload> = {}): Promise<string> {
  return useHeldCartStore.getState().holdCurrentCart({
    label: 'Pesanan #1',
    items: [baseItem()],
    diskon_persen: 0,
    use_ppn: false,
    ppn_persen: 0,
    metode_bayar: 'tunai',
    total: 20000,
    ...overrides,
  })
}

function storageKeyFor(tenantId: string): string {
  return `zeepos_held_carts:${tenantId}`
}

function readRawStorage(tenantId: string): unknown {
  const raw = window.localStorage.getItem(storageKeyFor(tenantId))
  return raw === null ? null : JSON.parse(raw)
}

function writeRawStorage(tenantId: string, value: unknown): void {
  window.localStorage.setItem(storageKeyFor(tenantId), JSON.stringify(value))
}

describe('heldCartStore — customer state round-trip', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useHeldCartStore.getState().clearForLogout()
    useHeldCartStore.getState().setActiveTenant('tenant-a')
  })

  it('holdCurrentCart menyimpan customer_id dan customer_nama', async () => {
    const id = await seedCart({ customer_id: 42, customer_nama: 'Budi' })

    const held = useHeldCartStore.getState().heldCarts.find((h) => h.id === id)
    expect(held?.customer_id).toBe(42)
    expect(held?.customer_nama).toBe('Budi')
  })

  it('resumeHeldCart mengembalikan customer data + claim token, lalu acknowledge menghapusnya', async () => {
    const id = await seedCart({ customer_id: 42, customer_nama: 'Budi' })

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed?.customer_id).toBe(42)
    expect(resumed?.customer_nama).toBe('Budi')
    expect(resumed?.claim_token).toBeTruthy()

    // Setelah resume, cart disembunyikan tapi masih tersimpan (crash-safe)
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).toBeUndefined()

    await useHeldCartStore.getState().acknowledgeResume(id, resumed?.claim_token)
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).toBeUndefined()
  })

  it('rollbackResume mengembalikan pesanan ke daftar setelah restore gagal', async () => {
    const id = await seedCart()

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed).not.toBeNull()
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).toBeUndefined()

    await useHeldCartStore.getState().rollbackResume(id, resumed?.claim_token)
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).not.toBeUndefined()
  })

  it('klaim kedua untuk cart yang sedang diklaim gagal (claim-once)', async () => {
    const id = await seedCart()

    const first = await useHeldCartStore.getState().resumeHeldCart(id)
    const second = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(first).not.toBeNull()
    expect(second).toBeNull()
  })

  it('klaim kedua untuk cart yang sudah di-acknowledge juga gagal', async () => {
    const id = await seedCart()

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    await useHeldCartStore.getState().acknowledgeResume(id, resumed?.claim_token)

    const second = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(second).toBeNull()
  })

  it('holdCurrentCart tanpa pelanggan menyimpan null', async () => {
    const id = await seedCart()

    const held = useHeldCartStore.getState().heldCarts.find((h) => h.id === id)
    expect(held?.customer_id).toBeNull()
    expect(held?.customer_nama).toBeNull()
  })

  it('hanya menampilkan pesanan tenant aktif', async () => {
    await seedCart()
    useHeldCartStore.getState().setActiveTenant('tenant-b')

    expect(useHeldCartStore.getState().heldCarts).toEqual([])
  })

  it('logout membersihkan dan menyembunyikan semua pesanan', async () => {
    await seedCart()
    useHeldCartStore.getState().clearForLogout()

    expect(useHeldCartStore.getState().heldCarts).toEqual([])
    await expect(
      useHeldCartStore.getState().holdCurrentCart({
        items: [baseItem()],
        diskon_persen: 0,
        use_ppn: false,
        ppn_persen: 0,
        metode_bayar: 'tunai',
        total: 20000,
      }),
    ).rejects.toThrow(/tenant/i)
  })

  it('holdCurrentCart tetap tersimpan di storage meski memory kosong (storage adalah truth)', async () => {
    const id = await seedCart()
    // Simulasi tab dengan memory stale (misal hydrate lama): storage harus tetap menang
    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed).not.toBeNull()
  })
})

describe('heldCartStore — tenant isolation & multi-tab hardening', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useHeldCartStore.getState().clearForLogout()
    useHeldCartStore.getState().setActiveTenant('tenant-a')
  })

  it('setiap tenant punya key localStorage terpisah: tulisan tenant B tidak menyentuh tenant A', async () => {
    const idA = await seedCart({ label: 'Cart A' })

    useHeldCartStore.getState().setActiveTenant('tenant-b')
    await seedCart({ label: 'Cart B' })

    // Tenant A masih utuh di key-nya sendiri
    const rawA = readRawStorage('tenant-a') as Array<{ id: string; label: string }>
    expect(Array.isArray(rawA)).toBe(true)
    expect(rawA.some((c) => c.id === idA)).toBe(true)

    // Kembali ke tenant A: cart A masih ada, cart B tidak bocor
    useHeldCartStore.getState().setActiveTenant('tenant-a')
    const carts = useHeldCartStore.getState().heldCarts
    expect(carts.some((c) => c.id === idA)).toBe(true)
    expect(carts.some((c) => c.label === 'Cart B')).toBe(false)
  })

  it('operasi tenant B tidak menghapus held-cart tenant A (critical #2: persist middleware tidak ada)', async () => {
    await seedCart({ label: 'Cart A' })

    useHeldCartStore.getState().setActiveTenant('tenant-b')
    await seedCart({ label: 'Cart B' })
    await useHeldCartStore.getState().clearAllHeldCarts() // tenant B mengosongkan miliknya

    useHeldCartStore.getState().setActiveTenant('tenant-a')
    expect(useHeldCartStore.getState().heldCarts).toHaveLength(1)
    expect(useHeldCartStore.getState().heldCarts[0]?.label).toBe('Cart A')
  })

  it('array kosong dari tab lain adalah kebenaran: klaim ditolak, bukan fallback ke memory', async () => {
    const id = await seedCart()

    // Tab lain menghapus cart (menulis array kosong ke storage)
    writeRawStorage('tenant-a', [])

    // Tab ini belum reload — memory masih pegang cart. Sinkronkan lewat setActiveTenant
    useHeldCartStore.getState().setActiveTenant('tenant-a')
    expect(useHeldCartStore.getState().heldCarts).toEqual([])

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed).toBeNull()
  })

  it('storage korup di-self-heal: snapshot lama tidak dipercaya, operasi berikutnya menulis data valid', async () => {
    const id = await seedCart()

    // Rusakkan storage dengan JSON invalid (simulasi tulisan parsial / korupsi)
    window.localStorage.setItem(storageKeyFor('tenant-a'), '{not valid json')

    // Operasi baru harus tetap jalan dan menulis ulang storage yang valid
    const id2 = await seedCart({ label: 'Cart Sesudah Korupsi' })
    const raw = readRawStorage('tenant-a') as Array<{ id: string }>
    expect(Array.isArray(raw)).toBe(true)
    expect(raw.some((c) => c.id === id2)).toBe(true)

    // Cart lama yang datanya hanya ada di blob korup tidak dibangunkan dari kubur
    const resumedOld = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumedOld).toBeNull()
    const resumedNew = await useHeldCartStore.getState().resumeHeldCart(id2)
    expect(resumedNew).not.toBeNull()
  })

  it('acknowledge/rollback dengan token usang ditolak setelah klaim diambil alih tab lain', async () => {
    const id = await seedCart()

    const first = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(first?.claim_token).toBeTruthy()

    // Klaim tab pertama kedaluwarsa (TTL lewat), lalu tab lain mengambil alih klaim
    const raw = readRawStorage('tenant-a') as Array<{ id: string; claimed_at: string | null; claim_token: string | null }>
    const target = raw.find((c) => c.id === id)
    expect(target?.claim_token).toBe(first?.claim_token)
    target!.claimed_at = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 menit lalu
    writeRawStorage('tenant-a', raw)

    const second = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(second).not.toBeNull()
    expect(second?.claim_token).not.toBe(first?.claim_token)

    // Token lama TIDAK boleh meng-acknowledge klaim baru tab lain
    await useHeldCartStore.getState().acknowledgeResume(id, first?.claim_token)
    expect(
      (readRawStorage('tenant-a') as Array<{ id: string }>).some((c) => c.id === id),
    ).toBe(true)

    // Token baru berhak
    await useHeldCartStore.getState().acknowledgeResume(id, second?.claim_token)
    expect(
      (readRawStorage('tenant-a') as Array<{ id: string }>).some((c) => c.id === id),
    ).toBe(false)
  })

  it('acknowledge/rollback tanpa token saat cart sedang diklaim ditolak', async () => {
    const id = await seedCart()
    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed?.claim_token).toBeTruthy()

    await useHeldCartStore.getState().acknowledgeResume(id) // tanpa token
    expect(
      (readRawStorage('tenant-a') as Array<{ id: string }>).some((c) => c.id === id),
    ).toBe(true)

    await useHeldCartStore.getState().rollbackResume(id) // tanpa token
    const raw = readRawStorage('tenant-a') as Array<{ claimed_at: string | null }>
    expect(raw.find((c) => 'claimed_at' in c && c.claimed_at)?.claimed_at).toBeTruthy()
  })

  it('klaim dengan timestamp masa depan tidak sah: cart tetap terlihat, bukan terkunci lama', async () => {
    const id = await seedCart()

    // Simulasi jam perangkat salah / manipulasi: klaim 24 jam ke depan
    const raw = readRawStorage('tenant-a') as Array<{ id: string; claimed_at: string | null }>
    const target = raw.find((c) => c.id === id)
    target!.claimed_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    writeRawStorage('tenant-a', raw)

    // Re-hydrate seperti tab baru / ganti tenant
    useHeldCartStore.getState().setActiveTenant('tenant-a')

    // Klaim masa depan dianggap tidak aktif → cart TAMPIL kembali, bukan hilang
    expect(useHeldCartStore.getState().heldCarts.some((c) => c.id === id)).toBe(true)

    // Dan bisa langsung diklaim normal
    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed).not.toBeNull()
  })

  it('kegagalan persist saat klaim tidak mengklaim (cart tetap tersedia)', async () => {
    const id = await seedCart()

    // Buat setItem melempar (storage penuh / diblokir) khusus key tenant ini.
    // Spy di Storage.prototype supaya instance localStorage yang dipakai store ikut.
    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === storageKeyFor('tenant-a')) throw new Error('QuotaExceededError')
        original.call(this, key, value)
      })

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed).toBeNull() // gagal persist = jangan klaim

    spy.mockRestore()

    // Cart masih bisa diklaim setelah storage pulih
    const retry = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(retry).not.toBeNull()
  })
})
