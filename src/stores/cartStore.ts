import { create } from 'zustand'
import type { CartItem, CartState, DiscountTier } from '../types'
import type { MetodeBayar, ProductWithCategory, ProductUnit } from '../types/database'

interface CartStore extends CartState {
  ppn_persen: number
  addItem: (product: ProductWithCategory, tiers?: DiscountTier[], unit?: ProductUnit | null) => void
  removeItem: (productId: number, unitId?: number | null | undefined) => void
  updateQty: (productId: number, qty: number, unitId?: number | null | undefined) => void
  clearCart: () => void
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

// Tier diskon berbasis BASE QTY (qty * rasio), konsisten dengan RPC checkout.
function getEffectiveDiscount(baseQty: number, tiers: DiscountTier[], diskonProduk: number): number {
  if (!tiers.length) return diskonProduk
  return Math.max(diskonProduk, ...tiers.filter((t) => baseQty >= t.min_qty).map((t) => t.diskon_persen))
}

function lineMatches(item: CartItem, productId: number, unitId?: number | null | undefined) {
  return unitId
    ? item.product_id === productId && item.unit_id === unitId
    : item.product_id === productId && !item.unit_id
}

// Total kebutuhan stok dasar semua line milik satu produk (pcs + dus dijumlahkan).
function baseDemandOf(items: CartItem[], productId: number, exceptLine?: CartItem): number {
  return items.reduce(
    (sum, item) => (item.product_id === productId && item !== exceptLine ? sum + item.qty * Number(item.rasio ?? 1) : sum),
    0,
  )
}

function calculateCartState(state: Pick<CartStore, 'items' | 'diskon_persen' | 'use_ppn' | 'ppn_persen' | 'uang_diterima'>) {
  const subtotal = state.items.reduce((sum, item) => sum + item.subtotal, 0)
  const diskonAmount = Math.round(subtotal * (state.diskon_persen / 100))
  const taxableAmount = Math.max(0, subtotal - diskonAmount)
  // PPN otomatis aktif jika ppn_persen > 0 (server-authoritative)
  const isPpnActive = state.ppn_persen > 0 ? true : Boolean(state.use_ppn)
  const ppnAmount = isPpnActive ? Math.round(taxableAmount * (state.ppn_persen / 100)) : 0
  const total = taxableAmount + ppnAmount
  const kembalian = Math.max(0, state.uang_diterima - total)

  return {
    subtotal,
    diskon_amount: diskonAmount,
    ppn_amount: ppnAmount,
    total,
    kembalian,
  }
}

function withRecalculatedState(partialState: Partial<CartStore>, currentState: CartStore) {
  return {
    ...partialState,
    ...calculateCartState({ ...currentState, ...partialState }),
  }
}

function mapProductToCartItem(
  product: ProductWithCategory,
  tiers: DiscountTier[] = [],
  unit?: ProductUnit | null,
): CartItem {
  const rasio = Number(unit?.rasio ?? 1)
  const harga = Number(unit ? unit.harga_jual : product.harga_jual ?? 0)
  const diskonProduk = Number(product.diskon_produk_persen ?? 0)
  const stokDasar = Number(product.stok ?? 0)
  const namaLabel = unit ? `${product.nama ?? 'Produk'} (${unit.nama_satuan})` : (product.nama ?? 'Produk')

  return {
    product_id: product.id ?? 0,
    sku: unit?.barcode || product.sku,
    nama_produk: namaLabel,
    harga_satuan: harga,
    qty: 1,
    subtotal: Math.round(harga * (1 - getEffectiveDiscount(rasio, tiers, diskonProduk) / 100)),
    stok_dasar: stokDasar,
    satuan: unit ? unit.nama_satuan : (product.satuan ?? 'pcs'),
    foto_url: product.foto_url,
    discount_tiers: tiers,
    diskon_produk_persen: diskonProduk,
    diskon_item_persen: getEffectiveDiscount(rasio, tiers, diskonProduk),
    rasio,
    unit_id: unit?.id,
  }
}

function recalcLine(item: CartItem, qty: number): CartItem {
  const baseQty = qty * Number(item.rasio ?? 1)
  const diskon = getEffectiveDiscount(baseQty, item.discount_tiers, item.diskon_produk_persen)
  return {
    ...item,
    qty,
    diskon_item_persen: diskon,
    subtotal: Math.round(qty * item.harga_satuan * (1 - diskon / 100)),
  }
}

const EMPTY_CART = {
  items: [] as CartItem[],
  diskon_persen: 0,
  use_ppn: false,
  metode_bayar: 'tunai' as MetodeBayar,
  uang_diterima: 0,
  subtotal: 0,
  diskon_amount: 0,
  ppn_amount: 0,
  total: 0,
  kembalian: 0,
  ppn_persen: 0,
}

export const useCartStore = create<CartStore>((set, get) => ({
  ...EMPTY_CART,

  addItem: (product, tiers = [], unit = null) => {
    const currentState = get()
    const productId = product.id ?? 0

    if (!productId) {
      throw new Error('Produk tidak valid')
    }

    const rasio = Number(unit?.rasio ?? 1)
    const stokDasar = Number(product.stok ?? 0)
    const existingLine = currentState.items.find((item) => lineMatches(item, productId, unit?.id ?? null))

    // Line baru: butuh satu satuan jual bebas; line lama: tambah satu lagi.
    // `claimed` HARUS mengecualikan line target, karena `need` sudah menghitung
    // qty line tersebut secara penuh (qty + 1). Tanpa pengecualian ini kebutuhan
    // line lama dihitung dua kali dan kasir diblokir di ~setengah stok asli.
    const claimed = baseDemandOf(currentState.items, productId, existingLine)
    const need = (existingLine ? existingLine.qty + 1 : 1) * rasio
    if (claimed + need > stokDasar) {
      throw new Error(existingLine
        ? `Qty ${existingLine.nama_produk} melebihi stok`
        : `Stok ${product.nama ?? 'produk'} tidak mencukupi untuk satuan ini`)
    }

    const nextItems = existingLine
      ? currentState.items.map((item) => (item === existingLine ? recalcLine(item, existingLine.qty + 1) : item))
      : [...currentState.items, mapProductToCartItem(product, tiers, unit)]

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

    if (!targetItem) return

    if (qty <= 0) {
      const nextItems = currentState.items.filter((item) => !lineMatches(item, productId, unitId))
      set(withRecalculatedState({ items: nextItems }, currentState))
      return
    }

    // Cek agregat: kebutuhan dasar produk ini (line lain + line ini) tidak boleh melebihi stok.
    const otherDemand = baseDemandOf(currentState.items, productId, targetItem)
    if (otherDemand + qty * Number(targetItem.rasio ?? 1) > targetItem.stok_dasar) {
      throw new Error(`Qty ${targetItem.nama_produk} melebihi stok`)
    }

    const nextItems = currentState.items.map((item) => (item === targetItem ? recalcLine(item, qty) : item))
    set(withRecalculatedState({ items: nextItems }, currentState))
  },

  // Mengosongkan keranjang TIDAK mereset ppn_persen: tarif PPN adalah konfigurasi
  // toko (server-authoritative) yang dicerminkan ke store, bukan isi keranjang.
  // Sebelumnya tarif ikut ter-reset ke 0, sehingga setelah "Tahan Pesanan" atau
  // "Kosongkan Keranjang" kasir dikutip total tanpa PPN sementara server tetap
  // menagih PPN. Reset tarif secara eksplisit lewat setPpnPersen(0) saat logout
  // atau ganti tenant.
  clearCart: () => set({ ...EMPTY_CART, ppn_persen: get().ppn_persen }),

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
    // Normalisasi item dari parkir lama: field stok_tersedia lama disimpan dalam
    // satuan jual line (dus = floor(base/rasio)), jadi kalikan balik rasio untuk
    // mendapatkan lower-bound stok dasar (aman, tidak akan oversell).
    const items = (payload.items || []).map((item) => {
      const rasio = Number(item.rasio ?? 1)
      const legacy = (item as { stok_tersedia?: number }).stok_tersedia
      const stok_dasar = item.stok_dasar ?? (legacy !== undefined ? legacy * rasio : 0)
      return { ...item, stok_dasar }
    })
    set(
      withRecalculatedState(
        {
          items,
          diskon_persen: payload.diskon_persen ?? 0,
          use_ppn: payload.use_ppn ?? false,
          ppn_persen: payload.ppn_persen ?? currentState.ppn_persen,
          metode_bayar: payload.metode_bayar ?? 'tunai',
          uang_diterima: 0,
        },
        currentState,
      ),
    )
  },
}))
