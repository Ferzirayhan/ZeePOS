import { describe, expect, it } from 'vitest'
import { formatLocalDateKey, getISOEndOfDay, getISOStartOfDay } from '../utils/date'

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
