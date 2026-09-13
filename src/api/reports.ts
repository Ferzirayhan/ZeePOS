import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  formatISO,
  startOfDay,
  subDays,
} from 'date-fns'
import { getISOEndOfDay, getISOStartOfDay, formatLocalDateKey } from '../utils/date'
import { supabase } from '../lib/supabase'
import type {
  DashboardChangeSummary,
  DashboardNotification,
  DashboardStats,
  ProfitSummaryItem,
  SalesReport,
  TopProduct,
} from '../types'
import type { MetodeBayar, PaymentStatus, TransactionWithKasir } from '../types/database'

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('get_dashboard_stats')

  if (error) {
    throw new Error(error.message)
  }

  return {
    totalPenjualanHariIni: Number(data?.total_penjualan_hari_ini ?? 0),
    jumlahTransaksiHariIni: Number(data?.jumlah_transaksi_hari_ini ?? 0),
    jumlahProdukStokMenipis: Number(data?.jumlah_produk_stok_menipis ?? 0),
    produkTerlarisHariIni: data?.produk_terlaris_hari_ini
      ? {
          productId: data.produk_terlaris_hari_ini.product_id,
          nama: data.produk_terlaris_hari_ini.nama ?? 'Produk',
          qty: Number(data.produk_terlaris_hari_ini.qty),
        }
      : null,
  }
}

function buildDayRange(date: Date) {
  return {
    from: formatISO(startOfDay(date)),
    to: formatISO(endOfDay(date)),
  }
}

function calculateDelta(current: number, previous: number) {
  if (previous <= 0) {
    return {
      current,
      previous,
      percentage: current > 0 ? 100 : 0,
    }
  }

  return {
    current,
    previous,
    percentage: ((current - previous) / previous) * 100,
  }
}

async function getDailySnapshot(date: Date) {
  const range = buildDayRange(date)
  const [sales, topProduct] = await Promise.all([
    getSalesReport(range.from, range.to),
    getTopProducts(range.from, range.to, 1),
  ])

  const totalPenjualan = sales.reduce((sum, item) => sum + item.totalPenjualan, 0)
  const jumlahTransaksi = sales.reduce((sum, item) => sum + item.jumlahTransaksi, 0)
  const rataRataTransaksi =
    jumlahTransaksi > 0 ? totalPenjualan / jumlahTransaksi : 0

  return {
    totalPenjualan,
    jumlahTransaksi,
    produkTerlarisQty: topProduct[0]?.totalQty ?? 0,
    rataRataTransaksi,
  }
}

export async function getDashboardChangeSummary(): Promise<DashboardChangeSummary> {
  const today = new Date()
  const yesterday = subDays(today, 1)

  const [todaySnapshot, yesterdaySnapshot] = await Promise.all([
    getDailySnapshot(today),
    getDailySnapshot(yesterday),
  ])

  return {
    totalPenjualan: calculateDelta(
      todaySnapshot.totalPenjualan,
      yesterdaySnapshot.totalPenjualan,
    ),
    jumlahTransaksi: calculateDelta(
      todaySnapshot.jumlahTransaksi,
      yesterdaySnapshot.jumlahTransaksi,
    ),
    produkTerlarisQty: calculateDelta(
      todaySnapshot.produkTerlarisQty,
      yesterdaySnapshot.produkTerlarisQty,
    ),
    rataRataTransaksi: calculateDelta(
      todaySnapshot.rataRataTransaksi,
      yesterdaySnapshot.rataRataTransaksi,
    ),
  }
}

export async function getDashboardNotifications(): Promise<DashboardNotification[]> {
  const [lowStockResult, latestTransactions, pendingTransactionsResult] = await Promise.all([
    supabase
      .from('products_with_category')
      .select('id, nama, stok, stok_minimum, stok_status')
      .eq('is_active', true)
      .in('stok_status', ['menipis', 'habis'])
      .order('stok', { ascending: true })
      .limit(5),
    getLatestTransactions(3, 'dibayar'),
    supabase
      .from('transactions_with_kasir')
      .select('id, nomor_nota, total, payment_status, metode_bayar')
      .eq('status', 'selesai')
      .eq('payment_status', 'menunggu_konfirmasi')
      .order('created_at', { ascending: false })
      .limit(3),
  ])

  if (lowStockResult.error) {
    throw new Error(lowStockResult.error.message)
  }

  if (pendingTransactionsResult.error) {
    throw new Error(pendingTransactionsResult.error.message)
  }

  const lowStockNotifications: DashboardNotification[] = (lowStockResult.data ?? []).map(
    (item) => ({
      id: `stock-${item.id}`,
      title: `${item.nama} menipis`,
      description: `Sisa stok ${item.stok ?? 0} dari minimum ${item.stok_minimum ?? 0}.`,
      tone: item.stok_status === 'habis' ? 'danger' : 'warning',
      href: '/stok',
    }),
  )

  const transactionNotifications: DashboardNotification[] = latestTransactions.map((item) => ({
    id: `transaction-${item.id}`,
    title: `Transaksi ${item.nomor_nota ?? '-'}`,
    description: `${item.kasir_nama ?? 'Kasir'} mencatat transaksi ${Number(
      item.total ?? 0,
    ).toLocaleString('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    })}.`,
    tone: 'info',
    href: '/laporan',
  }))

  const pendingNotifications: DashboardNotification[] = (pendingTransactionsResult.data ?? []).map(
    (item) => ({
      id: `pending-${item.id}`,
      title: `Pending ${item.nomor_nota ?? '-'}`,
      description: `${item.metode_bayar?.toUpperCase() ?? 'NON TUNAI'} senilai ${Number(
        item.total ?? 0,
      ).toLocaleString('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      })} belum dikonfirmasi.`,
      tone: 'warning',
      href: '/pos',
    }),
  )

  return [...pendingNotifications, ...lowStockNotifications, ...transactionNotifications]
}

export async function getSalesReport(
  dateFrom: string,
  dateTo: string,
  groupBy: 'day' | 'week' | 'month' = 'day',
): Promise<SalesReport[]> {
  void groupBy

  const fromIso = getISOStartOfDay(dateFrom)
  const toIso = getISOEndOfDay(dateTo)

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('status', 'selesai')
    .eq('payment_status', 'dibayar')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const reportMap = new Map<string, SalesReport>()

  for (const transaction of data ?? []) {
    const key = formatLocalDateKey(transaction.created_at)

    if (!key) continue

    if (!reportMap.has(key)) {
      reportMap.set(key, {
        tanggal: key,
        totalPenjualan: 0,
        jumlahTransaksi: 0,
      })
    }

    const current = reportMap.get(key)

    if (current) {
      current.totalPenjualan += Number(transaction.total ?? 0)
      current.jumlahTransaksi += 1
      reportMap.set(key, current)
    }
  }

  return [...reportMap.values()]
}

export async function getTopProducts(
  dateFrom: string,
  dateTo: string,
  limit = 10,
): Promise<TopProduct[]> {
  const { data, error } = await supabase.rpc('get_top_products', {
    p_date_from: getISOStartOfDay(dateFrom),
    p_date_to: getISOEndOfDay(dateTo),
    p_limit: limit,
  })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((item) => ({
    productId: item.product_id as number,
    nama: (item.nama_produk as string) ?? 'Produk',
    totalQty: Number(item.total_qty ?? 0),
    totalPenjualan: Number(item.total_penjualan ?? 0),
  }))
}

export async function getSalesByCategory(dateFrom: string, dateTo: string) {
  const topProducts = await getTopProducts(dateFrom, dateTo, 100)

  if (topProducts.length === 0) {
    return []
  }

  const { data: products, error } = await supabase
    .from('products_with_category')
    .select('id, category_nama')
    .in(
      'id',
      topProducts.map((item) => item.productId),
    )

  if (error) {
    throw new Error(error.message)
  }

  const categoryLookup = new Map<number, string>()

  for (const product of products ?? []) {
    if (product.id) {
      categoryLookup.set(product.id, product.category_nama ?? 'Tanpa kategori')
    }
  }

  const categoryMap = new Map<string, number>()

  for (const product of topProducts) {
    const categoryName = categoryLookup.get(product.productId) ?? 'Tanpa kategori'
    const currentTotal = categoryMap.get(categoryName) ?? 0
    categoryMap.set(categoryName, currentTotal + product.totalPenjualan)
  }

  return [...categoryMap.entries()].map(([category, total]) => ({
    category,
    total,
  }))
}

export async function getLatestTransactions(limit = 5, paymentStatus?: PaymentStatus): Promise<TransactionWithKasir[]> {
  let query = supabase
    .from('transactions_with_kasir')
    .select('*')
    .eq('status', 'selesai')

  if (paymentStatus) {
    query = query.eq('payment_status', paymentStatus)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getSalesTrend(days = 7): Promise<SalesReport[]> {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - (days - 1))

  const report = await getSalesReport(formatISO(startOfDay(from)), formatISO(endOfDay(to)))
  const reportMap = new Map(report.map((item) => [item.tanggal, item]))
  const filledReport: SalesReport[] = []

  for (let index = 0; index < days; index += 1) {
    const currentDate = addDays(startOfDay(from), index)
    const key = format(currentDate, 'yyyy-MM-dd')
    const currentItem = reportMap.get(key)

    filledReport.push({
      tanggal: key,
      totalPenjualan: currentItem?.totalPenjualan ?? 0,
      jumlahTransaksi: currentItem?.jumlahTransaksi ?? 0,
    })
  }

  return filledReport
}

export interface ReportSummary {
  totalPenjualan: number
  jumlahTransaksi: number
  rataRataTransaksi: number
  produkTerlaris: TopProduct | null
  jumlahPending: number
  totalHpp: number
  totalLabaKotor: number
  marginPersen: number
}

export interface TransactionHistoryFilters {
  page?: number
  pageSize?: number
  dateFrom?: string
  dateTo?: string
  metodeBayar?: 'all' | MetodeBayar
  paymentStatus?: 'all' | PaymentStatus
  search?: string
}

export interface TransactionHistoryPage {
  data: TransactionWithKasir[]
  count: number
}

export async function getSalesByDateRange(
  dateFrom: string,
  dateTo: string,
): Promise<SalesReport[]> {
  const { data, error } = await supabase.rpc('get_sales_by_date', {
    date_from: getISOStartOfDay(dateFrom),
    date_to: getISOEndOfDay(dateTo),
  })

  if (error) {
    throw new Error(error.message)
  }

  const totalDays = Math.max(
    1,
    differenceInCalendarDays(new Date(dateTo), new Date(dateFrom)) + 1,
  )
  const dataMap = new Map(
    (data ?? []).map((item) => [
      item.tanggal,
      {
        tanggal: item.tanggal,
        totalPenjualan: Number(item.total_penjualan ?? 0),
        jumlahTransaksi: Number(item.jumlah_transaksi ?? 0),
      },
    ]),
  )

  const result: SalesReport[] = []

  for (let index = 0; index < totalDays; index += 1) {
    const currentDate = addDays(new Date(dateFrom), index)
    const key = format(currentDate, 'yyyy-MM-dd')
    result.push(
      dataMap.get(key) ?? {
        tanggal: key,
        totalPenjualan: 0,
        jumlahTransaksi: 0,
      },
    )
  }

  return result
}

export async function getReportSummary(
  dateFrom: string,
  dateTo: string,
): Promise<ReportSummary> {
  const fromIso = getISOStartOfDay(dateFrom)
  const toIso = getISOEndOfDay(dateTo)

  const [sales, topProducts, profitData] = await Promise.all([
    getSalesReport(fromIso, toIso),
    getTopProducts(fromIso, toIso, 1),
    getProfitSummary(dateFrom, dateTo),
  ])

  const { count: pendingCount, error: pendingError } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'selesai')
    .eq('payment_status', 'menunggu_konfirmasi')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)

  if (pendingError) {
    throw new Error(pendingError.message)
  }

  const totalPenjualan = sales.reduce((sum, item) => sum + item.totalPenjualan, 0)
  const jumlahTransaksi = sales.reduce((sum, item) => sum + item.jumlahTransaksi, 0)
  const totalHpp = profitData.reduce((sum, item) => sum + item.totalHpp, 0)
  const totalLabaKotor = profitData.reduce((sum, item) => sum + item.totalLaba, 0)
  const marginPersen = totalPenjualan > 0 ? (totalLabaKotor / totalPenjualan) * 100 : 0

  return {
    totalPenjualan,
    jumlahTransaksi,
    rataRataTransaksi: jumlahTransaksi > 0 ? totalPenjualan / jumlahTransaksi : 0,
    produkTerlaris: topProducts[0] ?? null,
    jumlahPending: pendingCount ?? 0,
    totalHpp,
    totalLabaKotor,
    marginPersen,
  }
}

export async function getTransactionHistoryPage(
  filters: TransactionHistoryFilters = {},
): Promise<TransactionHistoryPage> {
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 10
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase
    .from('transactions_with_kasir')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (filters.dateFrom) {
    query = query.gte('created_at', getISOStartOfDay(filters.dateFrom))
  }

  if (filters.dateTo) {
    query = query.lte('created_at', getISOEndOfDay(filters.dateTo))
  }

  if (filters.metodeBayar && filters.metodeBayar !== 'all') {
    query = query.eq('metode_bayar', filters.metodeBayar)
  }

  if (filters.paymentStatus && filters.paymentStatus !== 'all') {
    query = query.eq('payment_status', filters.paymentStatus)
  }

  if (filters.search) {
    query = query.or(
      `nomor_nota.ilike.%${filters.search}%,kasir_nama.ilike.%${filters.search}%`,
    )
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

export async function getProfitSummary(
  dateFrom: string,
  dateTo: string,
): Promise<ProfitSummaryItem[]> {
  const { data, error } = await supabase.rpc('get_profit_summary', {
    p_date_from: getISOStartOfDay(dateFrom),
    p_date_to: getISOEndOfDay(dateTo),
  })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((item) => {
    const omzet = Number(item.total_omzet ?? 0)
    const laba = Number(item.total_laba ?? 0)

    return {
      tanggal: item.tanggal,
      totalOmzet: omzet,
      totalHpp: Number(item.total_hpp ?? 0),
      totalLaba: laba,
      marginPersen: omzet > 0 ? (laba / omzet) * 100 : 0,
      jumlahTransaksi: Number(item.jumlah_transaksi ?? 0),
    }
  })
}
