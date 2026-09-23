# ZeePOS Remaining Bug Fixes — Bugfix Design

## Overview

Dokumen ini merancang perbaikan untuk 18 klausa cacat (1.1–1.18) pada `bugfix.md`. Rancangan disusun per **akar masalah**, bukan per gejala, karena beberapa klausa berbagi satu akar dan harus diperbaiki sebagai satu kesatuan:

| Klaster | Klausa | Akar tunggal |
|---|---|---|
| A. Otorisasi sisi baca | 1.3, 1.4, 1.5 | Otorisasi dimodelkan di lapisan rute UI, sementara lapisan data tetap tenant-wide |
| B. Refund | 1.1, 1.2, 1.13 | RPC refund lengkap ada di server tetapi tidak punya pemanggil, sehingga ledger refund kosong dan asimetri filter closing shift belum terjangkau |
| C. Batas tunggu | 1.7, 1.8 | Aplikasi tidak punya strategi *bounded wait* terhadap Supabase sama sekali |
| D. Input & perangkat kasir | 1.9, 1.10 | Presisi qty dan identitas callback React |
| E. Waktu, tempo, dan pelaporan | 1.11, 1.12, 1.14 | Batas hari/tempo dihitung di dua tempat dengan aturan berbeda; akrual tidak dipisahkan dari kas |
| F. Struk thermal | 1.15 | `buildReceiptBytes` dibangun terpisah dari `ReceiptPrint` tanpa sumber data bersama |
| G. Infrastruktur verifikasi | 1.16, 1.17, 1.18 | Tidak ada jalur eksekusi SQL non-produksi, tidak ada bukti runtime, ada area tanpa audit |

Strategi umum: **server jadi otoritatif, klien mengikuti**. Semua penggerbangan peran, pembulatan uang, tempo kredit, dan batas hari ditetapkan di Postgres; frontend hanya menampilkan dan memberi jalan keluar yang jelas. Karena beberapa perubahan SQL **menghapus kemampuan** yang masih dipakai frontend saat ini, urutan penerapan migrasi terhadap deploy frontend menjadi bagian rancangan yang setara pentingnya dengan SQL-nya sendiri (lihat [Strategi Migrasi](#strategi-migrasi)).

Klaster A adalah perubahan paling berisiko dalam batch ini: satu kesalahan membuat katalog POS mati untuk kasir. Karena itu klaster A dirancang dengan jalur baca yang eksplisit per peran, dan penghapusan hak kolom ditunda ke migrasi terpisah yang hanya boleh diterapkan setelah frontend penggantinya sudah live.

## Glossary

- **Bug_Condition (C)** — himpunan input yang memicu cacat. Untuk batch ini C adalah gabungan 18 sub-kondisi, satu per klausa 1.x, yang diformalkan di [Bug Details](#bug-details).
- **Property (P)** — perilaku benar yang wajib dipenuhi untuk input di dalam C, diambil satu-satu dari klausa 2.x.
- **Preservation** — perilaku untuk input di luar C (¬C) yang wajib identik sebelum dan sesudah perbaikan; sumbernya klausa 3.1–3.13.
- **F / F'** — fungsi sebelum perbaikan / setelah perbaikan (baik fungsi SQL maupun handler frontend).
- **`is_admin()`** — fungsi SQL `SECURITY DEFINER` yang menilai peran pemanggil dari `auth.uid()`. Aman dipanggil dari dalam body `SECURITY DEFINER` lain karena `auth.uid()` membaca klaim JWT request, bukan peran eksekusi — pola ini sudah dipakai `create_transaction_atomic`.
- **Jalur baca kasir** — view `products_with_category` dan `transactions_with_kasir`; satu-satunya sumber katalog dan riwayat yang dibaca POSPage (`select('*')`).
- **Jalur baca admin** — view baru bersuffiks `_admin` yang memuat kolom biaya/laba dan menggerbangi `is_admin()` di dalam definisinya.
- **Kolom biaya** — `products.harga_beli`, `product_units.harga_beli`, `product_price_history.harga_beli`, `transaction_items.harga_beli`, `transaction_items.laba_kotor`, dan agregat `transactions_with_kasir.laba_kotor`.
- **Rotasi kunci idempotensi** — disiplin yang sudah berlaku di `POSPage.handleProcessPayment` dan `CustomersPage.handlePaySubmit`: kunci dipertahankan untuk percobaan ulang payload identik (recovery respons hilang) dan dirotasi begitu payload berubah, supaya `request_fingerprint` server tidak pernah mismatch.
- **Bounded wait** — setiap panggilan jaringan punya batas waktu dan `AbortSignal`, sehingga `finally` selalu tereksekusi dan UI tidak pernah terkunci permanen.
- **Migrasi aditif vs subtraktif** — aditif menambah objek/hak (aman diterapkan sebelum frontend); subtraktif mencabut hak atau menambah penolakan (hanya aman setelah frontend penggantinya live).

## Bug Details

### Bug Condition

Cacat bermanifestasi pada tujuh permukaan berbeda yang masing-masing punya pemicu sendiri. Formalisasi di bawah memakai satu predikat gabungan `isBugCondition` dengan sub-predikat per klaster, sehingga *fix checking* dan *preservation checking* dapat dijalankan per klaster tanpa kehilangan kerangka bersama.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input berupa salah satu dari
         { RpcCall, TableRead, StorageRead, CheckoutAttempt, SessionRestore,
           QtyEntry, ScannerSession, CreditSale, ReportRange, ReceiptPrint,
           MigrationApply }
  OUTPUT: boolean

  RETURN isReadAuthorizationBug(input)      -- 1.3, 1.4, 1.5
      OR isStorageTenancyBug(input)         -- 1.6
      OR isRefundPathBug(input)             -- 1.1, 1.2, 1.13
      OR isUnboundedWaitBug(input)          -- 1.7, 1.8
      OR isKasirInputBug(input)             -- 1.9, 1.10
      OR isTimeAndLedgerBug(input)          -- 1.11, 1.12, 1.14
      OR isThermalReceiptBug(input)         -- 1.15
      OR isVerificationGapBug(input)        -- 1.16, 1.17, 1.18
END FUNCTION

FUNCTION isReadAuthorizationBug(input)
  RETURN NOT callerIsAdmin(input.caller)
     AND (
          (input.kind = 'RpcCall'
           AND input.function IN ['get_profit_summary', 'get_top_products',
                                  'get_sales_by_date', 'get_dashboard_stats']
           AND rpcSucceeds(input))
       OR (input.kind = 'TableRead'
           AND responseColumns(input) INTERSECTS COST_COLUMNS)
       OR (input.kind = 'TableRead'
           AND input.relation = 'profiles'
           AND EXISTS row IN responseRows(input) WHERE row.id <> input.caller.uid)
         )
END FUNCTION

FUNCTION isStorageTenancyBug(input)
  RETURN input.kind = 'StorageRead'
     AND input.bucket = 'products'
     AND objectIsReadable(input)
     AND (input.caller IS anonymous
          OR firstPathSegment(input.objectName) <> tenantOf(input.caller))
END FUNCTION

FUNCTION isRefundPathBug(input)
  RETURN (input.kind = 'RefundIntent'
          AND transactionIsPaid(input.transaction)
          AND NOT existsUiPathInvoking('refund_transaction_atomic'))
      OR (input.kind = 'ShiftClose'
          AND cashLegCounts(input.shift, transactionsWithStatus('batal')))
      OR (input.kind = 'ShiftClose'
          AND refundRowsExist(input.shift)
          AND cashRefundLeg(input.shift) = 0)
END FUNCTION

FUNCTION isUnboundedWaitBug(input)
  RETURN (input.kind = 'CheckoutAttempt'
          AND navigatorOnLine = true
          AND NOT supabaseReachable()
          AND requestHasNoDeadline(input))
      OR (input.kind = 'SessionRestore'
          AND elapsed(input) > AUTH_TIMEOUT_MS
          AND sessionUnresolved(input)
          AND protectedRouteRendered(input))
END FUNCTION

FUNCTION isKasirInputBug(input)
  RETURN (input.kind = 'QtyEntry'
          AND unitAllowsFraction(input.line.satuan)
          AND (NOT decimalSeparatorAvailable(input)
               OR digitsAfterSeparator(input.value) > allowedPrecision(input.line)
               OR input.maxValue <> remainingSaleUnitStock(input.line)))
      OR (input.kind = 'ScannerSession'
          AND parentRerenderOccurred(input)
          AND cameraRestarted(input))
END FUNCTION

FUNCTION isTimeAndLedgerBug(input)
  RETURN (input.kind = 'CreditSale' AND receivableOf(input).jatuh_tempo IS NULL)
      OR (input.kind = 'ReportRange'
          AND dayBoundary(input.client) <> dayBoundary('Asia/Jakarta'))
      OR (input.kind = 'ReportRange'
          AND accrualRevenue(input) = reportedCashReceived(input))
END FUNCTION

FUNCTION isThermalReceiptBug(input)
  RETURN input.kind = 'ReceiptPrint'
     AND input.target = 'thermal'
     AND informationLoss(input, browserReceiptOf(input)) <> EMPTY
END FUNCTION

FUNCTION isVerificationGapBug(input)
  RETURN (input.kind = 'MigrationApply' AND NOT existsNonProdValidationPath(input))
      OR (input.kind = 'RuntimeEvidence' AND NOT existsRecordedSmokeResult(input))
      OR (input.kind = 'AuditCoverage' AND input.area IN UNAUDITED_AREAS)
END FUNCTION

WHERE COST_COLUMNS = {
  products.harga_beli, product_units.harga_beli, product_price_history.harga_beli,
  transaction_items.harga_beli, transaction_items.laba_kotor,
  transactions_with_kasir.laba_kotor
}
```

### Examples

Otorisasi sisi baca (1.3–1.5):

- Kasir memanggil `POST /rest/v1/rpc/get_profit_summary` dengan rentang satu bulan. Diharapkan: error otorisasi. Aktual: baris omzet, HPP, dan laba per tanggal terkirim, karena keempat fungsi laporan `GRANT EXECUTE ... TO authenticated` tanpa `is_admin()` di body.
- Kasir membuka `/dashboard`. Diharapkan: tidak punya akses. Aktual: kartu "Penjualan hari ini" tampil, karena `/dashboard` berada di bawah `PrivateRoute` saja, bukan `AdminRoute`.
- Kasir memanggil `GET /rest/v1/products?select=nama,harga_beli`. Diharapkan: kolom ditolak. Aktual: harga beli terkirim, karena `products_tenant_select` hanya menyaring `tenant_id`.
- Kasir memanggil `GET /rest/v1/transaction_items?select=harga_beli,laba_kotor`. Diharapkan: kolom ditolak. Aktual: terkirim. **Temuan baru saat perancangan** — klausa 1.4 hanya menyebut `products`, tetapi akar yang sama membocorkan HPP dan laba per baris transaksi, dan view `transactions_with_kasir` yang dipakai POSPage bahkan mengekspos agregat `laba_kotor` per transaksi. Penutupan klaster A harus mencakup ini agar keputusan produk "kasir tidak boleh melihat omzet, HPP, maupun laba" benar-benar terpenuhi.
- Kasir memanggil `getStaffList()`. Diharapkan: hanya profil dirinya. Aktual: seluruh profil tenant beserta `role`.

Storage lintas tenant (1.6):

- Peramban tanpa sesi membuka `.../storage/v1/object/public/products/<tenant-lain>/<file>.jpg`. Diharapkan: ditolak. Aktual: gambar tampil. **Mekanisme sebenarnya lebih luas dari yang tercatat di 1.6**: selain policy `product_images_public_select` yang memberi `SELECT` ke role `public`, bucket `products` sendiri dibuat dengan `public = true` di migrasi 016 dan frontend memakai `getPublicUrl()`. Endpoint `/object/public/...` melayani objek tanpa mengevaluasi RLS `storage.objects`, sehingga **mempersempit policy saja tidak menutup 1.6**. Lihat [Migrasi Kebijakan Storage](#migrasi-kebijakan-storage-162639).

Refund (1.1, 1.2, 1.13):

- Admin ingin membatalkan nota tunai lunas Rp 150.000 dan mengembalikan uang. Diharapkan: satu aksi yang memulihkan stok, membalik ledger, dan mencatat `transaction_refunds`. Aktual: tidak ada tombol, tidak ada `supabase.rpc('refund_transaction_atomic')` di `src/` sama sekali.
- Shift ditutup setelah satu refund tunai Rp 150.000. Diharapkan: `total_penjualan_tunai` berkurang Rp 150.000 dan `selisih` nol. Aktual: leg refund 0 dan kasir dibebani kekurangan Rp 150.000.
- Setelah jalur refund hidup, nota tunai berstatus `batal` dengan `payment_status = 'dibayar'` dan `paid_at` terisi masih dihitung sebagai uang masuk oleh leg tunai. Diharapkan: dikecualikan, simetris dengan leg non-tunai.

Batas tunggu (1.7, 1.8):

- Tablet tersambung WiFi captive portal; `navigator.onLine` true, Supabase tidak terjangkau; kasir menekan Proses Pembayaran. Diharapkan: gagal dalam batas waktu jelas, tombol kembali aktif, boleh coba lagi dengan kunci idempotensi yang sama. Aktual: `processingPayment` true selamanya karena `supabase.rpc` tidak pernah settle sehingga blok `finally` tidak pernah berjalan; satu-satunya jalan keluar reload.
- Pemulihan sesi 12 detik pada 3G lambat. Diharapkan: tetap menahan render atau menampilkan layar gagal-muat dengan tombol coba lagi. Aktual: setelah 8 detik `AuthProvider` merender anak, `PrivateRoute` melihat `session` null, kasir dilempar ke `/login`.

Input kasir (1.9, 1.10):

- Kasir menjual 0,25 kg. Diharapkan: bisa diinput. Aktual: tidak ada tombol koma dan `minValue={1}`.
- Qty awal 0,25 lalu kasir menekan "5". Diharapkan: ditolak atau menjadi 0,255 tidak diizinkan. Aktual: `valueStr` menjadi `"0.255"`.
- Baris dengan sisa stok 3 dus. Diharapkan: maksimum 3. Aktual: `maxValue={9999}`.
- Scanner terbuka, keranjang berubah karena event realtime. Diharapkan: kamera terus berjalan. Aktual: kamera mati lalu init ulang 150 ms, pemindaian gagal tuntas.

Waktu dan pelaporan (1.11, 1.12, 1.14):

- Penjualan hutang Rp 500.000 dicatat 1 Maret. Diharapkan: `jatuh_tempo` = 15 Maret (setelan `tempo_hutang_hari` default 14). Aktual: NULL, badge di `CustomersPage` tidak pernah tampil.
- Tablet ber-timezone Asia/Makassar (WITA). Diharapkan: kartu "penjualan hari ini" dan "% vs kemarin" konsisten. Aktual: `buildDayRange` memakai `startOfDay/endOfDay` perangkat sedangkan `get_dashboard_stats` memakai `Asia/Jakarta`, dua angka berdampingan tidak cocok.
- Bulan dengan Rp 10 juta penjualan, Rp 3 juta di antaranya hutang belum tertagih. Diharapkan: "Omzet (akrual) Rp 10 juta" dan "Kas diterima Rp 7 juta" terpisah dan berlabel. Aktual: satu angka Rp 10 juta yang terbaca sebagai uang masuk.

Struk thermal (1.15):

- Nota berisi 2 dus dan 3 pcs produk yang sama. Diharapkan: "2 dus" dan "3 pcs". Aktual: dua baris "2x" dan "3x" yang ambigu.
- Nota qty 0,5 kg. Aktual: "0.5x" tanpa unit.
- Nota dengan `kembalian = 0` (uang pas). Diharapkan: baris "Kembalian Rp 0" tetap tercetak. Aktual: hilang karena pemeriksaan truthy `data.change != null && data.change > 0` dan `POSPage` mengirim `undefined` lewat `receiptTransaction.kembalian ? ... : undefined`.
- Nama produk 40 karakter di kertas 58 mm (32 kolom). Diharapkan: wrap dua baris. Aktual: dipotong `slice(0, width)`.
- Nota dengan pelanggan dan catatan. Aktual: `POSPage` tidak meneruskan `customer_name` maupun `note`.

Verifikasi (1.16–1.18):

- `066_money_rounding_and_report_cost_basis.sql` perlu diterapkan. Diharapkan: jalur validasi non-produksi yang terulang. Aktual: file belum pernah dieksekusi terhadap Postgres manapun (masih `??` untracked di `git status`), Docker mati, `psql` tidak ada, satu project ter-link.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors** (sumber: klausa 3.1–3.13):

- Admin tetap melihat omzet, HPP, laba, produk terlaris, dan penjualan per tanggal seperti sekarang setelah penggerbangan peran (3.1). Konsekuensi konkret: `ProductsPage` tetap menampilkan kolom Harga Beli, Margin%, sorting `harga_beli`, dan ekspor XLSX berisi Harga Beli; `ReportsPage` tetap menampilkan kolom Laba per transaksi.
- Semua tulis (penyesuaian stok, repack, ubah produk, ubah setelan) tetap ditolak untuk non-admin lewat `is_admin()` dengan atribusi `auth.uid()` (3.2).
- Checkout normal di jaringan sehat tetap memakai kunci idempotensi, menolak duplikasi, dan memulihkan struk pada percobaan ulang identik (3.3). Rancangan timeout tidak boleh mengubah semantik kunci: kunci hanya dirotasi saat fingerprint payload berubah dan hanya dibuang saat sukses.
- Qty bulat di numpad diperlakukan persis seperti sekarang, termasuk validasi stok agregat lintas satuan dalam satuan dasar (3.4). `cartStore.updateQty` dan `baseDemandOf` tidak berubah perilakunya untuk bilangan bulat.
- Saat benar-benar offline, checkout tetap dinonaktifkan dan katalog cache tetap disajikan sebagai referensi (3.5). Probe reachability hanya boleh **menambah** kondisi offline, tidak mengubah jalur offline yang sudah benar.
- Closing shift tanpa refund tetap menghitung tunai berdasarkan `paid_at`, tetap menolak penutupan bila ada QRIS/transfer belum dikonfirmasi, dan tetap mengatribusikan non-tunai lewat `confirmed_by` (3.6).
- `pay_receivable_atomic` tetap dipakai dengan kunci idempotensi dan tetap memperbarui `sisa_hutang` serta `customers.total_hutang` (3.7).
- `getISOStartOfDay` / `getISOExclusiveEndOfDay` tetap menjadi batas rentang laporan (bawah inklusif, atas eksklusif) (3.8). Perbaikan 1.12 menambah helper baru, bukan mengubah dua fungsi ini.
- Gambar produk milik tenant sendiri tetap tampil di `ProductsPage` dan `POSPage` untuk anggota tenant yang sah setelah kebijakan storage dipersempit (3.9).
- Parkir pesanan tetap memakai klaim/rollback hasil perbaikan sebelumnya (3.10).
- Perilaku keranjang hasil perbaikan sebelumnya tetap terjaga: stok tidak dihitung ganda, `ppn_persen` tidak terhapus oleh `clearCart`, catatan pesanan tidak bocor antar pelanggan, hutang tanpa pelanggan tetap dicegah (3.11).
- Perilaku sesi hasil perbaikan sebelumnya tetap terjaga: tenant di-set saat login, kegagalan ambil profil tidak menghapus cache offline, logout membersihkan data perangkat meski `signOut` gagal, tidak ada langganan ganda di StrictMode (3.12).
- Struk browser tetap merekonsiliasi baris item dengan subtotal setelah diskon (3.13).

**Scope:**

Semua input di luar C harus sama sekali tidak terpengaruh:

- Pembacaan admin ke seluruh kolom biaya dan seluruh RPC laporan.
- Pembacaan kasir ke kolom non-biaya: katalog (`nama`, `harga_jual`, `stok`, `satuan`, `foto_url`, `diskon_produk_persen`, `barcode`, `sku`), nota dan item nota miliknya, profil dirinya sendiri.
- Checkout, konfirmasi, dan pembatalan pada jaringan sehat.
- Qty bilangan bulat pada satuan diskret (pcs, dus, lusin, ikat, bal, roll, batang, lembar).
- Sesi yang resolve dalam batas waktu normal.
- Gambar produk yang object path-nya sudah berada di bawah `/<tenant-id>/`.
- Transaksi tunai `selesai` pada rekonsiliasi shift tanpa refund.
- Struk browser (`ReceiptPrint`) dan `printWindow`.

Catatan: perilaku benar yang diharapkan untuk input **di dalam** C didefinisikan di [Correctness Properties](#correctness-properties), bukan di bagian ini.

## Hypothesized Root Cause

### A. Otorisasi sisi baca dimodelkan di lapisan yang salah (1.3, 1.4, 1.5)

1. **Penggerbangan peran hanya ada di router React.** `AdminRoute` melindungi `/produk`, `/stok`, `/laporan`, `/audit`, `/pengaturan` — tetapi tidak `/dashboard`, dan router tidak melindungi apa pun dari pemanggilan langsung ke PostgREST. Empat RPC laporan (`get_profit_summary`, `get_top_products`, `get_sales_by_date` di 045, `get_dashboard_stats` di 066) semuanya `SECURITY DEFINER` + `GRANT EXECUTE TO authenticated` tanpa satu pun `is_admin()` di body. Pemegang anon key + sesi kasir bisa memanggilnya langsung.

2. **RLS `products` menyaring baris, bukan kolom.** `products_tenant_select` (054) hanya `tenant_id = get_my_tenant_id()`. Postgres tidak punya RLS tingkat kolom; pembatasan kolom hanya tersedia lewat *column privileges*, dan itu diberikan per **role**. Karena admin dan kasir berbagi satu role PostgREST (`authenticated`), `REVOKE SELECT (harga_beli) ... FROM authenticated` mencabutnya dari admin juga. Inilah kendala struktural yang menentukan seluruh bentuk solusi.

3. **View katalog dibangun dengan `p.*`.** `products_with_category` (039, `security_invoker = true`) mengekspansi `p.*` saat pembuatan, sehingga setiap kolom baru pada `products` otomatis ikut terekspos — termasuk `harga_beli`. Karena `security_invoker = true`, view mewarisi hak dan RLS pemanggil, jadi view ini **tidak bisa** dipakai sebagai jalur privilese admin.

4. **Permukaan kolom biaya lebih luas dari yang tercatat.** Selain `products.harga_beli`, `transaction_items.harga_beli` dan kolom generated `laba_kotor` ((harga_satuan − harga_beli) × qty, migrasi 029) terbuka lewat `transaction_items_tenant_select`, dan `transactions_with_kasir` mengagregasi `SUM(ti.laba_kotor)` ke kolom `laba_kotor` yang dibaca POSPage untuk daftar pending. `product_price_history.harga_beli` dan `product_units.harga_beli` juga tenant-wide.

5. **`profiles_tenant_select` tenant-wide.** Diperlukan oleh view `transactions_with_kasir` untuk me-resolve `kasir_nama`; mempersempitnya ke "profil sendiri" akan membuat nama kasir lain menjadi NULL pada view ber-`security_invoker`. Jadi 1.5 tidak bisa diselesaikan hanya dengan mengganti predikat policy — jalur resolusi nama kasir harus dipindahkan.

### B. Jalur refund tidak pernah disambungkan ke UI (1.1, 1.2, 1.13)

1. **Server sudah lengkap, klien kosong.** `refund_transaction_atomic(integer, text, text)` versi final ada di migrasi 060: admin-only, wajib alasan, wajib kunci idempotensi, fingerprint `sha256` atas `{transaction_id, alasan}`, tolak `status = 'batal'`, tolak `payment_status <> 'dibayar'`, tolak `inventory_snapshot_status = 'ambiguous_legacy'`, batalkan piutang bila metode hutang dan belum ada cicilan, pulihkan stok dari `base_qty` dengan row lock, catat `stock_adjustments`, tulis `transaction_refunds`, set transaksi `batal`, tulis audit log. Tidak ada cacat pada RPC-nya. Yang hilang: nol pemanggil di `src/`.

2. **Karena itu 1.2 bukan cacat SQL.** `close_cash_shift` (064) sudah menghitung `v_refund_tunai` dari `transaction_refunds` dengan atribusi `cash_shift_id = p_shift_id OR (cash_shift_id IS NULL AND requested_by = shift.kasir_id AND created_at >= opened_at)` dan sudah menguranginya dari kas bersih. Legnya selalu 0 **semata-mata** karena tabelnya tidak pernah ditulis. Menyambungkan 1.1 menyelesaikan 1.2 tanpa perubahan SQL pada leg refund. Yang perlu ditambahkan hanya jaminan bahwa refund tunai selalu punya shift yang jelas untuk diatribusikan.

3. **1.13 adalah cacat SQL nyata dan laten.** Leg tunai memfilter `paid_at >= opened_at AND metode_bayar = 'tunai' AND payment_status = 'dibayar'` tanpa `status`, sedangkan leg non-tunai di bawahnya memfilter `status = 'selesai'`. Refund men-set `status = 'batal'` tetapi **tidak** mengubah `payment_status` maupun `paid_at`, jadi begitu 1.1 hidup, setiap refund tunai dihitung dua kali: sekali sebagai penjualan yang masih masuk leg tunai, sekali sebagai pengurang di leg refund — hasil bersihnya nol, padahal seharusnya penjualannya keluar dari leg tunai dan refund mengurangi kas. Karena itu 1.13 **wajib** berada di migrasi yang sama dengan pengaktifan refund, bukan sesudahnya.

> **KOREKSI 2026-09-22 — butir 3 di atas TERBANTAH secara empiris (eksplorasi task 5).**
> Butir 3 **sengaja tidak dihapus** supaya riwayat penalarannya terbaca; ia **tidak lagi
> berlaku** sebagai dasar implementasi. Bukti lengkap: `verification-notes.md` →
> "Task 5 … Kasus 6".
>
> Yang diamati di target UAT (skema 066), penjualan dan refund **di shift yang sama**
> (shift `7f3bac2d`, modal 100.000, jual tunai 12.500, lalu refund 12.500; uang fisik
> sebenarnya 100.000):
>
> | Besaran | Kode sekarang (066) | Bila `AND status = 'selesai'` ditambahkan |
> |---|---|---|
> | gross tunai | 12.500 | **0** |
> | refund tunai | 12.500 | 12.500 |
> | net tunai | 0 | **−12.500** |
> | total sistem | 100.000 | **87.500** |
> | selisih (fisik 100.000) | **0 (benar)** | **+12.500 (SALAH)** |
>
> Pada skenario **lintas shift** (jual di shift `b03decc5`, refund di shift `ab787cc0`),
> gross tunai = 0 **dengan maupun tanpa** filter itu — karena `paid_at` penjualan berada
> sebelum `opened_at` shift yang merefund. Jadi filternya **tidak memberi manfaat apa pun**
> di sana. Kedua shift menghasilkan `selisih` = 0 pada kode sekarang.
>
> **Mengapa premis "dihitung dua kali" salah:** uang tunai fisik memang **masuk** pada
> `paid_at` dan leg refund menguranginya **persis saat uang itu fisik keluar**. Tidak ada
> penghitungan ganda; ada satu penambahan dan satu pengurangan yang benar.
>
> **Mengapa kompensasi refund dijamin:** satu-satunya jalur menuju `status = 'batal'` bagi
> transaksi tunai lunas adalah `refund_transaction_atomic`, yang **selalu** menulis baris
> `transaction_refunds`. Diuji langsung: `cancel_transaction_atomic` atas transaksi tunai
> lunas **DITOLAK** (`P0001: Transaksi lunas tidak dapat dibatalkan langsung. Gunakan
> prosedur Refund Teraudit (refund_transaction_atomic).`) dan fungsi itu **tidak memuat
> `transaction_refunds` sama sekali**; `cancel_pending_transaction` hanya menyentuh
> `menunggu_konfirmasi`, yang tidak pernah masuk leg tunai (leg itu mensyaratkan
> `payment_status = 'dibayar'`).
>
> **Status akar masalah yang benar:** deskripsi faktual klausa 1.13 (leg tunai tidak
> memfilter `status`, berbeda dari leg non-tunai) **akurat**, tetapi kesimpulannya
> ("rekonsiliasi jadi salah") **tidak terbukti**. Asimetri itu **bukan cacat**; ia justru
> yang membuat rekonsiliasi cocok dengan uang fisik.
>
> **Konsekuensi untuk implementasi — DIPUTUSKAN 2026-09-22 (opsi a): klausa 2.13
> DIBATALKAN atas keputusan pemilik spec.** Pemilik menerima pembantahan empiris di
> atas. Leg tunai `close_cash_shift` **dibiarkan apa adanya**; `AND status = 'selesai'`
> **tidak** ditambahkan. Task **6.2** menjadi **"tidak ada perubahan pada
> `close_cash_shift`"** — migrasi 067 **tidak me-re-emit fungsi itu sama sekali**.
> Butir 3 di atas karenanya berakhir sebagai **hipotesis yang difalsifikasi**, bukan
> sebagai pekerjaan tertunda. Lihat koreksi di
> [B.4](#b-klaster-refund-11-12-113--21-22-213) dan keputusannya di
> `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".

4. **Hipotesis storage TERKONFIRMASI (2026-09-22, eksplorasi task 5).** Dicatat di sini agar
   status seluruh hipotesis yang difalsifikasi task 5 terbaca dalam satu tempat: dengan bucket
   `products` tetap `public = true`, mempersempit policy `SELECT` menjadi
   `TO authenticated ... (storage.foldername(name))[1] = get_my_tenant_id()::text` **tidak**
   mengubah apa pun — `curl` anonim tetap **HTTP 200** pada 3 percobaan. Endpoint
   `/object/public/...` memang melayani objek tanpa mengevaluasi RLS. **Privatisasi bucket
   wajib, gate 3.1 tetap hidup, task 19 tidak disederhanakan.** Ditemukan pula satu langkah
   yang hilang dari rencana 069 (cache CDN) — lihat
   [Migrasi Kebijakan Storage](#migrasi-kebijakan-storage-162639).

### C. Tidak ada strategi bounded wait (1.7, 1.8)

1. **Klien Supabase dibuat tanpa pembungkus fetch.** `src/lib/supabase.ts` memanggil `createClient` hanya dengan opsi `auth`; tidak ada `global.fetch` kustom, tidak ada timeout default. Akibatnya setiap `supabase.rpc`, `.from().select()`, dan `auth.getSession()` bergantung sepenuhnya pada timeout TCP/HTTP peramban, yang pada captive portal bisa menggantung menit-menitan atau tidak pernah settle.

2. **`processingPayment` bukan cacat state machine.** `handleProcessPayment` sudah punya `finally` yang mereset `processingPaymentRef` dan `processingPayment`. Blok itu tidak pernah berjalan karena `await commitTransaction(...)` tidak pernah settle. Jadi perbaikannya harus di lapisan promise (deadline), bukan di lapisan state.

3. **`useOnlineStatus` hanya mencerminkan status link layer.** `navigator.onLine` bernilai true begitu ada asosiasi jaringan, tanpa tahu apakah Supabase terjangkau. Tidak ada probe apa pun.

4. **`AuthProvider` memakai timeout sebagai *bypass*, bukan sebagai *error*.** `if (!timedOut && (!initialized || loading)) return <AuthLoadingScreen />` berarti setelah 8 detik komponen merender `children` apa pun status auth-nya. `PrivateRoute` lalu melihat `session === null` dan melakukan `Navigate to="/login"`. Timeout-nya sendiri masuk akal; percabangannya yang salah.

### D. Presisi qty dan identitas callback (1.9, 1.10)

1. **`NumpadModal` adalah numpad bilangan bulat.** State `valueStr` hanya menerima digit; tidak ada tombol separator, tidak ada konsep presisi, dan `handleDigit` hanya membandingkan `Number(next) > maxValue` — tidak ada batas jumlah desimal, sehingga `"0.25"` + `"5"` menjadi `"0.255"`. Pemanggilan di POSPage mengunci `minValue={1}` dan `maxValue={9999}`, padahal sisa stok per baris sudah dapat dihitung dari `remainingBaseStockByProduct`. Plafon presisi keras yang tersedia adalah **3 desimal**, karena `transaction_items.qty` bertipe `NUMERIC(12,3)` (migrasi 029).

2. **`BarcodeScannerModal` menaruh callback di dependency effect.** `useEffect(..., [isOpen, onClose, onScanSuccess])` sementara POSPage meneruskan arrow function inline yang identitasnya baru setiap render. Setiap re-render POSPage (keranjang, pencarian, toast, event realtime) menjalankan cleanup → `scanner.stop()` → init ulang dengan `setTimeout(150)`. Pemilik invarian "kamera hidup selama modal terbuka" adalah modal itu sendiri, jadi perbaikan di sisi modal lebih tahan regresi daripada memoisasi di call site.

### E. Batas hari dan tempo dihitung di dua tempat dengan aturan berbeda (1.11, 1.12, 1.14)

1. **`jatuh_tempo` tidak punya penulis.** `create_transaction_atomic` (066) menyisipkan `receivables` hanya dengan `total_tagihan, jumlah_dibayar, sisa_hutang, status`. Kolom `jatuh_tempo DATE` ada sejak migrasi 049 dan dibaca `CustomersPage`, tetapi tidak ada satu pun penulis di migrasi manapun maupun di `src/`. Tenornya juga belum punya sumber konfigurasi: `store_settings` belum mengenal `tempo_hutang_hari`.

2. **Dua otoritas batas hari yang berbeda.** Sisi server memakai `date_trunc('day', NOW() AT TIME ZONE 'Asia/Jakarta')`; sisi klien `buildDayRange` memakai `startOfDay`/`endOfDay` date-fns (timezone perangkat) dan `formatLocalDateKey` mem-bucket dengan `format(date,'yyyy-MM-dd')` lokal. `getISOStartOfDay`/`getISOExclusiveEndOfDay` sudah benar mengikat WIB, tetapi tidak dipakai oleh jalur dashboard. Jadi cacatnya bukan pada helper WIB yang ada, melainkan pada dua jalur yang tidak memakainya.

3. **Basis akrual tidak pernah dipisahkan.** Penjualan hutang ditulis `payment_status = 'dibayar'`, `paid_at = NOW()` (keputusan sadar agar omzet akrual benar), tetapi seluruh agregasi laporan memakai `payment_status = 'dibayar'` sebagai proksi "uang masuk". Tidak ada query manapun yang menjumlahkan kas riil (`receivable_payments` + transaksi non-hutang − refund). Tidak ada cacat pembukuan; yang hilang adalah dimensi kedua.

### F. Struk thermal tidak punya sumber data bersama dengan struk browser (1.15)

`buildReceiptBytes` menerima `ReceiptData` yang bentuknya dirancang terpisah dari `TransactionItem`: hanya `{name, qty, price}` per item, tanpa `nama_satuan`, `harga_satuan`, atau `diskon_item_persen`. `POSPage.handleThermalPrint` lalu memetakan `receiptItems` ke bentuk sempit itu dan tidak meneruskan pelanggan maupun catatan. Pemeriksaan truthy (`receiptTransaction.kembalian ? ... : undefined` di call site, lalu `data.change > 0` di builder) menghapus nilai 0 dua kali. `slice(0, width)` memotong alih-alih wrap. Akarnya: dua renderer struk berevolusi independen tanpa kontrak data bersama.

### G. Tidak ada jalur eksekusi SQL non-produksi (1.16, 1.17, 1.18)

Docker mati sehingga `supabase db start` / `supabase db reset` / `supabase db lint` / `scripts/reset-uat-cloud.sh` tidak bisa jalan; `psql` tidak terpasang sehingga tidak ada klien SQL langsung; hanya satu project ter-link (`dfgqioglsirftfyjyswd`, produksi) sehingga `supabase db push` saat ini **menembak produksi**; CI hanya mencocokkan regex atas teks migrasi lewat impor `?raw`. Jadi belum ada titik mana pun di rantai yang benar-benar mengeksekusi SQL sebelum produksi.

## Correctness Properties

Property 1: Bug Condition - Semua Cacat 1.1–1.18 Diperbaiki

_For any_ input di mana kondisi bug berlaku (`isBugCondition` mengembalikan true), sistem setelah perbaikan SHALL memenuhi klausa perilaku 2.x yang berpasangan dengan klausa 1.x pemicunya: menolak dengan kesalahan otorisasi untuk pembacaan non-admin atas data biaya/laba/staf, menolak akses storage anonim maupun lintas tenant, menyediakan jalur refund yang terpakai dan terekonsiliasi, menghentikan percobaan jaringan dalam batas waktu yang jelas dengan kemungkinan coba ulang berkunci sama, menerima qty pecahan dalam presisi yang diizinkan dan dibatasi sisa stok baris, mempertahankan kamera scanner saat induk re-render, mengisi `jatuh_tempo` dari setelan `tempo_hutang_hari`, memakai batas hari `Asia/Jakarta` yang identik dengan server, menyajikan omzet akrual dan kas diterima sebagai angka terpisah berlabel, dan mencetak struk thermal dengan informasi setara struk browser.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18**

> **Catatan 2026-09-22:** klausa **2.13 DIBATALKAN** atas keputusan pemilik, jadi tidak ada perilaku yang perlu dipenuhi untuknya — daftar di atas dipertahankan apa adanya demi jejak, tetapi 2.13 **tidak** diverifikasi. Perilaku rekonsiliasi shift yang benar diasersikan Property 11 versi baru.

Property 2: Preservation - Perilaku di Luar Kondisi Bug Tidak Berubah

_For any_ input di mana kondisi bug TIDAK berlaku (`isBugCondition` mengembalikan false), sistem setelah perbaikan SHALL menghasilkan hasil yang sama dengan sistem sebelum perbaikan, mempertahankan: laporan dan dashboard admin secara penuh, penolakan tulis non-admin lewat `is_admin()`, semantik kunci idempotensi checkout dan cicilan piutang, perlakuan qty bilangan bulat termasuk validasi stok agregat lintas satuan dalam satuan dasar, penonaktifan checkout saat benar-benar offline dengan katalog cache sebagai referensi, rekonsiliasi shift tanpa refund berbasis `paid_at` dan atribusi `confirmed_by`, batas rentang laporan WIB inklusif-bawah/eksklusif-atas, tampilnya gambar produk milik tenant sendiri, perilaku parkir pesanan dan keranjang, perilaku sesi/login/logout/cache offline, serta rekonsiliasi baris struk browser.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13**

Property 3: Bug Condition - RPC Laporan Menolak Non-Admin

_For any_ pemanggilan `get_profit_summary`, `get_top_products`, `get_sales_by_date`, atau `get_dashboard_stats` oleh sesi yang `is_admin()`-nya false, fungsi SHALL meng-`RAISE EXCEPTION` otorisasi sebelum mengembalikan baris apa pun, terlepas dari rentang tanggal atau limit yang diminta, dan terlepas dari apakah pemanggilan datang dari UI atau langsung ke PostgREST.

**Validates: Requirements 2.3**

Property 4: Preservation - RPC Laporan Utuh untuk Admin

_For any_ pemanggilan keempat RPC laporan oleh sesi admin, hasilnya SHALL identik baris-per-baris dengan hasil sebelum penggerbangan diterapkan untuk rentang tanggal yang sama, termasuk semantik batas atas eksklusif dan agregasi HPP/qty berbasis `base_qty` dari migrasi 066.

**Validates: Requirements 3.1**

Property 5: Bug Condition - Kolom Biaya Tidak Terkirim ke Non-Admin

_For any_ pembacaan tabel atau view oleh sesi non-admin, respons SHALL tidak memuat `products.harga_beli`, `product_units.harga_beli`, `product_price_history.harga_beli`, `transaction_items.harga_beli`, `transaction_items.laba_kotor`, maupun agregat `laba_kotor`; permintaan yang secara eksplisit meminta kolom tersebut SHALL gagal dengan kesalahan hak akses, bukan mengembalikan nilai kosong yang menyamarkan penolakan.

**Validates: Requirements 2.4**

Property 6: Preservation - Katalog POS Tetap Lengkap untuk Kasir

_For any_ pembacaan katalog oleh kasir melalui `products_with_category` dengan `select('*')`, respons SHALL tetap memuat seluruh kolom yang dipakai jalur POS (`id`, `nama`, `sku`, `barcode`, `satuan`, `harga_jual`, `stok`, `stok_minimum`, `stok_status`, `diskon_produk_persen`, `foto_url`, `category_id`, `category_nama`, `is_active`, `product_group_id`), sehingga `mapProductToCartItem`, `getUnitChoices`, dan cache offline IndexedDB berfungsi tanpa perubahan.

**Validates: Requirements 3.5, 3.11**

Property 7: Bug Condition - Profil Staf Hanya Terbaca Admin

_For any_ pembacaan `profiles` oleh non-admin, himpunan baris yang dikembalikan SHALL berisi tepat satu baris yaitu profil pemanggil sendiri; daftar staf beserta `role` SHALL hanya dapat dibaca oleh admin.

**Validates: Requirements 2.5**

Property 8: Bug Condition - Objek Storage Hanya Terbaca Anggota Tenant Pemilik

_For any_ upaya baca objek di bucket `products`, akses SHALL diizinkan hanya bila pemanggil terautentikasi dan segmen pertama path objek sama dengan tenant pemanggil; akses anonim dan akses lintas tenant SHALL ditolak, termasuk lewat endpoint objek publik.

**Validates: Requirements 2.6**

Property 9: Preservation - Gambar Tenant Sendiri Tetap Tampil

_For any_ objek gambar milik tenant pemanggil, termasuk objek yang path-nya dibuat sebelum konvensi `/<tenant-id>/` berlaku, gambar SHALL tetap tampil di `ProductsPage` dan `POSPage` setelah kebijakan dipersempit.

**Validates: Requirements 3.9**

Property 10: Bug Condition - Refund Memulihkan Stok, Ledger, dan Kas Shift

_For any_ transaksi berstatus `selesai` dengan `payment_status = 'dibayar'` yang direfund admin melalui UI dengan alasan non-kosong dan kunci idempotensi, sistem SHALL memulihkan stok sebesar `base_qty` setiap item, membalik piutang bila metode hutang dan belum ada cicilan, menulis satu baris `transaction_refunds` dengan `payment_method` dan `cash_shift_id` yang benar, men-set transaksi `batal`, dan pada penutupan shift berikutnya SHALL menghasilkan `total_penjualan_tunai` dan `selisih` yang cocok dengan uang fisik; pengulangan dengan kunci dan alasan identik SHALL mengembalikan hasil yang sama tanpa efek ganda.

**Validates: Requirements 2.1, 2.2**

Property 11: Rekonsiliasi Shift Cocok dengan Uang Fisik Setelah Refund

> **DIRUMUSKAN ULANG 2026-09-22** karena klausa 2.13 **DIBATALKAN atas keputusan pemilik**. Rumusan lama ("leg tunai SHALL mengecualikan transaksi tunai yang `status`-nya bukan `selesai`") **tidak lagi berlaku dan tidak boleh diasersikan** — ia terbantah secara empiris di task 5 (lihat [B.4](#b-klaster-refund-11-12-113--21-22-213) dan `verification-notes.md` → "Task 5 … Kasus 6"). Rumusan di bawah mengasersikan apa yang **benar-benar berlaku dan sudah terverifikasi**.

_For any_ shift yang memuat refund tunai, `close_cash_shift` SHALL menghasilkan `total_penjualan_tunai` dan `selisih` yang cocok dengan uang fisik, karena leg tunai mencatat kas **masuk** pada `paid_at` dan leg refund menguranginya **persis saat kas fisik keluar** — satu penambahan dan satu pengurangan, bukan penghitungan ganda. Ini berlaku baik ketika penjualan dan refund berada di shift yang sama maupun lintas shift, dan dijamin oleh fakta bahwa satu-satunya jalur menuju `status = 'batal'` bagi transaksi tunai lunas adalah `refund_transaction_atomic`, yang **selalu** menulis baris `transaction_refunds`. Buktinya adalah baseline keempat shift uji dengan `selisih = 0` (`7f3bac2d` 100.000/0/100.000, `b03decc5` 100.000/20.000/120.000, `ab787cc0` 100.000/−20.000/80.000, `4fcda5cb` 50.000/5.000/55.000). Leg tunai SHALL **tidak** menyaring `status`; asimetrinya terhadap leg non-tunai adalah perilaku benar, bukan cacat.

**Validates: Requirements 2.2, 3.6**

Property 12: Preservation - Rekonsiliasi Shift Tanpa Refund Tidak Berubah

_For any_ shift tanpa baris `transaction_refunds`, nilai `total_penjualan_tunai`, `total_penjualan_non_tunai`, dan `selisih` SHALL identik dengan hasil sebelum perbaikan, termasuk penolakan penutupan saat ada QRIS/transfer belum dikonfirmasi dan atribusi non-tunai lewat `confirmed_by`.

**Validates: Requirements 3.6**

Property 13: Bug Condition - Percobaan Jaringan Selalu Punya Batas Waktu

_For any_ percobaan checkout saat Supabase tidak terjangkau meski `navigator.onLine` true, sistem SHALL menyelesaikan percobaan dalam batas waktu yang ditetapkan, SHALL mengembalikan `processingPayment` ke false, SHALL menampilkan pesan yang dapat ditindaklanjuti, dan SHALL mengizinkan percobaan ulang dengan kunci idempotensi yang sama tanpa reload halaman.

**Validates: Requirements 2.7**

Property 14: Preservation - Idempotensi Checkout Tidak Berubah oleh Timeout

_For any_ percobaan ulang dengan payload identik setelah kegagalan apa pun, kunci idempotensi SHALL tetap sama sehingga server mengembalikan struk recovery; _for any_ percobaan dengan payload berbeda, kunci SHALL dirotasi sehingga `request_fingerprint` server tidak pernah mismatch.

**Validates: Requirements 3.3**

Property 15: Bug Condition - Sesi Valid Tidak Pernah Dilempar ke Login

_For any_ pemulihan sesi yang melewati batas waktu, sistem SHALL menahan render rute terproteksi atau menampilkan layar gagal-muat dengan tombol coba lagi, dan SHALL TIDAK mengarahkan pengguna bersesi valid ke `/login`.

**Validates: Requirements 2.8**

Property 16: Bug Condition - Numpad Menerima Pecahan dalam Presisi Sah

_For any_ input qty pada baris bersatuan pecahan, numpad SHALL menyediakan separator desimal, SHALL menolak digit yang melewati presisi maksimum baris tersebut (paling banyak 3 desimal sesuai `NUMERIC(12,3)`), SHALL menerima nilai minimum sebesar satu satuan presisi terkecil, dan SHALL membatasi nilai maksimum pada sisa stok baris tersebut dalam satuan jualnya.

**Validates: Requirements 2.9**

Property 17: Preservation - Qty Bulat dan Validasi Stok Agregat Tidak Berubah

_For any_ input qty bilangan bulat, hasil `updateQty`, `diskon_item_persen`, `subtotal`, dan penolakan karena melebihi stok agregat lintas satuan dalam satuan dasar SHALL identik dengan sebelum perbaikan.

**Validates: Requirements 3.4**

Property 18: Bug Condition - Kamera Scanner Bertahan Melewati Re-render Induk

_For any_ re-render halaman induk selagi modal scanner terbuka, instance kamera SHALL tetap sama tanpa `stop()`/`start()` ulang, dan pemindaian SHALL tuntas pada percobaan pertama.

**Validates: Requirements 2.10**

Property 19: Bug Condition - Piutang Selalu Punya Jatuh Tempo

_For any_ penjualan hutang, baris `receivables` SHALL memuat `jatuh_tempo` = tanggal transaksi WIB + setelan toko `tempo_hutang_hari` (default 14, dapat diubah admin), sehingga badge jatuh tempo dan penanda terlewat di `CustomersPage` berfungsi.

**Validates: Requirements 2.11**

Property 20: Preservation - Setelan Server Tidak Merusak Recovery Idempotensi

_For any_ percobaan ulang checkout dengan kunci yang sudah ada, perubahan setelan toko di tengah jalan (`ppn_persen`, `tempo_hutang_hari`) SHALL TIDAK membatalkan recovery, karena setelan server bukan bagian dari `request_fingerprint`.

**Validates: Requirements 3.3, 3.7**

Property 21: Bug Condition - Batas Hari Klien Identik dengan Server

_For any_ perangkat pada timezone apa pun, batas hari yang dipakai kartu "penjualan hari ini" dan delta "% vs kemarin" SHALL sama dengan batas hari `Asia/Jakarta` yang dipakai RPC server, sehingga kedua angka berdampingan konsisten.

**Validates: Requirements 2.12**

Property 22: Preservation - Batas Rentang Laporan Tetap Inklusif-Bawah/Eksklusif-Atas

_For any_ rentang tanggal laporan, batas bawah SHALL tetap awal hari WIB inklusif dan batas atas SHALL tetap awal hari berikutnya eksklusif, sehingga transaksi pada detik terakhir hari tidak hilang.

**Validates: Requirements 3.8**

Property 23: Bug Condition - Omzet Akrual dan Kas Diterima Terpisah

_For any_ rentang laporan, sistem SHALL menyajikan omzet akrual dan kas yang benar-benar diterima sebagai dua angka terpisah berlabel jelas, di mana kas diterima memuat penerimaan tunai/QRIS/transfer dan cicilan piutang pada rentang tersebut dikurangi refund, dan tidak memuat penjualan hutang yang belum tertagih.

**Validates: Requirements 2.14**

Property 24: Bug Condition - Struk Thermal Setara Struk Browser

_For any_ nota yang dicetak ke printer thermal, struk SHALL memuat satuan tiap baris, qty pecahan beserta unitnya, harga satuan dan diskon baris, nama pelanggan dan catatan bila ada, serta baris `Bayar`/`Kembalian` termasuk saat bernilai 0, dan nama produk yang melewati lebar kertas SHALL di-wrap bukan dipotong.

**Validates: Requirements 2.15**

Property 25: Preservation - Struk Browser Tetap Rekonsiliasi

_For any_ nota yang dicetak lewat struk browser, baris item SHALL tetap merekonsiliasi dengan subtotal setelah diskon seperti hasil perbaikan sebelumnya.

**Validates: Requirements 3.13**

Property 26: Bug Condition - Migrasi Punya Jalur Validasi Non-Produksi

_For any_ migrasi yang akan diterapkan (066 maupun migrasi baru batch ini), SHALL ada alur terdokumentasi dan terulang di mana `supabase db push` dijalankan lebih dulu ke target non-produksi, hasilnya diverifikasi lewat pemeriksaan yang dapat dijalankan tanpa Docker, dan baru kemudian dipromosikan ke produksi; setiap pemeriksaan yang memang membutuhkan Docker SHALL disebutkan prasyaratnya secara eksplisit.

**Validates: Requirements 2.16, 2.17, 2.18**

## Fix Implementation

### Changes Required

Perubahan dikelompokkan per klaster akar. Setiap kelompok mencantumkan file, fungsi, dan sifat migrasinya (aditif / subtraktif), karena sifat itu menentukan urutan penerapan di [Strategi Migrasi](#strategi-migrasi).

---

### A. Otorisasi sisi baca (1.3, 1.4, 1.5 → 2.3, 2.4, 2.5)

**Kendala yang menentukan bentuk solusi:** admin dan kasir berbagi satu role PostgREST (`authenticated`). Column privileges bersifat per-role, jadi `REVOKE SELECT (harga_beli)` mencabut untuk keduanya. Sementara itu view `security_invoker = true` mewarisi hak pemanggil, jadi tidak bisa dipakai sebagai jalur privilese admin. Kesimpulannya hanya satu kombinasi yang benar-benar menahan kolom biaya di lapisan SQL:

1. **Jalur baca kasir** = view `security_invoker = true` tanpa kolom biaya, dengan daftar kolom **eksplisit** (bukan `p.*`) agar kolom baru tidak pernah bocor diam-diam lagi.
2. **Jalur baca admin** = view `security_invoker = false` (dieksekusi sebagai pemilik, jadi lolos column privileges) yang menggerbangi dirinya sendiri dengan `tenant_id = public.get_my_tenant_id() AND public.is_admin()` di dalam definisi view.
3. **Cabut hak kolom** dari `authenticated` supaya pembacaan langsung ke tabel dasar gagal, bukan hanya "tidak ditampilkan UI".

**A.1 Penggerbangan empat RPC laporan** — *subtraktif*

File: migrasi baru (lihat [Pemetaan migrasi](#pemetaan-perubahan-ke-migrasi)).

- `get_profit_summary(timestamptz, timestamptz)`, `get_top_products(timestamptz, timestamptz, integer)`, `get_sales_by_date(date, date)` saat ini `LANGUAGE sql`. Guard `is_admin()` yang **meng-error** (bukan mengembalikan himpunan kosong; 2.3 menuntut kesalahan otorisasi) memerlukan `LANGUAGE plpgsql` + `RETURN QUERY`. `CREATE OR REPLACE FUNCTION` boleh mengubah bahasa selama signature dan tipe kembalian tidak berubah, sehingga tidak perlu `DROP` untuk ketiganya.
- `get_dashboard_stats()` sudah `plpgsql`; cukup menambahkan guard di awal body, sebelum blok `IF v_tenant_id IS NULL` yang sekarang mengembalikan nol-nol.
- Body dan semantik agregasi **tidak berubah** dari 066 (Property 4): batas atas tetap eksklusif, HPP tetap `harga_beli * COALESCE(base_qty, qty * COALESCE(rasio,1), qty)`, `total_qty` tetap `NUMERIC` berbasis `base_qty`.
- Pesan error konsisten dengan house style: `RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin'`.
- Setiap fungsi di-re-emit utuh dan diikuti blok `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated, service_role;` — konvensi repo sejak migrasi 062.
- Catatan konsistensi: `get_sales_by_date` (045) memakai `SET search_path TO 'public'` sementara house style sejak 054 adalah `SET search_path = pg_catalog, public`. Re-emit sekaligus menyelaraskannya.

**A.2 `/dashboard` menjadi admin-only** — *frontend, harus live sebelum A.1 diterapkan*

File: `src/App.tsx`, `src/components/auth/AdminRoute.tsx`, `src/components/layout/Sidebar.tsx`, `src/pages/LoginPage.tsx`, `src/pages/RegisterPage.tsx`, `src/pages/NotFoundPage.tsx`.

- Bungkus rute `/dashboard` dengan `<AdminRoute>`.
- **Wajib bersamaan:** ubah fallback `AdminRoute` dari `Navigate to="/dashboard"` menjadi `/pos`. Tanpa ini, kasir yang membuka `/produk` diarahkan ke `/dashboard`, yang kini juga `AdminRoute`, yang mengarahkannya ke `/dashboard` lagi — **redirect loop**. Ini konsekuensi paling mudah terlewat dari klausa 2.3.
- `LoginPage` default `from` menjadi `/pos` untuk non-admin (tetap `/dashboard` untuk admin), `RegisterPage` tetap `/dashboard` (pendaftar selalu admin tenant baru), `NotFoundPage` menunjuk `/pos`.
- Sidebar menyembunyikan item Dashboard untuk non-admin.

**A.3 `harga_beli` ditahan dari non-admin** — *view aditif; REVOKE subtraktif*

File: migrasi baru + `src/api/products.ts` + `src/pages/ProductsPage.tsx`.

- Re-emit `products_with_category` (`security_invoker = true`) dengan daftar kolom eksplisit **tanpa** `harga_beli`. Ini jawaban langsung atas "bagaimana `select('*')` POSPage tetap jalan": `*` mengekspansi kolom view, dan kolomnya sudah tidak ada — **tidak ada perubahan kode POSPage sama sekali**. Sudah diverifikasi bahwa jalur POS tidak pernah membaca `harga_beli`: `mapProductToCartItem` memakai `harga_jual`, `stok`, `diskon_produk_persen`, `satuan`, `foto_url`, `sku`, `barcode`, `id`, `nama`; `getUnitChoices` memakai `stok`, `harga_jual`, `satuan`, `barcode`; cache offline menyimpan bentuk `ProductWithCategory` yang sama.
- Buat `products_admin_with_category` (`security_invoker = false`, `WHERE p.tenant_id = public.get_my_tenant_id() AND public.is_admin()`) yang memuat semua kolom view lama **plus** `harga_beli`. `REVOKE ALL ON products_admin_with_category FROM PUBLIC, anon; GRANT SELECT TO authenticated;`
- `REVOKE SELECT (harga_beli) ON public.products FROM authenticated;`
- Dampak yang harus ditangani bersamaan (karena `SELECT *` gagal total bila satu kolom tidak berhak, bukan sekadar mengosongkannya):
  - `getProductsPage`, `getProducts`, `getProductByBarcode`, `getSalesByCategory` memakai `products_with_category` → aman tanpa perubahan.
  - `ProductsPage` (daftar admin, Margin%, sorting `harga_beli`, ekspor XLSX) harus membaca `products_admin_with_category`. Tambahkan `getAdminProductsPage`/opsi `source: 'admin'` di `src/api/products.ts` agar Property 6 dan klausa 3.1 sama-sama terpenuhi.
  - `createProduct` dan `updateProduct` memakai `.insert(payload).select('*').single()` pada tabel `products` → akan gagal setelah REVOKE. Ubah menjadi daftar kolom eksplisit tanpa `harga_beli`, lalu (bila UI butuh nilai baru) baca ulang dari `products_admin_with_category`.
  - `product_units.harga_beli`: `REVOKE SELECT (harga_beli) ON public.product_units FROM authenticated` + view admin `product_units_admin`. Periksa `src/api/units.ts` (`getProductUnits` memakai `select('*')`) dan komponen varian di `ProductsPage`.
  - `product_price_history`: satu-satunya pembaca adalah `getProductPriceHistory` (admin). Persempit `product_price_history_tenant_select` menjadi `tenant_id = get_my_tenant_id() AND public.is_admin()` — lebih sederhana daripada column privileges karena tidak ada pembaca kasir.

**A.4 HPP dan laba per baris transaksi ditahan** — *view aditif; REVOKE subtraktif* — **temuan baru, bagian dari akar 1.4**

File: migrasi baru + `src/api/transactions.ts` + `src/pages/ReportsPage.tsx`.

- Buat `transaction_items_public` (`security_invoker = true`, tanpa `harga_beli` dan `laba_kotor`); arahkan `getTransactionById` ke view ini. Kasir tetap bisa mencetak ulang struk transaksinya (Property 6).
- `REVOKE SELECT (harga_beli, laba_kotor) ON public.transaction_items FROM authenticated;`
- Re-emit `transactions_with_kasir` **tanpa** kolom agregat `laba_kotor`; POSPage (daftar pending) tidak membacanya.
- Buat `transactions_with_kasir_admin` (`security_invoker = false`, guard `tenant_id = get_my_tenant_id() AND is_admin()`) yang memuat `laba_kotor`; arahkan `getTransactionHistoryPage` ke view ini agar kolom "Laba" di `ReportsPage` tetap ada (3.1).
- RPC laporan tidak terpengaruh REVOKE ini karena `SECURITY DEFINER` berjalan sebagai pemilik.

**A.5 `profiles` hanya profil sendiri untuk non-admin** — *subtraktif*

File: migrasi baru + `src/api/staff.ts`.

- Ganti `profiles_tenant_select` dengan `USING (tenant_id = public.get_my_tenant_id() AND (id = auth.uid() OR public.is_admin()))`.
- **Konsekuensi yang harus ditangani bersamaan:** `transactions_with_kasir` ber-`security_invoker` me-resolve `kasir_nama` lewat join ke `profiles`; setelah penyempitan, nama kasir lain menjadi NULL bagi kasir. Karena view ini juga di-re-emit di A.4, jadikan versi kasir `security_invoker = false` dengan guard tenant eksplisit (`WHERE t.tenant_id = public.get_my_tenant_id()`) sehingga `kasir_nama` tetap resolve tanpa membuka tabel `profiles` ke kasir. Ini juga menjaga atribusi yang diandalkan 3.6.
- `getStaffList()` tidak perlu diubah: setelah policy dipersempit, admin tetap menerima seluruh daftar dan kasir menerima satu baris. `SettingsPage` (satu-satunya pemakai) sudah `AdminRoute`.

---

### B. Klaster refund (1.1, 1.2, 1.13 → 2.1, 2.2, 2.13)

**B.1 Modul API** — `src/api/transactions.ts`

```ts
export interface RefundResult {
  success: boolean
  refund_id: number
  transaction_id: number
  nomor_nota: string
  status: string
  total_refund: number
  idempotent: boolean
}

export async function refundTransaction(input: {
  transactionId: number
  alasan: string
  idempotencyKey: string
}): Promise<RefundResult>
```

- Validasi klien sebelum RPC, meniru `payReceivable`: `alasan` non-kosong dan `idempotencyKey` non-kosong ditolak lokal dengan pesan Indonesia, supaya kasir tidak menunggu round-trip untuk kesalahan yang jelas.
- Setelah sukses, `waitForTransactionDetail(id, d => d.transaction.status === 'batal')` — konsisten dengan `cancelTransaction`.
- Ditempatkan di `src/api/transactions.ts` (bukan file baru) karena sudah menampung `cancelTransaction`, `cancelPendingTransaction`, `confirmTransactionPayment`.

**B.2 Titik masuk UI** — `src/pages/ReportsPage.tsx`

Keputusan lokasi: **riwayat transaksi di ReportsPage**, bukan daftar pending POSPage. Alasannya:

- `refund_transaction_atomic` menolak non-admin; `/laporan` sudah di bawah `AdminRoute`, jadi tidak ada jalur mati untuk kasir.
- Daftar pending POSPage berisi transaksi `menunggu_konfirmasi` (belum dibayar) — domainnya `cancelPendingTransaction`, bukan refund. Refund menyasar transaksi yang **sudah lunas**, dan hanya riwayat yang menampilkannya.
- Modal detail transaksi di ReportsPage sudah memuat item, subtotal, dan struk — konteks yang dibutuhkan admin sebelum menyetujui refund.

Implementasi: tombol "Refund" di dalam modal detail (bukan di baris tabel, supaya aksi finansial tidak mudah tersenggol), aktif hanya bila `status === 'selesai' && payment_status === 'dibayar'`; membuka form berisi textarea alasan wajib + `ConfirmDialog` yang menampilkan nominal dan nomor nota.

**B.3 Strategi kunci idempotensi**

Mengikuti disiplin `CustomersPage` (rotate-on-payload-change), disesuaikan dengan fingerprint server yang sudah ada. Migrasi 060 menghitung `v_fingerprint = sha256(jsonb_build_object('transaction_id', p_transaction_id, 'alasan', btrim(p_alasan)))` — artinya **alasan adalah bagian payload**, sehingga mengubah alasan setelah percobaan gagal wajib merotasi kunci, atau server menolak dengan "Kunci idempotensi sudah digunakan untuk transaksi refund berbeda".

```
refundKeyMap:      Record<transactionId, string>                  // useRef
refundBoundReason: Record<transactionId, string>                  // useRef

buka modal refund:
  key := refundKeyMap[id] ?? crypto.randomUUID()   // dipertahankan lintas close/reopen
  bila refundBoundReason[id] ada: pulihkan textarea dengan alasan itu (recovery respons hilang)

alasan berubah DAN refundBoundReason[id] ada:
  rotasi: refundKeyMap[id] := crypto.randomUUID(); hapus refundBoundReason[id]

submit:
  refundBoundReason[id] := btrim(alasan)           // ikat payload ke kunci SEBELUM request
  panggil refundTransaction({ transactionId, alasan, idempotencyKey: key })

sukses:
  hapus refundKeyMap[id] dan refundBoundReason[id]

gagal:
  pertahankan keduanya → percobaan ulang identik memakai kunci sama (recovery)
```

Bedanya dengan checkout POSPage: di sana fingerprint dibandingkan lewat `lastCheckoutFingerprintRef` atas seluruh payload keranjang; di sini payload-nya hanya `{transaction_id, alasan}` sehingga cukup `refundBoundReason`. Polanya identik: **kunci dipertahankan selama payload sama, dirotasi begitu payload berubah, dibuang hanya saat sukses.**

**B.4 Simetri `close_cash_shift` (1.13)** — *DIBATALKAN 2026-09-22 atas keputusan pemilik; syarat "satu migrasi dengan pengaktifan refund" larut*

> ### ⚠️ DIBATALKAN 2026-09-22 ATAS KEPUTUSAN PEMILIK — RANCANGAN B.4 DI BAWAH TERBANTAH DAN TIDAK AKAN DIIMPLEMENTASIKAN
>
> Rancangan asli B.4 **dipertahankan utuh di bawah** (jejak hipotesis tidak dihapus,
> supaya riwayat penalarannya terbaca), tetapi **statusnya sekarang: dibatalkan**.
> Pemilik spec memilih **opsi (a)** pada 2026-09-22: terima pembantahan empiris task 5,
> biarkan leg tunai apa adanya.
>
> Eksplorasi SQL task 5 terhadap target UAT (skema 066) **membantah premisnya**. Angka
> lengkapnya di `verification-notes.md` → "Task 5 … Kasus 6". Ringkasnya:
>
> - Pada shift yang **sama** (jual tunai 12.500 lalu refund 12.500, uang fisik 100.000):
>   kode sekarang menghasilkan `total_penjualan_tunai` **0** dan `selisih` **0** —
>   **cocok dengan uang fisik**. Dengan `AND status = 'selesai'` ditambahkan, net tunai
>   menjadi **−12.500**, total sistem **87.500**, dan `selisih` menjadi **+12.500 (SALAH)**.
> - Pada skenario **lintas shift**, gross tunai = 0 **dengan maupun tanpa** filter itu, jadi
>   filternya **tidak memberi manfaat apa pun** di sana.
> - **Premis "dihitung dua kali" salah.** Uang tunai fisik masuk pada `paid_at`; leg refund
>   menguranginya persis saat uang itu fisik keluar. Satu penambahan, satu pengurangan.
> - **Kompensasi refund dijamin.** Satu-satunya jalur menuju `status = 'batal'` untuk
>   transaksi tunai lunas adalah `refund_transaction_atomic`, yang **selalu** menulis
>   `transaction_refunds`. `cancel_transaction_atomic` **menolak** transaksi lunas
>   (`P0001: Transaksi lunas tidak dapat dibatalkan langsung...`) dan tidak menyentuh
>   `transaction_refunds`; `cancel_pending_transaction` hanya menyentuh
>   `menunggu_konfirmasi`, yang tidak pernah masuk leg tunai.
>
> **Akibatnya:** menambahkan `AND status = 'selesai'` **memperkenalkan cacat uang yang
> sekarang tidak ada**, sebesar nominal refund, pada skenario satu shift. Lihat juga
> [koreksi B.3 di Hypothesized Root Cause](#b-jalur-refund-tidak-pernah-disambungkan-ke-ui-11-12-113).
>
> **KEPUTUSAN PEMILIK 2026-09-22 — opsi (a): klausa 2.13 DIBATALKAN.** Yang mengikat
> pelaksanaan sekarang:
>
> - **Task 6.2 = "tidak ada perubahan pada `close_cash_shift`".** Migrasi 067 **tidak
>   me-re-emit fungsi itu sama sekali** — bukan "di-re-emit verbatim dari 064", tetapi
>   **tidak disentuh**. Fungsi yang live tetap versi 064.
> - Syarat **"WAJIB SATU MIGRASI DENGAN PENGAKTIFAN REFUND" larut**, karena tidak ada
>   lagi perubahan `close_cash_shift` yang perlu dipasangkan dengan UI refund. Pasangan
>   atomik (a) pada [Batasan urutan antara migrasi dan frontend](#batasan-urutan-antara-migrasi-dan-frontend)
>   **tidak berlaku lagi**.
> - **Prasyarat task 9 (UI refund) yang tetap berlaku:** 067 harus live di produksi
>   sebelum UI refund dirilis — bukan karena 6.2, melainkan karena **6.3**
>   (`refund_transaction_atomic` = 060 + syarat shift kasir untuk refund tunai, B.5)
>   berada di 067 dan dibutuhkan agar setiap refund tunai punya shift untuk
>   diatribusikan.
> - **Property 11 dirumuskan ulang** (lihat [Correctness Properties](#correctness-properties)):
>   ia tidak lagi mengasersikan filter `status = 'selesai'`.
> - Klausa **1.13 diselesaikan sebagai "bukan cacat"** dan keluar dari daftar cacat
>   terbuka P2 di `bugfix.md`.
>
> Yang **tetap berlaku** dari klaster B: B.1, B.2, B.3, dan B.5 tidak terpengaruh sama
> sekali.
>
> **Baseline untuk pembandingan setelah 067** (semua `selisih` = 0 pada 066):
> shift `7f3bac2d` 100.000/0/100.000, `b03decc5` 100.000/20.000/120.000,
> `ab787cc0` 100.000/−20.000/80.000, `4fcda5cb` 50.000/5.000/55.000.

*Rancangan asli (dipertahankan sebagai jejak hipotesis, per 2026-09-22 tidak lagi menjadi dasar implementasi):*

File: migrasi baru, re-emit utuh `close_cash_shift(uuid, numeric, numeric, text)`.

- Leg tunai mendapat `AND status = 'selesai'`, simetris dengan leg non-tunai di bawahnya.
- Seluruh bagian lain dipertahankan verbatim dari 064 (Property 12): penolakan pending QRIS/transfer, basis `paid_at`, `receivable_payments` tunai, leg refund dari `transaction_refunds`, atribusi `confirmed_by`, audit log.
- **Mengapa satu migrasi dengan refund:** refund men-set `status = 'batal'` tanpa mengubah `payment_status`/`paid_at`. Bila refund hidup sementara leg tunai belum menyaring `status`, penjualan aslinya tetap dihitung masuk **dan** refund dihitung keluar — bersihnya nol, padahal kas fisik memang berkurang, sehingga `selisih` salah tanda. Menerapkan keduanya bersamaan menutup jendela itu sepenuhnya.

**B.5 Shift wajib untuk refund tunai** — *re-emit `refund_transaction_atomic`*

Body 060 dipertahankan utuh kecuali satu tambahan: bila `v_trx.metode_bayar = 'tunai'` dan `v_shift_id IS NULL`, `RAISE EXCEPTION 'Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.'`

Alasan: tanpa shift, `cash_shift_id` NULL dan atribusi bergantung pada cabang `requested_by = shift.kasir_id AND created_at >= opened_at`; bila kasir asal juga tidak punya shift terbuka, uang keluar dari laci tanpa pernah masuk rekonsiliasi siapa pun — persis kelas cacat yang 2.2 hendak tutup. Simetris dengan aturan shift wajib untuk checkout tunai di `create_transaction_atomic`.

**Tradeoff yang perlu disadari:** admin yang ingin merefund di luar jam operasional harus membuka shift lebih dulu. Itu memang konsekuensi yang diinginkan (uang tunai bergerak harus selalu berada di dalam sebuah shift), tetapi harus dikomunikasikan di UI: `ReportsPage` memeriksa `hasOpenShift` dan menampilkan peringatan yang sama seperti `CustomersPage` sebelum membuka form refund. Refund non-tunai (QRIS/transfer/hutang) tidak butuh shift.

---

### C. Bounded wait bersama (1.7, 1.8 → 2.7, 2.8)

Dirancang sebagai **satu mekanisme bersama**, bukan dua tambalan.

**C.1 Pembungkus fetch dengan deadline** — file baru `src/lib/fetchWithTimeout.ts`

```ts
export const SUPABASE_REQUEST_TIMEOUT_MS = 15000
export class RequestTimeoutError extends Error { readonly isTimeout = true }

export function createTimeoutFetch(defaultTimeoutMs: number): typeof fetch
export function runWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T>
```

- `createTimeoutFetch` menghormati `AbortSignal` yang sudah dibawa pemanggil (gabungkan dengan `AbortSignal.any` bila tersedia, jika tidak pasang listener manual) supaya tidak mematikan pembatalan milik supabase-js sendiri.
- Dipasang di `src/lib/supabase.ts` lewat `createClient(url, key, { global: { fetch: createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS) }, auth: {...} })`. Ini otomatis memberi batas waktu pada **semua** PostgREST, RPC, dan `auth.*` — termasuk `auth.getSession()` yang menjadi akar 1.8. Realtime memakai WebSocket, tidak lewat fetch, jadi tidak terpengaruh.
- Unggahan gambar produk bisa melampaui 15 detik pada koneksi lambat; `uploadProductPhoto` memanggil dengan timeout lebih longgar lewat `AbortSignal` sendiri (mis. 60 detik), yang dihormati pembungkus.
- `commitTransaction` juga dibungkus `runWithTimeout` eksplisit dengan label yang membuat pesan toast dapat ditindaklanjuti ("Server tidak merespons dalam 15 detik. Periksa koneksi lalu tekan Coba Lagi — transaksi tidak akan terkirim dua kali."). Kunci idempotensi tidak dirotasi karena payload tidak berubah, jadi Property 14 terjaga otomatis oleh logika `lastCheckoutFingerprintRef` yang sudah ada.

**C.2 Probe reachability** — `src/hooks/useOnlineStatus.ts`

- Status online menjadi `navigator.onLine && reachable`.
- Probe: `fetch(`${VITE_SUPABASE_URL}/auth/v1/health`, { method: 'GET', cache: 'no-store', signal })` dengan timeout pendek (≈5 detik). Endpoint ini tidak butuh autentikasi dan murah.
- Jadwal: satu probe saat mount, lalu interval 30 detik **hanya saat `document.visibilityState === 'visible'`**, plus probe segera pada event `online` dan `visibilitychange`, plus probe on-demand yang diekspos (`revalidate()`) agar POSPage dapat memanggilnya setelah kegagalan checkout.
- `navigator.onLine === false` tetap langsung berarti offline tanpa probe — jalur offline yang sudah benar (3.5) tidak berubah, probe hanya **menambah** kondisi offline.
- Nilai awal tetap optimistis (`navigator.onLine`) supaya tombol checkout tidak berkedip nonaktif pada render pertama.

**C.3 `AuthProvider`: timeout sebagai kegagalan, bukan bypass** — `src/components/auth/AuthProvider.tsx`

```
if (!initialized || loading) {
  if (timedOut) return <AuthFailureScreen onRetry={retry} />   // 2.8
  return <AuthLoadingScreen />
}
return children
```

- `retry` mereset `timedOut`, memanggil ulang `initialize()`. Karena `initialize` menjaga diri dengan `initializePromise` dan `initialized`, retry perlu jalur eksplisit: tambahkan aksi `reinitialize()` di `authStore` yang mengosongkan `initialized` dan `initializePromise` sebelum memanggil kembali alur yang sama — tanpa menyentuh pendaftaran `authSubscription` (3.12, anti-langganan-ganda).
- Rute terproteksi **tidak pernah** dirender dengan status auth belum resolve, sehingga `PrivateRoute` tidak pernah melihat `session` null secara prematur.
- Dengan C.1 terpasang, `auth.getSession()` kini punya deadline sendiri, jadi kasus umum selesai dengan error yang bisa ditampilkan dan layar kegagalan menjadi jalur cadangan, bukan jalur utama.

---

### D. Input kasir (1.9, 1.10 → 2.9, 2.10)

**D.1 `NumpadModal` presisi desimal** — `src/components/pos/NumpadModal.tsx`

- Prop baru `decimalPlaces?: number` (default 0 = perilaku sekarang, Property 17) dan `step?: number`.
- Tombol `,` dirender hanya bila `decimalPlaces > 0`; disabled bila `valueStr` sudah memuat separator.
- `handleDigit` menolak digit bila bagian desimal sudah mencapai `decimalPlaces` — inilah yang mencegah `0.25` → `0.255`.
- Normalisasi `initialValue`: format dengan presisi yang diizinkan lalu buang nol berlebih (`0.250` → `"0.25"`, `3` → `"3"`), sehingga `valueStr` selalu bentuk minimal.
- `displayFormatted` memakai `toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: decimalPlaces })`; parsing memakai bentuk internal titik desimal agar tidak bergantung locale.
- Dukungan keyboard menerima `,` dan `.` sebagai separator.
- `handleConfirm` membulatkan ke `decimalPlaces` sebelum membandingkan dengan `minValue`/`maxValue`, menghindari penolakan karena galat float.

**D.2 Helper presisi satuan** — `src/lib/units.ts`

```ts
const FRACTIONAL_SATUAN = new Set(['kg', 'gram', 'meter', 'liter'])
export const MAX_QTY_DECIMALS = 3   // plafon dari transaction_items.qty NUMERIC(12,3)
export function getQtyDecimals(satuan: string | null | undefined): number
```

Plafon 3 desimal bukan angka pilihan bebas: `transaction_items.qty` bertipe `NUMERIC(12,3)` sejak migrasi 029, jadi presisi di atas itu akan dibulatkan diam-diam oleh Postgres dan membuat total klien berbeda dari total server. Satuan diskret (pcs, lusin, dus, pack, ikat, bal, roll, batang, lembar) tetap 0 desimal.

**D.3 Call site POSPage** — `src/pages/POSPage.tsx`

- `decimalPlaces={getQtyDecimals(numpadItem.satuan)}`
- `minValue={decimalPlaces > 0 ? 10 ** -decimalPlaces : 1}`
- `maxValue` = sisa stok baris **dalam satuan jual**: `(remainingBase(productId) + currentLineBaseQty) / rasio`, di mana `remainingBase` berasal dari `remainingBaseStockByProduct` yang sudah ada. Ini menggantikan konstanta 9999 dan tetap konsisten dengan validasi agregat lintas satuan, karena `cartStore.updateQty` tetap menjadi penjaga terakhir (3.4) — numpad hanya mencegah input yang pasti ditolak.
- `quickOptions` menjadi sadar satuan: `[0.25, 0.5, 0.75, 1, 2, 5]` untuk satuan pecahan, tetap `[1, 2, 5, 10, 20, 50, 100]` untuk diskret.

**D.4 `BarcodeScannerModal` stabil terhadap re-render** — `src/components/pos/BarcodeScannerModal.tsx`

- Simpan callback di ref yang disinkronkan oleh effect terpisah (`onCloseRef.current = onClose` setiap render), lalu jadikan effect kamera bergantung **hanya** pada `[isOpen]`.
- Handler sukses memanggil `onScanSuccessRef.current(...)` / `onCloseRef.current()`.
- Invarian dimiliki komponen, jadi POSPage boleh terus meneruskan arrow function inline tanpa memunculkan lagi cacat ini. Memoisasi di call site bersifat opsional dan tidak menjadi syarat kebenaran.

---

### E. Tempo, timezone, dan pemisahan kas (1.11, 1.12, 1.14 → 2.11, 2.12, 2.14)

**E.1 `tempo_hutang_hari` dan `receivables.jatuh_tempo`** — *aditif; re-emit `create_transaction_atomic`*

File: migrasi baru + `src/pages/SettingsPage.tsx` + `src/pages/CustomersPage.tsx`.

- Di dalam `create_transaction_atomic`, baca setelan dengan pola yang sama seperti `ppn_persen`:

```
SELECT value INTO v_setting_tempo FROM public.store_settings
WHERE tenant_id = v_tenant_id AND key = 'tempo_hutang_hari';

v_tempo_hari := LEAST(GREATEST(COALESCE(NULLIF(v_setting_tempo,'')::INTEGER, 14), 0), 365);
```

- Blok `INSERT INTO public.receivables` memperoleh kolom `jatuh_tempo`:

```
jatuh_tempo = ((COALESCE(v_paid_at, NOW()) AT TIME ZONE 'Asia/Jakarta')::date + v_tempo_hari)
```

Tanggal WIB dipakai agar tempo tidak bergeser sehari untuk transaksi malam (`jatuh_tempo` bertipe `DATE`).

- **`tempo_hutang_hari` TIDAK masuk `request_fingerprint`.** Alasannya sama dengan `ppn_persen` (lihat komentar di 066): untuk percobaan baru dipakai setelan server saat ini, untuk recovery dipakai nilai tersimpan pada transaksi lama. Menambahkannya ke fingerprint akan membatalkan recovery respons-hilang setiap kali admin mengubah tenor di tengah jalan (Property 20).
- Fungsi ini **sama dengan yang di-re-emit 066**. Karena 066 belum pernah dieksekusi, migrasi baru memuat versi gabungan: semua perubahan 066 (pembulatan rupiah bulat, `DELETE FROM tmp_demand`) **plus** `jatuh_tempo`. Rincian keputusan ada di [Strategi Migrasi](#strategi-migrasi).
- `SettingsPage`: tambah field "Tempo hutang (hari)" di kartu yang sudah memuat PPN; zod `z.coerce.number().int().min(0).max(365)`, default 14; persist lewat `updateSettings` yang sudah ada.
- `CustomersPage`: badge jatuh tempo sudah merender bila `r.jatuh_tempo` ada; tambahkan penanda terlewat (`new Date(r.jatuh_tempo) < todayWIB && sisa_hutang > 0` → gaya danger) sesuai 2.11.
- **Backfill piutang lama — DIPUTUSKAN 2026-09-22 (gate 3.2): BIARKAN NULL, TIDAK ADA BACKFILL.** Baris `receivables` yang sudah ada punya `jatuh_tempo` NULL dan **dibiarkan NULL**. Blok backfill **tidak ditulis** di 067 (bukan ditulis lalu dikomentari). Alasan yang menentukan: target tidak punya data produksi sama sekali — org hanya memuat satu project dan project itu UAT dengan nol transaksi bisnis, jadi **tidak ada piutang lama untuk dibackfill**; pertanyaannya kosong dalam praktik, bukan ditunda. Baris `lunas`/`dibatalkan` tidak disentuh (tetap berlaku apa pun keputusannya). Badge kosong di `CustomersPage` untuk piutang tanpa `jatuh_tempo` adalah **perilaku yang diharapkan, bukan bug**. Rekomendasi lama (backfill `belum_lunas`/`sebagian` dengan `created_at` WIB + tenor tenant, fallback 14) dipertahankan di sini sebagai jejak: ia **mutasi data historis** yang mengubah tampilan aging, dan tidak dijalankan.

**E.2 Batas hari WIB di klien** — `src/utils/date.ts`, `src/api/reports.ts`

- Tambah helper (tanpa mengubah `getISOStartOfDay`/`getISOExclusiveEndOfDay`, menjaga 3.8):

```ts
export function getWIBDateKey(value: string | Date): string   // 'yyyy-MM-dd' pada WIB
export function getWIBToday(): string                          // hari ini menurut WIB
export function addWIBDays(dateKey: string, days: number): string
```

Implementasi memakai aritmetika offset +07:00 yang sudah dipakai `getPendingTransactions`, atau `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })`. Yang penting hasilnya tidak bergantung timezone perangkat.

- `buildDayRange(date)` diganti menjadi berbasis kunci tanggal WIB: `{ from: getISOStartOfDay(key), to: getISOExclusiveEndOfDay(key) }`.
- `getDashboardChangeSummary` memakai `getWIBToday()` dan `addWIBDays(today, -1)` alih-alih `new Date()` / `subDays`.
- `formatLocalDateKey` → `getWIBDateKey` di `getSalesReport` (bucket harian) dan `getSalesTrend` (pembentukan kunci), sehingga bucket klien cocok dengan `DATE(created_at AT TIME ZONE 'Asia/Jakarta')` milik RPC.
- `getSalesTrend` membangun rentang dari kunci WIB, bukan `startOfDay/endOfDay` lokal.
- `formatLocalDateKey` dipertahankan sebagai alias terdeprekasi bila masih ada pemanggil lain, tetapi jalur laporan tidak memakainya lagi.

**E.3 Pemisahan omzet akrual dan kas diterima** — *aditif (RPC baru)*

File: migrasi baru + `src/api/reports.ts` + `src/pages/ReportsPage.tsx` + `src/pages/DashboardPage.tsx`.

- RPC baru `get_cash_receipts_summary(p_date_from timestamptz, p_date_to timestamptz)`, `SECURITY DEFINER`, digerbangi `is_admin()`, batas atas eksklusif, mengembalikan:

| Kolom | Definisi |
|---|---|
| `omzet_akrual` | `SUM(total)` transaksi `selesai` + `dibayar` pada rentang (identik dengan angka sekarang) |
| `kas_dari_penjualan` | idem, tetapi `metode_bayar IN ('tunai','qris','transfer')` dan berbasis `paid_at` |
| `kas_dari_cicilan` | `SUM(receivable_payments.jumlah)` pada rentang |
| `refund_kas` | `SUM(transaction_refunds.amount)` pada rentang |
| `kas_diterima` | `kas_dari_penjualan + kas_dari_cicilan − refund_kas` |
| `piutang_baru` | `SUM(total)` transaksi `metode_bayar = 'hutang'` pada rentang |

Satu RPC dipilih alih-alih beberapa query klien supaya semua leg memakai batas WIB dan definisi yang sama, dan supaya penggerbangan `is_admin()` tetap satu tempat.

- `getReportSummary` diperluas dengan `omzetAkrual`, `kasDiterima`, `piutangBaru`; `totalPenjualan` dipertahankan (= `omzetAkrual`) agar pemanggil lain tidak berubah.
- `ReportsPage` dan `DashboardPage` menampilkan dua kartu berlabel tegas: **"Omzet (akrual)"** dan **"Kas diterima"**, dengan keterangan kecil "penjualan hutang belum termasuk kas". `get_profit_summary` **tidak** diubah semantiknya — basis akrual dipertahankan sesuai keputusan produk 4.

---

### F. Paritas struk thermal (1.15 → 2.15)

File: `src/utils/escpos.ts`, `src/pages/POSPage.tsx`.

- `ReceiptData.items` diperluas: `{ name, qty, unit?, unitPrice?, discountPercent?, lineTotal }`. `price` lama dipertahankan sebagai alias `lineTotal` agar pemanggil lain tidak pecah.
- Helper murni baru di `escpos.ts` (target utama uji behavioural):
  - `wrapText(text, width): string[]` — wrap per kata, potong hanya kata yang memang melebihi lebar.
  - `formatQty(qty): string` — `2` → `"2"`, `0.5` → `"0,5"`, `0.25` → `"0,25"` (koma, tanpa nol berlebih).
- Tiap baris item: nama di-wrap, lalu `leftRight("  " + formatQty(qty) + " " + unit + " x " + formatCurrency(unitPrice), formatCurrency(lineTotal))`, dan bila `discountPercent > 0` satu baris tambahan `leftRight("  Diskon " + discountPercent + "%", "")`. Lebar 32 kolom harus tetap dihormati; bila baris harga-satuan tidak muat, pecah menjadi dua baris alih-alih terpotong.
- `cash_received` dan `change` dicetak bila `!= null` (buang syarat `> 0`) — sehingga "Bayar Rp 50.000 / Kembalian Rp 0" tetap tercetak.
- `customer_name` dan `note` sudah didukung builder; `POSPage.handleThermalPrint` harus **mengirimkannya**: `customer_name: receiptCustomerName`, `note: receiptTransaction.catatan`, dan `cash_received: receiptTransaction.uang_diterima ?? undefined`, `change: receiptTransaction.kembalian ?? undefined` (hapus pemeriksaan truthy di call site — inilah tempat nilai 0 pertama kali hilang).
- Nama pelanggan perlu disimpan bersama transaksi struk: tambahkan state `receiptCustomerName` yang diisi dari `selectedCustomer?.nama` saat checkout dan dari `customers` saat mencetak dari riwayat.
- `ReceiptPrint` (struk browser) tidak diubah (3.13).

---

### G. Audit area belum tersentuh (1.18 → 2.18)

Protokol: untuk setiap area, catat temuan sebagai klausa baru pada `bugfix.md` (1.19+/2.19+/3.14+) beserta severity, lalu tangani dengan alur yang sama seperti klausa lain.

| Area | Baris | Fokus pemeriksaan |
|---|---|---|
| `ProductsPage.tsx` | 2247 | Dampak A.3/A.4; validasi zod vs constraint DB; ekspor XLSX (kebocoran kolom biaya ke file); alur varian & repack; penanganan kegagalan upload |
| `SettingsPage.tsx` | 1130 | `updateSettings` upsert tanpa `tenant_id` eksplisit (andalkan default kolom); validasi `ppn_persen`/`tempo_hutang_hari`; alur staf setelah A.5 |
| `StockPage.tsx` | 870 | Penyesuaian stok vs satuan dasar; idempotensi repack; atribusi aktor |
| `AuditPage.tsx` | 185 | `audit_logs_with_user` ber-`security_invoker` + policy admin-only; paginasi |
| `escpos.ts` | 231 | Selesai lewat F; sisa: penanganan WebUSB device yang dicabut, `cachedEndpoint` stale |
| `BarcodeScannerModal.tsx` | 149 | Selesai lewat D.4; sisa: pelepasan track kamera saat unmount mendadak |
| Service worker / PWA | — | Cakupan cache (jangan pernah men-cache respons PostgREST berisi data tenant), strategi update, perilaku saat asset lama |
| Migrasi 001–052 | — | Policy sisa dari era pra-054, view tanpa `security_invoker`, fungsi tanpa `SET search_path`, `GRANT` terlalu lebar |

**Temuan yang sudah teridentifikasi selama perancangan ini** (masukkan ke `bugfix.md` sebagai klausa baru):

1. `transaction_items.harga_beli`/`laba_kotor` dan agregat `transactions_with_kasir.laba_kotor` terbaca kasir — akar sama dengan 1.4, ditangani A.4. Severity P0.
2. Bucket `products` ber-`public = true` + `getPublicUrl()` membuat penyempitan policy saja tidak menutup 1.6 — ditangani di [Migrasi Kebijakan Storage](#migrasi-kebijakan-storage-162639). Severity P0.
3. `AdminRoute` mem-fallback ke `/dashboard`; menjadikan `/dashboard` admin-only tanpa mengubah fallback menghasilkan redirect loop — ditangani A.2. Severity P1 (cacat baru yang akan diperkenalkan bila 2.3 dikerjakan setengah).
4. `get_sales_by_date` (045) memakai `SET search_path TO 'public'`, menyimpang dari house style `pg_catalog, public` — diselaraskan saat re-emit A.1. Severity P3.
5. `getSalesByCategory` memanggil `getTopProducts(..., 100)`, jadi "penjualan per kategori" akan ikut tertolak untuk non-admin setelah A.1 — konsisten dengan 2.3 (halaman Laporan memang admin-only), tetapi perlu dicatat agar tidak dianggap regresi.

## Strategi Migrasi

Bagian ini menentukan **apa yang masuk migrasi mana** dan **dalam urutan apa** relatif terhadap deploy frontend. Salah urutan di sini mematikan POS untuk kasir, jadi ini bagian yang paling perlu dieksekusi disiplin.

### Keputusan tentang migrasi 066

**Keputusan: 066 tidak diubah. Semua SQL baru masuk 067 dan seterusnya.**

Alasan, berurutan dari yang paling menentukan:

1. **`supabase db push` mencatat versi berdasarkan prefix nama file.** Bila 066 ternyata sudah diterapkan ke lingkungan mana pun (termasuk branch/staging yang akan dibuat selama pekerjaan ini), file yang diedit **tidak akan pernah dieksekusi ulang** — perubahannya hilang tanpa peringatan dan lingkungan menjadi divergen secara senyap. Kita tidak bisa membuktikan 066 belum diterapkan di mana pun untuk seluruh sisa umur pekerjaan ini; yang kita tahu hanya bahwa ia belum pernah dieksekusi *sampai sekarang*.
2. **Konvensi repo memang re-emit fungsi utuh per migrasi.** `create_transaction_atomic` sudah di-re-emit di 050, 051, 053, 055, 064, 066; `close_cash_shift` di 043, 054, 056, 057, 058, 064. Re-emit sekali lagi di 067 adalah pola normal repo ini, bukan pemborosan.
3. **Jejak audit.** Uji penjaga teks CI mengimpor file migrasi per nama (`migration057`, `migration054`, `migration066`). Menulis ulang isi 066 membuat asersi yang sudah lolos menjadi tidak bermakna sebagai bukti historis.

**Satu-satunya pengecualian yang sah:** bila saat validasi ternyata 066 **gagal diterapkan** (syntax error, dependensi hilang). Migrasi yang gagal tidak meninggalkan baris versi tercatat, sehingga memperbaikinya di tempat adalah tindakan yang benar dan aman. Perbaikan seperti itu wajib dicatat di ringkasan verifikasi.

Konsekuensi praktis: 067 memuat re-emit `create_transaction_atomic` **di atas** versi 066 (pembulatan rupiah bulat + `DELETE FROM tmp_demand` dipertahankan verbatim, ditambah `jatuh_tempo`). Kedua migrasi akan diterapkan dalam satu `db push`, jadi fungsi tersebut dibuat dua kali dalam satu sesi — tidak berbahaya, dan diberi komentar eksplisit di header 067 supaya reviewer tidak bingung mengapa fungsi yang sama muncul dua kali dalam satu batch.

Catatan tambahan: 066 sudah mengandung `DROP FUNCTION IF EXISTS public.get_top_products(timestamptz, timestamptz, integer)` karena tipe kembaliannya berubah (`total_qty` BIGINT → NUMERIC) dan `CREATE OR REPLACE` tidak dapat mengubah signature `RETURNS TABLE`. 067 akan **menyentuh fungsi yang sama lagi** (menambah guard `is_admin()`), kali ini tanpa mengubah tipe kembalian, jadi `CREATE OR REPLACE` cukup — tetapi urutannya wajib 066 dulu, karena `CREATE OR REPLACE` terhadap signature lama akan gagal.

### Pemetaan perubahan ke migrasi

Pemisahan dibuat berdasarkan **sifat** perubahan, bukan berdasarkan klausa, karena sifatnya yang menentukan urutan deploy.

**067 — aditif dan netral urutan** (boleh diterapkan sebelum maupun sesudah deploy frontend):

1. Re-emit `create_transaction_atomic` = 066 + `jatuh_tempo` dari `tempo_hutang_hari` (E.1).
2. ~~Re-emit `close_cash_shift` dengan `AND status = 'selesai'` pada leg tunai (B.4).~~ **DIBATALKAN 2026-09-22 atas keputusan pemilik (resolusi 2.13).** 067 **tidak menyentuh `close_cash_shift` sama sekali**; fungsi yang live tetap versi 064. Lihat [B.4](#b-klaster-refund-11-12-113--21-22-213).
3. Re-emit `refund_transaction_atomic` = 060 + syarat shift untuk refund tunai (B.5).
4. `products_with_category` di-re-emit dengan kolom eksplisit tanpa `harga_beli`; view baru `products_admin_with_category`, `product_units_admin`, `transaction_items_public`, `transactions_with_kasir` (tanpa `laba_kotor`, `security_invoker = false` + guard tenant), `transactions_with_kasir_admin` (A.3, A.4, A.5).
5. RPC baru `get_cash_receipts_summary` (E.3).
6. Seed setelan `tempo_hutang_hari` default `'14'` untuk tenant yang belum punya (E.1). **Blok backfill `receivables.jatuh_tempo` TIDAK ADA di 067** — gate 3.2 diputuskan pemilik pada 2026-09-22: **biarkan NULL, tidak ada backfill**; bloknya **tidak ditulis**, bukan ditulis lalu dikomentari. Lihat [E.1 butir "Backfill piutang lama"](#e-tempo-timezone-dan-pemisahan-kas-111-112-114--211-212-214).
7. View audit path storage `product_image_path_audit` (read-only, admin-only) — lihat bagian storage.
8. Blok `REVOKE ALL ... GRANT ...` eksplisit untuk setiap fungsi dan view yang disentuh, sesuai house style 062.

Mengapa 067 netral urutan: setiap butir hanya **menambah** kemampuan atau mengubah bentuk view dengan cara yang tidak merusak pemanggil sekarang. Satu-satunya pengecualian kecil: begitu 067 diterapkan, `ProductsPage` kehilangan nilai `harga_beli` (kolom Margin% menjadi 0) sampai frontend beralih ke `products_admin_with_category`. Itu degradasi tampilan admin, **bukan** error — dapat diterima untuk jendela beberapa menit, dan jauh lebih aman daripada urutan sebaliknya (frontend menunjuk view yang belum ada = error keras).

**068 — subtraktif, hanya setelah frontend live:**

1. Guard `is_admin()` pada `get_profit_summary`, `get_top_products`, `get_sales_by_date`, `get_dashboard_stats` (A.1).
2. `REVOKE SELECT (harga_beli) ON public.products FROM authenticated`.
3. `REVOKE SELECT (harga_beli) ON public.product_units FROM authenticated`.
4. `REVOKE SELECT (harga_beli, laba_kotor) ON public.transaction_items FROM authenticated`.
5. `product_price_history_tenant_select` dipersempit dengan `AND public.is_admin()`.
6. `profiles_tenant_select` dipersempit menjadi profil sendiri atau admin (A.5).

**069 — penyempitan kebijakan storage**, hanya setelah audit path selesai dan nol objek non-konforman (lihat bagian berikut).

### Batasan urutan antara migrasi dan frontend

Ini inti risikonya. Tiga kelas perubahan dengan arah ketergantungan berbeda:

| Kelas | Contoh | Urutan wajib | Akibat bila dibalik |
|---|---|---|---|
| Frontend butuh objek baru | `ProductsPage` → `products_admin_with_category`; `ReportsPage` → `transactions_with_kasir_admin`; `getTransactionById` → `transaction_items_public` | **Migrasi 067 dulu**, frontend menyusul | Error keras "relation does not exist"; halaman Produk/Laporan/struk mati |
| Migrasi mencabut kemampuan yang masih dipakai frontend | REVOKE kolom biaya; guard `is_admin()` pada RPC laporan | **Frontend dulu**, migrasi 068 menyusul | Fatal: `select('*')` gagal seluruhnya (bukan mengosongkan kolom) → struk kasir dan daftar produk admin mati; `/dashboard` kasir error 42501 |
| ~~Harus atomik, tidak boleh terpisah~~ **(pasangan ini larut 2026-09-22)** | ~~Refund aktif (B.1–B.3) + `status = 'selesai'` pada leg tunai (B.4)~~ → yang tersisa: refund aktif (B.1–B.3) + syarat shift kasir untuk refund tunai (B.5, task 6.3) | Migrasi 067 **sebelum** tombol refund tersedia di build produksi | Refund tunai dapat dijalankan tanpa shift kasir aktif, sehingga uang keluar laci tanpa masuk rekonsiliasi siapa pun. **Bukan lagi** karena leg tunai: klausa 2.13 dibatalkan, `close_cash_shift` tidak diubah, dan rekonsiliasi memang sudah cocok dengan uang fisik pada versi 064 |

Urutan rilis yang direkomendasikan:

1. `db push` **066 + 067** ke target non-produksi, verifikasi, lalu ke produksi. Pada titik ini belum ada perilaku kasir yang berubah; degradasi sementara hanya kolom Margin% di halaman Produk admin.
2. Deploy frontend build #1: semua peralihan sumber baca (`products_admin_with_category`, `transactions_with_kasir_admin`, `transaction_items_public`), `/dashboard` di bawah `AdminRoute` + fallback `AdminRoute` ke `/pos`, klaster C (bounded wait), klaster D (numpad & scanner), klaster F (struk thermal), field `tempo_hutang_hari` di Pengaturan, kartu kas vs akrual, dan UI refund.
3. Verifikasi runtime build #1 (checklist 2.17 + smoke kasir: login kasir, katalog muncul, checkout tunai, cetak struk).
4. `db push` **068** ke non-produksi, verifikasi penolakan dengan impersonasi kasir, lalu ke produksi.
5. Verifikasi ulang jalur kasir segera setelah 068 (ini titik paling berisiko dalam seluruh batch).
6. Audit path storage → pindahkan objek non-konforman → `db push` **069** → verifikasi gambar tetap tampil untuk kedua peran.

Titik mundur (rollback): 068 dapat dibalik dengan `GRANT SELECT (kolom) ... TO authenticated` dan re-emit fungsi laporan tanpa guard. Siapkan file pembalik ini **sebelum** menerapkan 068, jangan menyusunnya saat insiden.

### Jalur validasi Supabase (1.16 → 2.16)

Batasan mesin: Docker mati, `psql` tidak terpasang, Supabase CLI v2.78.1, satu project ter-link (`dfgqioglsirftfyjyswd` = produksi). Karena itu pembagiannya harus tegas.

**Dapat diotomatiskan (tanpa Docker, tanpa kredensial tambahan):**

- `npm test` — penjaga teks statis atas file migrasi lewat impor `?raw`, diperluas untuk 067/068/069.
- `npx vitest run src/__tests__/securityMigration.test.ts src/__tests__/transactionInvariants.test.ts` — job CI yang sudah ada.
- `npm run build` dan `npm run lint`.
- `supabase migration list --linked` untuk melihat versi mana yang sudah tercatat di remote (butuh jaringan; **read-only**).
- `supabase db push --linked --dry-run` untuk melihat daftar file yang akan diterapkan tanpa menerapkannya. Perlu disadari: dry-run **tidak mem-parse SQL**, hanya membandingkan daftar versi. Tidak ada pemeriksaan sintaks SQL yang mungkin dilakukan di mesin ini tanpa Docker — ini batas nyata yang harus diterima, bukan ditutupi.

**Butuh Docker (jelas tidak tersedia; jangan dijanjikan):**

- `supabase db start`, `supabase db reset`, `supabase db lint`, `supabase db diff`, dan `scripts/reset-uat-cloud.sh`.

**Harus dilakukan pengguna (butuh akses dashboard/organisasi):**

1. Siapkan target non-produksi. Dua opsi:
   - **Supabase branch** — memerlukan integrasi GitHub dan paket berbayar pada project. Bila tersedia, ini pilihan terbaik karena skemanya diturunkan dari repo yang sama.
   - **Project staging terpisah** — selalu tersedia, termasuk di paket gratis. Konsekuensinya: tanpa data produksi, sehingga audit path storage (069) **harus** dijalankan sebagai query read-only terhadap produksi, bukan terhadap staging.
2. `supabase link --project-ref <staging-ref>`
3. `supabase db push` → menerapkan 001–067 pada database kosong. Ini sekaligus membuktikan seluruh rantai migrasi dapat dieksekusi dari nol, hal yang belum pernah terbukti.
4. Jalankan skrip verifikasi SQL (di bawah) lewat **SQL Editor** dashboard Supabase.
5. `supabase link --project-ref dfgqioglsirftfyjyswd` lalu `supabase db push` ke produksi.
6. Ulangi 2–5 untuk 068, lalu 069.

**Pemeriksaan SQL tanpa Docker maupun `psql`** — dijalankan di SQL Editor, hasilnya ditempel ke ringkasan verifikasi:

```sql
-- 1. Hak EXECUTE RPC laporan (harus true; penolakan terjadi di dalam body, bukan di ACL)
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_profit_summary','get_top_products','get_sales_by_date',
                    'get_dashboard_stats','get_cash_receipts_summary',
                    'refund_transaction_atomic','close_cash_shift','create_transaction_atomic');
-- Harapan: anon_execute = false untuk semuanya.

-- 2. Guard is_admin() benar-benar ada di dalam body
SELECT proname, prosrc LIKE '%is_admin()%' AS has_guard
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND proname IN
  ('get_profit_summary','get_top_products','get_sales_by_date','get_dashboard_stats');

-- 3. Hak kolom biaya sudah tercabut
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema='public' AND grantee IN ('authenticated','anon')
  AND (table_name, column_name) IN
      (VALUES ('products','harga_beli'), ('product_units','harga_beli'),
              ('transaction_items','harga_beli'), ('transaction_items','laba_kotor'));
-- Harapan setelah 068: nol baris.

-- 4. Inventaris policy storage
SELECT policyname, roles, cmd, qual FROM pg_policies
WHERE schemaname='storage' AND tablename='objects';

-- 5. Flag bucket
SELECT id, public, file_size_limit FROM storage.buckets WHERE id='products';

-- 6. security_invoker per view (t = jalur kasir, f = jalur admin bergerbang)
SELECT c.relname, c.reloptions
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='v'
  AND c.relname IN ('products_with_category','products_admin_with_category',
                    'transactions_with_kasir','transactions_with_kasir_admin',
                    'transaction_items_public','audit_logs_with_user');
```

**Simulasi peran kasir tanpa membuat sesi peramban** — cara paling penting dan paling sering dilewatkan. Di SQL Editor:

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', '<uuid-kasir>', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;

-- Harus ERROR (2.3)
SELECT * FROM public.get_profit_summary(now() - interval '7 days', now());
-- Harus ERROR hak akses (2.4)
SELECT harga_beli FROM public.products LIMIT 1;
-- Harus BERHASIL dan tidak memuat harga_beli (Property 6)
SELECT * FROM public.products_with_category LIMIT 1;
-- Harus mengembalikan tepat satu baris (2.5)
SELECT count(*) FROM public.profiles;
ROLLBACK;
```

Ulangi blok yang sama dengan `sub` milik admin dan pastikan semuanya berhasil (Property 4). Ini memberikan bukti perilaku RLS dan hak kolom yang nyata tanpa Docker dan tanpa `psql`, dan hasilnya wajib ditempel ke catatan verifikasi.

### Migrasi Kebijakan Storage (1.6/2.6/3.9)

**Koreksi mekanisme.** Klausa 1.6 menyebut `product_images_public_select` sebagai penyebab. Itu benar tetapi belum lengkap: bucket `products` dibuat `public = true` di migrasi 016, dan `uploadProductPhoto` memakai `getPublicUrl()` sehingga seluruh gambar diakses lewat `/storage/v1/object/public/products/...`. Endpoint publik itu melayani objek **tanpa mengevaluasi RLS `storage.objects`**. Karena itu mempersempit policy saja tidak menutup akses anonim — 2.6 hanya terpenuhi bila bucket juga diprivatkan.

> **TERKONFIRMASI secara empiris 2026-09-22 (eksplorasi task 5).** Di target UAT, dengan bucket tetap `public = true`, policy `SELECT` dipersempit dari `product_images_public_select` (`TO public`) menjadi `product_images_tenant_select` (`TO authenticated`, `(storage.foldername(name))[1] = get_my_tenant_id()::text`) **tanpa** menyentuh flag bucket → `curl` anonim tanpa header apa pun **tetap HTTP 200 pada 3 percobaan**, sementara `storage.buckets.public` diverifikasi masih `true`. Jadi: **penyempitan policy saja TIDAK cukup, privatisasi bucket wajib, dan gate 3.1 tetap hidup — task 19 tidak boleh disederhanakan.** Perubahan percobaan itu sudah dibalikkan. Nilai teramati lengkap: `verification-notes.md` → "Task 5 … Kasus 4".

> **TEMUAN BARU 2026-09-22 — langkah yang hilang dari rencana 069: cache CDN.** Saat `storage.buckets.public` di-set `false`, `curl` anonim ke URL yang **sudah pernah diminta** **tetap HTTP 200** dengan header **`cf-cache-status: HIT`** (`cache-control: no-cache`, `cf-ray` region SIN). URL yang sama dengan cache-buster `?v=<random>` → **HTTP 400**, dan objek yang **belum pernah** diminta → **HTTP 400** langsung. Artinya membalik flag bucket **tidak langsung** menutup akses ke objek yang sudah ter-cache di CDN Cloudflare; ada jendela waktu di mana gambar lama — justru yang paling mungkin sudah tersebar — masih terbaca anonim. **Rencana 069 wajib memuat langkah eksplisit untuk menutup jendela ini** (purge cache, atau rotasi nama objek sehingga URL lama tidak lagi menunjuk objek yang sama; rotasi nama sekalian menyatu dengan pemindahan path di Langkah 3), **bukan** diasumsikan selesai saat flag dibalik. Dicatat sebagai klausa **1.20 / 2.20** di `bugfix.md`, severity **P1**. Konsekuensi untuk Langkah 6: verifikasi 400/404 **harus** memakai cache-buster, atau hasilnya menyesatkan.

**Konsekuensi yang harus diputuskan pemilik.** Keputusan produk 3 pada `bugfix.md` berbunyi "bukan `public`, bukan signed URL". Setelah bucket privat, `<img src>` tidak dapat mengirim header `Authorization`, sehingga pilihan yang tersisa hanya dua:

| Opsi | Cara kerja | Biaya | Catatan |
|---|---|---|---|
| **A. Blob authenticated** (sesuai keputusan awal, tanpa signed URL) | `supabase.storage.from('products').download(path)` (mengirim token sesi) → `URL.createObjectURL(blob)` | Hook pemuat gambar + cache di memori + `revokeObjectURL`; `foto_url` harus menyimpan **path objek**, bukan URL penuh (atau path diturunkan dari URL lama); grid produk mengunduh N blob | Tidak ada URL yang bisa dibagikan; paling ketat |
| **B. Signed URL TTL pendek** | `createSignedUrl(path, 3600)` dipakai langsung di `<img src>` | Jauh lebih kecil; caching peramban tetap jalan | Menyimpang dari keputusan produk 3; URL bertanda-tangan bisa dibagikan sampai kedaluwarsa |

Rekomendasi saat rancangan ditulis: **konfirmasikan kembali ke pemilik.** Keputusan "bukan signed URL" tampaknya dibuat dengan asumsi bahwa perubahan policy saja sudah cukup, sehingga biaya opsi A belum terlihat saat keputusan diambil. Rancangan awal mengasumsikan **opsi A** (menghormati keputusan tertulis) sambil mencatat opsi B sebagai jalur berbiaya jauh lebih rendah yang sah secara keamanan.

> ### ✅ KEPUTUSAN PEMILIK 2026-09-22 (gate 3.1): **OPSI B — SIGNED URL TTL PENDEK**
>
> `createSignedUrl(path, 3600)` dipakai **langsung di `<img src>`**, diperbarui sebelum
> TTL habis. **Opsi A tidak dipakai dan tidak lagi menjadi asumsi rancangan.**
>
> **Ini penyimpangan yang disengaja** dari keputusan produk tertulis nomor 3 pada
> `bugfix.md` ("bukan `public`, bukan signed URL"). Alasan penyimpangannya dicatat apa
> adanya: keputusan itu diambil **sebelum biaya opsi A terlihat**; opsi B jauh lebih
> murah, caching peramban tetap bekerja, dan tetap sah secara keamanan.
> **Tradeoff yang diterima secara sadar:** URL bertanda tangan dapat dibagikan sampai
> TTL habis.
>
> Konsekuensi yang mengikat pelaksanaan:
>
> - **Task 19.3 menjadi implementasi signed URL**, bukan hook blob/`createObjectURL`.
>   Opsi A **off the table** — tidak ada hook unduh-blob, tidak ada cache blob di
>   memori, tidak ada `revokeObjectURL`.
> - **`products.foto_url` wajib menghasilkan PATH objek.** `createSignedUrl` menerima
>   **path**, bukan URL penuh, jadi `foto_url` harus berupa path objek (disimpan sebagai
>   path) **atau** path harus diturunkan dari URL penuh lama. Ini **syarat** untuk 19.3,
>   bukan catatan opsional — sama seperti pada opsi A.
> - **Signed URL TIDAK menyelesaikan klausa 1.20 / 2.20.** Signed URL bersifat
>   per-token sehingga **tidak** dilayani dari cache publik bersama, tetapi jendela 1.20
>   berlaku pada **URL `/object/public/...` LAMA yang sudah ter-cache** sebelum bucket
>   diprivatkan. Karena itu **Langkah 5b (purge cache atau rotasi nama objek) tetap
>   wajib.** Jangan menyimpulkan bahwa beralih ke signed URL sudah menutup 1.20.
>
> Rujukan keputusan: `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".

**Audit dan migrasi object path.** Menyempitkan policy menjadi `(storage.foldername(name))[1] = get_my_tenant_id()::text` akan mematikan setiap objek yang path-nya belum berada di bawah `/<tenant-id>/`. Objek era migrasi 016 justru **dijamin non-konforman**: policy lamanya mensyaratkan segmen pertama `= 'products'`.

Langkah 1 — audit (read-only, jalankan terhadap **produksi**, karena staging tidak punya data):

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

Langkah 2 — petakan objek non-konforman ke tenant pemiliknya lewat `products.foto_url`, diekspos sebagai view admin-only `product_image_path_audit` di 067:

```sql
SELECT o.name AS object_name, p.tenant_id, p.id AS product_id,
       p.tenant_id::text || '/' || regexp_replace(o.name, '^.*/', '') AS target_name
FROM storage.objects o
JOIN public.products p ON p.foto_url LIKE '%' || o.name
WHERE o.bucket_id = 'products'
  AND (storage.foldername(o.name))[1] IS DISTINCT FROM p.tenant_id::text;
```

Langkah 3 — **pemindahan tidak boleh dilakukan lewat SQL.** `UPDATE storage.objects SET name = ...` hanya mengubah metadata; kunci fisik objek tidak ikut berpindah dan objeknya menjadi tidak terbaca. Pemindahan harus lewat Storage API: skrip Node sekali-jalan (`scripts/migrate-product-image-paths.mjs`) yang memakai **service-role key** untuk (a) membaca `product_image_path_audit`, (b) `storage.from('products').move(oldName, targetName)`, (c) `UPDATE products SET foto_url = <url/path baru>`, dengan log per objek dan sifat dapat-dijalankan-ulang (lewati objek yang sudah konforman). Skrip ini dijalankan **pengguna** karena butuh service-role key yang tidak boleh masuk repo.

Langkah 4 — objek yatim (ada di bucket tetapi tidak dirujuk `products.foto_url` manapun) tidak dapat dipetakan ke tenant. Perlakuan: **jangan dipindahkan, jangan dihapus**; daftarkan dalam laporan verifikasi. Setelah 069 objek-objek itu menjadi tidak terbaca — benar secara keamanan, dan tidak ada gambar sah yang hilang karena tidak ada produk yang merujuknya.

Langkah 5 — barulah 069 diterapkan:

```sql
DROP POLICY IF EXISTS product_images_public_select ON storage.objects;
CREATE POLICY product_images_tenant_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'products'
         AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text);
UPDATE storage.buckets SET public = false WHERE id = 'products';
```

Langkah 5b (**ditambahkan 2026-09-22, hasil eksplorasi task 5**) — **tutup jendela cache CDN.** Setelah `public = false`, objek yang URL publiknya sudah pernah diminta masih dilayani dari cache Cloudflare (`cf-cache-status: HIT`) sampai kedaluwarsa. Pilih satu dan catat pilihannya: (a) purge cache untuk prefix objek bucket `products`, atau (b) **rotasi nama objek** saat pemindahan path di Langkah 3 (tambahkan sufiks acak pada nama berkas) sehingga URL publik lama tidak lagi menunjuk objek mana pun. Opsi (b) lebih disukai karena tidak bergantung pada operasi purge dan menyatu dengan langkah yang memang sudah harus dijalankan. **Catatan 2026-09-22:** keputusan gate 3.1 (opsi B, signed URL) **tidak menghapus kebutuhan langkah ini**. Signed URL per-token memang tidak dilayani dari cache publik bersama, tetapi yang ditutup langkah 5b adalah **URL `/object/public/...` lama** yang sudah masuk cache CDN sebelum privatisasi. Langkah 5b **tetap wajib**.

Langkah 6 — verifikasi: gambar tampil untuk admin dan kasir tenant sendiri (3.9), URL `/object/public/...` mengembalikan 400/404 **diuji dengan cache-buster `?v=<random>`** (tanpa cache-buster, respons 200 dari cache akan salah dibaca sebagai kegagalan privatisasi — atau lebih buruk, 200 yang lolos dianggap benar), dan objek tenant lain ditolak untuk sesi yang sah.

**Jalur cadangan bila pemindahan objek tidak dapat diselesaikan tepat waktu:** tambahkan cabang *grandfather* sementara pada policy — `OR EXISTS (SELECT 1 FROM public.products p WHERE p.tenant_id = public.get_my_tenant_id() AND p.foto_url LIKE '%' || storage.objects.name)`. Ini tetap mencegah akses anonim dan lintas tenant, tetapi menambahkan subquery tanpa dukungan indeks pada setiap pembacaan objek (pola `LIKE '%' || name` tidak dapat memakai indeks). Bila dipakai, catat sebagai utang teknis dengan rencana penghapusan eksplisit, jangan dibiarkan permanen.

## Testing Strategy

### Validation Approach

Dua fase. **Fase 1:** munculkan counterexample pada kode yang BELUM diperbaiki untuk mengonfirmasi atau membantah analisis akar masalah. **Fase 2:** verifikasi fix dan verifikasi bahwa perilaku di luar kondisi bug tidak berubah.

Repo ini punya konvensi uji yang perlu dihormati sekaligus diakui batasnya. Sebagian besar uji yang ada adalah **penjaga teks statis** atas impor `?raw` (`latestHardening.test.ts`, `securityMigration.test.ts`, `operationsReadiness.test.ts`, `finalIntegrationGuards.test.ts`, `storageTenantScope.test.ts`). Pola itu sah dan berguna untuk hal yang tidak dapat dieksekusi di CI, tetapi lemah untuk hal yang bisa dieksekusi. Pembagian yang dipakai rancangan ini:

| Jenis perubahan | Bentuk uji | Alasan |
|---|---|---|
| Fungsi murni: `wrapText`, `formatQty`, `getQtyDecimals`, `getWIBDateKey`/`getWIBToday`/`addWIBDays`, presisi `NumpadModal` | **Uji behavioural**, wajib | Dapat dieksekusi penuh di Vitest; penjaga teks di sini hanya akan menguji ejaan, bukan kebenaran |
| Logika store & hook: `cartStore` (regresi 3.4), `useOnlineStatus` + probe, `runWithTimeout`, rotasi kunci refund | **Uji behavioural**, wajib | Semuanya bisa di-`vi.mock`; sudah ada preseden (`cartStore.test.ts`, `useOnlineStatus.test.ts`, `heldCartStore.test.ts`) |
| Komponen: `AuthProvider` (2.8), `BarcodeScannerModal` (2.10) | **Uji behavioural** dengan `@testing-library/react` | 2.10 khususnya menuntut asersi "kamera tidak restart saat induk re-render" — hanya dapat dibuktikan dengan render ulang nyata + mock `Html5Qrcode` yang mencatat jumlah `start()` |
| Bentuk & semantik SQL migrasi | **Penjaga teks**, konvensi diterima | Tanpa Docker/`psql`, CI tidak punya Postgres. Penjaga teks adalah bukti terkuat yang tersedia di CI |
| Perilaku RLS, hak kolom, penolakan RPC | **Verifikasi manual berskrip** lewat SQL Editor dengan impersonasi `request.jwt.claims` | Tidak dapat diuji di CI; harus dieksekusi dan hasilnya dicatat |
| Paritas informasi struk thermal | **Uji behavioural** atas byte keluaran | `buildReceiptBytes` mengembalikan `Uint8Array` yang dapat di-decode dan diassert; ini titik di mana uji sungguhan jauh mengalahkan penjaga teks |

Yang sengaja **tidak** ditambahkan: uji end-to-end peramban (tidak ada harness-nya di repo, dan biayanya tidak sebanding untuk batch ini) dan snapshot atas `ProductsPage`/`SettingsPage` (komponen 2247/1130 baris, snapshot akan rapuh dan tidak menjelaskan apa pun).

### Exploratory Bug Condition Checking

**Goal:** memunculkan counterexample pada kode BELUM diperbaiki, mengonfirmasi atau membantah hipotesis akar masalah. Bila terbantah, hipotesis harus disusun ulang sebelum menulis fix.

**Test Plan:** untuk klaster yang dapat diuji di Vitest, tulis uji yang gagal dulu terhadap kode sekarang. Untuk klaster SQL, jalankan blok impersonasi di SQL Editor pada staging yang sudah ber-066+067 **tetapi belum 068**, sehingga penolakan yang diharapkan memang belum terjadi.

**Test Cases:**

1. **Kebocoran RPC laporan** — impersonasi kasir, panggil `get_profit_summary` (akan berhasil dan mengembalikan laba pada kode belum diperbaiki).
2. **Kebocoran kolom biaya** — impersonasi kasir, `SELECT harga_beli FROM products LIMIT 1` dan `SELECT harga_beli, laba_kotor FROM transaction_items LIMIT 1` (akan berhasil; ini sekaligus membuktikan temuan baru A.4).
3. **Kebocoran daftar staf** — impersonasi kasir, `SELECT count(*) FROM profiles` (akan > 1).
4. **Akses storage anonim** — `curl` URL `/object/public/products/<tenant>/<file>` tanpa header autentikasi (akan 200). Lalu uji hipotesis "policy saja cukup": terapkan penyempitan policy di staging **tanpa** `public = false` dan ulangi `curl` — bila tetap 200, hipotesis "bucket publik melewati RLS" terkonfirmasi dan langkah privatisasi bucket wajib. **Jika curl menjadi 403 setelah policy saja, hipotesis terbantah** dan opsi A/B pemuatan gambar tidak diperlukan; rancangan storage harus disederhanakan.
5. **Refund tanpa pemanggil** — uji yang menegaskan tidak ada `rpc('refund_transaction_atomic')` di `src/` (akan lolos pada kode sekarang, yaitu membuktikan cacatnya), dipasangkan dengan uji yang menuntut keberadaannya (akan gagal sekarang, lolos setelah fix).
6. **Asimetri leg tunai** — pada staging: buat transaksi tunai, refund, tutup shift, periksa `total_penjualan_tunai` dan `selisih` (akan salah bila 1.13 belum diperbaiki). Ini uji paling penting di klaster B karena menyangkut uang.
7. **Checkout menggantung** — mock `supabase.rpc` dengan promise yang tidak pernah settle, panggil `commitTransaction` (akan menggantung; buktikan bahwa `finally` tidak pernah tereksekusi).
8. **Sesi dilempar ke login** — render `AuthProvider` + `PrivateRoute` dengan `getSession` yang menunda 12 detik dan timer palsu (akan menghasilkan navigasi ke `/login`).
9. **Presisi numpad** — render `NumpadModal` dengan `initialValue={0.25}`, tekan `5`, baca tampilan (akan `0.255`).
10. **Restart kamera** — render `BarcodeScannerModal` di dalam induk yang di-re-render dengan prop callback inline baru, hitung pemanggilan `start()` pada mock `Html5Qrcode` (akan > 1).
11. **`jatuh_tempo` NULL** — pada staging ber-066 saja: penjualan hutang, periksa `receivables.jatuh_tempo` (akan NULL).
12. **Ketidakcocokan batas hari** — jalankan `getDashboardChangeSummary` dengan `TZ=Asia/Makassar` dan bandingkan dengan `get_dashboard_stats` untuk data yang sama di sekitar tengah malam WIB (akan berbeda).
13. **Struk thermal kehilangan informasi** — panggil `buildReceiptBytes` dengan satu item multi-satuan, satu item pecahan, `change: 0`, nama panjang; decode byte (akan menunjukkan "2x" tanpa unit, "0.5x", tanpa baris Kembalian, nama terpotong).

**Expected Counterexamples:**

- Data biaya/laba/staf terkirim ke sesi kasir pada semua permukaan di kasus 1–3.
- Gambar lintas tenant terbaca tanpa autentikasi (kasus 4), dan tetap terbaca meski policy dipersempit — konfirmasi bahwa akar sebenarnya adalah flag bucket publik.
- Refund tidak punya jalur eksekusi apa pun (kasus 5), dan begitu dihidupkan tanpa 1.13, rekonsiliasi shift salah tanda (kasus 6).
- Promise checkout tidak pernah settle sehingga `finally` tidak pernah berjalan (kasus 7) — mengonfirmasi bahwa akarnya deadline, bukan state machine.
- `AuthProvider` merender anak dengan sesi belum resolve (kasus 8).
- Kemungkinan penyebab yang harus terkonfirmasi/terbantah: policy vs flag bucket publik (kasus 4); deadline vs state machine (kasus 7); percabangan timeout vs nilai timeout (kasus 8); identitas callback vs jeda 150 ms pada scanner (kasus 10 — bila `start()` hanya sekali meski induk re-render, hipotesis dependency array terbantah dan penyebabnya harus dicari pada `Modal` yang me-remount anak).

### Fix Checking

**Goal:** verifikasi bahwa untuk semua input di mana kondisi bug berlaku, fungsi yang sudah diperbaiki menghasilkan perilaku yang diharapkan.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedSystem(input)
  ASSERT expectedBehavior(result)
END FOR
```

Diturunkan per klaster:

```
FOR ALL caller WHERE NOT callerIsAdmin(caller) DO
  FOR ALL fn IN [get_profit_summary, get_top_products, get_sales_by_date, get_dashboard_stats] DO
    ASSERT raisesAuthorizationError(fn, caller)
  FOR ALL col IN COST_COLUMNS DO
    ASSERT raisesPrivilegeError(read(col), caller)
  ASSERT rowCount(read(profiles), caller) = 1

FOR ALL trx WHERE status(trx)='selesai' AND paymentStatus(trx)='dibayar' DO
  r := refund(trx, alasan, key)
  ASSERT stockRestored(trx) AND refundRowWritten(trx) AND status(trx)='batal'
  ASSERT refund(trx, alasan, key) = r                       -- idempoten
  ASSERT closeShift(shiftOf(r)).selisih = physicalCash - expectedSystemCash

FOR ALL qty, satuan WHERE unitAllowsFraction(satuan) DO
  ASSERT numpadAccepts(qty) IFF decimals(qty) <= getQtyDecimals(satuan)
  ASSERT numpadMax(line) = remainingSaleUnitStock(line)

FOR ALL creditSale DO
  ASSERT receivableOf(creditSale).jatuh_tempo
       = wibDate(creditSale.paid_at) + tempoHutangHari(tenant)

FOR ALL deviceTimezone DO
  ASSERT clientDayBoundary(deviceTimezone) = serverDayBoundary('Asia/Jakarta')

FOR ALL receipt DO
  ASSERT thermalInformation(receipt) SUPERSET_OF browserInformation(receipt)
```

### Preservation Checking

**Goal:** verifikasi bahwa untuk semua input di mana kondisi bug TIDAK berlaku, sistem yang sudah diperbaiki menghasilkan hasil yang sama dengan sistem sebelum perbaikan.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalSystem(input) = fixedSystem(input)
END FOR
```

**Testing Approach:** property-based testing direkomendasikan untuk preservation checking karena:

- ia membangkitkan banyak kasus otomatis di seluruh domain input;
- ia menangkap kasus tepi yang mudah terlewat oleh unit test manual;
- ia memberi jaminan kuat bahwa perilaku tidak berubah untuk **semua** input non-buggy — dan di batch ini domain non-buggy-nya besar: seluruh qty bilangan bulat, seluruh kombinasi keranjang, seluruh shift tanpa refund.

Di repo ini belum ada pustaka PBT. Bila ditambahkan, `fast-check` adalah pilihan yang wajar untuk `cartStore` dan helper tanggal. Bila tidak ditambahkan, gantinya adalah uji tabel dengan domain yang ditata rapat (bukan satu-dua contoh), dan keputusan itu harus dicatat eksplisit, bukan dibiarkan implisit.

**Test Plan:** amati perilaku pada kode BELUM diperbaiki untuk input non-buggy, rekam sebagai ekspektasi, lalu pastikan ekspektasi itu tetap terpenuhi setelah fix.

**Test Cases:**

1. **Katalog POS kasir** — amati bahwa `products_with_category` sekarang mengembalikan set kolom yang dipakai POS, catat daftarnya, lalu pastikan set itu identik setelah `harga_beli` dihapus (hanya `harga_beli` yang hilang, tidak satu pun kolom lain).
2. **Laporan admin** — rekam hasil keempat RPC laporan untuk rentang tetap sebelum penggerbangan, lalu bandingkan baris-per-baris setelahnya sebagai admin.
3. **Qty bulat** — untuk qty 1..999 pada satuan diskret, rekam `subtotal`, `diskon_item_persen`, dan penolakan stok agregat dari `cartStore` sekarang, lalu pastikan identik setelah numpad mendukung desimal (properti paling berisiko regresi di klaster D).
4. **Rekonsiliasi shift tanpa refund** — rekam `total_penjualan_tunai`, `total_penjualan_non_tunai`, `selisih` untuk shift tanpa refund sebelum 067, lalu pastikan identik sesudahnya. **Catatan 2026-09-22:** setelah 2.13 dibatalkan, 067 **tidak menyentuh `close_cash_shift`** sama sekali, jadi ekspektasi "identik" berlaku untuk **seluruh** shift — dengan maupun tanpa refund — bukan hanya shift tanpa refund. Baseline pembandingnya: keempat shift uji dengan `selisih = 0` di `verification-notes.md` → "Task 5 … Kasus 6".
5. **Idempotensi checkout & cicilan** — rekam perilaku percobaan ulang identik (struk recovery) dan percobaan payload berbeda (kunci dirotasi) sebelum timeout dipasang, lalu pastikan identik sesudahnya.
6. **Jalur offline** — rekam bahwa `navigator.onLine = false` menonaktifkan checkout dan menyajikan katalog cache, lalu pastikan probe reachability tidak mengubahnya.
7. **Batas rentang laporan** — rekam keluaran `getISOStartOfDay`/`getISOExclusiveEndOfDay` untuk kumpulan tanggal termasuk pergantian bulan dan tahun kabisat, pastikan tidak berubah oleh helper WIB baru.
8. **Struk browser** — rekam bahwa `ReceiptPrint` merekonsiliasi baris item dengan subtotal setelah diskon, pastikan tidak tersentuh perubahan escpos.
9. **Perilaku sesi** — rekam bahwa kegagalan ambil profil mempertahankan sesi dan cache offline, logout membersihkan data meski `signOut` gagal, dan StrictMode tidak mendaftarkan dua listener; pastikan `reinitialize()` tidak melanggar salah satu pun.
10. **Gambar tenant sendiri** — rekam bahwa gambar dengan path konforman tampil, pastikan tetap tampil setelah 069 dan setelah peralihan pemuatan gambar.

### Unit Tests

- `escpos`: `wrapText` (kata lebih panjang dari lebar, batas tepat, beberapa spasi), `formatQty` (`2`, `0.5`, `0.25`, `0.125`, `1000.5`), `buildReceiptBytes` (unit tercetak, harga satuan tercetak, diskon baris tercetak, `Bayar`/`Kembalian` saat 0, nama panjang ter-wrap, lebar 32 vs 48 kolom, pelanggan & catatan diteruskan).
- `units`: `getQtyDecimals` untuk setiap nilai `SatuanType`, plus penegasan `MAX_QTY_DECIMALS = 3` yang terikat ke `NUMERIC(12,3)`.
- `date`: `getWIBDateKey`/`getWIBToday`/`addWIBDays` dengan `process.env.TZ` di-set ke `UTC`, `Asia/Jakarta`, `Asia/Makassar`, dan `America/New_York`; plus regresi `getISOStartOfDay`/`getISOExclusiveEndOfDay` (3.8).
- `NumpadModal`: tombol koma hanya muncul saat `decimalPlaces > 0`; digit ditolak setelah presisi penuh; separator kedua ditolak; `initialValue` pecahan dinormalisasi; `maxValue`/`minValue` ditegakkan pada konfirmasi; jalur bilangan bulat tidak berubah.
- `fetchWithTimeout`: `runWithTimeout` menolak dengan `RequestTimeoutError` tepat waktu; `AbortSignal` pemanggil tetap dihormati; promise yang settle sebelum deadline tidak terpengaruh.
- `useOnlineStatus`: `navigator.onLine=false` → offline tanpa probe; `onLine=true` + probe gagal → offline; probe berhasil → online; tidak ada probe saat tab tersembunyi; `revalidate()` memicu probe segera.
- `AuthProvider`: sesi resolve cepat → anak dirender; timeout dengan sesi belum resolve → layar kegagalan + tombol coba lagi, **bukan** navigasi ke `/login`; retry memanggil ulang inisialisasi tanpa menambah listener.
- `refundTransaction`: alasan kosong ditolak lokal; kunci kosong ditolak lokal; payload RPC memakai nama parameter yang benar (`p_transaction_id`, `p_alasan`, `p_idempotency_key`).
- Rotasi kunci refund: kunci bertahan lintas close/reopen; kunci dirotasi saat alasan berubah setelah kegagalan; kunci dibuang hanya saat sukses.

### Property-Based Tests

- `cartStore` (preservation 3.4): untuk keranjang acak berisi beberapa baris satuan dari produk yang sama, invarian `Σ(qty × rasio) ≤ stok_dasar` selalu ditegakkan, dan `updateQty` dengan qty bulat memberi hasil identik dengan implementasi sekarang.
- Presisi qty: untuk `qty` acak dengan sampai 4 desimal, `numpadAccepts(qty) ⟺ decimals(qty) ≤ getQtyDecimals(satuan)`, dan nilai yang diterima selalu `≤ maxValue` serta `≥ minValue`.
- Batas hari WIB: untuk tanggal acak dan timezone perangkat acak, `getWIBDateKey` menghasilkan nilai identik — properti yang tepat menangkap akar 1.12.
- Pembulatan rupiah bulat (paritas klien–server): untuk daftar harga/qty/diskon/PPN acak, total yang dihitung `cartStore` (`Math.round` per tahap) sama dengan total yang dihitung `create_transaction_atomic` (`ROUND(..., 0)` per tahap). Kedua implementasi membulatkan dalam urutan yang sama (per baris → diskon transaksi → PPN) dan untuk nilai positif `Math.round` serta `ROUND` numeric Postgres sepakat pada kasus setengah, jadi properti ini harus menghasilkan kesamaan eksak — ini justifikasi terkuat untuk klaim 2.17.
- Wrap struk: untuk nama produk acak dan lebar 32/48, setiap baris keluaran `wrapText` ≤ lebar dan penggabungan seluruh baris memuat setiap karakter non-spasi dari input (tidak ada informasi yang hilang — inti 2.15).

### Integration Tests

- Alur refund ujung-ke-ujung di staging: checkout tunai → tutup? belum → refund dari ReportsPage → periksa stok pulih, `transaction_refunds` terisi dengan `payment_method='tunai'` dan `cash_shift_id` benar, transaksi `batal` → tutup shift → `selisih` nol terhadap uang fisik yang benar.
- Refund transaksi hutang: piutang menjadi `dibatalkan`, `customers.total_hutang` berkurang, dan refund atas piutang yang sudah dicicil ditolak.
- Penjualan hutang ujung-ke-ujung: ubah `tempo_hutang_hari` menjadi 7 di Pengaturan → checkout hutang → `receivables.jatuh_tempo` = tanggal WIB + 7 → badge dan penanda terlewat tampil benar di CustomersPage.
- Peralihan peran: login admin → semua halaman dan kolom biaya tersedia; login kasir → `/dashboard`, `/laporan`, `/produk` tidak dapat diakses tanpa redirect loop, katalog POS lengkap, checkout tunai + cetak struk berhasil, struk transaksi lama dapat dibuka ulang.
- Recovery jaringan: blokir host Supabase di devtools → checkout gagal dalam batas waktu → buka blokir → "Coba Lagi" dengan kunci sama → server mengembalikan struk recovery, bukan transaksi kedua.
- Paritas struk: satu nota berisi baris multi-satuan + baris pecahan + diskon baris + pelanggan + catatan + kembalian 0, dicetak ke thermal dan ke browser; bandingkan kelengkapan informasinya.
- Gambar produk setelah 069: admin dan kasir tenant sendiri melihat gambar; URL publik langsung gagal; objek tenant lain ditolak.

### Daftar Uji Asap Runtime (2.17)

Wajib dijalankan di peramban terhadap database yang sudah bermigrasi 066 (+067), hasilnya dicatat (tanggal, penguji, nomor nota, screenshot/nilai yang teramati).

**S1. Checkout tunai dengan PPN aktif, pembulatan rupiah bulat**

1. Pengaturan → PPN aktif, `ppn_persen = 11`.
2. Buka shift kasir.
3. Keranjang: 1 × produk berharga Rp 1.235 (harga yang dipilih agar PPN menghasilkan pecahan: 11% × 1.235 = 135,85).
4. Amati kutipan kasir: Subtotal Rp 1.235, PPN Rp 136, Total Rp 1.371 — ketiganya **bilangan bulat, tanpa desimal**.
5. Pilih "Uang Pas" Rp 1.371 → checkout **harus diterima** (sebelum 066 total server dapat berbeda tipis sehingga uang pas ditolak).
6. Verifikasi `transactions`: `subtotal=1235`, `ppn_amount=136`, `total=1371`, `kembalian=0` — semuanya tanpa sisa sen.
7. Struk browser dan struk thermal menampilkan angka yang sama persis, dan baris "Kembalian Rp 0" **tercetak** di keduanya.
8. Ulangi dengan bayar Rp 2.000 → kembalian Rp 629 di UI, DB, dan kedua struk.
9. Tutup shift dengan uang fisik = modal awal + 1.371 + 2.000 − 629 → `selisih` harus 0.

**S2. `authStore` saat pengambilan profil gagal**

1. Login sebagai kasir, biarkan katalog ter-cache (POSPage terbuka, lalu offline-kan sebentar untuk memastikan cache terpakai).
2. DevTools → Network request blocking → blokir pola `*/rest/v1/profiles*`.
3. Picu event auth: refresh token (tunggu, atau `supabase.auth.refreshSession()` dari console) atau pindah tab lalu kembali.
4. Verifikasi: sesi **bertahan** (tidak dilempar ke `/login`), **tidak** diarahkan ke `/register` (`needsOnboarding` tetap false), cache katalog IndexedDB **tidak terhapus**, pesanan parkir **tidak terhapus**, keranjang aktif **tidak terhapus**, dan pesan error muncul tanpa tindakan destruktif.
5. Buka blokir, picu event auth lagi → profil ter-resolve, `error` bersih.
6. Logout → seluruh data lokal tenant bersih (kebalikan dari langkah 4, memastikan pembersihan yang benar tetap bekerja).

**S3. Asap kasir setelah 068 diterapkan** (titik paling berisiko dalam batch)

1. Login kasir → landing di `/pos` tanpa redirect loop.
2. Katalog memuat penuh; kartu produk menampilkan harga jual, stok, dan gambar.
3. Tambah item, ubah qty lewat numpad (bulat dan pecahan), checkout tunai berhasil.
4. Buka struk transaksi lama dari riwayat kasir (bila tersedia di UI kasir) → tidak ada error hak akses.
5. Coba buka `/laporan`, `/produk`, `/dashboard` secara manual → diarahkan ke `/pos`, tanpa loop.
6. Console peramban bersih dari error 42501 (permission denied) dan 403.

**S4. Asap admin setelah 068**

1. Halaman Produk: kolom Harga Beli dan Margin% terisi, sorting `harga_beli` berfungsi, ekspor XLSX memuat Harga Beli.
2. Halaman Laporan: kartu Omzet (akrual) dan Kas diterima terisi dan berbeda bila ada penjualan hutang; kolom Laba per transaksi terisi; keempat RPC laporan berhasil.
3. Dashboard: kartu penjualan hari ini dan "% vs kemarin" konsisten satu sama lain pada perangkat ber-timezone non-WIB.
4. Pengaturan: `tempo_hutang_hari` dapat disimpan dan terbaca ulang.

## Iteration and Feedback Rules

Bila ada butir rancangan yang perlu diubah, perubahan dilakukan pada dokumen ini lebih dulu sebelum implementasi dimulai. Dua butir yang memerlukan keputusan pemilik sebelum implementasi klaster terkait — **keduanya sudah diputuskan pemilik pada 2026-09-22, jadi keduanya tidak lagi memblokir**:

1. **Pemuatan gambar produk setelah bucket diprivatkan** — opsi A (blob authenticated, sesuai keputusan tertulis) atau opsi B (signed URL TTL pendek, jauh lebih murah). **DIPUTUSKAN: opsi B.** Rancangan tidak lagi mengasumsikan A. Rincian, alasan penyimpangan dari keputusan produk nomor 3, dan konsekuensinya untuk task 19.3 serta `products.foto_url`: [Migrasi Kebijakan Storage](#migrasi-kebijakan-storage-162639).
2. **Backfill `receivables.jatuh_tempo`** untuk piutang lama — dilakukan (mengubah tampilan aging historis) atau dibiarkan NULL. **DIPUTUSKAN: biarkan NULL, tidak ada backfill**; blok backfill **tidak ditulis** di 067. Alasan yang menentukan: tidak ada data produksi sama sekali, jadi tidak ada piutang lama untuk dibackfill.

Satu butir ketiga yang bukan gate terjadwal tetapi ikut diputuskan pada tanggal yang sama:

3. **Resolusi klausa 2.13 / task 6.2** setelah pembantahan empiris task 5 — **DIPUTUSKAN: 2.13 DIBATALKAN**, `close_cash_shift` dibiarkan apa adanya, 067 tidak menyentuhnya, syarat "satu migrasi dengan pengaktifan refund" larut, dan Property 11 dirumuskan ulang. Lihat [B.4](#b-klaster-refund-11-12-113--21-22-213).

Ketiga keputusan tercatat terpusat di `verification-notes.md` → "Gate keputusan 3.1, 3.2, dan resolusi 2.13".

Bila salah satu *exploratory check* membantah hipotesisnya (khususnya kasus 4 tentang bucket publik, kasus 7 tentang deadline, dan kasus 10 tentang identitas callback), akar masalahnya harus dihipotesiskan ulang dan bagian [Hypothesized Root Cause](#hypothesized-root-cause) diperbarui sebelum fix ditulis.
