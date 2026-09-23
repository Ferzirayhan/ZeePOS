import { afterEach, describe, expect, it, vi } from 'vitest'

// `buildDayRange` murni, tetapi modul reports mengimpor klien Supabase.
vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

import {
  addWIBDays,
  getISOExclusiveEndOfDay,
  getISOStartOfDay,
  getWIBDateKey,
  getWIBToday,
} from '../utils/date'
import { buildDayRange } from '../api/reports'

/**
 * Task 12.1/12.2 (klausa 2.12, Property 21 & 22).
 *
 * Batas hari klien harus identik dengan batas `Asia/Jakarta` yang dipakai RPC
 * server, apa pun timezone perangkat. Counterexample terukur task 1 (`TZ=
 * Asia/Makassar`, jam beku `2024-03-01T16:30:00Z` = 1 Mar 23:30 WIB tetapi sudah
 * 2 Mar 00:30 WITA): klien memakai `2024-03-02T00:00:00+08:00 ..
 * 2024-03-03T00:00:00+07:00` — hari yang salah DAN jendela 25 jam dengan dua
 * offset berbeda.
 */

const ZONES = ['UTC', 'Asia/Jakarta', 'Asia/Makassar', 'America/New_York'] as const
const originalTZ = process.env.TZ

function withTZ<T>(zone: string, run: () => T): T {
  process.env.TZ = zone
  try {
    return run()
  } finally {
    process.env.TZ = originalTZ
  }
}

afterEach(() => {
  process.env.TZ = originalTZ
})

describe('getWIBDateKey', () => {
  it('memberi kunci tanggal yang sama di semua timezone perangkat', () => {
    // 16:30Z = 23:30 WIB, masih 1 Maret di WIB meski sudah 2 Maret di WITA.
    const instant = '2024-03-01T16:30:00.000Z'
    const keys = ZONES.map((zone) => withTZ(zone, () => getWIBDateKey(instant)))

    expect(keys).toEqual(['2024-03-01', '2024-03-01', '2024-03-01', '2024-03-01'])
  })

  it('menempatkan instan tepat sebelum dan sesudah tengah malam WIB pada hari yang benar', () => {
    for (const zone of ZONES) {
      withTZ(zone, () => {
        // 16:59:59Z = 23:59:59 WIB (masih 1 Maret)
        expect(getWIBDateKey('2024-03-01T16:59:59.999Z')).toBe('2024-03-01')
        // 17:00:00Z = 00:00:00 WIB 2 Maret
        expect(getWIBDateKey('2024-03-01T17:00:00.000Z')).toBe('2024-03-02')
      })
    }
  })

  it('menerima objek Date maupun string, dengan hasil identik', () => {
    withTZ('America/New_York', () => {
      const iso = '2024-03-01T20:00:00.000Z'
      expect(getWIBDateKey(new Date(iso))).toBe('2024-03-02')
      expect(getWIBDateKey(iso)).toBe('2024-03-02')
    })
  })

  it('mengembalikan kunci tanggal apa adanya tanpa menggesernya', () => {
    for (const zone of ZONES) {
      withTZ(zone, () => {
        expect(getWIBDateKey('2024-03-01')).toBe('2024-03-01')
        expect(getWIBDateKey('2024-02-29')).toBe('2024-02-29')
      })
    }
  })

  it('memperlakukan timestamp tanpa penanda zona sebagai WIB', () => {
    withTZ('America/New_York', () => {
      expect(getWIBDateKey('2024-03-01T00:30:00')).toBe('2024-03-01')
    })
  })

  it('mengembalikan string kosong untuk masukan kosong maupun tidak valid', () => {
    expect(getWIBDateKey('')).toBe('')
    expect(getWIBDateKey(null)).toBe('')
    // `undefined` memakai nilai default (sekarang), bukan string kosong.
    expect(getWIBDateKey(undefined)).toBe(getWIBToday())
    expect(getWIBDateKey('not-a-date')).toBe('')
    expect(getWIBDateKey('2024-02-30')).toBe('')
    expect(getWIBDateKey('2024-13-01')).toBe('')
  })
})

describe('getWIBToday', () => {
  it('memakai kalender WIB, bukan kalender perangkat', () => {
    const now = new Date()
    const expected = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)

    for (const zone of ZONES) {
      withTZ(zone, () => {
        expect(getWIBToday()).toBe(expected)
      })
    }
  })
})

describe('addWIBDays', () => {
  it('menggeser kunci tanggal maju dan mundur', () => {
    expect(addWIBDays('2024-03-01', -1)).toBe('2024-02-29')
    expect(addWIBDays('2024-03-01', 1)).toBe('2024-03-02')
    expect(addWIBDays('2024-03-01', 0)).toBe('2024-03-01')
  })

  it('menangani pergantian bulan, tahun, dan tahun kabisat', () => {
    expect(addWIBDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addWIBDays('2023-02-28', 1)).toBe('2023-03-01')
    expect(addWIBDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addWIBDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addWIBDays('2024-03-01', -7)).toBe('2024-02-23')
  })

  it('tidak bergantung pada timezone perangkat', () => {
    const results = ZONES.map((zone) => withTZ(zone, () => addWIBDays('2024-03-01', -1)))
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe('2024-02-29')
  })

  it('mengembalikan string kosong untuk kunci tidak valid', () => {
    expect(addWIBDays('', 1)).toBe('')
    expect(addWIBDays('not-a-date', 1)).toBe('')
  })
})

describe('buildDayRange', () => {
  it('menghasilkan jendela tepat 24 jam dengan kedua batas ber-offset +07:00', () => {
    const instants = [
      '2024-03-01T16:30:00.000Z', // 23:30 WIB
      '2024-03-01T17:00:00.000Z', // 00:00 WIB hari berikutnya
      '2024-02-28T23:00:00.000Z', // kabisat
      '2026-12-31T20:00:00.000Z', // pergantian tahun
    ]

    for (const zone of ZONES) {
      withTZ(zone, () => {
        for (const instant of instants) {
          const range = buildDayRange(instant)

          expect(range.from.endsWith('+07:00')).toBe(true)
          expect(range.to.endsWith('+07:00')).toBe(true)
          expect(Date.parse(range.to) - Date.parse(range.from)).toBe(24 * 60 * 60 * 1000)
          expect(range.from).toBe(`${range.key}T00:00:00+07:00`)
        }
      })
    }
  })

  it('memakai hari WIB, bukan hari perangkat, pada counterexample task 1', () => {
    withTZ('Asia/Makassar', () => {
      const range = buildDayRange(new Date('2024-03-01T16:30:00.000Z'))

      expect(range.key).toBe('2024-03-01')
      expect(range.from).toBe('2024-03-01T00:00:00+07:00')
      expect(range.to).toBe('2024-03-02T00:00:00+07:00')
    })
  })

  it('cocok dengan batas yang dihasilkan helper rentang laporan (Property 22)', () => {
    withTZ('America/New_York', () => {
      const range = buildDayRange('2024-03-01T20:00:00.000Z')

      expect(range.from).toBe(getISOStartOfDay(range.key))
      expect(range.to).toBe(getISOExclusiveEndOfDay(range.key))
    })
  })
})
