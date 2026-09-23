import { describe, expect, it } from 'vitest'
import {
  formatLocalDateKey,
  getISOEndOfDay,
  getISOExclusiveEndOfDay,
  getISOStartOfDay,
} from '../utils/date'

describe('date utils', () => {
  describe('getISOStartOfDay', () => {
    it('mengubah string YYYY-MM-DD menjadi ISO timestamp dengan timezone +07:00', () => {
      expect(getISOStartOfDay('2026-09-13')).toBe('2026-09-13T00:00:00+07:00')
    })

    it('mengembalikan string aslinya jika sudah mengandung T', () => {
      expect(getISOStartOfDay('2026-09-13T00:00:00+07:00')).toBe('2026-09-13T00:00:00+07:00')
    })

    it('mengembalikan string kosong untuk input kosong', () => {
      expect(getISOStartOfDay('')).toBe('')
    })
  })

  describe('getISOEndOfDay', () => {
    it('mengubah string YYYY-MM-DD menjadi ISO end of day dengan timezone +07:00', () => {
      expect(getISOEndOfDay('2026-09-13')).toBe('2026-09-13T23:59:59+07:00')
    })

    it('mengembalikan string aslinya jika sudah mengandung T', () => {
      expect(getISOEndOfDay('2026-09-13T23:59:59+07:00')).toBe('2026-09-13T23:59:59+07:00')
    })
  })

  /**
   * Preservation klausa 3.8 (baseline task 2): batas atas rentang laporan harus
   * tetap EKSKLUSIF di awal hari berikutnya, termasuk saat menyeberang bulan dan
   * pada tahun kabisat. Nilai di bawah diamati pada kode sebelum perbaikan WIB
   * apa pun ditulis.
   */
  describe('getISOExclusiveEndOfDay', () => {
    it('memetakan tanggal ke awal hari berikutnya dengan offset WIB', () => {
      expect(getISOExclusiveEndOfDay('2026-09-13')).toBe('2026-09-14T00:00:00+07:00')
    })

    it('menangani pergantian bulan dan tahun', () => {
      expect(getISOExclusiveEndOfDay('2026-01-31')).toBe('2026-02-01T00:00:00+07:00')
      expect(getISOExclusiveEndOfDay('2026-04-30')).toBe('2026-05-01T00:00:00+07:00')
      expect(getISOExclusiveEndOfDay('2026-12-31')).toBe('2027-01-01T00:00:00+07:00')
    })

    it('menangani tahun kabisat', () => {
      expect(getISOExclusiveEndOfDay('2024-02-28')).toBe('2024-02-29T00:00:00+07:00')
      expect(getISOExclusiveEndOfDay('2024-02-29')).toBe('2024-03-01T00:00:00+07:00')
      expect(getISOExclusiveEndOfDay('2026-02-28')).toBe('2026-03-01T00:00:00+07:00')
    })

    it('selalu lebih besar dari batas inklusif 23:59:59 sehingga detik terakhir tidak hilang', () => {
      for (const day of ['2026-01-31', '2024-02-29', '2026-12-31']) {
        expect(Date.parse(getISOExclusiveEndOfDay(day))).toBeGreaterThan(Date.parse(getISOEndOfDay(day)))
      }
    })

    it('mengembalikan string kosong untuk input kosong maupun tidak valid', () => {
      expect(getISOExclusiveEndOfDay('')).toBe('')
      expect(getISOExclusiveEndOfDay('not-a-date')).toBe('')
    })
  })

  describe('formatLocalDateKey', () => {
    it('mengubah ISO timestamp menjadi tanggal lokal format YYYY-MM-DD', () => {
      const formatted = formatLocalDateKey('2026-09-13T10:00:00.000Z')
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('mengembalikan string kosong jika null atau undefined', () => {
      expect(formatLocalDateKey(null)).toBe('')
      expect(formatLocalDateKey(undefined)).toBe('')
    })
  })
})
