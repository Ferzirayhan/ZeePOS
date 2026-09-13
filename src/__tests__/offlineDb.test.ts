import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

import {
  cacheCatalogProducts,
  getCachedCatalogProducts,
  getCatalogCacheFreshness,
  clearCatalogCache,
} from '../utils/offlineDb'
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

function resetIndexedDB() {
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
  })
}

describe('offlineDb tenant partitioning', () => {
  beforeEach(() => {
    resetIndexedDB()
  })

  it('menyimpan dan membaca produk per tenant secara terisolasi', async () => {
    const tenantA = 'tenant-aaa'
    const tenantB = 'tenant-bbb'

    const productsA = [
      mockProduct({ id: 1, nama: 'Produk A1' }),
      mockProduct({ id: 2, nama: 'Produk A2' }),
    ]
    const productsB = [mockProduct({ id: 3, nama: 'Produk B1' })]

    await cacheCatalogProducts(productsA, tenantA)
    await cacheCatalogProducts(productsB, tenantB)

    const cachedA = await getCachedCatalogProducts<ProductWithCategory>(tenantA)
    const cachedB = await getCachedCatalogProducts<ProductWithCategory>(tenantB)

    expect(cachedA).toHaveLength(2)
    expect(cachedA.map((p) => p.id).sort()).toEqual([1, 2])

    expect(cachedB).toHaveLength(1)
    expect(cachedB[0].id).toBe(3)
  })
})

describe('offlineDb freshness tracking', () => {
  beforeEach(() => {
    resetIndexedDB()
  })

  it('mencatat timestamp cache terakhir per tenant', async () => {
    const tenantA = 'tenant-aaa'
    const tenantB = 'tenant-bbb'

    const beforeA = await getCatalogCacheFreshness(tenantA)
    expect(beforeA).toBeNull()

    const productsA = [mockProduct({ id: 1, nama: 'Produk A1' })]
    await cacheCatalogProducts(productsA, tenantA)

    const freshnessA = await getCatalogCacheFreshness(tenantA)
    expect(freshnessA).not.toBeNull()
    expect(typeof freshnessA).toBe('number')

    const productsB = [mockProduct({ id: 2, nama: 'Produk B1' })]
    await cacheCatalogProducts(productsB, tenantB)

    const freshnessB = await getCatalogCacheFreshness(tenantB)
    expect(freshnessB).not.toBeNull()
    expect(freshnessB).toBeGreaterThanOrEqual(freshnessA ?? 0)
  })
})

describe('offlineDb cache clearing', () => {
  beforeEach(() => {
    resetIndexedDB()
  })

  it('menghapus cache tenant yang ditentukan tanpa menyentuh tenant lain', async () => {
    const tenantA = 'tenant-aaa'
    const tenantB = 'tenant-bbb'

    await cacheCatalogProducts([mockProduct({ id: 1, nama: 'Produk A1' })], tenantA)
    await cacheCatalogProducts([mockProduct({ id: 2, nama: 'Produk B1' })], tenantB)

    await clearCatalogCache(tenantA)

    const cachedA = await getCachedCatalogProducts<ProductWithCategory>(tenantA)
    const cachedB = await getCachedCatalogProducts<ProductWithCategory>(tenantB)
    const freshnessA = await getCatalogCacheFreshness(tenantA)
    const freshnessB = await getCatalogCacheFreshness(tenantB)

    expect(cachedA).toHaveLength(0)
    expect(freshnessA).toBeNull()

    expect(cachedB).toHaveLength(1)
    expect(cachedB[0].id).toBe(2)
    expect(freshnessB).not.toBeNull()
  })

  it('menghapus semua cache ketika tenantId tidak diberikan', async () => {
    const tenantA = 'tenant-aaa'
    const tenantB = 'tenant-bbb'

    await cacheCatalogProducts([mockProduct({ id: 1, nama: 'Produk A1' })], tenantA)
    await cacheCatalogProducts([mockProduct({ id: 2, nama: 'Produk B1' })], tenantB)

    await clearCatalogCache()

    const cachedA = await getCachedCatalogProducts<ProductWithCategory>(tenantA)
    const cachedB = await getCachedCatalogProducts<ProductWithCategory>(tenantB)
    const freshnessA = await getCatalogCacheFreshness(tenantA)
    const freshnessB = await getCatalogCacheFreshness(tenantB)

    expect(cachedA).toHaveLength(0)
    expect(cachedB).toHaveLength(0)
    expect(freshnessA).toBeNull()
    expect(freshnessB).toBeNull()
  })
})
