/**
 * Klaster F — paritas struk thermal (bugfix 1.15 → 2.15, design F, Property 24).
 *
 * Menguji helper murni `wrapText`/`formatQty` dan baris item `buildReceiptBytes`
 * pada lebar 32 kolom (58 mm) maupun 48 kolom (80 mm).
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { buildReceiptBytes, formatQty, wrapText, type ReceiptData } from '../utils/escpos'

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const ESC = String.fromCharCode(0x1b)
const GS = String.fromCharCode(0x1d)
const NUL = String.fromCharCode(0x00)
const SOH = String.fromCharCode(0x01)
// reset printer | bold on/off | auto-cut
const commandBytes = new RegExp(`${ESC}@|${ESC}E[${NUL}${SOH}]|${GS}VB${NUL}`, 'g')

/** Teks tercetak tanpa byte perintah ESC/GS. */
const printedText = (bytes: Uint8Array) => decode(bytes).replace(commandBytes, '')

const textLines = (bytes: Uint8Array) => printedText(bytes).split('\n')

/** Baris-baris blok daftar barang: antara garis `=` dan garis `-` sesudahnya. */
function itemLines(bytes: Uint8Array, width: number): string[] {
  const lines = textLines(bytes)
  const start = lines.indexOf('='.repeat(width)) + 1
  const end = lines.indexOf('-'.repeat(width), start)
  return lines.slice(start, end)
}

function baseReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    invoice: 'INV-0001',
    created_at: '01/03/2024 10:00',
    cashier: 'Kasir Satu',
    items: [{ name: 'Tali Rafia', qty: 1, unit: 'kg', unitPrice: 25_000, lineTotal: 25_000 }],
    subtotal: 25_000,
    grand_total: 25_000,
    ...overrides,
  }
}

describe('formatQty', () => {
  it('mencetak bilangan bulat tanpa desimal', () => {
    expect(formatQty(2)).toBe('2')
  })

  it('memakai koma sebagai pemisah desimal tanpa nol berlebih', () => {
    expect(formatQty(0.5)).toBe('0,5')
    expect(formatQty(0.25)).toBe('0,25')
    expect(formatQty(0.125)).toBe('0,125')
  })

  it('mempertahankan desimal pada nilai besar', () => {
    expect(formatQty(1000.5)).toMatch(/^1\.?000,5$/)
  })

  it('tidak pernah mencetak NaN', () => {
    expect(formatQty(Number.NaN)).toBe('0')
  })
})

describe('wrapText', () => {
  it('memecah pada batas kata, bukan di tengah kata', () => {
    expect(wrapText('Kantong Plastik HD Ukuran 17x35 Tebal XL', 32)).toEqual([
      'Kantong Plastik HD Ukuran 17x35',
      'Tebal XL',
    ])
  })

  it('memotong hanya kata yang memang melebihi lebar', () => {
    expect(wrapText('AAAAAAAAAA BB', 4)).toEqual(['AAAA', 'AAAA', 'AA', 'BB'])
    expect(wrapText('AAAAAAAAAA BB', 6)).toEqual(['AAAAAA', 'AAAA', 'BB'])
  })

  it('mempertahankan teks yang tepat selebar kolom dalam satu baris', () => {
    const exact = 'A'.repeat(32)
    expect(wrapText(exact, 32)).toEqual([exact])
  })

  it('meringkas beberapa spasi berurutan', () => {
    expect(wrapText('  Tali   Rafia  ', 32)).toEqual(['Tali Rafia'])
  })

  it('mengembalikan daftar kosong untuk teks kosong', () => {
    expect(wrapText('   ', 32)).toEqual([])
  })

  it('PROPERTY 24: tiap baris ≤ lebar dan tidak ada karakter non-spasi yang hilang', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 160 }), fc.constantFrom(32, 48), (name, width) => {
        const lines = wrapText(name, width)
        for (const line of lines) {
          expect(line.length).toBeLessThanOrEqual(width)
        }
        expect(lines.join('').replace(/\s/g, '')).toBe(name.replace(/\s/g, ''))
      }),
      { numRuns: 300 },
    )
  })
})

describe('buildReceiptBytes — baris item', () => {
  it('mencetak satuan sehingga 2 dus dan 2 pcs terbedakan', () => {
    const dus = printedText(
      buildReceiptBytes(
        baseReceipt({
          items: [{ name: 'Gelas Cup', qty: 2, unit: 'dus', unitPrice: 27_500, lineTotal: 55_000 }],
        }),
        '58mm',
      ),
    )
    const pcs = printedText(
      buildReceiptBytes(
        baseReceipt({
          items: [{ name: 'Gelas Cup', qty: 2, unit: 'pcs', unitPrice: 27_500, lineTotal: 55_000 }],
        }),
        '58mm',
      ),
    )

    expect(dus).toMatch(/^ {2}2 dus x Rp 27\.500 +Rp 55\.000$/m)
    expect(pcs).toMatch(/^ {2}2 pcs x Rp 27\.500 +Rp 55\.000$/m)
    expect(dus).not.toBe(pcs)
  })

  it('mencetak qty pecahan dengan koma beserta satuannya', () => {
    const text = printedText(
      buildReceiptBytes(
        baseReceipt({
          items: [{ name: 'Tali Rafia', qty: 0.5, unit: 'kg', unitPrice: 25_000, lineTotal: 12_500 }],
        }),
        '58mm',
      ),
    )
    expect(text).toMatch(/^ {2}0,5 kg x Rp 25\.000 +Rp 12\.500$/m)
  })

  it('mencetak baris diskon item saat persentasenya > 0', () => {
    const text = printedText(
      buildReceiptBytes(
        baseReceipt({
          items: [
            { name: 'Gelas Cup', qty: 2, unit: 'dus', unitPrice: 27_500, discountPercent: 10, lineTotal: 49_500 },
          ],
        }),
        '58mm',
      ),
    )
    expect(text).toContain('  Diskon 10%')
  })

  it('tidak mencetak baris diskon saat persentasenya 0', () => {
    expect(printedText(buildReceiptBytes(baseReceipt(), '58mm'))).not.toContain('Diskon 0%')
  })

  it('menerima alias `price` sebagai lineTotal agar pemanggil lama tidak pecah', () => {
    const text = printedText(
      buildReceiptBytes(baseReceipt({ items: [{ name: 'Gelas Cup', qty: 2, price: 55_000 }] }), '58mm'),
    )
    expect(text).toMatch(/^ {2}2x +Rp 55\.000$/m)
  })

  it('menerima alias kolom transaksi (satuan / harga_satuan / diskon_item_persen)', () => {
    const text = printedText(
      buildReceiptBytes(
        baseReceipt({
          items: [
            { name: 'Gelas Cup', qty: 2, satuan: 'dus', harga_satuan: 27_500, diskon_item_persen: 5, price: 52_250 },
          ],
        }),
        '58mm',
      ),
    )
    expect(text).toMatch(/^ {2}2 dus x Rp 27\.500 +Rp 52\.250$/m)
    expect(text).toContain('  Diskon 5%')
  })

  it('men-wrap nama produk panjang, bukan memotongnya', () => {
    const longName = 'Kantong Plastik HD Ukuran 17x35 Tebal XL'
    const lines = itemLines(
      buildReceiptBytes(
        baseReceipt({
          items: [{ name: longName, qty: 2, unit: 'dus', unitPrice: 27_500, lineTotal: 55_000 }],
        }),
        '58mm',
      ),
      32,
    )

    expect(lines).toContain('Kantong Plastik HD Ukuran 17x35')
    expect(lines).toContain('Tebal XL')
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(32)
    }
  })

  it('memecah baris harga satuan menjadi dua baris saat tidak muat 32 kolom', () => {
    const lines = itemLines(
      buildReceiptBytes(
        baseReceipt({
          items: [{ name: 'Terpal', qty: 12.5, unit: 'lembar', unitPrice: 1_250_000, lineTotal: 15_625_000 }],
          subtotal: 15_625_000,
          grand_total: 15_625_000,
        }),
        '58mm',
      ),
      32,
    )

    expect(lines).toContain('  12,5 lembar x Rp 1.250.000')
    expect(lines.some((l) => l.trimStart() === 'Rp 15.625.000' && l.length <= 32)).toBe(true)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(32)
    }
  })

  it('menghormati lebar 48 kolom pada kertas 80mm', () => {
    const lines = itemLines(
      buildReceiptBytes(
        baseReceipt({
          items: [
            {
              name: 'Kantong Plastik HD Ukuran 17x35 Tebal XL Extra Panjang',
              qty: 2,
              unit: 'dus',
              unitPrice: 27_500,
              lineTotal: 55_000,
            },
          ],
        }),
        '80mm',
      ),
      48,
    )

    expect(lines).toContain('Kantong Plastik HD Ukuran 17x35 Tebal XL Extra')
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(48)
    }
  })
})

describe('buildReceiptBytes — pembayaran, pelanggan, catatan', () => {
  it('mencetak Bayar dan Kembalian saat kembalian bernilai 0 (uang pas)', () => {
    const text = printedText(
      buildReceiptBytes(baseReceipt({ cash_received: 25_000, change: 0 }), '58mm'),
    )
    expect(text).toMatch(/^Bayar +Rp 25\.000$/m)
    expect(text).toMatch(/^Kembalian +Rp 0$/m)
  })

  it('mencetak Bayar 0 untuk transaksi hutang tanpa uang muka', () => {
    const text = printedText(buildReceiptBytes(baseReceipt({ cash_received: 0, change: 0 }), '58mm'))
    expect(text).toMatch(/^Bayar +Rp 0$/m)
  })

  it('tidak mencetak baris pembayaran saat nilainya tidak diteruskan', () => {
    const text = printedText(buildReceiptBytes(baseReceipt(), '58mm'))
    expect(text).not.toContain('Bayar')
    expect(text).not.toContain('Kembalian')
  })

  it('meneruskan nama pelanggan dan catatan', () => {
    const text = printedText(
      buildReceiptBytes(baseReceipt({ customer_name: 'Bu Ratih', note: 'Ambil sore' }), '58mm'),
    )
    expect(text).toMatch(/^Pelanggan +Bu Ratih$/m)
    expect(text).toContain('Catatan: Ambil sore')
  })
})
