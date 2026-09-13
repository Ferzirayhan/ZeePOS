import { beforeEach, describe, expect, it } from 'vitest'
import { useCartStore } from '../stores/cartStore'
import type { ProductWithCategory } from '../types/database'
import type { ProductUnit } from '../types/database'

function mockProduct(overrides: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    id: 1,
    nama: 'Test Produk',
    harga_jual: 10000,
    harga_beli: 7000,
    diskon_produk_persen: null,
    product_group_id: null,
    stok: 120,
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

function mockUnit(overrides: Partial<ProductUnit> = {}): ProductUnit {
  return {
    id: 5,
    tenant_id: 't-1',
    product_id: 1,
    nama_satuan: 'dus',
    rasio: 12,
    barcode: null,
    harga_beli: 80000,
    harga_jual: 110000,
    is_default: false,
    ...overrides,
  }
}

describe('cart line identity (product + unit)', () => {
  beforeEach(() => {
    useCartStore.getState().clearCart()
  })

  it('menambah satu produk di dua satuan berbeda menjadi dua baris terpisah', () => {
    const product = mockProduct()
    const dus = mockUnit()

    useCartStore.getState().addItem(product, [], null)
    useCartStore.getState().addItem(product, [], dus)

    const { items } = useCartStore.getState()
    expect(items).toHaveLength(2)
    expect(items.find((i) => !i.unit_id)?.satuan).toBe('pcs')
    expect(items.find((i) => i.unit_id === 5)?.satuan).toBe('dus')
  })

  it('removeItem hanya menghapus baris dengan satuan yang cocok', () => {
    const product = mockProduct()
    const dus = mockUnit()
    const productId = product.id ?? 0

    useCartStore.getState().addItem(product, [], null)
    useCartStore.getState().addItem(product, [], dus)
    expect(useCartStore.getState().items).toHaveLength(2)

    useCartStore.getState().removeItem(productId, null)

    const { items } = useCartStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0].unit_id).toBe(5)
  })

  it('removeItem menghapus baris satuan dus tanpa menyentuh baris pcs', () => {
    const product = mockProduct()
    const dus = mockUnit()
    const productId = product.id ?? 0

    useCartStore.getState().addItem(product, [], null)
    useCartStore.getState().addItem(product, [], dus)

    useCartStore.getState().removeItem(productId, dus.id)

    const { items } = useCartStore.getState()
    expect(items).toHaveLength(1)
    expect(items[0].unit_id).toBeUndefined()
  })

  it('updateQty hanya mengubah baris dengan satuan yang cocok', () => {
    const product = mockProduct()
    const dus = mockUnit()
    const productId = product.id ?? 0

    useCartStore.getState().addItem(product, [], null)
    useCartStore.getState().addItem(product, [], dus)

    useCartStore.getState().updateQty(productId, 3, dus.id)

    const { items } = useCartStore.getState()
    const dusLine = items.find((i) => i.unit_id === 5)
    const pcsLine = items.find((i) => !i.unit_id)
    expect(dusLine?.qty).toBe(3)
    expect(pcsLine?.qty).toBe(1)
  })

  it('memblokir penambahan satuan dus ketika base qty pcs sudah mengisi stok', () => {
    const product = mockProduct({ stok: 13 })
    const dus = mockUnit() // rasio 12
    const productId = product.id ?? 0

    useCartStore.getState().addItem(product, [], null) // 1 pcs -> base 1
    useCartStore.getState().updateQty(productId, 2, null) // 2 pcs -> base 2
    expect(() => useCartStore.getState().addItem(product, [], dus)).toThrow()
  })

  it('memperbolehkan menambah dus ketika stok dasar masih cukup bersama pcs', () => {
    const product = mockProduct({ stok: 50 })
    const dus = mockUnit() // rasio 12

    useCartStore.getState().addItem(product, [], null) // base 1
    expect(() => useCartStore.getState().addItem(product, [], dus)).not.toThrow() // base 12, total 13 <= 50
  })

  it('updateQty memvalidasi total kebutuhan stok dasar semua satuan produk', () => {
    const product = mockProduct({ stok: 13 })
    const dus = mockUnit() // rasio 12
    const productId = product.id ?? 0

    useCartStore.getState().addItem(product, [], null)
    useCartStore.getState().addItem(product, [], dus)

    expect(() => useCartStore.getState().updateQty(productId, 2, null)).toThrow(/melebihi stok/i)
    expect(useCartStore.getState().items.find((item) => !item.unit_id)?.qty).toBe(1)
  })
})
