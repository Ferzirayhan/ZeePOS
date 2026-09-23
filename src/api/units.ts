import { supabase } from '../lib/supabase'
import type { ProductUnit } from '../types/database'

/**
 * Satuan produk tanpa kolom biaya. Jalur umum (kasir maupun admin) tidak boleh
 * lagi memakai `select('*')` pada tabel `product_units`: `*` menarik
 * `harga_beli`, dan sekali hak kolom itu dicabut, satu kolom yang tidak berhak
 * membuat SELECT gagal SELURUHNYA, bukan mengosongkan kolomnya.
 */
export type ProductUnitPublic = Omit<ProductUnit, 'harga_beli'>

const PRODUCT_UNIT_PUBLIC_COLUMNS =
  'id, tenant_id, product_id, nama_satuan, rasio, barcode, harga_jual, is_default, created_at'

const PRODUCT_UNIT_ADMIN_COLUMNS =
  'id, tenant_id, product_id, nama_satuan, rasio, barcode, harga_beli, harga_jual, is_default, created_at'

/**
 * View jalur admin (migrasi 067), digerbangi `tenant_id = get_my_tenant_id()
 * AND is_admin()` di dalam definisi view. Sesi non-admin menerima NOL BARIS.
 */
export const PRODUCT_UNITS_ADMIN_VIEW = 'product_units_admin' as const

export async function getProductUnits(productId: number): Promise<ProductUnitPublic[]> {
  const { data, error } = await supabase
    .from('product_units')
    .select(PRODUCT_UNIT_PUBLIC_COLUMNS)
    .eq('product_id', productId)
    .order('rasio', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data as unknown as ProductUnitPublic[]) || []
}

/**
 * Jalur baca admin untuk satuan produk: memuat `harga_beli` lewat
 * `product_units_admin`. Sesi non-admin menerima array kosong (bukan error),
 * jadi pemanggil harus membedakannya dari "produk ini tidak punya satuan".
 */
export async function getAdminProductUnits(productId: number): Promise<ProductUnit[]> {
  const { data, error } = await supabase
    .from(PRODUCT_UNITS_ADMIN_VIEW)
    .select(PRODUCT_UNIT_ADMIN_COLUMNS)
    .eq('product_id', productId)
    .order('rasio', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data as unknown as ProductUnit[]) || []
}

export async function getProductUnitByBarcode(barcode: string): Promise<ProductUnit | null> {
  const { data, error } = await supabase
    .from('product_units')
    .select('*')
    .eq('barcode', barcode)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return (data as ProductUnit) ?? null
}

export async function getAllProductUnitsMap(): Promise<Record<number, ProductUnit[]>> {
  const { data, error } = await supabase
    .from('product_units')
    .select('*')
    .order('rasio', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const map: Record<number, ProductUnit[]> = {}
  for (const row of (data as ProductUnit[]) || []) {
    if (!map[row.product_id]) {
      map[row.product_id] = []
    }
    map[row.product_id].push(row)
  }

  return map
}

export async function createProductUnit(payload: {
  product_id: number
  nama_satuan: string
  rasio: number
  harga_beli?: number
  harga_jual: number
  barcode?: string | null
}): Promise<ProductUnit> {
  const { data, error } = await supabase
    .from('product_units')
    .insert({
      product_id: payload.product_id,
      nama_satuan: payload.nama_satuan.trim(),
      rasio: Number(payload.rasio),
      harga_beli: Number(payload.harga_beli ?? 0),
      harga_jual: Number(payload.harga_jual),
      barcode: payload.barcode?.trim() || null,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as ProductUnit
}

export async function deleteProductUnit(id: number): Promise<void> {
  const { error } = await supabase.from('product_units').delete().eq('id', id)
  if (error) {
    throw new Error(error.message)
  }
}
