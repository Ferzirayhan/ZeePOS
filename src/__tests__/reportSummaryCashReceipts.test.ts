import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Task 12.5 sisi API (klausa 2.14, Property 23).
 *
 * `get_cash_receipts_summary` (migrasi 067) sudah hidup di target tetapi belum
 * punya satu pun pemanggil. Uji ini mengikat kontraknya: `getReportSummary`
 * menambah `omzetAkrual`, `kasDiterima`, `piutangBaru`; `totalPenjualan`
 * dipertahankan dan identik dengan `omzetAkrual`; dan penolakan admin (`P0001`)
 * mendegradasi tiga angka itu tanpa menjatuhkan pemuatan laporan.
 */

type RpcCall = { fn: string; args: Record<string, string> }

const rpcCalls: RpcCall[] = []
const rpcHandlers = new Map<string, () => Promise<{ data: unknown; error: unknown }>>()

const transactionRows = [
  { created_at: '2024-03-01T03:00:00.000Z', total: 20_000 },
  { created_at: '2024-03-01T09:00:00.000Z', total: 10_000 },
]

function createTableChain(table: string) {
  const chain: Record<string, unknown> = {}

  for (const key of ['select', 'eq', 'in', 'limit', 'gte', 'lt', 'or', 'range']) {
    chain[key] = () => chain
  }

  chain.order = () =>
    Promise.resolve({
      data: table === 'transactions' ? transactionRows : [],
      error: null,
      count: 0,
    })
  chain.then = (
    resolve: (value: { data: unknown; error: unknown; count: number }) => unknown,
  ) => resolve({ data: [], error: null, count: 2 })

  return chain
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => createTableChain(table),
    rpc: (fn: string, args: Record<string, string>) => {
      rpcCalls.push({ fn, args: args ?? {} })
      const handler = rpcHandlers.get(fn)

      return handler ? handler() : Promise.resolve({ data: [], error: null })
    },
  },
}))

import { getReportSummary } from '../api/reports'

const CASH_ROW = {
  omzet_akrual: 30_000,
  kas_dari_penjualan: 5_000,
  kas_dari_cicilan: 0,
  refund_kas: 45_000,
  kas_diterima: -40_000,
  piutang_baru: 25_000,
}

describe('getReportSummary — omzet akrual vs kas diterima', () => {
  beforeEach(() => {
    rpcCalls.length = 0
    rpcHandlers.clear()
  })

  it('memanggil get_cash_receipts_summary dengan batas atas eksklusif', async () => {
    rpcHandlers.set('get_cash_receipts_summary', () =>
      Promise.resolve({ data: [CASH_ROW], error: null }),
    )

    await getReportSummary('2024-03-01', '2024-03-01')

    const call = rpcCalls.find((entry) => entry.fn === 'get_cash_receipts_summary')

    expect(call).toBeDefined()
    expect(call?.args.p_date_from).toBe('2024-03-01T00:00:00+07:00')
    expect(call?.args.p_date_to).toBe('2024-03-02T00:00:00+07:00')
  })

  it('memetakan angka kas apa adanya, termasuk kas_diterima negatif', async () => {
    rpcHandlers.set('get_cash_receipts_summary', () =>
      Promise.resolve({ data: [CASH_ROW], error: null }),
    )

    const summary = await getReportSummary('2024-03-01', '2024-03-01')

    expect(summary.omzetAkrual).toBe(30_000)
    // Refund melebihi penerimaan pada jendela ini: nilai negatif TIDAK diklem.
    expect(summary.kasDiterima).toBe(-40_000)
    expect(summary.piutangBaru).toBe(25_000)
  })

  it('mempertahankan totalPenjualan dan menjaganya identik dengan omzetAkrual', async () => {
    rpcHandlers.set('get_cash_receipts_summary', () =>
      Promise.resolve({ data: [CASH_ROW], error: null }),
    )

    const summary = await getReportSummary('2024-03-01', '2024-03-01')

    expect(summary.totalPenjualan).toBe(30_000)
    expect(summary.totalPenjualan).toBe(summary.omzetAkrual)
    expect(summary.jumlahTransaksi).toBe(2)
    expect(summary.rataRataTransaksi).toBe(15_000)
  })

  it('menerima bentuk baris tunggal (bukan array) dari PostgREST', async () => {
    rpcHandlers.set('get_cash_receipts_summary', () =>
      Promise.resolve({ data: CASH_ROW, error: null }),
    )

    const summary = await getReportSummary('2024-03-01', '2024-03-01')

    expect(summary.kasDiterima).toBe(-40_000)
  })

  it('mendegradasi dimensi kas ketika RPC menolak sesi non-admin', async () => {
    rpcHandlers.set('get_cash_receipts_summary', () =>
      Promise.resolve({
        data: null,
        error: { code: 'P0001', message: 'Ringkasan kas hanya dapat diakses admin' },
      }),
    )

    const summary = await getReportSummary('2024-03-01', '2024-03-01')

    // Laporan tetap dimuat: angka akrual jatuh kembali ke agregasi klien.
    expect(summary.totalPenjualan).toBe(30_000)
    expect(summary.omzetAkrual).toBe(30_000)
    expect(summary.kasDiterima).toBe(0)
    expect(summary.piutangBaru).toBe(0)
    expect(summary.jumlahTransaksi).toBe(2)
  })

  it('mendegradasi ketika RPC mengembalikan nol baris', async () => {
    rpcHandlers.set('get_cash_receipts_summary', () =>
      Promise.resolve({ data: [], error: null }),
    )

    const summary = await getReportSummary('2024-03-01', '2024-03-01')

    expect(summary.omzetAkrual).toBe(30_000)
    expect(summary.kasDiterima).toBe(0)
    expect(summary.piutangBaru).toBe(0)
  })
})
