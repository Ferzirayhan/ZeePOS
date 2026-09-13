-- ====================================================================
-- Migrasi 049: Multi-Satuan Konversi Stok & Manajemen Piutang Pelanggan
-- ====================================================================

-- 1. Tabel Multi-Satuan Produk (product_units)
CREATE TABLE IF NOT EXISTS public.product_units (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  nama_satuan TEXT NOT NULL,
  rasio NUMERIC(12, 4) NOT NULL DEFAULT 1.0000,
  barcode TEXT,
  harga_beli NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  harga_jual NUMERIC(15, 2) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_units_tenant_product ON public.product_units(tenant_id, product_id);
ALTER TABLE public.product_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_units_tenant_isolation" ON public.product_units
  FOR ALL
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

GRANT ALL ON public.product_units TO authenticated;
GRANT ALL ON SEQUENCE public.product_units_id_seq TO authenticated;

-- 2. Tabel Pelanggan (customers)
CREATE TABLE IF NOT EXISTS public.customers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nama TEXT NOT NULL,
  telepon TEXT,
  alamat TEXT,
  total_hutang NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  catatan TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_nama ON public.customers(tenant_id, nama);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_tenant_isolation" ON public.customers
  FOR ALL
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

GRANT ALL ON public.customers TO authenticated;
GRANT ALL ON SEQUENCE public.customers_id_seq TO authenticated;

-- 3. Tabel Piutang / Bon Transaksi (receivables)
CREATE TABLE IF NOT EXISTS public.receivables (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  transaction_id INTEGER REFERENCES public.transactions(id) ON DELETE SET NULL,
  nomor_nota TEXT NOT NULL,
  total_tagihan NUMERIC(15, 2) NOT NULL,
  jumlah_dibayar NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  sisa_hutang NUMERIC(15, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'belum_lunas' CHECK (status IN ('belum_lunas', 'sebagian', 'lunas')),
  jatuh_tempo DATE,
  catatan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receivables_tenant_customer ON public.receivables(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_receivables_tenant_status ON public.receivables(tenant_id, status);
ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receivables_tenant_isolation" ON public.receivables
  FOR ALL
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

GRANT ALL ON public.receivables TO authenticated;
GRANT ALL ON SEQUENCE public.receivables_id_seq TO authenticated;

-- 4. Tabel Riwayat Pembayaran / Cicilan Piutang (receivable_payments)
CREATE TABLE IF NOT EXISTS public.receivable_payments (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receivable_id INTEGER NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  jumlah NUMERIC(15, 2) NOT NULL,
  metode_bayar TEXT NOT NULL DEFAULT 'tunai',
  catatan TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receivable_payments_tenant_rec ON public.receivable_payments(tenant_id, receivable_id);
ALTER TABLE public.receivable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receivable_payments_tenant_isolation" ON public.receivable_payments
  FOR ALL
  USING (tenant_id = public.get_my_tenant_id())
  WITH CHECK (tenant_id = public.get_my_tenant_id());

GRANT ALL ON public.receivable_payments TO authenticated;
GRANT ALL ON SEQUENCE public.receivable_payments_id_seq TO authenticated;

-- 5. RPC untuk Bayar Cicilan Piutang (pay_receivable_atomic)
CREATE OR REPLACE FUNCTION public.pay_receivable_atomic(
  p_receivable_id INTEGER,
  p_jumlah NUMERIC,
  p_metode_bayar TEXT DEFAULT 'tunai',
  p_catatan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_rec RECORD;
  v_new_dibayar NUMERIC;
  v_new_sisa NUMERIC;
  v_new_status TEXT;
  v_payment_id INTEGER;
BEGIN
  v_tenant_id := public.get_my_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant tidak terautentikasi';
  END IF;

  IF p_jumlah <= 0 THEN
    RAISE EXCEPTION 'Jumlah pembayaran harus lebih dari 0';
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

  -- Update saldo total hutang customer
  UPDATE public.customers
  SET
    total_hutang = GREATEST(0, total_hutang - p_jumlah),
    updated_at = NOW()
  WHERE id = v_rec.customer_id AND tenant_id = v_tenant_id;

  -- Catat riwayat pembayaran
  INSERT INTO public.receivable_payments (
    tenant_id,
    receivable_id,
    jumlah,
    metode_bayar,
    catatan,
    created_by
  ) VALUES (
    v_tenant_id,
    p_receivable_id,
    p_jumlah,
    COALESCE(p_metode_bayar, 'tunai'),
    p_catatan,
    auth.uid()
  ) RETURNING id INTO v_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'receivable_id', p_receivable_id,
    'jumlah_dibayar', p_jumlah,
    'sisa_hutang', v_new_sisa,
    'status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_receivable_atomic TO authenticated;
