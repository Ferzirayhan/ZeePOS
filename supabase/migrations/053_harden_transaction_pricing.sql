-- ====================================================================
-- Migrasi 053: Hardening create_transaction_atomic
-- ====================================================================
-- Masalah: versi sebelumnya (051) mempercayai harga_satuan, subtotal,
-- diskon_amount, ppn_amount, dan total yang dikirim dari client tanpa
-- validasi ulang ke harga produk di database. Klien yang termodifikasi
-- (devtools/network tab) bisa mengirim total lebih rendah dari
-- seharusnya sementara stok tetap terpotong sesuai qty asli.
--
-- Perbaikan: harga per item sekarang SELALU diambil ulang dari
-- `products.harga_jual` (satuan dasar) atau `product_units.harga_jual`
-- (satuan alternatif, dikunci lewat unit_id + tenant_id), lalu subtotal,
-- diskon header, ppn, dan total dihitung ulang di server. Nilai yang
-- dikirim client (p_harga_satuan, p_subtotal, p_diskon_amount,
-- p_ppn_amount, p_total, p_kembalian) hanya dipakai sebagai referensi
-- tampilan lama dan TIDAK lagi dipercaya untuk disimpan.
--
-- Bug tambahan yang ditemukan & dibereskan di migrasi ini: migrasi 051
-- mendefinisikan ulang create_transaction_atomic dengan tipe parameter
-- p_metode_bayar TEXT, padahal migrasi 050 sebelumnya memakai tipe
-- enum metode_bayar. Karena tipe parameter berbeda, CREATE OR REPLACE
-- tidak menimpa fungsi lama, melainkan membuat OVERLOAD baru -- jadi
-- saat ini ada 3 versi create_transaction_atomic hidup berbarengan di
-- database, dan salah satunya (dari 051) mencoba meng-cast status
-- 'completed'/'pending' ke enum payment_status yang sebenarnya cuma
-- berisi menunggu_konfirmasi/dibayar/gagal -- otomatis error tiap kali
-- overload itu yang kepanggil. Blok DO di bawah membersihkan SEMUA
-- overload lama sebelum fungsi final dibuat, supaya cuma ada satu
-- definisi yang tidak ambigu.
-- ====================================================================

DO $cleanup$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_transaction_atomic'
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.signature);
  END LOOP;
END;
$cleanup$;

CREATE FUNCTION public.create_transaction_atomic(
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
  p_customer_id integer DEFAULT NULL
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
  v_unit RECORD;
  v_item JSONB;
  v_items JSONB;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID;

  v_product_id INTEGER;
  v_unit_id INTEGER;
  v_qty DECIMAL;
  v_rasio DECIMAL;
  v_stok_potong DECIMAL;
  v_harga_satuan_db DECIMAL;
  v_nama_produk TEXT;
  v_diskon_item_persen DECIMAL;
  v_item_subtotal DECIMAL;

  v_computed_subtotal DECIMAL := 0;
  v_diskon_amount DECIMAL := 0;
  v_after_diskon DECIMAL := 0;
  v_ppn_amount DECIMAL := 0;
  v_total DECIMAL := 0;
  v_kembalian DECIMAL := 0;

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

  -- 1. Validasi stok + hitung ulang harga & subtotal dari database (bukan dari client)
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::DECIMAL;
    v_unit_id := NULLIF(v_item->>'unit_id', '')::INTEGER;
    v_diskon_item_persen := COALESCE(NULLIF(v_item->>'diskon_item_persen', '')::DECIMAL, 0);

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item transaksi tidak valid';
    END IF;

    IF v_diskon_item_persen < 0 OR v_diskon_item_persen > 100 THEN
      RAISE EXCEPTION 'Diskon item tidak valid untuk produk ID %', v_product_id;
    END IF;

    SELECT id, nama, stok, is_active, harga_jual
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

    -- Harga & rasio SELALU diambil dari DB, bukan dari payload client
    IF v_unit_id IS NOT NULL THEN
      SELECT id, rasio, harga_jual
      INTO v_unit
      FROM product_units
      WHERE id = v_unit_id AND product_id = v_product_id AND tenant_id = v_tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Satuan produk tidak valid untuk produk %', v_product.nama;
      END IF;

      v_rasio := v_unit.rasio;
      v_harga_satuan_db := v_unit.harga_jual;
    ELSE
      v_rasio := 1;
      v_harga_satuan_db := v_product.harga_jual;
    END IF;

    v_stok_potong := v_qty * v_rasio;

    IF COALESCE(v_product.stok, 0) < v_stok_potong THEN
      RAISE EXCEPTION 'Stok untuk % tidak mencukupi (dibutuhkan % dasar, tersedia %)',
        v_product.nama, v_stok_potong, v_product.stok;
    END IF;

    v_item_subtotal := ROUND(v_harga_satuan_db * v_qty * (1 - v_diskon_item_persen / 100), 2);
    v_computed_subtotal := v_computed_subtotal + v_item_subtotal;
  END LOOP;

  -- 2. Hitung ulang diskon header, ppn, dan total dari subtotal hasil hitung server
  IF p_diskon_persen IS NOT NULL AND p_diskon_persen > 0 THEN
    IF p_diskon_persen > 100 THEN
      RAISE EXCEPTION 'Diskon transaksi tidak valid';
    END IF;
    v_diskon_amount := ROUND(v_computed_subtotal * p_diskon_persen / 100, 2);
  ELSE
    -- Diskon nominal manual tetap diperbolehkan, tapi dikunci maksimal sebesar subtotal
    v_diskon_amount := LEAST(GREATEST(COALESCE(p_diskon_amount, 0), 0), v_computed_subtotal);
  END IF;

  v_after_diskon := v_computed_subtotal - v_diskon_amount;

  IF p_ppn_persen IS NOT NULL AND p_ppn_persen > 0 THEN
    v_ppn_amount := ROUND(v_after_diskon * p_ppn_persen / 100, 2);
  ELSE
    v_ppn_amount := 0;
  END IF;

  v_total := GREATEST(v_after_diskon + v_ppn_amount, 0);

  -- 3. Validasi pembayaran terhadap total yang sudah dihitung ulang
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

  v_nomor_nota := generate_nomor_nota();

  INSERT INTO transactions (
    tenant_id, nomor_nota, kasir_id, customer_id, subtotal, diskon_persen, diskon_amount,
    ppn_persen, ppn_amount, total, metode_bayar, uang_diterima,
    kembalian, catatan, payment_status, paid_at, confirmed_by
  )
  VALUES (
    v_tenant_id, v_nomor_nota, p_kasir_id, p_customer_id,
    v_computed_subtotal, COALESCE(p_diskon_persen, 0), v_diskon_amount,
    COALESCE(p_ppn_persen, 0), v_ppn_amount, v_total,
    p_metode_bayar,
    CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
    v_kembalian,
    p_catatan, v_payment_status, v_paid_at, v_confirmed_by
  )
  RETURNING id INTO v_transaction_id;

  -- 4. Insert item + potong stok, harga tetap dihitung ulang dari DB (bukan dari client)
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::DECIMAL;
    v_unit_id := NULLIF(v_item->>'unit_id', '')::INTEGER;
    v_diskon_item_persen := COALESCE(NULLIF(v_item->>'diskon_item_persen', '')::DECIMAL, 0);
    v_nama_produk := COALESCE(NULLIF(v_item->>'nama_produk', ''), 'Produk');

    SELECT id, nama, stok, harga_beli, harga_jual
    INTO v_product
    FROM products
    WHERE id = v_product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_unit_id IS NOT NULL THEN
      SELECT id, rasio, harga_jual
      INTO v_unit
      FROM product_units
      WHERE id = v_unit_id AND product_id = v_product_id AND tenant_id = v_tenant_id;

      v_rasio := v_unit.rasio;
      v_harga_satuan_db := v_unit.harga_jual;
    ELSE
      v_rasio := 1;
      v_harga_satuan_db := v_product.harga_jual;
    END IF;

    v_stok_potong := v_qty * v_rasio;
    v_item_subtotal := ROUND(v_harga_satuan_db * v_qty * (1 - v_diskon_item_persen / 100), 2);

    INSERT INTO transaction_items (
      tenant_id, transaction_id, product_id, nama_produk, harga_satuan, harga_beli,
      qty, subtotal, diskon_item_persen
    )
    VALUES (
      v_tenant_id, v_transaction_id, v_product_id, v_nama_produk, v_harga_satuan_db,
      COALESCE(v_product.harga_beli, 0), v_qty, v_item_subtotal, v_diskon_item_persen
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

  -- 5. Piutang / hutang, pakai total hasil hitung server (bukan p_total dari client)
  IF p_metode_bayar = 'hutang' AND p_customer_id IS NOT NULL THEN
    INSERT INTO receivables (
      tenant_id, customer_id, transaction_id, nomor_nota,
      total_tagihan, jumlah_dibayar, sisa_hutang, status
    ) VALUES (
      v_tenant_id, p_customer_id, v_transaction_id, v_nomor_nota,
      v_total, 0, v_total, 'belum_lunas'
    );

    UPDATE customers
    SET total_hutang = total_hutang + v_total
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
    'kembalian', v_kembalian
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  metode_bayar, numeric, numeric, text, integer
) TO authenticated;
