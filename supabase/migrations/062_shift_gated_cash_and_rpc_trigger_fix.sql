-- ====================================================================
-- Migrasi 062: Shift-Gated Cash Movements + RPC-Safe Customer Guard
-- ====================================================================
-- Perbaikan atas migration 061:
--
-- 1. REGRESI 061: trigger guard finansial customer memakai auth.role(), yang membaca
--    klaim JWT (request.jwt.claim.role). Di dalam fungsi SECURITY DEFINER klaim itu
--    TETAP 'authenticated', sehingga UPDATE total_hutang/is_active yang sah dari RPC
--    (create_transaction_atomic bon, pay_receivable_atomic, cancel_transaction_atomic,
--    archive_customer) akan ditolak salah — checkout bon & cicilan rusak.
--    Fix: trigger dibuat SECURITY INVOKER sehingga current_user mencerminkan role
--    efektif pemanggil: 'postgres' di dalam RPC SECURITY DEFINER (diizinkan),
--    'authenticated'/'anon'/'service_role' untuk UPDATE langsung klien (ditolak).
--    REVOKE kolom dari 061 dipertahankan sebagai lapisan pertama.
--
-- 2. GAP SHIFT RACE (sisa temuan audit): 061 menambahkan `PERFORM 1 FROM cash_shifts
--    ... FOR UPDATE` pada checkout tunai & cicilan tunai, tetapi probe itu tidak
--    memvalidasi hasilnya. Jika shift sudah ditutup, checkout tetap berjalan TANPA
--    shift sehingga uang kas tidak tercatat di shift mana pun ("transaksi yatim"
--    di antara close shift lama dan open shift baru).
--    Fix: transaksi tunai WAJIB menemukan shift aktif milik kasir (row-locked,
--    diserialisasi terhadap close_cash_shift); jika tidak ada, RPC menolak dengan
--    pesan jelas dan kasir membuka shift baru terlebih dahulu.
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Guard finansial customer yang aman untuk RPC SECURITY DEFINER
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_customer_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
-- Sengaja SECURITY INVOKER (bukan DEFINER): current_user di dalam trigger mencerminkan
-- role efektif pada titik trigger dijalankan. Di dalam RPC SECURITY DEFINER milik
-- pemilik tabel (postgres), current_user = postgres -> mutasi lewat RPC diizinkan.
-- UPDATE langsung dari klien PostgREST berjalan sebagai authenticated/anon -> ditolak.
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Selalu paksa pelanggan baru mulai dari saldo hutang 0 dan aktif
    NEW.total_hutang := 0;
    NEW.is_active := true;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Tolak penulisan langsung dari sesi klien; hanya RPC SECURITY DEFINER (postgres)
    -- yang diizinkan mengubah kolom finansial ini.
    IF current_user IN ('authenticated', 'anon', 'authenticator', 'service_role') THEN
      IF OLD.total_hutang IS DISTINCT FROM NEW.total_hutang THEN
        RAISE EXCEPTION 'Kolom total_hutang hanya dapat diperbarui melalui RPC transaksi atau pembayaran piutang.';
      END IF;
      IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        RAISE EXCEPTION 'Status is_active pelanggan hanya dapat diubah melalui RPC archive_customer.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Lapisan pertama dari 061, dipertahankan: tanpa privilege kolom, klien tidak bisa
-- menyentuh kedua kolom ini sama sekali.
REVOKE UPDATE (total_hutang, is_active) ON public.customers FROM authenticated, anon, PUBLIC;

-- Fungsi trigger tidak boleh dipanggil langsung oleh klien mana pun.
REVOKE ALL ON FUNCTION public.protect_customer_financial_fields() FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------
-- 2. pay_receivable_atomic: cicilan tunai wajib punya shift aktif
--    (body identik dengan 061, hanya blok serialisasi shift yang diperkuat)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pay_receivable_atomic(
  p_receivable_id integer,
  p_jumlah numeric,
  p_metode_bayar text,
  p_catatan text,
  p_idempotency_key text
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

  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'Kunci idempotensi (idempotency key) wajib disertakan untuk mencegah pembayaran ganda';
  END IF;

  -- Idempotency check
  v_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'receivable_id', p_receivable_id,
      'jumlah', p_jumlah,
      'metode_bayar', p_metode_bayar,
      'catatan', btrim(COALESCE(p_catatan, ''))
    )::TEXT,
    'sha256'
  ), 'hex');

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

  -- SERIALISASI SHIFT: pembayaran tunai BARU wajib memiliki shift kasir aktif dan
  -- mengunci barisnya supaya diserialisasi terhadap close_cash_shift. Ditempatkan
  -- SETELAH lookup idempotensi agar retry atas pembayaran yang sudah commit tetap
  -- berhasil meski shift sudah ditutup.
  IF COALESCE(p_metode_bayar, 'tunai') = 'tunai' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.cash_shifts
      WHERE tenant_id = v_tenant_id AND kasir_id = v_user_id AND status = 'open'
      FOR UPDATE
    ) THEN
      RAISE EXCEPTION 'Tidak ada shift kasir yang aktif. Buka shift terlebih dahulu sebelum menerima cicilan tunai.';
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

  PERFORM 1 FROM public.customers
  WHERE id = v_rec.customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  UPDATE public.customers
  SET
    total_hutang = GREATEST(0, total_hutang - p_jumlah),
    updated_at = NOW()
  WHERE id = v_rec.customer_id AND tenant_id = v_tenant_id;

  -- Catat pembayaran
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

-- --------------------------------------------------------------------
-- 3. create_transaction_atomic: checkout tunai wajib punya shift aktif
--    (body identik dengan 061, hanya blok serialisasi shift yang diperkuat)
-- --------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.pay_receivable_atomic(integer, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_receivable_atomic(integer, numeric, text, text, text) TO authenticated, service_role;
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
        RAISE EXCEPTION 'Kunci idempotensi sudah digunakan untuk transaksi atau metode pembayaran berbeda';
      END IF;

      SELECT * INTO v_final_trx FROM public.transactions WHERE id = v_existing_id;

      SELECT jsonb_agg(to_jsonb(ti)) INTO v_result_items
      FROM public.transaction_items ti
      WHERE ti.transaction_id = v_existing_id AND ti.tenant_id = v_tenant_id;

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
  END IF;

  -- SERIALISASI SHIFT: transaksi tunai BARU wajib memiliki shift kasir aktif dan
  -- mengunci barisnya supaya diserialisasi terhadap close_cash_shift. Tanpa validasi
  -- ini, checkout tunai setelah shift ditutup menghasilkan uang kas yang tidak
  -- tercatat di shift mana pun. Ditempatkan SETELAH lookup idempotensi agar retry
  -- atas transaksi yang sudah commit tetap berhasil meski shift sudah ditutup.
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

  -- Cek stok kolektif
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

-- Buat signature checkout eksplisit tunggal: revoke semua overload lain (defensif
-- terhadap resurrect overload legacy) dan grant khusus signature 14-argumen ini.
REVOKE ALL ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  public.metode_bayar, numeric, numeric, text, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  public.metode_bayar, numeric, numeric, text, integer, text
) TO authenticated, service_role;
