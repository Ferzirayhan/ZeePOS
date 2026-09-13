import { beforeEach, describe, expect, it } from 'vitest'
import { useCartStore } from '../stores/cartStore'
import type { ProductWithCategory } from '../types/database'

function mockProduct(overrides: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    id: 1,
    nama: 'Test Produk',
    harga_jual: 10000,
    harga_beli: 7000,
    diskon_produk_persen: null,
    product_group_id: null,
    stok: 10,
    stok_minimum: 5,
    stok_status: 'aman',
    is_active: true,
    sku: 'TST-001',
    barcode: null,
    category_id: 1,
    category_nama: 'Test Kategori',
    satuan: 'pcs',
    deskripsi: null,
    foto_url: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe('cartStore — idempotency key for checkout', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
  })

  it('beginCheckout menghasilkan idempotency_key non-kosong', () => {
    useCartStore.getState().addItem(mockProduct())
    const key = useCartStore.getState().beginCheckout()

    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
    expect(useCartStore.getState().idempotency_key).toBe(key)
  })

  it('idempotency_key stabil untuk keranjang yang sama sampai clearCart', () => {
    useCartStore.getState().addItem(mockProduct())
    const first = useCartStore.getState().beginCheckout()
    const second = useCartStore.getState().beginCheckout()

    expect(first).toBe(second)
    expect(useCartStore.getState().idempotency_key).toBe(first)
  })

  it('clearCart mereset idempotency_key menjadi null', () => {
    useCartStore.getState().addItem(mockProduct())
    useCartStore.getState().beginCheckout()
    expect(useCartStore.getState().idempotency_key).not.toBeNull()

    useCartStore.getState().clearCart()
    expect(useCartStore.getState().idempotency_key).toBeNull()
  })

  it('keranjang baru setelah clear menghasilkan key yang berbeda', () => {
    useCartStore.getState().addItem(mockProduct({ id: 1 }))
    const first = useCartStore.getState().beginCheckout()
    useCartStore.getState().clearCart()

    useCartStore.getState().addItem(mockProduct({ id: 2 }))
    const second = useCartStore.getState().beginCheckout()

    expect(first).not.toBe(second)
  })

  it('mutasi keranjang setelah checkout tidak memakai ulang key payload lama', () => {
    useCartStore.getState().addItem(mockProduct())
    const first = useCartStore.getState().beginCheckout()
    useCartStore.getState().updateQty(1, 2)
    const second = useCartStore.getState().beginCheckout()

    expect(second).not.toBe(first)
  })
})
