import type {
  MetodeBayar,
  Product,
  ProductWithCategory,
  Profile,
} from './database'

export interface DiscountTier {
  min_qty: number
  diskon_persen: number
}

export interface CartItem {
  product_id: number
  sku: string | null
  nama_produk: string
  harga_satuan: number
  qty: number
  subtotal: number
  stok_tersedia: number
  satuan: string
  foto_url?: string | null
  discount_tiers: DiscountTier[]
  diskon_produk_persen: number
  diskon_item_persen: number
  rasio?: number
  unit_id?: number
}

export interface CartState {
  items: CartItem[]
  diskon_persen: number
  use_ppn: boolean
  metode_bayar: MetodeBayar
  uang_diterima: number
  subtotal: number
  diskon_amount: number
  ppn_amount: number
  total: number
  kembalian: number
}

export interface DashboardStats {
  totalPenjualanHariIni: number
  jumlahTransaksiHariIni: number
  produkTerlarisHariIni: {
    productId: number | null
    nama: string
    qty: number
  } | null
  jumlahProdukStokMenipis: number
}

export interface DashboardDelta {
  current: number
  previous: number
  percentage: number | null
}

export interface DashboardChangeSummary {
  totalPenjualan: DashboardDelta
  jumlahTransaksi: DashboardDelta
  produkTerlarisQty: DashboardDelta
  rataRataTransaksi: DashboardDelta
}

export interface DashboardNotification {
  id: string
  title: string
  description: string
  tone: 'danger' | 'warning' | 'info'
  href?: string
}

export interface SalesReport {
  tanggal: string
  totalPenjualan: number
  jumlahTransaksi: number
}

export interface TopProduct {
  productId: number
  nama: string
  totalQty: number
  totalPenjualan: number
  categoryNama?: string | null
}

export interface ProfitSummaryItem {
  tanggal: string
  totalOmzet: number
  totalHpp: number
  totalLaba: number
  marginPersen: number
  jumlahTransaksi: number
}

export interface AuthUserProfile {
  authUserId: string
  profile: Profile | null
}

export interface ProductFilter {
  search?: string
  categoryId?: number
  isActive?: boolean
  stokStatus?: 'aman' | 'menipis' | 'habis'
}

export interface ProductLookupResult {
  product: Product | ProductWithCategory | null
  found: boolean
}
