/**
 * Penanda jatuh tempo terlewat di Buku Piutang (task 12.4, design E.1, Property 19).
 *
 * Yang diuji adalah PERILAKU badge, bukan tata letak:
 *  - `jatuh_tempo` sudah lewat dan masih ada sisa hutang → gaya danger + label "Terlewat";
 *  - `jatuh_tempo` di masa depan → gaya netral;
 *  - `jatuh_tempo` sudah lewat tetapi `sisa_hutang = 0` → bukan terlewat (tidak ada
 *    yang perlu ditagih);
 *  - `jatuh_tempo = null` → TIDAK ada badge sama sekali. Gate 3.2 diputuskan
 *    "biarkan NULL": piutang sebelum migrasi 067 memang tidak punya tanggal tempo
 *    dan badge kosong adalah perilaku yang diharapkan. NULL yang dibaca sebagai
 *    terlewat akan menandai seluruh piutang historis sebagai telat.
 *
 * Batas harinya WIB, bukan timezone perangkat: `receivables.jatuh_tempo` dihitung
 * server sebagai tanggal kalender WIB + tenor toko, jadi tablet di luar WIB harus
 * tetap memakai batas WIB. Blok terakhir memasang `process.env.TZ` ke
 * `America/New_York` pada satu momen di mana tanggal lokal (6 Okt) berbeda dari
 * tanggal WIB (7 Okt), dan memastikan piutang jatuh tempo 6 Okt tetap terlewat.
 *
 * **Validates: Requirements 2.11**
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { format } from 'date-fns'
import type { Receivable } from '../types/database'

const state = vi.hoisted(() => ({
  receivables: [] as unknown[],
}))

vi.mock('../api/customers', () => ({
  getCustomers: vi.fn(async () => []),
  createCustomer: vi.fn(),
  getReceivables: vi.fn(async () => state.receivables),
  payReceivable: vi.fn(),
}))

vi.mock('../api/cashShift', () => ({
  getActiveCashShift: vi.fn(async () => ({ id: 1, status: 'terbuka' })),
}))

const { CustomersPage } = await import('../pages/CustomersPage')
const { getWIBToday } = await import('../utils/date')

function makeReceivable(overrides: Partial<Receivable> = {}): Receivable {
  return {
    id: 1,
    tenant_id: 'tenant-1',
    customer_id: 7,
    nomor_nota: 'INV-0001',
    total_tagihan: 100000,
    jumlah_dibayar: 0,
    sisa_hutang: 100000,
    status: 'belum_lunas',
    jatuh_tempo: null,
    catatan: null,
    created_at: '2026-10-01T02:00:00.000Z',
    ...overrides,
  }
}

/** Geser kunci tanggal `yyyy-MM-dd` tanpa menyentuh timezone perangkat. */
function shiftDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

async function renderReceivablesTab(receivables: Receivable[]) {
  state.receivables = receivables
  render(<CustomersPage />)

  const tab = await waitFor(() =>
    screen.getByRole('button', { name: `Buku Piutang / Bon (${receivables.length})` }),
  )
  fireEvent.click(tab)
  await waitFor(() => expect(screen.getByText(receivables[0].nomor_nota)).toBeTruthy())
}

function dueDateBadge(): HTMLElement | null {
  return screen.queryByText(/Jatuh tempo:/)
}

beforeEach(() => {
  state.receivables = []
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('CustomersPage — penanda jatuh tempo terlewat', () => {
  it('memberi gaya danger dan label "Terlewat" saat tempo sudah lewat dan sisa hutang masih ada', async () => {
    const past = shiftDateKey(getWIBToday(), -3)
    await renderReceivablesTab([makeReceivable({ jatuh_tempo: past, sisa_hutang: 100000 })])

    const badge = dueDateBadge()
    expect(badge).not.toBeNull()
    expect(badge?.className).toContain('text-[#dc2626]')
    expect(badge?.className).not.toContain('text-slate-400')
    expect(screen.getByText('Terlewat')).toBeTruthy()
  })

  it('tidak menandai terlewat saat tempo masih di masa depan', async () => {
    const future = shiftDateKey(getWIBToday(), 5)
    await renderReceivablesTab([makeReceivable({ jatuh_tempo: future, sisa_hutang: 100000 })])

    const badge = dueDateBadge()
    expect(badge).not.toBeNull()
    expect(badge?.className).toContain('text-slate-400')
    expect(badge?.className).not.toContain('text-[#dc2626]')
    expect(screen.queryByText('Terlewat')).toBeNull()
  })

  it('tidak menandai terlewat saat tempo lewat tetapi sisa hutang nol', async () => {
    const past = shiftDateKey(getWIBToday(), -10)
    await renderReceivablesTab([
      makeReceivable({
        jatuh_tempo: past,
        jumlah_dibayar: 100000,
        sisa_hutang: 0,
        status: 'lunas',
      }),
    ])

    expect(dueDateBadge()?.className).toContain('text-slate-400')
    expect(screen.queryByText('Terlewat')).toBeNull()
  })

  it('tidak merender badge apa pun saat jatuh_tempo NULL (gate 3.2 "biarkan NULL")', async () => {
    await renderReceivablesTab([makeReceivable({ jatuh_tempo: null, sisa_hutang: 100000 })])

    expect(dueDateBadge()).toBeNull()
    expect(screen.queryByText('Terlewat')).toBeNull()
  })

  it('tidak merender badge saat jatuh_tempo string kosong', async () => {
    await renderReceivablesTab([makeReceivable({ jatuh_tempo: '', sisa_hutang: 100000 })])

    expect(dueDateBadge()).toBeNull()
    expect(screen.queryByText('Terlewat')).toBeNull()
  })
})

describe('CustomersPage — batas terlewat mengikuti WIB, bukan timezone perangkat', () => {
  const originalTZ = process.env.TZ

  /**
   * 2026-10-06T18:00:00Z = 7 Okt 01:00 WIB, tetapi masih 6 Okt 14:00 di New York.
   * Piutang jatuh tempo 6 Okt SUDAH terlewat menurut WIB; implementasi yang
   * memakai tanggal lokal perangkat akan menganggapnya belum jatuh tempo.
   */
  beforeAll(() => {
    process.env.TZ = 'America/New_York'
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-10-06T18:00:00.000Z'))
  })

  afterAll(() => {
    vi.useRealTimers()
    process.env.TZ = originalTZ
  })

  it('memastikan premis uji: tanggal lokal perangkat berbeda dari tanggal WIB', () => {
    expect(format(new Date(), 'yyyy-MM-dd')).toBe('2026-10-06')
    expect(getWIBToday()).toBe('2026-10-07')
  })

  it('menandai terlewat memakai hari ini WIB meski perangkat masih di tanggal sebelumnya', async () => {
    await renderReceivablesTab([
      makeReceivable({ jatuh_tempo: '2026-10-06', sisa_hutang: 100000 }),
    ])

    expect(dueDateBadge()?.className).toContain('text-[#dc2626]')
    expect(screen.getByText('Terlewat')).toBeTruthy()
  })

  it('tidak menandai terlewat untuk piutang yang jatuh tempo hari ini menurut WIB', async () => {
    await renderReceivablesTab([
      makeReceivable({ jatuh_tempo: '2026-10-07', sisa_hutang: 100000 }),
    ])

    expect(dueDateBadge()?.className).toContain('text-slate-400')
    expect(screen.queryByText('Terlewat')).toBeNull()
  })
})
