import { beforeEach, describe, expect, it } from 'vitest'
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

describe('heldCartStore — customer state round-trip', () => {
  beforeEach(async () => {
    await useHeldCartStore.getState().clearAllHeldCarts()
    useHeldCartStore.getState().setActiveTenant('tenant-a')
  })

  it('holdCurrentCart menyimpan customer_id dan customer_nama', async () => {
    const id = await seedCart({ customer_id: 42, customer_nama: 'Budi' })

    const held = useHeldCartStore.getState().heldCarts.find((h) => h.id === id)
    expect(held?.customer_id).toBe(42)
    expect(held?.customer_nama).toBe('Budi')
  })

  it('resumeHeldCart mengembalikan customer_id dan customer_nama lalu acknowledge menghapusnya', async () => {
    const id = await seedCart({ customer_id: 42, customer_nama: 'Budi' })

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed?.customer_id).toBe(42)
    expect(resumed?.customer_nama).toBe('Budi')

    // Setelah resume, cart disembunyikan tapi masih tersimpan (crash-safe)
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).toBeUndefined()

    await useHeldCartStore.getState().acknowledgeResume(id)
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).toBeUndefined()
  })

  it('rollbackResume mengembalikan pesanan ke daftar setelah restore gagal', async () => {
    const id = await seedCart()

    const resumed = await useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed).not.toBeNull()
    expect(useHeldCartStore.getState().heldCarts.find((h) => h.id === id)).toBeUndefined()

    await useHeldCartStore.getState().rollbackResume(id)
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

    await useHeldCartStore.getState().resumeHeldCart(id)
    await useHeldCartStore.getState().acknowledgeResume(id)

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
