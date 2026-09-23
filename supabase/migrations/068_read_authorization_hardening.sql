-- ====================================================================
-- Migrasi 068 — Pengerasan Otorisasi Sisi Baca (Subtraktif)
--
-- SUBTRAKTIF: Hanya boleh diterapkan SETELAH frontend build #1 live di
-- produksi. Jika diterapkan sebelum frontend siap, select('*') pada
-- tabel products/product_units/transaction_items akan gagal total untuk kasir.
--
-- Rincian:
-- 1. Guard is_admin() pada 4 RPC laporan:
--    - get_profit_summary(timestamptz, timestamptz)
--    - get_top_products(timestamptz, timestamptz, integer)
--    - get_sales_by_date(date, date)
--    - get_dashboard_stats()
-- 2. REVOKE SELECT (harga_beli) ON public.products FROM authenticated
-- 3. REVOKE SELECT (harga_beli) ON public.product_units FROM authenticated
-- 4. REVOKE SELECT (harga_beli, laba_kotor) ON public.transaction_items FROM authenticated
-- 5. Persempit product_price_history_tenant_select dengan AND public.is_admin()
-- 6. Persempit profiles_tenant_select: id = auth.uid() OR public.is_admin()
-- ====================================================================

-- --------------------------------------------------------------------
-- 1. Guard is_admin() pada RPC laporan
-- --------------------------------------------------------------------

-- 1a. get_profit_summary: beralih ke plpgsql untuk guard is_admin()
CREATE OR REPLACE FUNCTION public.get_profit_summary(
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin';
  END IF;

  RETURN QUERY
  SELECT
    DATE(t.created_at AT TIME ZONE 'Asia/Jakarta') AS tanggal,
    SUM(t.total) AS total_omzet,
    SUM(ti_agg.total_hpp) AS total_hpp,
    SUM(t.total) - SUM(ti_agg.total_hpp) AS total_laba,
    COUNT(DISTINCT t.id) AS jumlah_transaksi
  FROM public.transactions t
  INNER JOIN (
    SELECT
      transaction_id,
      SUM(
        harga_beli * COALESCE(base_qty, qty * COALESCE(rasio, 1), qty)
      ) AS total_hpp
    FROM public.transaction_items
    GROUP BY transaction_id
  ) ti_agg ON ti_agg.transaction_id = t.id
  WHERE
    t.tenant_id = public.get_my_tenant_id()
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to
  GROUP BY DATE(t.created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY tanggal ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_profit_summary(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profit_summary(timestamptz, timestamptz) TO authenticated, service_role;

-- 1b. get_top_products: beralih ke plpgsql untuk guard is_admin()
CREATE OR REPLACE FUNCTION public.get_top_products(
  p_date_from TIMESTAMPTZ,
  p_date_to TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  product_id INTEGER,
  nama_produk TEXT,
  total_qty NUMERIC,
  total_penjualan NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin';
  END IF;

  RETURN QUERY
  SELECT
    ti.product_id,
    ti.nama_produk,
    SUM(COALESCE(ti.base_qty, ti.qty * COALESCE(ti.rasio, 1), ti.qty))::NUMERIC AS total_qty,
    SUM(ti.subtotal)::NUMERIC AS total_penjualan
  FROM public.transaction_items ti
  INNER JOIN public.transactions t ON t.id = ti.transaction_id
  WHERE
    t.tenant_id = public.get_my_tenant_id()
    AND t.status = 'selesai'
    AND t.payment_status = 'dibayar'
    AND t.created_at >= p_date_from
    AND t.created_at < p_date_to
    AND ti.product_id IS NOT NULL
  GROUP BY ti.product_id, ti.nama_produk
  ORDER BY total_qty DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_top_products(timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_top_products(timestamptz, timestamptz, integer) TO authenticated, service_role;

-- 1c. get_sales_by_date: beralih ke plpgsql, perbaiki search_path, guard is_admin()
CREATE OR REPLACE FUNCTION public.get_sales_by_date(
  date_from DATE,
  date_to DATE
)
RETURNS TABLE(
  tanggal DATE,
  total_penjualan NUMERIC,
  jumlah_transaksi BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin';
  END IF;

  RETURN QUERY
  SELECT
    DATE(created_at AT TIME ZONE 'Asia/Jakarta') AS tanggal,
    COALESCE(SUM(total), 0)::NUMERIC AS total_penjualan,
    COUNT(*)::BIGINT AS jumlah_transaksi
  FROM public.transactions
  WHERE
    tenant_id = public.get_my_tenant_id()
    AND DATE(created_at AT TIME ZONE 'Asia/Jakarta') BETWEEN date_from AND date_to
    AND status = 'selesai'
    AND payment_status = 'dibayar'
  GROUP BY DATE(created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY tanggal ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_by_date(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_date(date, date) TO authenticated, service_role;

-- 1d. get_dashboard_stats: tambah guard is_admin() di awal body
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id UUID := public.get_my_tenant_id();
  v_today_start TIMESTAMPTZ := (date_trunc('day', NOW() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta');
  v_today_end TIMESTAMPTZ := v_today_start + INTERVAL '1 day';
  v_total_penjualan DECIMAL := 0;
  v_jumlah_transaksi BIGINT := 0;
  v_stok_menipis BIGINT := 0;
  v_produk_terlaris JSONB := NULL;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin';
  END IF;

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
  FROM public.transactions
  WHERE tenant_id = v_tenant_id
    AND created_at >= v_today_start
    AND created_at < v_today_end
    AND status = 'selesai'
    AND payment_status = 'dibayar';

  SELECT COUNT(*)
  INTO v_stok_menipis
  FROM public.products
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
      SUM(COALESCE(ti.base_qty, ti.qty * COALESCE(ti.rasio, 1), ti.qty)) AS total_qty
    FROM public.transaction_items ti
    JOIN public.transactions t ON t.id = ti.transaction_id
    WHERE t.tenant_id = v_tenant_id
      AND t.created_at >= v_today_start
      AND t.created_at < v_today_end
      AND t.status = 'selesai'
      AND t.payment_status = 'dibayar'
    GROUP BY ti.product_id, ti.nama_produk
    ORDER BY SUM(COALESCE(ti.base_qty, ti.qty * COALESCE(ti.rasio, 1), ti.qty)) DESC
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

REVOKE ALL ON FUNCTION public.get_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated, service_role;

-- --------------------------------------------------------------------
-- 2. Cabut hak SELECT harga_beli pada products
-- --------------------------------------------------------------------
REVOKE SELECT (harga_beli) ON public.products FROM authenticated;

-- --------------------------------------------------------------------
-- 3. Cabut hak SELECT harga_beli pada product_units
-- --------------------------------------------------------------------
REVOKE SELECT (harga_beli) ON public.product_units FROM authenticated;

-- --------------------------------------------------------------------
-- 4. Cabut hak SELECT harga_beli & laba_kotor pada transaction_items
-- --------------------------------------------------------------------
REVOKE SELECT (harga_beli, laba_kotor) ON public.transaction_items FROM authenticated;

-- --------------------------------------------------------------------
-- 5. Persempit product_price_history_tenant_select dengan is_admin()
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS product_price_history_tenant_select ON public.product_price_history;
CREATE POLICY product_price_history_tenant_select ON public.product_price_history
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.is_admin());

-- --------------------------------------------------------------------
-- 6. Persempit profiles_tenant_select: profil sendiri OR admin
-- --------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_tenant_select ON public.profiles;
CREATE POLICY profiles_tenant_select ON public.profiles
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND (id = auth.uid() OR public.is_admin()));
