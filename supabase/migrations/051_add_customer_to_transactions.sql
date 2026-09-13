-- ====================================================================
-- Migrasi 051: Kolom customer_id pada transactions & RPC Atomik
-- ====================================================================

-- 1. Tambah customer_id ke transactions jika belum ada
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN customer_id integer REFERENCES customers(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_transactions_customer_id ON transactions(customer_id);
  END IF;
END $$;

-- 2. Update fungsi create_transaction_atomic dengan p_customer_id
CREATE OR REPLACE FUNCTION create_transaction_atomic(
  p_items jsonb,
  p_kasir_id uuid,
  p_subtotal numeric,
  p_diskon_persen numeric,
  p_diskon_amount numeric,
  p_ppn_persen numeric,
  p_ppn_amount numeric,
  p_total numeric,
  p_metode_bayar text,
  p_uang_diterima numeric,
  p_kembalian numeric,
  p_catatan text DEFAULT NULL,
  p_customer_id integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_transaction_id integer;
  v_nomor_nota text;
  v_item jsonb;
  v_product_id integer;
  v_qty numeric;
  v_harga_satuan numeric;
  v_subtotal numeric;
  v_diskon_persen numeric;
  v_diskon_amount numeric;
  v_stok_tersedia numeric;
  v_rasio numeric;
  v_stok_terpotong numeric;
  v_satuan text;
  v_status_bayar text;
  v_today_str text;
  v_seq integer;
BEGIN
  -- 1. Tentukan tenant_id
  v_tenant_id := get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: tenant_id tidak terdeteksi.';
  END IF;

  -- 2. Tentukan status pembayaran
  IF p_metode_bayar IN ('qris', 'transfer') THEN
    v_status_bayar := 'pending';
  ELSE
    v_status_bayar := 'completed';
  END IF;

  -- 3. Generate nomor nota unik hari ini
  v_today_str := to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD');
  
  SELECT COALESCE(MAX(SUBSTRING(nomor_nota FROM '\d+$')::integer), 0) + 1
  INTO v_seq
  FROM transactions
  WHERE tenant_id = v_tenant_id
    AND nomor_nota LIKE 'NOTA-' || v_today_str || '-%';

  v_nomor_nota := 'NOTA-' || v_today_str || '-' || LPAD(v_seq::text, 4, '0');

  -- 4. Validasi dan kunci baris produk (FOR UPDATE)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::integer;
    v_qty := (v_item->>'qty')::numeric;
    v_rasio := COALESCE(NULLIF(v_item->>'rasio', '')::numeric, 1);
    v_stok_terpotong := v_qty * v_rasio;

    SELECT stok INTO v_stok_tersedia
    FROM products
    WHERE id = v_product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk ID % tidak ditemukan.', v_product_id;
    END IF;

    IF v_stok_tersedia < v_stok_terpotong THEN
      RAISE EXCEPTION 'Stok tidak mencukupi untuk produk ID % (sisa %, diminta %).',
        v_product_id, v_stok_tersedia, v_stok_terpotong;
    END IF;
  END LOOP;

  -- 5. Insert ke tabel transactions
  INSERT INTO transactions (
    tenant_id,
    nomor_nota,
    kasir_id,
    customer_id,
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
    paid_at
  ) VALUES (
    v_tenant_id,
    v_nomor_nota,
    p_kasir_id,
    p_customer_id,
    p_subtotal,
    p_diskon_persen,
    p_diskon_amount,
    p_ppn_persen,
    p_ppn_amount,
    p_total,
    p_metode_bayar::metode_bayar,
    p_uang_diterima,
    p_kembalian,
    p_catatan,
    v_status_bayar::payment_status,
    CASE WHEN v_status_bayar = 'completed' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_transaction_id;

  -- 6. Insert items & kurangi stok produk
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::integer;
    v_qty := (v_item->>'qty')::numeric;
    v_harga_satuan := (v_item->>'harga_satuan')::numeric;
    v_subtotal := (v_item->>'subtotal')::numeric;
    v_diskon_persen := COALESCE((v_item->>'diskon_persen')::numeric, 0);
    v_diskon_amount := COALESCE((v_item->>'diskon_amount')::numeric, 0);
    v_rasio := COALESCE(NULLIF(v_item->>'rasio', '')::numeric, 1);
    v_satuan := COALESCE(v_item->>'satuan', 'pcs');
    v_stok_terpotong := v_qty * v_rasio;

    INSERT INTO transaction_items (
      tenant_id,
      transaction_id,
      product_id,
      nama_produk,
      qty,
      harga_satuan,
      subtotal,
      diskon_persen,
      diskon_amount
    ) VALUES (
      v_tenant_id,
      v_transaction_id,
      v_product_id,
      v_item->>'nama_produk',
      v_qty,
      v_harga_satuan,
      v_subtotal,
      v_diskon_persen,
      v_diskon_amount
    );

    UPDATE products
    SET stok = stok - v_stok_terpotong
    WHERE id = v_product_id AND tenant_id = v_tenant_id;
  END LOOP;

  -- 7. Jika metode hutang / tempo & customer ada, catat otomatis ke piutang
  IF p_metode_bayar = 'hutang' AND p_customer_id IS NOT NULL THEN
    INSERT INTO receivables (
      tenant_id,
      customer_id,
      transaction_id,
      nomor_nota,
      total_tagihan,
      jumlah_dibayar,
      sisa_hutang,
      status
    ) VALUES (
      v_tenant_id,
      p_customer_id,
      v_transaction_id,
      v_nomor_nota,
      p_total,
      COALESCE(p_uang_diterima, 0),
      p_total - COALESCE(p_uang_diterima, 0),
      CASE 
        WHEN COALESCE(p_uang_diterima, 0) >= p_total THEN 'lunas'
        WHEN COALESCE(p_uang_diterima, 0) > 0 THEN 'sebagian'
        ELSE 'belum_lunas'
      END
    );

    -- Update saldo hutang di profil customer
    UPDATE customers
    SET total_hutang = total_hutang + (p_total - COALESCE(p_uang_diterima, 0))
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN v_nomor_nota;
END;
$$;
