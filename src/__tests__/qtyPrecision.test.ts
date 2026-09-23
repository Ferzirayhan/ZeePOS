/**
 * Klaster D — presisi qty per satuan (task 11.1, design D.2).
 *
 * `MAX_QTY_DECIMALS` terikat pada `transaction_items.qty NUMERIC(12,3)`
 * (migrasi 029). Uji ini menjaga ikatan itu dan mencakup SETIAP nilai
 * `SatuanType` supaya satuan baru tidak lolos tanpa keputusan presisi.
 *
 * **Validates: Requirements 2.9**
 */
import { describe, expect, it } from 'vitest'
import { MAX_QTY_DECIMALS, getQtyDecimals } from '../lib/units'
import type { SatuanType } from '../types/database'

// Sengaja dituliskan lengkap (bukan diturunkan dari kode produksi) agar
// penambahan anggota `SatuanType` memunculkan galat tsc di sini.
const ALL_SATUAN: SatuanType[] = [
  'pcs',
  'lusin',
  'kg',
  'meter',
  'pack',
  'gram',
  'dus',
  'ikat',
  'bal',
  'roll',
  'batang',
  'lembar',
]

const FRACTIONAL: string[] = ['kg', 'gram', 'meter', 'liter']

describe('MAX_QTY_DECIMALS', () => {
  it('bernilai 3, mengikuti skala kolom transaction_items.qty NUMERIC(12,3)', () => {
    expect(MAX_QTY_DECIMALS).toBe(3)
  })
})

describe('getQtyDecimals', () => {
  it.each(ALL_SATUAN)('menentukan presisi untuk satuan %s', (satuan) => {
    const expected = FRACTIONAL.includes(satuan) ? MAX_QTY_DECIMALS : 0
    expect(getQtyDecimals(satuan)).toBe(expected)
  })

  it('memberi presisi penuh untuk satuan pecahan, termasuk liter yang hanya ada di product_units', () => {
    for (const satuan of FRACTIONAL) {
      expect(getQtyDecimals(satuan)).toBe(MAX_QTY_DECIMALS)
    }
  })

  it('tidak pernah melebihi plafon kolom untuk satuan apa pun', () => {
    for (const satuan of [...ALL_SATUAN, ...FRACTIONAL]) {
      expect(getQtyDecimals(satuan)).toBeLessThanOrEqual(MAX_QTY_DECIMALS)
    }
  })

  it('menormalkan huruf besar dan spasi karena product_units.nama_satuan teks bebas', () => {
    expect(getQtyDecimals(' KG ')).toBe(MAX_QTY_DECIMALS)
    expect(getQtyDecimals('Meter')).toBe(MAX_QTY_DECIMALS)
    expect(getQtyDecimals(' Dus')).toBe(0)
  })

  it('memperlakukan satuan kosong/tidak dikenal sebagai diskret', () => {
    expect(getQtyDecimals(null)).toBe(0)
    expect(getQtyDecimals(undefined)).toBe(0)
    expect(getQtyDecimals('')).toBe(0)
    expect(getQtyDecimals('karung')).toBe(0)
  })
})
