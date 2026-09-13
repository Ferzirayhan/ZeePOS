import { describe, expect, it } from 'vitest'
import { getUnitChoices, findUnitChoice } from '../lib/units'
import type { ProductWithCategory, ProductUnit } from '../types/database'

function mockProduct(overrides: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    id: 1,
    nama: 'Air Mineral',
    harga_jual: 3000,
    harga_beli: 2000,
    diskon_produk_persen: null,
    product_group_id: null,
    stok: 120,
    stok_minimum: 5,
    stok_status: 'aman',
    is_active: true,
    sku: 'AIR-001',
    barcode: '8990001000011',
    category_id: 1,
    category_nama: 'Minuman',
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
    tenant_id: 't1',
    product_id: 1,
    nama_satuan: 'dus',
    rasio: 12,
    barcode: '8990001112223',
    harga_beli: 32000,
    harga_jual: 33000,
    is_default: false,
    ...overrides,
  }
}

describe('getUnitChoices', () => {
  it('menyertakan satuan dasar produk sebagai pilihan pertama', () => {
    const product = mockProduct()
    const choices = getUnitChoices(product, [])

    expect(choices).toHaveLength(1)
    expect(choices[0]).toMatchObject({
      unit_id: null,
      nama_satuan: 'pcs',
      rasio: 1,
      harga_jual: 3000,
      stok_tersedia: 120,
      source: 'base',
    })
  })

  it('menambahkan product_units sebagai pilihan berikut dengan stok rasio', () => {
    const product = mockProduct()
    const dus = mockUnit()

    const choices = getUnitChoices(product, [dus])

    expect(choices).toHaveLength(2)
    expect(choices[1]).toMatchObject({
      unit_id: 5,
      nama_satuan: 'dus',
      rasio: 12,
      harga_jual: 33000,
      stok_tersedia: 10,
      source: 'product_unit',
    })
  })

  it('mengabaikan product_units dari produk lain', () => {
    const product = mockProduct()
    const otherUnit = mockUnit({ product_id: 99 })

    const choices = getUnitChoices(product, [otherUnit])

    expect(choices).toHaveLength(1)
    expect(choices[0].source).toBe('base')
  })

  it('membawa barcode satuan dasar dan product_unit untuk lookup', () => {
    const product = mockProduct()
    const dus = mockUnit({ barcode: 'UNIT-DUS-1' })

    const choices = getUnitChoices(product, [dus])

    expect(choices[0].barcode).toBe('8990001000011')
    expect(choices[1].barcode).toBe('UNIT-DUS-1')
  })
})

describe('findUnitChoice', () => {
  it('menemukan pilihan berdasarkan barcode satuan dasar', () => {
    const product = mockProduct()
    const choices = getUnitChoices(product, [])

    expect(findUnitChoice(choices, '8990001000011')?.source).toBe('base')
  })

  it('menemukan pilihan berdasarkan barcode product_unit', () => {
    const product = mockProduct()
    const dus = mockUnit({ barcode: 'UNIT-DUS-1' })
    const choices = getUnitChoices(product, [dus])

    expect(findUnitChoice(choices, 'UNIT-DUS-1')?.unit_id).toBe(5)
  })

  it('mengembalikan null ketika barcode tidak ada', () => {
    const choices = getUnitChoices(mockProduct(), [])
    expect(findUnitChoice(choices, 'tidak-ada')).toBeNull()
  })
})
