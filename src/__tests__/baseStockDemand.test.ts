import { describe, expect, it } from 'vitest'
import { aggregateBaseStockDemand, getRemainingBaseStock } from '../lib/units'
import type { CartItem } from '../types'

function line(overrides: Partial<CartItem>): CartItem {
  return {
    product_id: 1,
    sku: null,
    nama_produk: 'Produk',
    harga_satuan: 1000,
    qty: 1,
    subtotal: 1000,
    stok_dasar: 10,
    satuan: 'pcs',
    discount_tiers: [],
    diskon_produk_persen: 0,
    diskon_item_persen: 0,
    rasio: 1,
    ...overrides,
  }
}

describe('aggregateBaseStockDemand', () => {
  it('menjumlahkan qty dasar (rasio 1) untuk satu baris pcs', () => {
    const items = [line({ product_id: 1, qty: 5, rasio: 1 })]
    const demand = aggregateBaseStockDemand(items)

    expect(demand.get(1)).toBe(5)
  })

  it('mengonversi qty satuan ke base qty (rasio 12)', () => {
    const items = [line({ product_id: 1, qty: 2, rasio: 12 })]
    const demand = aggregateBaseStockDemand(items)

    expect(demand.get(1)).toBe(24)
  })

  it('menjumlahkan base qty lintas beberapa satuan produk yang sama', () => {
    const items = [
      line({ product_id: 1, qty: 5, rasio: 1 }),
      line({ product_id: 1, qty: 2, rasio: 12 }),
    ]
    const demand = aggregateBaseStockDemand(items)

    expect(demand.get(1)).toBe(29)
  })

  it('mengelompokkan permintaan per produk terpisah', () => {
    const items = [
      line({ product_id: 1, qty: 3, rasio: 1 }),
      line({ product_id: 2, qty: 2, rasio: 12 }),
    ]
    const demand = aggregateBaseStockDemand(items)

    expect(demand.get(1)).toBe(3)
    expect(demand.get(2)).toBe(24)
  })
})

describe('getRemainingBaseStock', () => {
  it('mengembalikan stok dasar penuh ketika keranjang kosong', () => {
    expect(getRemainingBaseStock(1, [], 120)).toBe(120)
  })

  it('mengurangi permintaan base qty dari stok dasar', () => {
    const items = [line({ product_id: 1, qty: 5, rasio: 1 })]
    expect(getRemainingBaseStock(1, items, 120)).toBe(115)
  })

  it('mengurangi permintaan gabungan lintas satuan', () => {
    const items = [
      line({ product_id: 1, qty: 5, rasio: 1 }),
      line({ product_id: 1, qty: 2, rasio: 12 }),
    ]
    expect(getRemainingBaseStock(1, items, 120)).toBe(91)
  })

  it('mengembalikan 0 ketika permintaan melebihi stok', () => {
    const items = [line({ product_id: 1, qty: 200, rasio: 1 })]
    expect(getRemainingBaseStock(1, items, 120)).toBe(0)
  })
})
