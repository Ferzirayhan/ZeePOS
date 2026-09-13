# AI Handoff

Dokumen ini dipakai sebagai konteks cepat untuk AI lain atau sesi lanjutan agar bisa langsung memahami kondisi project tanpa eksplor ulang dari nol.

## Ringkasan Project

- Nama app: `ZeePOS`
- Stack frontend: React 18, TypeScript, Vite, Tailwind CSS, Zustand, React Router
- Backend: Supabase Cloud
- Storage: Supabase Storage bucket `products`
- Auth: Supabase Auth email/password
- Deploy frontend: cocok untuk Vercel

## Status Saat Ini

- Frontend sudah diarahkan ke Supabase Cloud lewat `.env.local`
- Project Supabase Cloud yang aktif:
  - Name: `Tara`
  - Ref: `dfgqioglsirftfyjyswd`
  - Region: `South Asia (Mumbai)`
- Repo sudah di-link ke project tersebut
- Migration remote sudah sinkron sampai:
  - `016_storage_products_bucket.sql`
- Seed awal sudah dijalankan ke cloud

## File Penting

- Frontend client Supabase:
  - `src/lib/supabase.ts`
- Login page:
  - `src/pages/LoginPage.tsx`
- Receipt / print:
  - `src/components/pos/ReceiptPrint.tsx`
  - `src/components/pos/ReceiptModal.tsx`
  - `src/hooks/usePrint.ts`
- Supabase config:
  - `supabase/config.toml`
- Seed:
  - `supabase/seed.sql`
- Storage migration:
  - `supabase/migrations/016_storage_products_bucket.sql`
- Reset UAT script:
  - `scripts/reset-uat-cloud.sh`
  - `supabase/reset_uat.sql`

## Perubahan yang Sudah Dilakukan

### Backend / Supabase Cloud

- Logout dari akun Supabase lama lalu login ke akun baru
- Link repo ini ke project cloud `Tara`
- Push semua migration ke remote database
- Push seed awal ke remote database
- Tambah migration `016_storage_products_bucket.sql` untuk:
  - membuat bucket `products`
  - mengatur bucket jadi public
  - membuat policy read public
  - membuat policy upload/update/delete khusus admin

### Auth / User Default

Akun default sudah dibuat langsung di Supabase Cloud:

- Admin:
  - email: `admin@zeepos.com`
  - password: `Admin@123`
- Kasir:
  - email: `kasir1@zeepos.com`
  - password: `Kasir@123`

`profiles` untuk keduanya juga sudah dibuat dan aktif:

- `admin` -> role `admin`
- `kasir1` -> role `kasir`

### Frontend

- `.env.local` sudah diarahkan ke Supabase Cloud
- `.env.example` sudah diperbarui untuk template cloud
- `README.md` dan `DEPLOY_CHECKLIST.md` sudah diperbarui untuk alur cloud
- Halaman login dibersihkan dari teks tambahan di bagian bawah

### Print / Receipt

Hasil cetak struk sudah diperbaiki:

- menambahkan `receiptPrintPageStyle`
- menyesuaikan lebar thermal `58mm`
- memperbaiki layout receipt agar lebih stabil untuk printer
- print content tidak lagi disembunyikan dengan `display: none`
- sinkron antara print dari POS modal dan print ulang dari laporan
- menambahkan informasi:
  - tanggal transaksi
  - metode bayar
  - status pembayaran
  - paid at
  - payment reference
  - catatan transaksi jika ada

## Environment yang Sedang Dipakai

`.env.local` saat ini mengarah ke:

- `VITE_SUPABASE_URL=https://dfgqioglsirftfyjyswd.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<sudah terisi di file lokal>`

Catatan:

- Jangan commit secret sensitif ke repo
- Untuk AI lain: baca `.env.local` hanya jika memang perlu verifikasi environment lokal
- Password database Supabase jangan disimpan di dokumen ini

## Alur Kerja yang Disarankan

### 1. Kerja ke Supabase Cloud

Tidak perlu Docker atau `supabase start`.

Yang dibutuhkan:

- internet aktif
- `supabase login`
- project sudah `supabase link`
- password database kalau mau `db push` atau query remote

Alur umum:

```bash
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
supabase login
supabase projects list
supabase link --project-ref dfgqioglsirftfyjyswd
supabase db push --include-seed
npm run dev
```

### 2. Kerja ke Supabase Local

Ini hanya perlu kalau mau eksperimen lokal tanpa menyentuh data cloud.

Yang dibutuhkan:

- Docker Desktop atau Colima
- `supabase start`

Alur umum:

```bash
colima start
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
supabase start
supabase db reset
npm run dev
```

## Reset Data Setelah UAT / Testing

Sudah tersedia script reset cloud:

```bash
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
bash scripts/reset-uat-cloud.sh YOUR_DB_PASSWORD
```

Atau:

```bash
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
export SUPABASE_DB_PASSWORD=YOUR_DB_PASSWORD
bash scripts/reset-uat-cloud.sh
```

Script ini akan:

- mempertahankan user default `admin@zeepos.com` dan `kasir1@zeepos.com`
- menghapus user uji tambahan
- menghapus transaksi, item transaksi, stok adjustment
- menghapus produk dan kategori
- reset `store_settings` ke seed awal
- membersihkan file di bucket `products`

Script ini tidak dijalankan otomatis. Jalankan hanya saat memang ingin mengosongkan data UAT.

## Perbedaan Web Dashboard vs Terminal

Perubahan backend bisa dilakukan dari dua jalur:

- Web dashboard Supabase
- Terminal / CLI / SQL ke project cloud yang sama

Untuk project ini, terminal sudah dipakai untuk:

- link project
- push migration
- seed remote
- membuat akun default
- mengisi `profiles`
- membuat reset workflow

## Kapan Pakai Dashboard Web

Masih berguna untuk:

- cek tabel secara visual
- cek Auth users cepat
- cek file storage cepat
- lihat log secara visual
- copy nilai env saat setup awal

## Kapan Pakai Terminal

Lebih disarankan untuk:

- schema changes
- migration
- reset UAT
- seed
- workflow berulang
- handoff antar AI / antar sesi

## Validasi yang Sudah Pernah Dilakukan

- `supabase migration list` menunjukkan local dan remote sinkron sampai `016`
- login admin berhasil lewat Auth API
- login kasir berhasil lewat Auth API
- bucket `products` ada dan public
- `store_settings` terisi
- `npm run build` berhasil setelah perubahan frontend

## Catatan Untuk AI Berikutnya

- Jangan asumsi project masih local. Default sekarang adalah Supabase Cloud
- Jangan jalankan reset UAT kecuali memang diminta user
- Kalau mau ubah schema database, utamakan migration baru daripada edit manual di dashboard
- Kalau mau ubah print receipt, cek tiga file sekaligus:
  - `src/components/pos/ReceiptPrint.tsx`
  - `src/components/pos/ReceiptModal.tsx`
  - `src/hooks/usePrint.ts`
- Kalau mau ubah user default, sesuaikan juga `profiles` dan reset script
- Kalau mau deploy ke Vercel, pastikan env di Vercel sama dengan project cloud aktif

## Quick Commands

```bash
# Jalankan dev frontend
npm run dev

# Build frontend
npm run build

# Lihat project Supabase yang tersedia
supabase projects list

# Link ke project Tara
supabase link --project-ref dfgqioglsirftfyjyswd

# Push migration ke cloud
supabase db push --include-seed

# Reset data UAT cloud
bash scripts/reset-uat-cloud.sh YOUR_DB_PASSWORD
```
