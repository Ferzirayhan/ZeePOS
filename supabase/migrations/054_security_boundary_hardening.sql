-- Security boundary hardening: active membership, least-privilege RLS and trusted actors.

-- PostgreSQL grants new functions to PUBLIC by default. Change the migration owner's
-- defaults so functions created later start closed, then explicitly allowlist RPCs below.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.tenant_id
  FROM public.profiles AS p
  JOIN public.tenants AS t ON t.id = p.tenant_id
  WHERE p.id = auth.uid()
    AND p.is_active IS TRUE
    AND t.is_active IS TRUE
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.tenants AS t ON t.id = p.tenant_id
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.is_active IS TRUE
      AND t.is_active IS TRUE
  )
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Remove every historical policy on application tables before installing an explicit matrix.
DO $migration$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'tenants', 'categories', 'products', 'transactions',
    'transaction_items', 'stock_adjustments', 'store_settings', 'audit_logs',
    'product_discount_tiers', 'product_price_history', 'cash_shifts',
    'product_units', 'customers', 'receivables', 'receivable_payments'
  ]
  LOOP
    FOR v_policy IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
  END LOOP;
END
$migration$;

-- Explicitly document removal of the onboarding bypass created by migration 037.
DROP POLICY IF EXISTS "Users can insert own profile during registration" ON public.profiles;

CREATE POLICY profiles_tenant_select ON public.profiles FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY tenants_self_select ON public.tenants FOR SELECT TO authenticated
  USING (id = public.get_my_tenant_id());

CREATE OR REPLACE FUNCTION public.update_my_profile(p_nama text, p_username text)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_profile public.profiles;
BEGIN
  IF public.get_my_tenant_id() IS NULL THEN RAISE EXCEPTION 'Akun atau tenant tidak aktif'; END IF;
  IF btrim(COALESCE(p_nama, '')) = '' OR btrim(COALESCE(p_username, '')) = '' THEN
    RAISE EXCEPTION 'Nama dan username wajib diisi';
  END IF;
  UPDATE public.profiles
  SET nama = btrim(p_nama), username = lower(btrim(p_username)), updated_at = now()
  WHERE id = auth.uid() AND tenant_id = public.get_my_tenant_id()
  RETURNING * INTO v_profile;
  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_active(p_user_id uuid, p_is_active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Hanya admin yang dapat mengubah status staf'; END IF;
  IF p_user_id = auth.uid() AND p_is_active IS FALSE THEN RAISE EXCEPTION 'Admin tidak dapat menonaktifkan diri sendiri'; END IF;
  UPDATE public.profiles SET is_active = p_is_active, updated_at = now()
  WHERE id = p_user_id AND tenant_id = public.get_my_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Staf tidak ditemukan'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_tenant_branding(p_nama text, p_slug text)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_tenant public.tenants;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Hanya admin yang dapat mengubah identitas toko'; END IF;
  IF btrim(COALESCE(p_nama, '')) = '' OR btrim(COALESCE(p_slug, '')) = '' THEN
    RAISE EXCEPTION 'Nama dan slug wajib diisi';
  END IF;
  UPDATE public.tenants SET nama = btrim(p_nama), slug = lower(btrim(p_slug)), updated_at = now()
  WHERE id = public.get_my_tenant_id() RETURNING * INTO v_tenant;
  RETURN v_tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_staff_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_tenant_branding(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_staff_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_tenant_branding(text, text) TO authenticated;

-- POS and reporting reads remain available to active tenant members.
CREATE POLICY categories_tenant_select ON public.categories FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY products_tenant_select ON public.products FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY transactions_tenant_select ON public.transactions FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY transaction_items_tenant_select ON public.transaction_items FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY stock_adjustments_tenant_select ON public.stock_adjustments FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY store_settings_tenant_select ON public.store_settings FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY product_discount_tiers_tenant_select ON public.product_discount_tiers FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY product_price_history_tenant_select ON public.product_price_history FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY cash_shifts_tenant_select ON public.cash_shifts FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY product_units_tenant_select ON public.product_units FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY customers_tenant_select ON public.customers FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY receivables_tenant_select ON public.receivables FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY receivable_payments_tenant_select ON public.receivable_payments FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id());
CREATE POLICY audit_logs_admin_select ON public.audit_logs FOR SELECT TO authenticated USING (tenant_id = public.get_my_tenant_id() AND public.is_admin());

-- Catalog and settings writes are admin-only, operation-specific, and tenant-bound.
CREATE POLICY categories_admin_insert ON public.categories FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY categories_admin_update ON public.categories FOR UPDATE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id()) WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY categories_admin_delete ON public.categories FOR DELETE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY products_admin_insert ON public.products FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY products_admin_update ON public.products FOR UPDATE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id()) WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY products_admin_delete ON public.products FOR DELETE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY product_units_admin_insert ON public.product_units FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY product_units_admin_update ON public.product_units FOR UPDATE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id()) WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY product_units_admin_delete ON public.product_units FOR DELETE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY product_discount_tiers_admin_insert ON public.product_discount_tiers FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY product_discount_tiers_admin_update ON public.product_discount_tiers FOR UPDATE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id()) WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY product_discount_tiers_admin_delete ON public.product_discount_tiers FOR DELETE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY store_settings_admin_insert ON public.store_settings FOR INSERT TO authenticated WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY store_settings_admin_update ON public.store_settings FOR UPDATE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id()) WITH CHECK (public.is_admin() AND tenant_id = public.get_my_tenant_id());
CREATE POLICY store_settings_admin_delete ON public.store_settings FOR DELETE TO authenticated USING (public.is_admin() AND tenant_id = public.get_my_tenant_id());

-- Customers are operational POS data: active members may maintain only their tenant's rows.
CREATE POLICY customers_tenant_insert ON public.customers FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY customers_tenant_update ON public.customers FOR UPDATE TO authenticated USING (tenant_id = public.get_my_tenant_id()) WITH CHECK (tenant_id = public.get_my_tenant_id());
CREATE POLICY customers_tenant_delete ON public.customers FOR DELETE TO authenticated USING (tenant_id = public.get_my_tenant_id());

-- Direct writes to transaction/ledger/audit/shift tables are intentionally absent: trusted RPCs own them.
REVOKE INSERT, UPDATE, DELETE ON public.transaction_items, public.stock_adjustments,
  public.product_price_history, public.audit_logs, public.receivables,
  public.receivable_payments, public.cash_shifts FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.transactions FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.adjust_stock_atomic(
  p_product_id integer, p_jenis text, p_jumlah numeric, p_keterangan text, p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_before numeric(12,3);
  v_after numeric(12,3);
  v_change numeric(12,3);
  v_actor uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
BEGIN
  IF NOT public.is_admin() OR v_actor IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'Hanya admin aktif yang dapat menyesuaikan stok'; END IF;
  IF p_user_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Identitas aktor tidak valid'; END IF;
  IF p_jenis NOT IN ('masuk', 'keluar', 'koreksi') OR p_jumlah < 0 THEN RAISE EXCEPTION 'Penyesuaian stok tidak valid'; END IF;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produk tidak ditemukan'; END IF;
  v_before := COALESCE(v_product.stok, 0);
  IF p_jenis = 'koreksi' THEN v_after := p_jumlah; v_change := v_after - v_before;
  ELSIF p_jenis = 'keluar' THEN v_change := -p_jumlah; v_after := v_before + v_change;
  ELSE v_change := p_jumlah; v_after := v_before + v_change; END IF;
  IF v_after < 0 THEN RAISE EXCEPTION 'Stok tidak mencukupi'; END IF;
  UPDATE public.products SET stok = v_after WHERE id = p_product_id AND tenant_id = v_tenant;
  INSERT INTO public.stock_adjustments (tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah, keterangan)
  VALUES (v_tenant, p_product_id, v_actor, p_jenis, v_before, v_change, v_after, p_keterangan);
  RETURN jsonb_build_object('stok_sebelum', v_before, 'stok_sesudah', v_after, 'jumlah_perubahan', v_change);
END;
$$;

CREATE OR REPLACE FUNCTION public.repack_stock_atomic(
  p_source_product_id integer, p_target_product_id integer,
  p_source_qty numeric(12,3), p_target_qty numeric(12,3), p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source public.products%ROWTYPE;
  v_target public.products%ROWTYPE;
  v_source_stock_before numeric(12,3);
  v_target_stock_before numeric(12,3);
  v_actor uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
BEGIN
  IF NOT public.is_admin() OR v_actor IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'Hanya admin aktif yang dapat melakukan repack'; END IF;
  IF p_user_id IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Identitas aktor tidak valid'; END IF;
  IF p_source_product_id = p_target_product_id OR p_source_qty <= 0 OR p_target_qty <= 0 THEN RAISE EXCEPTION 'Parameter repack tidak valid'; END IF;
  SELECT * INTO v_source FROM public.products WHERE id = p_source_product_id AND tenant_id = v_tenant FOR UPDATE;
  SELECT * INTO v_target FROM public.products WHERE id = p_target_product_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_source.id IS NULL OR v_target.id IS NULL THEN RAISE EXCEPTION 'Produk repack tidak ditemukan'; END IF;
  v_source_stock_before := COALESCE(v_source.stok, 0);
  v_target_stock_before := COALESCE(v_target.stok, 0);
  IF v_source_stock_before < p_source_qty THEN RAISE EXCEPTION 'Stok produk sumber tidak mencukupi'; END IF;
  UPDATE public.products SET stok = v_source_stock_before - p_source_qty WHERE id = p_source_product_id AND tenant_id = v_tenant;
  UPDATE public.products SET stok = v_target_stock_before + p_target_qty WHERE id = p_target_product_id AND tenant_id = v_tenant;
  INSERT INTO public.stock_adjustments (tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah, keterangan) VALUES
    (v_tenant, p_source_product_id, v_actor, 'keluar', v_source_stock_before, -p_source_qty, v_source_stock_before - p_source_qty, 'Repack ke ' || v_target.nama),
    (v_tenant, p_target_product_id, v_actor, 'masuk', v_target_stock_before, p_target_qty, v_target_stock_before + p_target_qty, 'Hasil repack dari ' || v_source.nama);
  RETURN jsonb_build_object('source_id', p_source_product_id, 'source_new_stock', v_source_stock_before - p_source_qty, 'target_id', p_target_product_id, 'target_new_stock', v_target_stock_before + p_target_qty);
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock_atomic(integer, text, numeric, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.repack_stock_atomic(integer, integer, numeric, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_atomic(integer, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repack_stock_atomic(integer, integer, numeric, numeric, uuid) TO authenticated;

-- Retain the sole legacy signature for PostgREST compatibility, but derive authority and history actor from the session.
CREATE OR REPLACE FUNCTION public.bulk_update_product_prices(
  p_updates jsonb,
  p_keterangan text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updates jsonb := p_updates;
  v_item jsonb;
  v_product_id integer;
  v_harga_beli numeric;
  v_harga_jual numeric;
  v_count integer := 0;
  v_actor uuid := auth.uid();
  v_tenant uuid := public.get_my_tenant_id();
BEGIN
  IF NOT public.is_admin() OR v_actor IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Hanya admin aktif yang dapat memperbarui harga produk';
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Identitas aktor tidak valid';
  END IF;

  IF jsonb_typeof(p_updates) = 'string' THEN
    BEGIN
      v_updates := (p_updates #>> '{}')::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Payload pembaruan harga harus berupa array JSON';
    END;
  END IF;
  IF jsonb_typeof(v_updates) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Payload pembaruan harga harus berupa array JSON';
  END IF;

  PERFORM set_config('zeepos.price_change_reason', COALESCE(p_keterangan, ''), true);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_updates)
  LOOP
    v_product_id := (v_item->>'product_id')::integer;
    v_harga_beli := NULLIF(v_item->>'harga_beli', '')::numeric;
    v_harga_jual := NULLIF(v_item->>'harga_jual', '')::numeric;

    UPDATE public.products
    SET harga_beli = COALESCE(v_harga_beli, harga_beli),
        harga_jual = COALESCE(v_harga_jual, harga_jual),
        updated_at = now()
    WHERE id = v_product_id AND tenant_id = v_tenant;

    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_update_product_prices(jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_prices(jsonb, text, uuid) TO authenticated;

-- Existing signature retained for PostgREST compatibility; the supplied actor must equal auth.uid().
CREATE OR REPLACE FUNCTION public.close_cash_shift(
  p_shift_id uuid, p_uang_fisik numeric(15,2), p_pengeluaran numeric(15,2) DEFAULT 0, p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id(); v_user_id uuid := auth.uid(); v_shift public.cash_shifts%ROWTYPE;
  v_tunai numeric(15,2) := 0; v_non_tunai numeric(15,2) := 0; v_total_sistem numeric(15,2); v_selisih numeric(15,2);
BEGIN
  IF v_user_id IS NULL OR v_tenant_id IS NULL THEN RAISE EXCEPTION 'User atau tenant tidak aktif'; END IF;
  SELECT * INTO v_shift FROM public.cash_shifts WHERE id = p_shift_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shift kasir tidak ditemukan'; END IF;
  IF v_shift.kasir_id IS DISTINCT FROM v_user_id AND NOT public.is_admin() THEN RAISE EXCEPTION 'Hanya pemilik shift atau admin yang dapat menutup shift'; END IF;
  IF v_shift.status = 'closed' THEN RAISE EXCEPTION 'Shift ini sudah ditutup'; END IF;
  SELECT COALESCE(SUM(CASE WHEN metode_bayar = 'tunai' THEN total ELSE 0 END),0), COALESCE(SUM(CASE WHEN metode_bayar <> 'tunai' THEN total ELSE 0 END),0)
  INTO v_tunai, v_non_tunai FROM public.transactions
  WHERE tenant_id = v_tenant_id AND kasir_id = v_shift.kasir_id AND created_at >= v_shift.opened_at AND status = 'selesai' AND payment_status = 'dibayar';
  v_total_sistem := v_shift.modal_awal + v_tunai - COALESCE(p_pengeluaran,0); v_selisih := COALESCE(p_uang_fisik,0) - v_total_sistem;
  UPDATE public.cash_shifts SET closed_at=now(), total_penjualan_tunai=v_tunai, total_penjualan_non_tunai=v_non_tunai,
    pengeluaran_kas=COALESCE(p_pengeluaran,0), uang_fisik_akhir=COALESCE(p_uang_fisik,0), selisih=v_selisih,
    status='closed', catatan=COALESCE(p_catatan,catatan) WHERE id=p_shift_id RETURNING * INTO v_shift;
  PERFORM public.insert_audit_log(v_user_id, 'cash_shift', v_shift.id::text, 'shift_closed', 'Shift kasir ditutup', jsonb_build_object('selisih',v_selisih));
  RETURN to_jsonb(v_shift);
END;
$$;

-- Internal audit writers are owner-only. Trigger/RPC SECURITY DEFINER owners may use them;
-- authenticated clients cannot call either helper to forge actors or tenant attribution.
CREATE OR REPLACE FUNCTION public.insert_internal_audit_log(
  p_tenant_id uuid, p_user_id uuid, p_entity_type text, p_entity_id text,
  p_action text, p_description text, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.audit_logs(tenant_id,user_id,entity_type,entity_id,action,description,metadata)
  VALUES(p_tenant_id,p_user_id,p_entity_type,p_entity_id,p_action,p_description,COALESCE(p_metadata,'{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.insert_internal_audit_log(uuid, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Keep the established helper signature for trusted SECURITY DEFINER flows and jobs.
CREATE OR REPLACE FUNCTION public.insert_audit_log(
  p_user_id uuid, p_entity_type text, p_entity_id text, p_action text, p_description text, p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant FROM public.profiles AS p WHERE p.id = p_user_id;
  IF v_tenant IS NULL THEN v_tenant := public.get_my_tenant_id(); END IF;
  PERFORM public.insert_internal_audit_log(v_tenant,p_user_id,p_entity_type,p_entity_id,p_action,p_description,p_metadata);
END;
$$;
REVOKE ALL ON FUNCTION public.insert_audit_log(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(uuid, text, text, text, text, jsonb) TO service_role;

-- Price history is trigger-owned: the RPC may supply only a transaction-local reason,
-- while the trigger derives the actor from the authenticated database session.
CREATE OR REPLACE FUNCTION public.record_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.harga_beli IS DISTINCT FROM NEW.harga_beli
    OR OLD.harga_jual IS DISTINCT FROM NEW.harga_jual THEN
    INSERT INTO public.product_price_history (
      tenant_id, product_id, harga_beli, harga_jual, changed_by, keterangan
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      COALESCE(NEW.harga_beli, 0),
      COALESCE(NEW.harga_jual, 0),
      auth.uid(),
      COALESCE(
        NULLIF(current_setting('zeepos.price_change_reason', true), ''),
        'Update produk'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger functions pass row-owned tenant context, so background writes do not depend on auth.uid().
CREATE OR REPLACE FUNCTION public.log_transaction_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.insert_internal_audit_log(NEW.tenant_id,NEW.kasir_id,'transaction',NEW.id::text,
      'transaction_created','Transaksi ' || NEW.nomor_nota || ' dibuat.',
      jsonb_build_object('nomor_nota',NEW.nomor_nota,'total',NEW.total,'metode_bayar',NEW.metode_bayar,'payment_status',NEW.payment_status));
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'batal' THEN
    PERFORM public.insert_internal_audit_log(NEW.tenant_id,NEW.kasir_id,'transaction',NEW.id::text,
      'transaction_cancelled','Transaksi ' || NEW.nomor_nota || ' dibatalkan.',
      jsonb_build_object('nomor_nota',NEW.nomor_nota,'catatan',NEW.catatan,'payment_status',NEW.payment_status));
  END IF;
  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'dibayar' THEN
    PERFORM public.insert_internal_audit_log(NEW.tenant_id,COALESCE(NEW.confirmed_by,NEW.kasir_id),'transaction',NEW.id::text,
      'payment_confirmed','Pembayaran ' || NEW.nomor_nota || ' dikonfirmasi.',
      jsonb_build_object('nomor_nota',NEW.nomor_nota,'payment_reference',NEW.payment_reference,'total',NEW.total));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_stock_adjustment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.insert_internal_audit_log(NEW.tenant_id,NEW.user_id,'stock',COALESCE(NEW.product_id,0)::text,
    'stock_adjustment','Penyesuaian stok dicatat untuk produk #' || COALESCE(NEW.product_id,0)::text || '.',
    jsonb_build_object('product_id',NEW.product_id,'jenis',NEW.jenis,'jumlah_perubahan',NEW.jumlah_perubahan,
      'jumlah_sesudah',NEW.jumlah_sesudah,'keterangan',NEW.keterangan,'reference_id',NEW.reference_id));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_price_history_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.insert_internal_audit_log(NEW.tenant_id,NEW.changed_by,'product',NEW.product_id::text,
    'price_updated','Harga produk #' || NEW.product_id::text || ' diperbarui.',
    jsonb_build_object('product_id',NEW.product_id,'harga_beli',NEW.harga_beli,'harga_jual',NEW.harga_jual,'keterangan',NEW.keterangan));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.log_transaction_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_stock_adjustment_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_price_history_audit() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_my_audit_event(
  p_entity_type text, p_entity_id text, p_action text, p_description text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_tenant uuid := public.get_my_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN RAISE EXCEPTION 'Audit actor tidak valid'; END IF;
  INSERT INTO public.audit_logs(tenant_id,user_id,entity_type,entity_id,action,description,metadata)
  VALUES (v_tenant, auth.uid(), p_entity_type, p_entity_id, p_action, p_description, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.log_my_audit_event(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_my_audit_event(text, text, text, text, jsonb) TO authenticated;

-- Existing image URLs remain readable, while all future writes require admin and /<tenant-id>/... ownership.
DROP POLICY IF EXISTS "Public can read product images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can upload product images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can update product images" ON storage.objects;
DROP POLICY IF EXISTS "Admin can delete product images" ON storage.objects;
CREATE POLICY product_images_public_select ON storage.objects FOR SELECT TO public USING (bucket_id = 'products');
CREATE POLICY product_images_tenant_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='products' AND public.is_admin() AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text);
CREATE POLICY product_images_tenant_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='products' AND public.is_admin() AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text)
  WITH CHECK (bucket_id='products' AND public.is_admin() AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text);
CREATE POLICY product_images_tenant_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='products' AND public.is_admin() AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text);

CREATE OR REPLACE FUNCTION public.check_transaction_customer_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.tenant_id = NEW.tenant_id
  ) THEN RAISE EXCEPTION 'Customer harus berada pada tenant transaksi yang sama'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS transactions_customer_tenant_guard ON public.transactions;
CREATE TRIGGER transactions_customer_tenant_guard
BEFORE INSERT OR UPDATE OF customer_id, tenant_id ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.check_transaction_customer_tenant();

-- Reset execution privileges for every existing public-schema function. Function owners
-- retain implicit execution, allowing trigger and SECURITY DEFINER internals to compose.
DO $acl$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_function.signature);
  END LOOP;
END
$acl$;

-- Client RPC allowlist. Signatures are exact so accidental overloads stay inaccessible.
GRANT EXECUTE ON FUNCTION public.get_my_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_tenant(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_staff_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_tenant_branding(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_member(text, text, text, text, public.user_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_staff_password(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_transaction_atomic(jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric, public.metode_bayar, numeric, numeric, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_transaction_payment(integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_pending_transaction(integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_transaction_atomic(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_stock_atomic(integer, text, numeric, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repack_stock_atomic(integer, integer, numeric, numeric, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bulk_update_product_prices(jsonb, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_cash_shift() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.open_cash_shift(numeric, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.close_cash_shift(uuid, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_cash_shift(uuid, numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_receivable_atomic(integer, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_sales_by_date(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profit_summary(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_top_products(timestamptz, timestamptz, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_my_audit_event(text, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(uuid, text, text, text, text, jsonb) TO service_role;

-- Trigger-only and constraint helpers must never be callable as RPCs.
REVOKE EXECUTE ON FUNCTION public.record_price_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.log_transaction_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.log_stock_adjustment_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.log_price_history_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.check_transaction_customer_tenant() FROM PUBLIC, anon, authenticated, service_role;
