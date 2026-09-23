/**
 * UI refund di halaman Laporan (task 9.2 dan 9.3, design B.2/B.3).
 *
 * `refund_transaction_atomic` sudah ada sejak migrasi 060 dan sudah benar —
 * memulihkan stok, membalik piutang, menulis `transaction_refunds`, menandai
 * transaksi `batal`, semuanya atomik — tetapi task 1 membuktikan ia **nol
 * pemanggil** di `src/`. Uji ini menjaga jalur UI yang menjangkaunya.
 *
 * Yang diuji adalah PERILAKU, bukan tata letak:
 *  - alasan kosong ditolak SEBELUM satu pun panggilan RPC;
 *  - kunci idempotensi bertahan lintas close/reopen modal;
 *  - kunci dirotasi begitu alasan berubah setelah kegagalan (fingerprint server
 *    = sha256({transaction_id, alasan}));
 *  - kunci dibuang HANYA saat sukses;
 *  - transaksi tunai tanpa shift kasir aktif diperingatkan di muka, transaksi
 *    non-tunai tidak.
 *
 * **Validates: Requirements 2.1, 2.2, 3.3**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useToastStore } from '../stores/toastStore'
import { useAuthStore } from '../stores/authStore'
import type { TransactionWithKasirAdmin } from '../types/database'

const state = vi.hoisted(() => ({
  transactions: [] as unknown[],
  activeShift: null as unknown,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}))

vi.mock('../api/reports', () => ({
  getReportSummary: vi.fn(async () => ({
    totalPenjualan: 12500,
    jumlahTransaksi: 1,
    rataRataTransaksi: 12500,
    produkTerlaris: null,
    jumlahPending: 0,
    totalHpp: 9000,
    totalLabaKotor: 3500,
    marginPersen: 28,
    // Pemisahan akrual vs kas (task 12.5): transaksi tunai, jadi kas = omzet.
    omzetAkrual: 12500,
    kasDiterima: 12500,
    piutangBaru: 0,
  })),
  getSalesByDateRange: vi.fn(async () => []),
  getProfitSummary: vi.fn(async () => []),
  getSalesByCategory: vi.fn(async () => []),
  getTransactionHistoryPage: vi.fn(async () => ({
    data: state.transactions,
    count: state.transactions.length,
  })),
}))

vi.mock('../api/transactions', () => ({
  getTransactionById: vi.fn(async () => ({
    transaction: { id: 1 },
    items: [
      {
        id: 10,
        transaction_id: 1,
        product_id: 5,
        nama_produk: 'Kantong Plastik',
        qty: 2,
        subtotal: 12500,
      },
    ],
  })),
  refundTransaction: vi.fn(),
}))

vi.mock('../api/cashShift', () => ({
  getActiveCashShift: vi.fn(async () => state.activeShift),
}))

const { ReportsPage } = await import('../pages/ReportsPage')
const { refundTransaction } = await import('../api/transactions')
const { getTransactionHistoryPage } = await import('../api/reports')

const refundMock = vi.mocked(refundTransaction)

function makeTransaction(
  overrides: Partial<TransactionWithKasirAdmin> = {},
): TransactionWithKasirAdmin {
  return {
    id: 1,
    nomor_nota: 'INV-0001',
    kasir_id: 'kasir-1',
    subtotal: 12500,
    diskon_persen: 0,
    diskon_amount: 0,
    ppn_persen: 0,
    ppn_amount: 0,
    total: 12500,
    metode_bayar: 'tunai',
    uang_diterima: 20000,
    kembalian: 7500,
    catatan: null,
    status: 'selesai',
    payment_status: 'dibayar',
    paid_at: '2026-09-22T03:00:00.000Z',
    confirmed_by: null,
    payment_reference: null,
    created_at: '2026-09-22T03:00:00.000Z',
    kasir_nama: 'Ratih',
    confirmed_by_nama: null,
    jumlah_item: 2,
    laba_kotor: 3500,
    ...overrides,
  }
}

async function renderReports() {
  const view = render(<ReportsPage />)
  await waitFor(() => expect(screen.getAllByText('INV-0001').length).toBeGreaterThan(0))
  return view
}

/** Baris riwayat pertama (tabel desktop) → membuka modal detail. */
async function openDetail() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Detail' })[0])
  await waitFor(() => expect(screen.getByText(/Detail Transaksi INV-0001/)).toBeTruthy())
}

function closeDetail() {
  fireEvent.click(screen.getByRole('button', { name: 'Tutup modal' }))
}

function clickRefund() {
  fireEvent.click(screen.getByRole('button', { name: 'Refund' }))
}

function typeReason(value: string) {
  fireEvent.change(screen.getByLabelText(/Alasan Refund/i), { target: { value } })
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: /Lanjutkan Refund/i }))
}

async function confirmRefund() {
  fireEvent.click(screen.getByRole('button', { name: /Refund Sekarang/i }))
  await waitFor(() => expect(refundMock).toHaveBeenCalled())
}

function toastTitles() {
  return useToastStore.getState().toasts.map((toast) => toast.title)
}

function keyOfCall(index: number) {
  return refundMock.mock.calls[index]?.[0]?.idempotencyKey
}

beforeEach(() => {
  state.transactions = [makeTransaction()]
  state.activeShift = { id: 'shift-1', modal_awal: 100000 }
  refundMock.mockReset()
  refundMock.mockResolvedValue({
    success: true,
    refund_id: 77,
    transaction_id: 1,
    nomor_nota: 'INV-0001',
    status: 'batal',
    total_refund: 12500,
    idempotent: false,
  })
  vi.mocked(getTransactionHistoryPage).mockClear()
  useToastStore.setState({ toasts: [] })
  useAuthStore.setState({ isAdmin: true })
})

describe('ReportsPage — tombol dan form refund (task 9.2)', () => {
  it('tidak menawarkan refund dari baris tabel, hanya dari dalam modal detail', async () => {
    await renderReports()

    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull()

    await openDetail()
    expect(screen.getByRole('button', { name: 'Refund' })).toBeTruthy()
  })

  it('menonaktifkan refund untuk transaksi yang belum lunas', async () => {
    state.transactions = [
      makeTransaction({ payment_status: 'menunggu_konfirmasi', metode_bayar: 'qris' }),
    ]
    await renderReports()
    await openDetail()

    expect(screen.getByRole('button', { name: 'Refund' })).toBeDisabled()
  })

  it('menonaktifkan refund untuk transaksi yang sudah batal', async () => {
    state.transactions = [makeTransaction({ status: 'batal' })]
    await renderReports()
    await openDetail()

    expect(screen.getByRole('button', { name: 'Refund' })).toBeDisabled()
  })

  it('menolak alasan kosong sebelum satu pun panggilan RPC', async () => {
    await renderReports()
    await openDetail()
    clickRefund()

    // Hanya spasi: tetap kosong setelah btrim.
    typeReason('   ')
    submitForm()

    expect(refundMock).not.toHaveBeenCalled()
    // ConfirmDialog bahkan tidak terbuka.
    expect(screen.queryByRole('button', { name: /Refund Sekarang/i })).toBeNull()
    expect(toastTitles()).toContain('Alasan Refund Wajib Diisi')
  })

  it('mengonfirmasi nominal dan nomor nota sebelum mengirim refund', async () => {
    await renderReports()
    await openDetail()
    clickRefund()
    typeReason('Barang rusak')
    submitForm()

    const dialog = screen.getByText(/Konfirmasi Refund/i).closest('[role="dialog"]')
    expect(dialog?.textContent).toContain('INV-0001')
    expect(dialog?.textContent).toContain('12.500')

    await confirmRefund()

    expect(refundMock).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 1, alasan: 'Barang rusak' }),
    )
    await waitFor(() => expect(toastTitles()).toContain('Refund Berhasil'))
  })

  it('meneruskan pesan error server apa adanya', async () => {
    refundMock.mockRejectedValueOnce(
      new Error('Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.'),
    )
    await renderReports()
    await openDetail()
    clickRefund()
    typeReason('Barang rusak')
    submitForm()
    await confirmRefund()

    await waitFor(() => {
      const toast = useToastStore.getState().toasts.find((item) => item.title === 'Refund Gagal')
      expect(toast?.description).toBe(
        'Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.',
      )
    })
  })
})

describe('ReportsPage — syarat shift kasir untuk refund tunai (task 9.2)', () => {
  it('memperingatkan dan tidak membuka form untuk transaksi tunai tanpa shift aktif', async () => {
    state.activeShift = null
    await renderReports()
    await openDetail()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Refund' })).toBeDisabled())
    expect(screen.getByRole('status').textContent).toContain('Shift kasir belum dibuka')

    clickRefund()

    expect(screen.queryByLabelText(/Alasan Refund/i)).toBeNull()
    expect(refundMock).not.toHaveBeenCalled()
  })

  it('membiarkan refund non-tunai berjalan tanpa shift aktif', async () => {
    state.activeShift = null
    state.transactions = [makeTransaction({ id: 2, metode_bayar: 'hutang' })]
    await renderReports()
    await openDetail()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Refund' })).toBeEnabled())
    clickRefund()
    typeReason('Pelanggan mengembalikan barang')
    submitForm()
    await confirmRefund()

    expect(refundMock).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 2, alasan: 'Pelanggan mengembalikan barang' }),
    )
  })
})

describe('ReportsPage — rotasi kunci idempotensi refund (task 9.3)', () => {
  it('mempertahankan kunci lintas close/reopen modal selama refund belum sukses', async () => {
    refundMock.mockRejectedValue(new Error('Jaringan terputus'))
    await renderReports()

    await openDetail()
    clickRefund()
    typeReason('Barang rusak')
    submitForm()
    await confirmRefund()

    const firstKey = keyOfCall(0)
    expect(firstKey).toBeTruthy()

    closeDetail()
    await openDetail()
    clickRefund()

    // Recovery respons hilang: alasan dipulihkan dari ikatan kunci.
    expect(screen.getByLabelText(/Alasan Refund/i)).toHaveValue('Barang rusak')

    submitForm()
    fireEvent.click(screen.getByRole('button', { name: /Refund Sekarang/i }))
    await waitFor(() => expect(refundMock).toHaveBeenCalledTimes(2))

    // Percobaan ulang identik memakai kunci yang sama → server mengembalikan
    // hasil yang sama alih-alih merefund dua kali.
    expect(keyOfCall(1)).toBe(firstKey)
  })

  it('merotasi kunci begitu alasan berubah setelah kegagalan', async () => {
    refundMock.mockRejectedValue(new Error('Jaringan terputus'))
    await renderReports()
    await openDetail()
    clickRefund()
    typeReason('Barang rusak')
    submitForm()
    await confirmRefund()

    const firstKey = keyOfCall(0)

    // Alasan berubah = payload berubah. Tanpa rotasi, server menolak dengan
    // "Kunci idempotensi sudah digunakan untuk transaksi refund berbeda".
    typeReason('Salah input kasir')
    submitForm()
    fireEvent.click(screen.getByRole('button', { name: /Refund Sekarang/i }))
    await waitFor(() => expect(refundMock).toHaveBeenCalledTimes(2))

    expect(refundMock.mock.calls[1]?.[0]?.alasan).toBe('Salah input kasir')
    expect(keyOfCall(1)).not.toBe(firstKey)
  })

  it('tidak merotasi kunci saat alasan diketik ulang sama persis', async () => {
    refundMock.mockRejectedValue(new Error('Jaringan terputus'))
    await renderReports()
    await openDetail()
    clickRefund()
    typeReason('Barang rusak')
    submitForm()
    await confirmRefund()

    const firstKey = keyOfCall(0)

    typeReason('Barang rusak')
    submitForm()
    fireEvent.click(screen.getByRole('button', { name: /Refund Sekarang/i }))
    await waitFor(() => expect(refundMock).toHaveBeenCalledTimes(2))

    expect(keyOfCall(1)).toBe(firstKey)
  })

  it('membuang kunci hanya saat sukses', async () => {
    await renderReports()
    await openDetail()
    clickRefund()
    typeReason('Barang rusak')
    submitForm()
    await confirmRefund()

    const successKey = keyOfCall(0)
    await waitFor(() => expect(toastTitles()).toContain('Refund Berhasil'))

    // Modal ditutup otomatis setelah sukses; buka lagi transaksi yang sama.
    await openDetail()
    clickRefund()

    // Ikatan alasan sudah dibuang bersama kuncinya.
    expect(screen.getByLabelText(/Alasan Refund/i)).toHaveValue('')

    typeReason('Barang rusak')
    submitForm()
    fireEvent.click(screen.getByRole('button', { name: /Refund Sekarang/i }))
    await waitFor(() => expect(refundMock).toHaveBeenCalledTimes(2))

    expect(keyOfCall(1)).not.toBe(successKey)
  })
})

describe('ReportsPage — jalur baca riwayat admin (task 8.11)', () => {
  it('riwayat kosong untuk non-admin dijelaskan sebagai hak akses', async () => {
    useAuthStore.setState({ isAdmin: false })
    state.transactions = []

    render(<ReportsPage />)

    await waitFor(() => expect(screen.getByText('Akses admin diperlukan')).toBeTruthy())
    // Tidak ada round-trip sia-sia ke view yang pasti mengembalikan nol baris.
    expect(getTransactionHistoryPage).not.toHaveBeenCalled()
  })

  it('menampilkan laba kotor dari view admin', async () => {
    await renderReports()
    expect(screen.getAllByText('Rp 3.500').length).toBeGreaterThan(0)
  })
})
