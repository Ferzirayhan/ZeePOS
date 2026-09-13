-- 043_cash_shifts.sql
-- Rekap Kas & Shift Kasir (Cash Drawer Management) multi-tenant

CREATE TABLE IF NOT EXISTS cash_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) DEFAULT get_my_tenant_id(),
  kasir_id UUID REFERENCES profiles(id) NOT NULL,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  modal_awal NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_penjualan_tunai NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_penjualan_non_tunai NUMERIC(15,2) NOT NULL DEFAULT 0,
  pengeluaran_kas NUMERIC(15,2) NOT NULL DEFAULT 0,
  uang_fisik_akhir NUMERIC(15,2),
  selisih NUMERIC(15,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  catatan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant ON cash_shifts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cash_shifts_kasir ON cash_shifts(kasir_id, status);

ALTER TABLE cash_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant scoped cash_shifts" ON cash_shifts;
CREATE POLICY "Tenant scoped cash_shifts"
  ON cash_shifts FOR ALL
  TO authenticated
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Add to Realtime publication
ALTER TABLE cash_shifts REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'cash_shifts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE cash_shifts;
  END IF;
END $$;

-- RPC: Get or check active shift for current cashier
CREATE OR REPLACE FUNCTION get_active_cash_shift()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := get_my_tenant_id();
  v_user_id UUID := auth.uid();
  v_shift cash_shifts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_shift
  FROM cash_shifts
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_user_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_shift);
END;
$$;

-- RPC: Open a new cashier shift
CREATE OR REPLACE FUNCTION open_cash_shift(
  p_modal_awal NUMERIC(15,2),
  p_catatan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := get_my_tenant_id();
  v_user_id UUID := auth.uid();
  v_existing_id UUID;
  v_new_shift cash_shifts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi atau tenant tidak valid';
  END IF;

  -- Check if already has an open shift
  SELECT id INTO v_existing_id
  FROM cash_shifts
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_user_id
    AND status = 'open';

  IF FOUND THEN
    RAISE EXCEPTION 'Anda masih memiliki shift aktif yang belum ditutup';
  END IF;

  INSERT INTO cash_shifts (
    tenant_id,
    kasir_id,
    modal_awal,
    status,
    catatan
  )
  VALUES (
    v_tenant_id,
    v_user_id,
    COALESCE(p_modal_awal, 0),
    'open',
    p_catatan
  )
  RETURNING * INTO v_new_shift;

  PERFORM insert_audit_log(
    v_user_id,
    'cash_shift',
    v_new_shift.id::TEXT,
    'shift_opened',
    'Shift kasir dibuka dengan modal awal Rp ' || COALESCE(p_modal_awal, 0)::TEXT,
    jsonb_build_object('modal_awal', p_modal_awal)
  );

  RETURN to_jsonb(v_new_shift);
END;
$$;

-- RPC: Close cashier shift
CREATE OR REPLACE FUNCTION close_cash_shift(
  p_shift_id UUID,
  p_uang_fisik NUMERIC(15,2),
  p_pengeluaran NUMERIC(15,2) DEFAULT 0,
  p_catatan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := get_my_tenant_id();
  v_user_id UUID := auth.uid();
  v_shift cash_shifts%ROWTYPE;
  v_tunai NUMERIC(15,2) := 0;
  v_non_tunai NUMERIC(15,2) := 0;
  v_total_sistem NUMERIC(15,2) := 0;
  v_selisih NUMERIC(15,2) := 0;
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi atau tenant tidak valid';
  END IF;

  SELECT *
  INTO v_shift
  FROM cash_shifts
  WHERE id = p_shift_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift kasir tidak ditemukan';
  END IF;

  IF v_shift.status = 'closed' THEN
    RAISE EXCEPTION 'Shift ini sudah ditutup sebelumnya';
  END IF;

  -- Calculate cash and non-cash transactions during this shift for this cashier
  SELECT
    COALESCE(SUM(CASE WHEN metode_bayar = 'tunai' THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN metode_bayar != 'tunai' THEN total ELSE 0 END), 0)
  INTO v_tunai, v_non_tunai
  FROM transactions
  WHERE tenant_id = v_tenant_id
    AND kasir_id = v_shift.kasir_id
    AND created_at >= v_shift.opened_at
    AND created_at <= NOW()
    AND status = 'selesai'
    AND payment_status = 'dibayar';

  -- Expected cash in drawer = modal_awal + penjualan_tunai - pengeluaran
  v_total_sistem := v_shift.modal_awal + v_tunai - COALESCE(p_pengeluaran, 0);
  v_selisih := COALESCE(p_uang_fisik, 0) - v_total_sistem;

  UPDATE cash_shifts
  SET
    closed_at = NOW(),
    total_penjualan_tunai = v_tunai,
    total_penjualan_non_tunai = v_non_tunai,
    pengeluaran_kas = COALESCE(p_pengeluaran, 0),
    uang_fisik_akhir = COALESCE(p_uang_fisik, 0),
    selisih = v_selisih,
    status = 'closed',
    catatan = COALESCE(p_catatan, catatan)
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  PERFORM insert_audit_log(
    v_user_id,
    'cash_shift',
    v_shift.id::TEXT,
    'shift_closed',
    'Shift kasir ditutup. Uang fisik: Rp ' || p_uang_fisik::TEXT || ', Selisih: Rp ' || v_selisih::TEXT,
    jsonb_build_object(
      'total_tunai', v_tunai,
      'total_non_tunai', v_non_tunai,
      'pengeluaran', p_pengeluaran,
      'uang_fisik', p_uang_fisik,
      'selisih', v_selisih
    )
  );

  RETURN to_jsonb(v_shift);
END;
$$;
