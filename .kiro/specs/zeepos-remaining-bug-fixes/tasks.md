# Implementation Plan

## Cara Membaca Daftar Ini

**Penanda pelaksana** (wajib diperhatikan sebelum mulai):

- **[AGENT]** — dapat dikerjakan sepenuhnya oleh coding agent di repo ini.
- **[USER]** — **tidak dapat** dikerjakan agent. Butuh akses dashboard Supabase, keputusan tingkat organisasi, service-role key, atau peramban. Batasan mesin: Docker mati, `psql` tidak terpasang, dan hanya project **produksi** (`dfgqioglsirftfyjyswd`) yang ter-link. Setiap `supabase link`, `supabase db push`, blok SQL Editor, skrip service-role, dan uji asap peramban adalah **[USER]**.

**Aturan urutan yang tidak boleh dilanggar** (sumber: [Strategi Migrasi](design.md#strategi-migrasi)):

1. Migrasi **aditif** (067) diterapkan **sebelum** frontend yang memakainya. Dibalik → "relation does not exist", halaman Produk/Laporan/struk mati.
2. Migrasi **subtraktif** (068) diterapkan **hanya setelah** frontend build #1 live. Dibalik → `select('*')` gagal total (bukan mengosongkan kolom), katalog/struk kasir dan daftar produk admin mati, `/dashboard` kasir error 42501.
3. 069 (storage) diterapkan **hanya setelah** audit path selesai dan nol objek non-konforman.
4. Setiap task disusun agar **tidak ada titik di mana jalur kasir rusak bila pekerjaan dihentikan di situ**. Pasangan yang **wajib rilis bersamaan** ditandai eksplisit di teks task: (a) ~~UI refund + filter `status = 'selesai'` pada leg tunai `close_cash_shift`~~ — **LARUT 2026-09-22**, klausa 2.13 dibatalkan atas keputusan pemilik sehingga `close_cash_shift` tidak diubah sama sekali (lihat 6.2 dan 9); (b) `/dashboard` di bawah `AdminRoute` + fallback `AdminRoute` ke `/pos` — **tetap berlaku**.

**Catatan migrasi 066/067 yang menentukan urutan SQL:**

- 066 **tidak diubah**. 067 memuat re-emit `create_transaction_atomic` **di atas** versi 066: pembulatan rupiah bulat dan `DELETE FROM tmp_demand` dipertahankan **verbatim**, ditambah `jatuh_tempo`.
- `get_top_products` **wajib** disentuh 066 lebih dulu (066 punya `DROP FUNCTION` karena `total_qty` berubah BIGINT → NUMERIC). 068 baru menambahkan guard `is_admin()` lewat `CREATE OR REPLACE`. Bila 068 dijalankan atas signature lama, `CREATE OR REPLACE` gagal.

**Protokol temuan baru (klausa 1.18 / 2.18):** setiap cacat yang ditemukan saat audit atau saat implementasi **dicatat sebagai klausa baru di `bugfix.md`** (1.19+ / 2.19+ / 3.14+) beserta severity, **bukan diperbaiki diam-diam**. Bila salah satu *exploratory check* membantah hipotesisnya, `design.md` bagian [Hypothesized Root Cause](design.md#hypothesized-root-cause) **wajib diperbarui lebih dulu sebelum fix ditulis**.

**Pembagian bentuk uji** (sumber: [Testing Strategy](design.md#testing-strategy)):

| Jenis perubahan | Bentuk uji |
|---|---|
| Fungsi murni, store, hook, komponen | Uji behavioural Vitest (wajib) |
| Bentuk & semantik SQL migrasi | Penjaga teks atas impor `?raw` |
| RLS, hak kolom, penolakan RPC | Verifikasi manual berskrip di SQL Editor dengan impersonasi `request.jwt.claims` |

---

## Fase 0 — Eksplorasi (sebelum satu baris fix pun ditulis)

- [x] 1. **[AGENT]** Tulis uji eksplorasi kondisi bug yang dapat dieksekusi di Vitest
  - **Property 1: Bug Condition** - Semua Cacat 1.1–1.18 Diperbaiki
  - **CRITICAL**: Uji-uji ini **HARUS GAGAL** pada kode belum diperbaiki. Kegagalannya adalah buktinya bahwa cacatnya ada.
  - **DO NOT attempt to fix the test or the code when it fails** pada task ini.
  - **NOTE**: uji ini sekaligus mengodekan perilaku yang diharapkan; ia akan menjadi validator fix saat lolos di task 14.1.
  - **GOAL**: memunculkan counterexample konkret untuk `isBugCondition` per sub-predikat, lihat [Bug Condition](design.md#bug-condition).
  - **Scoped PBT Approach**: cacat di batch ini deterministik, jadi properti dipersempit ke kasus gagal konkret agar reproducible; domain acak dipakai hanya di task 2 (preservation) dan di properti pembulatan/tanggal.
  - File uji baru: `src/__tests__/bugConditionExploration.test.ts` (satu file, `describe` per kasus agar counterexample mudah dibaca).
  - Kasus 5 — **refund tanpa pemanggil** (`isRefundPathBug`): asersi bahwa `rpc('refund_transaction_atomic')` **ada** di `src/api/transactions.ts`. Gagal sekarang. Pasangkan dengan asersi saat ini (nol pemanggil) sebagai dokumentasi baseline.
  - Kasus 7 — **checkout menggantung** (`isUnboundedWaitBug`): `vi.mock` `supabase.rpc` dengan promise yang **tidak pernah settle**, panggil `commitTransaction`, buktikan dengan timer palsu bahwa blok `finally` tidak pernah tereksekusi. **FALSIFIABLE**: bila `finally` ternyata berjalan, hipotesis "akarnya deadline, bukan state machine" (design C.2) terbantah → perbarui `design.md` sebelum klaster C ditulis.
  - Kasus 8 — **sesi valid dilempar ke login**: render `AuthProvider` + `PrivateRoute` dengan `getSession` tertunda 12 detik dan `vi.useFakeTimers()`, asersi terjadi navigasi ke `/login`. Catat apakah akarnya percabangan timeout atau nilai timeout.
  - Kasus 9 — **presisi numpad**: render `NumpadModal` dengan `initialValue={0.25}`, tekan `5`, asersi tampilan menjadi `0.255`.
  - Kasus 10 — **kamera scanner restart**: render `BarcodeScannerModal` di dalam induk yang di-re-render dengan prop callback inline baru, hitung `start()` pada mock `Html5Qrcode`, asersi > 1. **FALSIFIABLE**: bila `start()` hanya sekali, hipotesis dependency array (design D.4) terbantah dan penyebabnya harus dicari pada `Modal` yang me-remount anak → perbarui `design.md` sebelum D.4 ditulis.
  - Kasus 12 — **ketidakcocokan batas hari**: jalankan `getDashboardChangeSummary`/`buildDayRange` dengan `process.env.TZ = 'Asia/Makassar'` di sekitar tengah malam WIB, asersi rentangnya berbeda dari batas `Asia/Jakarta`.
  - Kasus 13 — **struk thermal kehilangan informasi**: panggil `buildReceiptBytes` dengan satu item multi-satuan, satu item pecahan, `change: 0`, dan nama produk 40 karakter; decode `Uint8Array` dan asersi munculnya `"2x"` tanpa unit, `"0.5x"`, hilangnya baris Kembalian, dan nama terpotong.
  - Jalankan `npx vitest run src/__tests__/bugConditionExploration.test.ts`.
  - **EXPECTED OUTCOME**: semua kasus **GAGAL** (benar — membuktikan cacatnya ada).
  - Dokumentasikan counterexample tiap kasus (nilai teramati, bukan sekadar "gagal") di `.kiro/specs/zeepos-remaining-bug-fixes/verification-notes.md`.
  - Task selesai bila uji tertulis, dijalankan, dan kegagalannya terdokumentasi — **bukan** bila uji lolos.
  - _Requirements: 1.1, 1.7, 1.8, 1.9, 1.10, 1.12, 1.15_
  - _Design: Property 1, Exploratory Bug Condition Checking kasus 5, 7, 8, 9, 10, 12, 13_

- [ ] 2. **[AGENT]** Tulis uji preservation baseline (SEBELUM fix apa pun)
  - **Property 2: Preservation** - Perilaku di Luar Kondisi Bug Tidak Berubah
  - **IMPORTANT**: ikuti **observation-first**: jalankan kode **BELUM diperbaiki**, **amati** keluaran nyatanya, rekam sebagai ekspektasi. Jangan menulis ekspektasi dari asumsi.
  - File uji baru: `src/__tests__/preservationBaseline.test.ts`; perluas `cartStore.test.ts`, `date.test.ts`, `useOnlineStatus.test.ts` bila lebih tepat di sana.
  - Amati & rekam — **qty bulat** (3.4): untuk qty 1..999 pada satuan diskret, rekam `subtotal`, `diskon_item_persen`, dan penolakan stok agregat lintas satuan dari `cartStore` sekarang. Ini properti paling berisiko regresi di klaster D.
  - Amati & rekam — **idempotensi checkout** (3.3): percobaan ulang payload identik memakai kunci sama; payload berubah merotasi kunci. Rekam sebagai uji atas logika `lastCheckoutFingerprintRef`.
  - Amati & rekam — **jalur offline** (3.5): `navigator.onLine = false` menonaktifkan checkout dan menyajikan katalog cache sebagai referensi.
  - Amati & rekam — **batas rentang laporan** (3.8): keluaran `getISOStartOfDay`/`getISOExclusiveEndOfDay` untuk kumpulan tanggal termasuk pergantian bulan dan tahun kabisat.
  - Amati & rekam — **struk browser** (3.13): `ReceiptPrint` merekonsiliasi baris item dengan subtotal setelah diskon.
  - Amati & rekam — **perilaku sesi** (3.12): kegagalan ambil profil mempertahankan sesi dan cache offline; logout membersihkan data meski `signOut` gagal; StrictMode tidak mendaftarkan dua listener.
  - Amati & rekam — **kolom katalog POS** (Property 6): daftar kolom yang dikembalikan `products_with_category` hari ini, dicatat eksplisit sebagai daftar nama, supaya nanti dapat dibuktikan **hanya** `harga_beli` yang hilang.
  - Property-based testing: tambahkan `fast-check` sebagai devDependency dengan **versi dipin** untuk properti `cartStore` (keranjang acak multi-satuan, invarian `Σ(qty × rasio) ≤ stok_dasar`) dan helper tanggal WIB. Bila penambahan pustaka ditolak reviewer, gantinya adalah uji tabel berdomain rapat dan **keputusan itu dicatat eksplisit** di `verification-notes.md`.
  - Jalankan `npx vitest run src/__tests__/preservationBaseline.test.ts`.
  - **EXPECTED OUTCOME**: semua **LOLOS** pada kode belum diperbaiki (ini baseline yang harus dipertahankan).
  - _Requirements: 3.3, 3.4, 3.5, 3.8, 3.11, 3.12, 3.13_
  - _Design: Property 2, 6, 14, 17, 22, 25, Preservation Checking kasus 1, 3, 5, 6, 7, 8, 9_

---

## Fase 1 — Gate Keputusan (memblokir klaster terkait)

- [ ] 3. Gate keputusan pemilik — **dua klaster tidak boleh dimulai sebelum ini terjawab**

  - [ ] 3.1 **[USER]** Putuskan mekanisme pemuatan gambar produk setelah bucket diprivatkan
    - **✅ DIPUTUSKAN 2026-09-22 oleh pemilik spec: OPSI B — signed URL TTL pendek.** `createSignedUrl(path, 3600)` dipakai langsung di `<img src>`, diperbarui sebelum kedaluwarsa. **Opsi A off the table.** Penyimpangan sadar dari keputusan produk nomor 3 ("bukan signed URL"): keputusan itu diambil sebelum biaya opsi A terlihat; opsi B jauh lebih murah, caching peramban tetap bekerja, dan tetap sah secara keamanan. **Tradeoff yang diterima:** URL bertanda tangan dapat dibagikan sampai TTL habis.
    - Konsekuensi: **19.3 = implementasi signed URL**; **`products.foto_url` wajib menghasilkan PATH objek** (disimpan sebagai path, atau path diturunkan dari URL penuh lama); **langkah 5b (purge/rotasi nama objek) TETAP WAJIB** karena jendela 1.20 berlaku pada URL `/object/public/...` lama yang sudah ter-cache — signed URL **tidak** menutup 1.20.
    - Tercatat di `design.md` → [Migrasi Kebijakan Storage](design.md#migrasi-kebijakan-storage-162639) dan `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13". **Tidak lagi memblokir task 19.**
    - **MEMBLOKIR** (sebelum diputuskan): seluruh klaster storage (task 19) dan 069.
    - Konteks yang harus dibaca: [Migrasi Kebijakan Storage](design.md#migrasi-kebijakan-storage-162639). Setelah bucket `products` menjadi privat, `<img src>` tidak dapat mengirim header `Authorization`, jadi hanya dua opsi yang tersisa.
    - **Opsi A — blob authenticated** (sesuai keputusan produk tertulis nomor 3 "bukan `public`, bukan signed URL"): `storage.from('products').download(path)` → `URL.createObjectURL`. Biaya: hook pemuat gambar + cache memori + `revokeObjectURL`, `foto_url` harus menyimpan **path objek** bukan URL penuh (atau path diturunkan dari URL lama), grid produk mengunduh N blob.
    - **Opsi B — signed URL TTL pendek**: `createSignedUrl(path, 3600)` langsung di `<img src>`. **Jauh lebih murah**, caching peramban tetap jalan, sah secara keamanan; menyimpang dari keputusan tertulis karena URL bertanda tangan dapat dibagikan sampai kedaluwarsa.
    - Rancangan **sebelum keputusan** mengasumsikan A. Keputusan "bukan signed URL" tampaknya diambil saat biaya opsi A belum terlihat, jadi konfirmasi ulang diperlukan — dan konfirmasi itu menghasilkan **opsi B** (lihat blok keputusan di atas). Asumsi A **tidak berlaku lagi**.
    - Catat keputusan di `design.md` (bagian storage) dan di `verification-notes.md`, lalu barulah task 19.3 ditulis. **Sudah dilakukan 2026-09-22.**
    - _Requirements: 2.6, 3.9_
    - _Design: Property 8, 9, Iteration and Feedback Rules butir 1_

  - [ ] 3.2 **[USER]** Putuskan backfill `receivables.jatuh_tempo` untuk piutang lama
    - **✅ DIPUTUSKAN 2026-09-22 oleh pemilik spec: BIARKAN NULL, tidak ada backfill.** Alasan yang menentukan: target **tidak punya data produksi sama sekali** — org hanya memuat satu project dan project itu UAT dengan nol transaksi bisnis, jadi **tidak ada piutang lama untuk dibackfill**. Pertanyaannya kosong dalam praktik, bukan ditunda.
    - Konsekuensi: per **6.8**, blok backfill **tidak ditulis** di 067 (bukan ditulis lalu dikomentari); baris `lunas`/`dibatalkan` tetap tidak disentuh; badge kosong di `CustomersPage` untuk piutang tanpa `jatuh_tempo` adalah **perilaku yang diharapkan, bukan bug** (lihat 12.4).
    - Tercatat di `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13". **Tidak lagi memblokir 6.8.**
    - **MEMBLOKIR** (sebelum diputuskan): butir 6 migrasi 067 (blok backfill), dan penanda "terlewat" di `CustomersPage` untuk piutang lama.
    - Opsi **backfill**: hanya baris berstatus `belum_lunas`/`sebagian`, `jatuh_tempo = created_at WIB + tenor tenant (fallback 14)`. Ini **mutasi data historis** yang mengubah tampilan aging.
    - Opsi **biarkan NULL**: badge tetap kosong untuk piutang lama; tidak ada data historis yang diubah.
    - Baris `lunas`/`dibatalkan` **tidak disentuh** apa pun keputusannya.
    - Catat keputusan di `verification-notes.md`. Bila "biarkan NULL", blok backfill di 067 **tidak ditulis** (bukan ditulis lalu dikomentari).
    - _Requirements: 2.11_
    - _Design: E.1 butir "Backfill piutang lama", Iteration and Feedback Rules butir 2_

---

## Fase 2 — Target Non-Produksi + Eksplorasi SQL (rilis langkah 1, bagian pertama)

- [ ] 4. **[USER]** Siapkan target non-produksi dan terapkan 001–066 di atasnya
  - Agent tidak dapat melakukan ini: Docker mati, `psql` tidak terpasang, dan hanya project produksi yang ter-link.
  - Pilih target: **Supabase branch** (butuh integrasi GitHub + paket berbayar; terbaik karena skemanya turun dari repo yang sama) **atau project staging terpisah** (selalu tersedia, termasuk paket gratis). Bila memilih staging terpisah, sadari konsekuensinya: **tanpa data produksi**, sehingga audit path storage (task 19.1) **wajib** dijalankan sebagai query read-only terhadap produksi.
  - `supabase link --project-ref <staging-ref>`
  - `supabase migration list --linked` (read-only) untuk mencatat versi awal.
  - `supabase db push` → menerapkan **001–066** pada database kosong. Pada titik ini 067 belum ada, jadi push ini **sengaja** berhenti di 066: itulah yang membuat eksplorasi task 5 dapat mengamati cacat yang masih hidup.
  - Ini sekaligus membuktikan seluruh rantai migrasi dapat dieksekusi dari nol — hal yang belum pernah terbukti sama sekali.
  - Bila 066 **gagal diterapkan** (syntax error / dependensi hilang): itu satu-satunya kondisi sah untuk mengedit 066 di tempat, karena migrasi yang gagal tidak meninggalkan baris versi tercatat. Perbaikan seperti itu **wajib** dicatat di `verification-notes.md`.
  - Buat satu akun kasir dan satu akun admin di staging, catat UUID keduanya — dibutuhkan blok impersonasi.
  - Tempel keluaran `migration list` dan status push ke `verification-notes.md`.
  - _Requirements: 1.16, 2.16_
  - _Design: Property 26, Jalur validasi Supabase_

- [ ] 5. **[USER]** Jalankan eksplorasi kondisi bug sisi SQL di staging (066 saja, BELUM 067/068)
  - **CRITICAL**: semua blok di bawah **HARUS BERHASIL** (yaitu memperlihatkan kebocoran/cacat). Keberhasilannya adalah buktinya. Jangan memperbaiki apa pun di task ini.
  - Jalankan di **SQL Editor** dashboard Supabase, bukan dari mesin lokal.
  - Blok impersonasi (ulangi dengan `sub` kasir):
    ```sql
    BEGIN;
    SELECT set_config('request.jwt.claims',
      json_build_object('sub','<uuid-kasir>','role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    -- Kasus 1: kebocoran RPC laporan → HARUS mengembalikan baris laba
    SELECT * FROM public.get_profit_summary(now() - interval '7 days', now());
    -- Kasus 2: kebocoran kolom biaya → HARUS berhasil
    SELECT harga_beli FROM public.products LIMIT 1;
    SELECT harga_beli, laba_kotor FROM public.transaction_items LIMIT 1;
    -- Kasus 3: kebocoran daftar staf → HARUS > 1
    SELECT count(*) FROM public.profiles;
    ROLLBACK;
    ```
  - Kasus 2 sekaligus **membuktikan temuan baru A.4**: klausa 1.4 hanya menyebut `products`, padahal `transaction_items.harga_beli`/`laba_kotor` dan agregat `transactions_with_kasir.laba_kotor` bocor dari akar yang sama. Catat ini sebagai klausa baru di `bugfix.md` (severity P0) bila belum tercatat.
  - Kasus 11 — **`jatuh_tempo` NULL**: lakukan penjualan hutang di staging (lewat UI atau `create_transaction_atomic` langsung), lalu `SELECT jatuh_tempo FROM receivables ORDER BY id DESC LIMIT 1` → harus NULL.
  - Kasus 6 — **asimetri leg tunai** (uji terpenting klaster B, menyangkut uang): buka shift, buat transaksi tunai, panggil `refund_transaction_atomic` langsung dari SQL Editor, tutup shift, periksa `total_penjualan_tunai` dan `selisih`. Harus **salah tanda / salah nilai** karena leg tunai belum menyaring `status`. Catat angka persisnya — angka ini yang harus berubah setelah 067.
  - Kasus 4 — **falsifikasi hipotesis bucket publik**: `curl -i "<url>/storage/v1/object/public/products/<tenant>/<file>"` tanpa header autentikasi → harap 200. Lalu **di staging saja**, terapkan penyempitan policy `product_images_tenant_select` **tanpa** `UPDATE storage.buckets SET public = false`, dan ulangi `curl`.
    - Bila **tetap 200** → hipotesis "endpoint publik melewati RLS" terkonfirmasi, privatisasi bucket wajib, dan gate 3.1 tetap relevan.
    - Bila **menjadi 403** → **hipotesis TERBANTAH**: penyempitan policy saja cukup, opsi A/B pemuatan gambar **tidak diperlukan**. Wajib: perbarui `design.md` (bagian storage + Hypothesized Root Cause), batalkan gate 3.1, dan sederhanakan task 19 **sebelum** satu baris kode gambar ditulis.
    - Balikkan perubahan policy percobaan itu di staging setelah pengamatan selesai.
  - Tempel seluruh keluaran ke `verification-notes.md` (tanggal, penguji, nilai teramati).
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 1.11, 1.13_
  - _Design: Exploratory Bug Condition Checking kasus 1, 2, 3, 4, 6, 11; Expected Counterexamples_

---

## Fase 3 — Migrasi 067 (aditif, netral urutan)

- [ ] 6. **[AGENT]** Tulis `supabase/migrations/067_receivable_tempo_refund_symmetry_and_read_paths.sql`
  - **Sifat: ADITIF.** Hanya menambah objek/kemampuan atau mengubah bentuk view secara tidak-merusak. Boleh diterapkan sebelum maupun sesudah deploy frontend.
  - Satu-satunya degradasi yang diterima: setelah 067, `ProductsPage` kehilangan `harga_beli` (Margin% menjadi 0) sampai frontend beralih ke `products_admin_with_category`. Itu **degradasi tampilan admin, bukan error** — jauh lebih aman daripada urutan sebaliknya.
  - Header file **wajib** memuat komentar eksplisit mengapa `create_transaction_atomic` muncul dua kali dalam satu batch (066 lalu 067), supaya reviewer tidak bingung.
  - Ikuti house style repo: `SET search_path = pg_catalog, public`, dan setiap fungsi/view diikuti blok `REVOKE ALL ... FROM PUBLIC, anon; GRANT ... TO authenticated, service_role;` (konvensi sejak migrasi 062).

  - [ ] 6.1 Re-emit `create_transaction_atomic` = versi 066 + `jatuh_tempo`
    - Pertahankan **verbatim** seluruh perubahan 066: pembulatan rupiah bulat (`ROUND(..., 0)` per tahap, urutan per baris → diskon transaksi → PPN) dan `DELETE FROM tmp_demand`.
    - Baca setelan dengan pola yang sama seperti `ppn_persen`: `SELECT value INTO v_setting_tempo FROM public.store_settings WHERE tenant_id = v_tenant_id AND key = 'tempo_hutang_hari';` lalu `v_tempo_hari := LEAST(GREATEST(COALESCE(NULLIF(v_setting_tempo,'')::INTEGER, 14), 0), 365);`
    - `INSERT INTO public.receivables` memperoleh `jatuh_tempo = ((COALESCE(v_paid_at, NOW()) AT TIME ZONE 'Asia/Jakarta')::date + v_tempo_hari)`. Tanggal WIB dipakai agar tempo tidak bergeser sehari untuk transaksi malam.
    - `tempo_hutang_hari` **TIDAK** dimasukkan ke `request_fingerprint`, alasan sama dengan `ppn_persen`: menambahkannya membatalkan recovery respons-hilang setiap kali admin mengubah tenor di tengah jalan.
    - _Requirements: 2.11, 3.3_
    - _Design: E.1, Property 19, 20_

  - [ ] 6.2 **TIDAK ADA PERUBAHAN PADA `close_cash_shift`** — klausa 2.13 dibatalkan 2026-09-22 atas keputusan pemilik
    - **Tindakan yang diminta task ini sekarang: tidak melakukan apa pun pada fungsi itu.** Migrasi 067 **tidak me-re-emit `close_cash_shift` sama sekali** — bukan "di-re-emit verbatim dari 064", tetapi **tidak disentuh**. Fungsi yang live tetap versi **064**.
    - Alasannya empiris, bukan preferensi: leg tunai **tanpa** filter `status` menghasilkan `selisih` **0 yang cocok dengan uang fisik**, sedangkan menambahkan `AND status = 'selesai'` membuat `selisih` **salah sebesar nominal refund** (**+12.500** pada kasus uji satu shift) dan **tidak berpengaruh apa pun** pada skenario lintas shift. Angka lengkapnya: `verification-notes.md` → "Task 5 … Kasus 6".
    - Konsekuensi: syarat **"WAJIB SATU MIGRASI DENGAN PENGAKTIFAN REFUND" LARUT** — tidak ada lagi perubahan `close_cash_shift` yang perlu dipasangkan dengan UI refund (task 9). **Property 11 sudah dirumuskan ulang** di `design.md` dan tidak lagi mengasersikan filter itu.
    - Penjaga teks CI di **6.10** karenanya **tidak boleh** mengasersikan `status = 'selesai'` pada leg tunai 067; asersi itu dihapus dari daftar.
    - Rujukan keputusan: `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".
    - _Requirements: 2.2, 3.6_ (2.13 **dibatalkan**, tidak lagi menjadi requirement task ini)
    - _Design: B.4 (blok keputusan 2026-09-22), Property 11 versi baru, Property 12_

  - [ ] 6.3 Re-emit `refund_transaction_atomic(integer, text, text)` = versi 060 + syarat shift untuk refund tunai
    - Body 060 dipertahankan utuh: admin-only, alasan wajib, kunci idempotensi wajib, fingerprint `sha256({transaction_id, alasan})`, tolak `status='batal'`, tolak `payment_status <> 'dibayar'`, tolak `inventory_snapshot_status='ambiguous_legacy'`, batalkan piutang bila metode hutang dan belum ada cicilan, pulihkan stok dari `base_qty` dengan row lock, catat `stock_adjustments`, tulis `transaction_refunds`, set `batal`, tulis audit log.
    - Satu tambahan: bila `v_trx.metode_bayar = 'tunai'` dan `v_shift_id IS NULL` → `RAISE EXCEPTION 'Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.'`
    - Refund non-tunai (QRIS/transfer/hutang) **tidak** butuh shift.
    - _Requirements: 2.1, 2.2_
    - _Design: B.5, Property 10_

  - [ ] 6.4 Re-emit `products_with_category` dengan daftar kolom **eksplisit** tanpa `harga_beli`
    - Ganti `p.*` menjadi daftar kolom eksplisit supaya kolom baru pada `products` tidak pernah bocor diam-diam lagi. Pertahankan `security_invoker = true`.
    - Kolom yang **wajib tetap ada** (Property 6, jalur POS): `id`, `nama`, `sku`, `barcode`, `satuan`, `harga_jual`, `stok`, `stok_minimum`, `stok_status`, `diskon_produk_persen`, `foto_url`, `category_id`, `category_nama`, `is_active`, `product_group_id`.
    - Konsekuensi yang diinginkan: `select('*')` di POSPage tetap jalan **tanpa satu baris perubahan** karena `*` mengekspansi kolom view.
    - _Requirements: 2.4, 3.5, 3.11_
    - _Design: A.3, Property 5, 6_

  - [ ] 6.5 Buat view jalur admin: `products_admin_with_category`, `product_units_admin`
    - Keduanya `security_invoker = false` (dieksekusi sebagai pemilik, jadi lolos column privileges) dengan guard **di dalam definisi view**: `WHERE p.tenant_id = public.get_my_tenant_id() AND public.is_admin()`.
    - `products_admin_with_category` = semua kolom view kasir **plus** `harga_beli`.
    - `REVOKE ALL ... FROM PUBLIC, anon; GRANT SELECT ... TO authenticated;`
    - _Requirements: 2.4, 3.1_
    - _Design: A.3, Property 4, 5_

  - [ ] 6.6 Buat `transaction_items_public`; re-emit `transactions_with_kasir`; buat `transactions_with_kasir_admin`
    - `transaction_items_public`: `security_invoker = true`, **tanpa** `harga_beli` dan `laba_kotor`. Ini yang membuat kasir tetap bisa mencetak ulang struk transaksinya.
    - `transactions_with_kasir` di-re-emit **tanpa** kolom agregat `laba_kotor`, dan **`security_invoker = false` + guard tenant eksplisit** (`WHERE t.tenant_id = public.get_my_tenant_id()`). Alasan `security_invoker = false` di sini bukan privilese biaya, melainkan agar `kasir_nama` tetap resolve setelah `profiles_tenant_select` dipersempit di 068 — tanpa ini, nama kasir lain menjadi NULL bagi kasir dan atribusi yang diandalkan 3.6 rusak.
    - `transactions_with_kasir_admin`: `security_invoker = false`, guard `tenant_id = get_my_tenant_id() AND is_admin()`, **memuat** `laba_kotor`.
    - RPC laporan tidak terpengaruh karena `SECURITY DEFINER` berjalan sebagai pemilik.
    - _Requirements: 2.4, 2.5, 3.1, 3.6_
    - _Design: A.4, A.5, Property 5, 7_

  - [ ] 6.7 RPC baru `get_cash_receipts_summary(p_date_from timestamptz, p_date_to timestamptz)`
    - `SECURITY DEFINER`, digerbangi `is_admin()`, batas atas **eksklusif**.
    - Kolom keluaran: `omzet_akrual` (`SUM(total)` transaksi `selesai`+`dibayar`), `kas_dari_penjualan` (idem tetapi `metode_bayar IN ('tunai','qris','transfer')`, berbasis `paid_at`), `kas_dari_cicilan` (`SUM(receivable_payments.jumlah)`), `refund_kas` (`SUM(transaction_refunds.amount)`), `kas_diterima` = `kas_dari_penjualan + kas_dari_cicilan − refund_kas`, `piutang_baru` (`SUM(total)` transaksi `metode_bayar='hutang'`).
    - Satu RPC, bukan beberapa query klien, supaya semua leg memakai batas WIB dan definisi yang sama dan gerbang `is_admin()` tetap satu tempat.
    - `get_profit_summary` **tidak** diubah semantiknya — basis akrual dipertahankan (keputusan produk 4).
    - _Requirements: 2.14_
    - _Design: E.3, Property 23_

  - [ ] 6.8 Seed `tempo_hutang_hari` = `'14'` untuk tenant yang belum punya; **tanpa blok backfill `jatuh_tempo`** (gate 3.2 diputuskan)
    - Seed bersifat idempoten (`ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`).
    - **Gate 3.2 diputuskan 2026-09-22: biarkan NULL.** Blok backfill **TIDAK DITULIS** di 067 — **bukan** ditulis lalu dikomentari. Alasan yang menentukan: tidak ada data produksi sama sekali, jadi tidak ada piutang lama untuk dibackfill. Baris `lunas`/`dibatalkan` tetap tidak disentuh.
    - Rancangan lama (bila ternyata "backfill" dipilih, **tidak dipakai**): hanya `belum_lunas`/`sebagian`, `created_at` WIB + tenor tenant (fallback 14), dalam blok terpisah berkomentar jelas bahwa ini mutasi data historis.
    - _Requirements: 2.11_
    - _Design: E.1_

  - [ ] 6.9 Buat view audit path storage `product_image_path_audit` (read-only, admin-only)
    - Memetakan objek non-konforman ke tenant pemiliknya lewat `products.foto_url`, mengeluarkan `object_name`, `tenant_id`, `product_id`, `target_name` (= `tenant_id || '/' || basename`).
    - Dipakai skrip pemindahan objek di task 19.2. Dibuat di 067 supaya audit dapat dijalankan jauh sebelum 069.
    - _Requirements: 2.6, 3.9_
    - _Design: Migrasi Kebijakan Storage langkah 2, Property 9_

  - [ ] 6.10 Tambah penjaga teks CI untuk 067
    - Perluas `src/__tests__/securityMigration.test.ts` (atau file penjaga baru) dengan impor `?raw` atas `067_*.sql`.
    - Asersi bentuk, bukan perilaku: `jatuh_tempo` ada di blok `INSERT INTO public.receivables`; `tempo_hutang_hari` **tidak** muncul di perhitungan `request_fingerprint`; ~~leg tunai `close_cash_shift` memuat `status = 'selesai'`~~ **(DIHAPUS 2026-09-22 — 2.13 dibatalkan, 067 tidak menyentuh `close_cash_shift`; bila perlu, asersikan sebaliknya: berkas 067 **tidak memuat** `close_cash_shift`)**; `refund_transaction_atomic` memuat pesan "Refund tunai membutuhkan shift kasir aktif"; `products_with_category` **tidak** memuat `harga_beli`; `products_admin_with_category` memuat `security_invoker = false` dan `is_admin()`; `transactions_with_kasir` tidak memuat `laba_kotor`; `DELETE FROM tmp_demand` dan `ROUND(` masih ada (bukti 066 tidak hilang saat re-emit).
    - Ini bukti terkuat yang tersedia di CI: tanpa Docker/`psql`, CI tidak punya Postgres. **Tidak ada pemeriksaan sintaks SQL yang mungkin dilakukan di mesin ini** — batas nyata yang diterima, bukan ditutupi.
    - _Requirements: 2.16_
    - _Design: Testing Strategy (bentuk & semantik SQL migrasi), Property 26_

- [ ] 7. **[USER]** Terapkan 067 ke staging, verifikasi, lalu 066+067 ke produksi (rilis langkah 1, bagian kedua)
  - `supabase db push` ke staging (target masih ter-link dari task 4) → menerapkan 067.
  - Jalankan blok verifikasi SQL Editor bagian "sebelum 068": query hak EXECUTE (harapan `anon_execute = false` untuk semua), inventaris policy storage, flag bucket, dan **query `security_invoker` per view** (harapan: `t` untuk `products_with_category` dan `transaction_items_public`; `f` untuk `products_admin_with_category`, `product_units_admin`, `transactions_with_kasir`, `transactions_with_kasir_admin`).
  - Verifikasi kasus 6 — **sekarang berupa preservation, bukan perbaikan** (2.13 dibatalkan 2026-09-22, 067 tidak menyentuh `close_cash_shift`): ulangi skenario tunai → refund → tutup shift; `total_penjualan_tunai` dan `selisih` harus **tetap** cocok dengan uang fisik dan **identik** dengan angka yang dicatat di task 5 (keempat shift `selisih = 0`). Angka yang **berubah** di sini adalah tanda ada yang salah, bukan tanda perbaikan berhasil.
  - Verifikasi kasus 11 sekarang benar: penjualan hutang baru → `receivables.jatuh_tempo` = tanggal WIB + `tempo_hutang_hari`.
  - Verifikasi preservation: shift **tanpa** refund menghasilkan `total_penjualan_tunai`, `total_penjualan_non_tunai`, `selisih` identik dengan sebelum 067.
  - Lalu produksi: `supabase link --project-ref dfgqioglsirftfyjyswd`, `supabase db push --dry-run` (sadari: dry-run **tidak** mem-parse SQL, hanya membandingkan daftar versi), lalu `supabase db push` → **066 dan 067 diterapkan dalam satu sesi**.
  - Pada titik ini belum ada perilaku kasir yang berubah. Degradasi sementara: kolom Margin% di halaman Produk admin bernilai 0 sampai build #1 live.
  - Tempel semua hasil ke `verification-notes.md`.
  - _Requirements: 2.16, 3.6_
  - _Design: Strategi Migrasi langkah 1, Property 12, 26_

---

## Fase 4 — Frontend Build #1 (rilis langkah 2)

Semua task di fase ini **wajib** masuk ke satu build yang sama. 068 tidak boleh diterapkan sebelum build ini live di produksi.

- [ ] 8. **[AGENT]** Klaster A — peralihan sumber baca sisi otorisasi (paling berisiko dalam batch)
  - **Mengapa fine-grained**: `select('*')` gagal **seluruhnya** bila satu kolom tidak berhak, bukan mengosongkan kolom itu. Satu call site yang terlewat = halaman mati setelah 068. Setiap call site punya item sendiri agar dapat dicentang satu-satu.
  - Setelah setiap sub-task, jalankan `npm run lint` dan `npx tsc --noEmit` (atau `npm run build`) agar tipe view baru tervalidasi.

  - [ ] 8.1 `/dashboard` di bawah `AdminRoute` **DAN** fallback `AdminRoute` diubah ke `/pos` — **SATU COMMIT, TIDAK BOLEH DIPISAH**
    - `src/App.tsx`: bungkus `<Route path="/dashboard" element={<DashboardPage />} />` (baris ~41) dengan `<AdminRoute>`.
    - `src/components/auth/AdminRoute.tsx`: ubah `return <Navigate to="/dashboard" replace />` (baris ~18) menjadi `/pos`.
    - **Mengapa tidak boleh dipisah**: tanpa perubahan fallback, kasir yang membuka `/produk` diarahkan ke `/dashboard`, yang kini juga `AdminRoute`, yang mengarahkannya ke `/dashboard` lagi → **redirect loop**. Ini konsekuensi paling mudah terlewat dari klausa 2.3, dan merupakan cacat baru yang **kita perkenalkan sendiri** bila 2.3 dikerjakan setengah.
    - Uji behavioural wajib: render router dengan sesi kasir, buka `/produk` → berakhir di `/pos` dan **jumlah navigasi terbatas** (bukti tidak ada loop).
    - _Requirements: 2.3_
    - _Design: A.2, Property 3, temuan perancangan nomor 3 (severity P1)_

  - [ ] 8.2 Rute masuk & navigasi non-admin
    - `src/pages/LoginPage.tsx`: default `from` menjadi `/pos` untuk non-admin, tetap `/dashboard` untuk admin.
    - `src/pages/RegisterPage.tsx`: tetap `/dashboard` (pendaftar selalu admin tenant baru).
    - `src/pages/NotFoundPage.tsx`: tautan menunjuk `/pos`.
    - `src/components/layout/Sidebar.tsx`: sembunyikan item Dashboard untuk non-admin.
    - _Requirements: 2.3_
    - _Design: A.2_

  - [ ] 8.3 `src/api/products.ts` — tambah jalur baca admin
    - Tambah `getAdminProductsPage` atau opsi `source: 'admin'` yang membaca `products_admin_with_category`.
    - **Jangan** mengubah `getProductsPage`, `getProducts`, `getProductByBarcode` (baris ~49, ~87, ~129, ~456, ~470): keempatnya memakai `products_with_category` dan **aman tanpa perubahan**. Verifikasi eksplisit, jangan diasumsikan.
    - _Requirements: 2.4, 3.1_
    - _Design: A.3, Property 5, 6_

  - [ ] 8.4 `src/pages/ProductsPage.tsx` — daftar admin beralih ke view admin
    - Daftar produk, kolom Harga Beli, kolom Margin%, dan sorting `harga_beli` membaca `products_admin_with_category`.
    - _Requirements: 2.4, 3.1_
    - _Design: A.3, Property 4_

  - [ ] 8.5 `src/pages/ProductsPage.tsx` — ekspor XLSX beralih ke view admin
    - Ekspor tetap memuat Harga Beli (3.1). Item terpisah dari 8.4 karena ekspor sering memakai query sendiri dan mudah terlewat.
    - _Requirements: 3.1_
    - _Design: A.3, area audit ProductsPage ("kebocoran kolom biaya ke file")_

  - [ ] 8.6 `createProduct` — ganti `.insert(payload).select('*')` menjadi daftar kolom eksplisit
    - `src/api/products.ts`. `select('*')` pada tabel `products` **akan gagal keras** setelah REVOKE 068.
    - Daftar kolom eksplisit tanpa `harga_beli`; bila UI butuh nilai baru, baca ulang dari `products_admin_with_category`.
    - _Requirements: 2.4, 3.1, 3.2_
    - _Design: A.3 ("Dampak yang harus ditangani bersamaan")_

  - [ ] 8.7 `updateProduct` — ganti `.update(payload).select('*')` menjadi daftar kolom eksplisit
    - Perlakuan identik dengan 8.6. Item terpisah karena keduanya adalah call site berbeda dan keduanya fatal bila terlewat.
    - _Requirements: 2.4, 3.1, 3.2_
    - _Design: A.3_

  - [ ] 8.8 `src/api/units.ts` — `getProductUnits` tidak boleh lagi `select('*')` pada `product_units`
    - Pilih salah satu dan konsisten: daftar kolom eksplisit tanpa `harga_beli` untuk jalur umum, atau `product_units_admin` untuk jalur admin.
    - Perbarui `src/__tests__/unitsApi.test.ts` bila bentuk query diassert di sana.
    - _Requirements: 2.4, 3.1_
    - _Design: A.3, Property 5_

  - [ ] 8.9 `src/pages/ProductsPage.tsx` — komponen varian/satuan
    - Komponen varian membaca `product_units`; pastikan ia memakai jalur dari 8.8 dan tetap menampilkan harga beli varian untuk admin.
    - _Requirements: 2.4, 3.1_
    - _Design: A.3_

  - [ ] 8.10 `getTransactionById` → `transaction_items_public`
    - `src/api/transactions.ts`. Ini jalur cetak-ulang struk yang **juga dipakai kasir**; bila terlewat, struk kasir mati setelah 068.
    - _Requirements: 2.4, 3.13_
    - _Design: A.4, Property 5, 6_

  - [ ] 8.11 `getTransactionHistoryPage` → `transactions_with_kasir_admin`; kolom Laba di `ReportsPage` tetap ada
    - `src/api/transactions.ts` / `src/api/reports.ts` (`transactions_with_kasir` dipakai di baris ~131, ~310, ~477 — periksa setiap pemakaian dan tentukan mana jalur admin, mana jalur kasir).
    - Jalur kasir (daftar pending POSPage) tetap ke `transactions_with_kasir` dan **tidak** boleh membaca `laba_kotor`.
    - _Requirements: 2.4, 3.1_
    - _Design: A.4, Property 4, 6_

  - [ ] 8.12 `getSalesByCategory` dan `src/api/staff.ts` — verifikasi, bukan ubah
    - `getSalesByCategory` memanggil `getTopProducts(..., 100)` → setelah 068 ia **ikut tertolak untuk non-admin**. Ini konsisten dengan 2.3 (halaman Laporan memang admin-only); catat di `verification-notes.md` agar tidak dianggap regresi saat uji asap.
    - `getStaffList()` **tidak perlu diubah**: setelah policy dipersempit, admin tetap menerima seluruh daftar dan kasir menerima satu baris. `SettingsPage` (satu-satunya pemakai) sudah di bawah `AdminRoute`. Verifikasi klaim ini di kode, jangan diasumsikan.
    - `getProductPriceHistory` adalah satu-satunya pembaca `product_price_history` dan sudah admin-only → tidak ada perubahan frontend, penyempitan policy terjadi di 068.
    - _Requirements: 2.3, 2.4, 2.5_
    - _Design: A.3, A.5, temuan perancangan nomor 5 (severity P3)_

- [ ] 9. **[AGENT]** Klaster B — UI refund
  - **PRASYARAT KERAS**: task 7 sudah selesai (067 live di produksi). Alasannya **bukan lagi** `close_cash_shift`: klausa 2.13 **dibatalkan 2026-09-22** dan 067 tidak menyentuh fungsi itu, jadi **pasangan keras "UI refund + 6.2" sudah larut**. Yang tetap mengikat: **6.3** (`refund_transaction_atomic` = 060 + syarat shift kasir untuk refund tunai) berada di 067 dan dibutuhkan agar setiap refund tunai punya shift untuk diatribusikan — lihat peringatan `hasOpenShift` di 9.2. Rekonsiliasi shift pada versi 064 sudah cocok dengan uang fisik (baseline keempat shift `selisih = 0` di `verification-notes.md` → "Task 5 … Kasus 6").

  - [ ] 9.1 `refundTransaction` di `src/api/transactions.ts`
    - Signature: `refundTransaction({ transactionId, alasan, idempotencyKey }): Promise<RefundResult>` dengan `RefundResult = { success, refund_id, transaction_id, nomor_nota, status, total_refund, idempotent }`.
    - Validasi klien sebelum RPC (meniru `payReceivable`): `alasan` kosong dan `idempotencyKey` kosong ditolak lokal dengan pesan Indonesia.
    - Nama parameter RPC: `p_transaction_id`, `p_alasan`, `p_idempotency_key`.
    - Setelah sukses: `waitForTransactionDetail(id, d => d.transaction.status === 'batal')`, konsisten dengan `cancelTransaction`.
    - Ditempatkan di file yang sudah menampung `cancelTransaction`, `cancelPendingTransaction`, `confirmTransactionPayment` — bukan file baru.
    - Uji behavioural: alasan kosong ditolak lokal; kunci kosong ditolak lokal; payload RPC memakai nama parameter yang benar.
    - _Requirements: 2.1_
    - _Design: B.1, Property 10_

  - [ ] 9.2 Tombol dan form refund di modal detail `src/pages/ReportsPage.tsx`
    - Tombol "Refund" **di dalam modal detail**, bukan di baris tabel, supaya aksi finansial tidak mudah tersenggol.
    - Aktif hanya bila `status === 'selesai' && payment_status === 'dibayar'`.
    - Form: textarea alasan **wajib** + `ConfirmDialog` yang menampilkan nominal dan nomor nota.
    - Periksa `hasOpenShift` sebelum membuka form untuk transaksi tunai dan tampilkan peringatan seperti di `CustomersPage`: refund tunai butuh shift kasir aktif (konsekuensi 6.3). Refund non-tunai tidak butuh shift.
    - Lokasi dipilih di `/laporan` karena sudah `AdminRoute` dan RPC menolak non-admin → tidak ada jalur mati untuk kasir. Daftar pending POSPage berisi transaksi belum dibayar; domainnya `cancelPendingTransaction`, bukan refund.
    - _Requirements: 2.1, 2.2_
    - _Design: B.2, Property 10_

  - [ ] 9.3 Rotasi kunci idempotensi refund
    - `refundKeyMap: Record<transactionId, string>` dan `refundBoundReason: Record<transactionId, string>`, keduanya `useRef`.
    - Buka modal: `key := refundKeyMap[id] ?? crypto.randomUUID()` (dipertahankan lintas close/reopen); bila `refundBoundReason[id]` ada, pulihkan textarea dengan alasan itu (recovery respons hilang).
    - Alasan berubah **dan** `refundBoundReason[id]` ada → rotasi kunci, hapus `refundBoundReason[id]`. Ini wajib karena fingerprint server (migrasi 060) = `sha256({transaction_id, alasan})`: mengubah alasan tanpa merotasi kunci ditolak server dengan "Kunci idempotensi sudah digunakan untuk transaksi refund berbeda".
    - Submit: ikat `refundBoundReason[id] := btrim(alasan)` **sebelum** request.
    - Sukses: hapus keduanya. Gagal: pertahankan keduanya → percobaan ulang identik memakai kunci sama.
    - Uji behavioural: kunci bertahan lintas close/reopen; kunci dirotasi saat alasan berubah setelah kegagalan; kunci dibuang hanya saat sukses.
    - _Requirements: 2.1, 3.3_
    - _Design: B.3, Property 14_

- [ ] 10. **[AGENT]** Klaster C — bounded wait bersama
  - Dirancang sebagai **satu mekanisme bersama**, bukan dua tambalan. Jangan mulai sebelum kasus 7 di task 1 terkonfirmasi (bila terbantah, perbarui design dulu).

  - [ ] 10.1 File baru `src/lib/fetchWithTimeout.ts`
    - Ekspor `SUPABASE_REQUEST_TIMEOUT_MS = 15000`, `class RequestTimeoutError extends Error { readonly isTimeout = true }`, `createTimeoutFetch(defaultTimeoutMs): typeof fetch`, `runWithTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T>`.
    - `createTimeoutFetch` **wajib menghormati** `AbortSignal` yang sudah dibawa pemanggil (gabungkan dengan `AbortSignal.any` bila tersedia, jika tidak pasang listener manual), supaya pembatalan milik supabase-js sendiri tidak dimatikan.
    - Uji behavioural: `runWithTimeout` menolak dengan `RequestTimeoutError` tepat waktu; `AbortSignal` pemanggil tetap dihormati; promise yang settle sebelum deadline tidak terpengaruh.
    - _Requirements: 2.7_
    - _Design: C.1, Property 13_

  - [ ] 10.2 Pasang di `src/lib/supabase.ts`
    - `createClient(url, key, { global: { fetch: createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS) }, auth: {...} })`.
    - Ini otomatis memberi batas waktu pada **semua** PostgREST, RPC, dan `auth.*` — termasuk `auth.getSession()` yang menjadi akar 1.8. Realtime memakai WebSocket, tidak lewat fetch, jadi tidak terpengaruh.
    - `uploadProductPhoto` memanggil dengan `AbortSignal` sendiri bertimeout lebih longgar (mis. 60 detik) karena unggahan gambar bisa melewati 15 detik.
    - _Requirements: 2.7, 2.8_
    - _Design: C.1_

  - [ ] 10.3 `commitTransaction` dibungkus `runWithTimeout` + pesan yang dapat ditindaklanjuti
    - Label menghasilkan toast seperti: "Server tidak merespons dalam 15 detik. Periksa koneksi lalu tekan Coba Lagi — transaksi tidak akan terkirim dua kali."
    - Kunci idempotensi **tidak** dirotasi karena payload tidak berubah; `lastCheckoutFingerprintRef` yang sudah ada menjaga Property 14 otomatis. Jangan menyentuh semantik kunci.
    - `processingPayment` kembali false karena `finally` sekarang benar-benar tereksekusi.
    - _Requirements: 2.7, 3.3_
    - _Design: C.1, Property 13, 14_

  - [ ] 10.4 `src/hooks/useOnlineStatus.ts` — probe reachability
    - Status online menjadi `navigator.onLine && reachable`.
    - Probe: `fetch(VITE_SUPABASE_URL + '/auth/v1/health', { method: 'GET', cache: 'no-store', signal })` dengan timeout pendek (≈5 detik). Endpoint ini tidak butuh autentikasi dan murah.
    - Jadwal: satu probe saat mount, interval 30 detik **hanya saat `document.visibilityState === 'visible'`**, probe segera pada event `online` dan `visibilitychange`, plus `revalidate()` yang diekspos agar POSPage dapat memanggilnya setelah checkout gagal.
    - `navigator.onLine === false` tetap langsung berarti offline **tanpa probe** — probe hanya **menambah** kondisi offline, tidak mengubah jalur offline yang sudah benar (3.5).
    - Nilai awal tetap optimistis (`navigator.onLine`) supaya tombol checkout tidak berkedip nonaktif pada render pertama.
    - Perluas `src/__tests__/useOnlineStatus.test.ts`: `onLine=false` → offline tanpa probe; `onLine=true` + probe gagal → offline; probe berhasil → online; tidak ada probe saat tab tersembunyi; `revalidate()` memicu probe segera.
    - _Requirements: 2.7, 3.5_
    - _Design: C.2, Property 13_

  - [ ] 10.5 `src/components/auth/AuthProvider.tsx` — timeout sebagai kegagalan, bukan bypass
    - Percabangan baru: bila `!initialized || loading` maka `timedOut ? <AuthFailureScreen onRetry={retry} /> : <AuthLoadingScreen />`; hanya render `children` setelah status auth resolve.
    - Rute terproteksi **tidak pernah** dirender dengan status auth belum resolve, sehingga `PrivateRoute` tidak pernah melihat `session` null secara prematur.
    - Tambah aksi `reinitialize()` di `authStore` yang mengosongkan `initialized` dan `initializePromise` sebelum memanggil kembali alur yang sama, **tanpa** menyentuh pendaftaran `authSubscription` (3.12, anti-langganan-ganda).
    - Uji behavioural: sesi resolve cepat → anak dirender; timeout dengan sesi belum resolve → layar kegagalan + tombol coba lagi, **bukan** navigasi ke `/login`; retry memanggil ulang inisialisasi tanpa menambah listener.
    - _Requirements: 2.8, 3.12_
    - _Design: C.3, Property 15_

- [ ] 11. **[AGENT]** Klaster D — input & perangkat kasir
  - Jangan mulai 11.4 sebelum kasus 10 di task 1 terkonfirmasi.

  - [ ] 11.1 `src/lib/units.ts` — helper presisi satuan
    - `const FRACTIONAL_SATUAN = new Set(['kg','gram','meter','liter'])`, `export const MAX_QTY_DECIMALS = 3`, `export function getQtyDecimals(satuan): number`.
    - Plafon 3 desimal **bukan angka bebas**: `transaction_items.qty` bertipe `NUMERIC(12,3)` sejak migrasi 029; presisi di atas itu dibulatkan diam-diam oleh Postgres dan membuat total klien berbeda dari total server. Tulis komentar yang mengikat konstanta ini ke tipe kolom.
    - Satuan diskret (pcs, lusin, dus, pack, ikat, bal, roll, batang, lembar) tetap 0 desimal.
    - Uji: `getQtyDecimals` untuk setiap nilai `SatuanType`, plus penegasan `MAX_QTY_DECIMALS = 3`.
    - _Requirements: 2.9_
    - _Design: D.2, Property 16_

  - [ ] 11.2 `src/components/pos/NumpadModal.tsx` — presisi desimal
    - Prop baru `decimalPlaces?: number` (default **0 = perilaku sekarang**, menjaga Property 17) dan `step?: number`.
    - Tombol `,` dirender hanya bila `decimalPlaces > 0`; disabled bila `valueStr` sudah memuat separator.
    - `handleDigit` menolak digit bila bagian desimal sudah mencapai `decimalPlaces` — inilah yang mencegah `0.25` → `0.255`.
    - Normalisasi `initialValue`: format dengan presisi yang diizinkan lalu buang nol berlebih (`0.250` → `"0.25"`, `3` → `"3"`).
    - `displayFormatted` memakai `toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimalPlaces })`; parsing memakai bentuk internal titik desimal agar tidak bergantung locale.
    - Keyboard menerima `,` dan `.` sebagai separator.
    - `handleConfirm` membulatkan ke `decimalPlaces` **sebelum** membandingkan dengan `minValue`/`maxValue`, menghindari penolakan karena galat float.
    - Uji: tombol koma hanya saat `decimalPlaces > 0`; digit ditolak setelah presisi penuh; separator kedua ditolak; `initialValue` pecahan dinormalisasi; `minValue`/`maxValue` ditegakkan saat konfirmasi; **jalur bilangan bulat tidak berubah**.
    - _Requirements: 2.9, 3.4_
    - _Design: D.1, Property 16, 17_

  - [ ] 11.3 `src/pages/POSPage.tsx` — call site numpad
    - `decimalPlaces={getQtyDecimals(numpadItem.satuan)}`.
    - `minValue={decimalPlaces > 0 ? 10 ** -decimalPlaces : 1}` (menggantikan `minValue={1}`).
    - `maxValue` = sisa stok baris **dalam satuan jual**: `(remainingBase(productId) + currentLineBaseQty) / rasio`, memakai `remainingBaseStockByProduct` yang sudah ada. Menggantikan konstanta `9999`.
    - `cartStore.updateQty` tetap menjadi penjaga terakhir (3.4); numpad hanya mencegah input yang pasti ditolak.
    - `quickOptions` menjadi sadar satuan: `[0.25, 0.5, 0.75, 1, 2, 5]` untuk satuan pecahan, tetap `[1, 2, 5, 10, 20, 50, 100]` untuk diskret.
    - _Requirements: 2.9, 3.4_
    - _Design: D.3, Property 16, 17_

  - [ ] 11.4 `src/components/pos/BarcodeScannerModal.tsx` — stabil terhadap re-render induk
    - Simpan callback di ref yang disinkronkan effect terpisah (`onCloseRef.current = onClose` setiap render), lalu jadikan effect kamera bergantung **hanya** pada `[isOpen]`.
    - Handler sukses memanggil `onScanSuccessRef.current(...)` / `onCloseRef.current()`.
    - Invarian "kamera hidup selama modal terbuka" dimiliki komponen, jadi POSPage boleh terus meneruskan arrow function inline. Memoisasi di call site bersifat opsional dan **bukan** syarat kebenaran.
    - Uji behavioural: mock `Html5Qrcode` yang mencatat jumlah `start()`; re-render induk dengan prop callback inline baru → `start()` tetap tepat satu kali.
    - _Requirements: 2.10_
    - _Design: D.4, Property 18_

- [ ] 12. **[AGENT]** Klaster E — sisi frontend tempo, timezone, dan pemisahan kas

  - [ ] 12.1 `src/utils/date.ts` — helper batas hari WIB (menambah, tidak mengubah)
    - Tambah `getWIBDateKey(value): string` (`yyyy-MM-dd` pada WIB), `getWIBToday(): string`, `addWIBDays(dateKey, days): string`.
    - Implementasi memakai aritmetika offset +07:00 (pola `getPendingTransactions`) atau `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })`. Hasil **tidak boleh** bergantung timezone perangkat.
    - **Jangan** mengubah `getISOStartOfDay` / `getISOExclusiveEndOfDay` (3.8).
    - Uji dengan `process.env.TZ` di-set ke `UTC`, `Asia/Jakarta`, `Asia/Makassar`, `America/New_York`; plus regresi atas dua fungsi lama.
    - _Requirements: 2.12, 3.8_
    - _Design: E.2, Property 21, 22_

  - [ ] 12.2 `src/api/reports.ts` — jalur dashboard memakai batas WIB
    - `buildDayRange(date)` menjadi berbasis kunci tanggal WIB: `{ from: getISOStartOfDay(key), to: getISOExclusiveEndOfDay(key) }`.
    - `getDashboardChangeSummary` memakai `getWIBToday()` dan `addWIBDays(today, -1)` alih-alih `new Date()` / `subDays`.
    - `formatLocalDateKey` → `getWIBDateKey` di `getSalesReport` (bucket harian) dan `getSalesTrend` (pembentukan kunci), agar bucket klien cocok dengan `DATE(created_at AT TIME ZONE 'Asia/Jakarta')` milik RPC.
    - `getSalesTrend` membangun rentang dari kunci WIB, bukan `startOfDay/endOfDay` lokal.
    - `formatLocalDateKey` dipertahankan sebagai alias terdeprekasi bila masih ada pemanggil lain; jalur laporan tidak memakainya lagi.
    - _Requirements: 2.12_
    - _Design: E.2, Property 21_

  - [ ] 12.3 `src/pages/SettingsPage.tsx` — field "Tempo hutang (hari)"
    - Ditempatkan di kartu yang sudah memuat PPN; zod `z.coerce.number().int().min(0).max(365)`, default 14; persist lewat `updateSettings` yang sudah ada.
    - _Requirements: 2.11_
    - _Design: E.1_

  - [ ] 12.4 `src/pages/CustomersPage.tsx` — penanda jatuh tempo terlewat
    - Badge jatuh tempo sudah merender bila `r.jatuh_tempo` ada; tambahkan penanda terlewat (`jatuh_tempo < todayWIB && sisa_hutang > 0` → gaya danger) memakai `getWIBToday()` dari 12.1.
    - **Gate 3.2 diputuskan 2026-09-22: "biarkan NULL".** Badge memang kosong untuk piutang tanpa `jatuh_tempo` — itu **perilaku yang diharapkan, bukan bug**, dan tidak boleh "diperbaiki" dengan nilai turunan di sisi klien. Dalam praktik tidak ada piutang lama sama sekali (nol transaksi bisnis di target), jadi kasus ini tidak akan terlihat.
    - _Requirements: 2.11_
    - _Design: E.1, Property 19_

  - [ ] 12.5 `src/api/reports.ts` + `ReportsPage` + `DashboardPage` — kartu akrual vs kas
    - `getReportSummary` diperluas dengan `omzetAkrual`, `kasDiterima`, `piutangBaru` dari `get_cash_receipts_summary`; `totalPenjualan` **dipertahankan** (= `omzetAkrual`) agar pemanggil lain tidak berubah.
    - Dua kartu berlabel tegas: **"Omzet (akrual)"** dan **"Kas diterima"**, dengan keterangan kecil "penjualan hutang belum termasuk kas".
    - _Requirements: 2.14_
    - _Design: E.3, Property 23_

- [ ] 13. **[AGENT]** Klaster F — paritas struk thermal
  - [ ] 13.1 Helper murni di `src/utils/escpos.ts`
    - `wrapText(text, width): string[]` — wrap per kata, potong hanya kata yang memang melebihi lebar.
    - `formatQty(qty): string` — `2` → `"2"`, `0.5` → `"0,5"`, `0.25` → `"0,25"` (koma, tanpa nol berlebih).
    - Uji: `wrapText` (kata lebih panjang dari lebar, batas tepat, beberapa spasi berurutan), `formatQty` (`2`, `0.5`, `0.25`, `0.125`, `1000.5`).
    - Properti: untuk nama acak dan lebar 32/48, setiap baris keluaran ≤ lebar **dan** penggabungan seluruh baris memuat setiap karakter non-spasi dari input (tidak ada informasi hilang — inti 2.15).
    - _Requirements: 2.15_
    - _Design: F, Property 24_

  - [ ] 13.2 `ReceiptData` diperluas dan baris item ditulis ulang
    - `items: { name, qty, unit?, unitPrice?, discountPercent?, lineTotal }`; `price` lama dipertahankan sebagai alias `lineTotal` agar pemanggil lain tidak pecah.
    - Tiap baris: nama di-wrap, lalu `leftRight("  " + formatQty(qty) + " " + unit + " x " + formatCurrency(unitPrice), formatCurrency(lineTotal))`; bila `discountPercent > 0` tambah satu baris `leftRight("  Diskon " + discountPercent + "%", "")`.
    - Lebar 32 kolom tetap dihormati; bila baris harga-satuan tidak muat, **pecah menjadi dua baris** alih-alih terpotong.
    - `cash_received` dan `change` dicetak bila `!= null` (buang syarat `> 0`) sehingga "Bayar Rp 50.000 / Kembalian Rp 0" tetap tercetak.
    - Uji atas byte keluaran `buildReceiptBytes`: unit tercetak, harga satuan tercetak, diskon baris tercetak, `Bayar`/`Kembalian` saat 0, nama panjang ter-wrap, lebar 32 vs 48 kolom, pelanggan & catatan diteruskan.
    - _Requirements: 2.15_
    - _Design: F, Property 24_

  - [ ] 13.3 `src/pages/POSPage.tsx` — `handleThermalPrint` meneruskan data yang hilang
    - Kirim `customer_name: receiptCustomerName`, `note: receiptTransaction.catatan`, `cash_received: receiptTransaction.uang_diterima ?? undefined`, `change: receiptTransaction.kembalian ?? undefined`.
    - **Hapus pemeriksaan truthy di call site** (`receiptTransaction.kembalian ? ... : undefined`) — di sinilah nilai 0 pertama kali hilang, sebelum builder menghapusnya kedua kali.
    - Tambah state `receiptCustomerName`, diisi dari `selectedCustomer?.nama` saat checkout dan dari `customers` saat mencetak dari riwayat.
    - `ReceiptPrint` (struk browser) **tidak diubah** (3.13).
    - _Requirements: 2.15, 3.13_
    - _Design: F, Property 24, 25_

- [ ] 14. Verifikasi build #1 sebelum deploy

  - [ ] 14.1 **[AGENT]** Verifikasi uji eksplorasi kondisi bug kini LOLOS
    - **Property 1: Expected Behavior** - Semua Cacat 1.1–1.18 Diperbaiki
    - **IMPORTANT**: jalankan ulang **uji YANG SAMA** dari task 1 — jangan menulis uji baru. Uji itu sudah mengodekan perilaku yang diharapkan.
    - `npx vitest run src/__tests__/bugConditionExploration.test.ts`
    - **EXPECTED OUTCOME**: **LOLOS** untuk kasus 5, 7, 8, 9, 10, 12, 13 (konfirmasi cacat sisi frontend teratasi). Kasus sisi SQL (1, 2, 3, 4, 6, 11) diverifikasi di task 5/7/18, bukan di sini.
    - _Requirements: 2.1, 2.7, 2.8, 2.9, 2.10, 2.12, 2.15_
    - _Design: Property 1, Fix Checking_

  - [ ] 14.2 **[AGENT]** Verifikasi uji preservation masih LOLOS
    - **Property 2: Preservation** - Perilaku di Luar Kondisi Bug Tidak Berubah
    - **IMPORTANT**: jalankan ulang **uji YANG SAMA** dari task 2 — jangan menulis uji baru.
    - `npm test` (seluruh suite, termasuk penjaga teks migrasi), `npm run lint`, `npm run build`.
    - **EXPECTED OUTCOME**: **LOLOS** semua, tanpa regresi. Perhatian khusus: qty bulat + stok agregat (3.4), idempotensi checkout (3.3), jalur offline (3.5), batas rentang laporan (3.8), struk browser (3.13), perilaku sesi (3.12).
    - _Requirements: 3.3, 3.4, 3.5, 3.8, 3.11, 3.12, 3.13_
    - _Design: Property 2, Preservation Checking_

- [ ] 15. **[USER]** Deploy build #1 ke produksi lalu jalankan uji asap runtime (rilis langkah 3)
  - Agent tidak dapat menjalankan ini: butuh peramban, DevTools, printer thermal, dan shift kasir nyata.
  - **S1 — checkout tunai dengan PPN aktif, pembulatan rupiah bulat** (2.17): PPN 11% aktif; buka shift; 1 × produk Rp 1.235; amati Subtotal Rp 1.235 / PPN Rp 136 / Total Rp 1.371 **tanpa desimal**; "Uang Pas" Rp 1.371 **harus diterima**; verifikasi DB `subtotal=1235, ppn_amount=136, total=1371, kembalian=0`; struk browser dan thermal menampilkan angka identik dan baris **"Kembalian Rp 0" tercetak di keduanya**; ulangi bayar Rp 2.000 → kembalian Rp 629 di UI, DB, dan kedua struk; tutup shift dengan uang fisik = modal + 1.371 + 2.000 − 629 → `selisih` **0**.
  - **S2 — `authStore` saat pengambilan profil gagal** (2.17): login kasir, biarkan katalog ter-cache; DevTools blokir `*/rest/v1/profiles*`; picu event auth (refresh token atau pindah tab); verifikasi sesi **bertahan**, tidak diarahkan ke `/register`, cache katalog IndexedDB **tidak terhapus**, pesanan parkir **tidak terhapus**, keranjang aktif **tidak terhapus**, error tampil tanpa tindakan destruktif; buka blokir → profil resolve; logout → seluruh data lokal tenant bersih.
  - Asap tambahan build #1: login kasir → katalog muncul penuh → checkout tunai → cetak struk; qty pecahan lewat numpad; scanner barcode tuntas pada percobaan pertama sambil keranjang berubah; refund satu transaksi tunai dari `/laporan` lalu tutup shift → `selisih` 0.
  - Recovery jaringan: blokir host Supabase di DevTools → checkout gagal **dalam batas waktu** → buka blokir → "Coba Lagi" dengan kunci sama → server mengembalikan **struk recovery**, bukan transaksi kedua.
  - Catat hasil (tanggal, penguji, nomor nota, nilai teramati, screenshot) di `verification-notes.md`. Tanpa catatan, klausa 2.17 belum terpenuhi.
  - **JANGAN LANJUT KE 068 SEBELUM SEMUA POIN DI ATAS HIJAU.**
  - _Requirements: 1.17, 2.17_
  - _Design: Daftar Uji Asap Runtime S1, S2; Integration Tests_

---

## Fase 5 — Migrasi 068 (subtraktif, titik paling berisiko)

- [ ] 16. **[AGENT]** Tulis `supabase/migrations/068_read_authorization_hardening.sql` dan file pembaliknya
  - **PRASYARAT KERAS**: task 15 selesai dan hijau. 068 mencabut kemampuan yang dipakai frontend **sebelum** build #1. Diterapkan lebih awal → `select('*')` gagal seluruhnya, katalog/struk kasir dan daftar produk admin mati, `/dashboard` kasir error 42501.

  - [ ] 16.1 Guard `is_admin()` pada empat RPC laporan
    - `get_profit_summary(timestamptz, timestamptz)`, `get_top_products(timestamptz, timestamptz, integer)`, `get_sales_by_date(date, date)` saat ini `LANGUAGE sql`. Guard yang **meng-error** (2.3 menuntut kesalahan otorisasi, bukan himpunan kosong) memerlukan `LANGUAGE plpgsql` + `RETURN QUERY`. `CREATE OR REPLACE` boleh mengubah bahasa selama signature dan tipe kembalian tidak berubah.
    - **`get_top_products` wajib sudah disentuh 066 lebih dulu** (066 memuat `DROP FUNCTION` karena `total_qty` berubah BIGINT → NUMERIC). `CREATE OR REPLACE` terhadap signature lama akan **gagal**. Karena 066 sudah live sejak task 7, prasyarat ini terpenuhi — tetapi jangan pernah menerapkan 068 ke lingkungan yang belum ber-066.
    - `get_dashboard_stats()` sudah `plpgsql`; tambahkan guard di awal body, **sebelum** blok `IF v_tenant_id IS NULL` yang sekarang mengembalikan nol-nol.
    - Body dan semantik agregasi **tidak berubah** dari 066 (Property 4): batas atas tetap eksklusif, HPP tetap `harga_beli * COALESCE(base_qty, qty * COALESCE(rasio,1), qty)`, `total_qty` tetap `NUMERIC` berbasis `base_qty`.
    - Pesan: `RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin'`.
    - Selaraskan `get_sales_by_date` dari `SET search_path TO 'public'` menjadi house style `SET search_path = pg_catalog, public` (temuan perancangan nomor 4, severity P3).
    - Setiap fungsi diikuti `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated, service_role;`
    - _Requirements: 2.3, 3.1_
    - _Design: A.1, Property 3, 4_

  - [ ] 16.2 `REVOKE SELECT (harga_beli) ON public.products FROM authenticated`
    - Bergantung pada 8.3, 8.4, 8.5, 8.6, 8.7 sudah live.
    - _Requirements: 2.4_
    - _Design: A.3, Property 5_

  - [ ] 16.3 `REVOKE SELECT (harga_beli) ON public.product_units FROM authenticated`
    - Bergantung pada 8.8, 8.9 sudah live.
    - _Requirements: 2.4_
    - _Design: A.3, Property 5_

  - [ ] 16.4 `REVOKE SELECT (harga_beli, laba_kotor) ON public.transaction_items FROM authenticated`
    - Bergantung pada 8.10, 8.11 sudah live. Ini penutup **temuan baru A.4**.
    - _Requirements: 2.4_
    - _Design: A.4, Property 5_

  - [ ] 16.5 Persempit `product_price_history_tenant_select` dengan `AND public.is_admin()`
    - Lebih sederhana daripada column privileges karena tidak ada pembaca kasir (`getProductPriceHistory` admin-only).
    - _Requirements: 2.4_
    - _Design: A.3_

  - [ ] 16.6 Persempit `profiles_tenant_select`
    - `USING (tenant_id = public.get_my_tenant_id() AND (id = auth.uid() OR public.is_admin()))`.
    - **Bergantung pada 6.6**: `transactions_with_kasir` harus sudah `security_invoker = false` dengan guard tenant eksplisit, kalau tidak `kasir_nama` menjadi NULL bagi kasir dan atribusi yang diandalkan 3.6 rusak.
    - _Requirements: 2.5, 3.6_
    - _Design: A.5, Property 7_

  - [ ] 16.7 Siapkan file pembalik `068_rollback.sql` **sebelum** 068 diterapkan
    - Isi: `GRANT SELECT (harga_beli) ON public.products TO authenticated` dan seterusnya untuk setiap kolom yang dicabut, plus re-emit empat fungsi laporan **tanpa** guard, plus policy `profiles_tenant_select` dan `product_price_history_tenant_select` versi lama.
    - Simpan di luar folder `supabase/migrations/` (mis. `supabase/rollback/068_rollback.sql`) agar tidak ikut `db push`.
    - **Jangan menyusun file ini saat insiden.** Ini satu-satunya titik mundur untuk perubahan paling berisiko dalam batch.
    - _Requirements: 2.16_
    - _Design: Batasan urutan antara migrasi dan frontend ("Titik mundur")_

  - [ ] 16.8 Penjaga teks CI untuk 068
    - Asersi: keempat fungsi laporan memuat `is_admin()` di body; pesan penolakan ada; `REVOKE SELECT (harga_beli)` ada untuk `products` dan `product_units`; `REVOKE SELECT (harga_beli, laba_kotor)` ada untuk `transaction_items`; `profiles_tenant_select` memuat `id = auth.uid()`; semantik agregasi 066 (`base_qty`, batas eksklusif) masih utuh di body yang di-re-emit.
    - _Requirements: 2.16_
    - _Design: Testing Strategy, Property 26_

- [ ] 17. **[USER]** Terapkan 068 ke staging, verifikasi dengan impersonasi kasir, lalu ke produksi (rilis langkah 4)
  - `supabase link --project-ref <staging-ref>`, `supabase db push`.
  - Blok verifikasi SQL Editor — **hak kolom sudah tercabut**:
    ```sql
    SELECT table_name, column_name, grantee, privilege_type
    FROM information_schema.column_privileges
    WHERE table_schema='public' AND grantee IN ('authenticated','anon')
      AND (table_name, column_name) IN
          (VALUES ('products','harga_beli'), ('product_units','harga_beli'),
                  ('transaction_items','harga_beli'), ('transaction_items','laba_kotor'));
    -- Harapan: NOL BARIS.
    ```
  - Blok verifikasi — **guard benar-benar ada di body**:
    ```sql
    SELECT proname, prosrc LIKE '%is_admin()%' AS has_guard
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND proname IN
      ('get_profit_summary','get_top_products','get_sales_by_date','get_dashboard_stats');
    ```
  - Blok **impersonasi kasir** — cara paling penting dan paling sering dilewatkan:
    ```sql
    BEGIN;
    SELECT set_config('request.jwt.claims',
      json_build_object('sub','<uuid-kasir>','role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT * FROM public.get_profit_summary(now() - interval '7 days', now());  -- HARUS ERROR (2.3)
    SELECT harga_beli FROM public.products LIMIT 1;                            -- HARUS ERROR hak akses (2.4)
    SELECT * FROM public.products_with_category LIMIT 1;                        -- HARUS BERHASIL, tanpa harga_beli (Property 6)
    SELECT count(*) FROM public.profiles;                                      -- HARUS tepat 1 (2.5)
    SELECT * FROM public.transactions_with_kasir LIMIT 1;                       -- HARUS BERHASIL, kasir_nama TIDAK NULL, tanpa laba_kotor
    SELECT * FROM public.transaction_items_public LIMIT 1;                      -- HARUS BERHASIL
    ROLLBACK;
    ```
  - Ulangi blok yang sama dengan `sub` **admin** dan pastikan **semuanya berhasil** (Property 4), termasuk `products_admin_with_category` dan `transactions_with_kasir_admin`.
  - Baru kemudian produksi: `supabase link --project-ref dfgqioglsirftfyjyswd`, `supabase db push`. Pastikan `068_rollback.sql` sudah ada di tangan sebelum menekan enter.
  - Tempel seluruh keluaran ke `verification-notes.md`.
  - _Requirements: 2.3, 2.4, 2.5, 2.16, 3.1_
  - _Design: Property 3, 4, 5, 6, 7; Jalur validasi Supabase (Simulasi peran kasir)_

- [ ] 18. **[USER]** Verifikasi ulang jalur kasir segera setelah 068 (rilis langkah 5 — titik paling berisiko dalam seluruh batch)
  - **S3 — asap kasir**: login kasir → landing di `/pos` **tanpa redirect loop**; katalog memuat penuh dengan harga jual, stok, dan gambar; tambah item; ubah qty lewat numpad (bulat **dan** pecahan); checkout tunai berhasil; buka struk transaksi lama dari riwayat kasir → **tidak ada error hak akses**; coba buka `/laporan`, `/produk`, `/dashboard` manual → diarahkan ke `/pos` tanpa loop; **console peramban bersih dari 42501 dan 403**.
  - **S4 — asap admin**: halaman Produk (Harga Beli & Margin% terisi, sorting `harga_beli` berfungsi, ekspor XLSX memuat Harga Beli); halaman Laporan (kartu Omzet akrual & Kas diterima terisi dan **berbeda** bila ada penjualan hutang, kolom Laba per transaksi terisi, keempat RPC laporan berhasil); Dashboard (kartu hari ini dan "% vs kemarin" konsisten **pada perangkat ber-timezone non-WIB**); Pengaturan (`tempo_hutang_hari` dapat disimpan dan terbaca ulang).
  - Integrasi peran: login admin → semua halaman dan kolom biaya tersedia; login kasir → katalog lengkap, checkout + struk berhasil, struk lama dapat dibuka ulang.
  - Bila **satu saja** poin S3 gagal: terapkan `068_rollback.sql` segera, jangan mendiagnosis di produksi dengan kasir menunggu.
  - Catat hasil di `verification-notes.md`.
  - _Requirements: 2.3, 2.4, 2.5, 3.1, 3.5, 3.11_
  - _Design: Daftar Uji Asap Runtime S3, S4; Integration Tests (Peralihan peran)_

---

## Fase 6 — Storage (rilis langkah 6)

- [ ] 19. Penyempitan kebijakan storage
  - **PRASYARAT — KEDUANYA SUDAH TERPENUHI:** gate 3.1 **terjawab 2026-09-22 (opsi B, signed URL)**, dan kasus 4 (task 5) sudah dijalankan: hipotesis bucket publik **TERKONFIRMASI** (`curl` anonim tetap HTTP 200 setelah policy dipersempit). Jadi **task ini TIDAK disederhanakan dan 19.3 TIDAK dibatalkan** — privatisasi bucket wajib.
  - **Tambahan wajib dari task 5 (klausa 1.20 / 2.20):** langkah **5b** — purge cache CDN atau **rotasi nama objek** saat pemindahan path di 19.2 — **tetap wajib**, dan **tidak** terhapus oleh keputusan signed URL. Verifikasi 400/404 **harus** memakai cache-buster `?v=<random>`.

  - [ ] 19.1 **[USER]** Audit path objek (read-only, dijalankan terhadap **PRODUKSI**)
    - Staging tidak punya data, jadi audit **wajib** menembak produksi. Read-only, tidak mengubah apa pun.
    ```sql
    SELECT (storage.foldername(o.name))[1] AS segmen_pertama,
           count(*) AS jumlah,
           bool_or(t.id IS NOT NULL) AS segmen_adalah_tenant_valid
    FROM storage.objects o
    LEFT JOIN public.tenants t
      ON (storage.foldername(o.name))[1] ~* '^[0-9a-f-]{36}$'
     AND t.id::text = (storage.foldername(o.name))[1]
    WHERE o.bucket_id = 'products'
    GROUP BY 1 ORDER BY 2 DESC;
    ```
    - Lalu `SELECT * FROM public.product_image_path_audit` (view dari 6.9) untuk daftar objek non-konforman beserta `target_name`.
    - Objek era migrasi 016 **dijamin non-konforman** (policy lamanya mensyaratkan segmen pertama `= 'products'`).
    - Identifikasi **objek yatim** (ada di bucket tetapi tidak dirujuk `products.foto_url` manapun): **jangan dipindahkan, jangan dihapus**. Daftarkan di `verification-notes.md`. Setelah 069 objek itu menjadi tidak terbaca — benar secara keamanan, dan tidak ada gambar sah yang hilang karena tidak ada produk yang merujuknya.
    - _Requirements: 2.6, 3.9_
    - _Design: Migrasi Kebijakan Storage langkah 1, 2, 4; Property 9_

  - [ ] 19.2 Pemindahan objek ke path `/<tenant-id>/`
    - **[AGENT]** Tulis `scripts/migrate-product-image-paths.mjs`: (a) baca `product_image_path_audit`, (b) `storage.from('products').move(oldName, targetName)`, (c) `UPDATE products SET foto_url = <url/path baru>`. Wajib: log per objek, **dapat dijalankan ulang** (lewati objek yang sudah konforman), mode `--dry-run`, dan service-role key dibaca dari env (**tidak pernah** masuk repo).
    - **CRITICAL**: pemindahan **tidak boleh** lewat SQL. `UPDATE storage.objects SET name = ...` hanya mengubah metadata; kunci fisik objek tidak ikut berpindah dan objeknya menjadi **tidak terbaca**. Harus lewat Storage API.
    - **[USER]** Jalankan skrip: `--dry-run` lebih dulu, periksa log, lalu jalankan sungguhan dengan service-role key. Agent tidak dapat melakukan ini karena butuh service-role key.
    - **[USER]** Ulangi query audit 19.1 sampai **nol objek non-konforman** (selain objek yatim yang sengaja dibiarkan). 069 tidak boleh diterapkan sebelum ini.
    - _Requirements: 2.6, 3.9_
    - _Design: Migrasi Kebijakan Storage langkah 3; Property 9_

  - [ ] 19.3 **[AGENT]** Implementasi pemuatan gambar dengan **signed URL TTL pendek** (keputusan gate 3.1, 2026-09-22)
    - **Opsi B dipilih pemilik.** `createSignedUrl(path, 3600)` dipakai **langsung di `<img src>`**, dengan **pembaruan sebelum kedaluwarsa**. Terapkan di `ProductsPage` (grid) dan `POSPage` (kartu produk).
    - **`products.foto_url` wajib menghasilkan PATH objek**, karena `createSignedUrl` menerima path dan bukan URL penuh: simpan sebagai path, **atau** turunkan path dari URL penuh lama. Ini **syarat kebenaran** task ini, bukan catatan opsional — tanpa itu pemanggilan signed URL gagal untuk seluruh gambar era `getPublicUrl()`.
    - **Opsi A (blob authenticated) off the table** — tidak ada hook unduh-blob, tidak ada cache blob di memori, tidak ada `revokeObjectURL`. Dipertahankan di `design.md` hanya sebagai jejak pilihan.
    - **Tradeoff yang sudah diterima pemilik:** URL bertanda tangan dapat dibagikan sampai TTL habis.
    - **Jangan** menyimpulkan bahwa signed URL menutup klausa 1.20 — tidak. Jendela cache CDN berlaku pada URL `/object/public/...` **lama**, jadi langkah 5b (purge atau rotasi nama objek) tetap wajib.
    - Uji behavioural atas hook/util pemuat: path konforman → URL bertanda tangan terbentuk; `foto_url` berupa URL penuh lama → path berhasil diturunkan; kegagalan pembuatan signed URL → placeholder, bukan crash; pembaruan terjadi sebelum TTL habis.
    - _Requirements: 2.6, 3.9_
    - _Design: Migrasi Kebijakan Storage (tabel opsi A/B); Property 8, 9_

  - [ ] 19.4 **[AGENT]** Tulis `supabase/migrations/069_storage_tenant_scoped_products_bucket.sql`
    ```sql
    DROP POLICY IF EXISTS product_images_public_select ON storage.objects;
    CREATE POLICY product_images_tenant_select ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'products'
             AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text);
    UPDATE storage.buckets SET public = false WHERE id = 'products';
    ```
    - Kebijakan tulis yang sudah benar (terikat `/<tenant-id>/` + `is_admin()`) **tidak disentuh**.
    - **Jalur cadangan** bila pemindahan objek tidak selesai tepat waktu: tambahkan cabang *grandfather* sementara `OR EXISTS (SELECT 1 FROM public.products p WHERE p.tenant_id = public.get_my_tenant_id() AND p.foto_url LIKE '%' || storage.objects.name)`. Ini tetap mencegah akses anonim dan lintas tenant, tetapi menambah subquery **tanpa dukungan indeks** pada setiap pembacaan objek (`LIKE '%' || name` tidak dapat memakai indeks). Bila dipakai, catat sebagai **utang teknis dengan rencana penghapusan eksplisit**, jangan dibiarkan permanen.
    - Perluas `src/__tests__/storageTenantScope.test.ts`: `public = false` ada; policy memakai `storage.foldername(name))[1]`; policy lama di-drop; `TO authenticated` (bukan `public`).
    - _Requirements: 2.6_
    - _Design: Migrasi Kebijakan Storage langkah 5; Property 8_

  - [ ] 19.5 **[USER]** Terapkan 069 dan verifikasi gambar tetap tampil untuk kedua peran
    - `db push` ke staging → verifikasi → produksi.
    - Verifikasi: gambar tampil untuk **admin dan kasir tenant sendiri** (3.9); URL `/object/public/...` langsung mengembalikan **400/404**; objek **tenant lain** ditolak untuk sesi yang sah.
    - `SELECT id, public, file_size_limit FROM storage.buckets WHERE id='products'` → `public = false`.
    - `SELECT policyname, roles, cmd, qual FROM pg_policies WHERE schemaname='storage' AND tablename='objects'` → inventaris akhir ditempel ke `verification-notes.md`.
    - _Requirements: 2.6, 3.9_
    - _Design: Migrasi Kebijakan Storage langkah 6; Property 8, 9_

---

## Fase 7 — Audit Area Belum Tersentuh (1.18 → 2.18)

- [ ] 20. **[AGENT]** Audit area yang belum pernah dibuka
  - **PROTOKOL WAJIB**: setiap temuan dicatat sebagai **klausa baru di `bugfix.md`** — kondisi bug (1.19+), perilaku yang diharapkan (2.19+), perilaku yang harus dipertahankan (3.14+) — **beserta severity**. **Jangan memperbaiki apa pun secara diam-diam di task ini.** Perbaikan menunggu klausa itu diprioritaskan seperti klausa lain.
  - Sertakan juga temuan yang sudah teridentifikasi selama perancangan bila belum masuk `bugfix.md`: (1) `transaction_items.harga_beli`/`laba_kotor` + agregat `transactions_with_kasir.laba_kotor` terbaca kasir — P0; (2) bucket `products` `public = true` + `getPublicUrl()` membuat penyempitan policy saja tidak cukup — P0; (3) `AdminRoute` fallback ke `/dashboard` → redirect loop bila 2.3 dikerjakan setengah — P1; (4) `get_sales_by_date` memakai `SET search_path TO 'public'` menyimpang dari house style — P3; (5) `getSalesByCategory` ikut tertolak untuk non-admin setelah 068 — bukan regresi, tetapi harus tercatat.

  - [ ] 20.1 `src/pages/ProductsPage.tsx` (2247 baris)
    - Fokus: dampak 8.4–8.9; validasi zod vs constraint DB; ekspor XLSX (kebocoran kolom biaya ke file); alur varian & repack; penanganan kegagalan upload.
    - _Requirements: 1.18, 2.18_
    - _Design: G (tabel area audit)_

  - [ ] 20.2 `src/pages/SettingsPage.tsx` (1130 baris)
    - Fokus: `updateSettings` upsert tanpa `tenant_id` eksplisit (mengandalkan default kolom); validasi `ppn_persen` dan `tempo_hutang_hari`; alur staf setelah 16.6.
    - _Requirements: 1.18, 2.18_
    - _Design: G_

  - [ ] 20.3 `src/pages/StockPage.tsx` (870 baris)
    - Fokus: penyesuaian stok vs satuan dasar; idempotensi repack; atribusi aktor.
    - _Requirements: 1.18, 2.18, 3.2_
    - _Design: G_

  - [ ] 20.4 `src/pages/AuditPage.tsx` (185 baris)
    - Fokus: `audit_logs_with_user` ber-`security_invoker` + policy admin-only; paginasi.
    - _Requirements: 1.18, 2.18_
    - _Design: G_

  - [ ] 20.5 `src/utils/escpos.ts` dan `src/components/pos/BarcodeScannerModal.tsx` — sisa setelah F dan D.4
    - `escpos.ts`: penanganan WebUSB device yang dicabut, `cachedEndpoint` stale.
    - `BarcodeScannerModal.tsx`: pelepasan track kamera saat unmount mendadak.
    - _Requirements: 1.18, 2.18_
    - _Design: G_

  - [ ] 20.6 Service worker / PWA offline shell
    - Fokus: cakupan cache — **jangan pernah men-cache respons PostgREST berisi data tenant**; strategi update; perilaku saat asset lama. Kaitkan dengan `src/__tests__/serviceWorkerBuild.test.ts` yang sudah ada.
    - _Requirements: 1.18, 2.18, 3.5_
    - _Design: G_

  - [ ] 20.7 Migrasi 001–052 (baru diperiksa sebagian)
    - Fokus: policy sisa dari era pra-054, view tanpa `security_invoker`, fungsi tanpa `SET search_path`, `GRANT` terlalu lebar.
    - Bila ditemukan `GRANT` terlalu lebar pada objek yang masih dipakai, catat sebagai klausa baru dengan severity — **jangan** langsung menambah migrasi pencabutan di batch ini, karena setiap pencabutan adalah perubahan subtraktif yang butuh urutan deploy sendiri.
    - _Requirements: 1.18, 2.18_
    - _Design: G_

---

## Fase 8 — Checkpoint

- [ ] 21. Checkpoint — pastikan seluruh uji lolos dan bukti verifikasi lengkap
  - **[AGENT]** `npm test`, `npm run lint`, `npm run build` semuanya lolos, termasuk penjaga teks 067/068/069.
  - **[AGENT]** Uji eksplorasi task 1 lolos untuk kasus frontend; uji preservation task 2 lolos tanpa regresi.
  - **[USER]** `verification-notes.md` memuat: hasil eksplorasi SQL (task 5) beserta status falsifikasi kasus 4/7/10, hasil verifikasi 067 (task 7), S1 + S2 (task 15), blok impersonasi kasir dan admin setelah 068 (task 17), S3 + S4 (task 18), inventaris policy storage dan daftar objek yatim (task 19).
  - **[USER]** Keputusan gate 3.1 dan 3.2 tercatat, dan `design.md` sudah diperbarui bila ada hipotesis yang terbantah. **Terpenuhi 2026-09-22:** ketiga keputusan (3.1 opsi B signed URL, 3.2 biarkan NULL, resolusi 2.13 dibatalkan) tercatat di `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13", dengan `bugfix.md`, `design.md`, dan `tasks.md` sudah diselaraskan.
  - **[AGENT]** Temuan audit fase 7 sudah masuk `bugfix.md` sebagai klausa 1.19+/2.19+/3.14+ beserta severity, tidak ada yang diperbaiki diam-diam.
  - **[AGENT]** `supabase/rollback/068_rollback.sql` ada dan isinya sesuai dengan yang benar-benar dicabut 068.
  - Bila ada pertanyaan atau ada poin yang tidak dapat dihijaukan, **tanyakan ke pengguna** sebelum menandai batch ini selesai.
