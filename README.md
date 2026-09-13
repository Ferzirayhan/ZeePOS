<div align="center">
  <h1>ZeePOS</h1>
  <p><strong>Universal Cloud Point of Sale & Retail Management Platform</strong></p>
  <p>Cepat, responsif, dan siap pakai untuk berbagai jenis usaha ritel, grosir, hingga FnB.</p>
  <p><em>Mode offline bersifat katalog-only: kasir dapat menelusuri katalog produk tanpa koneksi, namun checkout wajib online.</em></p>
</div>

---

## Fitur Utama

- ⚡ **Antarmuka Kasir Cepat (POS)**: Didesain untuk efisiensi tinggi dengan layout 2-pane, navigasi shortcut keyboard lengkap (F1–F10), dan virtual numpad untuk layar sentuh.
- 📦 **Konversi Multi-Satuan Produk**: Dukungan penjualan berjenjang (Pcs, Lusin, Dus, Bal, Roll, Kg) dengan kalkulasi potong stok rasio otomatis.
- 👥 **Pelanggan & Buku Piutang**: Manajemen member, pencatatan transaksi tempo / bon hutang, dan riwayat pelunasan cicilan terintegrasi.
- 🖨️ **Dukungan Perangkat Keras Ritel**:
  - Direct Thermal ESC/POS USB (WebUSB API murni, tanpa driver tambahan).
  - Scanner Barcode Kamera & USB Handheld Scanner.
  - Audio synthesizer native (Web Audio API) untuk konfirmasi scan.
- ⏸️ **Parkir Transaksi (Hold Cart)**: Tahan pesanan aktif untuk melayani antrean lain tanpa risiko data transaksi hilang.
- 📊 **Laporan Finansial & Audit Trail**: Ringkasan omset harian/bulanan, analisis margin keuntungan, jejak audit aktivitas kasir, dan export data ke spreadsheet Excel.
- 🔒 **Arsitektur Multi-Tenant & Keamanan**: Didukung Row-Level Security (RLS) PostgreSQL, transaksi database atomik (ACID), serta hak akses berjenjang (Admin & Kasir).

---

## Tech Stack

- **Framework**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v3](https://tailwindcss.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL 17 sesuai konfigurasi lokal, Auth, PostgREST RPC)
- **Testing**: [Vitest](https://vitest.dev/) + React Testing Library

---

## Memulai Cepat

### Prasyarat
- Node.js 18.x atau versi lebih baru
- npm 9.x atau versi lebih baru

### Instalasi

1. Clone repositori:
   ```bash
   git clone https://github.com/Ferzirayhan/ZeePOS.git
   cd ZeePOS
   ```

2. Pasang dependensi:
   ```bash
   npm install
   ```

3. Konfigurasi kredensial lingkungan:
   Buat file `.env.local` di root direktori:
   ```env
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Jalankan server lokal:
   ```bash
   npm run dev
   ```

Aplikasi dapat diakses melalui `http://localhost:5173`.

---

## Script NPM

- `npm run dev`: Menjalankan server pengembangan Vite lokal.
- `npm run build`: Memeriksa tipe TypeScript dan membangun aset produksi (`dist/`).
- `npm run lint`: Memvalidasi kode menggunakan ESLint.
- `npm test`: Menjalankan pengujian otomatis menggunakan Vitest.
- `npm run test:coverage`: Menjalankan pengujian dan membuat laporan coverage text, JSON, dan HTML.
- `npm run preview`: Menjalankan pratinjau hasil build lokal.

---

## Deployment

Ikuti [Deployment runbook](docs/DEPLOYMENT.md) untuk urutan migrasi Supabase, backup, konfigurasi auth/storage, smoke test, dan rollback. Lihat juga [baseline audit dependensi](docs/SECURITY.md).

Aplikasi ini siap dideploy ke platform hosting statis modern:

### Cloudflare Pages
- **Framework Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Redirects SPA**: Menggunakan file `public/_redirects` bawaan.

### Vercel
- Hubungkan repositori langsung ke Vercel. Konfigurasi rewrite SPA sudah disediakan dalam `vercel.json`.

---

## Lisensi

Didistribusikan untuk operasional ZeePOS. Seluruh hak cipta dilindungi.
