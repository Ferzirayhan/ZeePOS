import { supabase } from '../lib/supabase'
import type {
  Category,
  Database,
  Product,
  ProductWithCategory,
  StokStatus,
} from '../types/database'

export interface ProductFilters {
  search?: string
  categoryId?: number
  isActive?: boolean
  stokStatus?: StokStatus
}

export interface ProductPageFilters extends ProductFilters {
  page?: number
  pageSize?: number
  sortBy?: 'nama' | 'harga_jual' | 'harga_beli' | 'stok' | 'created_at'
  sortDirection?: 'asc' | 'desc'
}

export interface ProductPageResult {
  data: ProductWithCategory[]
  count: number
}

export async function getCategories(includeInactive = false): Promise<Category[]> {
  let query = supabase.from('categories').select('*').order('nama', { ascending: true })

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getProducts(
  filters: ProductFilters = {},
): Promise<ProductWithCategory[]> {
  let query = supabase
    .from('products_with_category')
    .select('*')
    .order('nama', { ascending: true })

  if (filters.search) {
    query = query.ilike('nama', `%${filters.search}%`)
  }

  if (typeof filters.categoryId === 'number') {
    query = query.eq('category_id', filters.categoryId)
  }

  if (typeof filters.isActive === 'boolean') {
    query = query.eq('is_active', filters.isActive)
  }

  if (filters.stokStatus) {
    query = query.eq('stok_status', filters.stokStatus)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getProductsPage(
  filters: ProductPageFilters = {},
): Promise<ProductPageResult> {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('products_with_category')
    .select('*', { count: 'exact' })
    .order(filters.sortBy ?? 'updated_at', {
      ascending: (filters.sortDirection ?? 'desc') === 'asc',
      nullsFirst: false,
    })
    .range(from, to)

  if (filters.search) {
    query = query.or(
      `nama.ilike.%${filters.search}%,sku.ilike.%${filters.search}%,barcode.ilike.%${filters.search}%`,
    )
  }

  if (typeof filters.categoryId === 'number') {
    query = query.eq('category_id', filters.categoryId)
  }

  if (typeof filters.isActive === 'boolean') {
    query = query.eq('is_active', filters.isActive)
  }

  if (filters.stokStatus) {
    query = query.eq('stok_status', filters.stokStatus)
  }

  const { data, error, count } = await query

  if (error) {
    throw new Error(error.message)
  }

  return {
    data: data ?? [],
    count: count ?? 0,
  }
}

export async function getProductByBarcode(
  barcode: string,
): Promise<ProductWithCategory | null> {
  const { data, error } = await supabase
    .from('products_with_category')
    .select('*')
    .eq('barcode', barcode)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function getActiveCategories(): Promise<Category[]> {
  return getCategories(false)
}

export async function createCategory(
  payload: Database['public']['Tables']['categories']['Insert'],
): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function updateCategory(
  id: number,
  payload: Database['public']['Tables']['categories']['Update'],
): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function deleteCategory(id: number): Promise<Category> {
  const { count, error: productError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)

  if (productError) {
    throw new Error(productError.message)
  }

  if ((count ?? 0) > 0) {
    throw new Error('Kategori masih dipakai produk. Hapus atau pindahkan semua produknya dulu.')
  }

  const { data, error } = await supabase
    .from('categories')
    .delete()
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function archiveCategory(id: number): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update({ is_active: false })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createProduct(
  payload: Database['public']['Tables']['products']['Insert'],
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error('SKU atau barcode sudah dipakai produk lain.')
    }
    throw new Error(error.message)
  }

  return data
}

export async function updateProduct(
  id: number,
  payload: Database['public']['Tables']['products']['Update'],
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new Error('SKU atau barcode sudah dipakai produk lain.')
    }
    throw new Error(error.message)
  }

  return data
}

export async function uploadProductPhoto(file: File): Promise<string> {
  const { data: tenantId, error: tenantError } = await supabase.rpc('get_my_tenant_id' as never)
  if (tenantError || !tenantId) {
    throw new Error(tenantError?.message ?? 'Tenant aktif tidak ditemukan.')
  }

  const fileExtension = file.name.split('.').pop() ?? 'jpg'
  const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExtension}`
  const filePath = `${tenantId}/${fileName}`

  const { error } = await supabase.storage.from('products').upload(filePath, file, {
    cacheControl: '3600',
    upsert: false,
  })

  if (error) {
    throw new Error(error.message)
  }

  const { data } = supabase.storage.from('products').getPublicUrl(filePath)
  return data.publicUrl
}

export async function deleteProduct(id: number): Promise<Product> {
  const [{ count: transactionItemCount, error: transactionItemError }, { count: adjustmentCount, error: adjustmentError }] =
    await Promise.all([
      supabase
        .from('transaction_items')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id),
      supabase
        .from('stock_adjustments')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', id),
    ])

  if (transactionItemError) {
    throw new Error(transactionItemError.message)
  }

  if (adjustmentError) {
    throw new Error(adjustmentError.message)
  }

  if ((transactionItemCount ?? 0) > 0 || (adjustmentCount ?? 0) > 0) {
    throw new Error(
      'Produk ini sudah punya riwayat transaksi atau stok, jadi tidak bisa dihapus permanen. Ubah status aktif dari edit produk jika ingin menyembunyikannya.',
    )
  }

  const { data, error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function archiveProduct(id: number): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update({ is_active: false })
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function getProductStats() {
  const [products, categories] = await Promise.all([
    getProducts(),
    getActiveCategories(),
  ])

  return {
    totalProducts: products.length,
    totalCategories: categories.length,
    lowStockProducts: products.filter((item) => item.stok_status === 'menipis').length,
    inactiveProducts: products.filter((item) => item.is_active === false).length,
  }
}

export interface ProductPriceHistory {
  id: number
  product_id: number
  harga_beli: number
  harga_jual: number
  changed_by: string | null
  keterangan: string | null
  created_at: string | null
}

export interface DiscountTierRow {
  min_qty: number
  diskon_persen: number
}

export async function getProductDiscountTiers(productId: number): Promise<DiscountTierRow[]> {
  const { data, error } = await supabase
    .from('product_discount_tiers')
    .select('min_qty, diskon_persen')
    .eq('product_id', productId)
    .order('min_qty', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => ({
    min_qty: Number(row.min_qty),
    diskon_persen: Number(row.diskon_persen),
  }))
}

export async function getAllProductDiscountTiersMap(): Promise<Record<number, DiscountTierRow[]>> {
  const { data, error } = await supabase
    .from('product_discount_tiers')
    .select('product_id, min_qty, diskon_persen')
    .order('min_qty', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const map: Record<number, DiscountTierRow[]> = {}
  for (const row of data ?? []) {
    const pid = Number(row.product_id)
    if (!map[pid]) map[pid] = []
    map[pid].push({ min_qty: Number(row.min_qty), diskon_persen: Number(row.diskon_persen) })
  }
  return map
}

export async function saveProductDiscountTiers(
  productId: number,
  tiers: DiscountTierRow[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('product_discount_tiers')
    .delete()
    .eq('product_id', productId)

  if (deleteError) {
    throw new Error(deleteError.message)
  }

  if (tiers.length === 0) return

  const { error: insertError } = await supabase.from('product_discount_tiers').insert(
    tiers.map((t) => ({
      product_id: productId,
      min_qty: t.min_qty,
      diskon_persen: t.diskon_persen,
    })),
  )

  if (insertError) {
    throw new Error(insertError.message)
  }
}

export async function bulkUpdateProductPrices(
  updates: { product_id: number; harga_beli?: number; harga_jual: number }[],
  keterangan?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('bulk_update_product_prices', {
    p_updates: updates,
    p_keterangan: keterangan ?? null,
    p_user_id: null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return Number(data ?? 0)
}

export interface ProductVariantInput {
  satuan: string
  harga_beli: number
  harga_jual: number
  stok?: number
  stok_minimum?: number
  sku?: string | null
  barcode?: string | null
  diskon_produk_persen?: number
}

export async function getProductVariants(
  groupId: number,
): Promise<ProductWithCategory[]> {
  const { data, error } = await supabase
    .from('products_with_category')
    .select('*')
    .eq('product_group_id', groupId)
    .order('satuan', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getAllProductVariantsMap(): Promise<Record<number, ProductWithCategory[]>> {
  const { data, error } = await supabase
    .from('products_with_category')
    .select('*')
    .not('product_group_id', 'is', null)
    .eq('is_active', true)

  if (error) {
    throw new Error(error.message)
  }

  const map: Record<number, ProductWithCategory[]> = {}
  for (const p of data ?? []) {
    const gid = Number(p.product_group_id)
    if (!map[gid]) map[gid] = []
    map[gid].push(p)
  }
  return map
}

export async function createProductVariant(
  rootProduct: ProductWithCategory,
  variant: ProductVariantInput,
): Promise<Product> {
  const rootId = rootProduct.id ?? 0
  if (!rootId) throw new Error('Produk induk tidak valid')

  const payload: import('../types/database').Database['public']['Tables']['products']['Insert'] = {
    nama: rootProduct.nama ?? 'Produk',
    category_id: rootProduct.category_id,
    satuan: variant.satuan as import('../types/database').SatuanType,
    harga_beli: variant.harga_beli,
    harga_jual: variant.harga_jual,
    stok: variant.stok ?? 0,
    stok_minimum: variant.stok_minimum ?? 0,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    diskon_produk_persen: variant.diskon_produk_persen ?? 0,
    product_group_id: rootId,
    is_active: true,
  }

  const { data, error } = await supabase
    .from('products')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('SKU atau barcode sudah dipakai produk lain.')
    throw new Error(error.message)
  }

  // Mark root product as part of the group (product_group_id = root.id)
  await supabase
    .from('products')
    .update({ product_group_id: rootId })
    .eq('id', rootId)
    .is('product_group_id', null)

  return data
}

export async function deleteProductVariant(variantId: number): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ product_group_id: null, is_active: false })
    .eq('id', variantId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function getProductPriceHistory(
  productId: number,
): Promise<ProductPriceHistory[]> {
  const { data, error } = await supabase
    .from('product_price_history')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((item) => ({
    id: item.id,
    product_id: item.product_id,
    harga_beli: Number(item.harga_beli ?? 0),
    harga_jual: Number(item.harga_jual ?? 0),
    changed_by: item.changed_by ?? null,
    keterangan: item.keterangan ?? null,
    created_at: item.created_at ?? null,
  }))
}
