/**
 * Call site POSPage yang membuang informasi sebelum komponen/builder di
 * bawahnya sempat bekerja (task 11.3, 13.3, dan sisi POSPage dari 10.3).
 *
 * Yang diuji di sini adalah PERILAKU call site, bukan ulang uji komponennya:
 *  - Numpad qty menerima presisi & batas yang diturunkan dari baris keranjang
 *    (design D.3): satuan pecahan memperoleh separator desimal dan batas dari
 *    sisa stok dalam satuan jual, satuan diskret tidak berubah (Property 17).
 *  - `handleThermalPrint` meneruskan pelanggan, catatan, dan nilai 0 pada
 *    Bayar/Kembalian (design F) — tiga data yang sebelumnya hilang di call site.
 *  - Checkout yang melewati batas waktu memunculkan pesan yang dapat
 *    ditindaklanjuti dan memicu probe jaringan ulang (design C.1/C.2).
 *
 * **Validates: Requirements 2.7, 2.9, 2.15, 3.4, 3.13**
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCartStore } from '../stores/cartStore'
import { useToastStore } from '../stores/toastStore'
import type { CartItem } from '../types'

const hooks = vi.hoisted(() => ({
  revalidate: vi.fn(),
}))

const catalog = vi.hoisted(() => ({
  customers: [] as unknown[],
  /**
   * Katalog yang dibaca ulang saat checkout (validasi stok frontend). Tanpa
   * produk yang cocok, `handleProcessPayment` berhenti sebelum `commitTransaction`.
   */
  products: [
    {
      id: 1,
      nama: 'Plastik Kiloan',
      sku: 'SKU-1',
      barcode: null,
      satuan: 'pcs',
      harga_jual: 5000,
      stok: 30,
      stok_minimum: 0,
      stok_status: 'aman',
      diskon_produk_persen: 0,
      foto_url: null,
      category_id: null,
      category_nama: null,
      is_active: true,
      product_group_id: null,
    },
  ] as unknown[],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}))

vi.mock('../hooks/useOnlineStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, revalidate: hooks.revalidate }),
  useOnlineStatus: () => true,
}))

vi.mock('../api/products', () => ({
  getProducts: vi.fn(async () => catalog.products),
  getActiveCategories: vi.fn(async () => []),
  getAllProductDiscountTiersMap: vi.fn(async () => ({})),
  getAllProductVariantsMap: vi.fn(async () => ({})),
  getProductByBarcode: vi.fn(async () => null),
}))

vi.mock('../api/settings', () => ({
  getSettings: vi.fn(async () => ({ nama_toko: 'ZeePOS Store' })),
}))

vi.mock('../api/units', () => ({
  getAllProductUnitsMap: vi.fn(async () => ({})),
  getProductUnitByBarcode: vi.fn(async () => null),
}))

vi.mock('../api/cashShift', () => ({
  getActiveCashShift: vi.fn(async () => ({ id: 1, modal_awal: 100000 })),
  openCashShift: vi.fn(),
  closeCashShift: vi.fn(),
}))

vi.mock('../api/customers', () => ({
  getCustomers: vi.fn(async () => catalog.customers),
  createCustomer: vi.fn(),
}))

vi.mock('../utils/offlineDb', () => ({
  cacheCatalogProducts: vi.fn(async () => undefined),
  getCachedCatalogProducts: vi.fn(async () => []),
}))

vi.mock('../utils/audioFeedback', () => ({
  audioFeedback: {
    playScanBeep: vi.fn(),
    playSuccessChime: vi.fn(),
    playWarningTone: vi.fn(),
  },
}))

// Builder struk tetap yang asli (hanya dibungkus spy) supaya argumen yang
// diteruskan call site diperiksa terhadap kontrak yang sebenarnya dipakai.
vi.mock('../utils/escpos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/escpos')>()
  return {
    ...actual,
    buildReceiptBytes: vi.fn(actual.buildReceiptBytes),
    printToThermal: vi.fn(async () => undefined),
  }
})

vi.mock('../api/transactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/transactions')>()
  return {
    ...actual,
    getPendingTransactions: vi.fn(async () => []),
    commitTransaction: vi.fn(),
    confirmTransactionPayment: vi.fn(),
    cancelPendingTransaction: vi.fn(),
  }
})

const { POSPage } = await import('../pages/POSPage')
const { buildReceiptBytes } = await import('../utils/escpos')
const transactionsApi = await import('../api/transactions')

function makeLine(overrides: Partial<CartItem> = {}): CartItem {
  return {
    product_id: 1,
    sku: 'SKU-1',
    nama_produk: 'Plastik Kiloan',
    harga_satuan: 20000,
    qty: 1,
    subtotal: 20000,
    stok_dasar: 10,
    satuan: 'pcs',
    foto_url: null,
    discount_tiers: [],
    diskon_produk_persen: 0,
    diskon_item_persen: 0,
    rasio: 1,
    ...overrides,
  }
}

function seedCart(items: CartItem[]) {
  useCartStore.getState().restoreCart({ items })
}

/** Nilai yang sedang diketik pada layar numpad. */
function numpadDisplay(): string {
  const label = screen.getByText('Input Nilai')
  const paragraphs = label.parentElement?.querySelectorAll('p') ?? []
  return paragraphs[1]?.textContent ?? ''
}

function openNumpad() {
  fireEvent.click(screen.getByTitle('Buka Tombol Numpad'))
}

/**
 * Tombol pada grid numpad, bukan pilihan cepat: keduanya bisa bernama sama
 * (`1`, `2`, `5`), jadi dipilih berdasarkan tinggi tombol grid (`h-14`).
 */
function pressKey(name: string) {
  const candidates = screen.getAllByRole('button', { name })
  const gridKey = candidates.find((button) => button.className.includes('h-14'))
  fireEvent.click(gridKey ?? candidates[0])
}

/** Tombol checkout desktop (tombol mobile membawa label yang sama). */
function clickCheckout() {
  fireEvent.click(screen.getAllByRole('button', { name: /BAYAR/i })[0])
}

async function renderPOS() {
  const view = render(<POSPage />)
  // Pemuatan katalog awal selesai (loading skeleton hilang) sebelum interaksi.
  await waitFor(() => expect(screen.getByTitle('Buka Tombol Numpad')).toBeTruthy())
  return view
}

beforeEach(() => {
  hooks.revalidate.mockClear()
  vi.mocked(buildReceiptBytes).mockClear()
  vi.mocked(transactionsApi.commitTransaction).mockReset()
  catalog.customers = []
  useCartStore.getState().clearCart()
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  useCartStore.getState().clearCart()
})

describe('POSPage — call site numpad qty (task 11.3)', () => {
  it('baris bersatuan pecahan memperoleh presisi desimal dan batas dari sisa stok', async () => {
    // 2,5 kg di gudang, 1 kg sudah di keranjang → batas baris ini 2,5 kg.
    seedCart([makeLine({ satuan: 'kg', stok_dasar: 2.5, qty: 1 })])
    await renderPOS()
    openNumpad()

    // Separator desimal tersedia: 0,25 kg kini dapat diketik sama sekali.
    expect(screen.getByRole('button', { name: ',' })).toBeTruthy()
    // Pilihan cepat menjadi sadar satuan.
    expect(screen.getByRole('button', { name: '0,25' })).toBeTruthy()

    // Batas BUKAN 9999 lagi: 19 kg melewati sisa stok, digitnya ditolak.
    pressKey('9')
    expect(numpadDisplay()).toBe('1')

    // Nilai di dalam batas tetap dapat dikonfirmasi dengan presisi pecahan.
    pressKey(',')
    pressKey('5')
    expect(numpadDisplay()).toBe('1,5')
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi/i }))

    expect(useCartStore.getState().items[0].qty).toBe(1.5)
  })

  it('menolak konfirmasi qty di atas sisa stok baris, jadi store tidak pernah melihatnya', async () => {
    seedCart([makeLine({ satuan: 'kg', stok_dasar: 2.5, qty: 1 })])
    await renderPOS()
    openNumpad()

    pressKey('C')
    pressKey('3')
    expect(numpadDisplay()).toBe('3')
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi/i }))

    // Qty tidak berubah dan tidak ada toast "Qty Tidak Valid": numpad mencegah
    // input yang pasti ditolak, sementara store tetap penjaga terakhir (3.4).
    expect(useCartStore.getState().items[0].qty).toBe(1)
    expect(
      useToastStore.getState().toasts.some((toast) => toast.title === 'Qty Tidak Valid'),
    ).toBe(false)
  })

  it('baris bersatuan diskret tidak berubah: tanpa separator, pilihan cepat lama', async () => {
    seedCart([makeLine({ satuan: 'pcs', stok_dasar: 8, qty: 1 })])
    await renderPOS()
    openNumpad()

    expect(screen.queryByRole('button', { name: ',' })).toBeNull()
    expect(screen.queryByRole('button', { name: '0,25' })).toBeNull()
    expect(screen.getByRole('button', { name: '100' })).toBeTruthy()

    // Batas tetap diturunkan dari stok (8 pcs), bukan 9999.
    pressKey('9')
    expect(numpadDisplay()).toBe('1')
  })

  it('baris bersatuan jual berasio memakai batas dalam satuan jual, bukan satuan dasar', async () => {
    // 1 dus = 12 pcs, stok dasar 30 pcs → maksimal 2 dus untuk baris ini.
    seedCart([
      makeLine({
        nama_produk: 'Gelas Plastik (dus)',
        satuan: 'dus',
        rasio: 12,
        stok_dasar: 30,
        qty: 1,
        unit_id: 5,
      }),
    ])
    await renderPOS()
    openNumpad()

    pressKey('C')
    pressKey('3')
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi/i }))
    expect(useCartStore.getState().items[0].qty).toBe(1)

    pressKey('C')
    pressKey('2')
    fireEvent.click(screen.getByRole('button', { name: /Konfirmasi/i }))
    expect(useCartStore.getState().items[0].qty).toBe(2)
  })
})

describe('POSPage — handleThermalPrint (task 13.3)', () => {
  async function checkoutAndPrint(committed: Record<string, unknown>) {
    catalog.customers = [
      {
        id: 7,
        tenant_id: 't-1',
        nama: 'Bu Siti',
        telepon: null,
        alamat: null,
        total_hutang: 0,
        catatan: null,
        is_active: true,
      },
    ]
    seedCart([makeLine({ qty: 2, subtotal: 10000, harga_satuan: 5000, stok_dasar: 10 })])
    await renderPOS()

    // Pilih pelanggan lewat dropdown (satu-satunya jalur POSPage mengenal nama).
    fireEvent.click(screen.getByRole('button', { name: /Pelanggan Umum \(Guest\)/i }))
    const customerOption = await screen.findByText('Bu Siti')
    fireEvent.click(customerOption)

    vi.mocked(transactionsApi.commitTransaction).mockResolvedValue(
      committed as never,
    )

    clickCheckout()
    // Uang pas → kembalian 0, kasus yang dulu menghapus baris Kembalian.
    fireEvent.click(await screen.findByRole('button', { name: /Uang Pas/i }))
    fireEvent.click(screen.getByRole('button', { name: /SELESAIKAN PEMBAYARAN/i }))

    const thermalButton = await screen.findByRole('button', { name: /Thermal USB/i })
    fireEvent.click(thermalButton)

    await waitFor(() => expect(vi.mocked(buildReceiptBytes)).toHaveBeenCalled())
    return vi.mocked(buildReceiptBytes).mock.calls[0][0]
  }

  it('meneruskan pelanggan, catatan, dan Bayar/Kembalian bernilai 0', async () => {
    const receiptData = await checkoutAndPrint({
      transaction_id: 91,
      nomor_nota: 'NOTA-20260101-0001',
      payment_status: 'dibayar',
      subtotal: 10000,
      diskon_amount: 0,
      ppn_amount: 0,
      total: 10000,
      kembalian: 0,
      uang_diterima: 10000,
      metode_bayar: 'tunai',
      catatan: 'Meja 4',
      status: 'selesai',
      items: [
        {
          id: 1,
          transaction_id: 91,
          product_id: 1,
          nama_produk: 'Plastik Kiloan',
          harga_satuan: 5000,
          harga_beli: 0,
          qty: 2,
          subtotal: 10000,
          laba_kotor: null,
          diskon_item_persen: 10,
          rasio: 1,
          base_qty: 2,
          nama_satuan: 'dus',
        },
      ],
    })

    expect(receiptData.customer_name).toBe('Bu Siti')
    expect(receiptData.note).toBe('Meja 4')
    // Nilai 0 harus SAMPAI ke builder: inilah tempat ia dulu hilang pertama kali.
    expect(receiptData.change).toBe(0)
    expect(receiptData.cash_received).toBe(10000)
    expect(receiptData.items[0]).toMatchObject({
      name: 'Plastik Kiloan',
      qty: 2,
      unit: 'dus',
      unitPrice: 5000,
      discountPercent: 10,
      lineTotal: 10000,
    })
  })
})

describe('POSPage — checkout melewati batas waktu (task 10.3, sisi POSPage)', () => {
  it('menampilkan pesan yang dapat ditindaklanjuti dan memicu probe jaringan ulang', async () => {
    seedCart([makeLine({ qty: 1, subtotal: 5000, harga_satuan: 5000, stok_dasar: 10 })])
    await renderPOS()

    vi.mocked(transactionsApi.commitTransaction).mockRejectedValue(
      new transactionsApi.CheckoutTimeoutError(),
    )

    clickCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /Uang Pas/i }))
    fireEvent.click(screen.getByRole('button', { name: /SELESAIKAN PEMBAYARAN/i }))

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(
        toasts.some(
          (toast) => toast.description === transactionsApi.CHECKOUT_TIMEOUT_MESSAGE,
        ),
      ).toBe(true)
    })
    // Indikator online tidak menunggu interval probe berikutnya.
    expect(hooks.revalidate).toHaveBeenCalled()
  })

  it('kegagalan biasa tetap memakai pesan galat aslinya', async () => {
    seedCart([makeLine({ qty: 1, subtotal: 5000, harga_satuan: 5000, stok_dasar: 10 })])
    await renderPOS()

    vi.mocked(transactionsApi.commitTransaction).mockRejectedValue(
      new Error('Stok produk tidak mencukupi'),
    )

    clickCheckout()
    fireEvent.click(await screen.findByRole('button', { name: /Uang Pas/i }))
    fireEvent.click(screen.getByRole('button', { name: /SELESAIKAN PEMBAYARAN/i }))

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(
        toasts.some((toast) => toast.description === 'Stok produk tidak mencukupi'),
      ).toBe(true)
    })
  })
})
