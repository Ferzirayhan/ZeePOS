-- ====================================================================
-- Migrasi 067: Jatuh Tempo Piutang, Syarat Shift pada Refund Tunai,
--              dan Pemisahan Jalur Baca Kasir / Admin
-- ====================================================================
-- SIFAT: ADITIF. Migrasi ini hanya MENAMBAH objek/kemampuan atau mengubah
-- bentuk view secara tidak-merusak. Boleh diterapkan sebelum maupun sesudah
-- deploy frontend. Satu-satunya degradasi yang diterima: setelah 067,
-- ProductsPage kehilangan nilai `harga_beli` (kolom Margin% menjadi 0) sampai
-- frontend beralih ke `products_admin_with_category`. Itu degradasi TAMPILAN
-- admin, bukan error.
--
-- MENGAPA `create_transaction_atomic` MUNCUL DUA KALI DALAM SATU BATCH
-- (066 lalu 067):
--   066 belum pernah dieksekusi di produksi saat 067 ditulis, sehingga kedua
--   migrasi akan diterapkan dalam SATU `db push`. 066 tetap TIDAK DIUBAH agar
--   rantai migrasi tidak pernah ditulis ulang setelah dirilis; 067 memuat
--   re-emit fungsi yang sama DI ATAS versi 066. Membuat fungsi yang sama dua
--   kali dalam satu sesi tidak berbahaya (yang kedua menang), dan memisahkannya
--   membuat riwayat penalaran tetap terbaca.
--   Isi 066 dipertahankan VERBATIM di dalam re-emit ini:
--     * pembulatan rupiah bulat `ROUND(..., 0)` per tahap (per baris → diskon
--       transaksi → PPN);
--     * `DELETE FROM tmp_demand` di awal pemanggilan.
--   Satu-satunya tambahan 067 adalah `jatuh_tempo` pada `INSERT INTO
--   public.receivables`. Bila salah satu penanda 066 di atas hilang dari file
--   ini, penjaga teks CI (`src/__tests__/migration067Guards.test.ts`) gagal.
--
-- 6.2 DIBATALKAN — `close_cash_shift` SENGAJA TIDAK ADA DI FILE INI.
--   Rencana awal (klausa 2.13 / task 6.2) menambahkan `AND status = 'selesai'`
--   pada leg tunai `close_cash_shift`. Pengukuran di target UAT (task 5, kasus 6)
--   membuktikan filter itu SALAH: pada skenario penjualan tunai + refund dalam
--   SATU shift, filter tersebut mengeluarkan penjualannya dari leg tunai
--   sementara leg refund tetap mengurangi, sehingga `selisih` menjadi +12.500
--   padahal kode sekarang menghasilkan 0 yang cocok dengan uang fisik; pada
--   skenario lintas shift filter itu tidak berpengaruh sama sekali. Karena
--   satu-satunya jalur menuju `status = 'batal'` bagi transaksi tunai lunas
--   adalah `refund_transaction_atomic` dan RPC itu SELALU menulis baris
--   `transaction_refunds`, kompensasinya sudah dijamin.
--   JANGAN menambahkan `close_cash_shift` ke migrasi ini "supaya lengkap":
--   itu memperkenalkan cacat uang yang sekarang tidak ada. Penjaga teks CI
--   mengasersi bahwa string `close_cash_shift` TIDAK muncul di file ini.
--
-- Isi 067:
--   1. Re-emit `create_transaction_atomic` = versi 066 + `jatuh_tempo`.
--   2. Re-emit `refund_transaction_atomic` = versi 060 + syarat shift kasir
--      aktif khusus refund TUNAI.
--   3. Re-emit `products_with_category` dengan daftar kolom EKSPLISIT tanpa
--      `harga_beli` (`security_invoker = true` dipertahankan).
--   4. View jalur admin: `products_admin_with_category`, `product_units_admin`.
--   5. `transaction_items_public`; re-emit `transactions_with_kasir` tanpa
--      agregat `laba_kotor`; `transactions_with_kasir_admin`.
--   6. RPC baru `get_cash_receipts_summary`.
--   7. Seed setelan `tempo_hutang_hari` = '14' untuk tenant yang belum punya.
--      TIDAK ADA blok backfill `receivables.jatuh_tempo`: pemilik spec memutuskan
--      "biarkan NULL" untuk piutang lama, jadi tidak ada mutasi data historis.
--   8. View audit path storage `product_image_path_audit` (admin-only).
--
-- House style (konvensi sejak migrasi 062): setiap fungsi memakai
-- `SET search_path = pg_catalog, public`, dan setiap fungsi/view diikuti blok
-- `REVOKE ALL ... FROM PUBLIC, anon; GRANT ... TO authenticated, service_role;`.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. create_transaction_atomic — versi 066 + jatuh_tempo piutang
--
--    Tenor dibaca dengan pola yang sama seperti `ppn_persen`, dan pada target
--    yang belum punya barisnya di `store_settings` jalur yang benar-benar
--    dieksekusi adalah FALLBACK `COALESCE(..., 14)` (dikonfirmasi task 5:
--    store_settings tenant uji tidak memuat `tempo_hutang_hari` maupun
--    `ppn_persen` sama sekali).
--
--    `tempo_hutang_hari` TIDAK masuk `request_fingerprint`, alasan identik
--    dengan `ppn_persen`: untuk attempt baru dipakai setelan server saat ini,
--    untuk recovery dipakai nilai tersimpan pada transaksi lama. Memasukkannya
--    ke fingerprint akan membatalkan recovery respons-hilang setiap kali admin
--    mengubah tenor di tengah jalan.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_transaction_atomic(
  p_items jsonb,
  p_kasir_id uuid,
  p_subtotal numeric,
  p_diskon_persen numeric,
  p_diskon_amount numeric,
  p_ppn_persen numeric,
  p_ppn_amount numeric,
  p_total numeric,
  p_metode_bayar metode_bayar,
  p_uang_diterima numeric,
  p_kembalian numeric,
  p_catatan text DEFAULT NULL,
  p_customer_id integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_transaction_id INTEGER;
  v_nomor_nota TEXT;
  v_existing_trx public.transactions%ROWTYPE;
  v_request_fingerprint TEXT;
  v_fp_items JSONB;
  v_product RECORD;
  v_unit RECORD;
  v_item JSONB;
  v_items JSONB;
  v_demand_row RECORD;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID;
  v_is_admin BOOLEAN := false;

  v_product_id INTEGER;
  v_unit_id INTEGER;
  v_qty DECIMAL;
  v_rasio DECIMAL;
  v_stok_potong DECIMAL;
  v_harga_satuan_db DECIMAL;
  v_nama_produk TEXT;
  v_nama_satuan TEXT;
  v_diskon_item_persen DECIMAL := 0;
  v_tier_diskon DECIMAL := 0;
  v_produk_diskon DECIMAL := 0;
  v_item_subtotal DECIMAL;

  v_demand RECORD;
  v_computed_subtotal DECIMAL := 0;
  v_diskon_amount DECIMAL := 0;
  v_effective_diskon_persen DECIMAL := 0;
  v_after_diskon DECIMAL := 0;
  v_server_ppn_persen DECIMAL := 0;
  v_ppn_amount DECIMAL := 0;
  v_total DECIMAL := 0;
  v_kembalian DECIMAL := 0;
  v_setting_ppn_val TEXT;
  -- 067: tenor piutang
  v_setting_tempo TEXT;
  v_tempo_hari INTEGER := 14;

  v_payment_status payment_status;
  v_paid_at TIMESTAMPTZ;
  v_confirmed_by UUID;
  v_customer RECORD;
  v_result_items JSONB := '[]'::jsonb;
  v_final_trx public.transactions%ROWTYPE;
BEGIN
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi';
  END IF;

  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant belum terdaftar atau tidak aktif';
  END IF;

  IF p_kasir_id IS NULL OR p_kasir_id <> v_current_user THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;

  -- IDEMPOTENCY WAJIB: tanpa kunci, RPC menolak sebelum apa pun dieksekusi.
  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'Kunci idempotensi (idempotency key) wajib disertakan untuk mencegah transaksi ganda';
  END IF;

  v_is_admin := public.is_admin();

  v_items := CASE
    WHEN p_items IS NULL THEN NULL
    WHEN jsonb_typeof(p_items) = 'string' THEN (p_items #>> '{}')::JSONB
    ELSE p_items
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang transaksi tidak boleh kosong';
  END IF;

  -- 1. Validasi & Lock Pelanggan
  IF p_customer_id IS NOT NULL THEN
    SELECT id, nama, is_active, total_hutang INTO v_customer
    FROM public.customers
    WHERE id = p_customer_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pelanggan tidak ditemukan pada tenant ini';
    END IF;

    IF COALESCE(v_customer.is_active, false) = false THEN
      RAISE EXCEPTION 'Pelanggan "%" sudah dinonaktifkan / diarsipkan', v_customer.nama;
    END IF;
  END IF;

  -- 2. Batas Diskon Kasir: Max 10%
  v_effective_diskon_persen := COALESCE(p_diskon_persen, 0);
  IF v_effective_diskon_persen < 0 OR v_effective_diskon_persen > 100 THEN
    RAISE EXCEPTION 'Diskon transaksi tidak valid';
  END IF;

  IF NOT v_is_admin AND v_effective_diskon_persen > 10 THEN
    RAISE EXCEPTION 'Diskon kasir maksimal 10%%. Diskon lebih besar membutuhkan otorisasi admin';
  END IF;

  -- 3. PPN 100% Server-Authoritative
  SELECT value INTO v_setting_ppn_val
  FROM public.store_settings
  WHERE tenant_id = v_tenant_id AND key = 'ppn_persen';

  v_server_ppn_persen := COALESCE(NULLIF(v_setting_ppn_val, '')::NUMERIC, 0);

  -- 3b. Tenor piutang server-authoritative (067). Pola baca identik dengan PPN
  --     di atas. Dibatasi 0..365 supaya setelan salah ketik tidak menghasilkan
  --     tanggal jatuh tempo di masa lalu atau ratusan tahun ke depan.
  SELECT value INTO v_setting_tempo
  FROM public.store_settings
  WHERE tenant_id = v_tenant_id AND key = 'tempo_hutang_hari';

  v_tempo_hari := LEAST(GREATEST(COALESCE(NULLIF(v_setting_tempo, '')::INTEGER, 14), 0), 365);

  -- Fingerprint: item & parameter request. PPN TIDAK dihitung di sini — untuk attempt
  -- baru dipakai tarif server saat ini, sedangkan untuk recovery (retry dengan key
  -- yang sudah ada) dipakai tarif TERSIMPAN pada transaksi existing, sehingga
  -- perubahan konfigurasi PPN di tengah jalan tidak membatalkan lost-response recovery.
  -- Alasan yang sama berlaku untuk tempo_hutang_hari: setelan itu SENGAJA tidak
  -- ikut dihitung di fingerprint.
  v_fp_items := (SELECT jsonb_agg(jsonb_build_object(
    'product_id', NULLIF(value->>'product_id', '')::INTEGER,
    'unit_id', NULLIF(value->>'unit_id', '')::INTEGER,
    'qty', NULLIF(value->>'qty', '')::NUMERIC
  ) ORDER BY NULLIF(value->>'product_id', '')::INTEGER,
             NULLIF(value->>'unit_id', '')::INTEGER NULLS FIRST,
             NULLIF(value->>'qty', '')::NUMERIC)
    FROM jsonb_array_elements(v_items));

  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::TEXT || ':' || btrim(p_idempotency_key), 0));

  SELECT * INTO v_existing_trx
  FROM public.transactions
  WHERE tenant_id = v_tenant_id AND idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    v_request_fingerprint := public.zeepos_checkout_fingerprint(
      v_fp_items, v_effective_diskon_persen, v_existing_trx.ppn_persen,
      p_metode_bayar, p_uang_diterima, p_customer_id, p_catatan
    );

    IF v_existing_trx.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'Kunci idempotensi sudah digunakan untuk transaksi atau metode pembayaran berbeda';
    END IF;

    v_final_trx := v_existing_trx;

    SELECT jsonb_agg(to_jsonb(ti)) INTO v_result_items
    FROM public.transaction_items ti
    WHERE ti.transaction_id = v_existing_trx.id AND ti.tenant_id = v_tenant_id;

    RETURN jsonb_build_object(
      'transaction', to_jsonb(v_final_trx),
      'transaction_id', v_final_trx.id,
      'nomor_nota', v_final_trx.nomor_nota,
      'payment_status', v_final_trx.payment_status,
      'subtotal', v_final_trx.subtotal,
      'diskon_persen', v_final_trx.diskon_persen,
      'diskon_amount', v_final_trx.diskon_amount,
      'ppn_persen', v_final_trx.ppn_persen,
      'ppn_amount', v_final_trx.ppn_amount,
      'total', v_final_trx.total,
      'kembalian', v_final_trx.kembalian,
      'metode_bayar', v_final_trx.metode_bayar,
      'uang_diterima', v_final_trx.uang_diterima,
      'kasir_id', v_final_trx.kasir_id,
      'customer_id', v_final_trx.customer_id,
      'catatan', v_final_trx.catatan,
      'status', v_final_trx.status,
      'paid_at', v_final_trx.paid_at,
      'created_at', v_final_trx.created_at,
      'items', v_result_items,
      'idempotent', true
    );
  END IF;

  -- SERIALISASI SHIFT: transaksi tunai BARU wajib memiliki shift kasir aktif dan
  -- mengunci barisnya supaya diserialisasi terhadap close_cash_shift. Ditempatkan
  -- SETELAH lookup idempotensi agar retry atas transaksi yang sudah commit tetap
  -- berhasil meski shift sudah ditutup.
  IF p_metode_bayar = 'tunai' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.cash_shifts
      WHERE tenant_id = v_tenant_id AND kasir_id = p_kasir_id AND status = 'open'
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Tidak ada shift kasir yang aktif. Buka shift terlebih dahulu sebelum transaksi tunai.';
    END IF;
  END IF;

  -- Attempt baru: fingerprint dengan tarif PPN server saat ini
  v_request_fingerprint := public.zeepos_checkout_fingerprint(
    v_fp_items, v_effective_diskon_persen, v_server_ppn_persen,
    p_metode_bayar, p_uang_diterima, p_customer_id, p_catatan
  );

  -- Hitung harga dari database
  CREATE TEMP TABLE IF NOT EXISTS tmp_demand (
    product_id int,
    total_base_qty numeric,
    rasio numeric,
    unit_id int,
    harga_satuan numeric,
    nama_produk text,
    nama_satuan text,
    qty numeric,
    diskon_item_persen numeric,
    item_subtotal numeric
  ) ON COMMIT DROP;

  -- tmp_demand dibuat dengan IF NOT EXISTS dan hanya hilang saat COMMIT. Bila
  -- fungsi ini dipanggil dua kali dalam SATU transaksi, panggilan kedua akan
  -- mewarisi baris panggilan pertama lalu menggandakan item dan potongan stok.
  -- Kosongkan tanpa syarat di awal.
  DELETE FROM tmp_demand;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::DECIMAL;
    v_unit_id := NULLIF(v_item->>'unit_id', '')::INTEGER;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item transaksi tidak valid';
    END IF;

    SELECT id, nama, stok, is_active, harga_jual, diskon_produk_persen, satuan
    INTO v_product
    FROM public.products
    WHERE id = v_product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk dengan ID % tidak ditemukan', v_product_id;
    END IF;

    IF COALESCE(v_product.is_active, false) = false THEN
      RAISE EXCEPTION 'Produk % sudah tidak aktif', v_product.nama;
    END IF;

    IF v_unit_id IS NOT NULL THEN
      SELECT id, rasio, harga_jual, nama_satuan
      INTO v_unit
      FROM public.product_units
      WHERE id = v_unit_id AND product_id = v_product_id AND tenant_id = v_tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Satuan produk tidak valid untuk produk %', v_product.nama;
      END IF;

      v_rasio := v_unit.rasio;
      v_harga_satuan_db := v_unit.harga_jual;
      v_nama_satuan := v_unit.nama_satuan;
    ELSE
      v_rasio := 1;
      v_harga_satuan_db := v_product.harga_jual;
      v_nama_satuan := COALESCE(v_product.satuan::text, 'pcs');
    END IF;

    v_stok_potong := v_qty * v_rasio;
    v_nama_produk := COALESCE(NULLIF(v_item->>'nama_produk', ''), v_product.nama);

    -- Tier diskon berbasis BASE QTY: beli 2 dus (rasio 12) = 24 unit dasar,
    -- dibandingkan terhadap min_qty tier. Konsisten dengan UI kasir.
    SELECT COALESCE(MAX(d.diskon_persen), 0)
    INTO v_tier_diskon
    FROM public.product_discount_tiers d
    WHERE d.product_id = v_product_id AND v_stok_potong >= d.min_qty;

    v_produk_diskon := COALESCE(v_product.diskon_produk_persen, 0);
    v_diskon_item_persen := GREATEST(v_tier_diskon, v_produk_diskon);

    -- PEMBULATAN RUPIAH BULAT: rupiah tidak punya pecahan yang bisa ditagih
    -- maupun dikembalikan sebagai uang fisik, dan seluruh klien (parseRupiah /
    -- formatRupiah) hanya mengenal bilangan bulat. Pembulatan 2 desimal membuat
    -- total server berbeda tipis dari total yang dikutip kasir, sehingga
    -- pembayaran "Uang Pas" bisa ditolak dan kembalian menyimpan sisa sen.
    v_item_subtotal := ROUND(v_harga_satuan_db * v_qty * (1 - v_diskon_item_persen / 100), 0);
    v_computed_subtotal := v_computed_subtotal + v_item_subtotal;

    INSERT INTO tmp_demand (product_id, total_base_qty, rasio, unit_id, harga_satuan, nama_produk, nama_satuan, qty, diskon_item_persen, item_subtotal)
    VALUES (v_product_id, v_stok_potong, v_rasio, v_unit_id, v_harga_satuan_db, v_nama_produk, v_nama_satuan, v_qty, v_diskon_item_persen, v_item_subtotal);
  END LOOP;

  -- Cek stok kolektif
  FOR v_demand IN
    SELECT product_id, SUM(total_base_qty) AS total_base_qty
    FROM tmp_demand
    GROUP BY product_id
  LOOP
    SELECT id, nama, stok, harga_beli INTO v_product FROM public.products WHERE id = v_demand.product_id AND tenant_id = v_tenant_id FOR UPDATE;

    IF COALESCE(v_product.stok, 0) < v_demand.total_base_qty THEN
      RAISE EXCEPTION 'Stok untuk produk ID % tidak mencukupi (dibutuhkan % dasar, tersedia %)',
        v_demand.product_id, v_demand.total_base_qty, v_product.stok;
    END IF;
  END LOOP;

  -- Diskon transaksi
  IF v_effective_diskon_persen > 0 THEN
    v_diskon_amount := ROUND(v_computed_subtotal * v_effective_diskon_persen / 100, 0);
  ELSE
    IF NOT v_is_admin AND COALESCE(p_diskon_amount, 0) > (v_computed_subtotal * 0.1) THEN
      RAISE EXCEPTION 'Diskon nominal kasir melebihi batas 10%% subtotal';
    END IF;
    v_diskon_amount := ROUND(LEAST(GREATEST(COALESCE(p_diskon_amount, 0), 0), v_computed_subtotal), 0);
  END IF;

  v_after_diskon := v_computed_subtotal - v_diskon_amount;

  -- PPN otomatis
  IF v_server_ppn_persen > 0 THEN
    v_ppn_amount := ROUND(v_after_diskon * v_server_ppn_persen / 100, 0);
  ELSE
    v_ppn_amount := 0;
  END IF;

  v_total := GREATEST(v_after_diskon + v_ppn_amount, 0);

  -- Validasi pembayaran
  IF p_metode_bayar = 'tunai' THEN
    IF p_uang_diterima IS NULL OR p_uang_diterima < v_total THEN
      RAISE EXCEPTION 'Uang diterima (%) kurang dari total transaksi (%)', p_uang_diterima, v_total;
    END IF;
    v_kembalian := p_uang_diterima - v_total;
    v_payment_status := 'dibayar';
    v_paid_at := NOW();
    v_confirmed_by := p_kasir_id;
  ELSIF p_metode_bayar = 'hutang' THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Metode bayar hutang wajib memilih pelanggan terlebih dahulu';
    END IF;
    v_kembalian := 0;
    v_payment_status := 'dibayar';
    v_paid_at := NOW();
    v_confirmed_by := p_kasir_id;
  ELSE
    v_kembalian := 0;
    v_payment_status := 'menunggu_konfirmasi';
    v_paid_at := NULL;
    v_confirmed_by := NULL;
  END IF;

  v_nomor_nota := public.generate_nomor_nota();

  INSERT INTO public.transactions (
    tenant_id, nomor_nota, kasir_id, customer_id, subtotal, diskon_persen, diskon_amount,
    ppn_persen, ppn_amount, total, metode_bayar, uang_diterima,
    kembalian, catatan, payment_status, paid_at, confirmed_by, idempotency_key, request_fingerprint
  )
  VALUES (
    v_tenant_id, v_nomor_nota, p_kasir_id, p_customer_id,
    v_computed_subtotal, v_effective_diskon_persen, v_diskon_amount,
    v_server_ppn_persen, v_ppn_amount, v_total,
    p_metode_bayar,
    CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
    v_kembalian,
    p_catatan, v_payment_status, v_paid_at, v_confirmed_by, btrim(p_idempotency_key), v_request_fingerprint
  )
  RETURNING * INTO v_final_trx;

  v_transaction_id := v_final_trx.id;

  -- Insert items & potong stok
  FOR v_demand_row IN SELECT * FROM tmp_demand ORDER BY product_id
  LOOP
    SELECT id, nama, stok, harga_beli INTO v_product
    FROM public.products
    WHERE id = v_demand_row.product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    v_stok_potong := v_demand_row.total_base_qty;

    INSERT INTO public.transaction_items (
      tenant_id, transaction_id, product_id, nama_produk, harga_satuan, harga_beli,
      qty, subtotal, diskon_item_persen, rasio, base_qty, nama_satuan
    )
    VALUES (
      v_tenant_id, v_transaction_id, v_demand_row.product_id, v_demand_row.nama_produk, v_demand_row.harga_satuan,
      COALESCE(v_product.harga_beli, 0), v_demand_row.qty, v_demand_row.item_subtotal, v_demand_row.diskon_item_persen,
      v_demand_row.rasio, v_stok_potong, v_demand_row.nama_satuan
    );

    UPDATE public.products
    SET stok = COALESCE(stok, 0) - v_stok_potong
    WHERE id = v_demand_row.product_id AND tenant_id = v_tenant_id;

    INSERT INTO public.stock_adjustments (
      tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
      keterangan, reference_id
    )
    VALUES (
      v_tenant_id, v_demand_row.product_id, p_kasir_id, 'terjual',
      COALESCE(v_product.stok, 0), -v_stok_potong, COALESCE(v_product.stok, 0) - v_stok_potong,
      'Penjualan ' || v_nomor_nota, v_transaction_id::TEXT
    );
  END LOOP;

  -- Piutang untuk bon tempo
  --
  -- 067: kolom `jatuh_tempo` akhirnya punya penulis. Basisnya TANGGAL WIB dari
  -- `paid_at` (fallback NOW()) supaya transaksi malam tidak bergeser sehari —
  -- `jatuh_tempo` bertipe DATE, jadi konversi zona harus dilakukan sebelum cast.
  IF p_metode_bayar = 'hutang' AND p_customer_id IS NOT NULL THEN
    INSERT INTO public.receivables (
      tenant_id, customer_id, transaction_id, nomor_nota,
      total_tagihan, jumlah_dibayar, sisa_hutang, status, jatuh_tempo
    ) VALUES (
      v_tenant_id, p_customer_id, v_transaction_id, v_nomor_nota,
      v_total, 0, v_total, 'belum_lunas',
      ((COALESCE(v_paid_at, NOW()) AT TIME ZONE 'Asia/Jakarta')::date + v_tempo_hari)
    );

    UPDATE public.customers
    SET total_hutang = total_hutang + v_total, updated_at = NOW()
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  END IF;

  -- Ambil representasi item tersimpan untuk struk resmi
  SELECT jsonb_agg(to_jsonb(ti)) INTO v_result_items
  FROM public.transaction_items ti
  WHERE ti.transaction_id = v_transaction_id AND ti.tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction', to_jsonb(v_final_trx),
    'transaction_id', v_transaction_id,
    'nomor_nota', v_nomor_nota,
    'payment_status', v_payment_status,
    'subtotal', v_computed_subtotal,
    'diskon_persen', v_effective_diskon_persen,
    'diskon_amount', v_diskon_amount,
    'ppn_persen', v_server_ppn_persen,
    'ppn_amount', v_ppn_amount,
    'total', v_total,
    'kembalian', v_kembalian,
    'metode_bayar', p_metode_bayar,
    'uang_diterima', CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
    'kasir_id', p_kasir_id,
    'customer_id', p_customer_id,
    'catatan', p_catatan,
    'status', 'selesai',
    'paid_at', v_paid_at,
    'created_at', v_final_trx.created_at,
    'items', v_result_items,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  public.metode_bayar, numeric, numeric, text, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  public.metode_bayar, numeric, numeric, text, integer, text
) TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 2. refund_transaction_atomic — versi 060 + syarat shift untuk refund TUNAI
--
--    Body 060 dipertahankan utuh: admin-only, alasan wajib, kunci idempotensi
--    wajib, fingerprint sha256({transaction_id, alasan}), tolak status 'batal',
--    tolak payment_status <> 'dibayar', tolak inventory_snapshot_status
--    'ambiguous_legacy', batalkan piutang bila metode hutang dan belum ada
--    cicilan, pulihkan stok dari base_qty dengan row lock, catat
--    stock_adjustments, tulis transaction_refunds, set 'batal', tulis audit log.
--
--    SATU tambahan: refund TUNAI mengeluarkan uang dari drawer, jadi harus
--    tercatat pada sebuah shift. Tanpa shift, baris transaction_refunds punya
--    cash_shift_id NULL dan uang keluar tidak pernah masuk rekonsiliasi shift
--    mana pun. Refund non-tunai (QRIS/transfer/hutang) TIDAK butuh shift karena
--    tidak menyentuh kas fisik.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_transaction_atomic(
  p_transaction_id integer,
  p_alasan text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_user_id uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_trx public.transactions%ROWTYPE;
  v_item public.transaction_items%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_receivable public.receivables%ROWTYPE;
  v_restore_qty numeric(12,3);
  v_refund_id integer;
  v_shift_id uuid;
  v_existing_id integer;
  v_existing_fingerprint text;
  v_fingerprint text;
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: sesi tidak aktif';
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Pengembalian dana (refund) transaksi lunas memerlukan otorisasi admin';
  END IF;

  IF btrim(COALESCE(p_alasan, '')) = '' THEN
    RAISE EXCEPTION 'Alasan pengembalian dana (refund) wajib diisi';
  END IF;

  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'Kunci idempotensi (idempotency key) wajib diisi untuk transaksi refund';
  END IF;

  v_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'transaction_id', p_transaction_id,
      'alasan', btrim(p_alasan)
    )::TEXT,
    'sha256'
  ), 'hex');

  -- Idempotency lock
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::TEXT || ':refund:' || btrim(p_idempotency_key), 0));

  SELECT id, request_fingerprint INTO v_existing_id, v_existing_fingerprint
  FROM public.transaction_refunds
  WHERE tenant_id = v_tenant_id AND idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;

  IF v_existing_id IS NOT NULL THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'Kunci idempotensi sudah digunakan untuk transaksi refund berbeda';
    END IF;

    SELECT * INTO v_trx FROM public.transactions WHERE id = p_transaction_id;
    RETURN jsonb_build_object(
      'success', true,
      'refund_id', v_existing_id,
      'transaction_id', p_transaction_id,
      'nomor_nota', v_trx.nomor_nota,
      'status', v_trx.status,
      'total_refund', v_trx.total,
      'idempotent', true
    );
  END IF;

  SELECT * INTO v_trx
  FROM public.transactions
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  IF v_trx.status = 'batal' THEN
    RAISE EXCEPTION 'Transaksi ini sudah berstatus batal atau sudah pernah di-refund';
  END IF;

  IF v_trx.payment_status <> 'dibayar' THEN
    RAISE EXCEPTION 'Hanya transaksi yang sudah dibayar yang dapat diproses refund';
  END IF;

  -- KUNCI KEAMANAN: Tolak transaksi dengan konversi stok ambigu legacy
  IF EXISTS (
    SELECT 1 FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
      AND inventory_snapshot_status = 'ambiguous_legacy'
  ) THEN
    RAISE EXCEPTION 'Transaksi lama memiliki konversi stok ambigu; refund otomatis ditolak dan memerlukan rekonsiliasi manual';
  END IF;

  -- Cari shift kasir aktif approver, jika tidak ada fallback ke shift kasir transaksi yang sedang open (dengan FOR UPDATE lock)
  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE tenant_id = v_tenant_id AND kasir_id = v_user_id AND status = 'open'
  FOR UPDATE;

  IF v_shift_id IS NULL AND v_trx.kasir_id IS NOT NULL THEN
    SELECT id INTO v_shift_id
    FROM public.cash_shifts
    WHERE tenant_id = v_tenant_id AND kasir_id = v_trx.kasir_id AND status = 'open'
    FOR UPDATE;
  END IF;

  -- TAMBAHAN 067: refund TUNAI wajib punya shift kasir aktif. Uang keluar dari
  -- drawer harus punya shift tempat ia dibukukan; tanpa ini cash_shift_id NULL
  -- dan pengeluaran kas tidak masuk rekonsiliasi shift mana pun.
  IF v_trx.metode_bayar = 'tunai' AND v_shift_id IS NULL THEN
    RAISE EXCEPTION 'Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.';
  END IF;

  -- Transaksi metode hutang
  IF v_trx.metode_bayar = 'hutang' THEN
    SELECT * INTO v_receivable
    FROM public.receivables
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF FOUND THEN
      IF COALESCE(v_receivable.jumlah_dibayar, 0) > 0 OR EXISTS (
        SELECT 1 FROM public.receivable_payments
        WHERE receivable_id = v_receivable.id AND tenant_id = v_tenant_id
      ) THEN
        RAISE EXCEPTION 'Transaksi bon ini sudah memiliki pembayaran cicilan; batalkan atau refund cicilan terlebih dahulu';
      END IF;

      PERFORM set_config('zeepos.internal_mutation', 'true', true);

      UPDATE public.customers
      SET total_hutang = GREATEST(0, total_hutang - v_receivable.sisa_hutang),
          updated_at = NOW()
      WHERE id = v_receivable.customer_id AND tenant_id = v_tenant_id;

      UPDATE public.receivables
      SET status = 'dibatalkan', sisa_hutang = 0, updated_at = NOW(),
          catatan = CONCAT_WS(E'\n', NULLIF(catatan, ''), 'Dibatalkan melalui refund transaksi')
      WHERE id = v_receivable.id AND tenant_id = v_tenant_id;
    END IF;
  END IF;

  -- Kembalikan stok dengan row lock produk
  FOR v_item IN
    SELECT * FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
    ORDER BY id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      v_restore_qty := COALESCE(v_item.base_qty, v_item.qty * COALESCE(v_item.rasio, 1), v_item.qty);

      SELECT * INTO v_product
      FROM public.products
      WHERE id = v_item.product_id AND tenant_id = v_tenant_id
      FOR UPDATE;

      UPDATE public.products
      SET stok = COALESCE(stok, 0) + v_restore_qty
      WHERE id = v_item.product_id AND tenant_id = v_tenant_id;

      INSERT INTO public.stock_adjustments (
        tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
        keterangan, reference_id
      ) VALUES (
        v_tenant_id, v_item.product_id, v_user_id, 'masuk',
        COALESCE(v_product.stok, 0), v_restore_qty, COALESCE(v_product.stok, 0) + v_restore_qty,
        'Refund transaksi ' || v_trx.nomor_nota || ': ' || p_alasan,
        p_transaction_id::TEXT
      );
    END IF;
  END LOOP;

  -- Catat ke transaction_refunds
  INSERT INTO public.transaction_refunds (
    tenant_id, transaction_id, amount, payment_method, reason,
    requested_by, approved_by, cash_shift_id, idempotency_key, request_fingerprint
  ) VALUES (
    v_tenant_id, p_transaction_id, v_trx.total, v_trx.metode_bayar::text, p_alasan,
    v_trx.kasir_id, v_user_id, v_shift_id, btrim(p_idempotency_key), v_fingerprint
  ) RETURNING id INTO v_refund_id;

  -- Ubah status transaksi
  UPDATE public.transactions
  SET
    status = 'batal',
    catatan = CONCAT_WS(E'\n', NULLIF(catatan, ''), '[REFUND #' || v_refund_id || '] ' || p_alasan)
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id;

  PERFORM public.insert_audit_log(
    v_user_id,
    'transaction',
    p_transaction_id::TEXT,
    'transaction_refunded',
    'Transaksi ' || v_trx.nomor_nota || ' direfund sebesar Rp ' || v_trx.total::TEXT,
    jsonb_build_object(
      'refund_id', v_refund_id,
      'amount', v_trx.total,
      'alasan', p_alasan,
      'shift_id', v_shift_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'refund_id', v_refund_id,
    'transaction_id', p_transaction_id,
    'nomor_nota', v_trx.nomor_nota,
    'status', 'batal',
    'total_refund', v_trx.total,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_transaction_atomic(integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_transaction_atomic(integer, text, text) TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 3. products_with_category — daftar kolom EKSPLISIT tanpa harga_beli
--
--    `p.*` adalah alasan kolom biaya bocor ke jalur kasir sejak 039: setiap
--    kolom baru pada `products` otomatis ikut terekspos. Daftar eksplisit
--    menutup kelas bug itu, bukan hanya instansnya.
--
--    19 kolom: 17 kolom `products` (semua kolom hari ini MINUS `harga_beli`)
--    plus 2 kolom turunan view (`category_nama`, `stok_status`).
--    `updated_at` dan `created_at` WAJIB tetap ada: `getProductsPage` melakukan
--    `.order(filters.sortBy ?? 'updated_at')` DI ATAS view ini dan `created_at`
--    adalah salah satu nilai sah `sortBy`. Menghapus salah satunya membuat
--    daftar produk GAGAL KERAS di PostgREST (kolom tidak ada), bukan sekadar
--    kehilangan kolom. `deskripsi` dan `tenant_id` juga dipertahankan supaya
--    `select('*')` klien tetap menerima bentuk `ProductWithCategory` yang sama.
--
--    `security_invoker = true` DIPERTAHANKAN: RLS tenant pemanggil tetap yang
--    menentukan baris mana yang terlihat.
--    DROP diperlukan karena CREATE OR REPLACE VIEW tidak dapat menghapus kolom.
-- --------------------------------------------------------------------
DROP VIEW IF EXISTS public.products_with_category CASCADE;
CREATE VIEW public.products_with_category WITH (security_invoker = true) AS
SELECT
  p.id,
  p.sku,
  p.barcode,
  p.nama,
  p.deskripsi,
  p.category_id,
  p.satuan,
  p.harga_jual,
  p.stok,
  p.stok_minimum,
  p.foto_url,
  p.is_active,
  p.created_at,
  p.updated_at,
  p.diskon_produk_persen,
  p.product_group_id,
  p.tenant_id,
  c.nama AS category_nama,
  CASE
    WHEN p.stok = 0 THEN 'habis'
    WHEN p.stok <= p.stok_minimum THEN 'menipis'
    ELSE 'aman'
  END AS stok_status
FROM public.products p
LEFT JOIN public.categories c ON p.category_id = c.id;

REVOKE ALL ON public.products_with_category FROM PUBLIC, anon;
GRANT SELECT ON public.products_with_category TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 4. Jalur baca ADMIN: products_admin_with_category, product_units_admin
--
--    Keduanya `security_invoker = false` (dieksekusi sebagai pemilik view,
--    sehingga lolos column privileges yang dicabut 068) dengan gerbang DI DALAM
--    definisi view: tenant pemanggil DAN is_admin(). Tanpa gerbang di dalam
--    definisi, security_invoker = false akan membuka seluruh tabel ke siapa pun
--    yang boleh SELECT view-nya.
-- --------------------------------------------------------------------
DROP VIEW IF EXISTS public.products_admin_with_category CASCADE;
CREATE VIEW public.products_admin_with_category WITH (security_invoker = false) AS
SELECT
  p.id,
  p.sku,
  p.barcode,
  p.nama,
  p.deskripsi,
  p.category_id,
  p.satuan,
  p.harga_beli,
  p.harga_jual,
  p.stok,
  p.stok_minimum,
  p.foto_url,
  p.is_active,
  p.created_at,
  p.updated_at,
  p.diskon_produk_persen,
  p.product_group_id,
  p.tenant_id,
  c.nama AS category_nama,
  CASE
    WHEN p.stok = 0 THEN 'habis'
    WHEN p.stok <= p.stok_minimum THEN 'menipis'
    ELSE 'aman'
  END AS stok_status
FROM public.products p
LEFT JOIN public.categories c ON p.category_id = c.id
WHERE p.tenant_id = public.get_my_tenant_id()
  AND public.is_admin();

REVOKE ALL ON public.products_admin_with_category FROM PUBLIC, anon;
GRANT SELECT ON public.products_admin_with_category TO authenticated;

DROP VIEW IF EXISTS public.product_units_admin CASCADE;
CREATE VIEW public.product_units_admin WITH (security_invoker = false) AS
SELECT
  pu.id,
  pu.tenant_id,
  pu.product_id,
  pu.nama_satuan,
  pu.rasio,
  pu.barcode,
  pu.harga_beli,
  pu.harga_jual,
  pu.is_default,
  pu.created_at
FROM public.product_units pu
WHERE pu.tenant_id = public.get_my_tenant_id()
  AND public.is_admin();

REVOKE ALL ON public.product_units_admin FROM PUBLIC, anon;
GRANT SELECT ON public.product_units_admin TO authenticated;

-- --------------------------------------------------------------------
-- 5. transaction_items_public, transactions_with_kasir, transactions_with_kasir_admin
--
--    transaction_items_public: `security_invoker = true`, TANPA harga_beli dan
--    laba_kotor. Inilah yang membuat kasir tetap dapat mencetak ulang struk
--    transaksinya setelah 068 mencabut kedua kolom itu dari authenticated.
-- --------------------------------------------------------------------
DROP VIEW IF EXISTS public.transaction_items_public CASCADE;
CREATE VIEW public.transaction_items_public WITH (security_invoker = true) AS
SELECT
  ti.id,
  ti.tenant_id,
  ti.transaction_id,
  ti.product_id,
  ti.nama_produk,
  ti.harga_satuan,
  ti.qty,
  ti.subtotal,
  ti.diskon_item_persen,
  ti.rasio,
  ti.base_qty,
  ti.nama_satuan,
  ti.inventory_snapshot_status
FROM public.transaction_items ti;

REVOKE ALL ON public.transaction_items_public FROM PUBLIC, anon;
GRANT SELECT ON public.transaction_items_public TO authenticated, service_role;

-- transactions_with_kasir: agregat laba_kotor DIHAPUS (itulah kebocoran laba ke
-- jalur kasir), dan view menjadi `security_invoker = false` + gerbang tenant
-- EKSPLISIT. Alasan security_invoker = false di sini BUKAN privilese kolom
-- biaya, melainkan agar `kasir_nama` tetap resolve setelah 068 mempersempit
-- `profiles_tenant_select` menjadi "profil sendiri atau admin": dengan
-- security_invoker, join ke profiles akan mengembalikan NULL untuk nama kasir
-- lain dan atribusi yang diandalkan klausa 3.6 rusak.
-- Kolom transaksi tetap `t.*` (perilaku hari ini dipertahankan verbatim, hanya
-- agregat laba yang hilang) supaya `select('*')` POSPage tidak berubah bentuk.
DROP VIEW IF EXISTS public.transactions_with_kasir CASCADE;
CREATE VIEW public.transactions_with_kasir WITH (security_invoker = false) AS
SELECT
  t.*,
  p.nama AS kasir_nama,
  confirmer.nama AS confirmed_by_nama,
  COUNT(ti.id) AS jumlah_item
FROM public.transactions t
LEFT JOIN public.profiles p ON t.kasir_id = p.id
LEFT JOIN public.profiles confirmer ON t.confirmed_by = confirmer.id
LEFT JOIN public.transaction_items ti ON t.id = ti.transaction_id
WHERE t.tenant_id = public.get_my_tenant_id()
GROUP BY t.id, p.nama, confirmer.nama;

REVOKE ALL ON public.transactions_with_kasir FROM PUBLIC, anon;
GRANT SELECT ON public.transactions_with_kasir TO authenticated, service_role;

-- transactions_with_kasir_admin: sama seperti di atas PLUS agregat laba_kotor,
-- digerbangi tenant + is_admin() di dalam definisi. ReportsPage (admin) membaca
-- view ini supaya kolom "Laba" tetap ada (klausa 3.1).
DROP VIEW IF EXISTS public.transactions_with_kasir_admin CASCADE;
CREATE VIEW public.transactions_with_kasir_admin WITH (security_invoker = false) AS
SELECT
  t.*,
  p.nama AS kasir_nama,
  confirmer.nama AS confirmed_by_nama,
  COUNT(ti.id) AS jumlah_item,
  COALESCE(SUM(ti.laba_kotor), 0)::NUMERIC(15,2) AS laba_kotor
FROM public.transactions t
LEFT JOIN public.profiles p ON t.kasir_id = p.id
LEFT JOIN public.profiles confirmer ON t.confirmed_by = confirmer.id
LEFT JOIN public.transaction_items ti ON t.id = ti.transaction_id
WHERE t.tenant_id = public.get_my_tenant_id()
  AND public.is_admin()
GROUP BY t.id, p.nama, confirmer.nama;

REVOKE ALL ON public.transactions_with_kasir_admin FROM PUBLIC, anon;
GRANT SELECT ON public.transactions_with_kasir_admin TO authenticated;

-- --------------------------------------------------------------------
-- 6. get_cash_receipts_summary — omzet akrual vs kas yang benar-benar diterima
--
--    Satu RPC (bukan beberapa query klien) supaya semua leg memakai definisi
--    dan batas rentang yang sama, dan supaya gerbang is_admin() tetap satu
--    tempat. Batas atas EKSKLUSIF (`< p_date_to`), konsisten dengan 066.
--    `get_profit_summary` TIDAK diubah semantiknya — basis akrual dipertahankan.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cash_receipts_summary(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  omzet_akrual NUMERIC,
  kas_dari_penjualan NUMERIC,
  kas_dari_cicilan NUMERIC,
  refund_kas NUMERIC,
  kas_diterima NUMERIC,
  piutang_baru NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tenant_id UUID := public.get_my_tenant_id();
  v_omzet_akrual NUMERIC := 0;
  v_kas_dari_penjualan NUMERIC := 0;
  v_kas_dari_cicilan NUMERIC := 0;
  v_refund_kas NUMERIC := 0;
  v_piutang_baru NUMERIC := 0;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant belum terdaftar atau tidak aktif';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Ringkasan kas hanya dapat diakses admin';
  END IF;

  -- Omzet akrual: identik dengan angka "total penjualan" yang sudah dipakai
  -- laporan hari ini (berbasis created_at), termasuk penjualan hutang.
  SELECT COALESCE(SUM(t.total), 0)
  INTO v_omzet_akrual
  FROM public.transactions t
  WHERE t.tenant_id = v_tenant_id
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to;

  -- Kas dari penjualan: hanya metode yang benar-benar memindahkan uang saat
  -- transaksi, dan berbasis paid_at (saat uangnya masuk), bukan created_at.
  SELECT COALESCE(SUM(t.total), 0)
  INTO v_kas_dari_penjualan
  FROM public.transactions t
  WHERE t.tenant_id = v_tenant_id
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.metode_bayar IN ('tunai', 'qris', 'transfer')
    AND t.paid_at IS NOT NULL
    AND t.paid_at >= p_date_from
    AND t.paid_at < p_date_to;

  SELECT COALESCE(SUM(rp.jumlah), 0)
  INTO v_kas_dari_cicilan
  FROM public.receivable_payments rp
  WHERE rp.tenant_id = v_tenant_id
    AND rp.created_at >= p_date_from
    AND rp.created_at < p_date_to;

  -- Refund kas: HARUS simetris dengan leg `kas_dari_penjualan` di atas. Leg itu
  -- hanya menghitung 'tunai'/'qris'/'transfer'; penjualan 'hutang' tidak pernah
  -- masuk sebagai kas. Karena itu refund atas penjualan 'hutang' juga tidak boleh
  -- dikurangkan dari kas: refund hutang hanya membatalkan piutang dan TIDAK
  -- memindahkan uang. Tanpa filter ini transaksi non-kas yang sama dikeluarkan
  -- saat masuk tetapi dipotong saat keluar, sehingga `kas_diterima` terlalu kecil
  -- sebesar nilai refund hutang (teramati verifikasi task 7: refund_kas 55.000
  -- padahal yang benar 45.000, karena satu refund 'hutang' 10.000 ikut terjumlah).
  -- `transaction_refunds.payment_method` bertipe `text` (ditulis sebagai
  -- `v_trx.metode_bayar::text`), jadi dibandingkan terhadap literal text.
  SELECT COALESCE(SUM(tr.amount), 0)
  INTO v_refund_kas
  FROM public.transaction_refunds tr
  WHERE tr.tenant_id = v_tenant_id
    AND tr.payment_method IN ('tunai', 'qris', 'transfer')
    AND tr.created_at >= p_date_from
    AND tr.created_at < p_date_to;

  SELECT COALESCE(SUM(t.total), 0)
  INTO v_piutang_baru
  FROM public.transactions t
  WHERE t.tenant_id = v_tenant_id
    AND t.status = 'selesai'
    AND t.metode_bayar = 'hutang'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to;

  RETURN QUERY
  SELECT
    v_omzet_akrual,
    v_kas_dari_penjualan,
    v_kas_dari_cicilan,
    v_refund_kas,
    v_kas_dari_penjualan + v_kas_dari_cicilan - v_refund_kas,
    v_piutang_baru;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cash_receipts_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_receipts_summary(timestamptz, timestamptz) TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 7. Seed setelan tempo_hutang_hari = '14' untuk tenant yang belum punya
--
--    Idempoten dua lapis: WHERE NOT EXISTS + ON CONFLICT DO NOTHING atas
--    constraint store_settings_tenant_key (tenant_id, key).
--
--    TIDAK ADA BLOK BACKFILL `receivables.jatuh_tempo`. Pemilik spec memutuskan
--    "biarkan NULL" untuk piutang lama (gate 3.2), jadi tidak ada satu baris
--    data historis yang disentuh migrasi ini; badge jatuh tempo tetap kosong
--    untuk piutang yang dibuat sebelum 067 dan tampilan aging tidak berubah.
-- --------------------------------------------------------------------
INSERT INTO public.store_settings (tenant_id, key, value)
SELECT t.id, 'tempo_hutang_hari', '14'
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.store_settings s
  WHERE s.tenant_id = t.id AND s.key = 'tempo_hutang_hari'
)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- --------------------------------------------------------------------
-- 8. product_image_path_audit — audit path objek storage (read-only, admin-only)
--
--    Memetakan objek yang path-nya BELUM berada di bawah `/<tenant-id>/` ke
--    tenant pemiliknya lewat `products.foto_url`, dan menghitung `target_name`
--    yang konforman. Dipakai skrip pemindahan objek (task 19.2) — pemindahan
--    fisik HARUS lewat Storage API, bukan `UPDATE storage.objects SET name`.
--    Dibuat di 067 supaya audit dapat dijalankan jauh sebelum 069.
--
--    JOIN-nya sengaja INNER: objek YATIM (ada di bucket tetapi tidak dirujuk
--    `products.foto_url` mana pun) tidak dapat dipetakan ke tenant, jadi ia
--    TIDAK BOLEH muncul sebagai target pemindahan. Contoh nyata di target UAT:
--    `uat-task5.png` dan `uat-task5-kedua.png` — keduanya yatim, keduanya harus
--    absen dari view ini, dan perlakuannya adalah "jangan pindahkan, jangan
--    hapus, cukup daftarkan di laporan verifikasi".
--
--    `security_invoker = false` karena RLS `storage.objects` akan menyaring
--    baris untuk pemanggil authenticated sebelum join sempat dilakukan;
--    gerbang tenant + is_admin() ada di dalam definisi view.
-- --------------------------------------------------------------------
DROP VIEW IF EXISTS public.product_image_path_audit CASCADE;
CREATE VIEW public.product_image_path_audit WITH (security_invoker = false) AS
SELECT
  o.name AS object_name,
  p.tenant_id,
  p.id AS product_id,
  p.tenant_id::text || '/' || regexp_replace(o.name, '^.*/', '') AS target_name
FROM storage.objects o
JOIN public.products p ON p.foto_url LIKE '%' || o.name
WHERE o.bucket_id = 'products'
  AND (storage.foldername(o.name))[1] IS DISTINCT FROM p.tenant_id::text
  AND p.tenant_id = public.get_my_tenant_id()
  AND public.is_admin();

REVOKE ALL ON public.product_image_path_audit FROM PUBLIC, anon;
GRANT SELECT ON public.product_image_path_audit TO authenticated;
