import { create } from 'zustand'
import type { CartItem, CartState, DiscountTier } from '../types'
import type { MetodeBayar, ProductWithCategory, ProductUnit } from '../types/database'
import { getRemainingBaseStock } from '../lib/units'

function getTierDiscount(qty: number, tiers: DiscountTier[]): number {
  if (!tiers.length) return 0
  const sorted = [...tiers].sort((a, b) => b.min_qty - a.min_qty)
  return sorted.find((t) => qty >= t.min_qty)?.diskon_persen ?? 0
}

function getEffectiveDiscount(qty: number, tiers: DiscountTier[], diskonProduk: number): number {
  return Math.max(getTierDiscount(qty, tiers), diskonProduk)
}

function roundSubtotal(value: number): number {
  return Math.round(value)
}

interface CartStore extends CartState {
  ppn_persen: number
  idempotency_key: string | null
  addItem: (product: ProductWithCategory, tiers?: DiscountTier[], unit?: ProductUnit | null) => void
  removeItem: (productId: number, unitId?: number | null | undefined) => void
  updateQty: (productId: number, qty: number, unitId?: number | null | undefined) => void
  clearCart: () => void
  beginCheckout: () => string
  setDiskon: (persen: number) => void
  togglePPN: () => void
  setPpnPersen: (persen: number) => void
  setMetodeBayar: (metode: MetodeBayar) => void
  setUangDiterima: (amount: number) => void
  restoreCart: (payload: {
    items: CartItem[]
    diskon_persen?: number
    use_ppn?: boolean
    ppn_persen?: number
    metode_bayar?: MetodeBayar
  }) => void
}

function calculateCartState(state: Pick<CartStore, 'items' | 'diskon_persen' | 'use_ppn' | 'ppn_persen' | 'uang_diterima'>) {
  const subtotal = state.items.reduce((sum, item) => sum + item.subtotal, 0)
  const diskonAmount = Math.round(subtotal * (state.diskon_persen / 100))
  const taxableAmount = Math.max(subtotal - diskonAmount, 0)
  const ppnAmount = state.use_ppn ? Math.round(taxableAmount * (state.ppn_persen / 100)) : 0
  const rawTotal = taxableAmount + ppnAmount
  const total = roundSubtotal(rawTotal)
  const kembalian = Math.max(state.uang_diterima - total, 0)

  return {
    subtotal,
    diskon_amount: diskonAmount,
    ppn_amount: ppnAmount,
    total,
    kembalian,
  }
}

function mapProductToCartItem(
  product: ProductWithCategory,
  tiers: DiscountTier[] = [],
  unit?: ProductUnit | null,
): CartItem {
  const rasio = Number(unit?.rasio ?? 1)
  const harga = unit ? Number(unit.harga_jual) : Number(product.harga_jual ?? 0)
  const diskonProduk = Number(product.diskon_produk_persen ?? 0)
  const diskon = getEffectiveDiscount(1, tiers, diskonProduk)
  const stokDasar = Number(product.stok ?? 0)
  const stokTersedia = rasio > 1 ? Math.floor(stokDasar / rasio) : stokDasar
  const namaLabel = unit ? `${product.nama ?? 'Produk'} (${unit.nama_satuan})` : (product.nama ?? 'Produk')

  return {
    product_id: product.id ?? 0,
    sku: unit?.barcode || product.sku,
    nama_produk: namaLabel,
    harga_satuan: harga,
    qty: 1,
    subtotal: roundSubtotal(harga * (1 - diskon / 100)),
    stok_tersedia: stokTersedia,
    satuan: unit ? unit.nama_satuan : (product.satuan ?? 'pcs'),
    foto_url: product.foto_url,
    discount_tiers: tiers,
    diskon_produk_persen: diskonProduk,
    diskon_item_persen: diskon,
    rasio,
    unit_id: unit?.id,
  }
}

function withRecalculatedState(partialState: Partial<CartStore>, currentState: CartStore) {
  const mergedState = {
    ...currentState,
    ...partialState,
  }

  return {
    ...partialState,
    ...calculateCartState(mergedState),
    idempotency_key: null,
  }
}

function lineMatches(item: CartItem, productId: number, unitId?: number | null | undefined) {
  return unitId
    ? item.product_id === productId && item.unit_id === unitId
    : item.product_id === productId && !item.unit_id
}

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  diskon_persen: 0,
  use_ppn: false,
  metode_bayar: 'tunai',
  uang_diterima: 0,
  subtotal: 0,
  diskon_amount: 0,
  ppn_amount: 0,
  total: 0,
  kembalian: 0,
  ppn_persen: 0,
  idempotency_key: null,

  addItem: (product, tiers = [], unit = null) => {
    const currentState = get()
    const productId = product.id ?? 0

    if (!productId) {
      throw new Error('Produk tidak valid')
    }

    const rasio = Number(unit?.rasio ?? 1)
    const stokTersedia = rasio > 1 ? Math.floor(Number(product.stok ?? 0) / rasio) : Number(product.stok ?? 0)

    if (stokTersedia <= 0) {
      throw new Error(`Stok ${product.nama ?? 'produk'} sudah habis`)
    }

    const remainingBaseForNew = getRemainingBaseStock(productId, currentState.items, Number(product.stok ?? 0))
    if (remainingBaseForNew < rasio) {
      throw new Error(`Stok ${product.nama ?? 'produk'} tidak mencukupi untuk satuan ini`)
    }

    // Unik berdasarkan product_id + unit_id jika ada satuan
    const existingItem = currentState.items.find(
      (item) => (unit ? item.product_id === productId && item.unit_id === unit.id : item.product_id === productId && !item.unit_id),
    )

    if (existingItem) {
      const remainingBase = getRemainingBaseStock(productId, currentState.items, Number(product.stok ?? 0))
      const incrementBase = Number(existingItem.rasio ?? 1)
      if (remainingBase < incrementBase) {
        throw new Error(`Qty ${existingItem.nama_produk} melebihi stok`)
      }

      const newQty = existingItem.qty + 1
      const newDiskon = getEffectiveDiscount(newQty, existingItem.discount_tiers, existingItem.diskon_produk_persen)
      const nextItems = currentState.items.map((item) =>
        (unit ? item.product_id === productId && item.unit_id === unit.id : item.product_id === productId && !item.unit_id)
          ? {
              ...item,
              qty: newQty,
              diskon_item_persen: newDiskon,
              subtotal: roundSubtotal(newQty * item.harga_satuan * (1 - newDiskon / 100)),
            }
          : item,
      )

      set(withRecalculatedState({ items: nextItems }, currentState))
      return
    }

    const nextItems = [...currentState.items, mapProductToCartItem(product, tiers, unit)]
    set(withRecalculatedState({ items: nextItems }, currentState))
  },

  removeItem: (productId, unitId = null) => {
    const currentState = get()
    const nextItems = currentState.items.filter((item) => !lineMatches(item, productId, unitId))
    set(withRecalculatedState({ items: nextItems }, currentState))
  },

  updateQty: (productId, qty, unitId = null) => {
    const currentState = get()
    const targetItem = currentState.items.find((item) => lineMatches(item, productId, unitId))

    if (!targetItem) {
      return
    }

    if (qty <= 0) {
      const nextItems = currentState.items.filter((item) => !lineMatches(item, productId, unitId))
      set(withRecalculatedState({ items: nextItems }, currentState))
      return
    }

    const stockInBaseUnits = Math.max(
      ...currentState.items
        .filter((item) => item.product_id === productId)
        .map((item) => item.stok_tersedia * Number(item.rasio ?? 1)),
    )
    const aggregateBaseDemand = currentState.items.reduce(
      (sum, item) => sum + (
        item.product_id === productId
          ? (lineMatches(item, productId, unitId) ? qty : item.qty) * Number(item.rasio ?? 1)
          : 0
      ),
      0,
    )

    if (aggregateBaseDemand > stockInBaseUnits) {
      throw new Error(`Qty ${targetItem.nama_produk} melebihi stok`)
    }

    const newDiskon = getEffectiveDiscount(qty, targetItem.discount_tiers, targetItem.diskon_produk_persen)
    const nextItems = currentState.items.map((item) =>
      lineMatches(item, productId, unitId)
        ? {
            ...item,
            qty,
            diskon_item_persen: newDiskon,
            subtotal: roundSubtotal(qty * item.harga_satuan * (1 - newDiskon / 100)),
          }
        : item,
    )

    set(withRecalculatedState({ items: nextItems }, currentState))
  },

  clearCart: () =>
    set({
      items: [],
      diskon_persen: 0,
      use_ppn: false,
      metode_bayar: 'tunai',
      uang_diterima: 0,
      subtotal: 0,
      diskon_amount: 0,
      ppn_amount: 0,
      total: 0,
      kembalian: 0,
      ppn_persen: 0,
      idempotency_key: null,
    }),

  beginCheckout: () => {
    const currentState = get()
    if (currentState.idempotency_key) {
      return currentState.idempotency_key
    }

    const fingerprint = currentState.items
      .map((i) => `${i.product_id}:${i.unit_id ?? 'base'}:${i.qty}`)
      .join('|')
    const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const key = `zeepos-${nonce}-${fingerprint}`

    set({ idempotency_key: key })
    return key
  },

  setDiskon: (persen) => {
    const currentState = get()
    const normalizedValue = Number.isFinite(persen) ? Math.min(Math.max(persen, 0), 100) : 0
    set(withRecalculatedState({ diskon_persen: normalizedValue }, currentState))
  },

  togglePPN: () => {
    const currentState = get()
    set(withRecalculatedState({ use_ppn: !currentState.use_ppn }, currentState))
  },

  setPpnPersen: (persen) => {
    const currentState = get()
    const normalizedValue = Number.isFinite(persen) ? Math.max(persen, 0) : 0
    set(
      withRecalculatedState(
        {
          ppn_persen: normalizedValue,
          use_ppn: normalizedValue > 0 ? currentState.use_ppn : false,
        },
        currentState,
      ),
    )
  },

  setMetodeBayar: (metode) => set({ metode_bayar: metode }),

  setUangDiterima: (amount) => {
    const currentState = get()
    const normalizedValue = Number.isFinite(amount) ? Math.max(amount, 0) : 0
    set(withRecalculatedState({ uang_diterima: normalizedValue }, currentState))
  },

  restoreCart: (payload) => {
    const currentState = get()
    const newItems = payload.items || []
    const newDiskon = payload.diskon_persen ?? 0
    const newPpn = payload.use_ppn ?? false
    const newPpnPersen = payload.ppn_persen ?? currentState.ppn_persen
    const newMetode = payload.metode_bayar ?? 'tunai'

    const partial = {
      items: newItems,
      diskon_persen: newDiskon,
      use_ppn: newPpn,
      ppn_persen: newPpnPersen,
      metode_bayar: newMetode,
      uang_diterima: 0,
    }

    set(withRecalculatedState(partial, currentState))
  },
}))
