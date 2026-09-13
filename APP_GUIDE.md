# ZeePOS Documentation & Guide

Panduan lengkap arsitektur, alur fitur, dan cara menjalankan ZeePOS Universal SaaS Point of Sale.

---

## 1. Gambaran Aplikasi

ZeePOS adalah platform kasir dan operasional ritel / FnB modern berbasis cloud yang dirancang untuk kecepatan transaksi, skalabilitas multi-tenant, serta mode offline catalog-only. Saat koneksi terputus, kasir tetap dapat menelusuri katalog produk yang di-cache per-tenant di IndexedDB, namun checkout (transaksi) dinonaktifkan sampai koneksi pulih — tidak ada penjualan offline.

### Fitur Utama:
- **Kasir & Point of Sale (POS)**: 
  - Dukungan Barcode Scanner (Kamera & USB Barcode Reader).
  - Shortcut Keyboard kasir lengkap (F1 Cari, F2 Tahan Bon, F8 Scanner, F9 Daftar Bon, F10 Bayar, Space Konfirmasi).
  - Virtual Numpad modal untuk layar touchscreen kasir tablet / all-in-one POS.
  - Multi-Satuan Produk (Jual per Pcs, Dus, Lusin, Pack, Roll, Kg dengan konversi stok otomatis).
  - Hold / Parkir Bon Transaksi tanpa hilang saat melayani pelanggan lain.
  - Cetak Struk Direct Thermal ESC/POS (WebUSB) & browser print.
  - Pembayaran Fleksibel: Tunai, QRIS, Transfer Bank, dan Bon / Tempo (Hutang).
- **Manajemen Pelanggan & Buku Piutang**:
  - Pencatatan member / pelanggan setia.
  - Buku bon piutang otomatis dengan tracking jatuh tempo.
  - Pembayaran cicilan / pelunasan piutang atomik.
- **Katalog & Stok Realtime**:
  - Manajemen kategori & produk multi-satuan.
  - Riwayat stok dan adjustment opname.
  - Indikator stok menipis dan auto badge status.
- **Laporan Finansial & Audit**:
  - Laporan laba kotor, omset harian/bulanan, dan top produk terlaris.
  - Export data ke format Excel (.xlsx).
  - Jejak audit log keamanan setiap transaksi dan modifikasi harga.
- **Manajemen Toko & Kasir**:
  - Shift kasir & pencatatan uang modal awal/akhir.
  - Role-based Access Control (Admin & Kasir).

---

## 2. Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v3
- **State Management**: Zustand
- **Database & Auth**: Supabase (PostgreSQL 15+, Row-Level Security, PostgREST RPC)
- **Offline Engine**: IndexedDB catalog cache (catalog-only, per-tenant, no offline sales) & Native Web Audio API Synthesizer
- **Testing**: Vitest & React Testing Library

---

## 3. Struktur Project

```text
├── src/
│   ├── api/                 # Data access layer & Supabase RPC callers
│   ├── components/
│   │   ├── app/             # App shell, brand mark, error boundary
│   │   ├── auth/            # Auth guards & providers
│   │   ├── layout/          # Sidebar, header, navigation
│   │   ├── pos/             # Modul kasir: cart, numpad, scanner, receipt
│   │   └── ui/              # Reusable atomic UI components
│   ├── hooks/               # Custom React hooks (debounce, print, pagination)
│   ├── lib/                 # Supabase client singleton
│   ├── pages/               # Halaman modul POS, Pelanggan, Produk, Laporan
│   ├── stores/              # Zustand stores (cart, held-cart, auth, ui)
│   ├── types/               # TypeScript type definitions & Supabase DB schema
│   └── utils/               # Native audio, ESC/POS generator, formatters
├── supabase/
│   └── migrations/          # Migration SQL skema DB, RLS policies & RPC functions
├── public/                  # Manifest PWA, favicon, robots, redirects
└── tailwind.config.js       # Konfigurasi styling Tailwind
```

---

## 4. Cara Menjalankan Project

### Instalasi Dependensi
```bash
npm install
```

### Konfigurasi Environment
Salin file `.env.example` ke `.env.local`:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Menjalankan Server Development
```bash
npm run dev
```
Buka browser di `http://localhost:5173`.

### Validasi Kode & Testing
```bash
npm run lint
npm test
npm run build
```

---

## 5. Deployment

Aplikasi ini adalah Single Page Application (SPA) yang sudah dilengkapi konfigurasi redirect untuk Cloudflare Pages dan Vercel:
- **Cloudflare Pages**: Build output `dist`, build command `npm run build`, rule routing `public/_redirects`.
- **Vercel**: Dilengkapi dengan `vercel.json` rewrite rule `/* -> /index.html`.
