/**
 * Field "Tempo hutang (hari)" di `SettingsPage` (task 12.3, design E.1).
 *
 * Migrasi 067 membuat `create_transaction_atomic` membaca setelan
 * `tempo_hutang_hari` untuk mengisi `receivables.jatuh_tempo` = tanggal WIB
 * transaksi + tenor, dengan jepitan server
 * `LEAST(GREATEST(COALESCE(NULLIF(value,'')::INTEGER, 14), 0), 365)`, dan
 * menyemai `'14'` untuk semua tenant. Tanpa field ini pemilik toko tidak punya
 * cara mengubah tenor dari UI sama sekali.
 *
 * Yang diuji adalah PERILAKU, bukan tata letak:
 *  - field merender nilai tersimpan (hasil seed 067);
 *  - perubahan valid dipersistensi lewat `updateSettings` dengan kunci
 *    `tempo_hutang_hari` (nilai TEXT);
 *  - nilai di luar rentang server (negatif, 366, bukan bilangan bulat)
 *    ditolak SEBELUM satu pun panggilan persist — batas UI identik dengan
 *    jepitan server, sehingga UI tidak pernah menerima nilai yang server
 *    diam-diam ubah;
 *  - nilai tersimpan kosong tampil sebagai 14, bukan 0 (mencerminkan `NULLIF`
 *    + `COALESCE(..., 14)` di server).
 *
 * **Validates: Requirements 2.11**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SettingsMap } from '../api/settings'

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
}))

vi.mock('../api/settings', () => ({
  getSettings: vi.fn(async () => ({ ...state.settings })),
  updateSettings: vi.fn(async (data: SettingsMap) =>
    Object.entries(data).map(([key, value]) => ({ key, value })),
  ),
}))

vi.mock('../api/staff', () => ({
  createStaffMember: vi.fn(),
  resetStaffPassword: vi.fn(),
  updateStaffStatus: vi.fn(),
}))

vi.mock('../lib/supabase', () => {
  const order = vi.fn(async () => ({ data: [], error: null }))
  const select = vi.fn(() => ({ order }))
  return {
    supabase: {
      from: vi.fn(() => ({ select })),
      rpc: vi.fn(async () => ({ data: null, error: null })),
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

const { SettingsPage } = await import(
  '../pages/SettingsPage'
)
const { parseTempoHutangHari, DEFAULT_TEMPO_HUTANG_HARI } = await import(
  '../utils/tempoHutang'
)
const { updateSettings } = await import('../api/settings')

const updateSettingsMock = vi.mocked(updateSettings)

async function renderTaxTab() {
  render(<SettingsPage />)

  fireEvent.click(await screen.findByRole('button', { name: 'Pajak & Diskon' }))

  return screen.findByLabelText('Tempo hutang (hari)')
}

beforeEach(() => {
  vi.clearAllMocks()
  state.settings = { ppn_persen: '11', tempo_hutang_hari: '14' }
})

describe('SettingsPage — tempo hutang (hari)', () => {
  it('merender field dengan nilai tersimpan hasil seed migrasi 067', async () => {
    const field = (await renderTaxTab()) as HTMLInputElement

    await waitFor(() => {
      expect(field.value).toBe('14')
    })
  })

  it('mempersistensi perubahan valid lewat updateSettings dengan kunci tempo_hutang_hari', async () => {
    const field = await renderTaxTab()

    await waitFor(() => {
      expect((field as HTMLInputElement).value).toBe('14')
    })

    fireEvent.change(field, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Pengaturan Pajak' }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledTimes(1)
    })

    expect(updateSettingsMock.mock.calls[0]?.[0]).toMatchObject({
      tempo_hutang_hari: '30',
    })
  })

  it('menerima batas rentang server 0 dan 365', async () => {
    const field = await renderTaxTab()

    await waitFor(() => {
      expect((field as HTMLInputElement).value).toBe('14')
    })

    fireEvent.change(field, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Pengaturan Pajak' }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledTimes(1)
    })
    expect(updateSettingsMock.mock.calls[0]?.[0]).toMatchObject({ tempo_hutang_hari: '0' })

    fireEvent.change(field, { target: { value: '365' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Pengaturan Pajak' }))

    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledTimes(2)
    })
    expect(updateSettingsMock.mock.calls[1]?.[0]).toMatchObject({ tempo_hutang_hari: '365' })
  })

  it.each([
    ['negatif', '-1', /tidak boleh negatif/i],
    ['di atas 365', '366', /maksimal 365 hari/i],
    ['bukan bilangan bulat', '14.5', /bilangan bulat/i],
  ])('menolak nilai %s tanpa memanggil updateSettings', async (_label, value, message) => {
    const field = await renderTaxTab()

    await waitFor(() => {
      expect((field as HTMLInputElement).value).toBe('14')
    })

    fireEvent.change(field, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Pengaturan Pajak' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(updateSettingsMock).not.toHaveBeenCalled()
  })

  it('menampilkan 14, bukan 0, saat nilai tersimpan kosong', async () => {
    state.settings = { ppn_persen: '11', tempo_hutang_hari: '' }

    const field = (await renderTaxTab()) as HTMLInputElement

    await waitFor(() => {
      expect(field.value).toBe('14')
    })
  })

  it('menampilkan 14 saat setelan belum ada sama sekali', async () => {
    state.settings = { ppn_persen: '11' }

    const field = (await renderTaxTab()) as HTMLInputElement

    await waitFor(() => {
      expect(field.value).toBe('14')
    })
  })
})

describe('parseTempoHutangHari — jepitan identik dengan server', () => {
  it('mengembalikan default 14 untuk nilai kosong, hilang, dan bukan bilangan bulat', () => {
    expect(parseTempoHutangHari('')).toBe(DEFAULT_TEMPO_HUTANG_HARI)
    expect(parseTempoHutangHari('   ')).toBe(DEFAULT_TEMPO_HUTANG_HARI)
    expect(parseTempoHutangHari(undefined)).toBe(DEFAULT_TEMPO_HUTANG_HARI)
    expect(parseTempoHutangHari(null)).toBe(DEFAULT_TEMPO_HUTANG_HARI)
    expect(parseTempoHutangHari('abc')).toBe(DEFAULT_TEMPO_HUTANG_HARI)
    expect(parseTempoHutangHari('14.5')).toBe(DEFAULT_TEMPO_HUTANG_HARI)
  })

  it('menjepit ke 0..365 seperti LEAST(GREATEST(...), 365) di server', () => {
    expect(parseTempoHutangHari('0')).toBe(0)
    expect(parseTempoHutangHari('-5')).toBe(0)
    expect(parseTempoHutangHari('365')).toBe(365)
    expect(parseTempoHutangHari('400')).toBe(365)
    expect(parseTempoHutangHari('30')).toBe(30)
  })
})
