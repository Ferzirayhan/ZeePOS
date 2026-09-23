import { format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import {
  getDashboardChangeSummary,
  getDashboardNotifications,
  getDashboardStats,
  getLatestTransactions,
  getReportSummary,
  getSalesByCategory,
  getSalesByDateRange,
} from '../api/reports'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { Skeleton } from '../components/ui/Skeleton'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import type {
  DashboardChangeSummary,
  DashboardNotification,
  DashboardStats,
  SalesReport,
} from '../types'
import type { TransactionWithKasir } from '../types/database'
import { cn } from '../utils/cn'

const donutColors = ['#2563eb', '#a86b00', '#b45f36', '#d9dadc']

function formatCompactCurrency(value: number) {
  if (value >= 1_000_000) {
    const amount = value / 1_000_000
    return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}M`
  }

  if (value >= 1_000) {
    const amount = value / 1_000
    return `${Number.isInteger(amount) ? amount : amount.toFixed(1)}K`
  }

  return `${value}`
}

function formatCategoryLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0%'
  }

  return `${Math.round(value)}%`
}

function formatDeltaBadge(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '0%'
  }

  if (value === 0) {
    return '0%'
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function getDeltaTone(value: number | null) {
  if (value === null || value === 0) {
    return {
      background: '#edeef0',
      color: '#6f7b79',
    }
  }

  if (value > 0) {
    return {
      background: '#dff7f2',
      color: '#2563eb',
    }
  }

  return {
    background: '#fff1eb',
    color: '#ba5a2b',
  }
}

function notificationToneClasses(tone: DashboardNotification['tone']) {
  if (tone === 'danger') {
    return 'border-[#ffdad6] bg-[#fff5f3]'
  }

  if (tone === 'warning') {
    return 'border-[#ffddb8] bg-[#fff8ef]'
  }

  return 'border-[#dbeafe] bg-[#eff6ff]'
}

function formatTransactionTime(value: string | null) {
  if (!value) {
    return '-'
  }

  return format(parseISO(value), "HH:mm, 'Hari ini'", { locale: localeId })
}

export function DashboardPage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const user = useAuthStore((state) => state.user)
  const [dateFilter, setDateFilter] = useState<'hari_ini' | 'minggu_ini' | 'bulan_ini' | 'custom'>('hari_ini')
  const [customDateRange, setCustomDateRange] = useState({
    from: format(new Date(), 'yyyy-MM-dd'),
    to: format(new Date(), 'yyyy-MM-dd'),
  })
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [changes, setChanges] = useState<DashboardChangeSummary | null>(null)
  // Pemisahan akrual vs kas untuk rentang yang sedang dipilih (task 12.5,
  // design E.3). Penjualan hutang ditandai `dibayar` + `paid_at` oleh
  // `create_transaction_atomic` walau piutangnya belum lunas, jadi omzet akrual
  // dan kas yang benar-benar masuk laci harus berdiri sebagai dua angka.
  // `kasDiterima` boleh negatif ketika refund pada rentang melebihi penerimaan.
  const [cashSplit, setCashSplit] = useState<{
    omzetAkrual: number
    kasDiterima: number
    piutangBaru: number
  } | null>(null)
  const [salesTrend, setSalesTrend] = useState<SalesReport[]>([])
  const [categorySales, setCategorySales] = useState<Array<{ category: string; total: number }>>([])
  const [latestTransactions, setLatestTransactions] = useState<TransactionWithKasir[]>([])
  const [notifications, setNotifications] = useState<DashboardNotification[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const notificationRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadDashboard(isSilent = false) {
      if (!isSilent && isMounted) {
        setLoading(true)
      }

      try {
        const now = new Date()
        let dateFrom = format(now, 'yyyy-MM-dd')
        let dateTo = format(now, 'yyyy-MM-dd')

        if (dateFilter === 'minggu_ini') {
          dateFrom = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
        } else if (dateFilter === 'bulan_ini') {
          dateFrom = format(startOfMonth(now), 'yyyy-MM-dd')
        } else if (dateFilter === 'custom') {
          dateFrom = customDateRange.from
          dateTo = customDateRange.to
        }

        // Satu panggilan untuk rentang aktif: menyuplai kartu akrual-vs-kas di
        // semua mode filter, dan sekaligus menjadi sumber angka stats untuk
        // rentang selain "hari ini".
        const summaryPromise = getReportSummary(dateFrom, dateTo)

        let statsPromise: Promise<DashboardStats>
        let changesPromise: Promise<DashboardChangeSummary | null>

        if (dateFilter === 'hari_ini') {
          statsPromise = getDashboardStats()
          changesPromise = getDashboardChangeSummary()
        } else {
          statsPromise = Promise.all([
            summaryPromise,
            getDashboardStats()
          ]).then(([res, currentStats]) => ({
            totalPenjualanHariIni: res.totalPenjualan,
            jumlahTransaksiHariIni: res.jumlahTransaksi,
            jumlahProdukStokMenipis: currentStats.jumlahProdukStokMenipis,
            produkTerlarisHariIni: res.produkTerlaris
              ? {
                  productId: res.produkTerlaris.productId,
                  nama: res.produkTerlaris.nama,
                  qty: res.produkTerlaris.totalQty,
                }
              : null,
          }))
          changesPromise = Promise.resolve(null)
        }

        const [
          statsResult,
          changesResult,
          summaryResult,
          trendResult,
          categoryResult,
          latestResult,
          notificationsResult,
        ] = await Promise.all([
          statsPromise,
          changesPromise,
          summaryPromise,
          getSalesByDateRange(dateFrom, dateTo),
          getSalesByCategory(dateFrom, dateTo),
          getLatestTransactions(5),
          getDashboardNotifications(),
        ])

        if (!isMounted) {
          return
        }

        setStats(statsResult)
        setChanges(changesResult)
        setCashSplit({
          omzetAkrual: summaryResult.omzetAkrual,
          kasDiterima: summaryResult.kasDiterima,
          piutangBaru: summaryResult.piutangBaru,
        })
        setSalesTrend(trendResult)
        setCategorySales(categoryResult)
        setLatestTransactions(latestResult)
        setNotifications(notificationsResult)
        setError(null)
      } catch (loadError) {
        if (!isMounted) {
          return
        }

        setError(loadError instanceof Error ? loadError.message : 'Gagal memuat dashboard.')
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadDashboard()

    const intervalId = window.setInterval(() => {
      void loadDashboard(true)
    }, 5 * 60 * 1000)

    const channel = supabase
      .channel('dashboard-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => void loadDashboard(true),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaction_items' },
        () => void loadDashboard(true),
      )
      .subscribe()

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      void supabase.removeChannel(channel)
    }
  }, [dateFilter, customDateRange])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        showNotifications &&
        notificationRef.current &&
        !notificationRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNotifications])

  const averageTransaction = useMemo(() => {
    if (!stats || stats.jumlahTransaksiHariIni === 0) {
      return 0
    }

    return stats.totalPenjualanHariIni / stats.jumlahTransaksiHariIni
  }, [stats])

  const donutData = useMemo(() => {
    const total = categorySales.reduce((sum, item) => sum + item.total, 0)

    if (total === 0) {
      return []
    }

    return categorySales.map((item) => ({
      ...item,
      percent: (item.total / total) * 100,
    }))
  }, [categorySales])

  const summaryCards: Array<{
    title: string
    icon: string
    accent: string
    badge?: string | null
    badgeTone?: { background: string; color: string }
    caption?: ReactNode
    value: ReactNode
  }> = [
    {
      title: 'Total Penjualan',
      icon: 'payments',
      accent: '#66e5d1',
      badge: formatDeltaBadge(changes?.totalPenjualan.percentage ?? null),
      badgeTone: getDeltaTone(changes?.totalPenjualan.percentage ?? null),
      value: stats ? <CurrencyDisplay value={stats.totalPenjualanHariIni} /> : null,
    },
    {
      title: 'Omzet (akrual)',
      icon: 'trending_up',
      accent: '#66e5d1',
      value: cashSplit ? <CurrencyDisplay value={cashSplit.omzetAkrual} /> : null,
      caption: cashSplit ? (
        <>
          Termasuk penjualan hutang <CurrencyDisplay value={cashSplit.piutangBaru} /> yang
          belum tertagih.
        </>
      ) : null,
    },
    {
      title: 'Kas diterima',
      icon: 'account_balance_wallet',
      accent: '#f8c88b',
      value: cashSplit ? (
        <CurrencyDisplay
          value={cashSplit.kasDiterima}
          className={cashSplit.kasDiterima < 0 ? 'text-[#d63f2f]' : undefined}
        />
      ) : null,
      caption:
        'Tunai, QRIS, transfer, dan cicilan dikurangi refund — penjualan hutang belum termasuk kas.',
    },
    {
      title: 'Jumlah Transaksi',
      icon: 'receipt_long',
      accent: '#f8c88b',
      badge: formatDeltaBadge(changes?.jumlahTransaksi.percentage ?? null),
      badgeTone: getDeltaTone(changes?.jumlahTransaksi.percentage ?? null),
      value: stats?.jumlahTransaksiHariIni ?? 0,
    },
    {
      title: 'Produk Terlaris',
      icon: 'inventory_2',
      accent: '#ffd1c0',
      badge: formatDeltaBadge(changes?.produkTerlarisQty.percentage ?? null),
      badgeTone: getDeltaTone(changes?.produkTerlarisQty.percentage ?? null),
      value: stats?.produkTerlarisHariIni ? (
        <div>
          <p className="truncate text-[18px] font-extrabold leading-tight text-[#191c1e]">
            {stats.produkTerlarisHariIni.nama}
          </p>
          <p className="mt-1 text-sm font-semibold text-[#6f7b79]">
            {stats.produkTerlarisHariIni.qty} pcs terjual
          </p>
        </div>
      ) : (
        'Belum ada'
      ),
    },
    {
      title: 'Rata-rata Transaksi',
      icon: 'bar_chart',
      accent: '#d9dadc',
      badge: formatDeltaBadge(changes?.rataRataTransaksi.percentage ?? null),
      badgeTone: getDeltaTone(changes?.rataRataTransaksi.percentage ?? null),
      value: <CurrencyDisplay value={averageTransaction} />,
    },
  ]

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pt-[4.6rem] transition-[margin] duration-200 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="min-h-screen bg-white md:rounded-l-[24px]">
        <header className="hidden border-b border-[#eef1f1] px-4 py-4 sm:px-6 md:flex md:justify-end">
          <div className="flex items-center justify-end gap-3 md:ml-6 md:gap-4">
            <div className="relative" ref={notificationRef}>
              <button
                type="button"
                onClick={() => setShowNotifications((current) => !current)}
                className="relative rounded-full p-2 text-[#52627d] transition hover:bg-[#f1f3f5]"
                aria-label="Buka notifikasi dashboard"
              >
                <span className="material-symbols-outlined">notifications</span>
                {notifications.length > 0 ? (
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#d63f2f]" />
                ) : null}
              </button>

              {showNotifications ? (
                <div className="absolute right-0 top-[calc(100%+12px)] z-30 w-[min(360px,calc(100vw-2rem))] rounded-[20px] border border-[#eef1f1] bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#2563eb]">
                        Notifikasi
                      </p>
                      <p className="mt-1 text-xs font-medium text-[#8b9895]">
                        Ringkasan update toko hari ini.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowNotifications(false)}
                      className="rounded-full p-2 text-[#6f7b79] transition hover:bg-[#f1f3f5]"
                      aria-label="Tutup notifikasi"
                    >
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {notifications.length > 0 ? (
                      notifications.map((item) => (
                        <Link
                          key={item.id}
                          to={item.href ?? '/dashboard'}
                          onClick={() => setShowNotifications(false)}
                          className={cn(
                            'block rounded-[16px] border px-4 py-3 transition hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]',
                            notificationToneClasses(item.tone),
                          )}
                        >
                          <p className="text-sm font-bold text-[#191c1e]">{item.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[#52627d]">
                            {item.description}
                          </p>
                        </Link>
                      ))
                    ) : (
                      <div className="rounded-[16px] bg-[#f8f9fb] px-4 py-6 text-center text-sm font-medium text-[#8b9895]">
                        Belum ada notifikasi baru.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="hidden h-8 w-px bg-[#eef1f1] sm:block" />
            <div className="text-right">
              <p className="text-sm font-bold text-[#191c1e]">{user?.nama ?? 'Admin Toko'}</p>
              <p className="text-[11px] font-medium capitalize text-[#8b9895]">{user?.role ?? 'kasir'}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2563eb] text-white">
              <span className="material-symbols-outlined text-[20px]">account_circle</span>
            </div>
          </div>
        </header>

        <div className="space-y-6 bg-[#f7f9f9] px-4 py-4 sm:px-6 sm:py-6">
          <section className="md:hidden">
            <div className="rounded-[22px] bg-[linear-gradient(135deg,#2563eb_0%,#1d4ed8_100%)] p-4 text-white shadow-[0_16px_32px_rgba(37,99,235,0.22)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/70">
                    Dashboard Hari Ini
                  </p>
                  <h1 className="mt-2 text-[22px] font-extrabold leading-tight tracking-[-0.04em]">
                    Pantau penjualan toko dengan cepat
                  </h1>
                  <p className="mt-2 text-[13px] font-medium leading-5 text-white/80">
                    Ringkasan omzet, transaksi, dan notifikasi stok dalam satu layar mobile.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowNotifications((current) => !current)}
                  className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] bg-white/14 text-white"
                  aria-label="Buka notifikasi dashboard"
                >
                  <span className="material-symbols-outlined">notifications</span>
                  {notifications.length > 0 ? (
                    <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-[#ffb95f]" />
                  ) : null}
                </button>
              </div>

              {showNotifications ? (
                <div
                  className="relative mt-4 rounded-[20px] border border-white/12 bg-white/10 p-3 backdrop-blur"
                  ref={notificationRef}
                >
                  <div className="space-y-2">
                    {notifications.length > 0 ? (
                      notifications.slice(0, 3).map((item) => (
                        <Link
                          key={item.id}
                          to={item.href ?? '/dashboard'}
                          onClick={() => setShowNotifications(false)}
                          className="block rounded-[16px] bg-white/10 px-3 py-3 text-white transition hover:bg-white/14"
                        >
                          <p className="text-sm font-bold">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-white/80">{item.description}</p>
                        </Link>
                      ))
                    ) : (
                      <div className="rounded-[16px] bg-white/10 px-3 py-4 text-center text-sm font-medium text-white/80">
                        Belum ada notifikasi baru.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-[24px] font-extrabold tracking-[-0.04em] text-[#191c1e] lg:text-[26px]">
                Laporan Dashboard
              </h1>
              <p className="mt-1 text-[13px] font-medium text-[#7d8987] lg:text-sm">
                Analisis performa penjualan hari ini secara real-time.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex flex-wrap items-center gap-1 rounded-[14px] bg-white p-1 shadow-[0_4px_14px_rgba(0,0,0,0.03)]">
                <button
                  onClick={() => setDateFilter('hari_ini')}
                  className={cn(
                    'rounded-[10px] px-4 py-2 text-sm transition',
                    dateFilter === 'hari_ini'
                      ? 'bg-[#eff6ff] font-bold text-[#2563eb]'
                      : 'font-semibold text-[#7d8987] hover:bg-[#f8f9fb]',
                  )}
                >
                  Hari Ini
                </button>
                <button
                  onClick={() => setDateFilter('minggu_ini')}
                  className={cn(
                    'rounded-[10px] px-4 py-2 text-sm transition',
                    dateFilter === 'minggu_ini'
                      ? 'bg-[#eff6ff] font-bold text-[#2563eb]'
                      : 'font-semibold text-[#7d8987] hover:bg-[#f8f9fb]',
                  )}
                >
                  Minggu Ini
                </button>
                <button
                  onClick={() => setDateFilter('bulan_ini')}
                  className={cn(
                    'rounded-[10px] px-4 py-2 text-sm transition',
                    dateFilter === 'bulan_ini'
                      ? 'bg-[#eff6ff] font-bold text-[#2563eb]'
                      : 'font-semibold text-[#7d8987] hover:bg-[#f8f9fb]',
                  )}
                >
                  Bulan Ini
                </button>
                <button
                  onClick={() => setDateFilter('custom')}
                  className={cn(
                    'flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm transition',
                    dateFilter === 'custom'
                      ? 'bg-[#eff6ff] font-bold text-[#2563eb]'
                      : 'font-semibold text-[#7d8987] hover:bg-[#f8f9fb]',
                  )}
                >
                  <span>Custom</span>
                  <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                </button>
              </div>

              {dateFilter === 'custom' && (
                <div className="flex items-center gap-2 rounded-[14px] bg-white p-2 shadow-[0_4px_14px_rgba(0,0,0,0.03)]">
                  <input
                    type="date"
                    value={customDateRange.from}
                    onChange={(e) =>
                      setCustomDateRange((prev) => ({ ...prev, from: e.target.value }))
                    }
                    className="rounded-[8px] border border-[#eef1f1] bg-[#f8f9fb] px-3 py-1.5 text-sm font-medium text-[#2e3132] outline-none focus:border-[#2563eb] focus:bg-white"
                  />
                  <span className="text-sm font-medium text-[#7d8987]">s/d</span>
                  <input
                    type="date"
                    value={customDateRange.to}
                    onChange={(e) =>
                      setCustomDateRange((prev) => ({ ...prev, to: e.target.value }))
                    }
                    className="rounded-[8px] border border-[#eef1f1] bg-[#f8f9fb] px-3 py-1.5 text-sm font-medium text-[#2e3132] outline-none focus:border-[#2563eb] focus:bg-white"
                  />
                </div>
              )}
            </div>
          </section>

          {error ? (
            <div className="rounded-[16px] border border-[#ffdad6] bg-[#fff5f3] px-4 py-3 text-sm font-medium text-[#ba1a1a]">
              Gagal memuat dashboard: {error}
            </div>
          ) : null}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <article
                key={card.title}
                className="rounded-[18px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-[10px]"
                    style={{ backgroundColor: `${card.accent}33`, color: '#2563eb' }}
                  >
                    <span className="material-symbols-outlined text-[20px]">{card.icon}</span>
                  </div>
                  {card.badge ? (
                    <span
                      className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                      style={{
                        backgroundColor: card.badgeTone?.background,
                        color: card.badgeTone?.color,
                      }}
                    >
                      {card.badge}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                    {card.title}
                  </p>
                  <div className="mt-1 min-h-[52px] text-[18px] font-extrabold leading-tight text-[#191c1e]">
                    {loading ? <Skeleton className="h-8 w-32 rounded-xl" /> : card.value}
                  </div>
                  {card.caption && !loading ? (
                    <p className="text-[11px] font-medium leading-4 text-[#8b9895]">
                      {card.caption}
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <article className="rounded-[18px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-[#2e3132]">
                  <span className="material-symbols-outlined text-[20px] text-[#2563eb]">
                    bar_chart
                  </span>
                  Penjualan per Hari (Mingguan)
                </h2>
                <div className="flex items-center gap-2 text-xs font-medium text-[#8b9895]">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
                  Revenue
                </div>
              </div>

              <div className="mt-5 h-[250px]">
                {loading ? (
                  <Skeleton className="h-full w-full rounded-[16px]" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesTrend}>
                      <XAxis
                        axisLine={false}
                        dataKey="tanggal"
                        tickFormatter={(value) =>
                          format(parseISO(value), 'EEE', { locale: localeId }).toUpperCase()
                        }
                        tickLine={false}
                        tick={{ fill: '#909a98', fontSize: 11, fontWeight: 700 }}
                      />
                      <YAxis hide />
                      <Tooltip
                        cursor={{ fill: 'rgba(37,99,235,0.05)' }}
                        contentStyle={{
                          border: 'none',
                          borderRadius: 12,
                          boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
                        }}
                        formatter={(value) => [`Rp ${formatCompactCurrency(Number(value ?? 0))}`, '']}
                        labelFormatter={(value) =>
                          format(parseISO(String(value)), 'EEEE, dd MMMM yyyy', {
                            locale: localeId,
                          })
                        }
                      />
                      <Bar dataKey="totalPenjualan" radius={[10, 10, 10, 10]} maxBarSize={44}>
                        {salesTrend.map((item, index) => (
                          <Cell
                            key={item.tanggal}
                            fill={index === salesTrend.length - 1 ? '#2563eb' : '#dbeafe'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </article>

            <article className="rounded-[18px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
              <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-[#2e3132]">
                <span className="material-symbols-outlined text-[20px] text-[#a86b00]">
                  pie_chart
                </span>
                Kategori Produk
              </h2>

              <div className="mt-4 h-[210px]">
                {loading ? (
                  <Skeleton className="h-full w-full rounded-[16px]" />
                ) : donutData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="48%"
                        dataKey="total"
                        innerRadius={52}
                        outerRadius={80}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {donutData.map((entry, index) => (
                          <Cell
                            key={entry.category}
                            fill={donutColors[index % donutColors.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [<CurrencyDisplay key="value" value={Number(value)} />, '']}
                      />
                      <text
                        x="50%"
                        y="45%"
                        textAnchor="middle"
                        className="fill-[#8b9895] text-[11px] font-extrabold uppercase"
                      >
                        Total
                      </text>
                      <text
                        x="50%"
                        y="54%"
                        textAnchor="middle"
                        className="fill-[#191c1e] text-[20px] font-extrabold"
                      >
                        100%
                      </text>
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-[16px] bg-[#f8f9fb] text-sm font-medium text-[#8b9895]">
                    Belum ada penjualan kategori.
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {donutData.length > 0 ? (
                  donutData.map((item, index) => (
                    <div key={item.category} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: donutColors[index % donutColors.length] }}
                        />
                        <span className="font-medium text-[#52627d]">{item.category}</span>
                      </div>
                      <span className="font-bold text-[#2e3132]">
                        {formatCategoryLabel(item.percent)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-[#8b9895]">Data kategori belum tersedia.</div>
                )}
              </div>
            </article>
          </section>

          <section className="rounded-[18px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <div className="flex items-center justify-between border-b border-[#eef1f1] px-5 py-4">
              <h2 className="text-[16px] font-extrabold text-[#2e3132]">Transaksi Terbaru</h2>
              <Link to="/laporan" className="text-sm font-bold text-[#2563eb]">
                Lihat Semua
              </Link>
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full">
                <thead className="bg-[#f7f9f9]">
                  <tr>
                    {['No. Transaksi', 'Waktu', 'Total', 'Metode', 'Kasir', 'Status'].map(
                      (heading) => (
                        <th
                          key={heading}
                          className="px-5 py-4 text-left text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#97a19f]"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index} className="border-t border-[#eef1f1]">
                        {Array.from({ length: 6 }).map((__, cellIndex) => (
                          <td key={cellIndex} className="px-5 py-4">
                            <Skeleton className="h-5 w-full rounded-xl" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : latestTransactions.length > 0 ? (
                    latestTransactions.map((item) => (
                      <tr key={item.id} className="border-t border-[#eef1f1]">
                        <td className="px-5 py-4 text-sm font-extrabold text-[#2563eb]">
                          #{item.nomor_nota ?? '-'}
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-[#6f7b79]">
                          {formatTransactionTime(item.created_at)}
                        </td>
                        <td className="px-5 py-4 text-sm font-bold text-[#2e3132]">
                          <CurrencyDisplay value={Number(item.total ?? 0)} />
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-[#52627d]">
                          {item.metode_bayar?.toUpperCase() ?? '-'}
                        </td>
                        <td className="px-5 py-4 text-sm font-medium text-[#52627d]">
                          {item.kasir_nama ?? '-'}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={cn(
                              'rounded-full px-3 py-1 text-[10px] font-extrabold uppercase',
                              item.payment_status === 'menunggu_konfirmasi'
                                ? 'bg-[#fff8ef] text-[#ba5a2b]'
                                : 'bg-[#dcfce7] text-[#16a34a]',
                            )}
                          >
                            {item.payment_status === 'menunggu_konfirmasi' ? 'Menunggu' : 'Lunas'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-[#eef1f1]">
                      <td
                        colSpan={6}
                        className="px-5 py-10 text-center text-sm font-medium text-[#8b9895]"
                      >
                        Belum ada transaksi terbaru.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 p-4 md:hidden">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 rounded-[18px]" />
                ))
              ) : latestTransactions.length > 0 ? (
                latestTransactions.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-[20px] border border-[#edf2f1] bg-[#fbfcfc] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-extrabold text-[#2563eb]">
                          #{item.nomor_nota ?? '-'}
                        </p>
                        <p className="mt-1 text-xs font-medium text-[#8b9895]">
                          {item.kasir_nama ?? '-'} • {formatTransactionTime(item.created_at)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-3 py-1 text-[10px] font-extrabold uppercase',
                          item.payment_status === 'menunggu_konfirmasi'
                            ? 'bg-[#fff8ef] text-[#ba5a2b]'
                            : 'bg-[#dcfce7] text-[#16a34a]',
                        )}
                      >
                        {item.payment_status === 'menunggu_konfirmasi' ? 'Menunggu' : 'Lunas'}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                          Metode
                        </p>
                        <p className="mt-1 text-sm font-bold text-[#2e3132]">
                          {item.metode_bayar?.toUpperCase() ?? '-'}
                        </p>
                      </div>
                      <CurrencyDisplay
                        className="text-lg font-extrabold text-[#1b1e20]"
                        value={Number(item.total ?? 0)}
                      />
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[18px] bg-[#f8f9fb] px-4 py-8 text-center text-sm font-medium text-[#8b9895]">
                  Belum ada transaksi terbaru.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
