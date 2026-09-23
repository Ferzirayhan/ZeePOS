/**
 * FASE 0 — UJI EKSPLORASI KONDISI BUG (spec: zeepos-remaining-bug-fixes, task 1)
 *
 * Property 1: Bug Condition — semua cacat 1.1–1.18 diperbaiki.
 *
 * SEJARAH: pada task 1 seluruh asersi "EXPECTED" di file ini HARUS GAGAL pada
 * kode yang belum diperbaiki — kegagalannya adalah buktinya bahwa cacatnya ada.
 * Setiap kasus dipasangkan dengan asersi "BASELINE" yang mendokumentasikan
 * perilaku sekarang (lolos sebelum perbaikan) supaya counterexample-nya terbaca
 * sebagai nilai, bukan sekadar "gagal".
 *
 * STATUS SEKARANG (2026-09-22, sesudah perbaikan frontend mendarat): asersi
 * "EXPECTED" berbalik menjadi HARUS LOLOS — ia sekarang berfungsi sebagai
 * validator perilaku yang benar dan menjaga perbaikannya dari regresi. Asersi
 * "BASELINE" yang pasangan EXPECTED-nya sudah hijau ikut terbalik secara
 * konstruksi (mendokumentasikan perilaku yang sudah tidak ada lagi), jadi ia
 * dipensiunkan di tempatnya masing-masing dengan komentar yang menunjuk ke
 * `.kiro/specs/zeepos-remaining-bug-fixes/verification-notes.md` bagian
 * "Task 1", tempat nilai counterexample-nya tersimpan permanen.
 *
 * Scoped PBT: cacat di batch ini deterministik, jadi properti dipersempit ke
 * kasus gagal konkret agar reproducible. Domain acak dipakai di task 2.
 *
 * Kasus yang dicakup di sini (yang dapat dieksekusi Vitest): 5, 7, 8, 9, 10,
 * 12, 13. Kasus 1, 2, 3, 4, 6, 11 adalah sisi SQL/storage → task 5 ([USER]).
 *
 * **Validates: Requirements 1.1, 1.7, 1.8, 1.9, 1.10, 1.12, 1.15**
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* ------------------------------------------------------------------ */
/* Mock bersama: klien Supabase dan html5-qrcode                       */
/* ------------------------------------------------------------------ */

const supa = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: () => {} } },
  })),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: supa.rpc,
    from: supa.from,
    auth: {
      getUser: supa.getUser,
      getSession: supa.getSession,
      onAuthStateChange: supa.onAuthStateChange,
    },
  },
}))

const camera = vi.hoisted(() => ({
  instances: 0,
  startCount: 0,
  stopCount: 0,
  reset() {
    this.instances = 0
    this.startCount = 0
    this.stopCount = 0
  },
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor() {
      camera.instances += 1
    }
    start(): Promise<void> {
      camera.startCount += 1
      return Promise.resolve()
    }
    stop(): Promise<void> {
      camera.stopCount += 1
      return Promise.resolve()
    }
  },
}))

import { commitTransaction } from '../api/transactions'
import { getDashboardChangeSummary } from '../api/reports'
import { AuthProvider } from '../components/auth/AuthProvider'
import { PrivateRoute } from '../components/auth/PrivateRoute'
import { NumpadModal } from '../components/pos/NumpadModal'
import { BarcodeScannerModal } from '../components/pos/BarcodeScannerModal'
import { buildReceiptBytes } from '../utils/escpos'
import { getISOExclusiveEndOfDay, getISOStartOfDay } from '../utils/date'

/** Counterexample konkret yang dicatat ke verification-notes.md. */
const observed: Record<string, unknown> = {}

afterEach(() => {
  supa.rpc.mockReset()
  supa.from.mockReset()
  supa.getUser.mockReset()
  supa.getSession.mockReset()
})

/* ------------------------------------------------------------------ */
/* Kasus 5 — refund tanpa pemanggil (isRefundPathBug, klausa 1.1)      */
/* ------------------------------------------------------------------ */

describe('Kasus 5 — jalur refund tidak punya pemanggil (1.1)', () => {
  const srcRoot = join(process.cwd(), 'src')

  // BASELINE DIPENSIUNKAN — 2026-09-22.
  //
  // Asersi yang dihapus: pemindaian rekursif seluruh `src/**/*.{ts,tsx}` di luar
  // `__tests__` untuk string `refund_transaction_atomic`, lalu
  // `expect(callers).toEqual([])` (nol pemanggil). Helper `collectSourceFiles`
  // yang hanya melayani asersi itu ikut dihapus.
  //
  // Alasan: perbaikannya sudah mendarat — `refundTransaction` di
  // `src/api/transactions.ts` kini memanggil RPC-nya, jadi jumlah pemanggil = 1.
  // Baseline ini terbalik *secara konstruksi*: ia mengasersi ketiadaan jalur
  // eksekusi yang justru merupakan isi perbaikan, sehingga kegagalannya adalah
  // bukti sukses, bukan regresi. Yang menjaga perilaku sekarang adalah asersi
  // EXPECTED di bawah.
  //
  // Nilai counterexample teramati (nol berkas pemanggil, sementara RPC migrasi
  // 060 sudah lengkap) tersimpan permanen di
  // `.kiro/specs/zeepos-remaining-bug-fixes/verification-notes.md`,
  // bagian "Task 1" → "Kasus 5 — refund tanpa pemanggil".

  it('EXPECTED: `src/api/transactions.ts` memanggil rpc(\'refund_transaction_atomic\')', () => {
    const api = readFileSync(join(srcRoot, 'api', 'transactions.ts'), 'utf8')
    expect(
      /rpc\(\s*['"]refund_transaction_atomic['"]/.test(api),
      'Tidak ada supabase.rpc(\'refund_transaction_atomic\') di src/api/transactions.ts — RPC server (migrasi 060) tidak punya jalur eksekusi apa pun.',
    ).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Kasus 7 — checkout menggantung (isUnboundedWaitBug, klausa 1.7)     */
/* ------------------------------------------------------------------ */

describe('Kasus 7 — checkout tanpa batas waktu (1.7)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('EXPECTED: percobaan checkout settle dalam batas waktu sehingga blok `finally` berjalan', async () => {
    supa.getUser.mockResolvedValue({ data: { user: { id: 'kasir-1' } }, error: null })
    // Captive portal: koneksi terbuka, respons tidak pernah datang.
    supa.rpc.mockImplementation(() => new Promise(() => {}))

    let finallyRan = false
    let settled: 'resolved' | 'rejected' | 'pending' = 'pending'

    const attempt = (async () => {
      try {
        // Cerminan `POSPage.handleProcessPayment`: satu await ke commitTransaction
        // dibungkus try/finally yang mereset `processingPayment`.
        await commitTransaction({
          items: [
            {
              productId: 1,
              namaProduk: 'Kantong Plastik',
              hargaSatuan: 10000,
              qty: 1,
              subtotal: 10000,
            },
          ],
          subtotal: 10000,
          total: 10000,
          metodeBayar: 'tunai',
        })
        settled = 'resolved'
      } catch {
        settled = 'rejected'
      } finally {
        finallyRan = true
      }
    })()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    observed.case7 = {
      elapsedMs: 60_000,
      finallyRan,
      settled,
      rpcCalls: supa.rpc.mock.calls.length,
    }

    // FALSIFIABLE (design C.2): bila `finallyRan` true di sini, artinya ada
    // deadline yang bekerja dan hipotesis "akarnya deadline, bukan state
    // machine" terbantah → perbarui design.md sebelum klaster C ditulis.
    expect(
      finallyRan,
      `Setelah 60 detik simulasi, blok finally belum berjalan (settled=${settled}). ` +
        'commitTransaction memanggil supabase.rpc tanpa timeout maupun AbortSignal, ' +
        'sehingga processingPayment tidak pernah kembali false.',
    ).toBe(true)

    void attempt
  })
})

/* ------------------------------------------------------------------ */
/* Kasus 8 — sesi valid dilempar ke /login (klausa 1.8)                */
/* ------------------------------------------------------------------ */

describe('Kasus 8 — sesi valid dilempar ke /login (1.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('EXPECTED: pemulihan sesi 12 detik tidak pernah mengarahkan pengguna ke /login', async () => {
    const session = {
      access_token: 'token',
      user: { id: 'kasir-1', email: 'kasir@toko.test' },
    }

    // getSession lambat (3G): resolve pada detik ke-12, sesudah AUTH_TIMEOUT_MS 8 detik.
    supa.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ data: { session }, error: null }), 12_000)
        }),
    )
    supa.from.mockImplementation(() => {
      const result = { data: { id: 'kasir-1', role: 'kasir', tenant_id: 't1' }, error: null }
      const chain: Record<string, unknown> = {}
      for (const key of ['select', 'eq']) {
        chain[key] = () => chain
      }
      chain.maybeSingle = () => Promise.resolve(result)
      return chain
    })

    render(
      createElement(
        AuthProvider,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: ['/pos'] },
          createElement(
            Routes,
            null,
            createElement(Route, {
              path: '/login',
              element: createElement('div', null, 'HALAMAN LOGIN'),
            }),
            createElement(Route, {
              path: '/pos',
              element: createElement(
                PrivateRoute,
                null,
                createElement('div', null, 'HALAMAN POS'),
              ),
            }),
          ),
        ),
      ),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100)
    })

    const loginShown = screen.queryByText('HALAMAN LOGIN') !== null
    observed.case8 = {
      elapsedMs: 8_100,
      getSessionResolvedAtMs: 12_000,
      loginShown,
      loadingScreenShown: screen.queryByText('Menyiapkan sesi aplikasi') !== null,
      posShown: screen.queryByText('HALAMAN POS') !== null,
      rootCause:
        'percabangan timeout (timeout dipakai sebagai bypass render, bukan sebagai error)',
    }

    expect(
      loginShown,
      'Pada detik ke-8,1 AuthProvider sudah merender rute terproteksi walau sesi belum resolve, ' +
        'dan PrivateRoute mengarahkan pengguna bersesi valid ke /login. ' +
        'Akarnya percabangan timeout, bukan nilai timeout: 8000 ms tetap berlaku tetapi ' +
        'kadaluwarsanya harus menjadi layar gagal-muat, bukan izin merender anak.',
    ).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Kasus 9 — presisi numpad (isKasirInputBug, klausa 1.9)              */
/* ------------------------------------------------------------------ */

describe('Kasus 9 — presisi numpad (1.9)', () => {
  // `decimalPlaces` adalah prop yang BELUM ada (design D.1). Dilewatkan lewat
  // cast supaya uji ini sudah mengodekan kontrak akhir tanpa memecah tsc hari ini.
  const Numpad = NumpadModal as unknown as (props: Record<string, unknown>) => ReturnType<
    typeof NumpadModal
  >

  function renderNumpad(initialValue: number, decimalPlaces: number) {
    const onConfirm = vi.fn()
    render(
      createElement(Numpad, {
        isOpen: true,
        onClose: () => {},
        onConfirm,
        title: 'Qty (kg)',
        initialValue,
        decimalPlaces,
        minValue: 0.01,
        maxValue: 3,
      }),
    )
    return { onConfirm }
  }

  function displayText(): string {
    const label = screen.getByText('Input Nilai')
    const paragraphs = label.parentElement?.querySelectorAll('p') ?? []
    return paragraphs[1]?.textContent ?? ''
  }

  // BASELINE DIPENSIUNKAN — 2026-09-22.
  //
  // Asersi yang dihapus: `initialValue = 0.25` pada baris berpresisi 2 desimal,
  // tekan tombol `5`, lalu `expect(displayText()).toBe('0,255')` dan
  // `expect(onConfirm).toHaveBeenCalledWith(0.255)` — yaitu presisi baris
  // terlampaui dan nilainya bocor sampai ke `onConfirm`.
  //
  // Alasan: perbaikannya sudah mendarat — numpad kini menolak digit yang
  // melewati presisi baris, sehingga `0,25` tetap `0,25`. Baseline ini terbalik
  // *secara konstruksi*: ia mengasersi perilaku yang persis dihapus oleh
  // perbaikan, jadi kegagalannya adalah bukti sukses, bukan regresi. Yang
  // menjaga perilaku sekarang adalah asersi EXPECTED di bawah (digit ke-3
  // ditolak) plus EXPECTED tombol separator desimal.
  //
  // Nilai counterexample teramati (tampilan `0,25` → `0,255`, `onConfirm`
  // menerima `0.255`, separator desimal tidak tersedia) tersimpan permanen di
  // `.kiro/specs/zeepos-remaining-bug-fixes/verification-notes.md`,
  // bagian "Task 1" → "Kasus 9 — presisi numpad".

  it('EXPECTED: digit yang melewati presisi baris ditolak (0,25 tetap 0,25)', () => {
    renderNumpad(0.25, 2)
    fireEvent.click(screen.getByRole('button', { name: '5' }))

    expect(
      displayText(),
      `Numpad menerima digit ke-3 pada baris berpresisi 2 desimal: tampilan menjadi "${displayText()}". ` +
        'handleDigit hanya membandingkan Number(next) > maxValue, tidak ada batas jumlah desimal.',
    ).toBe('0,25')
  })

  it('EXPECTED: tombol separator desimal tersedia untuk baris bersatuan pecahan', () => {
    renderNumpad(0.25, 2)
    const separator = screen.queryByRole('button', { name: /^[,.]$/ })

    observed.case9_separatorAda = separator !== null
    expect(
      separator,
      'Tidak ada tombol separator desimal di NumpadModal, sehingga 0,25 / 0,5 / 0,75 kg ' +
        'tidak dapat dinyatakan sama sekali (grid hanya 1-9, C, 0, backspace).',
    ).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* Kasus 10 — kamera scanner restart (isKasirInputBug, klausa 1.10)    */
/* ------------------------------------------------------------------ */

describe('Kasus 10 — kamera scanner restart saat induk re-render (1.10)', () => {
  beforeEach(() => {
    camera.reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('EXPECTED: kamera tidak start ulang ketika induk re-render dengan callback inline baru', async () => {
    // Induk meniru POSPage: callback dibuat ulang setiap render (arrow inline).
    function Parent({ tick }: { tick: number }) {
      return createElement(BarcodeScannerModal, {
        isOpen: true,
        onClose: () => {
          void tick
        },
        onScanSuccess: () => {
          void tick
        },
      })
    }

    const view = render(createElement(Parent, { tick: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    const startAfterMount = camera.startCount

    // Re-render induk (keranjang berubah / toast / event realtime).
    // Dipisah dari advance timer: effect pasif React baru di-flush di akhir
    // `act`, jadi menggabungkan keduanya membuat timer 150 ms milik effect baru
    // tidak pernah terpicu dan restart kamera luput teramati.
    await act(async () => {
      view.rerender(createElement(Parent, { tick: 1 }))
    })
    const stopAfterRerender = camera.stopCount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    observed.case10 = {
      startAfterMount,
      stopAfterRerender,
      startAfterParentRerender: camera.startCount,
      stopCount: camera.stopCount,
      instances: camera.instances,
    }

    // FALSIFIABLE (design D.4): bila start() tetap 1, hipotesis dependency array
    // terbantah dan penyebabnya harus dicari pada Modal yang me-remount anak →
    // perbarui design.md sebelum D.4 ditulis.
    expect(
      camera.startCount,
      `Html5Qrcode.start() dipanggil ${camera.startCount}x (stop() ${camera.stopCount}x, ` +
        `${camera.instances} instance) padahal modal tidak pernah ditutup. ` +
        'useEffect bergantung pada [isOpen, onClose, onScanSuccess] sementara induk ' +
        'meneruskan arrow function inline yang identitasnya baru setiap render.',
    ).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Kasus 12 — ketidakcocokan batas hari (isTimeAndLedgerBug, 1.12)     */
/* ------------------------------------------------------------------ */

describe('Kasus 12 — batas hari dashboard memakai timezone perangkat (1.12)', () => {
  const originalTZ = process.env.TZ
  // 2024-03-01T16:30:00Z = 1 Maret 23:30 WIB, tetapi sudah 2 Maret 00:30 WITA.
  const nearWibMidnight = new Date('2024-03-01T16:30:00.000Z')

  beforeEach(() => {
    process.env.TZ = 'Asia/Makassar'
    vi.useFakeTimers()
    vi.setSystemTime(nearWibMidnight)
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = originalTZ
  })

  it('EXPECTED: rentang "hari ini" dashboard sama dengan batas hari Asia/Jakarta', async () => {
    const tableRanges: Array<{ gte?: string; lt?: string }> = []
    const rpcRanges: Array<{ from?: string; to?: string }> = []

    supa.from.mockImplementation(() => {
      const entry: { gte?: string; lt?: string } = {}
      tableRanges.push(entry)
      const chain: Record<string, unknown> = {}
      for (const key of ['select', 'eq', 'in', 'limit']) {
        chain[key] = () => chain
      }
      chain.gte = (_col: string, value: string) => {
        entry.gte = value
        return chain
      }
      chain.lt = (_col: string, value: string) => {
        entry.lt = value
        return chain
      }
      chain.order = () => Promise.resolve({ data: [], error: null })
      return chain
    })

    supa.rpc.mockImplementation((_fn: string, args: Record<string, string>) => {
      rpcRanges.push({ from: args?.p_date_from, to: args?.p_date_to })
      return Promise.resolve({ data: [], error: null })
    })

    await getDashboardChangeSummary()

    const wibToday = '2024-03-01'
    const expectedFrom = getISOStartOfDay(wibToday) // 2024-03-01T00:00:00+07:00
    const expectedTo = getISOExclusiveEndOfDay(wibToday) // 2024-03-02T00:00:00+07:00

    observed.case12 = {
      deviceTZ: 'Asia/Makassar',
      now: nearWibMidnight.toISOString(),
      expectedFrom,
      expectedTo,
      tableRanges,
      rpcRanges,
    }

    expect(
      tableRanges.map((range) => `${range.gte}..${range.lt}`),
      `Batas hari klien diturunkan dari startOfDay/endOfDay perangkat (WITA), ` +
        `sehingga rentang "hari ini" menjadi ${JSON.stringify(tableRanges)} ` +
        `sedangkan get_dashboard_stats memakai ${expectedFrom}..${expectedTo}.`,
    ).toContain(`${expectedFrom}..${expectedTo}`)
  })
})

/* ------------------------------------------------------------------ */
/* Kasus 13 — struk thermal kehilangan informasi (1.15)                */
/* ------------------------------------------------------------------ */

describe('Kasus 13 — struk thermal kehilangan informasi (1.15)', () => {
  // Nama 40 karakter: melewati 32 kolom kertas 58 mm.
  const longName = 'Kantong Plastik HD Ukuran 17x35 Tebal XL'
  const receipt = {
    invoice: 'INV-0001',
    created_at: '01/03/2024 10:00',
    cashier: 'Kasir Satu',
    customer_name: 'Bu Ratih',
    items: [
      { name: longName, qty: 2, price: 55_000, satuan: 'dus', harga_satuan: 27_500 },
      { name: 'Tali Rafia', qty: 0.5, price: 12_500, satuan: 'kg', harga_satuan: 25_000 },
    ],
    subtotal: 67_500,
    grand_total: 67_500,
    payment_method_label: 'Tunai',
    cash_received: 67_500,
    change: 0,
    note: 'Ambil sore',
  } as unknown as Parameters<typeof buildReceiptBytes>[0]

  const text = new TextDecoder().decode(buildReceiptBytes(receipt, '58mm'))

  // BASELINE DIPENSIUNKAN — 2026-09-22.
  //
  // Asersi yang dihapus, keempatnya merekam kehilangan informasi pada struk
  // 58 mm sebelum perbaikan:
  //   - `expect(text).toMatch(/^ {2}2x/m)`      → qty tanpa satuan
  //   - `expect(text).toMatch(/^ {2}0\.5x/m)`   → qty pecahan titik, tanpa satuan
  //   - `expect(text.includes('Kembalian')).toBe(false)` → baris hilang saat change = 0
  //   - `expect(text).toContain(longName.slice(0, 32))`  → nama dipotong, bukan di-wrap
  //
  // Alasan: perbaikannya sudah mendarat — pembangun struk kini mencetak satuan
  // per baris, desimal bergaya koma, `Kembalian Rp 0` untuk uang pas, dan
  // me-wrap nama yang melewati lebar kertas. Baseline ini terbalik *secara
  // konstruksi*: keempat asersinya adalah negasi dari perbaikan itu sendiri,
  // jadi kegagalannya adalah bukti sukses, bukan regresi. Yang menjaga perilaku
  // sekarang adalah empat asersi EXPECTED di bawah, satu per klausa.
  //
  // Nilai counterexample teramati (petikan struk ter-decode beserta baris
  // `  2x ... Rp 55.000`, `  0.5x ... Rp 12.500`, `adaBarisKembalian: false`,
  // dan nama terpotong `Kantong Plastik HD Ukuran 17x35 `) tersimpan permanen di
  // `.kiro/specs/zeepos-remaining-bug-fixes/verification-notes.md`,
  // bagian "Task 1" → "Kasus 13 — struk thermal kehilangan informasi".

  it('EXPECTED: satuan tiap baris tercetak (2 dus, bukan 2x)', () => {
    expect(
      text,
      `Baris qty tercetak sebagai "${text.match(/^ {2}2x.*$/m)?.[0] ?? ''}" ` +
        '— satuan tidak dicetak sehingga 2 dus dan 2 pcs tidak terbedakan.',
    ).toMatch(/2\s*dus/)
  })

  it('EXPECTED: qty pecahan tercetak beserta satuannya (0,5 kg)', () => {
    expect(
      text,
      `Baris pecahan tercetak sebagai "${text.match(/^ {2}0\.5x.*$/m)?.[0] ?? ''}" ` +
        '— format titik desimal tanpa satuan.',
    ).toMatch(/0[.,]5\s*kg/)
  })

  it('EXPECTED: baris Kembalian tetap tercetak saat kembalian bernilai 0', () => {
    expect(
      text.includes('Kembalian'),
      'Baris Kembalian hilang untuk uang pas karena pemeriksaan truthy ' +
        '`data.change != null && data.change > 0`.',
    ).toBe(true)
  })

  it('EXPECTED: nama produk yang melewati lebar kertas di-wrap, bukan dipotong', () => {
    expect(
      text,
      `Nama produk 40 karakter dicetak sebagai "${
        text.split('\n').find((line) => line.startsWith('Kantong')) ?? ''
      }" — ekornya hilang karena slice(0, width).`,
    ).toContain('Tebal XL')
  })
})

/* ------------------------------------------------------------------ */

describe('Ringkasan counterexample', () => {
  it('mencetak nilai teramati untuk verification-notes.md', () => {
    // Tidak ada asersi: blok ini hanya memindahkan counterexample ke output uji
    // supaya nilainya dapat ditempel ke verification-notes.md.
    process.stdout.write(`\n[counterexample]\n${JSON.stringify(observed, null, 2)}\n`)
    expect(Object.keys(observed).length).toBeGreaterThan(0)
  })
})
