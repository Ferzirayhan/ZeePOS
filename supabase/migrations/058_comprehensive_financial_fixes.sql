-- ====================================================================
-- Migrasi 058: Comprehensive Financial Hardening & Ledger Fixes
-- ====================================================================
-- 1. Drop overload usang refund_transaction_atomic(integer, text).
-- 2. Proteksi ketat customers pada INSERT & UPDATE (kunci total_hutang & is_active).
-- 3. Izinkan transaksi total Rp 0 di transaction_refunds (amount >= 0).
-- 4. Perbaiki kalkulasi close_cash_shift (hindari double deduction refund).
-- 5. Refund transaksi hutang: batalkan receivable dan kurangi total_hutang.
-- 6. Atribusi refund ke shift transaksi sumber jika approver tidak punya shift.
-- 7. Kunci row customer FOR UPDATE dan validasi is_active = true di checkout.
-- 8. Return computed items dari create_transaction_atomic untuk akurasi struk.
-- ====================================================================

-- 1. Drop overload usang
DROP FUNCTION IF EXISTS public.refund_transaction_atomic(integer, text);

-- 2. Izinkan amount >= 0 di transaction_refunds
ALTER TABLE public.transaction_refunds
  DROP CONSTRAINT IF EXISTS transaction_refunds_amount_check;
ALTER TABLE public.transaction_refunds
  ADD CONSTRAINT transaction_refunds_amount_check CHECK (amount >= 0);

-- 3. Proteksi ketat field pelanggan pada INSERT & UPDATE
CREATE OR REPLACE FUNCTION public.protect_customer_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('zeepos.internal_mutation', true) IS DISTINCT FROM 'true' THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.total_hutang, 0) <> 0 THEN
        RAISE EXCEPTION 'Saldo awal total_hutang wajib 0 pada pelanggan baru. Hutang hanya tercipta melalui transaksi bon.';
      END IF;
      IF NEW.is_active IS DISTINCT FROM true THEN
        NEW.is_active := true;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.total_hutang IS DISTINCT FROM NEW.total_hutang THEN
        RAISE EXCEPTION 'Kolom total_hutang tidak dapat diubah secara langsung. Gunakan transaksi atau pembayaran piutang.';
      END IF;
      IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
        RAISE EXCEPTION 'Status is_active pelanggan hanya dapat diubah melalui RPC archive_customer.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customer_financial_fields_guard ON public.customers;
CREATE TRIGGER customer_financial_fields_guard
BEFORE INSERT OR UPDATE OF total_hutang, is_active ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.protect_customer_financial_fields();

-- 4. RPC refund_transaction_atomic komprehensif
CREATE OR REPLACE FUNCTION public.refund_transaction_atomic(
  p_transaction_id integer,
  p_alasan text,
  p_idempotency_key text
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

  -- Cari shift kasir aktif approver, jika tidak ada fallback ke shift kasir transaksi yang sedang open
  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE tenant_id = v_tenant_id AND kasir_id = v_user_id AND status = 'open';

  IF v_shift_id IS NULL AND v_trx.kasir_id IS NOT NULL THEN
    SELECT id INTO v_shift_id
    FROM public.cash_shifts
    WHERE tenant_id = v_tenant_id AND kasir_id = v_trx.kasir_id AND status = 'open';
  END IF;

  -- KASUS KHUSUS: Transaksi metode hutang
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
$$;

-- 5. Perbaiki close_cash_shift (Akurasi Uang Kas Shift)
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
  v_gross_tunai_penjualan numeric(15,2) := 0;
  v_tunai_piutang numeric(15,2) := 0;
  v_refund_tunai numeric(15,2) := 0;
  v_net_tunai numeric(15,2) := 0;
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

  -- 1. Penjualan tunai gross (semua penjualan tunai yang dibuat selama shift berlangsung)
  -- Menggunakan paid_at / created_at shift kasir tanpa terpengaruh pembatalan berikutnya
  SELECT COALESCE(SUM(total), 0)
  INTO v_gross_tunai_penjualan
  FROM public.transactions
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND metode_bayar = 'tunai'
    AND payment_status = 'dibayar';

  -- 2. Penerimaan cicilan piutang tunai
  SELECT COALESCE(SUM(jumlah), 0)
  INTO v_tunai_piutang
  FROM public.receivable_payments
  WHERE tenant_id = v_tenant_id
    AND created_by = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND metode_bayar = 'tunai';

  -- 3. Refund tunai resmi selama shift
  SELECT COALESCE(SUM(amount), 0)
  INTO v_refund_tunai
  FROM public.transaction_refunds
  WHERE tenant_id = v_tenant_id
    AND (
      cash_shift_id = p_shift_id
      OR (cash_shift_id IS NULL AND requested_by = v_shift.kasir_id AND created_at >= v_shift.opened_at)
    )
    AND payment_method = 'tunai';

  -- Kas bersih tunai = (penjualan tunai kotor + cicilan piutang tunai) - refund tunai
  v_net_tunai := v_gross_tunai_penjualan + v_tunai_piutang - v_refund_tunai;

  -- 4. Penerimaan non-tunai riil (QRIS & Transfer) yang statusnya selesai
  SELECT COALESCE(SUM(total), 0)
  INTO v_non_tunai_rill
  FROM public.transactions
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND status = 'selesai'
    AND payment_status = 'dibayar'
    AND metode_bayar IN ('qris', 'transfer');

  v_total_sistem := v_shift.modal_awal + v_net_tunai - COALESCE(p_pengeluaran, 0);
  v_selisih := COALESCE(p_uang_fisik, 0) - v_total_sistem;

  UPDATE public.cash_shifts
  SET
    closed_at = now(),
    total_penjualan_tunai = v_net_tunai,
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
      'total_tunai', v_net_tunai,
      'gross_penjualan_tunai', v_gross_tunai_penjualan,
      'tunai_piutang', v_tunai_piutang,
      'refund_tunai', v_refund_tunai,
      'non_tunai', v_non_tunai_rill,
      'selisih', v_selisih
    )
  );

  RETURN to_jsonb(v_shift);
END;
$$;

-- 6. create_transaction_atomic dengan Customer Locking & Return Items Detail
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

  -- 1. Validasi & Lock Pelanggan di awal
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

      SELECT subtotal, diskon_amount, ppn_amount, total, kembalian
      INTO v_computed_subtotal, v_diskon_amount, v_ppn_amount, v_total, v_kembalian
      FROM public.transactions WHERE id = v_existing_id;

      SELECT jsonb_agg(to_jsonb(ti)) INTO v_result_items
      FROM public.transaction_items ti
      WHERE ti.transaction_id = v_existing_id AND ti.tenant_id = v_tenant_id;

      RETURN jsonb_build_object(
        'transaction_id', v_existing_id, 'nomor_nota', v_existing_nota,
        'payment_status', v_existing_status, 'subtotal', v_computed_subtotal,
        'diskon_amount', v_diskon_amount, 'ppn_amount', v_ppn_amount,
        'total', v_total, 'kembalian', v_kembalian, 'items', v_result_items, 'idempotent', true
      );
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

    PERFORM set_config('zeepos.internal_mutation', 'true', true);

    UPDATE public.customers
    SET total_hutang = total_hutang + v_total, updated_at = NOW()
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  END IF;

  -- Ambil representasi item tersimpan untuk struk resmi
  SELECT jsonb_agg(to_jsonb(ti)) INTO v_result_items
  FROM public.transaction_items ti
  WHERE ti.transaction_id = v_transaction_id AND ti.tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'nomor_nota', v_nomor_nota,
    'payment_status', v_payment_status,
    'subtotal', v_computed_subtotal,
    'diskon_amount', v_diskon_amount,
    'ppn_amount', v_ppn_amount,
    'total', v_total,
    'kembalian', v_kembalian,
    'items', v_result_items,
    'idempotent', false
  );
END;
$function$;
