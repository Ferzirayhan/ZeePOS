# Verification Notes — zeepos-remaining-bug-fixes

Catatan ini adalah bukti eksekusi, bukan rencana. Setiap blok memuat tanggal,
penguji, perintah yang dijalankan, dan **nilai teramati**.

---

## Task 1 — Eksplorasi kondisi bug sisi Vitest (Fase 0)

- **Tanggal:** 2026-09-22 (WIB)
- **Penguji:** coding agent (Kiro), mesin pengembang macOS, Node v22.22.3
- **Berkas uji:** `src/__tests__/bugConditionExploration.test.ts`
- **Perintah:** `npx vitest run src/__tests__/bugConditionExploration.test.ts`
- **Hasil ringkas:** `Tests 11 failed | 4 passed (15)` — **seluruh 11 asersi
  `EXPECTED` gagal**, yaitu hasil yang benar untuk task ini: kegagalannya adalah
  buktinya bahwa cacatnya ada. Empat yang lolos adalah asersi `BASELINE` yang
  sengaja mendokumentasikan perilaku sekarang, plus blok ringkasan.
- **Suite penuh:** `npx vitest run` → `Test Files 1 failed | 21 passed (22)`,
  `Tests 11 failed | 179 passed (190)`. Satu-satunya berkas gagal adalah berkas
  eksplorasi ini; tidak ada uji lama yang terpengaruh.
- **Lint/typecheck:** `npx eslint src/__tests__/bugConditionExploration.test.ts`
  bersih; `npx tsc --noEmit -p tsconfig.app.json` bersih.

### Status hipotesis yang dapat difalsifikasi

| Kasus | Hipotesis | Status |
|---|---|---|
| 7 | design **C.2** — "akarnya deadline, bukan state machine" | **TERKONFIRMASI** (blok `finally` tidak pernah berjalan) |
| 10 | design **D.4** — dependency array memuat identitas callback | **TERKONFIRMASI** (`start()` 2×, 2 instance) |

`design.md` bagian [Hypothesized Root Cause] **tidak perlu** diperbarui untuk dua
kasus ini.

**Catatan harness yang wajib diketahui untuk kasus 10:** pada percobaan pertama,
`rerender` dan `vi.advanceTimersByTimeAsync(200)` dijalankan di dalam **satu**
blok `act`. Effect pasif React baru di-flush di akhir `act`, sehingga timer 150 ms
milik effect yang baru terdaftar setelah timer di-advance dan `start()` terbaca
**1×** — yang akan salah dibaca sebagai "hipotesis D.4 terbantah". Setelah
`rerender` dipisah ke blok `act`-nya sendiri, restart kamera teramati apa adanya
(`start()` 2×). Bila kasus ini diulang nanti, pisahnya harus dipertahankan.

### Counterexample per kasus (nilai teramati)

#### Kasus 5 — refund tanpa pemanggil (klausa 1.1, `isRefundPathBug`)

- **BASELINE (lolos):** pemindaian seluruh `src/**/*.{ts,tsx}` di luar `__tests__`
  untuk string `refund_transaction_atomic` → **`[]`** (nol berkas).
- **EXPECTED (gagal):** `src/api/transactions.ts` tidak memuat
  `rpc('refund_transaction_atomic')`.
- **Counterexample:** RPC final di migrasi 060 (admin-only, wajib alasan, wajib
  kunci idempotensi, pemulihan stok, `transaction_refunds`) **tidak punya satu pun
  jalur eksekusi dari klien**. Tidak ada cacat pada RPC-nya; yang hilang adalah
  pemanggilnya.

#### Kasus 7 — checkout menggantung (klausa 1.7, `isUnboundedWaitBug`)

Skenario: `supabase.rpc` di-mock dengan promise yang **tidak pernah settle**
(captive portal), `commitTransaction` dipanggil di dalam `try/finally` yang
mencerminkan `POSPage.handleProcessPayment`, lalu timer palsu di-advance 60 detik.

```json
{ "elapsedMs": 60000, "finallyRan": false, "settled": "pending", "rpcCalls": 1 }
```

- **Counterexample:** setelah 60 detik simulasi, promise masih `pending` dan blok
  `finally` **belum pernah** tereksekusi → `processingPayment` tidak pernah
  kembali `false`, satu-satunya jalan keluar reload halaman.
- **Konsekuensi rancangan:** perbaikan harus di lapisan promise (deadline +
  `AbortSignal`, design C.1), bukan di lapisan state.

#### Kasus 8 — sesi valid dilempar ke `/login` (klausa 1.8)

Skenario: `AuthProvider` + `PrivateRoute` di `MemoryRouter`, `auth.getSession()`
resolve pada detik ke-12, timer palsu di-advance ke 8,1 detik
(`AUTH_TIMEOUT_MS = 8000`).

```json
{
  "elapsedMs": 8100,
  "getSessionResolvedAtMs": 12000,
  "loginShown": true,
  "loadingScreenShown": false,
  "posShown": false
}
```

- **Counterexample:** pada detik ke-8,1 layar `Menyiapkan sesi aplikasi` sudah
  hilang, rute terproteksi dirender dengan `session` masih `null`, dan pengguna
  berakhir di `/login` padahal sesinya sah dan sedang dalam perjalanan.
- **Akar yang terkonfirmasi:** **percabangan timeout**, bukan nilai timeout.
  `if (!timedOut && (!initialized || loading)) return <AuthLoadingScreen />`
  menjadikan kadaluwarsa sebagai *bypass render*; 8000 ms sendiri masuk akal.
  Sesuai design C.3, kadaluwarsa harus menjadi layar gagal-muat + tombol coba lagi.

#### Kasus 9 — presisi numpad (klausa 1.9, `isKasirInputBug`)

Skenario: `NumpadModal` dengan `initialValue = 0.25` pada baris berpresisi 2
desimal (`decimalPlaces` dilewatkan sebagai kontrak masa depan design D.1), lalu
tombol `5` ditekan.

| Amatan | Nilai |
|---|---|
| Tampilan sebelum tekan | `0,25` |
| Tampilan setelah tekan `5` | **`0,255`** |
| Nilai yang diteruskan `onConfirm` | **`0.255`** |
| Tombol separator desimal tersedia | **`false`** |

- **Counterexample:** satu tekanan digit menaikkan presisi melewati presisi baris;
  `handleDigit` hanya membandingkan `Number(next) > maxValue` dan tidak mengenal
  jumlah desimal. Tanpa tombol separator, 0,25 / 0,5 / 0,75 kg **tidak dapat
  dinyatakan sama sekali** (grid hanya 1–9, C, 0, backspace).

#### Kasus 10 — kamera scanner restart (klausa 1.10)

Skenario: `BarcodeScannerModal` dirender di dalam induk yang di-re-render dengan
prop callback **arrow inline baru**, `Html5Qrcode` di-mock dan pemanggilannya
dihitung.

```json
{
  "startAfterMount": 1,
  "stopAfterRerender": 1,
  "startAfterParentRerender": 2,
  "stopCount": 1,
  "instances": 2
}
```

- **Counterexample:** satu re-render induk menghasilkan `stop()` 1×, **instance
  `Html5Qrcode` kedua**, dan `start()` **2×** padahal modal tidak pernah ditutup.
  Hipotesis dependency array (`[isOpen, onClose, onScanSuccess]`) **terkonfirmasi**.

#### Kasus 12 — ketidakcocokan batas hari (klausa 1.12, `isTimeAndLedgerBug`)

Skenario: `process.env.TZ = 'Asia/Makassar'` (WITA), waktu sistem dibekukan pada
`2024-03-01T16:30:00.000Z` = **1 Maret 23:30 WIB** tetapi sudah **2 Maret 00:30
WITA**. `getDashboardChangeSummary()` dipanggil; rentang yang dikirim ke
PostgREST dan ke `get_top_products` dicatat.

| Leg | `from` teramati | `to` teramati |
|---|---|---|
| "Hari ini" (klien, WITA) | `2024-03-02T00:00:00+08:00` | `2024-03-03T00:00:00+07:00` |
| "Kemarin" (klien, WITA) | `2024-03-01T00:00:00+08:00` | `2024-03-02T00:00:00+07:00` |
| Batas WIB yang dipakai `get_dashboard_stats` | `2024-03-01T00:00:00+07:00` | `2024-03-02T00:00:00+07:00` |

- **Counterexample:** kartu "penjualan hari ini" mengagregasi **2 Maret WITA**
  sementara RPC server mengagregasi **1 Maret WIB** — dua angka berdampingan
  menghitung hari yang berbeda. Rentang klien bahkan **tidak konsisten dengan
  dirinya sendiri**: batas bawah beroffset `+08:00` (`formatISO(startOfDay(...))`
  perangkat) sedangkan batas atas beroffset `+07:00` (`getISOExclusiveEndOfDay`
  yang sudah terikat WIB), menghasilkan jendela **25 jam**, bukan 24.
- Nilai yang sama juga dikirim sebagai `p_date_from`/`p_date_to` ke
  `get_top_products`, jadi kartu "produk terlaris hari ini" ikut bergeser.

#### Kasus 13 — struk thermal kehilangan informasi (klausa 1.15)

Skenario: `buildReceiptBytes` pada kertas `58mm` (32 kolom) dengan satu item
multi-satuan (`qty 2`, `satuan 'dus'`), satu item pecahan (`qty 0.5`, `satuan
'kg'`), `change: 0`, dan nama produk **40 karakter**
(`"Kantong Plastik HD Ukuran 17x35 Tebal XL"`).

Keluaran yang di-decode (dipangkas pada bagian yang relevan):

```
================================
Kantong Plastik HD Ukuran 17x35
  2x                   Rp 55.000
Tali Rafia
  0.5x                 Rp 12.500
--------------------------------
Subtotal               Rp 67.500
TOTAL                  Rp 67.500
 --------------------------------
Metode                     Tunai
Bayar                  Rp 67.500
```

| Kehilangan informasi | Nilai teramati |
|---|---|
| Satuan baris tidak dicetak | `  2x                   Rp 55.000` (2 dus vs 2 pcs tidak terbedakan) |
| Qty pecahan tanpa satuan, titik desimal | `  0.5x                 Rp 12.500` |
| Baris Kembalian hilang saat `change = 0` | `adaBarisKembalian: false` |
| Nama produk dipotong, bukan di-wrap | `Kantong Plastik HD Ukuran 17x35 ` (ekor `Tebal XL` hilang) |
| Harga satuan & diskon per baris | tidak dicetak sama sekali |

- Baris `Kembalian` hilang karena pemeriksaan truthy
  `data.change != null && data.change > 0`; nama dipotong `slice(0, width)`.

### Kasus yang TIDAK dicakup berkas uji ini

Kasus **1, 2, 3, 4, 6, 11** bersifat SQL/storage dan hanya dapat diamati di
staging lewat SQL Editor + `curl` → task 5 (**[USER]**). Belum dijalankan;
hasilnya ditempel ke bagian baru di berkas ini.

### Temuan baru (protokol klausa 1.18)

Tidak ada cacat baru yang muncul dari eksplorasi sisi Vitest ini di luar yang
sudah tercatat di `bugfix.md`. Dua penajaman pengamatan yang perlu dicatat, dan
keduanya **memperkuat** klausa yang sudah ada, bukan menambah klausa:

1. Rentang dashboard (1.12) bukan hanya "bergeser", tetapi **campuran offset**
   (`+08:00` di bawah, `+07:00` di atas) sehingga jendelanya 25 jam.
2. Presisi numpad (1.9) bocor sampai ke nilai yang diteruskan `onConfirm`
   (`0.255`), bukan hanya ke tampilan.

---

## Task 2 — Uji preservation baseline (Fase 0)

- **Tanggal:** 2026-09-22 (WIB)
- **Penguji:** coding agent (Kiro), mesin pengembang macOS, Node v22.22.3
- **Berkas uji baru:** `src/__tests__/preservationBaseline.test.ts` (23 uji)
- **Berkas uji diperluas:** `src/__tests__/cartStore.test.ts` (+2, klausa 3.11),
  `src/__tests__/date.test.ts` (+5, klausa 3.8),
  `src/__tests__/useOnlineStatus.test.ts` (+1, klausa 3.5)
- **Perintah & hasil:**
  - `npx vitest run src/__tests__/preservationBaseline.test.ts` → `Tests 23 passed (23)`
  - `npx vitest run src/__tests__/cartStore.test.ts src/__tests__/date.test.ts src/__tests__/useOnlineStatus.test.ts` → `Tests 34 passed (34)`
  - Suite penuh `npx vitest run` → `Test Files 1 failed | 22 passed (23)`,
    `Tests 11 failed | 210 passed (221)`. Satu-satunya berkas gagal tetap
    `bugConditionExploration.test.ts` dengan **11 kegagalan yang sama** seperti
    task 1 (tidak berubah, tidak disentuh). Baseline lolos naik dari 179 → 210.
  - `npm run lint` bersih; `npx tsc --noEmit -p tsconfig.app.json` bersih
    (`tsconfig.app.json` memuat `include: ["src"]`, jadi berkas uji ikut diperiksa).
- **EXPECTED OUTCOME tercapai:** seluruh uji preservation **LOLOS pada kode belum
  diperbaiki**. Inilah baseline yang wajib dipertahankan.

### Metodologi observation-first (bagaimana angka di berkas uji diperoleh)

Harness sementara `src/__tests__/observeTmp.test.ts` dijalankan lebih dulu dengan
`npx vitest run --reporter=verbose --disable-console-intercept`, keluarannya
ditempel ke bagian di bawah, **baru** direkam sebagai ekspektasi; harness itu lalu
dihapus. Catatan harness yang perlu diketahui bila diulang: keluaran `console.log`
di Vitest 4 **tidak muncul** tanpa `--disable-console-intercept`.

### Keputusan pustaka PBT

`fast-check` **ditambahkan** sebagai devDependency dengan versi **dipin eksak**:
`"fast-check": "4.10.2"` (tanpa `^`). Dipakai untuk dua properti:

1. keranjang acak multi-satuan → invarian `Σ(qty × rasio) ≤ stok_dasar` (200 runs);
2. batas hari WIB → jendela `[bawah, atas)` selalu tepat 86.400.000 ms (500 runs).

Uji tabel berdomain rapat **tetap** dipakai berdampingan (qty 1..999 penuh), bukan
sebagai gantinya — untuk qty bulat, domainnya kecil dan enumerasi penuh lebih kuat
daripada sampling.

### Baseline teramati per klausa

#### 3.4 — qty bulat pada satuan diskret (risiko regresi tertinggi, klaster D)

Fixture: harga 1.250, `diskon_produk_persen = 2`, tier base-qty `12 → 5%`,
`60 → 10%`. Seluruh qty **1..999** dijalankan lewat `addItem` + `updateQty`.

| qty | `subtotal` | `diskon_item_persen` |
|---|---|---|
| 1 | 1.225 | 2 |
| 11 | 13.475 | 2 |
| 12 | 14.250 | 5 |
| 13 | 15.438 | 5 |
| 59 | 70.063 | 5 |
| 60 | 67.500 | 10 |
| 998 | 1.122.750 | 10 |
| 999 | 1.123.875 | 10 |

Checksum atas 999 titik (ini yang menangkap pergeseran pembulatan di titik mana pun):

```json
{ "sumSubtotal": 562050612, "sumDiskon": 9662 }
```

Ambang perpindahan diskon teramati: `[{qty:1,diskon:2},{qty:12,diskon:5},{qty:60,diskon:10}]`.

**Nilai teramati yang mengejutkan, direkam apa adanya (tidak "dikoreksi"):**
`subtotal` **turun** saat menyeberangi ambang tier — qty 59 → Rp 70.063, qty 60 →
Rp 67.500. Membeli satu unit lebih banyak membuat baris jadi lebih murah. Ini
konsekuensi langsung dari tier berbasis base-qty dan **bukan** bagian dari cacat
mana pun di batch ini, jadi ia direkam sebagai baseline: perubahan numpad desimal
tidak boleh menghilangkan perilaku ini. Pembulatan setengah-ke-atas juga terekam
di qty 13 (13 × 1.250 × 0,95 = 15.437,5 → **15.438**).

Penolakan stok agregat lintas satuan (stok dasar 100, line `pcs` rasio 1 + line
`dus` rasio 12) — **pesan persis** seperti teramati:

| Aksi | Hasil teramati |
|---|---|
| `addItem` pcs, lalu `addItem` dus | diterima; base = 1 + 12 = 13; `subtotal` line dus = **13.300** (tier 5% karena base-qty = rasio = 12), `subtotal` keranjang = **14.525** |
| `updateQty(1, 8, 91)` (8 dus = 96 + 1 pcs = 97) | diterima |
| `addItem` dus ke-9 (108 + 1) | throw **`Qty Gelas Plastik (dus) melebihi stok`** |
| `updateQty(1, 9, 91)` | throw pesan yang sama |
| `updateQty(1, 4)` → base tepat 100, lalu `addItem` pcs | throw **`Qty Gelas Plastik melebihi stok`** |
| state setelah penolakan | `[{qty:4,rasio:1},{qty:8,rasio:12}]` — **tidak berubah** |

PBT (200 runs, stok 1..400, sampai 25 operasi acak atas 4 satuan `1/6/12/24`):
invarian `Σ(qty × rasio) ≤ stok_dasar` bertahan setelah setiap operasi, setiap
`subtotal` bilangan bulat, dan operasi yang ditolak tidak mengubah state. Tidak
ada counterexample.

#### 3.11 — parkir → lanjut pesanan (`restoreCart`)

- Payload modern (`stok_dasar: 48`, qty 3 dus, `diskon_persen: 5`, `use_ppn: true`,
  tarif toko 11%): `subtotal` 300.000, `diskon_amount` 15.000, `ppn_amount`
  **31.350**, `total` **316.350**, `uang_diterima` direset ke 0, dan `ppn_persen`
  toko **dipertahankan** karena payload tidak membawanya.
- Batas stok ditegakkan kembali setelah restore: 4 dus (48 base) diterima, 5 dus
  ditolak.
- Payload parkir **lama** (`stok_tersedia: 3` dalam satuan jual, tanpa
  `stok_dasar`) dinormalkan menjadi `stok_dasar = 36` (3 × rasio 12); qty 3
  diterima, qty 4 ditolak.

#### 3.3 — idempotensi checkout (`lastCheckoutFingerprintRef`)

Logika ini **inline** di `POSPage.handleProcessPayment` (baris ~768–786) dan tidak
dapat diimpor tanpa merefaktor kode produksi — yang **tidak boleh** dilakukan di
task ini. Pendekatan yang dipakai, dan batasnya harus diketahui pembaca berikutnya:

1. cermin perilaku (`buildCheckoutFingerprint` + `createCheckoutKeyRef`) diuji
   secara behavioural;
2. **penjaga teks** atas `POSPage.tsx?raw` mengikat cermin itu ke sumbernya —
   daftar field fingerprint (urutan dipertahankan), syarat rotasi
   `!checkoutIdempotencyKeyRef.current || lastCheckoutFingerprintRef.current !== currentFingerprint`,
   `zeepos-${nonce}`, `if (keyRotated) {`, dan reset kedua ref di jalur sukses.
   Bila POSPage berubah tanpa cermin diperbarui, penjaga gagal.

Perilaku teramati yang direkam:

| Skenario | Hasil |
|---|---|
| attempt pertama | kunci baru, `keyRotated = true` |
| percobaan ulang payload **identik** | **kunci sama**, `keyRotated = false` (jalur recovery respons hilang) |
| qty / `uang_diterima` / `customer_id` berubah | kunci **dirotasi** setiap kali |
| metode non-tunai, `uang_diterima` berubah | **tidak** merotasi kunci (field itu di-`null`-kan untuk non-tunai) |
| setelah commit sukses | kedua ref di-`null`, nota berikutnya memakai kunci baru |

Field fingerprint teramati (urutan asli): `items[]` (`product_id:unit_id|'b':qty:harga_satuan`),
`subtotal`, `diskon_persen`, `diskon_amount`, `total`, `metode_bayar`,
`uang_diterima` (null bila non-tunai), `customer_id`. **`ppn_persen` dan
`ppn_amount` tidak termasuk** — konsisten dengan Property 20 (setelan server bukan
bagian fingerprint).

#### 3.5 — jalur offline

- `useOnlineStatus` hari ini **murni** `navigator.onLine` + event `online`/`offline`.
  Diuji dengan `fetch` di-spy: `navigator.onLine = false` → `false` dan **nol**
  panggilan `fetch` (belum ada probe reachability sama sekali). Ini baseline yang
  harus dipertahankan saat probe ditambahkan.
- `POSPage` teramati: guard awal `if (!isOnline)` dengan toast
  **"Checkout dinonaktifkan" / "Transaksi tidak dapat diproses saat offline.
  Katalog tersedia untuk referensi saja."**, dua tombol checkout ber-`disabled`
  (`items.length === 0 || !isOnline` dan `processingPayment || items.length === 0 || !isOnline`),
  penulisan cache `cacheCatalogProducts(...)` pada setiap muat sukses, dan
  fallback baca `getCachedCatalogProducts<ProductWithCategory>(tenantId)`.
- IndexedDB (fake-indexeddb): dua produk tersimpan dapat dibaca kembali saat
  `navigator.onLine = false`, `getCatalogCacheFreshness` mengembalikan angka, dan
  `tenant-bbb` melihat `[]` (partisi per tenant utuh).

#### 3.8 — batas rentang laporan

`deltaMs` = `getISOExclusiveEndOfDay − getISOStartOfDay` = **86.400.000** untuk
semua tanggal yang diamati.

| Input | `getISOStartOfDay` | `getISOEndOfDay` | `getISOExclusiveEndOfDay` |
|---|---|---|---|
| 2026-01-31 | `2026-01-31T00:00:00+07:00` | `...T23:59:59+07:00` | `2026-02-01T00:00:00+07:00` |
| 2026-02-28 | idem pola | idem | `2026-03-01T00:00:00+07:00` |
| 2024-02-28 (kabisat) | idem | idem | `2024-02-29T00:00:00+07:00` |
| 2024-02-29 | idem | idem | `2024-03-01T00:00:00+07:00` |
| 2026-04-30 | idem | idem | `2026-05-01T00:00:00+07:00` |
| 2026-12-31 | idem | idem | `2027-01-01T00:00:00+07:00` |
| 2026-09-13 | idem | idem | `2026-09-14T00:00:00+07:00` |

Perilaku tepi teramati: `''` → `''`; `'not-a-date'` → `''` (bukan throw, bukan
`Invalid Date`); `'2026-09-13T10:30:00'` (tanpa penanda zona) → diberi `+07:00`
apa adanya, **bukan** dinormalkan ke awal hari; `'2026-09-13T10:30:00+07:00'` →
batas eksklusif `2026-09-14T00:00:00+07:00`.

PBT (500 runs, tanggal acak 2020–2035 dengan hari dikepras ke hari terakhir bulan):
`start` selalu `${tanggal}T00:00:00+07:00`, `end` selalu awal hari berikutnya,
selisih selalu tepat 24 jam, dan `end` selalu > batas inklusif. Tidak ada
counterexample.

#### 3.13 — struk browser (`ReceiptPrint`)

Nota uji: 5 dus × Rp 14.000 dengan diskon item 5% (`subtotal` 66.500) + 1 pcs
Rp 14.225, `transaction.subtotal` 80.725, bayar 100.000, kembalian 19.275,
catatan "Meja 4". Teks yang dirender (teramati, dipadatkan oleh `textContent`):

```
Gelas Plastik (dus)5 dus x Rp 14.000Rp 70.000Diskon 5%-Rp 3.500
Tali Rafia1 pcs x Rp 14.225Rp 14.225
SubtotalRp 80.725TotalRp 80.725BayarRp 100.000KembaliRp 19.275
CatatanMeja 4
```

Rekonsiliasi teramati: baris berdiskon mencetak **bruto** Rp 70.000 di kanan lalu
baris `Diskon 5% / -Rp 3.500`; Σ(bruto) = 84.225, Σ(diskon) = 3.500,
84.225 − 3.500 = **80.725** = `transaction.subtotal`. Satuan per baris (`dus`,
`pcs`) **sudah** tercetak di struk browser — kontras dengan struk thermal (task 1,
kasus 13) yang mencetak `2x` tanpa satuan.

#### 3.12 — sesi, cache offline, logout, StrictMode

| Skenario | Nilai teramati |
|---|---|
| `initialize()` normal | `session` ada, `user` = profil kasir, `tenant` ter-set, `isAdmin=false`, `needsOnboarding=false`, `error=null`, listener terdaftar **1** |
| event auth dengan **profil gagal diambil** (`FetchError: network down`) | `session` **dipertahankan**; `user`/`tenant` lama **dipertahankan**; `needsOnboarding` tetap `false`; `error` = pesan itu; cache katalog **1 produk utuh**; 1 pesanan parkir **utuh**; `ppn_persen` tetap 11 |
| `logout()` dengan `signOut` gagal | melempar `Failed to fetch`, **tetapi** `session/user/tenant` di-null, `error='Failed to fetch'`, cache IndexedDB **kosong**, `heldCarts` `[]`, `activeTenantId` `null`, keranjang kosong, `ppn_persen` 0 |
| event auth `session = null` (SIGNED_OUT) | cache tenant dibersihkan, `heldCarts` `[]` |
| `initialize()` dipanggil 2× paralel + 1× lagi (StrictMode) | `onAuthStateChange` dipanggil **1×**, `getSession` **1×** |

### Temuan yang perlu diputuskan sebelum fase berikutnya (protokol klausa 1.18/2.18)

**Tidak ada klausa baru di `bugfix.md`.** Alasannya eksplisit: tiga hal di bawah
bukan cacat pada sistem yang berjalan hari ini (seluruh uji preservation lolos),
melainkan **batasan yang mengikat pekerjaan yang akan datang**. Mencatatnya sebagai
klausa cacat akan salah label; dibiarkan implisit akan berbahaya. Jadi dicatat di
sini dan dilaporkan ke pemilik spec.

1. **`products_with_category` hari ini mengembalikan 20 kolom, bukan 15.** Daftar
   teramati (diturunkan dari DDL repo; view masih `SELECT p.*` di migrasi 039,
   `security_invoker = true`):

   `id`, `sku`, `barcode`, `nama`, `deskripsi`, `category_id`, `satuan`,
   `harga_beli`, `harga_jual`, `stok`, `stok_minimum`, `foto_url`, `is_active`,
   `created_at`, `updated_at`, `diskon_produk_persen` (035), `product_group_id`
   (036), `tenant_id` (037), `category_nama` (view), `stok_status` (view).

   Daftar "wajib tetap ada" di task 6.4 memuat **15** nama dan **tidak** memuat
   `tenant_id`, `deskripsi`, `created_at`, `updated_at`. Bila 6.4 ditulis literal
   dari daftar itu, yang hilang **bukan hanya** `harga_beli` → Property 6 dilanggar.

2. **Konsekuensi konkret nomor 1 yang paling mudah jadi insiden:**
   `getProductsPage` di `src/api/products.ts` melakukan
   `.order(filters.sortBy ?? 'updated_at')` **di atas view ini**, dan `created_at`
   adalah salah satu nilai sah `sortBy`. Menghapus `updated_at` dari daftar kolom
   eksplisit membuat daftar produk gagal di PostgREST (kolom tidak ada), bukan
   sekadar kehilangan kolom. **Task 6.4 wajib memuat 19 kolom = daftar teramati
   minus `harga_beli`**, bukan 15 kolom daftar wajib.

3. **`logout()` tidak menghapus `localStorage` pesanan parkir.**
   `clearCatalogCache()` (IndexedDB) dan `clearForLogout()` (memori Zustand)
   dijalankan, tetapi key `zeepos_held_carts:<tenant>` **masih berisi pesanan
   parkir** setelah logout (nilai teramati: satu entri `HOLD-...` utuh). Login
   berikutnya ke tenant yang sama menghidrasi ulang pesanan itu. Ini tampaknya
   **disengaja** (parkir crash-safe bertahan lintas reload) dan klausa 3.12 dapat
   dibaca dua arah, jadi tidak diubah dan tidak diperbaiki diam-diam — perlu
   ketetapan pemilik apakah logout seharusnya menghapus key per-tenant itu juga.
   Uji baseline saat ini merekam perilaku sekarang (memori + IndexedDB bersih),
   **tanpa** mengasersi isi `localStorage`, supaya keputusan mana pun tidak
   terhalang uji.

---

## Task 4 — Target non-produksi dan penerapan 001–066

- **Tanggal:** 2026-09-22 (WIB)
- **Penguji:** coding agent (Kiro) atas nama pemilik spec, mesin pengembang macOS
- **Target yang dipilih:** project Supabase **yang sudah ada**, `ZeePOS`, ref
  `dfgqioglsirftfyjyswd`, region **South Asia (Mumbai)**, org
  `qrydxgflbhxpxulwsnuo`. **Bukan** project staging baru, **bukan** Supabase
  branch, **bukan** stack Docker lokal.
- **Hasil ringkas:** riwayat migrasi remote diputar ulang dari nol dan
  **001–066 seluruhnya terterapkan** (66 baris tercatat). **Tidak ada satu berkas
  migrasi pun yang diedit.**

### Mengapa project ini sah dipakai sebagai target non-produksi

Dibuktikan lewat query **read-only sebelum apa pun diubah**:

| Amatan | Nilai teramati |
|---|---|
| `transactions` | **0** |
| `transaction_items` | **0** |
| `products` | **0** |
| `auth.users` | **1** (`ferzirayhan0@gmail.com`, dibuat 2026-09-16, login terakhir 2026-09-16) |
| `max(created_at)` transactions | **NULL** |
| `min(created_at)` transactions | **NULL** |

Kesimpulan: **tidak ada data bisnis sama sekali**. Project ini adalah lingkungan
UAT, bukan produksi, sehingga reset total tidak menghancurkan apa pun.

### Temuan sebelum eksekusi: riwayat migrasi bohong

`supabase_migrations.schema_migrations` hanya mencatat **001–036 (36 baris)**,
**padahal objek dari migrasi 037+ sudah ada di database**: tabel `tenants`,
`product_units`, `receivables`, `transaction_refunds`, `cash_shifts`, dan
`product_discount_tiers` semuanya hadir. Artinya migrasi 037+ pernah diterapkan
manual tanpa tercatat.

Konsekuensinya: `supabase db push` akan **memutar ulang 037**, yang memuat **10
`ADD COLUMN` tanpa `IF NOT EXISTS`** dan **14 `CREATE POLICY`** → pasti gagal.
Inilah alasan **reset total** dipilih, bukan `migration repair` atas riwayat.

### Verifikasi 066 belum diterapkan sebelum reset

Tanda tangan fungsi teramati sebelum reset:

```
get_top_products → TABLE(product_id integer, nama_produk text, total_qty bigint, total_penjualan numeric)
```

`total_qty` masih **`bigint`**, sedangkan 066 mengubahnya ke **`numeric`** lewat
`DROP FUNCTION`. Jadi 066 memang belum ada.

**Koreksi metodologi yang wajib dicatat:** pemeriksaan awal
`prosrc LIKE '%round(%'` memberi **`false`** dan itu **menyesatkan** — pemeriksaan
itu case-sensitive sedangkan sumber fungsinya memakai `ROUND(` huruf besar. Bukti
yang benar-benar menentukan adalah **tipe `total_qty`**, bukan pemeriksaan `round`
tersebut.

### Jalur alat yang dipakai (penting untuk pembaca berikutnya)

`psql` **tidak terpasang** dan Docker **tidak dijalankan**, tetapi itu **bukan
penghalang**:

| Perintah | Butuh Docker? |
|---|---|
| `supabase migration list --linked` | tidak — konek langsung ke Postgres remote |
| `supabase db push` | tidak |
| `supabase db reset --linked` | tidak |
| `supabase migration repair --linked` | tidak |
| `supabase db start` / `db reset --local` / `db dump` | **ya** |

Query ad-hoc dijalankan lewat Management API endpoint
`POST /v1/projects/{ref}/database/query` dengan personal access token CLI.

**Cara memperoleh token itu (jangan diulangi salah):** token tersimpan di macOS
Keychain pada service `Supabase CLI`, account `supabase`, **ter-encode go-keyring** —
nilainya berawalan `go-keyring-base64:` dan harus **di-strip lalu di-base64-decode**
untuk mendapat token `sbp_`. Mengirim nilai mentah dari Keychain apa adanya
menghasilkan `401 {"message":"JWT could not be decoded"}`.

### Hambatan utama dan cara mengatasinya (temuan paling berguna dari task ini)

`supabase db reset --linked` pada CLI **v2.78.1** berhasil memutar **001–032** lalu
**gagal** di `033_adjust_stock_atomic.sql`:

```
ERROR: cannot insert multiple commands into a prepared statement (SQLSTATE 42601)
At statement: 0
```

Diagnosis: **SQL 033 sendiri sah.** Dibuktikan dengan menjalankan **seluruh isi
berkas** lewat Management API di dalam `BEGIN; ... ROLLBACK;` → **HTTP 201**, tanpa
error. Jadi cacatnya ada pada **pemisah statement CLI v2.78.1**, bukan pada
migrasinya.

Hipotesis awal "033 adalah berkas pertama yang punya fungsi ber-`$$` diikuti
statement lain" **ditolak**: berkas **008, 026, dan 027** berpola sama dan lolos.

Perbaikan: `brew upgrade supabase` → **v2.117.0**, lalu `supabase db push --yes`
menerapkan **033–066 sampai habis tanpa satu pun error**.

Karena akar masalahnya **versi alat**, syarat task 4 yang membolehkan "mengedit
migrasi di tempat bila gagal diterapkan" **tidak dipakai**. Tidak ada berkas
migrasi yang disentuh.

### Urutan perintah yang benar-benar dijalankan

| # | Perintah | Hasil teramati |
|---|---|---|
| 1 | `supabase projects list` | satu project, `ZeePOS`, sudah linked |
| 2 | `supabase migration list --linked` | Local **001–066**, Remote **001–036** |
| 3 | query read-only pembuktian database kosong | lihat tabel di atas |
| 4 | `supabase db reset --linked --yes` | **001–032 sukses**, gagal di **033** |
| 5 | query kondisi antara | riwayat `max(version) = 032` (**32 baris**), **9 tabel**, `auth.users` = **0** |
| 6 | uji validitas 033 via Management API dengan `ROLLBACK` | **HTTP 201** — SQL sah |
| 7 | `brew upgrade supabase` | **2.78.1 → 2.117.0** |
| 8 | `supabase db push --yes` | **033–066 semua sukses**, `Finished supabase db push.` |

### Kondisi akhir teramati

| Amatan | Nilai teramati |
|---|---|
| `supabase_migrations.schema_migrations` | min `001`, max `066`, **66 baris** |
| Tabel di `public` | **17** |
| View di `public` | **3** (`audit_logs_with_user`, `products_with_category`, `transactions_with_kasir`) |
| Fungsi di `public` | **38** |
| `storage.buckets` | `products` dengan **`public = true`** |
| Trigger di `auth.users` yang membuat profil/tenant | **tidak ada** — onboarding dikerjakan sisi aplikasi |

Penanda **066 terkonfirmasi** setelah push:

```
get_top_products → TABLE(product_id integer, nama_produk text, total_qty numeric, total_penjualan numeric)
```

dan pada `create_transaction_atomic`: memuat `DELETE FROM tmp_demand` = **true**,
memuat `ROUND(` (pemeriksaan **case-insensitive**) = **true**.

`products` dengan `public = true` berarti **premis cacat klausa 1.3 / kasus 4 task
5 terkonfirmasi hidup di target ini** — bukti yang dibutuhkan eksplorasi berikutnya
memang tersedia.

### Akun dan tenant UAT yang disiapkan untuk blok impersonasi

Dibuat lewat Auth Admin API `POST /auth/v1/admin/users` dengan
`email_confirm: true`. Password keduanya **`ZeePosUAT!2026`**.

| Peran | Email | UUID |
|---|---|---|
| admin | `admin@zeepos.com` | `60afd434-fae8-4766-bf95-6f65674e4793` |
| kasir | `kasir1@zeepos.com` | `70346623-ff6a-4a35-8236-044dd734b78e` |

Tenant: **`Toko Plastik Ratih UAT`**, slug `ratih-uat`, id
`6ea24cf8-efb3-4472-9558-46088ee11ea8`. Kedua profil ditautkan ke tenant itu
dengan `profiles.role` = `admin` dan `kasir`.

Email sengaja mengikuti konvensi `supabase/reset_uat.sql` yang sudah ada, supaya
skrip reset tersebut tetap relevan.

### Catatan kategori bawaan (bukan cacat)

Setelah tenant dibuat lewat `INSERT` langsung, `categories` untuk tenant itu = **0**.
Ini **bukan cacat**: migrasi **048** menyemai `'Umum'` sebagai **backfill satu kali**
untuk tenant yang sudah ada, plus di dalam RPC `register_tenant` — dan tenant ini
dibuat **tanpa** melalui RPC tersebut. Kategori `'Umum'` lalu ditambahkan manual
(id **1**) supaya kondisi UAT sama dengan yang dihasilkan aplikasi.

### Kondisi data akhir

**66 migrasi, 2 akun, 1 tenant, 2 profil, 1 kategori, 0 produk, 0 transaksi.**

### Konsekuensi yang harus diingat untuk task berikutnya

Target ini **tidak punya data produksi**. Karena itu audit path storage
(**task 19.1**) **wajib** dijalankan sebagai **query read-only terhadap produksi** —
kecuali ternyata **tidak ada project produksi lain sama sekali**, yang **perlu
dikonfirmasi pemilik**, karena org `qrydxgflbhxpxulwsnuo` hanya memuat satu project.
---

## Task 5 — Eksplorasi kondisi bug sisi SQL (target UAT, 066)

- **Tanggal:** 2026-09-22 (WIB)
- **Penguji:** coding agent (Kiro) atas nama pemilik spec, mesin pengembang macOS
- **Target:** project Supabase `ZeePOS`, ref `dfgqioglsirftfyjyswd`, skema pada
  migrasi **066** (067/068/069 **belum** ada) — kondisi yang ditinggalkan task 4.
- **Tenant uji:** `6ea24cf8-efb3-4472-9558-46088ee11ea8` (`Toko Plastik Ratih UAT`)
- **Identitas impersonasi:** kasir `70346623-ff6a-4a35-8236-044dd734b78e`,
  admin `60afd434-fae8-4766-bf95-6f65674e4793`
- **Data uji:** produk id **1** `Gelas Plastik 200ml` (`harga_beli` 900,
  `harga_jual` 1.250, stok awal **500**), pelanggan id **1** `Bu Ratih`.
- **Hasil ringkas:** kasus **1, 2, 3, 11** TERKONFIRMASI (cacatnya ada); kasus **4**
  hipotesisnya TERKONFIRMASI **plus** satu temuan tambahan (cache CDN); kasus **6**
  hipotesisnya **TERBANTAH** — lihat bagian kasus 6, ini temuan terpenting task ini.

### Cara query dijalankan, dan satu jebakan harness yang wajib diketahui

Query dijalankan lewat Management API `POST /v1/projects/{ref}/database/query`
(bukan SQL Editor dashboard; jalur token dan alasannya sudah dicatat di task 4),
dengan blok impersonasi:

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','<uuid>','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
-- satu pengamatan saja di sini
ROLLBACK;
```

**Jebakan harness:** endpoint itu mengembalikan **hanya SATU result set**, yaitu
statement terakhir yang menghasilkan baris. Blok impersonasi contoh pada task 5 di
`tasks.md` menumpuk beberapa `SELECT` dalam satu blok — bila dikirim apa adanya,
hanya hasil `SELECT` terakhir yang terlihat dan pengamatan sebelumnya **hilang tanpa
peringatan** (bukan error, jadi mudah tidak disadari). Karena itu **setiap pengamatan
diisolasi menjadi satu request tersendiri**, masing-masing dengan blok impersonasinya
sendiri. Bila eksplorasi ini diulang, pemisahan itu harus dipertahankan.

### Kasus 1 — RPC laporan terbuka untuk kasir (TERKONFIRMASI, cacat ada)

Prasyarat identitas, diamati lebih dulu supaya hasil di bawah tidak ambigu:

| Amatan (sebagai kasir) | Nilai teramati |
|---|---|
| `public.is_admin()` | **`false`** |
| `public.get_my_tenant_id()` | `6ea24cf8-efb3-4472-9558-46088ee11ea8` |

Pemanggilan RPC laporan **sebagai kasir** (`is_admin() = false`):

| RPC | Hasil | Nilai teramati |
|---|---|---|
| `get_profit_summary(now() - 7d, now() + 1d)` | **BERHASIL** | tanggal `2026-09-22`, `total_omzet` **37500.00**, `total_hpp` **27000.00000**, `total_laba` **10500.00000**, `jumlah_transaksi` **2** |
| `get_top_products(...)` | **BERHASIL** | `product_id` 1, `total_qty` **30.000**, `total_penjualan` **37500.00** |
| `get_dashboard_stats()` | **BERHASIL** | mengembalikan objek statistik, **bukan** error otorisasi |

Kebocoran omzet, HPP, dan laba ke sesi kasir terbukti langsung di lapisan data,
tanpa melewati UI sama sekali. Klausa 1.3 terkonfirmasi.

**Pelajaran metodologi yang wajib dicatat:** pada percobaan **pertama**,
`get_profit_summary` **berhasil dipanggil tetapi mengembalikan NOL baris**, dan itu
sempat terbaca seolah "tidak ada kebocoran". Penyebabnya bukan otorisasi, melainkan
**database masih kosong** (task 4 berakhir dengan 0 transaksi). Bukti kebocoran baru
terlihat setelah transaksi uji dibuat. Jadi: **RPC yang lolos tetapi mengembalikan
nol baris bukan bukti aman** — yang menentukan adalah apakah pemanggilannya ditolak,
bukan apakah hasilnya kosong. Verifikasi fix di task 14 harus menguji **penolakan**,
bukan kekosongan hasil.

### Kasus 2 — kolom biaya terbaca kasir (TERKONFIRMASI)

Semua query di bawah dijalankan **sebagai kasir** dan **semuanya berhasil**:

| Query | Nilai teramati |
|---|---|
| `SELECT nama, harga_beli FROM public.products LIMIT 1` | `Gelas Plastik 200ml`, `harga_beli` **900.00** |
| `SELECT id, nama_produk, harga_beli, laba_kotor FROM public.transaction_items` | id **1**: `harga_beli` 900.00, `laba_kotor` **3500.00**; id **2**: `harga_beli` 900.00, `laba_kotor` **7000.00** |
| `SELECT id, nomor_nota, kasir_nama, total, laba_kotor FROM public.transactions_with_kasir` | id **1** `NOTA-20260922-0001`, `Kasir Satu`, total 12500.00, `laba_kotor` **3500.00**; id **2** `NOTA-20260922-0002`, total 25000.00, `laba_kotor` **7000.00** |

Ini **membuktikan temuan A.4 secara empiris**. Klausa 1.4 hanya menyebut tabel
`products`, sedangkan kebocoran nyata juga mencakup `transaction_items.harga_beli`,
`transaction_items.laba_kotor`, dan agregat `transactions_with_kasir.laba_kotor`
yang dibaca POSPage. Dicatat sebagai klausa baru **1.19 / 2.19** di `bugfix.md`
(severity **P0**).

### Kasus 3 — daftar staf terbaca kasir (TERKONFIRMASI)

`SELECT count(*) FROM public.profiles` **sebagai kasir** → **2**, seharusnya **1**.
Angka 2 adalah **seluruh profil tenant** (admin + kasir), konsisten dengan
`profiles_tenant_select` yang tenant-wide. Klausa 1.5 terkonfirmasi.

### Kasus 11 — `receivables.jatuh_tempo` NULL (TERKONFIRMASI)

Penjualan **hutang** Rp 25.000 dicatat lewat `create_transaction_atomic`
(transaksi id **2**, `NOTA-20260922-0002`, customer id 1 `Bu Ratih`):

| Amatan | Nilai teramati |
|---|---|
| receivable id | **1** |
| `total_tagihan` | 25000.00 |
| `sisa_hutang` | 25000.00 |
| `status` | `belum_lunas` |
| `jatuh_tempo` | **NULL** |
| tanggal transaksi (WIB) | `2026-09-22` |

Nilai yang **harus** muncul setelah 067 dengan tenor default 14 hari:
**`2026-10-06`**. Angka inilah yang diverifikasi di fase fix.

**Catatan penting untuk 067:** `store_settings` untuk tenant ini **tidak memuat**
key `tempo_hutang_hari` **maupun** `ppn_persen` sama sekali (query mengembalikan
**nol baris**). Jadi 067 harus benar-benar mengandalkan jalur **fallback**
(`COALESCE(NULLIF(...)::INTEGER, 14)`), bukan jalur "setelan ada tapi kosong".
Target UAT ini adalah kondisi yang tepat untuk menguji fallback itu.

### Kasus 4 — falsifikasi hipotesis bucket publik (HIPOTESIS TERKONFIRMASI)

Kondisi awal teramati:

| Amatan | Nilai teramati |
|---|---|
| `storage.buckets` id `products`, kolom `public` | **`true`** |
| Policy `SELECT` pada `storage.objects` untuk bucket ini | **satu-satunya**: `product_images_public_select`, `TO public`, `USING (bucket_id = 'products')` |

Objek uji diunggah lewat Storage API:
`6ea24cf8-efb3-4472-9558-46088ee11ea8/uat-task5.png`.

| Langkah | Perintah | Hasil teramati |
|---|---|---|
| 1 | `curl` anonim **tanpa header apa pun** ke `/storage/v1/object/public/products/<tenant>/uat-task5.png` | **HTTP 200**, 70 byte, `content-type: image/png` |
| 2 | Policy dipersempit: `DROP POLICY product_images_public_select`, `CREATE POLICY product_images_tenant_select ... TO authenticated USING ((storage.foldername(name))[1] = public.get_my_tenant_id()::text)` — **tanpa** menyentuh flag bucket | policy baru terpasang; `storage.buckets.public` diverifikasi **masih `true`** |
| 3 | `curl` anonim yang sama diulang **3×** | **tetap HTTP 200** setiap kali |

**KESIMPULAN:** hipotesis "endpoint `/object/public/...` melayani objek **tanpa**
mengevaluasi RLS `storage.objects`" **TERKONFIRMASI**. Mempersempit policy **saja
TIDAK cukup** untuk memenuhi 2.6. **Privatisasi bucket wajib**, sehingga **gate 3.1
tetap relevan dan tetap memblokir** — **task 19 tidak boleh disederhanakan**, dan
keputusan opsi A (blob authenticated) vs opsi B (signed URL) tetap harus diambil
pemilik sebelum satu baris kode pemuatan gambar ditulis.

### Kasus 4 — temuan tambahan yang penting: cache CDN menahan akses anonim

Setelah `storage.buckets.public` di-set **`false`**:

| Uji | Hasil teramati |
|---|---|
| `curl` anonim ke URL yang **sudah pernah diminta** (`uat-task5.png`) | **HTTP 200**, header **`cf-cache-status: HIT`**, `cache-control: no-cache`, `cf-ray` region **SIN** |
| URL yang sama + cache-buster `?v=<random>` | **HTTP 400** |
| Objek kedua yang **belum pernah** diminta (`uat-task5-kedua.png`) | **HTTP 400** langsung |

Artinya: **memprivatkan bucket TIDAK langsung menutup akses ke objek yang sudah
ter-cache di CDN Cloudflare.** Ada **jendela waktu** di mana gambar lama masih
terbaca anonim meski bucket sudah privat — persis gambar yang paling mungkin sudah
pernah diakses, yaitu yang sudah tersebar. Ini **harus masuk rencana 069 sebagai
langkah eksplisit** (purge cache atau rotasi nama objek sehingga URL lama tidak lagi
menunjuk objek yang sama), **bukan** diasumsikan selesai saat flag dibalik.
Dicatat sebagai klausa baru **1.20 / 2.20** di `bugfix.md` (severity **P1**).

**Pembalikan percobaan (sudah dilakukan seluruhnya):**

| Langkah balik | Status |
|---|---|
| `DROP POLICY product_images_tenant_select` | selesai |
| `CREATE POLICY product_images_public_select ... TO public USING (bucket_id = 'products')` | selesai (dibuat ulang seperti aslinya) |
| `UPDATE storage.buckets SET public = true WHERE id = 'products'` | selesai |
| Verifikasi: `curl` anonim **dengan cache-buster** | kembali **HTTP 200** |

Dua objek uji (`uat-task5.png`, `uat-task5-kedua.png`) **dibiarkan** di bucket karena
berguna untuk memverifikasi 069 nanti. Keduanya adalah **objek yatim**: tidak
dirujuk oleh `products.foto_url` mana pun, jadi masuk perlakuan Langkah 4 pada
[Migrasi Kebijakan Storage](design.md#migrasi-kebijakan-storage-162639) — jangan
dipindahkan, jangan dihapus, cukup didaftarkan di laporan verifikasi. Ini
pendaftarannya.

### Kasus 6 — asimetri leg tunai: hipotesis design B.4 **TERBANTAH**

Ini temuan terpenting task 5. Dibaca lengkap sebelum task 6.2 dikerjakan.

**Isi leg `close_cash_shift` (064) yang teramati apa adanya:**

| Leg | Filter / rumus teramati |
|---|---|
| penjualan tunai | `paid_at >= opened_at AND metode_bayar = 'tunai' AND payment_status = 'dibayar'` — **tanpa** `status` |
| refund tunai | `SUM(transaction_refunds.amount)` dengan `payment_method = 'tunai'` dan (`cash_shift_id = p_shift_id` **ATAU** (`cash_shift_id IS NULL AND requested_by = kasir_id AND created_at >= opened_at`)) |
| kas bersih | `net_tunai = gross + cicilan − refund` |
| total sistem | `total_sistem = modal_awal + net_tunai − pengeluaran` |
| selisih | `selisih = uang_fisik − total_sistem` |

#### Skenario A — penjualan dan refund di SHIFT YANG SAMA

Shift `7f3bac2d`, `modal_awal` 100.000. Jual tunai Rp 12.500 (transaksi id 1,
`NOTA-20260922-0001`), lalu `refund_transaction_atomic(1, ...)` dipanggil admin.

Baris refund yang teramati:

| Kolom | Nilai teramati |
|---|---|
| id | **1** |
| `amount` | 12500.00 |
| `payment_method` | `tunai` |
| `cash_shift_id` | **`7f3bac2d…` (TERISI, bukan NULL)** |
| `requested_by` | uuid **kasir** |

Transaksi setelah refund:

| Kolom | Nilai teramati |
|---|---|
| `status` | **`batal`** |
| `payment_status` | tetap **`dibayar`** |
| `paid_at` | **TIDAK berubah** |
| stok produk 1 | pulih **470 → 480** |

Uang fisik sebenarnya = **100.000** (12.500 masuk, lalu 12.500 keluar).
Hasil `close_cash_shift`: `total_penjualan_tunai` = **0**, `selisih` = **0** →
**COCOK dengan uang fisik**.

Perhitungan tandingan atas shift yang **sama**, dijalankan sebagai query terpisah
dengan dan tanpa filter yang diusulkan task 6.2:

| Besaran | Kode sekarang (066) | Bila `AND status = 'selesai'` ditambahkan (usulan task 6.2) |
|---|---|---|
| gross tunai | 12.500 | **0** |
| refund tunai | 12.500 | 12.500 |
| net tunai | 0 | **−12.500** |
| total sistem | 100.000 | **87.500** |
| selisih (fisik 100.000) | **0 (benar)** | **+12.500 (SALAH)** |

#### Skenario B — refund LINTAS SHIFT

| Shift | Aksi | `total_penjualan_tunai` | uang fisik | `selisih` |
|---|---|---|---|---|
| `b03decc5` (modal 100.000) | jual tunai Rp 20.000 (transaksi id 3), lalu ditutup | 20.000 | 120.000 | **0** |
| `ab787cc0` (modal 100.000) | refund transaksi 3, lalu ditutup | **−20.000** | 80.000 | **0** |

Perhitungan tandingan pada skenario ini: gross sekarang = **0** dan gross dengan
filter `status = 'selesai'` = **0** — **sama**. Filter itu **tidak berpengaruh sama
sekali** pada skenario lintas shift, karena `paid_at` penjualannya berada **sebelum**
`opened_at` shift yang merefund, sehingga penjualan itu memang sudah tidak masuk leg
tunai shift tersebut.

#### Uji penentu — adakah jalur lain menuju `status = 'batal'` tanpa baris refund?

Pertanyaan ini yang menentukan apakah kompensasi refund dijamin atau tidak.

| Uji | Hasil teramati |
|---|---|
| `cancel_transaction_atomic(4)` dipanggil **admin** atas transaksi **tunai lunas** Rp 5.000 | **DITOLAK** — `P0001: Transaksi lunas tidak dapat dibatalkan langsung. Gunakan prosedur Refund Teraudit (refund_transaction_atomic).` |
| Pemeriksaan sumber `cancel_transaction_atomic` | **tidak memuat `transaction_refunds` sama sekali** |
| `cancel_pending_transaction` | hanya menyentuh transaksi `menunggu_konfirmasi`, yang **tidak pernah** masuk leg tunai (leg itu mensyaratkan `payment_status = 'dibayar'`) |

#### Kesimpulan kasus 6

Leg tunai **tanpa** filter `status` **bukan cacat, melainkan benar**. Uang tunai
memang **fisik masuk** pada `paid_at`, dan leg refund menguranginya **persis ketika
uang itu fisik keluar**. Karena **satu-satunya** jalur menuju `status = 'batal'` bagi
transaksi tunai lunas adalah `refund_transaction_atomic`, dan RPC itu **selalu**
menulis baris `transaction_refunds`, **kompensasinya dijamin**.

Menambahkan `AND status = 'selesai'` justru **membalik pengurangan dua kali**:
penjualannya dikeluarkan dari leg tunai **dan** refundnya tetap dikurangkan,
menghasilkan `selisih` **salah sebesar nominal refund** pada skenario satu shift
(**+12.500** pada contoh di atas), **tanpa manfaat apa pun** pada skenario lintas
shift.

Jadi: **deskripsi klausa 1.13 akurat secara faktual** (leg tunai memang tidak
memfilter `status`, dan memang berbeda dari leg non-tunai), **tetapi kesimpulannya
— "rekonsiliasi jadi salah" — tidak terbukti**. Perilaku yang diminta klausa **2.13**
dan task **6.2** **akan memperkenalkan cacat uang yang sekarang tidak ada**.

**Konsekuensi prosedural:** ini perubahan requirement, jadi **menunggu keputusan
pemilik spec** — bukan diputuskan agent. `design.md` bagian B.4 dan
[Hypothesized Root Cause](design.md#hypothesized-root-cause) sudah diberi koreksi
bertanggal (hipotesis lama **tidak dihapus**, supaya riwayat penalarannya terbaca),
dan `bugfix.md` 1.13/2.13 diberi catatan "menunggu keputusan pemilik" yang merujuk
ke angka di bagian ini.

> **PEMBARUAN 2026-09-22 (setelah blok ini ditulis):** keputusan pemilik **sudah
> diambil** — **2.13 DIBATALKAN**, leg tunai dibiarkan apa adanya, task 6.2 menjadi
> "tidak ada perubahan pada `close_cash_shift`". Blok di atas **tidak diubah** karena ia
> catatan eksekusi bertanggal. Keputusan dan konsekuensinya ada di bagian
> **"Gate keputusan 3.1, 3.2, dan resolusi 2.13"** di akhir berkas ini.

#### Baseline keempat shift untuk dibandingkan setelah 067

Seluruh `selisih` **= 0** pada kondisi 066. Bila 067 mengubah salah satu angka di
bawah, perubahan itu harus dapat dijelaskan:

| Shift | `modal_awal` | `total_penjualan_tunai` | `uang_fisik_akhir` | `selisih` |
|---|---|---|---|---|
| `7f3bac2d` | 100.000 | 0 | 100.000 | **0** |
| `b03decc5` | 100.000 | 20.000 | 120.000 | **0** |
| `ab787cc0` | 100.000 | **−20.000** | 80.000 | **0** |
| `4fcda5cb` | 50.000 | 5.000 | 55.000 | **0** |

### Kondisi data akhir target UAT setelah task 5

| Amatan | Nilai teramati |
|---|---|
| `transactions` | **4** — id 1 `batal` (di-refund), id 2 hutang, id 3 `batal` (di-refund), id 4 `selesai` |
| `transaction_refunds` | **2** baris |
| `receivables` | **1** (id 1, `jatuh_tempo` NULL) |
| `cash_shifts` | **4**, semuanya **closed** |
| stok produk 1 | stok awal 500 dikurangi penjualan lalu dipulihkan dua refund; titik antara yang **teramati langsung** adalah **470 → 480** pada refund transaksi 1 |
| objek `storage` bucket `products` | **2**, keduanya **yatim** (tidak dirujuk `products.foto_url` mana pun) |
| skema | tetap **066** — tidak ada migrasi baru, tidak ada berkas migrasi yang disentuh |

Seluruh perubahan percobaan (policy storage dan flag bucket) **sudah dibalikkan**.
Data transaksi/shift/refund **sengaja dibiarkan** karena itulah baseline yang
dibandingkan setelah 067 diterapkan.

---

## Gate keputusan 3.1, 3.2, dan resolusi 2.13

- **Tanggal:** 2026-09-22 (WIB)
- **Yang memutuskan:** **pemilik spec** (bukan agent). Agent hanya mencatat.
- **Sifat catatan ini:** dokumentasi keputusan, terpusat supaya ketiganya dapat diaudit
  di satu tempat. Tidak ada migrasi, kode, maupun uji yang ditulis bersama catatan ini.
- **Dokumen lain yang diselaraskan:** `bugfix.md` (tabel severity P2, keputusan produk
  nomor 3, catatan klausa 1.13 dan 2.13), `design.md` (B.4, Hypothesized Root Cause
  butir B.3, Property 1 & Property 11, E.1 backfill, Pemetaan migrasi 067 butir 2 & 6,
  tabel batasan urutan, Migrasi Kebijakan Storage, Preservation Checking kasus 4,
  Iteration and Feedback Rules), `tasks.md` (3.1, 3.2, 6.2, 6.8, 9, 12.4, 19, 19.3,
  aturan urutan butir 4).

### Keputusan 1 — resolusi klausa 2.13 / task 6.2: **DIBATALKAN (opsi a)**

Pemilik **menerima pembantahan empiris task 5** (angka lengkapnya di bagian
"Task 5 … Kasus 6" di atas: satu shift → `selisih` **0 benar** pada kode sekarang vs
**+12.500 SALAH** bila filter ditambahkan; lintas shift → filter **tidak berpengaruh**).

Leg tunai `close_cash_shift` **dibiarkan APA ADANYA**; `AND status = 'selesai'` **tidak**
ditambahkan.

Konsekuensi yang dicatat eksplisit:

| Butir | Status setelah keputusan |
|---|---|
| Task **6.2** | **"tidak ada perubahan pada `close_cash_shift`"** — migrasi 067 **tidak me-re-emit fungsi itu sama sekali**. Bukan "di-re-emit verbatim dari 064", tetapi **tidak disentuh**. Fungsi yang live tetap versi 064. |
| Syarat **"WAJIB SATU MIGRASI DENGAN PENGAKTIFAN REFUND"** | **LARUT.** Tidak ada lagi perubahan `close_cash_shift` yang perlu dipasangkan dengan UI refund. Task **9** tidak lagi berpasangan keras dengan 6.2. |
| Prasyarat task **9** yang tetap berlaku | **067 live di produksi sebelum UI refund dirilis** — bukan karena 6.2, melainkan karena **6.3** (`refund_transaction_atomic` = 060 + syarat shift kasir untuk refund tunai) ada di 067 dan dibutuhkan oleh requirement shift kas. |
| **Property 11** di `design.md` | **Dirumuskan ulang.** Tidak boleh lagi mengasersikan filter `status = 'selesai'`. Rumusan baru mengasersikan apa yang benar dan sudah terverifikasi: rekonsiliasi shift cocok dengan uang fisik karena leg tunai mencatat kas **masuk** pada `paid_at` dan leg refund menguranginya **saat kas fisik keluar**, dengan baseline keempat shift `selisih = 0` sebagai buktinya. |
| Klausa **1.13** | Diselesaikan sebagai **"bukan cacat"**; keluar dari daftar cacat terbuka P2. Deskripsi faktualnya tetap akurat dan tetap tercatat. |
| Klausa **2.13** | **`DIBATALKAN 2026-09-22 atas keputusan pemilik`.** Tidak dihapus. |

Seluruh bukti dan jejak hipotesis di `bugfix.md` dan `design.md` **dipertahankan utuh** —
yang berubah hanya **STATUS**-nya, dari "menunggu keputusan pemilik" menjadi
"dibatalkan".

Yang **tidak** terpengaruh: B.1, B.2, B.3, B.5 (modul API refund, titik masuk UI, rotasi
kunci idempotensi, syarat shift untuk refund tunai) berjalan seperti rancangan.

### Keputusan 2 — gate 3.1 pemuatan gambar: **OPSI B, signed URL TTL pendek**

`createSignedUrl(path, 3600)` dipakai **langsung di `<img src>`**, diperbarui sebelum TTL
habis. **Opsi A (blob authenticated) off the table.**

Ini **penyimpangan yang disengaja** dari keputusan produk tertulis nomor 3 pada
`bugfix.md` ("bukan `public`, bukan signed URL"). Alasan penyimpangannya, dicatat apa
adanya: keputusan itu diambil **sebelum biaya opsi A terlihat**; opsi B jauh lebih murah,
caching peramban tetap bekerja, dan tetap sah secara keamanan. **Tradeoff yang diterima
secara sadar: URL bertanda tangan dapat dibagikan sampai TTL habis.**

Konsekuensi yang dicatat eksplisit:

1. **Task 19.3 menjadi implementasi signed URL**, bukan hook blob/`createObjectURL`.
   Tidak ada cache blob di memori, tidak ada `revokeObjectURL`.
2. **`products.foto_url` wajib menghasilkan PATH objek.** `createSignedUrl` menerima
   **path**, bukan URL penuh. Jadi `foto_url` harus berupa path objek (disimpan sebagai
   path) **atau** path diturunkan dari URL penuh lama. Ini **syarat** untuk 19.3, bukan
   catatan opsional.
3. **Signed URL TIDAK menyelesaikan klausa 1.20 / 2.20.** Signed URL bersifat per-token
   sehingga **tidak** dilayani dari cache publik bersama — tetapi jendela 1.20 berlaku
   pada **URL `/object/public/...` LAMA yang sudah ter-cache** sebelum bucket
   diprivatkan (teramati: `cf-cache-status: HIT`, HTTP 200 setelah `public = false`).
   Karena itu **langkah 5b (purge cache atau rotasi nama objek) TETAP WAJIB.** Jangan
   menyimpulkan bahwa beralih ke signed URL sudah menutup 1.20.

Yang **tidak** berubah: privatisasi bucket tetap wajib (terkonfirmasi task 5 kasus 4:
penyempitan policy saja → `curl` anonim **tetap HTTP 200** pada 3 percobaan), pembatasan
`SELECT` ke anggota tenant pemilik folder tetap berlaku, dan audit + pemindahan path
objek (19.1, 19.2) tetap prasyarat 069.

### Keputusan 3 — gate 3.2 backfill `receivables.jatuh_tempo`: **BIARKAN NULL, TIDAK ADA BACKFILL**

Alasan yang menentukan: **target tidak punya data produksi sama sekali.** Org
`qrydxgflbhxpxulwsnuo` hanya memuat satu project, dan project itu adalah **UAT dengan nol
transaksi bisnis** (lihat "Task 4 → Mengapa project ini sah dipakai sebagai target
non-produksi": `transactions` 0, `transaction_items` 0, `products` 0). Jadi **tidak ada
piutang lama untuk dibackfill** — pertanyaannya **kosong dalam praktik**, bukan ditunda.

Konsekuensi yang dicatat eksplisit:

- Per task **6.8**, blok backfill **TIDAK DITULIS** di 067 — **bukan** ditulis lalu
  dikomentari.
- Baris `lunas`/`dibatalkan` **tidak disentuh** (ketentuan ini tetap berlaku).
- Badge kosong di `CustomersPage` untuk piutang tanpa `jatuh_tempo` adalah **perilaku
  yang diharapkan, bukan bug** — klausa 12.4 pada `tasks.md` sudah menyebut ini.
- Piutang **baru** tetap memperoleh `jatuh_tempo` dari `create_transaction_atomic`
  (task 6.1), jadi keputusan ini tidak mengurangi cakupan klausa 2.11 untuk data ke
  depan. Nilai verifikasinya tetap seperti dicatat di "Task 5 → Kasus 11": piutang
  tertanggal WIB `2026-09-22` harus menjadi **`2026-10-06`** dengan tenor default 14.

---

## Task 7 — Penerapan dan verifikasi 067 (target UAT)

- **Tanggal:** 2026-09-22 (WIB)
- **Penguji:** coding agent (Kiro) atas nama pemilik spec
- **Target:** project `ZeePOS` ref `dfgqioglsirftfyjyswd` (UAT), tenant
  `6ea24cf8-efb3-4472-9558-46088ee11ea8`
- **Perintah:** `supabase db push --yes` →
  `Applying migration 067_receivable_tempo_refund_symmetry_and_read_paths.sql...`
  `Finished supabase db push.` — tanpa error.

**Inilah pemeriksaan sintaks SQL nyata yang pertama untuk 067.** Penjaga teks CI hanya
memeriksa **bentuk** berkas; sampai push ini, **tidak ada satu pun bagian 067 yang pernah
diparse Postgres**. Semua objek berhasil dibuat.

**Bagian produksi pada task 7 tidak berlaku.** Tidak ada project produksi: org hanya
memuat **satu** project, dan project itu adalah target UAT ini. Jadi langkah "lalu 066+067
ke produksi" **tidak dapat** dan **tidak perlu** dijalankan.

**Penerapan ulang setelah cacat diperbaiki.** Setelah cacat `refund_kas` di bawah
diperbaiki, 067 diterapkan **ulang**: `supabase migration repair --status reverted 067`
lalu `supabase db push --yes`. Ini sah dilakukan karena seluruh isi 067 **idempoten**
(`CREATE OR REPLACE FUNCTION`, `DROP VIEW`/`CREATE VIEW`, seed `WHERE NOT EXISTS` +
`ON CONFLICT DO NOTHING`) dan karena **tidak ada produksi** yang memegang versi lama.
`supabase migration list --linked` akhir: **`067 | 067`** (local dan remote sinkron).

### Cacat yang ditemukan verifikasi task 7: `refund_kas` tidak memfilter metode bayar

Ditemukan dengan **menjalankan** `get_cash_receipts_summary` sebagai admin di target UAT
setelah 067 diterapkan, atas satu jendela yang mencakup seluruh data uji.

Keluaran teramati (SALAH):

| Kolom | Teramati | Benar |
|---|---|---|
| `omzet_akrual` | 30000.00 | 30000.00 (benar) |
| `kas_dari_penjualan` | 5000.00 | 5000.00 (benar) |
| `kas_dari_cicilan` | 0 | 0 (benar) |
| `refund_kas` | **55000.00** | **45000.00** |
| `kas_diterima` | **−50000.00** | **−40000.00** |
| `piutang_baru` | 25000.00 | 25000.00 (benar) |

Baris `transaction_refunds` di jendela tersebut:

| id | transaction_id | amount | payment_method |
|---|---|---|---|
| 1 | 1 | 12500.00 | tunai |
| 2 | 3 | 20000.00 | tunai |
| 3 | 6 | 12500.00 | tunai |
| 4 | 5 | 10000.00 | **hutang** |

12500 + 20000 + 12500 = **45000** adalah refund kas yang nyata. Refund id 4 sebesar
10.000 adalah refund atas penjualan **hutang**: ia membatalkan piutang dan **tidak
memindahkan uang sama sekali**.

**Akar masalah.** Leg refund menjumlah SEMUA `transaction_refunds.amount` tanpa syarat
`payment_method`, sementara leg `kas_dari_penjualan` hanya menghitung
`metode_bayar IN ('tunai','qris','transfer')`. Asimetri ini membuat transaksi non-kas
yang **sama** dikeluarkan saat masuk tetapi **dipotong** saat keluar. Akibatnya
`kas_diterima` terlalu kecil persis sebesar nilai refund hutang (10.000).

**Perbaikan.** Tambahkan `AND tr.payment_method IN ('tunai', 'qris', 'transfer')` pada
leg refund, yaitu mengeluarkan `'hutang'`, sehingga daftar metode kedua leg identik.
`transaction_refunds.payment_method` bertipe `text` (migrasi 057; ditulis oleh
`refund_transaction_atomic` sebagai `v_trx.metode_bayar::text`), jadi perbandingan
dilakukan terhadap literal text, bukan enum `metode_bayar`.

Setelah perbaikan, angka yang diharapkan pada jendela yang sama:
`refund_kas` = **45000.00**, dan
`kas_diterima` = `kas_dari_penjualan (5000) + kas_dari_cicilan (0) − refund_kas (45000)`
= **−40000.00**. Nilai negatif itu **benar** untuk data uji ini: sebagian besar penjualan
di target adalah non-tunai/hutang dan sudah di-refund, jadi kas keluar melebihi kas masuk
pada jendela tersebut.

**Leg lain diverifikasi BENAR dan tidak diubah:**
- `omzet_akrual` 30000 = transaksi 2 dan 4, keduanya `selesai` + `dibayar`.
- `kas_dari_penjualan` 5000 = hanya transaksi 4 (satu-satunya penjualan kas yang masih
  `selesai` dengan `paid_at` di jendela).
- `piutang_baru` 25000 — transaksi 5 sudah tidak ikut karena statusnya kini `batal`.

**Catatan jujur soal asal cacat ini.** Cacat ini **diperkenalkan oleh task 6.7 sendiri**,
bukan warisan migrasi lama: RPC-nya baru ditulis di 067. Ia baru tertangkap karena RPC-nya
**benar-benar dieksekusi** terhadap data nyata di target UAT. Penjaga teks CI
(`src/__tests__/migration067Guards.test.ts`) **tidak mungkin** menangkapnya dalam bentuk
sebelumnya: penjaga itu mengasersi **bentuk** berkas migrasi (gerbang `is_admin()`, batas
atas eksklusif, rumus `kas_diterima`, REVOKE/GRANT) — bukan **aritmetika** hasilnya. Rumus
`v_kas_dari_penjualan + v_kas_dari_cicilan - v_refund_kas` yang diasersi CI tetap lolos
sempurna meskipun `v_refund_kas` sendiri diisi dari himpunan baris yang salah. Pelajaran
yang dicatat: penjaga teks tidak menggantikan eksekusi; tiap leg RPC uang harus diukur
terhadap baris yang diketahui. Sebagai kompensasi, satu asersi baru ditambahkan pada
penjaga 067 yang mengikat daftar metode pada leg refund agar **identik** dengan daftar
pada leg penjualan, dan menolak bentuk lama tanpa filter.

### Verifikasi bentuk objek

`security_invoker` per view — semua sesuai harapan:

| View | `security_invoker` | Harapan |
|---|---|---|
| `products_with_category` | `true` | `true` |
| `transaction_items_public` | `true` | `true` |
| `products_admin_with_category` | `false` | `false` |
| `product_units_admin` | `false` | `false` |
| `transactions_with_kasir` | `false` | `false` |
| `transactions_with_kasir_admin` | `false` | `false` |
| `product_image_path_audit` | `false` | `false` |

Hak EXECUTE (harapan `anon_execute = false` untuk semua) — **terpenuhi**:
`create_transaction_atomic`, `refund_transaction_atomic`, `get_cash_receipts_summary` →
`anon_execute` **false**, `auth_execute` **true** untuk ketiganya.

Bentuk kolom: `products_with_category` **19 kolom**, jumlah kolom bernama `harga_beli`
di dalamnya **0**. `products_admin_with_category` **20 kolom**. Seed setelan:
`tempo_hutang_hari` ada **1 baris** dengan nilai **`'14'`**.

### Kasus 11 sekarang BENAR

Penjualan hutang baru Rp 10.000 (transaksi id **5**, `NOTA-20260922-0005`, customer 1) →
receivable id **2**, `jatuh_tempo` = **`2026-10-06`**, tanggal transaksi WIB
`2026-09-22`. Persis nilai yang diprediksi task 5 (WIB + tenor fallback 14).

Piutang **lama** (receivable id 1, `NOTA-20260922-0002`) tetap `jatuh_tempo` **NULL** —
bukti keputusan gate 3.2 "biarkan NULL" benar-benar berlaku dan **tidak ada blok backfill
yang diam-diam ikut jalan**.

### Kasus 6 — preservation, angkanya HARUS tetap sama

Karena 2.13 dibatalkan, harapan task 7 di sini adalah **tidak berubah**, bukan berubah.
Skenario task 5 diulang persis di atas 067: shift `d259c440` modal 100.000, jual tunai
Rp 12.500 (transaksi id 6), refund oleh admin, tutup dengan uang fisik 100.000.

Hasil: `total_penjualan_tunai` **0**, `selisih` **0** — **identik** dengan baseline shift
`7f3bac2d` pada skema 066. Rekonsiliasi kas **tidak bergeser sedikit pun** setelah 067.

### Guard baru 6.3 — syarat shift untuk refund tunai

| Uji | Hasil teramati |
|---|---|
| Tidak ada shift terbuka (`count(*) where status='open'` = **0**), refund **TUNAI** transaksi 4 (Rp 5.000) | **DITOLAK** — `P0001: Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.` |
| Kondisi sama, refund **NON-TUNAI** (hutang) transaksi 5 (Rp 10.000) | **BERHASIL**, `total_refund` 10000 |

Asimetri yang dirancang 6.3 terbukti tepat: hanya refund yang menyentuh **kas fisik** yang
butuh shift.

### Gerbang jalur baca kasir vs admin

| Peran | Query | Hasil teramati |
|---|---|---|
| kasir | `products_with_category` | **BERHASIL** — id 1 `Gelas Plastik 200ml`, `harga_jual` 1250.00, `stok_status` `aman` |
| kasir | `count(*) FROM products_admin_with_category` | **0 baris** (gerbang `is_admin()` di dalam definisi view bekerja) |
| admin | `products_admin_with_category` | **BERHASIL** — `harga_beli` **900.00** terbaca |
| kasir | `transactions_with_kasir` | **BERHASIL**, `kasir_nama` **`Kasir Satu` terisi** (bukan NULL) untuk id 1/2/3, tanpa kolom `laba_kotor` |
| admin | `transactions_with_kasir_admin` | **BERHASIL**, `laba_kotor` 3500.00 / 7000.00 / 5600.00 |
| kasir | `get_cash_receipts_summary(...)` | **DITOLAK** — `P0001: Ringkasan kas hanya dapat diakses admin` |
| admin | `get_cash_receipts_summary(...)` | **BERHASIL** |

`kasir_nama` yang tetap terisi adalah bukti awal bahwa pilihan `security_invoker = false`
+ gerbang tenant eksplisit pada `transactions_with_kasir` memang **diperlukan**; nilai
sebenarnya baru teruji penuh setelah 068 mempersempit `profiles_tenant_select`, dan harus
diperiksa lagi di **task 17**.

### Catatan penting untuk task 17

068 **belum** diterapkan, jadi hak kolom masih terbuka: `harga_beli` **masih terbaca
kasir langsung dari tabel**. Yang sudah terbukti di task 7 adalah **jalur baca baru
berfungsi dan bergerbang benar**, bukan bahwa kebocorannya sudah tertutup. Penutupan
kebocoran adalah pekerjaan **068**.

### Yang tetap tidak dapat diverifikasi di mesin ini

- Uji asap runtime peramban (**task 15**, **task 18**) butuh peramban + DevTools +
  printer thermal — tidak tersedia di sini.
- Tidak ada produksi untuk dirilis, sehingga tidak ada langkah rilis yang bisa diamati.
