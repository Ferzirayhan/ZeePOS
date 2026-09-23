/**
 * Apakah sesi berpindah ke identitas (akun / tenant) yang BERBEDA?
 *
 * Dipakai untuk memutuskan penghapusan data lokal perangkat (cache katalog
 * IndexedDB, pesanan parkir, keranjang aktif). Karena efeknya destruktif,
 * perbandingan hanya dilakukan ketika kedua sisi benar-benar diketahui:
 * nilai `null` berarti "belum/tidak diketahui", bukan "identitas berbeda".
 *
 * Tanpa aturan ini, kegagalan sementara saat mengambil profil (jaringan putus,
 * PostgREST 5xx) menghasilkan tenant `null` dan ikut terbaca sebagai pergantian
 * akun — sehingga cache katalog offline terhapus justru pada saat paling
 * dibutuhkan. Hilangnya identitas ditangani terpisah oleh pemanggil, yang tahu
 * bedanya antara "profil memang tidak ada" dan "gagal mengambil profil".
 */
export function hasAuthIdentityChanged(
  previousUserId: string | null,
  previousTenantId: string | null,
  nextUserId: string | null,
  nextTenantId: string | null,
): boolean {
  if (previousUserId !== null && nextUserId !== null && previousUserId !== nextUserId) {
    return true
  }

  if (previousTenantId !== null && nextTenantId !== null && previousTenantId !== nextTenantId) {
    return true
  }

  return false
}
