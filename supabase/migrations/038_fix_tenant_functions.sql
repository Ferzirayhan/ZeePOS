-- Fix multi-tenant in atomic functions & set automatic tenant defaults

-- 1. Default tenant_id from current session
ALTER TABLE categories ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE products ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE transactions ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE transaction_items ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE stock_adjustments ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE store_settings ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE audit_logs ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE product_discount_tiers ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();
ALTER TABLE product_price_history ALTER COLUMN tenant_id SET DEFAULT get_my_tenant_id();

-- 2. Update generate_nomor_nota to be tenant-aware
CREATE OR REPLACE FUNCTION generate_nomor_nota()
RETURNS TEXT AS $$
DECLARE
  v_tenant_id UUID;
  today TEXT;
  counter INTEGER;
  prefix TEXT := 'NOTA';
BEGIN
  v_tenant_id := get_my_tenant_id();
  today := TO_CHAR(NOW(), 'YYYYMMDD');

  SELECT COUNT(*) + 1 INTO counter
  FROM transactions
  WHERE (tenant_id = v_tenant_id OR (v_tenant_id IS NULL AND tenant_id IS NULL))
    AND nomor_nota LIKE '%' || today || '-%';

  RETURN prefix || '-' || today || '-' || LPAD(counter::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update create_transaction_atomic to populate tenant_id explicitly
CREATE OR REPLACE FUNCTION create_transaction_atomic(
  p_items JSONB,
  p_kasir_id UUID,
  p_subtotal DECIMAL,
  p_diskon_persen DECIMAL,
  p_diskon_amount DECIMAL,
  p_ppn_persen DECIMAL,
  p_ppn_amount DECIMAL,
  p_total DECIMAL,
  p_metode_bayar metode_bayar,
  p_uang_diterima DECIMAL,
  p_kembalian DECIMAL,
  p_catatan TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction_id INTEGER;
  v_nomor_nota TEXT;
  v_product RECORD;
  v_item JSONB;
  v_items JSONB;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID;
  v_product_id INTEGER;
  v_qty NUMERIC(12,3);
  v_harga_satuan DECIMAL;
  v_subtotal_item DECIMAL;
  v_nama_produk TEXT;
  v_payment_status payment_status;
  v_paid_at TIMESTAMPTZ;
  v_confirmed_by UUID;
BEGIN
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi';
  END IF;

  IF p_kasir_id IS NULL OR p_kasir_id <> v_current_user THEN
    RAISE EXCEPTION 'Kasir transaksi tidak valid';
  END IF;

  SELECT tenant_id INTO v_tenant_id
  FROM profiles
  WHERE id = v_current_user;

  v_items := CASE
    WHEN p_items IS NULL THEN NULL
    WHEN jsonb_typeof(p_items) = 'string' THEN (p_items #>> '{}')::JSONB
    ELSE p_items
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang transaksi tidak boleh kosong';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::NUMERIC(12,3);

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item transaksi tidak valid';
    END IF;

    SELECT id, nama, stok, is_active, harga_beli, tenant_id
    INTO v_product
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk dengan ID % tidak ditemukan', v_product_id;
    END IF;

    IF v_tenant_id IS NOT NULL AND v_product.tenant_id IS NOT NULL AND v_product.tenant_id <> v_tenant_id THEN
      RAISE EXCEPTION 'Produk tidak berada dalam tenant yang sama';
    END IF;

    IF COALESCE(v_product.is_active, false) = false THEN
      RAISE EXCEPTION 'Produk % sudah tidak aktif', v_product.nama;
    END IF;

    IF COALESCE(v_product.stok, 0) < v_qty THEN
      RAISE EXCEPTION 'Stok untuk % tidak mencukupi', v_product.nama;
    END IF;
  END LOOP;

  v_nomor_nota := generate_nomor_nota();

  IF p_metode_bayar = 'tunai' THEN
    v_payment_status := 'dibayar';
    v_paid_at := NOW();
    v_confirmed_by := p_kasir_id;
  ELSE
    v_payment_status := 'menunggu_konfirmasi';
    v_paid_at := NULL;
    v_confirmed_by := NULL;
  END IF;

  INSERT INTO transactions (
    tenant_id,
    nomor_nota,
    kasir_id,
    subtotal,
    diskon_persen,
    diskon_amount,
    ppn_persen,
    ppn_amount,
    total,
    metode_bayar,
    uang_diterima,
    kembalian,
    catatan,
    payment_status,
    paid_at,
    confirmed_by
  )
  VALUES (
    v_tenant_id,
    v_nomor_nota,
    p_kasir_id,
    COALESCE(p_subtotal, 0),
    COALESCE(p_diskon_persen, 0),
    COALESCE(p_diskon_amount, 0),
    COALESCE(p_ppn_persen, 0),
    COALESCE(p_ppn_amount, 0),
    COALESCE(p_total, 0),
    p_metode_bayar,
    CASE
      WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima
      ELSE NULL
    END,
    CASE
      WHEN p_metode_bayar = 'tunai' THEN p_kembalian
      ELSE 0
    END,
    p_catatan,
    v_payment_status,
    v_paid_at,
    v_confirmed_by
  )
  RETURNING id INTO v_transaction_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::NUMERIC(12,3);
    v_harga_satuan := COALESCE(NULLIF(v_item->>'harga_satuan', '')::DECIMAL, 0);
    v_subtotal_item := COALESCE(NULLIF(v_item->>'subtotal', '')::DECIMAL, 0);
    v_nama_produk := COALESCE(NULLIF(v_item->>'nama_produk', ''), 'Produk');

    SELECT id, nama, stok, harga_beli
    INTO v_product
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    INSERT INTO transaction_items (
      tenant_id,
      transaction_id,
      product_id,
      nama_produk,
      harga_satuan,
      harga_beli,
      qty,
      subtotal
    )
    VALUES (
      v_tenant_id,
      v_transaction_id,
      v_product_id,
      v_nama_produk,
      v_harga_satuan,
      COALESCE(v_product.harga_beli, 0),
      v_qty,
      v_subtotal_item
    );

    UPDATE products
    SET stok = COALESCE(stok, 0) - v_qty
    WHERE id = v_product_id;

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
      v_product_id,
      p_kasir_id,
      'terjual',
      COALESCE(v_product.stok, 0),
      -v_qty,
      COALESCE(v_product.stok, 0) - v_qty,
      'Penjualan ' || v_nomor_nota,
      v_transaction_id::TEXT
    );
  END LOOP;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'nomor_nota', v_nomor_nota,
    'payment_status', v_payment_status
  );
END;
$$;

-- 4. Update adjust_stock_atomic to populate tenant_id
CREATE OR REPLACE FUNCTION adjust_stock_atomic(
  p_product_id INTEGER,
  p_jenis TEXT,
  p_jumlah NUMERIC(12,3),
  p_keterangan TEXT,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product products%ROWTYPE;
  v_stok_sebelum NUMERIC(12,3);
  v_stok_sesudah NUMERIC(12,3);
  v_jumlah_perubahan NUMERIC(12,3);
  v_tenant_id UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID harus disertakan';
  END IF;

  IF p_jenis NOT IN ('masuk', 'keluar', 'koreksi') THEN
    RAISE EXCEPTION 'Jenis penyesuaian tidak valid: %', p_jenis;
  END IF;

  SELECT *
  INTO v_product
  FROM products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan';
  END IF;

  v_tenant_id := v_product.tenant_id;
  v_stok_sebelum := COALESCE(v_product.stok, 0);

  IF p_jenis = 'koreksi' THEN
    v_stok_sesudah := GREATEST(0, p_jumlah);
    v_jumlah_perubahan := v_stok_sesudah - v_stok_sebelum;
  ELSIF p_jenis = 'keluar' THEN
    v_jumlah_perubahan := -ABS(p_jumlah);
    v_stok_sesudah := GREATEST(0, v_stok_sebelum + v_jumlah_perubahan);
  ELSE
    v_jumlah_perubahan := ABS(p_jumlah);
    v_stok_sesudah := GREATEST(0, v_stok_sebelum + v_jumlah_perubahan);
  END IF;

  UPDATE products
  SET stok = v_stok_sesudah
  WHERE id = p_product_id;

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
    p_product_id,
    p_user_id,
    p_jenis,
    v_stok_sebelum,
    v_jumlah_perubahan,
    v_stok_sesudah,
    p_keterangan
  );

  RETURN jsonb_build_object(
    'stok_sebelum', v_stok_sebelum,
    'stok_sesudah', v_stok_sesudah,
    'jumlah_perubahan', v_jumlah_perubahan
  );
END;
$$;
