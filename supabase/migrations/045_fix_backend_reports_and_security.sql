-- Migration 045: Fix backend reports and secure atomic stock operations

-- 1. Secure adjust_stock_atomic with strict tenant isolation
CREATE OR REPLACE FUNCTION public.adjust_stock_atomic(
  p_product_id integer,
  p_jenis text,
  p_jumlah numeric,
  p_keterangan text,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_product products%ROWTYPE;
  v_stok_sebelum NUMERIC(12,3);
  v_stok_sesudah NUMERIC(12,3);
  v_jumlah_perubahan NUMERIC(12,3);
  v_tenant_id UUID := get_my_tenant_id();
BEGIN
  IF p_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi atau tenant tidak valid';
  END IF;

  IF p_jenis NOT IN ('masuk', 'keluar', 'koreksi') THEN
    RAISE EXCEPTION 'Jenis penyesuaian tidak valid: %', p_jenis;
  END IF;

  SELECT *
  INTO v_product
  FROM products
  WHERE id = p_product_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan atau tidak berada di tenant Anda';
  END IF;

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
  WHERE id = p_product_id
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

-- 2. Fix get_sales_by_date: enforce tenant isolation and SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_sales_by_date(
  date_from date,
  date_to date
)
RETURNS TABLE(
  tanggal date,
  total_penjualan numeric,
  jumlah_transaksi bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    DATE(created_at AT TIME ZONE 'Asia/Jakarta') AS tanggal,
    COALESCE(SUM(total), 0) AS total_penjualan,
    COUNT(*)::BIGINT AS jumlah_transaksi
  FROM transactions
  WHERE
    tenant_id = get_my_tenant_id()
    AND DATE(created_at AT TIME ZONE 'Asia/Jakarta') BETWEEN date_from AND date_to
    AND status = 'selesai'
    AND payment_status = 'dibayar'
  GROUP BY DATE(created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY tanggal ASC;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.adjust_stock_atomic(integer, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_date(date, date) TO authenticated;
