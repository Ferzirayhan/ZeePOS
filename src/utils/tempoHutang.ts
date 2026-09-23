// Tenor hutang default toko. Server (`create_transaction_atomic` sejak migrasi
// 067) membaca setelan `tempo_hutang_hari` dan menjepitnya dengan
// `LEAST(GREATEST(COALESCE(NULLIF(value,'')::INTEGER, 14), 0), 365)`, lalu
// menghitung `receivables.jatuh_tempo` = tanggal WIB transaksi + tenor.
// Batas di UI DIBUAT IDENTIK dengan jepitan server supaya admin tidak pernah
// bisa menyimpan nilai yang diam-diam diubah server.
export const DEFAULT_TEMPO_HUTANG_HARI = 14
export const MAX_TEMPO_HUTANG_HARI = 365

/**
 * Membaca setelan `tempo_hutang_hari` yang tersimpan sebagai TEXT.
 * Kosong / tidak ada / bukan bilangan bulat → default 14 (mencerminkan
 * `NULLIF(value,'')` + `COALESCE(..., 14)` di server), bukan 0.
 */
export function parseTempoHutangHari(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_TEMPO_HUTANG_HARI

  const trimmed = String(raw).trim()
  if (trimmed === '') return DEFAULT_TEMPO_HUTANG_HARI

  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed)) return DEFAULT_TEMPO_HUTANG_HARI

  return Math.min(MAX_TEMPO_HUTANG_HARI, Math.max(0, parsed))
}
