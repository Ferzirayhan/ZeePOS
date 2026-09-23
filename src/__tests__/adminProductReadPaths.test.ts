import { beforeEach, describe, expect, it, vi } from 'vitest'

import productsApiSource from '../api/products.ts?raw'
import unitsApiSource from '../api/units.ts?raw'
import productsPageSource from '../pages/ProductsPage.tsx?raw'

/**
 * Jalur baca admin untuk produk (task 8.3–8.5, 8.9).
 *
 * Migrasi 067 sudah live: `products_with_category` tidak lagi punya
 * `harga_beli`, dan satu-satunya sumbernya adalah
 * `products_admin_with_category` yang digerbangi `is_admin()` DI DALAM
 * definisi view — sesi non-admin menerima NOL BARIS, bukan error.
 */

interface QueryCalls {
  table: string
  select: unknown[][]
  order: unknown[][]
  range: unknown[][]
  filters: unknown[][]
}

const state = {
  calls: [] as QueryCalls[],
  result: { data: [] as unknown[], error: null as { message: string } | null, count: 0 },
}

function makeBuilder(table: string) {
  const calls: QueryCalls = { table, select: [], order: [], range: [], filters: [] }
  state.calls.push(calls)

  const builder = {
    select: (...args: unknown[]) => {
      calls.select.push(args)
      return builder
    },
    order: (...args: unknown[]) => {
      calls.order.push(args)
      return builder
    },
    range: (...args: unknown[]) => {
      calls.range.push(args)
      return builder
    },
    or: (...args: unknown[]) => {
      calls.filters.push(['or', ...args])
      return builder
    },
    eq: (...args: unknown[]) => {
      calls.filters.push(['eq', ...args])
      return builder
    },
    ilike: (...args: unknown[]) => {
      calls.filters.push(['ilike', ...args])
      return builder
    },
    then: <T>(
      onFulfilled?: (value: typeof state.result) => T,
      onRejected?: (reason: unknown) => T,
    ) => Promise.resolve(state.result).then(onFulfilled, onRejected),
  }

  return builder
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeBuilder(table),
  },
}))

const { getAdminProducts, getAdminProductsPage, getAdminProductVariants } = await import(
  '../api/products'
)

const adminRow = {
  id: 4,
  sku: 'SKU-4',
  barcode: null,
  nama: 'Kantong Plastik',
  deskripsi: null,
  category_id: 1,
  satuan: 'pcs',
  harga_beli: 900,
  harga_jual: 1200,
  diskon_produk_persen: 0,
  product_group_id: null,
  stok: 10,
  stok_minimum: 2,
  foto_url: null,
  is_active: true,
  created_at: null,
  updated_at: null,
  tenant_id: 't1',
  category_nama: 'Plastik',
  stok_status: 'aman',
}

describe('jalur baca admin produk', () => {
  beforeEach(() => {
    state.calls = []
    state.result = { data: [], error: null, count: 0 }
  })

  it('getAdminProductsPage membaca products_admin_with_category dan membawa harga_beli', async () => {
    state.result = { data: [adminRow], error: null, count: 1 }

    const result = await getAdminProductsPage({ page: 2, pageSize: 10 })

    expect(state.calls[0]?.table).toBe('products_admin_with_category')
    expect(state.calls[0]?.select[0]?.[0]).toBe('*')
    expect(state.calls[0]?.select[0]?.[1]).toEqual({ count: 'exact' })
    expect(state.calls[0]?.range[0]).toEqual([10, 19])
    expect(result.count).toBe(1)
    expect(result.data[0]?.harga_beli).toBe(900)
  })

  it('sorting harga_beli dan created_at diteruskan ke view admin', async () => {
    await getAdminProductsPage({ sortBy: 'harga_beli', sortDirection: 'asc' })
    expect(state.calls[0]?.order[0]?.[0]).toBe('harga_beli')
    expect(state.calls[0]?.order[0]?.[1]).toMatchObject({ ascending: true })

    state.calls = []
    await getAdminProductsPage({ sortBy: 'created_at' })
    expect(state.calls[0]?.order[0]?.[0]).toBe('created_at')

    // Default tetap updated_at, kolom yang masih ada di kedua view.
    state.calls = []
    await getAdminProductsPage()
    expect(state.calls[0]?.order[0]?.[0]).toBe('updated_at')
  })

  it('filter pencarian, kategori, status, dan stok tetap berjalan di view admin', async () => {
    await getAdminProductsPage({
      search: 'kantong',
      categoryId: 3,
      isActive: false,
      stokStatus: 'menipis',
    })

    const filters = state.calls[0]?.filters ?? []
    expect(filters[0]?.[0]).toBe('or')
    expect(String(filters[0]?.[1])).toContain('nama.ilike.%kantong%')
    expect(filters).toContainEqual(['eq', 'category_id', 3])
    expect(filters).toContainEqual(['eq', 'is_active', false])
    expect(filters).toContainEqual(['eq', 'stok_status', 'menipis'])
  })

  it('sesi non-admin menerima nol baris, bukan error', async () => {
    state.result = { data: [], error: null, count: 0 }

    await expect(getAdminProductsPage()).resolves.toEqual({ data: [], count: 0 })
    await expect(getAdminProducts()).resolves.toEqual([])
    await expect(getAdminProductVariants(9)).resolves.toEqual([])
  })

  it('getAdminProducts dan getAdminProductVariants memakai view admin yang sama', async () => {
    state.result = { data: [adminRow], error: null, count: 1 }

    const exportRows = await getAdminProducts()
    expect(state.calls[0]?.table).toBe('products_admin_with_category')
    expect(exportRows[0]?.harga_beli).toBe(900)

    state.calls = []
    const variants = await getAdminProductVariants(4)
    expect(state.calls[0]?.table).toBe('products_admin_with_category')
    expect(state.calls[0]?.filters).toContainEqual(['eq', 'product_group_id', 4])
    expect(variants[0]?.harga_beli).toBe(900)
  })

  it('meneruskan pesan error supabase apa adanya', async () => {
    state.result = { data: [], error: { message: 'permission denied' }, count: 0 }

    await expect(getAdminProductsPage()).rejects.toThrow('permission denied')
    await expect(getAdminProducts()).rejects.toThrow('permission denied')
    await expect(getAdminProductVariants(1)).rejects.toThrow('permission denied')
  })
})

describe('jalur baca kasir tidak ikut berubah', () => {
  it('getProductsPage, getProducts, dan getProductByBarcode tetap di products_with_category', () => {
    const catalogReads = productsApiSource.match(/\.from\('products_with_category'\)/g) ?? []
    expect(catalogReads.length).toBeGreaterThanOrEqual(3)
    expect(productsApiSource).toMatch(
      /export async function getProductsPage[\s\S]*?\.from\('products_with_category'\)/,
    )
    expect(productsApiSource).toMatch(
      /export async function getProducts\([\s\S]*?\.from\('products_with_category'\)/,
    )
    expect(productsApiSource).toMatch(
      /export async function getProductByBarcode[\s\S]*?\.from\('products_with_category'\)/,
    )
    // Kolom sortir default dan opsi sortBy tetap ada di kedua view.
    expect(productsApiSource).toMatch(/\.order\(filters\.sortBy \?\? 'updated_at'/)
  })

  it('getProductUnits memakai daftar kolom eksplisit tanpa harga_beli', () => {
    const start = unitsApiSource.indexOf('export async function getProductUnits(')
    expect(start).toBeGreaterThan(-1)
    const body = unitsApiSource.slice(
      start,
      unitsApiSource.indexOf('export ', start + 'export async function getProductUnits('.length),
    )
    expect(body).not.toContain(".select('*')")
    expect(body).toContain('.select(PRODUCT_UNIT_PUBLIC_COLUMNS)')
    expect(unitsApiSource).toContain("export const PRODUCT_UNITS_ADMIN_VIEW = 'product_units_admin'")
    const publicColumns = unitsApiSource.match(
      /const PRODUCT_UNIT_PUBLIC_COLUMNS =\s*'([^']+)'/,
    )?.[1]
    expect(publicColumns).toBeTruthy()
    expect(publicColumns).not.toContain('harga_beli')
  })
})

describe('wiring halaman Produk', () => {
  it('daftar, ekspor, dan panel varian semuanya memakai jalur admin', () => {
    expect(productsPageSource).toMatch(/const \[pageResult[\s\S]*?getAdminProductsPage\(/)
    expect(productsPageSource).toMatch(/const allProducts = await getAdminProducts\(\)/)
    expect(productsPageSource).toMatch(/getAdminProductVariants\(rootProduct\.id\)/)
    expect(productsPageSource).not.toContain('getProductsPage(')
    expect(productsPageSource).not.toContain('getProductVariants(')
  })

  it('daftar kosong untuk non-admin dijelaskan sebagai hak akses, bukan katalog kosong', () => {
    expect(productsPageSource).toMatch(/useAuthStore\(\(state\) => state\.isAdmin\)/)
    expect(productsPageSource).toMatch(/if \(!isAdmin\) \{[\s\S]*?setProducts\(\[\]\)/)
    expect(productsPageSource).toContain('Akses admin diperlukan')
  })

  it('kolom Harga Beli, Margin%, dan sorting harga_beli tetap ada', () => {
    expect(productsPageSource).toContain("['Harga Beli', 'harga_beli']")
    expect(productsPageSource).toContain("['Margin%', null]")
    expect(productsPageSource).toMatch(/'Harga Beli': Number\(p\.harga_beli \?\? 0\)/)
  })
})
