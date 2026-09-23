-- ====================================================================
-- Migrasi 066: Koreksi HPP Multi-Satuan, Agregasi Produk Terlaris,
--              dan Pembulatan Uang ke Rupiah Bulat
-- ====================================================================
-- 1. create_transaction_atomic:
--    (a) Uang dibulatkan ke RUPIAH BULAT (0 desimal), bukan 2 desimal.
--        Klien hanya mengenal rupiah bulat, sehingga pembulatan 2 desimal
--        membuat total server berbeda dari total yang dikutip kasir:
--        pembayaran "Uang Pas" bisa ditolak dan kembalian/rekonsiliasi
--        shift menyimpan sisa sen yang tidak pernah ada fisiknya.
--    (b) tmp_demand dikosongkan di awal panggilan (anti warisan baris bila
--        fungsi dipanggil dua kali dalam satu transaksi).
-- 2. get_profit_summary: HPP memakai base_qty, bukan qty satuan jual.
--    transaction_items.harga_beli adalah harga beli SATUAN DASAR, sedangkan
--    qty tercatat dalam satuan jual. Menjual 2 dus (rasio 12) menghitung HPP
--    sebagai harga_beli * 2 padahal yang keluar 24 unit dasar, sehingga HPP
--    tercatat ~12x lebih kecil dan laba kotor jauh lebih besar dari aslinya.
-- 3. get_top_products: total_qty menjumlahkan base_qty (NUMERIC), bukan qty
--    satuan jual yang dicast ke BIGINT. Sebelumnya 2 dus + 3 pcs dijumlahkan
--    menjadi 5, dan qty pecahan (0,5 kg) hilang karena pembulatan cast.
-- 4. Batas atas rentang tanggal kedua fungsi laporan menjadi EKSKLUSIF
--    (created_at < p_date_to) supaya penjualan pada detik terakhir hari
--    (23:59:59.xxx) tidak terbuang. Klien mengirim awal hari BERIKUTNYA.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. create_transaction_atomic — pembulatan rupiah bulat + tmp_demand bersih
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

  -- Fingerprint: item & parameter request. PPN TIDAK dihitung di sini — untuk attempt
  -- baru dipakai tarif server saat ini, sedangkan untuk recovery (retry dengan key
  -- yang sudah ada) dipakai tarif TERSIMPAN pada transaksi existing, sehingga
  -- perubahan konfigurasi PPN di tengah jalan tidak membatalkan lost-response recovery.
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
  IF p_metode_bayar = 'hutang' AND p_customer_id IS NOT NULL THEN
    INSERT INTO public.receivables (
      tenant_id, customer_id, transaction_id, nomor_nota,
      total_tagihan, jumlah_dibayar, sisa_hutang, status
    ) VALUES (
      v_tenant_id, p_customer_id, v_transaction_id, v_nomor_nota,
      v_total, 0, v_total, 'belum_lunas'
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
-- 2. get_profit_summary — HPP berbasis stok dasar (base_qty)
--
--    transaction_items menyimpan:
--      harga_beli : harga beli SATUAN DASAR (diambil dari products.harga_beli)
--      qty        : jumlah dalam SATUAN JUAL (mis. 2 untuk "2 dus")
--      base_qty   : jumlah dalam SATUAN DASAR (qty * rasio, mis. 24)
--
--    HPP yang benar = harga_beli * base_qty. Versi sebelumnya memakai
--    harga_beli * qty sehingga penjualan multi-satuan mencatat HPP sebesar
--    1/rasio dari nilai sebenarnya — laba kotor dan margin ikut melambung.
--
--    COALESCE menjaga baris legacy sebelum kolom base_qty/rasio terisi.
--    Batas atas p_date_to kini EKSKLUSIF.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profit_summary(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ
)
RETURNS TABLE (
  tanggal DATE,
  total_omzet NUMERIC,
  total_hpp NUMERIC,
  total_laba NUMERIC,
  jumlah_transaksi BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    DATE(t.created_at AT TIME ZONE 'Asia/Jakarta') AS tanggal,
    SUM(t.total) AS total_omzet,
    SUM(ti_agg.total_hpp) AS total_hpp,
    SUM(t.total) - SUM(ti_agg.total_hpp) AS total_laba,
    COUNT(DISTINCT t.id) AS jumlah_transaksi
  FROM public.transactions t
  INNER JOIN (
    SELECT
      transaction_id,
      SUM(
        harga_beli * COALESCE(base_qty, qty * COALESCE(rasio, 1), qty)
      ) AS total_hpp
    FROM public.transaction_items
    GROUP BY transaction_id
  ) ti_agg ON ti_agg.transaction_id = t.id
  WHERE
    t.tenant_id = public.get_my_tenant_id()
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to
  GROUP BY DATE(t.created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY tanggal ASC;
$$;

REVOKE ALL ON FUNCTION public.get_profit_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_summary(timestamptz, timestamptz) TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 3. get_top_products — qty diagregasi dalam satuan dasar
--
--    total_qty berubah dari BIGINT SUM(qty) menjadi NUMERIC SUM(base_qty):
--      * SUM(qty) menjumlahkan satuan yang berbeda (2 dus + 3 pcs = 5),
--        sehingga peringkat "produk terlaris" tidak bermakna.
--      * cast ::BIGINT membuang qty pecahan (0,5 kg menjadi 0/1).
--
--    Tipe kembalian berubah, jadi fungsi harus DI-DROP lebih dulu
--    (CREATE OR REPLACE tidak dapat mengubah signature RETURNS TABLE).
--    Batas atas p_date_to kini EKSKLUSIF.
-- --------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_top_products(timestamptz, timestamptz, integer);

CREATE FUNCTION public.get_top_products(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  product_id INTEGER,
  nama_produk TEXT,
  total_qty NUMERIC,
  total_penjualan NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    ti.product_id,
    ti.nama_produk,
    SUM(COALESCE(ti.base_qty, ti.qty * COALESCE(ti.rasio, 1), ti.qty))::NUMERIC AS total_qty,
    SUM(ti.subtotal)::NUMERIC AS total_penjualan
  FROM public.transaction_items ti
  INNER JOIN public.transactions t ON t.id = ti.transaction_id
  WHERE
    t.tenant_id = public.get_my_tenant_id()
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to
    AND ti.product_id IS NOT NULL
  GROUP BY ti.product_id, ti.nama_produk
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.get_top_products(timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_products(timestamptz, timestamptz, integer) TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 4. get_dashboard_stats — "produk terlaris hari ini" juga berbasis base_qty
--
--    Konsistensi dengan get_top_products di atas: tanpa ini kartu dashboard
--    dan halaman Laporan menampilkan qty berbeda untuk produk yang sama.
--    Sisa fungsi dipertahankan apa adanya dari migrasi 047 (jendela hari WIB
--    yang sudah benar dan filter payment_status).
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id UUID := public.get_my_tenant_id();
  v_today_start TIMESTAMPTZ := (date_trunc('day', NOW() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta');
  v_today_end TIMESTAMPTZ := v_today_start + INTERVAL '1 day';
  v_total_penjualan DECIMAL := 0;
  v_jumlah_transaksi BIGINT := 0;
  v_stok_menipis BIGINT := 0;
  v_produk_terlaris JSONB := NULL;
BEGIN
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object(
      'total_penjualan_hari_ini', 0,
      'jumlah_transaksi_hari_ini', 0,
      'jumlah_produk_stok_menipis', 0,
      'produk_terlaris_hari_ini', NULL
    );
  END IF;

  SELECT
    COALESCE(SUM(total), 0),
    COUNT(*)
  INTO v_total_penjualan, v_jumlah_transaksi
  FROM public.transactions
  WHERE tenant_id = v_tenant_id
    AND created_at >= v_today_start
    AND created_at < v_today_end
    AND status = 'selesai'
    AND payment_status = 'dibayar';

  SELECT COUNT(*)
  INTO v_stok_menipis
  FROM public.products
  WHERE tenant_id = v_tenant_id
    AND stok <= stok_minimum
    AND is_active = true;

  SELECT jsonb_build_object(
    'product_id', ranked.product_id,
    'nama', ranked.nama_produk,
    'qty', ranked.total_qty
  )
  INTO v_produk_terlaris
  FROM (
    SELECT
      ti.product_id,
      ti.nama_produk,
      SUM(COALESCE(ti.base_qty, ti.qty * COALESCE(ti.rasio, 1), ti.qty)) AS total_qty
    FROM public.transaction_items ti
    JOIN public.transactions t ON t.id = ti.transaction_id
    WHERE t.tenant_id = v_tenant_id
      AND t.created_at >= v_today_start
      AND t.created_at < v_today_end
      AND t.status = 'selesai'
      AND t.payment_status = 'dibayar'
    GROUP BY ti.product_id, ti.nama_produk
    ORDER BY SUM(COALESCE(ti.base_qty, ti.qty * COALESCE(ti.rasio, 1), ti.qty)) DESC
    LIMIT 1
  ) ranked;

  RETURN jsonb_build_object(
    'total_penjualan_hari_ini', v_total_penjualan,
    'jumlah_transaksi_hari_ini', v_jumlah_transaksi,
    'jumlah_produk_stok_menipis', v_stok_menipis,
    'produk_terlaris_hari_ini', v_produk_terlaris
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated, service_role;
