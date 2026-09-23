import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

export function formatDateIndonesia(value: string | Date, pattern = 'dd MMMM yyyy') {
  return format(new Date(value), pattern, { locale: localeId })
}

export function formatDateTimeIndonesia(value: string | Date) {
  return formatDateIndonesia(value, 'dd MMM yyyy, HH:mm')
}

/** Zona waktu operasional toko. Semua batas hari laporan diikat ke offset ini. */
const WIB_OFFSET = '+07:00'

/**
 * Timestamp dianggap sudah "beroffset" bila diakhiri Z atau ±hh:mm. Tanpa penanda
 * ini Postgres akan menafsirkan literal sesuai timezone sesi (UTC di PostgREST),
 * sehingga jendela laporan bergeser 7 jam dari hari kalender WIB.
 */
function hasTimezoneDesignator(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
}

export function getISOStartOfDay(dateStr: string): string {
  if (!dateStr) return ''
  if (dateStr.includes('T')) {
    return hasTimezoneDesignator(dateStr) ? dateStr : `${dateStr}${WIB_OFFSET}`
  }
  return `${dateStr}T00:00:00${WIB_OFFSET}`
}

export function getISOEndOfDay(dateStr: string): string {
  if (!dateStr) return ''
  if (dateStr.includes('T')) {
    return hasTimezoneDesignator(dateStr) ? dateStr : `${dateStr}${WIB_OFFSET}`
  }
  return `${dateStr}T23:59:59${WIB_OFFSET}`
}

/**
 * Batas atas EKSKLUSIF untuk filter rentang tanggal: awal hari BERIKUTNYA.
 *
 * `created_at` bertipe timestamptz dengan presisi sub-detik, jadi batas inklusif
 * "23:59:59" membuang penjualan pada 23:59:59.4. Pakai `.lt(getISOExclusiveEndOfDay(...))`
 * alih-alih `.lte(getISOEndOfDay(...))`.
 */
export function getISOExclusiveEndOfDay(dateStr: string): string {
  if (!dateStr) return ''

  const datePart = dateStr.includes('T') ? dateStr.slice(0, dateStr.indexOf('T')) : dateStr
  const [year, month, day] = datePart.split('-').map(Number)

  if (!year || !month || !day) return ''

  // Aritmetika kalender lewat Date.UTC supaya hasilnya tidak bergantung pada zona
  // waktu perangkat (dan luapan akhir bulan/tahun tetap benar).
  const next = new Date(Date.UTC(year, month - 1, day + 1))
  const nextYear = next.getUTCFullYear()
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, '0')
  const nextDay = String(next.getUTCDate()).padStart(2, '0')

  return `${nextYear}-${nextMonth}-${nextDay}T00:00:00${WIB_OFFSET}`
}

/** +07:00 dalam milidetik. Dipakai untuk memproyeksikan epoch ke kalender WIB. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Kunci tanggal `yyyy-MM-dd` menurut kalender WIB, apa pun timezone perangkat.
 *
 * Ini pasangan baca untuk `getISOStartOfDay`/`getISOExclusiveEndOfDay`: server
 * mem-bucket dengan `DATE(created_at AT TIME ZONE 'Asia/Jakarta')`, jadi klien
 * harus memakai kalender yang sama. `format(date, 'yyyy-MM-dd')` (lihat
 * `formatLocalDateKey`) memakai timezone perangkat dan menggeser bucket sehari
 * untuk transaksi malam di WITA/WIT.
 *
 * Timestamp tanpa penanda zona diperlakukan sebagai WIB, konsisten dengan
 * `getISOStartOfDay`, supaya hasilnya tidak bergantung perangkat.
 */
export function getWIBDateKey(value: string | Date | null | undefined = new Date()): string {
  let epochMs: number

  if (value instanceof Date) {
    epochMs = value.getTime()
  } else {
    if (!value) return ''

    if (DATE_KEY_PATTERN.test(value)) {
      // Kunci tanggal sudah berada di kalender WIB; cukup divalidasi (menolak
      // 2024-02-30 / 2024-13-01) lalu dikembalikan tanpa konversi apa pun.
      const [year, month, day] = value.split('-').map(Number)
      const probe = new Date(Date.UTC(year, month - 1, day))
      const roundTrip = toDateKey(
        probe.getUTCFullYear(),
        probe.getUTCMonth() + 1,
        probe.getUTCDate(),
      )

      return roundTrip === value ? value : ''
    }

    const normalized =
      value.includes('T') && !hasTimezoneDesignator(value) ? `${value}${WIB_OFFSET}` : value
    epochMs = Date.parse(normalized)
  }

  if (Number.isNaN(epochMs)) return ''

  // Proyeksi epoch → kalender WIB lewat pergeseran offset, lalu dibaca sebagai
  // UTC. Tidak ada satu pun pembacaan komponen tanggal berzona perangkat.
  const shifted = new Date(epochMs + WIB_OFFSET_MS)

  return toDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/** Hari ini menurut WIB (`yyyy-MM-dd`), bukan menurut jam perangkat. */
export function getWIBToday(): string {
  return getWIBDateKey(new Date())
}

/**
 * Aritmetika kalender atas kunci tanggal WIB. `days` boleh negatif.
 * Memakai `Date.UTC` supaya luapan bulan/tahun benar tanpa menyentuh timezone
 * perangkat maupun DST (WIB tidak punya DST, tetapi perangkatnya bisa punya).
 */
export function addWIBDays(dateKey: string, days: number): string {
  const key = getWIBDateKey(dateKey)

  if (!key) return ''

  const [year, month, day] = key.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))

  return toDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/**
 * @deprecated Memakai timezone perangkat sehingga bucket harian bergeser di luar
 * WIB. Jalur laporan memakai {@link getWIBDateKey}; dipertahankan hanya untuk
 * pemanggil non-laporan yang memang menginginkan kalender perangkat.
 */
export function formatLocalDateKey(isoString: string | null | undefined): string {
  if (!isoString) return ''
  return format(new Date(isoString), 'yyyy-MM-dd')
}

