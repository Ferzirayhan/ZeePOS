-- ====================================================================
-- Migrasi 056: Hardening Integritas Finansial, Kas, dan Anti-Tamper
-- ====================================================================
-- Menjawab temuan audit production:
-- 1. Cabut policy delete pelanggan; ganti RESTRICT pada foreign key piutang.
-- 2. Fungsi soft-delete/archive_customer (hanya admin, tolak jika ada hutang).
-- 3. Batasi diskon manual di create_transaction_atomic (kasir max 10%, >10% wajib admin).
-- 4. Ambil PPN dari store_settings di database (bukan percaya kiriman client).
-- 5. Partial unique index satu shift aktif per kasir (anti double shift paralel).
-- 6. Idempotency key pada pembayaran piutang (pay_receivable_atomic).
-- 7. Koreksi rekap cash shift (cicilan tunai masuk kas, hutang dipisah dari penerimaan tunai).
-- 8. Refund ledger RPC (refund_transaction_atomic) untuk transaksi yang sudah dibayar.
-- ====================================================================

-- 1. Amankan tabel customers & receivables
-- Hapus policy delete pelanggan dari client
DROP POLICY IF EXISTS customers_tenant_delete ON public.customers;

-- Ubah foreign key receivables_customer_id_fkey dari CASCADE ke RESTRICT
ALTER TABLE public.receivables
  DROP CONSTRAINT IF EXISTS receivables_customer_id_fkey,
  ADD CONSTRAINT receivables_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT;

-- Fungsi arsip/soft-delete pelanggan (admin only, tolak jika ada hutang)
CREATE OR REPLACE FUNCTION public.archive_customer(p_customer_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_cust public.customers%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mengarsipkan pelanggan';
  END IF;

  SELECT * INTO v_cust
  FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pelanggan tidak ditemukan';
  END IF;

  IF COALESCE(v_cust.total_hutang, 0) > 0 THEN
    RAISE EXCEPTION 'Pelanggan masih memiliki sisa piutang sebesar Rp %; lunasi terlebih dahulu sebelum diarsipkan', v_cust.total_hutang;
  END IF;

  UPDATE public.customers
  SET is_active = false, updated_at = NOW()
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object('success', true, 'customer_id', p_customer_id, 'is_active', false);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_customer(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_customer(integer) TO authenticated, service_role;

-- 2. Cegah double shift aktif (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift_per_cashier
  ON public.cash_shifts (tenant_id, kasir_id)
  WHERE status = 'open';

-- 3. Idempotency pada tabel receivable_payments
ALTER TABLE public.receivable_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS receivable_payments_idempotency_key_unique
  ON public.receivable_payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. Update pay_receivable_atomic dengan Idempotency Key & Row Lock
CREATE OR REPLACE FUNCTION public.pay_receivable_atomic(
  p_receivable_id integer,
  p_jumlah numeric,
  p_metode_bayar text DEFAULT 'tunai'::text,
  p_catatan text DEFAULT NULL::text,
  p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_tenant_id UUID := public.get_my_tenant_id();
  v_user_id UUID := auth.uid();
  v_rec RECORD;
  v_new_dibayar NUMERIC;
  v_new_sisa NUMERIC;
  v_new_status TEXT;
  v_payment_id INTEGER;
  v_existing_id INTEGER;
  v_existing_fingerprint TEXT;
  v_fingerprint TEXT;
BEGIN
  IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'User atau tenant tidak terautentikasi';
  END IF;

  IF p_jumlah <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0';
  END IF;

  -- Idempotency check
  v_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'receivable_id', p_receivable_id,
      'jumlah', p_jumlah,
      'metode_bayar', p_metode_bayar
    )::TEXT,
    'sha256'
  ), 'hex');

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::TEXT || ':rec_pay:' || btrim(p_idempotency_key), 0));
    
    SELECT id, request_fingerprint INTO v_existing_id, v_existing_fingerprint
    FROM public.receivable_payments
    WHERE tenant_id = v_tenant_id AND idempotency_key = btrim(p_idempotency_key)
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_fingerprint IS DISTINCT FROM v_fingerprint THEN
        RAISE EXCEPTION 'Kunci idempotensi sudah digunakan untuk pembayaran berbeda';
      END IF;

      SELECT r.sisa_hutang, r.status INTO v_new_sisa, v_new_status
      FROM public.receivables r WHERE r.id = p_receivable_id;

      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_existing_id,
        'receivable_id', p_receivable_id,
        'jumlah_dibayar', p_jumlah,
        'sisa_hutang', v_new_sisa,
        'status', v_new_status,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT * INTO v_rec
  FROM public.receivables
  WHERE id = p_receivable_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data piutang tidak ditemukan';
  END IF;

  IF v_rec.status = 'lunas' THEN
    RAISE EXCEPTION 'Piutang ini sudah lunas';
  END IF;

  IF v_rec.status = 'dibatalkan' THEN
    RAISE EXCEPTION 'Piutang ini sudah dibatalkan';
  END IF;

  IF p_jumlah > v_rec.sisa_hutang THEN
    RAISE EXCEPTION 'Jumlah bayar (Rp %) melebihi sisa hutang (Rp %)', p_jumlah, v_rec.sisa_hutang;
  END IF;

  v_new_dibayar := v_rec.jumlah_dibayar + p_jumlah;
  v_new_sisa := v_rec.sisa_hutang - p_jumlah;

  IF v_new_sisa <= 0 THEN
    v_new_status := 'lunas';
  ELSE
    v_new_status := 'sebagian';
  END IF;

  UPDATE public.receivables
  SET
    jumlah_dibayar = v_new_dibayar,
    sisa_hutang = v_new_sisa,
    status = v_new_status,
    updated_at = NOW()
  WHERE id = p_receivable_id AND tenant_id = v_tenant_id;

  -- Update saldo total hutang customer dengan row lock
  PERFORM 1 FROM public.customers
  WHERE id = v_rec.customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  UPDATE public.customers
  SET
    total_hutang = GREATEST(0, total_hutang - p_jumlah),
    updated_at = NOW()
  WHERE id = v_rec.customer_id AND tenant_id = v_tenant_id;

  -- Catat riwayat pembayaran
  INSERT INTO public.receivable_payments (
    tenant_id,
    receivable_id,
    jumlah,
    metode_bayar,
    catatan,
    created_by,
    idempotency_key,
    request_fingerprint
  ) VALUES (
    v_tenant_id,
    p_receivable_id,
    p_jumlah,
    COALESCE(p_metode_bayar, 'tunai'),
    p_catatan,
    v_user_id,
    btrim(p_idempotency_key),
    v_fingerprint
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'receivable_id', p_receivable_id,
    'jumlah_dibayar', p_jumlah,
    'sisa_hutang', v_new_sisa,
    'status', v_new_status,
    'idempotent', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.pay_receivable_atomic(integer, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_receivable_atomic(integer, numeric, text, text, text) TO authenticated, service_role;

-- 5. Perbaiki close_cash_shift:
-- - Cicilan piutang tunai masuk kas fisik shift.
-- - Transaksi hutang (bon tempo) tidak boleh dihitung sebagai uang non-tunai masuk.
CREATE OR REPLACE FUNCTION public.close_cash_shift(
  p_shift_id uuid,
  p_uang_fisik numeric(15,2),
  p_pengeluaran numeric(15,2) DEFAULT 0,
  p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_user_id uuid := auth.uid();
  v_shift public.cash_shifts%ROWTYPE;
  v_tunai_penjualan numeric(15,2) := 0;
  v_tunai_piutang numeric(15,2) := 0;
  v_total_tunai numeric(15,2) := 0;
  v_non_tunai_rill numeric(15,2) := 0;
  v_total_sistem numeric(15,2);
  v_selisih numeric(15,2);
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User atau tenant tidak aktif';
  END IF;

  SELECT * INTO v_shift
  FROM public.cash_shifts
  WHERE id = p_shift_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift kasir tidak ditemukan';
  END IF;

  IF v_shift.kasir_id IS DISTINCT FROM v_user_id AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Hanya pemilik shift atau admin yang dapat menutup shift';
  END IF;

  IF v_shift.status = 'closed' THEN
    RAISE EXCEPTION 'Shift ini sudah ditutup';
  END IF;

  -- 1. Penjualan langsung tunai
  SELECT COALESCE(SUM(total), 0)
  INTO v_tunai_penjualan
  FROM public.transactions
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND status = 'selesai'
    AND payment_status = 'dibayar'
    AND metode_bayar = 'tunai';

  -- 2. Penerimaan cicilan piutang tunai selama shift berlangsung
  SELECT COALESCE(SUM(jumlah), 0)
  INTO v_tunai_piutang
  FROM public.receivable_payments
  WHERE tenant_id = v_tenant_id
    AND created_by = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND metode_bayar = 'tunai';

  v_total_tunai := v_tunai_penjualan + v_tunai_piutang;

  -- 3. Penerimaan non-tunai riil (QRIS, Transfer) - TIDAK memasukkan 'hutang'
  SELECT COALESCE(SUM(total), 0)
  INTO v_non_tunai_rill
  FROM public.transactions
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND status = 'selesai'
    AND payment_status = 'dibayar'
    AND metode_bayar IN ('qris', 'transfer');

  v_total_sistem := v_shift.modal_awal + v_total_tunai - COALESCE(p_pengeluaran, 0);
  v_selisih := COALESCE(p_uang_fisik, 0) - v_total_sistem;

  UPDATE public.cash_shifts
  SET
    closed_at = now(),
    total_penjualan_tunai = v_total_tunai,
    total_penjualan_non_tunai = v_non_tunai_rill,
    pengeluaran_kas = COALESCE(p_pengeluaran, 0),
    uang_fisik_akhir = COALESCE(p_uang_fisik, 0),
    selisih = v_selisih,
    status = 'closed',
    catatan = COALESCE(p_catatan, catatan)
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  PERFORM public.insert_audit_log(
    v_user_id,
    'cash_shift',
    v_shift.id::text,
    'shift_closed',
    'Shift kasir ditutup',
    jsonb_build_object(
      'total_tunai', v_total_tunai,
      'tunai_piutang', v_tunai_piutang,
      'non_tunai', v_non_tunai_rill,
      'selisih', v_selisih
    )
  );

  RETURN to_jsonb(v_shift);
END;
$$;

REVOKE ALL ON FUNCTION public.close_cash_shift(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(uuid, numeric, numeric, text) TO authenticated, service_role;

-- 6. Update create_transaction_atomic:
-- - Batasi diskon manual: kasir max 10%, diskon > 10% harus admin.
-- - Ambil tarif PPN dari store_settings (bukan percaya persen client).
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
  v_existing_id INTEGER;
  v_existing_nota TEXT;
  v_existing_status payment_status;
  v_existing_fingerprint TEXT;
  v_request_fingerprint TEXT;
  v_idempotent BOOLEAN := false;
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

  v_is_admin := public.is_admin();

  v_items := CASE
    WHEN p_items IS NULL THEN NULL
    WHEN jsonb_typeof(p_items) = 'string' THEN (p_items #>> '{}')::JSONB
    ELSE p_items
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang transaksi tidak boleh kosong';
  END IF;

  -- 1. Validasi Batas Diskon: kasir biasa max 10%
  v_effective_diskon_persen := COALESCE(p_diskon_persen, 0);
  IF v_effective_diskon_persen < 0 OR v_effective_diskon_persen > 100 THEN
    RAISE EXCEPTION 'Diskon transaksi tidak valid';
  END IF;

  IF NOT v_is_admin AND v_effective_diskon_persen > 10 THEN
    RAISE EXCEPTION 'Diskon kasir maksimal 10%%. Diskon lebih besar membutuhkan otorisasi admin';
  END IF;

  -- 2. Ambil tarif PPN dari store_settings di database
  SELECT value INTO v_setting_ppn_val
  FROM public.store_settings
  WHERE tenant_id = v_tenant_id AND key = 'ppn_persen';

  IF COALESCE(p_ppn_persen, 0) > 0 THEN
    -- Client meminta PPN, gunakan tarif resmi toko
    v_server_ppn_persen := COALESCE(NULLIF(v_setting_ppn_val, '')::NUMERIC, 0);
  ELSE
    v_server_ppn_persen := 0;
  END IF;

  -- Fingerprint & Idempotency
  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'items', (SELECT jsonb_agg(jsonb_build_object(
        'product_id', NULLIF(value->>'product_id', '')::INTEGER,
        'unit_id', NULLIF(value->>'unit_id', '')::INTEGER,
        'qty', NULLIF(value->>'qty', '')::NUMERIC
      ) ORDER BY NULLIF(value->>'product_id', '')::INTEGER,
                 NULLIF(value->>'unit_id', '')::INTEGER NULLS FIRST,
                 NULLIF(value->>'qty', '')::NUMERIC)
        FROM jsonb_array_elements(v_items)),
      'diskon_persen', v_effective_diskon_persen,
      'ppn_persen', v_server_ppn_persen,
      'metode_bayar', p_metode_bayar::TEXT,
      'uang_diterima', CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
      'customer_id', p_customer_id,
      'catatan', NULLIF(btrim(p_catatan), '')
    )::TEXT,
    'sha256'
  ), 'hex');

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::TEXT || ':' || btrim(p_idempotency_key), 0));
    SELECT id, nomor_nota, payment_status, request_fingerprint
    INTO v_existing_id, v_existing_nota, v_existing_status, v_existing_fingerprint
    FROM public.transactions
    WHERE tenant_id = v_tenant_id AND idempotency_key = btrim(p_idempotency_key)
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
        RAISE EXCEPTION 'Kunci idempotensi sudah digunakan untuk payload berbeda';
      END IF;

      SELECT subtotal, diskon_amount, ppn_amount, total, kembalian
      INTO v_computed_subtotal, v_diskon_amount, v_ppn_amount, v_total, v_kembalian
      FROM public.transactions WHERE id = v_existing_id;
      RETURN jsonb_build_object(
        'transaction_id', v_existing_id, 'nomor_nota', v_existing_nota,
        'payment_status', v_existing_status, 'subtotal', v_computed_subtotal,
        'diskon_amount', v_diskon_amount, 'ppn_amount', v_ppn_amount,
        'total', v_total, 'kembalian', v_kembalian, 'idempotent', true
      );
    END IF;
  END IF;

  -- Validasi customer tenant
  IF p_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers
      WHERE id = p_customer_id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Pelanggan tidak terdaftar pada tenant ini';
    END IF;
  END IF;

  -- Kumpulkan demand & kalkulasi harga dari DB
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

    SELECT id, nama, stok, is_active, harga_jual, diskon_produk_persen
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

    SELECT COALESCE(MAX(d.diskon_persen), 0)
    INTO v_tier_diskon
    FROM public.product_discount_tiers d
    WHERE d.product_id = v_product_id AND v_qty >= d.min_qty;

    v_produk_diskon := COALESCE(v_product.diskon_produk_persen, 0);
    v_diskon_item_persen := GREATEST(v_tier_diskon, v_produk_diskon);

    v_item_subtotal := ROUND(v_harga_satuan_db * v_qty * (1 - v_diskon_item_persen / 100), 2);
    v_computed_subtotal := v_computed_subtotal + v_item_subtotal;

    INSERT INTO tmp_demand (product_id, total_base_qty, rasio, unit_id, harga_satuan, nama_produk, nama_satuan, qty, diskon_item_persen, item_subtotal)
    VALUES (v_product_id, v_stok_potong, v_rasio, v_unit_id, v_harga_satuan_db, v_nama_produk, v_nama_satuan, v_qty, v_diskon_item_persen, v_item_subtotal);
  END LOOP;

  -- Validasi total stok kolektif
  FOR v_demand IN
    SELECT product_id, SUM(total_base_qty) AS total_base_qty
    FROM tmp_demand
    GROUP BY product_id
  LOOP
    SELECT stok INTO v_product FROM public.products WHERE id = v_demand.product_id AND tenant_id = v_tenant_id FOR UPDATE;

    IF COALESCE(v_product.stok, 0) < v_demand.total_base_qty THEN
      RAISE EXCEPTION 'Stok untuk produk ID % tidak mencukupi (dibutuhkan % dasar, tersedia %)',
        v_demand.product_id, v_demand.total_base_qty, v_product.stok;
    END IF;
  END LOOP;

  -- Hitung diskon header dari subtotal server
  IF v_effective_diskon_persen > 0 THEN
    v_diskon_amount := ROUND(v_computed_subtotal * v_effective_diskon_persen / 100, 2);
  ELSE
    IF NOT v_is_admin AND COALESCE(p_diskon_amount, 0) > (v_computed_subtotal * 0.1) THEN
      RAISE EXCEPTION 'Diskon nominal kasir melebihi batas 10%% subtotal';
    END IF;
    v_diskon_amount := LEAST(GREATEST(COALESCE(p_diskon_amount, 0), 0), v_computed_subtotal);
  END IF;

  v_after_diskon := v_computed_subtotal - v_diskon_amount;

  -- Hitung PPN dari setting database
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
  RETURNING id INTO v_transaction_id;

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

    PERFORM 1 FROM public.customers
    WHERE id = p_customer_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    UPDATE public.customers
    SET total_hutang = total_hutang + v_total, updated_at = NOW()
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'nomor_nota', v_nomor_nota,
    'payment_status', v_payment_status,
    'subtotal', v_computed_subtotal,
    'diskon_amount', v_diskon_amount,
    'ppn_amount', v_ppn_amount,
    'total', v_total,
    'kembalian', v_kembalian,
    'idempotent', v_idempotent
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

-- 7. Refund Ledger RPC (refund_transaction_atomic)
-- Transaksi yang sudah lunas TIDAK BOLEH dihapus/dibatalkan mentah-mentah.
-- Harus melalui refund ledger teraudit dengan persetujuan admin.
CREATE OR REPLACE FUNCTION public.refund_transaction_atomic(
  p_transaction_id integer,
  p_alasan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_user_id uuid := auth.uid();
  v_is_admin boolean := public.is_admin();
  v_trx public.transactions%ROWTYPE;
  v_item public.transaction_items%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_restore_qty numeric(12,3);
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: sesi tidak aktif';
  END IF;

  -- Refund transaksi lunas wajib admin atau persetujuan admin
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Pengembalian dana (refund) transaksi lunas memerlukan hak akses admin';
  END IF;

  IF btrim(COALESCE(p_alasan, '')) = '' THEN
    RAISE EXCEPTION 'Alasan pengembalian dana (refund) wajib diisi';
  END IF;

  SELECT * INTO v_trx
  FROM public.transactions
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  IF v_trx.status = 'batal' THEN
    RAISE EXCEPTION 'Transaksi ini sudah berstatus batal';
  END IF;

  IF v_trx.payment_status <> 'dibayar' THEN
    RAISE EXCEPTION 'Hanya transaksi yang sudah dibayar yang dapat diproses refund';
  END IF;

  -- Kembalikan stok dasar yang terpotong
  FOR v_item IN
    SELECT * FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
  LOOP
    IF v_item.product_id IS NOT NULL THEN
      v_restore_qty := COALESCE(v_item.base_qty, v_item.qty * COALESCE(v_item.rasio, 1), v_item.qty);

      UPDATE public.products
      SET stok = COALESCE(stok, 0) + v_restore_qty
      WHERE id = v_item.product_id AND tenant_id = v_tenant_id;

      INSERT INTO public.stock_adjustments (
        tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
        keterangan, reference_id
      ) VALUES (
        v_tenant_id, v_item.product_id, v_user_id, 'masuk',
        COALESCE(v_item.qty, 0), v_restore_qty, COALESCE(v_item.qty, 0) + v_restore_qty,
        'Refund transaksi ' || v_trx.nomor_nota || ': ' || p_alasan,
        p_transaction_id::TEXT
      );
    END IF;
  END LOOP;

  -- Update status transaksi menjadi batal dengan catatan refund
  UPDATE public.transactions
  SET
    status = 'batal',
    catatan = CONCAT_WS(E'\n', NULLIF(catatan, ''), '[REFUND ADMIN] ' || p_alasan)
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id;

  -- Catat ke audit log resmi
  PERFORM public.insert_audit_log(
    v_user_id,
    'transaction',
    p_transaction_id::TEXT,
    'transaction_refunded',
    'Transaksi ' || v_trx.nomor_nota || ' direfund oleh admin. Alasan: ' || p_alasan,
    jsonb_build_object(
      'total_kembali', v_trx.total,
      'metode_bayar', v_trx.metode_bayar,
      'alasan', p_alasan
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'nomor_nota', v_trx.nomor_nota,
    'status', 'batal',
    'total_refund', v_trx.total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_transaction_atomic(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_transaction_atomic(integer, text) TO authenticated, service_role;
