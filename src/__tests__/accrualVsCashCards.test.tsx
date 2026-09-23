/**
 * Kartu "Omzet (akrual)" vs "Kas diterima" di Laporan dan Dashboard
 * (task 12.5, design E.3).
 *
 * `create_transaction_atomic` menulis penjualan hutang dengan
 * `payment_status = 'dibayar'` dan `paid_at = NOW()` walaupun piutangnya masih
 * `belum_lunas`. Akibatnya satu angka "Total Penjualan" membuat hutang yang
 * belum tertagih terbaca sebagai uang yang sudah masuk laci. Pada data live,
 * satu rentang menghasilkan omzet akrual 30.000, kas diterima −40.000, dan
 * piutang baru 25.000 — tiga angka berbeda yang sebelumnya diringkas jadi satu.
 *
 * Yang diuji adalah PERILAKU: kedua kartu hadir, memakai angka dari
 * `getReportSummary`, kas negatif dirender negatif (tidak dijepit ke nol), dan
 * rentang dengan penjualan hutang memperlihatkan dua angka yang BERBEDA.
 *
 * **Validates: Requirements 2.14**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const baseSummary = {
  totalPenjualan: 30000,
  jumlahTransaksi: 2,
  rataRataTransaksi: 15000,
  produkTerlaris: null as null | { productId: number; nama: string; totalQty: number },
  jumlahPending: 0,
  totalHpp: 12000,
  totalLabaKotor: 18000,
  marginPersen: 60,
  omzetAkrual: 30000,
  kasDiterima: -40000,
  piutangBaru: 25000,
}

const state = vi.hoisted(() => ({
  summary: {} as Record<string, unknown>,
}))

vi.mock('../lib/supabase', () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  }

  return {
    supabase: {
      from: vi.fn(),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      auth: {
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
    },
  }
})

vi.mock('../api/reports', () => ({
  getReportSummary: vi.fn(async () => state.summary),
  getSalesByDateRange: vi.fn(async () => []),
  getProfitSummary: vi.fn(async () => []),
  getSalesByCategory: vi.fn(async () => []),
  getTransactionHistoryPage: vi.fn(async () => ({ data: [], count: 0 })),
  getDashboardStats: vi.fn(async () => ({
    totalPenjualanHariIni: 30000,
    jumlahTransaksiHariIni: 2,
    jumlahProdukStokMenipis: 0,
    produkTerlarisHariIni: null,
  })),
  getDashboardChangeSummary: vi.fn(async () => null),
  getDashboardNotifications: vi.fn(async () => []),
  getLatestTransactions: vi.fn(async () => []),
}))

vi.mock('../api/transactions', () => ({
  getTransactionById: vi.fn(async () => ({ transaction: { id: 1 }, items: [] })),
  refundTransaction: vi.fn(),
}))

vi.mock('../api/cashShift', () => ({
  getActiveCashShift: vi.fn(async () => null),
}))

const { ReportsPage } = await import('../pages/ReportsPage')
const { DashboardPage } = await import('../pages/DashboardPage')

/**
 * Isi kartu yang memuat `label`. NBSP dari Intl dinormalkan supaya asersi bisa
 * ditulis dengan spasi biasa.
 */
function cardText(label: string) {
  const card = screen.getByText(label).closest('div, article')
  expect(card).toBeTruthy()
  return (card?.textContent ?? '').replace(/\u00a0/g, ' ')
}

function setSummary(overrides: Partial<typeof baseSummary>) {
  state.summary = { ...baseSummary, ...overrides }
}

beforeEach(() => {
  state.summary = { ...baseSummary }
  useAuthStore.setState({ isAdmin: true })
})

describe('ReportsPage — kartu akrual vs kas (task 12.5)', () => {
  it('merender kedua kartu dengan angka dari getReportSummary', async () => {
    setSummary({ kasDiterima: 5000 })
    render(<ReportsPage />)

    await waitFor(() => expect(cardText('Omzet (akrual)')).toContain('Rp 30.000'))
    expect(cardText('Kas diterima')).toContain('Rp 5.000')
  })

  it('mempertahankan kartu Total Penjualan agar pemanggil lama tidak regresi', async () => {
    render(<ReportsPage />)

    await waitFor(() => expect(cardText('Total Penjualan')).toContain('Rp 30.000'))
  })

  it('merender kas diterima negatif sebagai negatif, tanpa dijepit ke nol', async () => {
    render(<ReportsPage />)

    await waitFor(() => expect(cardText('Kas diterima')).toContain('-Rp 40.000'))
    // Bukan 40.000 positif, dan tidak disembunyikan sebagai nol.
    expect(cardText('Kas diterima')).not.toMatch(/(^|[^-])Rp 40\.000/)
    expect(cardText('Kas diterima')).not.toContain('Rp 0')
  })

  it('menampilkan dua angka BERBEDA untuk rentang dengan penjualan hutang', async () => {
    // Omzet akrual 30.000 tetapi hanya 5.000 yang benar-benar masuk laci karena
    // 25.000 di antaranya penjualan hutang yang belum tertagih.
    setSummary({ omzetAkrual: 30000, kasDiterima: 5000, piutangBaru: 25000 })
    render(<ReportsPage />)

    await waitFor(() => expect(cardText('Omzet (akrual)')).toContain('Rp 30.000'))
    expect(cardText('Kas diterima')).toContain('Rp 5.000')
    expect(cardText('Kas diterima')).not.toContain('Rp 30.000')
  })

  it('menjelaskan bahwa penjualan hutang belum termasuk kas', async () => {
    render(<ReportsPage />)

    await waitFor(() =>
      expect(cardText('Kas diterima')).toContain('penjualan hutang belum termasuk kas'),
    )
  })
})

describe('DashboardPage — kartu akrual vs kas (task 12.5)', () => {
  function renderDashboard() {
    return render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    )
  }

  it('merender kedua kartu untuk angka harian', async () => {
    setSummary({ omzetAkrual: 30000, kasDiterima: 5000, piutangBaru: 25000 })
    renderDashboard()

    await waitFor(() => expect(cardText('Omzet (akrual)')).toContain('Rp 30.000'))
    expect(cardText('Kas diterima')).toContain('Rp 5.000')
    expect(cardText('Kas diterima')).toContain('penjualan hutang belum termasuk kas')
  })

  it('merender kas diterima negatif sebagai negatif', async () => {
    renderDashboard()

    await waitFor(() => expect(cardText('Kas diterima')).toContain('-Rp 40.000'))
  })
})
