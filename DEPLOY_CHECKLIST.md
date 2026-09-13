# Checklist Deploy Production

## 1. Siapkan Supabase Cloud

- buat project Supabase baru
- link folder ini ke project cloud
- jalankan semua migration ke project cloud
- jalankan seed data awal
- buat user admin pertama
- isi tabel `profiles` untuk admin

Command yang dipakai:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --include-seed
```

Catatan:

- bucket storage `products` sekarang ikut dibuat oleh migration
- user Auth dari local tidak ikut tersalin ke cloud, jadi buat ulang di dashboard Supabase Cloud
- kalau project cloud sudah terisi sebagian, jalankan `supabase db push --dry-run` dulu untuk cek migration yang akan diterapkan

## 2. Environment Variables

Isi environment production:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-production-anon-key
```

## 3. Verifikasi Data Penting

- `store_settings` terisi
- bucket `products` ada dan public
- metode pembayaran non-tunai sudah diatur
- nomor WhatsApp toko sudah diatur
- rekening transfer sudah diatur

## 4. Test Sebelum Go Live

- login admin
- login kasir
- transaksi tunai
- transaksi QRIS pending -> konfirmasi -> cetak struk
- transaksi transfer pending -> konfirmasi -> cetak struk
- pembatalan transaksi pending
- input produk
- adjust stok
- laporan dan export Excel

## 5. Deploy ke Vercel

- import repo GitHub ke Vercel
- isi environment variables
- deploy
- cek PWA manifest dan service worker

## 6. UAT Setelah Deploy

- buka dari desktop
- buka dari HP / tablet
- test install PWA
- test upload foto produk
- test printer browser

## 7. Reset Setelah UAT

Kalau setelah testing mau kosong lagi tanpa setup ulang project:

```bash
bash scripts/reset-uat-cloud.sh YOUR_DB_PASSWORD
```

Reset ini akan:

- mempertahankan akun default `admin@zeepos.com` dan `kasir1@zeepos.com`
- menghapus transaksi, stok adjustment, produk, kategori, dan user uji tambahan
- mengembalikan `store_settings` ke seed awal
- membersihkan file di bucket `products`
