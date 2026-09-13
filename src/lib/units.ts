import type { ProductWithCategory, ProductUnit } from '../types/database'

// Multi-unit POS helpers. See docs/plans/2026-09-13-production-hardening.md
// "Invariant: variants vs. units are independent". A product_unit is a
// sales-pack (rasio-multiplied) of ONE product's base stock; a product
// variant is a separate stockable products row. Base-stock demand is
// aggregated per product_id across unit lines only.

export interface UnitChoice {
  unit_id: number | null
  nama_satuan: string
  rasio: number
  harga_jual: number
  stok_tersedia: number
  barcode?: string | null
  source: 'base' | 'product_unit'
}

export function getUnitChoices(
  product: ProductWithCategory,
  units: ProductUnit[],
): UnitChoice[] {
  const baseStok = Number(product.stok ?? 0)
  const baseChoice: UnitChoice = {
    unit_id: null,
    nama_satuan: product.satuan ?? 'pcs',
    rasio: 1,
    harga_jual: Number(product.harga_jual ?? 0),
    stok_tersedia: baseStok,
    barcode: product.barcode ?? null,
    source: 'base',
  }

  const unitChoices: UnitChoice[] = units
    .filter((u) => u.product_id === product.id)
    .map((u) => {
      const rasio = Number(u.rasio)
      return {
        unit_id: u.id,
        nama_satuan: u.nama_satuan,
        rasio,
        harga_jual: Number(u.harga_jual),
        stok_tersedia: rasio > 1 ? Math.floor(baseStok / rasio) : baseStok,
        barcode: u.barcode ?? null,
        source: 'product_unit' as const,
      }
    })

  return [baseChoice, ...unitChoices]
}

export function findUnitChoice(choices: UnitChoice[], barcode: string): UnitChoice | null {
  return choices.find((c) => c.barcode && c.barcode === barcode) ?? null
}

export function aggregateBaseStockDemand(items: { product_id: number; qty: number; rasio?: number }[]): Map<number, number> {
  const demand = new Map<number, number>()
  for (const item of items) {
    const rasio = Number(item.rasio ?? 1)
    const baseQty = Number(item.qty) * rasio
    const prev = demand.get(item.product_id) ?? 0
    demand.set(item.product_id, prev + baseQty)
  }
  return demand
}

export function getRemainingBaseStock(
  productId: number,
  items: { product_id: number; qty: number; rasio?: number }[],
  productStok: number,
): number {
  const demand = aggregateBaseStockDemand(items)
  const used = demand.get(productId) ?? 0
  return Math.max(Number(productStok) - used, 0)
}
