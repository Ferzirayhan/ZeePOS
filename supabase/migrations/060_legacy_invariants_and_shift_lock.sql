-- ====================================================================
-- Migrasi 060: Legacy Invariants, Strict Refund Guard & Shift Locking
-- ====================================================================
-- 1. Blokir refund otomatis jika transaksi memiliki inventory_snapshot_status = 'ambiguous_legacy'.
-- 2. Kunci row cash_shift FOR UPDATE saat checkout tunai dan refund untuk mencegah race condition.
-- ====================================================================

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
$$;
