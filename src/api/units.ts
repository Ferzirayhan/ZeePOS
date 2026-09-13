import { supabase } from '../lib/supabase'
import type { ProductUnit } from '../types/database'

export async function getProductUnits(productId: number): Promise<ProductUnit[]> {
  const { data, error } = await supabase
    .from('product_units')
    .select('*')
    .eq('product_id', productId)
    .order('rasio', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data as ProductUnit[]) || []
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
