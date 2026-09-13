# POS Tara Plastic

Panduan ini dibuat supaya kamu cepat paham isi aplikasi, alur fiturnya, dan cara menjalankannya dari awal sampai siap dipakai.

## 1. Gambaran App

App ini adalah sistem POS untuk toko retail barang plastik dengan fitur utama:

- login admin dan kasir
- transaksi kasir / POS
- manajemen kategori produk
- manajemen produk
- manajemen stok
- laporan penjualan
- pengaturan toko
- cetak struk
- export Excel

App ini dibangun untuk jalan dengan:

- React 18
- TypeScript
- Vite
- Tailwind CSS v3
- Zustand
- React Router v6
- Supabase local
- PostgreSQL

## 2. Lokasi Project

Project utama sekarang ada di:

`/Users/ezi/Documents/Coding/toko-plastik-ratih-pos`

Masuk ke project dengan:

```bash
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
```

## 3. Struktur Penting

Folder penting yang paling sering dipakai:

```text
toko-plastik-ratih-pos/
├── src/
│   ├── api/                 # Semua query dan RPC Supabase
│   ├── components/          # UI, layout, auth, POS
│   ├── hooks/               # Custom hooks
│   ├── lib/                 # Supabase client
│   ├── pages/               # Halaman utama
│   ├── stores/              # Zustand store
│   ├── types/               # TypeScript types
│   └── utils/               # Format currency, date, export, dll
├── supabase/
│   ├── migrations/          # Schema, RLS, RPC function
│   └── seed.sql             # Seed data awal
├── .env.local
├── README.md
└── APP_GUIDE.md
```

## 4. Fitur yang Sudah Ada

### Auth

- login email/password lewat Supabase Auth
- role `admin` dan `kasir`
- route protection
- timeout auth supaya app tidak loading selamanya

### Dashboard

- total penjualan hari ini
- jumlah transaksi hari ini
- produk terlaris hari ini
- rata-rata transaksi
- grafik penjualan mingguan
- kategori penjualan
- transaksi terbaru
- notifikasi stok menipis dan transaksi baru

### POS / Kasir

- cari produk
- cari barcode dengan Enter
- tambah item ke cart
- ubah qty
- diskon persen
- PPN
- metode bayar
- uang diterima dan kembalian
- konfirmasi hapus semua item
- proses pembayaran
- receipt modal
- cetak struk
- share WhatsApp

### Produk

- CRUD kategori
- CRUD produk
- upload foto produk
- preview barcode
- soft delete produk

### Stok

- lihat stok
- filter aman / menipis / habis
- penyesuaian stok
- edit stok admin
- riwayat stok
- nonaktifkan produk dari halaman stok

### Laporan

- summary penjualan
- chart penjualan
- kategori penjualan
- riwayat transaksi
- export Excel

### Pengaturan

- identitas toko
- header dan footer struk
- pajak / diskon
- daftar pengguna

## 5. Akun Demo

Saat ini akun demo yang dipakai:

- Admin: `admin@ratih.com` / `Admin@123`
- Kasir: `kasir1@ratih.com` / `Kasir@123`

Kalau database di-reset, akun auth bisa perlu dibuat ulang tergantung kondisi Supabase local.

## 6. Kondisi Data Awal

Seed sekarang sengaja dibuat bersih:

- kategori = kosong
- produk = kosong

Jadi alur awal setelah login admin:

1. buat kategori dulu
2. buat produk
3. baru lakukan transaksi

## 7. Cara Menjalankan App

### A. Jalankan Colima

Kalau Docker local pakai Colima:

```bash
colima start
```

### B. Jalankan Supabase Local

Di folder project:

```bash
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
supabase start
```

Supabase penting yang dipakai:

- API URL: `http://localhost:54321`
- Studio: `http://localhost:54323`

### C. Cek `.env.local`

Isi `.env.local` yang dipakai frontend:

```env
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=...
```

Kalau butuh lihat key lagi:

```bash
supabase status -o env
```

Lalu ambil value `ANON_KEY`.

### D. Apply migration dan seed

Kalau mau reset database ke kondisi project terbaru:

```bash
supabase db reset
```

Ini akan menjalankan:

- schema awal
- function laporan
- transaction atomic
- fix RLS
- dashboard function
- seed settings toko

### E. Jalankan frontend

```bash
npm install
npm run dev
```

Lalu buka:

[http://localhost:5173](http://localhost:5173)

## 8. Checklist Run Cepat

Kalau mau dari nol sampai jalan:

```bash
cd /Users/ezi/Documents/Coding/toko-plastik-ratih-pos
colima start
supabase start
supabase db reset
npm install
npm run dev
```

Lalu:

1. buka app di browser (`http://localhost:5173`)
2. buat akun dan registrasi toko pertama lewat `/register`
3. buka Pengaturan > Kelola Pengguna untuk menambah akun kasir jika diperlukan
4. buat kategori
5. buat produk
6. test transaksi kasir

## 9. File Penting untuk Operasional

### Konfigurasi frontend

- `src/lib/supabase.ts`
- `.env.local`

### Query dan logic utama

- `src/api/transactions.ts`
- `src/api/products.ts`
- `src/api/reports.ts`
- `src/api/stock.ts`
- `src/api/settings.ts`

### Store utama

- `src/stores/authStore.ts`
- `src/stores/cartStore.ts`
- `src/stores/uiStore.ts`

### Halaman utama

- `src/pages/LoginPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/POSPage.tsx`
- `src/pages/ProductsPage.tsx`
- `src/pages/StockPage.tsx`
- `src/pages/ReportsPage.tsx`
- `src/pages/SettingsPage.tsx`

### Migration penting

- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_reports_functions.sql`
- `supabase/migrations/003_atomic_transaction.sql`
- `supabase/migrations/004_fix_rls_policies.sql`
- `supabase/migrations/005_dashboard_function.sql`
- `supabase/migrations/006_fix_atomic_transaction_json_input.sql`

## 10. Hal Penting yang Sudah Diperbaiki

Beberapa bug besar yang sudah dipatch:

- transaksi sekarang atomic di database, jadi lebih aman dari race condition stok
- policy RLS sudah dibatasi, tidak permissive seperti awal
- dashboard stats sudah pakai RPC
- barcode search tidak terlalu agresif
- clear cart reset PPN
- auth loading tidak hang selamanya
- input uang diterima lebih stabil
- ada konfirmasi hapus semua cart
- sidebar tidak lagi hardcoded di POS
- ada unit test untuk cart store dan currency

## 11. Testing yang Bisa Dijalanin

### Unit test

```bash
npx vitest run
```

### Type check

```bash
npx tsc --noEmit
```

### Lint

```bash
npm run lint
```

### Production build

```bash
npm run build
```

## 12. Catatan Penting

### Produk dan kategori

- kategori harus dibuat dulu sebelum produk
- produk dihapus dengan model nonaktif / soft delete
- kategori tidak bisa dinonaktifkan kalau masih dipakai produk

### Storage foto produk

Kalau upload foto produk mau dipakai, bucket Supabase Storage harus ada:

- bucket name: `products`
- public: `true`

### Cetak struk

Secara UI sudah ada, tapi untuk printer fisik tetap perlu test langsung di device toko.

### WhatsApp

Share WhatsApp memakai link `wa.me`, jadi butuh browser/device yang support.

## 13. Saran Alur Pemakaian untuk Toko

Alur paling aman buat mulai pakai:

1. login sebagai admin
2. isi pengaturan toko
3. buat kategori
4. input semua produk
5. cek stok minimum tiap produk
6. test 2-3 transaksi
7. cek dashboard, stok, dan laporan
8. baru dipakai kasir harian

## 14. Kalau Ada Error

Urutan debug paling aman:

1. cek Supabase masih hidup:

```bash
supabase status
```

2. cek frontend masih hidup:

```bash
npm run dev
```

3. kalau schema kacau atau function belum kebaca:

```bash
supabase db reset
```

4. kalau UI aneh setelah update:

- hard refresh browser
- buka ulang `http://localhost:5173`

## 15. Ringkasan Singkat

App ini sudah siap dipakai sebagai dasar POS toko plastik dengan:

- auth admin/kasir
- transaksi kasir
- manajemen produk dan kategori
- stok
- laporan
- pengaturan

Untuk penggunaan toko nyata, langkah terpenting sekarang adalah:

- isi kategori
- isi produk
- test transaksi nyata
- pastikan printer dan storage foto sesuai kebutuhan toko
