-- ====================================================================
-- Migrasi 065: Tier Diskon Berbasis Stok Dasar & Konsistensi Komentar
-- ====================================================================
-- 1. create_transaction_atomic: cek tier diskon memakai base qty
--    (qty * rasio), bukan qty satuan jual. Beli 2 dus (24 pcs) kini
--    membandingkan 24 terhadap min_qty tier, konsisten dengan UI kasir
--    yang menghitung diskon dari kebutuhan stok dasar.
-- 2. confirm_transaction_payment: koreksi komentar agar sesuai kode —
--    SEMUA pengguna (termasuk admin) wajib shift aktif untuk
--    mengonfirmasi dana masuk.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. create_transaction_atomic — tier diskon berbasis base qty
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

    v_item_subtotal := ROUND(v_harga_satuan_db * v_qty * (1 - v_diskon_item_persen / 100), 2);
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
    v_diskon_amount := ROUND(v_computed_subtotal * v_effective_diskon_persen / 100, 2);
  ELSE
    IF NOT v_is_admin AND COALESCE(p_diskon_amount, 0) > (v_computed_subtotal * 0.1) THEN
      RAISE EXCEPTION 'Diskon nominal kasir melebihi batas 10%% subtotal';
    END IF;
    v_diskon_amount := LEAST(GREATEST(COALESCE(p_diskon_amount, 0), 0), v_computed_subtotal);
  END IF;

  v_after_diskon := v_computed_subtotal - v_diskon_amount;

  -- PPN otomatis
  IF v_server_ppn_persen > 0 THEN
    v_ppn_amount := ROUND(v_after_diskon * v_server_ppn_persen / 100, 2);
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
-- 2. confirm_transaction_payment — emit ulang dengan komentar yang sesuai
--    perilaku aktual: SEMUA pengguna (termasuk admin) wajib shift aktif.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_transaction_payment(
  p_transaction_id INTEGER,
  p_payment_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_transaction transactions%ROWTYPE;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID := get_my_tenant_id();
  v_shift_locked BOOLEAN;
BEGIN
  IF v_current_user IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi atau tenant tidak valid';
  END IF;

  SELECT *
  INTO v_transaction
  FROM transactions
  WHERE id = p_transaction_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  IF v_transaction.status = 'batal' THEN
    RAISE EXCEPTION 'Transaksi sudah dibatalkan';
  END IF;

  IF NOT (is_admin() OR v_transaction.kasir_id = v_current_user) THEN
    RAISE EXCEPTION 'Anda tidak berhak mengonfirmasi transaksi ini';
  END IF;

  -- Idempoten: transaksi yang sudah dibayar tidak diproses ulang
  IF v_transaction.payment_status = 'dibayar' THEN
    RETURN jsonb_build_object(
      'transaction_id', v_transaction.id,
      'payment_status', v_transaction.payment_status
    );
  END IF;

  -- SERIALISASI SHIFT: konfirmasi dana masuk wajib dilakukan di dalam shift
  -- aktif milik pengonfirmasi (berlaku juga untuk admin). Tanpa ini, uang
  -- QRIS/transfer yang dikonfirmasi setelah shift ditutup tidak masuk
  -- rekonsiliasi shift mana pun.
  v_shift_locked := EXISTS (
    SELECT 1
    FROM public.cash_shifts
    WHERE tenant_id = v_tenant_id AND kasir_id = v_current_user AND status = 'open'
    FOR UPDATE
  );
  IF NOT v_shift_locked THEN
    RAISE EXCEPTION 'Tidak ada shift kasir yang aktif. Buka shift terlebih dahulu sebelum mengonfirmasi pembayaran.';
  END IF;

  UPDATE transactions
  SET
    payment_status = 'dibayar',
    paid_at = NOW(),
    confirmed_by = v_current_user,
    payment_reference = NULLIF(p_payment_reference, '')
  WHERE id = p_transaction_id
    AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction_id', p_transaction_id,
    'payment_status', 'dibayar'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_transaction_payment(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_transaction_payment(integer, text) TO authenticated, service_role;
