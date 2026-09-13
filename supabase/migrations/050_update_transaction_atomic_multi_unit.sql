-- ====================================================================
-- Migrasi 050: Update create_transaction_atomic untuk Multi-Satuan Rasio
-- ====================================================================

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
  p_catatan text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction_id INTEGER;
  v_nomor_nota TEXT;
  v_product RECORD;
  v_item JSONB;
  v_items JSONB;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID;
  v_product_id INTEGER;
  v_qty DECIMAL;
  v_rasio DECIMAL;
  v_stok_potong DECIMAL;
  v_harga_satuan DECIMAL;
  v_subtotal_item DECIMAL;
  v_nama_produk TEXT;
  v_diskon_item_persen DECIMAL;
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

  v_items := CASE
    WHEN p_items IS NULL THEN NULL
    WHEN jsonb_typeof(p_items) = 'string' THEN (p_items #>> '{}')::JSONB
    ELSE p_items
  END;

  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang transaksi tidak boleh kosong';
  END IF;

  -- 1. Validasi seluruh stok produk (termasuk rasio konversi multi-satuan)
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::DECIMAL;
    v_rasio := COALESCE(NULLIF(v_item->>'rasio', '')::DECIMAL, 1.0);
    v_stok_potong := v_qty * v_rasio;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item transaksi tidak valid';
    END IF;

    SELECT id, nama, stok, is_active, harga_beli
    INTO v_product
    FROM products
    WHERE id = v_product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk dengan ID % tidak ditemukan', v_product_id;
    END IF;

    IF COALESCE(v_product.is_active, false) = false THEN
      RAISE EXCEPTION 'Produk % sudah tidak aktif', v_product.nama;
    END IF;

    IF COALESCE(v_product.stok, 0) < v_stok_potong THEN
      RAISE EXCEPTION 'Stok untuk % tidak mencukupi (dibutuhkan % dasar, tersedia %)',
        v_product.nama, v_stok_potong, v_product.stok;
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
    tenant_id, nomor_nota, kasir_id, subtotal, diskon_persen, diskon_amount,
    ppn_persen, ppn_amount, total, metode_bayar, uang_diterima,
    kembalian, catatan, payment_status, paid_at, confirmed_by
  )
  VALUES (
    v_tenant_id, v_nomor_nota, p_kasir_id,
    COALESCE(p_subtotal, 0), COALESCE(p_diskon_persen, 0), COALESCE(p_diskon_amount, 0),
    COALESCE(p_ppn_persen, 0), COALESCE(p_ppn_amount, 0), COALESCE(p_total, 0),
    p_metode_bayar,
    CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
    CASE WHEN p_metode_bayar = 'tunai' THEN p_kembalian ELSE 0 END,
    p_catatan, v_payment_status, v_paid_at, v_confirmed_by
  )
  RETURNING id INTO v_transaction_id;

  -- 2. Insert items & potong stok berdasarkan rasio satuan
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::DECIMAL;
    v_rasio := COALESCE(NULLIF(v_item->>'rasio', '')::DECIMAL, 1.0);
    v_stok_potong := v_qty * v_rasio;
    v_harga_satuan := COALESCE(NULLIF(v_item->>'harga_satuan', '')::DECIMAL, 0);
    v_subtotal_item := COALESCE(NULLIF(v_item->>'subtotal', '')::DECIMAL, 0);
    v_nama_produk := COALESCE(NULLIF(v_item->>'nama_produk', ''), 'Produk');
    v_diskon_item_persen := COALESCE(NULLIF(v_item->>'diskon_item_persen', '')::DECIMAL, 0);

    SELECT id, nama, stok, harga_beli
    INTO v_product
    FROM products
    WHERE id = v_product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    INSERT INTO transaction_items (
      tenant_id, transaction_id, product_id, nama_produk, harga_satuan, harga_beli,
      qty, subtotal, diskon_item_persen
    )
    VALUES (
      v_tenant_id, v_transaction_id, v_product_id, v_nama_produk, v_harga_satuan,
      COALESCE(v_product.harga_beli, 0), v_qty, v_subtotal_item, v_diskon_item_persen
    );

    UPDATE products
    SET stok = COALESCE(stok, 0) - v_stok_potong
    WHERE id = v_product_id AND tenant_id = v_tenant_id;

    INSERT INTO stock_adjustments (
      tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
      keterangan, reference_id
    )
    VALUES (
      v_tenant_id, v_product_id, p_kasir_id, 'terjual',
      COALESCE(v_product.stok, 0), -v_stok_potong, COALESCE(v_product.stok, 0) - v_stok_potong,
      'Penjualan ' || v_nomor_nota, v_transaction_id::TEXT
    );
  END LOOP;

  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'nomor_nota', v_nomor_nota,
    'payment_status', v_payment_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_transaction_atomic TO authenticated;
