import { format, subDays } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  getProfitSummary,
  getReportSummary,
  getSalesByCategory,
  getSalesByDateRange,
  getTransactionHistoryPage,
} from '../api/reports'
import { getTransactionById } from '../api/transactions'
import { ReceiptPrint } from '../components/pos/ReceiptPrint'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { Modal } from '../components/ui/Modal'
import { Skeleton } from '../components/ui/Skeleton'
import { usePrint } from '../hooks/usePrint'
import { useAuthStore } from '../stores/authStore'
import { useToastStore } from '../stores/toastStore'
import { useUIStore } from '../stores/uiStore'
import type { Transaction, TransactionItem, TransactionWithKasir } from '../types/database'
import { cn } from '../utils/cn'
import { formatRupiah } from '../utils/currency'
import { exportToExcel } from '../utils/export'

type QuickRange = 'today' | '7days' | '30days' | 'custom'

const chartColors = ['#2563eb', '#60a5fa', '#bfdbfe']
const pieColors = ['#2563eb', '#f59e0b', '#10b981', '#94a3b8']

function formatDateInput(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

export function ReportsPage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const user = useAuthStore((state) => state.user)
  const pushToast = useToastStore((state) => state.pushToast)
  const printRef = useRef<HTMLDivElement>(null)
  const [quickRange, setQuickRange] = useState<QuickRange>('7days')
  const [dateFrom, setDateFrom] = useState(formatDateInput(subDays(new Date(), 6)))
  const [dateTo, setDateTo] = useState(formatDateInput(new Date()))
  const [metodeBayar, setMetodeBayar] = useState<'all' | 'tunai' | 'transfer' | 'qris'>('all')
  const [paymentStatus, setPaymentStatus] = useState<'all' | 'dibayar' | 'menunggu_konfirmasi' | 'gagal'>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [summary, setSummary] = useState({
    totalPenjualan: 0,
    jumlahTransaksi: 0,
    rataRataTransaksi: 0,
    produkTerlaris: null as null | { nama: string; totalQty: number },
    jumlahPending: 0,
    totalHpp: 0,
    totalLabaKotor: 0,
    marginPersen: 0,
  })
  const [salesChart, setSalesChart] = useState<Array<{ tanggal: string; totalPenjualan: number; jumlahTransaksi: number }>>([])
  const [profitChart, setProfitChart] = useState<
    Array<{ tanggal: string; totalOmzet: number; totalHpp: number; totalLaba: number; marginPersen: number; jumlahTransaksi: number }>
  >([])
  const [categoryChart, setCategoryChart] = useState<Array<{ category: string; total: number }>>([])
  const [transactions, setTransactions] = useState<TransactionWithKasir[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithKasir | null>(null)
  const [selectedItems, setSelectedItems] = useState<TransactionItem[]>([])

  const handlePrint = usePrint({
    contentRef: printRef,
    documentTitle: selectedTransaction?.nomor_nota ?? 'struk-transaksi',
  })

  const printableTransaction = useMemo<Transaction | null>(() => {
    if (!selectedTransaction?.id || !selectedTransaction.nomor_nota) {
      return null
    }

    return {
      id: selectedTransaction.id,
      nomor_nota: selectedTransaction.nomor_nota,
      kasir_id: selectedTransaction.kasir_id ?? null,
      subtotal: Number(selectedTransaction.subtotal ?? 0),
      diskon_persen: Number(selectedTransaction.diskon_persen ?? 0),
      diskon_amount: Number(selectedTransaction.diskon_amount ?? 0),
      ppn_persen: Number(selectedTransaction.ppn_persen ?? 0),
      ppn_amount: Number(selectedTransaction.ppn_amount ?? 0),
      total: Number(selectedTransaction.total ?? 0),
      metode_bayar: selectedTransaction.metode_bayar ?? 'tunai',
      uang_diterima: selectedTransaction.uang_diterima ?? null,
      kembalian: selectedTransaction.kembalian ?? null,
      catatan: selectedTransaction.catatan ?? null,
      status: selectedTransaction.status ?? 'selesai',
      payment_status: selectedTransaction.payment_status ?? 'dibayar',
      paid_at: selectedTransaction.paid_at ?? null,
      confirmed_by: selectedTransaction.confirmed_by ?? null,
      payment_reference: selectedTransaction.payment_reference ?? null,
      created_at: selectedTransaction.created_at ?? null,
    }
  }, [selectedTransaction])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [search])

  const totalPages = Math.max(1, Math.ceil(totalCount / 10))

  const loadReports = useCallback(async () => {
    setLoading(true)

    try {
      const [summaryResult, salesResult, profitResult, categoryResult, transactionResult] = await Promise.all([
        getReportSummary(dateFrom, dateTo),
        getSalesByDateRange(dateFrom, dateTo),
        getProfitSummary(dateFrom, dateTo),
        getSalesByCategory(`${dateFrom}T00:00:00`, `${dateTo}T23:59:59`),
        getTransactionHistoryPage({
          page,
          pageSize: 10,
          dateFrom,
          dateTo,
          metodeBayar,
          paymentStatus,
          search: debouncedSearch || undefined,
        }),
      ])

      setSummary({
        totalPenjualan: summaryResult.totalPenjualan,
        jumlahTransaksi: summaryResult.jumlahTransaksi,
        rataRataTransaksi: summaryResult.rataRataTransaksi,
        produkTerlaris: summaryResult.produkTerlaris
          ? {
              nama: summaryResult.produkTerlaris.nama,
              totalQty: summaryResult.produkTerlaris.totalQty,
            }
          : null,
        jumlahPending: summaryResult.jumlahPending,
        totalHpp: summaryResult.totalHpp,
        totalLabaKotor: summaryResult.totalLabaKotor,
        marginPersen: summaryResult.marginPersen,
      })
      setSalesChart(salesResult)
      setProfitChart(profitResult)
      setCategoryChart(categoryResult)
      setTransactions(transactionResult.data)
      setTotalCount(transactionResult.count)
    } catch (error) {
      pushToast({
        title: 'Gagal memuat laporan',
        description: error instanceof Error ? error.message : 'Laporan belum berhasil dimuat.',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, debouncedSearch, metodeBayar, page, paymentStatus, pushToast])

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  const pieData = useMemo(() => {
    const total = categoryChart.reduce((sum, item) => sum + item.total, 0)
    return categoryChart.map((item) => ({
      ...item,
      percent: total > 0 ? (item.total / total) * 100 : 0,
    }))
  }, [categoryChart])

  const applyQuickRange = (range: QuickRange) => {
    setQuickRange(range)

    if (range === 'today') {
      const today = formatDateInput(new Date())
      setDateFrom(today)
      setDateTo(today)
      return
    }

    if (range === '7days') {
      setDateFrom(formatDateInput(subDays(new Date(), 6)))
      setDateTo(formatDateInput(new Date()))
      return
    }

    if (range === '30days') {
      setDateFrom(formatDateInput(subDays(new Date(), 29)))
      setDateTo(formatDateInput(new Date()))
    }
  }

  const exportExcel = async () => {
    try {
      const allTransactions = await getTransactionHistoryPage({
        page: 1,
        pageSize: Math.min(totalCount, 5000),
        dateFrom,
        dateTo,
        metodeBayar,
        paymentStatus,
        search: debouncedSearch || undefined,
      })

      const rows = allTransactions.data.map((item) => ({
        'No. Nota': item.nomor_nota ?? '-',
        Kasir: item.kasir_nama ?? '-',
        Total: Number(item.total ?? 0),
        Metode: item.metode_bayar ?? '-',
        Status: item.status ?? '-',
        'Status Pembayaran': item.payment_status ?? '-',
        Waktu: item.created_at ?? '-',
        'Jumlah Item': item.jumlah_item ?? 0,
      }))

      exportToExcel(rows, `laporan-penjualan-${dateFrom}-${dateTo}.xlsx`, 'Laporan Penjualan')

      pushToast({
        title: 'Export berhasil',
        description: 'File Excel laporan penjualan sudah dibuat.',
        variant: 'success',
      })

      if (totalCount > 5000) {
        pushToast({
          title: 'Data dipotong',
          description:
            'Hanya 5.000 transaksi pertama yang diekspor. Gunakan filter tanggal untuk mempersempit data.',
          variant: 'warning',
        })
      }
    } catch (error) {
      pushToast({
        title: 'Export gagal',
        description: error instanceof Error ? error.message : 'File Excel belum berhasil dibuat.',
        variant: 'error',
      })
    }
  }

  const openTransactionDetail = async (transaction: TransactionWithKasir) => {
    setSelectedTransaction(transaction)
    setDetailLoading(true)

    try {
      if (!transaction.id) {
        setSelectedItems([])
        return
      }

      const detail = await getTransactionById(transaction.id)
      setSelectedItems(detail?.items ?? [])
    } catch (error) {
      pushToast({
        title: 'Gagal memuat detail transaksi',
        description:
          error instanceof Error ? error.message : 'Detail transaksi belum berhasil dimuat.',
        variant: 'error',
      })
      setSelectedItems([])
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pt-16 transition-[margin] duration-200 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="min-h-screen bg-white md:rounded-l-[24px]">
        <header className="flex flex-col gap-3 border-b border-[#eef1f1] px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
              Laporan Penjualan
            </h1>
            <p className="mt-1 text-sm font-medium text-[#8b9895]">
              Ringkasan performa penjualan dan transaksi dalam rentang waktu tertentu.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void exportExcel()}
            className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)]"
          >
            Export Excel
          </button>
        </header>

        <div className="space-y-6 bg-[#f7f9f9] px-4 py-4 sm:px-6 sm:py-6">
          <section className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,180px))_minmax(0,1fr)]">
              <div className="min-w-0">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Dari
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    setQuickRange('custom')
                    setDateFrom(event.target.value)
                    setPage(1)
                  }}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                />
              </div>
              <div className="min-w-0">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Sampai
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => {
                    setQuickRange('custom')
                    setDateTo(event.target.value)
                    setPage(1)
                  }}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                />
              </div>

              <div className="min-w-0">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Metode
                </label>
                <select
                  value={metodeBayar}
                  onChange={(event) => {
                    setMetodeBayar(event.target.value as typeof metodeBayar)
                    setPage(1)
                  }}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                >
                  <option value="all">Semua Metode</option>
                  <option value="tunai">Tunai</option>
                  <option value="transfer">Transfer</option>
                  <option value="qris">QRIS</option>
                </select>
              </div>

              <div className="min-w-0">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Status Bayar
                </label>
                <select
                  value={paymentStatus}
                  onChange={(event) => {
                    setPaymentStatus(event.target.value as typeof paymentStatus)
                    setPage(1)
                  }}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                >
                  <option value="all">Semua Status</option>
                  <option value="dibayar">Dibayar</option>
                  <option value="menunggu_konfirmasi">Menunggu Konfirmasi</option>
                  <option value="gagal">Gagal</option>
                </select>
              </div>

              <div className="min-w-0 md:col-span-2 xl:col-span-1">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Cari
                </label>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cari nota atau nama kasir..."
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-medium text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ['today', 'Hari Ini'],
                ['7days', '7 Hari'],
                ['30days', '30 Hari'],
                ['custom', 'Custom'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applyQuickRange(value as QuickRange)}
                  className={quickRange === value
                    ? 'rounded-[14px] bg-[#2563eb] px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_22px_rgba(37,99,235,0.18)]'
                    : 'rounded-[14px] bg-[#eef3f3] px-4 py-2.5 text-sm font-bold text-[#52627d]'}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Total Penjualan', value: <CurrencyDisplay value={summary.totalPenjualan} /> },
              { label: 'Jumlah Transaksi', value: summary.jumlahTransaksi },
              { label: 'Rata-rata Transaksi', value: <CurrencyDisplay value={summary.rataRataTransaksi} /> },
              { label: 'Pending Payment', value: summary.jumlahPending },
              { label: 'Total HPP', value: <CurrencyDisplay value={summary.totalHpp} /> },
              { label: 'Laba Kotor', value: <CurrencyDisplay value={summary.totalLabaKotor} /> },
              { label: 'Margin', value: `${summary.marginPersen.toFixed(1)}%` },
            ].map((card) => (
              <div key={card.label} className="rounded-[18px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  {card.label}
                </p>
                <div className="mt-3 text-[24px] font-extrabold text-[#1b1e20]">
                  {loading ? <Skeleton className="h-8 w-32 rounded-xl" /> : card.value}
                </div>
              </div>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
              <h2 className="text-[18px] font-extrabold text-[#1b1e20]">Grafik Penjualan Harian</h2>
              <div className="mt-5 h-[300px]">
                {loading ? (
                  <Skeleton className="h-full w-full rounded-[16px]" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesChart}>
                      <CartesianGrid vertical={false} stroke="#eef1f1" />
                      <XAxis
                        dataKey="tanggal"
                        tickFormatter={(value) => format(new Date(value), 'dd MMM', { locale: localeId })}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#8b9895', fontSize: 12 }}
                      />
                      <YAxis
                        tickFormatter={(value) => formatRupiah(Number(value)).replace('Rp', '').trim()}
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: '#8b9895', fontSize: 12 }}
                      />
                      <Tooltip
                        formatter={(value) => [formatRupiah(Number(value)), 'Penjualan']}
                        labelFormatter={(value) => format(new Date(String(value)), 'EEEE, dd MMMM yyyy', { locale: localeId })}
                      />
                      <Bar dataKey="totalPenjualan" radius={[10, 10, 0, 0]}>
                        {salesChart.map((entry, index) => (
                          <Cell key={entry.tanggal} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
              <h2 className="text-[18px] font-extrabold text-[#1b1e20]">Penjualan per Kategori</h2>
              <div className="mt-5 h-[230px]">
                {loading ? (
                  <Skeleton className="h-full w-full rounded-[16px]" />
                ) : pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="total" innerRadius={48} outerRadius={76} paddingAngle={2}>
                        {pieData.map((entry, index) => (
                          <Cell key={entry.category} fill={pieColors[index % pieColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [formatRupiah(Number(value)), 'Total']} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[16px] bg-[#f8fbfb] text-sm text-[#8b9895]">
                    Belum ada data kategori.
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {pieData.map((item, index) => (
                  <div key={item.category} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: pieColors[index % pieColors.length] }} />
                      <span className="text-[#52627d]">{item.category}</span>
                    </div>
                    <span className="font-bold text-[#1b1e20]">{item.percent.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <h2 className="text-[18px] font-extrabold text-[#1b1e20]">Laba Kotor Harian</h2>
            <div className="mt-5 h-[300px]">
              {loading ? (
                <Skeleton className="h-full w-full rounded-[16px]" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={profitChart}>
                    <CartesianGrid vertical={false} stroke="#eef1f1" />
                    <XAxis
                      dataKey="tanggal"
                      tickFormatter={(value) => format(new Date(value), 'dd MMM', { locale: localeId })}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: '#8b9895', fontSize: 12 }}
                    />
                    <YAxis
                      tickFormatter={(value) => formatRupiah(Number(value)).replace('Rp', '').trim()}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: '#8b9895', fontSize: 12 }}
                    />
                    <Tooltip
                      formatter={(value, name) => [
                        formatRupiah(Number(value)),
                        name === 'totalLaba' ? 'Laba Kotor' : 'Omzet',
                      ]}
                      labelFormatter={(value) =>
                        format(new Date(String(value)), 'EEEE, dd MMMM yyyy', { locale: localeId })}
                    />
                    <Bar dataKey="totalOmzet" name="totalOmzet" fill="#dbeafe" radius={[10, 10, 0, 0]} />
                    <Bar dataKey="totalLaba" name="totalLaba" fill="#a86b00" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          <section className="rounded-[20px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <div className="border-b border-[#eef1f1] px-5 py-4">
              <h2 className="text-[18px] font-extrabold text-[#1b1e20]">Riwayat Transaksi</h2>
            </div>
            <div className="overflow-x-auto hidden md:block">
              <table className="min-w-full">
                <thead className="bg-[#f7f9f9]">
                  <tr>
                    {['No. Nota', 'Kasir', 'Total', 'Laba', 'Metode', 'Status', 'Waktu', 'Aksi'].map((heading) => (
                      <th key={heading} className="px-5 py-4 text-left text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#97a19f]">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 10 }).map((_, index) => (
                        <tr key={index} className="border-t border-[#eef1f1]">
                          {Array.from({ length: 8 }).map((__, cellIndex) => (
                            <td key={cellIndex} className="px-5 py-4">
                              <Skeleton className="h-6 w-full rounded-xl" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : transactions.map((transaction) => (
                        <tr key={transaction.id} className="border-t border-[#eef1f1]">
                          <td className="px-5 py-4 font-bold text-[#2563eb]">{transaction.nomor_nota ?? '-'}</td>
                          <td className="px-5 py-4 text-sm text-[#52627d]">{transaction.kasir_nama ?? '-'}</td>
                          <td className="px-5 py-4 text-sm font-bold text-[#1b1e20]">
                            {formatRupiah(Number(transaction.total ?? 0))}
                          </td>
                          <td className="px-5 py-4 text-sm font-bold text-[#a86b00]">
                            {formatRupiah(Number(transaction.laba_kotor ?? 0))}
                          </td>
                          <td className="px-5 py-4 text-sm capitalize text-[#52627d]">{transaction.metode_bayar ?? '-'}</td>
                          <td className="px-5 py-4">
                            <span className={transaction.status === 'selesai'
                              ? 'rounded-full bg-[#dcfce7] px-3 py-1 text-[10px] font-extrabold uppercase text-[#16a34a]'
                              : 'rounded-full bg-[#ffdad6] px-3 py-1 text-[10px] font-extrabold uppercase text-[#ba1a1a]'}>
                              {transaction.status ?? '-'}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-sm text-[#8b9895]">
                            {transaction.created_at
                              ? format(new Date(transaction.created_at), 'dd MMM yyyy, HH:mm', { locale: localeId })
                              : '-'}
                          </td>
                          <td className="px-5 py-4">
                            <button
                              type="button"
                              onClick={() => void openTransactionDetail(transaction)}
                              className="rounded-[12px] px-3 py-2 text-sm font-bold text-[#2563eb] hover:bg-[#eff6ff]"
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {!loading ? (
              <div className="space-y-4 p-4 md:hidden">
                {transactions.map((transaction) => (
                  <article key={transaction.id} className="rounded-[18px] border border-[#eef1f1] bg-[#fbfdfd] p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-extrabold text-[#2563eb]">{transaction.nomor_nota ?? '-'}</p>
                        <p className="mt-1 text-xs text-[#8b9895]">{transaction.kasir_nama ?? '-'}</p>
                      </div>
                      <span className={transaction.payment_status === 'dibayar'
                        ? 'rounded-full bg-[#dcfce7] px-3 py-1 text-[10px] font-extrabold uppercase text-[#16a34a]'
                        : transaction.payment_status === 'menunggu_konfirmasi'
                          ? 'rounded-full bg-[#fff5e8] px-3 py-1 text-[10px] font-extrabold uppercase text-[#855300]'
                          : 'rounded-full bg-[#ffdad6] px-3 py-1 text-[10px] font-extrabold uppercase text-[#ba1a1a]'}>
                        {transaction.payment_status?.replaceAll('_', ' ') ?? '-'}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-[#8b9895]">Total</p>
                        <p className="font-bold text-[#1b1e20]">{formatRupiah(Number(transaction.total ?? 0))}</p>
                      </div>
                      <div>
                        <p className="text-[#8b9895]">Metode</p>
                        <p className="font-bold capitalize text-[#1b1e20]">{transaction.metode_bayar ?? '-'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[#8b9895]">Waktu</p>
                        <p className="font-medium text-[#52627d]">
                          {transaction.created_at
                            ? format(new Date(transaction.created_at), 'dd MMM yyyy, HH:mm', { locale: localeId })
                            : '-'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void openTransactionDetail(transaction)}
                      className="mt-4 w-full rounded-[12px] bg-[#eff6ff] px-3 py-2 text-sm font-bold text-[#2563eb]"
                    >
                      Lihat Detail
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-[#eef1f1] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#8b9895]">
                Menampilkan {transactions.length === 0 ? 0 : (page - 1) * 10 + 1}-{Math.min(page * 10, totalCount)} dari {totalCount} transaksi
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="rounded-[12px] bg-[#f1f3f5] px-4 py-2 text-sm font-bold text-[#52627d] disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <span className="rounded-[12px] bg-[#2563eb] px-3 py-2 text-sm font-bold text-white">{page}</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="rounded-[12px] bg-[#f1f3f5] px-4 py-2 text-sm font-bold text-[#52627d] disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={Boolean(selectedTransaction)}
        onClose={() => setSelectedTransaction(null)}
        size="sm"
        title={`Detail Transaksi ${selectedTransaction?.nomor_nota ?? ''}`}
      >
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#8b9895]">Kasir</span>
            <span className="font-bold text-[#1b1e20]">{selectedTransaction?.kasir_nama ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b9895]">Metode</span>
            <span className="font-bold capitalize text-[#1b1e20]">{selectedTransaction?.metode_bayar ?? '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b9895]">Status Pembayaran</span>
            <span className={selectedTransaction?.payment_status === 'dibayar'
              ? 'rounded-full bg-[#dcfce7] px-3 py-1 text-[10px] font-extrabold uppercase text-[#16a34a]'
              : selectedTransaction?.payment_status === 'menunggu_konfirmasi'
                ? 'rounded-full bg-[#fff5e8] px-3 py-1 text-[10px] font-extrabold uppercase text-[#855300]'
                : 'rounded-full bg-[#ffdad6] px-3 py-1 text-[10px] font-extrabold uppercase text-[#ba1a1a]'}>
              {selectedTransaction?.payment_status?.replaceAll('_', ' ') ?? '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b9895]">Jumlah Item</span>
            <span className="font-bold text-[#1b1e20]">{selectedTransaction?.jumlah_item ?? 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#8b9895]">Total</span>
            <span className="font-bold text-[#2563eb]">{formatRupiah(Number(selectedTransaction?.total ?? 0))}</span>
          </div>
          <div className="rounded-[16px] bg-[#f8fbfb] p-4">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Item Transaksi
            </p>
            <div className="mt-3 space-y-2">
              {detailLoading ? (
                <Skeleton className="h-24 rounded-[14px]" />
              ) : selectedItems.length > 0 ? (
                selectedItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm">
                    <span className="text-[#1b1e20]">
                      {item.nama_produk} ({item.qty}x)
                    </span>
                    <span className="font-bold text-[#1b1e20]">
                      {formatRupiah(Number(item.subtotal))}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[#8b9895]">Detail item belum tersedia.</p>
              )}
            </div>
          </div>
          {selectedTransaction?.payment_status === 'dibayar' ? (
            <button
              type="button"
              onClick={() => void handlePrint()}
              className="w-full rounded-[14px] bg-[#2563eb] px-4 py-3 font-bold text-white"
            >
              Cetak Ulang Struk
            </button>
          ) : null}
        </div>
      </Modal>

      <div className="hidden">
        {printableTransaction ? (
          <ReceiptPrint
            ref={printRef}
            cashier={user}
            items={selectedItems}
            settings={{
              header_struk: 'Struk Pembelian',
              footer_struk: 'Terima kasih telah berbelanja',
            }}
            transaction={printableTransaction}
          />
        ) : null}
      </div>
    </main>
  )
}
