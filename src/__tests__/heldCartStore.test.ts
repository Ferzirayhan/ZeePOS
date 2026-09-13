import { beforeEach, describe, expect, it } from 'vitest'
import { useHeldCartStore } from '../stores/heldCartStore'
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

describe('heldCartStore — customer state round-trip', () => {
  beforeEach(() => {
    useHeldCartStore.getState().clearAllHeldCarts()
    useHeldCartStore.getState().setActiveTenant('tenant-a')
  })

  it('holdCurrentCart menyimpan customer_id dan customer_nama', () => {
    const id = useHeldCartStore.getState().holdCurrentCart({
      label: 'Pesanan #1',
      items: [baseItem()],
      diskon_persen: 0,
      use_ppn: false,
      ppn_persen: 0,
      metode_bayar: 'tunai',
      total: 20000,
      customer_id: 42,
      customer_nama: 'Budi',
    })

    const held = useHeldCartStore.getState().heldCarts.find((h) => h.id === id)
    expect(held?.customer_id).toBe(42)
    expect(held?.customer_nama).toBe('Budi')
  })

  it('resumeHeldCart mengembalikan customer_id dan customer_nama', () => {
    const id = useHeldCartStore.getState().holdCurrentCart({
      label: 'Pesanan #1',
      items: [baseItem()],
      diskon_persen: 0,
      use_ppn: false,
      ppn_persen: 0,
      metode_bayar: 'tunai',
      total: 20000,
      customer_id: 42,
      customer_nama: 'Budi',
    })

    const resumed = useHeldCartStore.getState().resumeHeldCart(id)
    expect(resumed?.customer_id).toBe(42)
    expect(resumed?.customer_nama).toBe('Budi')
  })

  it('holdCurrentCart tanpa pelanggan menyimpan null', () => {
    const id = useHeldCartStore.getState().holdCurrentCart({
      label: 'Pesanan #1',
      items: [baseItem()],
      diskon_persen: 0,
      use_ppn: false,
      ppn_persen: 0,
      metode_bayar: 'tunai',
      total: 20000,
    })

    const held = useHeldCartStore.getState().heldCarts.find((h) => h.id === id)
    expect(held?.customer_id).toBeNull()
    expect(held?.customer_nama).toBeNull()
  })

  it('hanya menampilkan pesanan tenant aktif', () => {
    useHeldCartStore.getState().holdCurrentCart({ items: [baseItem()], diskon_persen: 0, use_ppn: false, ppn_persen: 0, metode_bayar: 'tunai', total: 20000 })
    useHeldCartStore.getState().setActiveTenant('tenant-b')

    expect(useHeldCartStore.getState().heldCarts).toEqual([])
  })

  it('logout membersihkan dan menyembunyikan semua pesanan', () => {
    useHeldCartStore.getState().holdCurrentCart({ items: [baseItem()], diskon_persen: 0, use_ppn: false, ppn_persen: 0, metode_bayar: 'tunai', total: 20000 })
    useHeldCartStore.getState().clearForLogout()

    expect(useHeldCartStore.getState().heldCarts).toEqual([])
    expect(() => useHeldCartStore.getState().holdCurrentCart({ items: [baseItem()], diskon_persen: 0, use_ppn: false, ppn_persen: 0, metode_bayar: 'tunai', total: 20000 })).toThrow(/tenant/i)
  })
})
