-- 039_security_and_tenant_hardening.sql
-- Enforce tenant isolation on views and SECURITY DEFINER RPC functions

-- 1. Views: Enforce security_invoker = true so views inherit caller's RLS
DROP VIEW IF EXISTS products_with_category CASCADE;
CREATE VIEW products_with_category WITH (security_invoker = true) AS
SELECT
  p.*,
  c.nama AS category_nama,
  CASE
    WHEN p.stok = 0 THEN 'habis'
    WHEN p.stok <= p.stok_minimum THEN 'menipis'
    ELSE 'aman'
  END AS stok_status
FROM products p
LEFT JOIN categories c ON p.category_id = c.id;

DROP VIEW IF EXISTS transactions_with_kasir CASCADE;
CREATE VIEW transactions_with_kasir WITH (security_invoker = true) AS
SELECT
  t.*,
  p.nama AS kasir_nama,
  confirmer.nama AS confirmed_by_nama,
  COUNT(ti.id) AS jumlah_item,
  COALESCE(SUM(ti.laba_kotor), 0)::NUMERIC(15,2) AS laba_kotor
FROM transactions t
LEFT JOIN profiles p ON t.kasir_id = p.id
LEFT JOIN profiles confirmer ON t.confirmed_by = confirmer.id
LEFT JOIN transaction_items ti ON t.id = ti.transaction_id
GROUP BY t.id, p.nama, confirmer.nama;

DROP VIEW IF EXISTS audit_logs_with_user CASCADE;
CREATE VIEW audit_logs_with_user WITH (security_invoker = true) AS
SELECT
  a.*,
  p.nama AS actor_nama,
  p.role AS actor_role
FROM audit_logs a
LEFT JOIN profiles p ON p.id = a.user_id;

-- 2. get_dashboard_stats scoped to caller tenant
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := get_my_tenant_id();
  v_today_start TIMESTAMPTZ := date_trunc('day', NOW());
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
  FROM transactions
  WHERE tenant_id = v_tenant_id
    AND created_at >= v_today_start
    AND created_at < v_today_end
    AND status = 'selesai'
    AND payment_status = 'dibayar';

  SELECT COUNT(*)
  INTO v_stok_menipis
  FROM products
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
      SUM(ti.qty) AS total_qty
    FROM transaction_items ti
    JOIN transactions t ON t.id = ti.transaction_id
    WHERE t.tenant_id = v_tenant_id
      AND t.created_at >= v_today_start
      AND t.created_at < v_today_end
      AND t.status = 'selesai'
      AND t.payment_status = 'dibayar'
    GROUP BY ti.product_id, ti.nama_produk
    ORDER BY SUM(ti.qty) DESC
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

-- 3. get_profit_summary scoped to caller tenant
CREATE OR REPLACE FUNCTION get_profit_summary(
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
SET search_path = public
AS $$
  SELECT
    DATE(t.created_at AT TIME ZONE 'Asia/Jakarta') AS tanggal,
    SUM(t.total) AS total_omzet,
    SUM(ti_agg.total_hpp) AS total_hpp,
    SUM(t.total) - SUM(ti_agg.total_hpp) AS total_laba,
    COUNT(DISTINCT t.id) AS jumlah_transaksi
  FROM transactions t
  INNER JOIN (
    SELECT
      transaction_id,
      SUM(harga_beli * qty) AS total_hpp
    FROM transaction_items
    GROUP BY transaction_id
  ) ti_agg ON ti_agg.transaction_id = t.id
  WHERE
    t.tenant_id = get_my_tenant_id()
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at <= p_date_to
  GROUP BY DATE(t.created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY tanggal ASC;
$$;

-- 4. get_top_products scoped to caller tenant
CREATE OR REPLACE FUNCTION get_top_products(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  product_id INTEGER,
  nama_produk TEXT,
  total_qty BIGINT,
  total_penjualan NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ti.product_id,
    ti.nama_produk,
    SUM(ti.qty)::BIGINT AS total_qty,
    SUM(ti.subtotal)::NUMERIC AS total_penjualan
  FROM transaction_items ti
  INNER JOIN transactions t ON t.id = ti.transaction_id
  WHERE
    t.tenant_id = get_my_tenant_id()
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at <= p_date_to
    AND ti.product_id IS NOT NULL
  GROUP BY ti.product_id, ti.nama_produk
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;

-- 5. confirm_transaction_payment scoped to caller tenant
CREATE OR REPLACE FUNCTION confirm_transaction_payment(
  p_transaction_id INTEGER,
  p_payment_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction transactions%ROWTYPE;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID := get_my_tenant_id();
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

  IF v_transaction.payment_status = 'dibayar' THEN
    RETURN jsonb_build_object(
      'transaction_id', v_transaction.id,
      'payment_status', v_transaction.payment_status
    );
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

-- 6. cancel_transaction_atomic scoped to caller tenant
CREATE OR REPLACE FUNCTION cancel_transaction_atomic(
  p_transaction_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction transactions%ROWTYPE;
  v_item transaction_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID := get_my_tenant_id();
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
    RETURN jsonb_build_object(
      'transaction_id', v_transaction.id,
      'status', v_transaction.status
    );
  END IF;

  IF NOT (is_admin() OR v_transaction.kasir_id = v_current_user) THEN
    RAISE EXCEPTION 'Anda tidak berhak membatalkan transaksi ini';
  END IF;

  FOR v_item IN
    SELECT *
    FROM transaction_items
    WHERE transaction_id = p_transaction_id
    ORDER BY id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_product
    FROM products
    WHERE id = v_item.product_id
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk untuk item transaksi tidak ditemukan';
    END IF;

    UPDATE products
    SET stok = COALESCE(stok, 0) + v_item.qty
    WHERE id = v_item.product_id
      AND tenant_id = v_tenant_id;

    INSERT INTO stock_adjustments (
      tenant_id,
      product_id,
      user_id,
      jenis,
      jumlah_sebelum,
      jumlah_perubahan,
      jumlah_sesudah,
      keterangan,
      reference_id
    )
    VALUES (
      v_tenant_id,
      v_item.product_id,
      v_current_user,
      'masuk',
      COALESCE(v_product.stok, 0),
      v_item.qty,
      COALESCE(v_product.stok, 0) + v_item.qty,
      'Pembatalan transaksi ' || v_transaction.nomor_nota,
      p_transaction_id::TEXT
    );
  END LOOP;

  UPDATE transactions
  SET status = 'batal'
  WHERE id = p_transaction_id
    AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction_id', p_transaction_id,
    'status', 'batal'
  );
END;
$$;

-- 7. cancel_pending_transaction scoped to caller tenant
CREATE OR REPLACE FUNCTION cancel_pending_transaction(
  p_transaction_id INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction transactions%ROWTYPE;
  v_item transaction_items%ROWTYPE;
  v_product products%ROWTYPE;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID := get_my_tenant_id();
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

  IF v_transaction.payment_status = 'dibayar' THEN
    RAISE EXCEPTION 'Transaksi yang sudah dibayar tidak bisa dibatalkan dari menu pending';
  END IF;

  IF NOT (is_admin() OR v_transaction.kasir_id = v_current_user) THEN
    RAISE EXCEPTION 'Anda tidak berhak membatalkan transaksi ini';
  END IF;

  IF v_transaction.status = 'batal' THEN
    RETURN jsonb_build_object(
      'transaction_id', v_transaction.id,
      'status', v_transaction.status,
      'payment_status', v_transaction.payment_status
    );
  END IF;

  FOR v_item IN
    SELECT *
    FROM transaction_items
    WHERE transaction_id = p_transaction_id
    ORDER BY id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_product
    FROM products
    WHERE id = v_item.product_id
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk untuk item transaksi tidak ditemukan';
    END IF;

    UPDATE products
    SET stok = COALESCE(stok, 0) + v_item.qty
    WHERE id = v_item.product_id
      AND tenant_id = v_tenant_id;

    INSERT INTO stock_adjustments (
      tenant_id,
      product_id,
      user_id,
      jenis,
      jumlah_sebelum,
      jumlah_perubahan,
      jumlah_sesudah,
      keterangan,
      reference_id
    )
    VALUES (
      v_tenant_id,
      v_item.product_id,
      v_current_user,
      'masuk',
      COALESCE(v_product.stok, 0),
      v_item.qty,
      COALESCE(v_product.stok, 0) + v_item.qty,
      COALESCE(p_reason, 'Pembatalan transaksi pending ') || v_transaction.nomor_nota,
      p_transaction_id::TEXT
    );
  END LOOP;

  UPDATE transactions
  SET
    status = 'batal',
    payment_status = 'gagal',
    catatan = CONCAT_WS(E'\n', NULLIF(catatan, ''), COALESCE(p_reason, 'Dibatalkan dari transaksi pending'))
  WHERE id = p_transaction_id
    AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction_id', p_transaction_id,
    'status', 'batal',
    'payment_status', 'gagal'
  );
END;
$$;

-- 8. repack_stock_atomic scoped to caller tenant
CREATE OR REPLACE FUNCTION repack_stock_atomic(
  p_source_product_id INTEGER,
  p_target_product_id INTEGER,
  p_source_qty NUMERIC(12,3),
  p_target_qty NUMERIC(12,3),
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_product products%ROWTYPE;
  v_target_product products%ROWTYPE;
  v_source_stock_before NUMERIC(12,3);
  v_target_stock_before NUMERIC(12,3);
  v_tenant_id UUID := get_my_tenant_id();
BEGIN
  IF p_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi atau tenant tidak valid';
  END IF;

  SELECT *
  INTO v_source_product
  FROM products
  WHERE id = p_source_product_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk sumber tidak ditemukan';
  END IF;

  SELECT *
  INTO v_target_product
  FROM products
  WHERE id = p_target_product_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tujuan tidak ditemukan';
  END IF;

  v_source_stock_before := COALESCE(v_source_product.stok, 0);
  v_target_stock_before := COALESCE(v_target_product.stok, 0);

  IF v_source_stock_before < p_source_qty THEN
    RAISE EXCEPTION 'Stok produk sumber tidak mencukupi';
  END IF;

  UPDATE products
  SET stok = v_source_stock_before - p_source_qty
  WHERE id = p_source_product_id
    AND tenant_id = v_tenant_id;

  UPDATE products
  SET stok = v_target_stock_before + p_target_qty
  WHERE id = p_target_product_id
    AND tenant_id = v_tenant_id;

  INSERT INTO stock_adjustments (
    tenant_id,
    product_id,
    user_id,
    jenis,
    jumlah_sebelum,
    jumlah_perubahan,
    jumlah_sesudah,
    keterangan
  )
  VALUES (
    v_tenant_id,
    p_source_product_id,
    p_user_id,
    'keluar',
    v_source_stock_before,
    p_source_qty,
    v_source_stock_before - p_source_qty,
    'Repack ke ' || v_target_product.nama
  );

  INSERT INTO stock_adjustments (
    tenant_id,
    product_id,
    user_id,
    jenis,
    jumlah_sebelum,
    jumlah_perubahan,
    jumlah_sesudah,
    keterangan
  )
  VALUES (
    v_tenant_id,
    p_target_product_id,
    p_user_id,
    'masuk',
    v_target_stock_before,
    p_target_qty,
    v_target_stock_before + p_target_qty,
    'Hasil repack dari ' || v_source_product.nama
  );

  RETURN jsonb_build_object(
    'source_id', p_source_product_id,
    'source_new_stock', v_source_stock_before - p_source_qty,
    'target_id', p_target_product_id,
    'target_new_stock', v_target_stock_before + p_target_qty
  );
END;
$$;

-- 9. bulk_update_product_prices scoped to caller tenant
CREATE OR REPLACE FUNCTION bulk_update_product_prices(
  p_updates JSONB,
  p_keterangan TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_product_id INTEGER;
  v_harga_beli DECIMAL;
  v_harga_jual DECIMAL;
  v_old_harga_beli DECIMAL;
  v_old_harga_jual DECIMAL;
  v_count INTEGER := 0;
  v_tenant_id UUID := get_my_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Harus login dengan tenant valid';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_updates)
  LOOP
    v_product_id := (v_item->>'product_id')::INTEGER;
    v_harga_beli := NULLIF(v_item->>'harga_beli', '')::DECIMAL;
    v_harga_jual := NULLIF(v_item->>'harga_jual', '')::DECIMAL;

    SELECT harga_beli, harga_jual INTO v_old_harga_beli, v_old_harga_jual
    FROM products
    WHERE id = v_product_id
      AND tenant_id = v_tenant_id;

    IF NOT FOUND THEN CONTINUE; END IF;

    UPDATE products
    SET
      harga_beli = COALESCE(v_harga_beli, harga_beli),
      harga_jual = COALESCE(v_harga_jual, harga_jual),
      updated_at = NOW()
    WHERE id = v_product_id
      AND tenant_id = v_tenant_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 10. record_price_change trigger: inherit tenant_id
CREATE OR REPLACE FUNCTION record_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.harga_beli IS DISTINCT FROM NEW.harga_beli)
    OR (OLD.harga_jual IS DISTINCT FROM NEW.harga_jual) THEN
    INSERT INTO product_price_history (
      tenant_id,
      product_id,
      harga_beli,
      harga_jual,
      changed_by,
      keterangan
    )
    VALUES (
      NEW.tenant_id,
      NEW.id,
      COALESCE(NEW.harga_beli, 0),
      COALESCE(NEW.harga_jual, 0),
      auth.uid(),
      'Update produk'
    );
  END IF;

  RETURN NEW;
END;
$$;
