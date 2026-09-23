# Bugfix Requirements Document

## Introduction

Dokumen ini mencakup sisa cacat ZeePOS setelah 13 perbaikan sebelumnya selesai dan terverifikasi. Semua kondisi di bawah sudah diverifikasi langsung di kode pada tanggal penulisan (bukan dugaan): jalur refund tidak punya pemanggil, RPC laporan tidak punya penjagaan peran di server, bucket gambar produk terbaca lintas tenant, checkout bisa menggantung tanpa jalan keluar, dan migrasi `066_money_rounding_and_report_cost_basis.sql` belum pernah dieksekusi terhadap Postgres manapun.

Dampak bisnisnya bertingkat: uang yang tidak bisa dikembalikan dan stok yang tidak pulih (refund), data harga beli/laba yang bocor ke kasir, sampai fitur mati yang membingungkan operator (badge jatuh tempo yang tidak pernah muncul).

**Urutan severity (menentukan urutan pengerjaan):**

| Severity | Klausa | Ringkasan |
|---|---|---|
| P0 | 1.1–1.6, **1.19** | Refund tidak dapat dijalankan; data biaya/laba dan daftar staf terbuka untuk kasir; gambar produk terbaca lintas tenant; HPP/laba per baris transaksi dan agregat laba per nota terbaca kasir (1.19) |
| P1 | 1.7–1.10, **1.20** | Checkout menggantung tanpa recovery; sesi valid dilempar ke login di tengah shift; qty pecahan tidak bisa diinput; kamera barcode restart terus; objek storage yang sudah ter-cache CDN masih terbaca anonim setelah bucket diprivatkan (1.20) |
| P2 | 1.11–1.12, 1.14–1.15 | Jatuh tempo mati; dashboard memakai timezone perangkat; omzet akrual tidak terpisah dari kas diterima; struk thermal kehilangan informasi. **1.13 bukan lagi cacat terbuka:** diselesaikan sebagai **"bukan cacat"** dan klausa 2.13 **DIBATALKAN 2026-09-22 atas keputusan pemilik** — asimetri filter leg tunai `close_cash_shift` diterima sebagai perilaku benar; lihat catatan pada klausa 1.13/2.13 |
| P3 | 1.16–1.18 | Infrastruktur verifikasi: migrasi 066 belum tereksekusi, perbaikan lama belum diuji runtime, area kode belum diaudit |

Klausa **1.19–1.20 / 2.19–2.20** ditambahkan **2026-09-22** dari eksplorasi kondisi bug sisi SQL (task 5) terhadap target UAT pada skema 066, sesuai protokol klausa 1.18/2.18 (temuan baru dicatat sebagai klausa, bukan diperbaiki diam-diam). Nilai teramatinya ada di `verification-notes.md` bagian "Task 5".

**Keputusan produk yang sudah dikonfirmasi pemilik (dipakai sebagai dasar klausa 2.x):**

1. **Tenor kredit (`jatuh_tempo`)** — bersumber dari setelan toko baru `tempo_hutang_hari`, default 14 hari.
2. **Data biaya & laba** — kasir tidak boleh melihat omzet, HPP, maupun laba. Seluruh RPC laporan digerbangi `is_admin()`, dashboard menjadi admin-only, `harga_beli` disembunyikan dari pembacaan non-admin.
3. **Gambar produk** — `SELECT` dibatasi ke anggota tenant pemilik folder (bukan `public`, bukan signed URL). **DIREVISI 2026-09-22 atas keputusan pemilik (gate 3.1):** bagian "bukan signed URL" **dibatalkan** — pemuatan gambar memakai **signed URL ber-TTL pendek** (`createSignedUrl(path, 3600)`) langsung di `<img src>`, diperbarui sebelum kedaluwarsa. Pembatasan `SELECT` ke anggota tenant pemilik folder dan privatisasi bucket **tetap berlaku**. Alasan dan tradeoff-nya: `design.md` → [Migrasi Kebijakan Storage] dan `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".
4. **Penjualan hutang** — basis akrual dipertahankan; laporan wajib memisahkan omzet akrual dari kas yang benar-benar diterima.
5. **Verifikasi** — semua SQL diterapkan lewat Supabase ke target non-produksi (branch Supabase atau project staging) sebelum produksi.

Batasan lingkungan yang relevan: Docker tidak berjalan dan `psql` tidak terpasang di mesin pengembang, Supabase CLI v2.78.1, dan hanya satu project Supabase yang ter-link (`supabase/.temp/linked-project.json`). CI hanya menjalankan pemeriksaan teks statis atas file migrasi, bukan eksekusi SQL.

## Bug Analysis

### Current Behavior (Defect)

Perilaku yang terjadi saat ini, tiap klausa dapat diverifikasi sendiri-sendiri.

1.1 WHEN admin ingin membatalkan transaksi yang sudah dibayar dan mengembalikan uang THEN sistem tidak menyediakan jalur apa pun: `refund_transaction_atomic` ada di migrasi 056–060 tetapi tidak ada satu pun pemanggil `supabase.rpc` di `src/` (satu-satunya kemunculan kata "refund" di `src/` adalah asersi teks di `src/__tests__/latestHardening.test.ts`), sehingga stok tidak pulih dan ledger tidak terbalik.

1.2 WHEN shift kasir ditutup setelah ada pengembalian uang tunai THEN `close_cash_shift` menghitung `v_refund_tunai` dari tabel `transaction_refunds` yang tidak pernah ditulis aplikasi, sehingga leg refund selalu 0 dan `selisih` membebankan kekurangan kas ke kasir.

1.3 WHEN akun kasir memanggil `get_profit_summary`, `get_top_products`, `get_sales_by_date`, atau `get_dashboard_stats` langsung ke PostgREST THEN sistem mengembalikan omzet, HPP, dan laba karena keempat fungsi di-`GRANT EXECUTE ... TO authenticated` tanpa pemeriksaan `is_admin()` di dalam body; pembatasan hanya berupa `AdminRoute` di sisi UI, dan `/dashboard` sendiri tidak admin-only sehingga kasir tetap melihat kartu total penjualan hari ini.

1.4 WHEN kasir membaca tabel `products` (termasuk lewat katalog POS yang memakai `select('*')`) THEN sistem mengirim kolom `harga_beli` karena `products_tenant_select` (migrasi 054) hanya menyaring `tenant_id` tanpa membatasi kolom.

1.5 WHEN kasir memanggil `getStaffList()` atau membaca tabel `profiles` THEN sistem mengembalikan seluruh profil beserta `role` semua anggota tenant karena `profiles_tenant_select` bersifat tenant-wide.

1.6 WHEN siapa pun tanpa autentikasi mengakses objek di bucket `products` THEN sistem mengizinkan pembacaan seluruh gambar semua tenant, karena `product_images_public_select` (migrasi 054 baris ~496) memberi `SELECT` ke role `public` dengan syarat hanya `bucket_id = 'products'`; kebijakan tulis sudah benar terikat `/<tenant-id>/` + `is_admin()`.

1.7 WHEN `navigator.onLine` bernilai true tetapi Supabase tidak terjangkau (captive portal, project dijeda, DNS gagal) dan kasir menekan proses pembayaran THEN UI terkunci dengan `processingPayment` true tanpa batas waktu, karena `useOnlineStatus` hanya membaca `navigator.onLine` tanpa probe reachability dan `commitTransaction` memanggil `supabase.rpc` tanpa timeout maupun `AbortSignal`; satu-satunya jalan keluar adalah reload halaman.

1.8 WHEN pemulihan sesi Supabase lebih lama dari 8 detik pada koneksi lambat THEN `AuthProvider` melewati layar loading dan merender rute terproteksi dengan sesi belum resolve, `PrivateRoute` melihat `session` null, dan kasir yang sah dilempar ke `/login` di tengah shift.

1.9 WHEN kasir perlu menjual 0,25 / 0,5 / 0,75 satuan (kg, liter, pack) yang secara eksplisit didukung `CartItem` THEN `NumpadModal` tidak dapat menyatakannya: tidak ada tombol desimal dan pemanggilan di `POSPage` memakai `minValue={1}`; selain itu `initialValue` pecahan seperti 0,25 mengisi `valueStr` menjadi `"0.25"` sehingga satu tekanan digit menghasilkan `"0.255"`, dan `maxValue={9999}` mengabaikan batas stok baris tersebut.

1.10 WHEN modal scanner barcode terbuka dan `POSPage` re-render (perubahan keranjang, pencarian, toast, event realtime) THEN kamera dimatikan lalu diinisialisasi ulang dengan jeda 150 ms, karena `BarcodeScannerModal` menaruh `onClose` dan `onScanSuccess` di dependency `useEffect` sementara `POSPage` meneruskan arrow function inline, sehingga pemindaian sering tidak pernah tuntas.

1.11 WHEN penjualan hutang dicatat THEN sistem menyisipkan baris `receivables` tanpa `jatuh_tempo` (lihat `create_transaction_atomic` di migrasi 066, kolom yang diisi hanya `total_tagihan`, `jumlah_dibayar`, `sisa_hutang`, `status`), dan tidak ada kode lain di `src/` maupun migrasi mana pun yang menulis kolom itu, sehingga badge "Jatuh tempo" di `CustomersPage` tidak pernah tampil dan fitur aging/overdue menjadi kode mati.

1.12 WHEN kartu "penjualan hari ini" dan delta "% vs kemarin" ditampilkan di dashboard THEN keduanya memakai batas hari perangkat: `buildDayRange` di `src/api/reports.ts` memakai `startOfDay`/`endOfDay` date-fns dan `formatLocalDateKey` mem-bucket dengan tanggal lokal, sedangkan `get_dashboard_stats` mengunci `Asia/Jakarta`; pada tablet di luar WIB atau berjam salah, kedua angka yang berdampingan tidak cocok.

1.13 WHEN transaksi tunai berstatus batal namun `payment_status = 'dibayar'` dengan `paid_at` terisi THEN leg tunai `close_cash_shift` tetap menghitungnya sebagai uang masuk, karena filternya hanya `paid_at >= opened_at AND metode_bayar = 'tunai' AND payment_status = 'dibayar'` tanpa `status`, berbeda dari leg non-tunai di bawahnya yang memfilter `status = 'selesai'`; kondisi ini belum terjangkau karena `cancel_transaction_atomic` menolak transaksi tunai yang sudah dibayar, tetapi menjadi aktif begitu jalur refund (1.1) hidup.

> **⚠️ DIBATALKAN 2026-09-22 ATAS KEPUTUSAN PEMILIK — 1.13 AKURAT SEBAGAI DESKRIPSI, TETAPI KESIMPULANNYA TIDAK TERBUKTI; 2.13 RESMI DIBATALKAN.**
>
> Klausa ini **tidak diubah dan tidak dihapus**; yang berubah hanya **STATUS**-nya, dari "menunggu keputusan pemilik" menjadi **dibatalkan**. Seluruh bukti dan jejak hipotesis di bawah dipertahankan apa adanya. Yang berikut adalah catatan hasil eksplorasi task 5 terhadap target UAT (skema 066); nilai teramati lengkap ada di `verification-notes.md` → "Task 5 … Kasus 6", dan keputusannya di `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".
>
> Bagian **deskriptif** 1.13 terkonfirmasi: leg tunai memang tidak memfilter `status` dan memang berbeda dari leg non-tunai. Bagian **kesimpulannya** ("rekonsiliasi jadi salah begitu refund hidup") **terbantah**:
>
> - Penjualan + refund **di shift yang sama** (jual tunai 12.500, refund 12.500, uang fisik 100.000): kode sekarang → `total_penjualan_tunai` **0**, `selisih` **0**, **cocok dengan uang fisik**. Dengan `AND status = 'selesai'` ditambahkan → net tunai **−12.500**, total sistem **87.500**, `selisih` **+12.500 (SALAH)**.
> - Skenario **lintas shift**: gross tunai = 0 **dengan maupun tanpa** filter itu → filternya tidak berpengaruh sama sekali.
> - Satu-satunya jalur menuju `status = 'batal'` bagi transaksi tunai lunas adalah `refund_transaction_atomic`, yang **selalu** menulis `transaction_refunds`, sehingga pengurangan kasnya dijamin. `cancel_transaction_atomic` **menolak** transaksi lunas (`P0001: Transaksi lunas tidak dapat dibatalkan langsung...`) dan tidak menyentuh `transaction_refunds`; `cancel_pending_transaction` hanya menyentuh `menunggu_konfirmasi`, yang tidak pernah masuk leg tunai.
>
> **Konsekuensi:** perilaku yang diminta **2.13** (dan task 6.2 yang mengimplementasikannya) **akan memperkenalkan cacat uang yang sekarang tidak ada**, sebesar nominal refund, pada skenario satu shift.
>
> **KEPUTUSAN PEMILIK 2026-09-22 — opsi (a) DIPILIH: 2.13 DIBATALKAN.** Pembantahan empiris task 5 diterima sepenuhnya. Leg tunai `close_cash_shift` **dibiarkan apa adanya**; `AND status = 'selesai'` **tidak** ditambahkan. Karena itu **1.13 bukan cacat** dan tidak menjadi pekerjaan perbaikan apa pun; ia tetap tercatat di sini sebagai deskripsi faktual beserta alasan mengapa kesimpulan awalnya salah. Task 6.2 menjadi **"tidak ada perubahan pada `close_cash_shift`"** — migrasi 067 **tidak me-re-emit fungsi itu sama sekali**.

1.14 WHEN laporan omzet, laba, atau dashboard dihitung THEN penjualan hutang ikut terhitung sebagai uang masuk karena ditulis `payment_status = 'dibayar'` dengan `paid_at = NOW()` meski piutangnya `belum_lunas`, dan tidak ada pemisahan antara omzet akrual dan kas yang benar-benar diterima.

1.15 WHEN struk dicetak ke printer thermal (`buildReceiptBytes`) THEN struk kehilangan informasi yang ada pada struk browser (`ReceiptPrint`): satuan baris tidak dicetak sehingga "2x" pada produk multi-satuan ambigu (2 pcs atau 2 dus) dan qty pecahan tampil sebagai "0.5x" tanpa unit, harga satuan serta diskon per baris tidak tampil, nama produk dipotong `slice(0, width)` tanpa wrap, nama pelanggan dan catatan tidak diteruskan oleh `POSPage`, dan `cash_received`/`change` bernilai 0 hilang karena pemeriksaan truthy.

1.16 WHEN migrasi `066_money_rounding_and_report_cost_basis.sql` perlu diterapkan THEN belum ada cara yang aman dan terulang untuk memvalidasinya: file itu belum pernah dieksekusi terhadap Postgres manapun, Docker tidak berjalan dan `psql` tidak terpasang di mesin pengembang, hanya satu project Supabase yang ter-link (tanpa branch/staging terpisah), `scripts/reset-uat-cloud.sh` bergantung pada Docker, dan CI hanya mencocokkan regex terhadap teks migrasi lewat impor `?raw`.

1.17 WHEN perbaikan yang sudah selesai sebelumnya dipakai di lapangan THEN belum ada bukti runtime sama sekali: checkout tunai dengan PPN aktif (perubahan pembulatan rupiah bulat) dan perilaku sesi/cache offline `authStore` belum pernah dijalankan di browser terhadap database yang sudah bermigrasi 066.

1.18 WHEN cacat dicari di area yang belum pernah dibuka audit sebelumnya THEN status kebenarannya tidak diketahui: `src/pages/ProductsPage.tsx` (2247 baris), `src/pages/SettingsPage.tsx` (1130), `src/pages/StockPage.tsx` (870), `src/pages/AuditPage.tsx` (185), `src/utils/escpos.ts` (231), `src/components/pos/BarcodeScannerModal.tsx` (149), service worker/PWA offline shell, serta migrasi 001–052 yang baru diperiksa sebagian.

1.19 WHEN kasir membaca `transaction_items` atau view `transactions_with_kasir` THEN sistem mengirim HPP dan laba per baris maupun per nota — `transaction_items.harga_beli`, kolom generated `transaction_items.laba_kotor`, dan agregat `transactions_with_kasir.laba_kotor` — karena `transaction_items_tenant_select` hanya menyaring tenant dan view itu ber-`security_invoker = true`; klausa 1.4 hanya menyebut tabel `products`, sehingga menutup 1.4 saja **tidak** memenuhi keputusan produk "kasir tidak boleh melihat omzet, HPP, maupun laba". Terverifikasi sebagai kasir di target UAT pada skema 066: `SELECT id, nama_produk, harga_beli, laba_kotor FROM public.transaction_items` **berhasil** (id 1 `harga_beli` 900.00 `laba_kotor` 3500.00; id 2 `harga_beli` 900.00 `laba_kotor` 7000.00), dan `SELECT id, nomor_nota, kasir_nama, total, laba_kotor FROM public.transactions_with_kasir` **berhasil** (id 1 `NOTA-20260922-0001` total 12500.00 `laba_kotor` 3500.00; id 2 total 25000.00 `laba_kotor` 7000.00). **Severity: P0.**

1.20 WHEN bucket storage `products` diprivatkan (`storage.buckets.public = false`) THEN objek yang URL publiknya **sudah pernah diminta** masih terbaca **anonim** karena dilayani dari cache CDN Cloudflare sampai kedaluwarsa, sehingga privatisasi bucket tidak seketika menutup akses. Terverifikasi di target UAT: `curl` anonim ke URL yang sudah pernah diminta → **HTTP 200** dengan `cf-cache-status: HIT` (`cache-control: no-cache`, `cf-ray` region SIN), URL yang sama dengan cache-buster `?v=<random>` → **HTTP 400**, dan objek yang belum pernah diminta → **HTTP 400** langsung. Rencana 069 pada `design.md` saat ditulis hanya membalik flag bucket dan mengganti policy, tanpa langkah apa pun untuk menutup jendela cache ini. **Severity: P1.**

### Expected Behavior (Correct)

Setiap klausa berpasangan satu-satu dengan klausa 1.x bernomor sama.

2.1 WHEN admin membatalkan transaksi yang sudah dibayar dan mengembalikan uang THEN sistem SHALL menyediakan jalur refund yang terpakai dari UI: modul API memanggil `refund_transaction_atomic` dengan kunci idempotensi, stok item pulih, ledger terbalik, dan baris `transaction_refunds` tercatat dengan `payment_method` serta `cash_shift_id` yang benar.

2.2 WHEN shift kasir ditutup setelah ada refund tunai THEN `close_cash_shift` SHALL mengurangi kas dari baris `transaction_refunds` yang nyata ada, sehingga `total_penjualan_tunai` dan `selisih` cocok dengan uang fisik tanpa membebani kasir.

2.3 WHEN akun kasir memanggil `get_profit_summary`, `get_top_products`, `get_sales_by_date`, atau `get_dashboard_stats` langsung ke PostgREST THEN sistem SHALL menolak dengan kesalahan otorisasi karena setiap fungsi memeriksa `is_admin()` di dalam body, dan rute `/dashboard` SHALL berada di bawah `AdminRoute` sehingga kasir tidak melihat omzet, HPP, maupun laba.

2.4 WHEN kasir membaca data produk THEN sistem SHALL tidak mengirim `harga_beli` (pembacaan non-admin dialihkan ke view/kolom terbatas), sementara admin tetap menerima kolom tersebut.

2.5 WHEN kasir memanggil `getStaffList()` atau membaca `profiles` THEN sistem SHALL hanya mengembalikan profil miliknya sendiri; daftar staf beserta `role` SHALL hanya terbaca oleh admin.

2.6 WHEN objek di bucket `products` diakses THEN sistem SHALL mengizinkan `SELECT` hanya bagi pengguna terautentikasi yang tenant-nya sama dengan segmen pertama path `/<tenant-id>/`, dan SHALL menolak akses anonim maupun lintas tenant; migrasi SHALL memindahkan atau memetakan objek lama agar gambar tenant yang sah tetap tampil.

2.7 WHEN Supabase tidak terjangkau meski `navigator.onLine` true THEN sistem SHALL menghentikan percobaan checkout dalam batas waktu yang jelas (timeout + `AbortSignal`), SHALL mengembalikan `processingPayment` ke false, SHALL menampilkan pesan yang dapat ditindaklanjuti, dan SHALL mengizinkan percobaan ulang dengan kunci idempotensi yang sama tanpa reload halaman; status online SHALL ditentukan oleh probe reachability, bukan hanya `navigator.onLine`.

2.8 WHEN pemulihan sesi Supabase lebih lama dari batas waktu THEN sistem SHALL tetap menahan render rute terproteksi sampai status autentikasi resolve (atau menampilkan layar gagal-muat dengan tombol coba lagi), dan SHALL TIDAK mengarahkan pengguna bersesi valid ke `/login`.

2.9 WHEN kasir memasukkan qty untuk satuan yang mendukung pecahan THEN `NumpadModal` SHALL menyediakan input desimal (tombol koma/titik), SHALL menerima nilai minimum pecahan yang didukung, SHALL menolak digit tambahan yang melewati presisi yang diizinkan (0,25 tidak boleh menjadi 0,255), dan SHALL membatasi nilai maksimum pada sisa stok baris tersebut alih-alih konstanta 9999.

2.10 WHEN modal scanner barcode terbuka dan halaman induk re-render THEN kamera SHALL tetap berjalan tanpa inisialisasi ulang, dan pemindaian SHALL selesai pada percobaan pertama.

2.11 WHEN penjualan hutang dicatat THEN sistem SHALL mengisi `receivables.jatuh_tempo` = tanggal transaksi + setelan toko `tempo_hutang_hari` (default 14 hari, dapat diubah admin di Pengaturan), sehingga badge jatuh tempo dan penanda jatuh tempo terlewat di `CustomersPage` berfungsi.

2.12 WHEN kartu "penjualan hari ini" dan delta "% vs kemarin" ditampilkan THEN keduanya SHALL memakai batas hari `Asia/Jakarta` yang sama dengan RPC server, sehingga angka pada kedua kartu yang berdampingan konsisten apa pun timezone perangkat.

2.13 WHEN transaksi tunai tidak berstatus `selesai` THEN leg tunai `close_cash_shift` SHALL mengecualikannya, simetris dengan leg non-tunai, sehingga rekonsiliasi tetap benar setelah jalur refund aktif.

> **⚠️ STATUS 2026-09-22: KLAUSA 2.13 `DIBATALKAN 2026-09-22 ATAS KEPUTUSAN PEMILIK`. JANGAN DIIMPLEMENTASIKAN — TIDAK DALAM RUMUSAN INI MAUPUN RUMUSAN LAIN.**
>
> Klausa di atas **tidak dihapus dan tidak ditulis ulang**; yang berubah hanya **STATUS**-nya, dari "menunggu keputusan pemilik" menjadi **dibatalkan**. Pemilik spec memilih **opsi (a)**: terima pembantahan empiris task 5, biarkan leg tunai `close_cash_shift` apa adanya.
>
> Pengukuran di target UAT (skema 066) menunjukkan perilaku yang diminta 2.13 **membalik pengurangan dua kali**: penjualannya dikeluarkan dari leg tunai **dan** refundnya tetap dikurangkan di leg refund, sehingga `selisih` menjadi salah sebesar nominal refund pada skenario satu shift (**+12.500** pada kasus uji), sementara pada skenario lintas shift filternya tidak berpengaruh sama sekali. Kode sekarang menghasilkan `selisih` **0** yang **cocok dengan uang fisik** pada keempat shift uji. Angka dan tabel tandingannya ada di `verification-notes.md` → "Task 5 … Kasus 6"; koreksi rancangannya ada di `design.md` bagian **B.4** dan **B.3**.
>
> Dua opsi yang tersedia bagi pemilik adalah: (a) **batalkan 2.13** — asimetri leg tunai diterima sebagai perilaku benar, dan task 6.2 menjadi "tanpa perubahan pada `close_cash_shift`"; atau (b) **rumuskan ulang 2.13** sehingga tetap simetris tanpa mengurangi dua kali (mis. leg refund hanya menghitung refund atas penjualan yang `paid_at`-nya **di luar** shift ini).
>
> **Yang dipilih pemilik pada 2026-09-22: opsi (a).** Akibatnya, dan ini yang mengikat pelaksanaan:
>
> - **Task 6.2 menjadi "tidak ada perubahan pada `close_cash_shift`".** Migrasi 067 **tidak me-re-emit fungsi itu sama sekali** — bukan "di-re-emit verbatim", bukan "di-re-emit tanpa filter", tetapi **tidak disentuh**.
> - Syarat **"WAJIB SATU MIGRASI DENGAN PENGAKTIFAN REFUND" larut**, karena tidak ada lagi perubahan `close_cash_shift` yang perlu dipasangkan dengan UI refund. Task 9 (UI refund) **tidak lagi** berpasangan keras dengan 6.2.
> - Prasyarat task 9 yang **tetap berlaku**: 067 sudah live di produksi sebelum UI refund dirilis, karena 6.3 (`refund_transaction_atomic` = 060 + syarat shift kasir untuk refund tunai) memang berada di 067 dan dibutuhkan agar refund tunai selalu punya shift untuk diatribusikan.
> - **Property 11** di `design.md` dirumuskan ulang: ia tidak lagi boleh mengasersikan filter `status = 'selesai'`.
> - Klausa **1.13 diselesaikan sebagai "bukan cacat"**; ia keluar dari daftar cacat terbuka P2.
>
> Rujukan keputusan: `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".

2.14 WHEN laporan omzet, laba, atau dashboard dihitung THEN sistem SHALL menyajikan omzet akrual dan kas yang benar-benar diterima sebagai angka terpisah dan berlabel jelas, sehingga penjualan hutang yang belum tertagih tidak terbaca sebagai uang masuk.

2.15 WHEN struk dicetak ke printer thermal THEN struk SHALL memuat informasi yang setara dengan struk browser: satuan tiap baris, qty pecahan beserta unitnya, harga satuan dan diskon baris, nama pelanggan dan catatan bila ada, serta nilai `Bayar`/`Kembalian` termasuk saat bernilai 0; nama produk panjang SHALL di-wrap, bukan dipotong.

2.16 WHEN migrasi 066 dan migrasi baru hasil pekerjaan ini akan diterapkan THEN sistem SHALL punya alur yang terdokumentasi dan terulang: `supabase db push` dijalankan lebih dulu ke target non-produksi (branch Supabase atau project staging terpisah), hasilnya diverifikasi, baru kemudian dipromosikan ke produksi; SHALL ada pemeriksaan SQL yang bisa dijalankan tanpa Docker untuk kasus minimum, dan prasyarat Docker SHALL disebutkan eksplisit untuk pemeriksaan yang memang membutuhkannya.

2.17 WHEN perbaikan yang sudah selesai diverifikasi THEN SHALL ada daftar uji asap runtime yang dijalankan di browser terhadap database bermigrasi 066, minimal mencakup checkout tunai dengan PPN aktif (total, PPN, dan kembalian membulat ke rupiah bulat dan cocok dengan struk) serta perilaku `authStore` saat pengambilan profil gagal (sesi bertahan, katalog offline tidak terhapus), dengan hasil tercatat.

2.18 WHEN pekerjaan ini selesai THEN setiap area pada 1.18 SHALL sudah diaudit dengan temuannya dicatat, dan setiap cacat yang ditemukan SHALL diperlakukan sama dengan klausa lain di dokumen ini: diberi kondisi bug, perilaku yang diharapkan, dan severity.

2.19 WHEN kasir membaca data transaksi THEN sistem SHALL tidak mengirim `transaction_items.harga_beli`, `transaction_items.laba_kotor`, maupun agregat `transactions_with_kasir.laba_kotor`; kasir SHALL tetap dapat membaca nota dan item notanya untuk keperluan cetak ulang struk lewat jalur baca tanpa kolom biaya, sementara admin SHALL tetap menerima kolom HPP dan laba secara penuh.

2.20 WHEN bucket `products` diprivatkan THEN rencana penerapan 069 SHALL memuat langkah eksplisit yang menutup jendela cache CDN — purge cache untuk objek bucket tersebut, atau rotasi nama objek sehingga URL publik lama tidak lagi menunjuk objek mana pun — dan verifikasinya SHALL dijalankan dengan cache-buster sehingga respons dari cache tidak salah dibaca sebagai bukti; setelah langkah itu, URL `/object/public/products/...` SHALL tidak lagi melayani objek apa pun kepada pemanggil anonim.

### Unchanged Behavior (Regression Prevention)

Perilaku yang sudah benar dan tidak boleh berubah, termasuk hasil 13 perbaikan sebelumnya.

3.1 WHEN admin membuka laporan atau dashboard THEN sistem SHALL CONTINUE TO menampilkan omzet, HPP, laba, produk terlaris, dan penjualan per tanggal seperti sekarang setelah penggerbangan peran diterapkan.

3.2 WHEN transaksi tulis dilakukan (penyesuaian stok, repack, ubah produk, ubah setelan) THEN sistem SHALL CONTINUE TO menolaknya untuk non-admin lewat `is_admin()` sebagaimana sudah benar sejak migrasi 054, dengan atribusi aktor dari `auth.uid()`.

3.3 WHEN checkout normal berjalan di jaringan sehat THEN sistem SHALL CONTINUE TO memakai kunci idempotensi, menolak duplikasi, dan memulihkan struk pada percobaan ulang identik.

3.4 WHEN qty bulat diinput di numpad THEN sistem SHALL CONTINUE TO memperlakukannya persis seperti sekarang, termasuk validasi stok agregat lintas satuan dalam satuan dasar.

3.5 WHEN aplikasi offline (benar-benar tanpa jaringan) THEN sistem SHALL CONTINUE TO menonaktifkan checkout dan menyajikan katalog cache sebagai referensi saja.

3.6 WHEN shift kasir ditutup tanpa refund THEN sistem SHALL CONTINUE TO menghitung penjualan tunai berdasarkan `paid_at`, menolak penutupan bila masih ada QRIS/transfer belum dikonfirmasi, dan mengatribusikan non-tunai lewat `confirmed_by`.

3.7 WHEN pembayaran cicilan piutang dicatat THEN sistem SHALL CONTINUE TO memakai `pay_receivable_atomic` dengan kunci idempotensi dan memperbarui `sisa_hutang` serta `total_hutang` pelanggan.

3.8 WHEN batas rentang tanggal laporan dihitung THEN sistem SHALL CONTINUE TO memakai batas bawah WIB inklusif dan batas atas eksklusif (`getISOStartOfDay` / `getISOExclusiveEndOfDay`) sehingga transaksi pada detik terakhir hari tidak hilang.

3.9 WHEN gambar produk milik tenant sendiri ditampilkan di ProductsPage dan POSPage oleh anggota tenant yang sah THEN sistem SHALL CONTINUE TO menampilkannya setelah kebijakan storage dipersempit.

3.10 WHEN pesanan diparkir lalu dilanjutkan THEN sistem SHALL CONTINUE TO memakai klaim/rollback yang sudah diperbaiki, tanpa pesanan hilang dan tanpa filter visibilitas yang tidak konsisten.

3.11 WHEN item ditambahkan, dihapus, atau keranjang dikosongkan THEN sistem SHALL CONTINUE TO menjaga perilaku hasil perbaikan sebelumnya: stok tidak dihitung ganda, `ppn_persen` tidak terhapus, catatan pesanan tidak bocor antar pelanggan, dan hutang tanpa pelanggan tetap dicegah dengan jalan keluar yang jelas.

3.12 WHEN pengguna login, logout, atau sesi dipulihkan THEN sistem SHALL CONTINUE TO menetapkan tenant saat login, tidak menghapus cache offline karena kegagalan pengambilan profil, membersihkan data perangkat saat logout meski `signOut` gagal, dan tidak berlangganan ganda di bawah StrictMode.

3.13 WHEN struk browser dicetak THEN sistem SHALL CONTINUE TO merekonsiliasi baris item dengan subtotal setelah diskon seperti hasil perbaikan sebelumnya.

3.14 WHEN kasir membuka riwayat transaksi, mencetak ulang struk, atau melihat daftar nota menunggu konfirmasi THEN sistem SHALL CONTINUE TO menampilkan nomor nota, nama kasir, item, qty, satuan, harga jual, dan total seperti sekarang setelah kolom biaya/laba ditutup untuk klausa 1.19; penutupan itu SHALL hanya menghilangkan `harga_beli` dan `laba_kotor`, bukan membuat jalur baca kasir gagal. Nilai referensi teramati di target UAT: id 1 `NOTA-20260922-0001`, `kasir_nama` `Kasir Satu`, total 12500.00; id 2 `NOTA-20260922-0002`, total 25000.00.
