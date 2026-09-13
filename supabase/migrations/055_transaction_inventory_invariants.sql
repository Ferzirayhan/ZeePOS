-- ====================================================================
-- Migrasi 055: Transaction and inventory invariants
-- ====================================================================
-- Task 2 of the production-hardening plan.
--
-- Masalah yang dibenahi:
-- 1. transaction_items tidak menyimpan snapshot rasio/base_qty, sehingga
--    kedua fungsi pembatalan (cancel_pending_transaction 011 dan
--    cancel_transaction_atomic 017) mengembalikan v_item.qty (qty satuan,
--    mis. 1 dus) alih-alih qty dasar (qty*rasio, mis. 12 pcs) yang
--    sebenarnya dipotong dari stok -> stok hilang saat pembatalan.
-- 2. Tidak ada kunci idempotensi -> retry/recovery bisa menciptakan
--    transaksi ganda.
-- 3. create_transaction_atomic memeriksa stok per-baris (loop), sehingga
--    satu produk yang muncul di dua satuan berbeda bisa lolos padahal
--    total kebutuhan base-qty melebihi stok.
-- 4. diskon_item_persen dipercaya dari klien; sekarang dihitung ulang
--    dari tier diskon di server.
-- 5. Validasi customer tenant hanya lewat trigger; kini juga eksplisit
--    di dalam RPC.
-- 6. Return RPC hanya berisi id -> tidak cukup untuk recovery.
-- ====================================================================

-- 1. Snapshot immutable satuan & base-qty di transaction_items.
-- Do not default old rows to ratio 1: transactions made after multi-unit support
-- may have deducted qty * ratio while storing only qty.
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS rasio NUMERIC(12,3);
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS base_qty NUMERIC(12,3);
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS nama_satuan TEXT;
ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS inventory_snapshot_status TEXT;

UPDATE public.transaction_items
SET inventory_snapshot_status = 'ambiguous_legacy'
WHERE inventory_snapshot_status IS NULL;

-- Exact derivation: when one transaction item maps to one immutable stock
-- adjustment, the deducted base quantity is persisted in jumlah_perubahan.
WITH exact_inventory AS (
  SELECT ti.id,
         ABS(MIN(sa.jumlah_perubahan)) AS base_qty,
         ABS(MIN(sa.jumlah_perubahan)) / NULLIF(MIN(ti.qty), 0) AS rasio
  FROM public.transaction_items ti
  JOIN public.stock_adjustments sa
    ON sa.tenant_id = ti.tenant_id
   AND sa.product_id = ti.product_id
   AND sa.reference_id = ti.transaction_id::TEXT
   AND sa.jenis = 'terjual'
  GROUP BY ti.id, ti.transaction_id, ti.product_id
  HAVING COUNT(*) = 1
     AND (SELECT COUNT(*) FROM public.transaction_items sibling
          WHERE sibling.tenant_id = ti.tenant_id
            AND sibling.transaction_id = ti.transaction_id
            AND sibling.product_id = ti.product_id) = 1
)
UPDATE public.transaction_items ti
SET rasio = exact_inventory.rasio,
    base_qty = exact_inventory.base_qty,
    inventory_snapshot_status = 'exact_snapshot'
FROM exact_inventory
WHERE ti.id = exact_inventory.id
  AND exact_inventory.rasio > 0;

-- Rows from products that have never had alternate units are reliably base-unit
-- sales. Any remaining row for a product with unit metadata stays ambiguous.
UPDATE public.transaction_items ti
SET rasio = 1,
    base_qty = ti.qty,
    nama_satuan = COALESCE(ti.nama_satuan, p.satuan::TEXT, 'pcs'),
    inventory_snapshot_status = 'exact_snapshot'
FROM public.products p
WHERE p.id = ti.product_id
  AND p.tenant_id = ti.tenant_id
  AND ti.inventory_snapshot_status = 'ambiguous_legacy'
  AND NOT EXISTS (
    SELECT 1 FROM public.product_units pu
    WHERE pu.product_id = ti.product_id AND pu.tenant_id = ti.tenant_id
  );

ALTER TABLE public.transaction_items
  ALTER COLUMN rasio SET DEFAULT 1,
  ALTER COLUMN inventory_snapshot_status SET DEFAULT 'exact_snapshot',
  ALTER COLUMN inventory_snapshot_status SET NOT NULL;
ALTER TABLE public.transaction_items
  ADD CONSTRAINT transaction_items_inventory_snapshot_valid
  CHECK (inventory_snapshot_status = 'ambiguous_legacy' OR (rasio IS NOT NULL AND base_qty IS NOT NULL AND rasio > 0 AND base_qty > 0));

-- Receivables need an explicit terminal state when their source sale is cancelled.
DO $constraints$
DECLARE constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.receivables'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%belum_lunas%sebagian%lunas%'
  LOOP
    EXECUTE format('ALTER TABLE public.receivables DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END;
$constraints$;
ALTER TABLE public.receivables
  ADD CONSTRAINT receivables_status_valid
  CHECK (status IN ('belum_lunas', 'sebagian', 'lunas', 'dibatalkan'));

-- 2. Tenant-scoped idempotency key bound to a server-computed request hash.
-- Supabase installs extensions in `extensions`. Preserve an existing pgcrypto
-- location, but expose the text digest overload there without widening RPC paths.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $pgcrypto$
DECLARE
  pgcrypto_schema TEXT;
BEGIN
  SELECT n.nspname
  INTO pgcrypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'pgcrypto extension is required';
  END IF;

  IF pgcrypto_schema <> 'extensions' THEN
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION extensions.digest(text, text) RETURNS bytea LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS %L',
      format('SELECT %I.digest($1, $2)', pgcrypto_schema)
    );
  END IF;
END;
$pgcrypto$;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_idempotency_key_unique
  ON public.transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ====================================================================
-- 3. Hardened create_transaction_atomic
-- ====================================================================
-- Replaces the 053 version. Changes:
--   * p_idempotency_key param: re-submit returns existing transaction
--   * Server-side tier discount (product_discount_tiers) replaces client diskon_item_persen
--   * Aggregate base-qty demand per product checked before any deduction
--   * Explicit customer tenant validation inside the RPC
--   * Returns full computed totals + idempotent flag for client recovery
--   * Persists rasio, base_qty, nama_satuan snapshots on transaction_items

-- Drop every existing overload so the final signature is unambiguous.
DO $cleanup$
DECLARE r RECORD;
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
  p_catatan text DEFAULT NULL,
  p_customer_id integer DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_transaction_id INTEGER;
  v_nomor_nota TEXT;
  v_existing_id INTEGER;
  v_existing_nota TEXT;
  v_existing_status payment_status;
  v_existing_fingerprint TEXT;
  v_request_fingerprint TEXT;
  v_idempotent BOOLEAN := false;
  v_product RECORD;
  v_unit RECORD;
  v_item JSONB;
  v_items JSONB;
  v_demand_row RECORD;
  v_current_user UUID := auth.uid();
  v_tenant_id UUID;

  v_product_id INTEGER;
  v_unit_id INTEGER;
  v_qty DECIMAL;
  v_rasio DECIMAL;
  v_stok_potong DECIMAL;
  v_harga_satuan_db DECIMAL;
  v_nama_produk TEXT;
  v_nama_satuan TEXT;
  v_diskon_item_persen DECIMAL := 0;
  v_tier_diskon DECIMAL := 0;
  v_produk_diskon DECIMAL := 0;
  v_item_subtotal DECIMAL;

  v_demand RECORD;
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

  -- Bind an idempotency key to normalized request intent. Product prices and
  -- ratios are still recomputed authoritatively below; this hash prevents a
  -- changed cart/payment intent from receiving an unrelated prior result.
  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'items', (SELECT jsonb_agg(jsonb_build_object(
        'product_id', NULLIF(value->>'product_id', '')::INTEGER,
        'unit_id', NULLIF(value->>'unit_id', '')::INTEGER,
        'qty', NULLIF(value->>'qty', '')::NUMERIC
      ) ORDER BY NULLIF(value->>'product_id', '')::INTEGER,
                 NULLIF(value->>'unit_id', '')::INTEGER NULLS FIRST,
                 NULLIF(value->>'qty', '')::NUMERIC)
        FROM jsonb_array_elements(v_items)),
      'diskon_persen', COALESCE(p_diskon_persen, 0),
      'diskon_amount', CASE WHEN COALESCE(p_diskon_persen, 0) > 0 THEN NULL ELSE COALESCE(p_diskon_amount, 0) END,
      'ppn_persen', COALESCE(p_ppn_persen, 0),
      'metode_bayar', p_metode_bayar::TEXT,
      'uang_diterima', CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
      'customer_id', p_customer_id,
      'catatan', NULLIF(btrim(p_catatan), '')
    )::TEXT,
    'sha256'
  ), 'hex');

  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    -- Serialize first-use races for the same tenant/key before checking/inserting.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::TEXT || ':' || btrim(p_idempotency_key), 0));
    SELECT id, nomor_nota, payment_status, request_fingerprint
    INTO v_existing_id, v_existing_nota, v_existing_status, v_existing_fingerprint
    FROM public.transactions
    WHERE tenant_id = v_tenant_id AND idempotency_key = btrim(p_idempotency_key)
    FOR UPDATE;

    IF v_existing_id IS NOT NULL THEN
      IF v_existing_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
        RAISE EXCEPTION 'Kunci idempotensi sudah digunakan untuk payload berbeda';
      END IF;

      SELECT subtotal, diskon_amount, ppn_amount, total, kembalian
      INTO v_computed_subtotal, v_diskon_amount, v_ppn_amount, v_total, v_kembalian
      FROM public.transactions WHERE id = v_existing_id;
      RETURN jsonb_build_object(
        'transaction_id', v_existing_id, 'nomor_nota', v_existing_nota,
        'payment_status', v_existing_status, 'subtotal', v_computed_subtotal,
        'diskon_amount', v_diskon_amount, 'ppn_amount', v_ppn_amount,
        'total', v_total, 'kembalian', v_kembalian, 'idempotent', true
      );
    END IF;
  END IF;

  -- 1. Validate customer tenant explicitly inside the RPC (trigger also guards, but fail early).
  IF p_customer_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customers
      WHERE id = p_customer_id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Pelanggan tidak terdaftar pada tenant ini';
    END IF;
  END IF;

  -- 2. Validate stock + recompute price/subtotal/discount from database (not from client).
  --    Aggregate base-qty demand per product so multiple units of the same product
  --    are checked collectively before any deduction.
  CREATE TEMP TABLE IF NOT EXISTS tmp_demand (
    product_id int,
    total_base_qty numeric,
    rasio numeric,
    unit_id int,
    harga_satuan numeric,
    nama_produk text,
    nama_satuan text,
    qty numeric,
    diskon_item_persen numeric,
    item_subtotal numeric
  ) ON COMMIT DROP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::INTEGER;
    v_qty := NULLIF(v_item->>'qty', '')::DECIMAL;
    v_unit_id := NULLIF(v_item->>'unit_id', '')::INTEGER;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Item transaksi tidak valid';
    END IF;

    SELECT id, nama, stok, is_active, harga_jual, diskon_produk_persen
    INTO v_product
    FROM public.products
    WHERE id = v_product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk dengan ID % tidak ditemukan', v_product_id;
    END IF;

    IF COALESCE(v_product.is_active, false) = false THEN
      RAISE EXCEPTION 'Produk % sudah tidak aktif', v_product.nama;
    END IF;

    -- Price & ratio ALWAYS from DB, never from the client payload.
    IF v_unit_id IS NOT NULL THEN
      SELECT id, rasio, harga_jual, nama_satuan
      INTO v_unit
      FROM public.product_units
      WHERE id = v_unit_id AND product_id = v_product_id AND tenant_id = v_tenant_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Satuan produk tidak valid untuk produk %', v_product.nama;
      END IF;

      v_rasio := v_unit.rasio;
      v_harga_satuan_db := v_unit.harga_jual;
      v_nama_satuan := v_unit.nama_satuan;
    ELSE
      v_rasio := 1;
      v_harga_satuan_db := v_product.harga_jual;
      v_nama_satuan := COALESCE(v_product.satuan::text, 'pcs');
    END IF;

    v_stok_potong := v_qty * v_rasio;
    v_nama_produk := COALESCE(NULLIF(v_item->>'nama_produk', ''), v_product.nama);

    -- Server-side discount: take the max of applicable tier discount and the
    -- product-level promo discount. The client-supplied diskon_item_persen
    -- is no longer trusted.
    SELECT COALESCE(MAX(d.diskon_persen), 0)
    INTO v_tier_diskon
    FROM public.product_discount_tiers d
    WHERE d.product_id = v_product_id AND v_qty >= d.min_qty;

    v_produk_diskon := COALESCE(v_product.diskon_produk_persen, 0);
    v_diskon_item_persen := GREATEST(v_tier_diskon, v_produk_diskon);

    IF v_diskon_item_persen < 0 OR v_diskon_item_persen > 100 THEN
      RAISE EXCEPTION 'Diskon item tidak valid untuk produk ID %', v_product_id;
    END IF;

    v_item_subtotal := ROUND(v_harga_satuan_db * v_qty * (1 - v_diskon_item_persen / 100), 2);
    v_computed_subtotal := v_computed_subtotal + v_item_subtotal;

    INSERT INTO tmp_demand (product_id, total_base_qty, rasio, unit_id, harga_satuan, nama_produk, nama_satuan, qty, diskon_item_persen, item_subtotal)
    VALUES (v_product_id, v_stok_potong, v_rasio, v_unit_id, v_harga_satuan_db, v_nama_produk, v_nama_satuan, v_qty, v_diskon_item_persen, v_item_subtotal);
  END LOOP;

  -- 3. Aggregate base-qty demand by product and check collectively against stock.
  FOR v_demand IN
    SELECT product_id, SUM(total_base_qty) AS total_base_qty
    FROM tmp_demand
    GROUP BY product_id
  LOOP
    SELECT stok INTO v_product FROM public.products WHERE id = v_demand.product_id AND tenant_id = v_tenant_id FOR UPDATE;

    IF COALESCE(v_product.stok, 0) < v_demand.total_base_qty THEN
      RAISE EXCEPTION 'Stok untuk produk ID % tidak mencukupi (dibutuhkan % dasar, tersedia %)',
        v_demand.product_id, v_demand.total_base_qty, v_product.stok;
    END IF;
  END LOOP;

  -- 4. Recompute header discount, ppn, and total from the server-computed subtotal.
  IF p_diskon_persen IS NOT NULL AND p_diskon_persen > 0 THEN
    IF p_diskon_persen > 100 THEN
      RAISE EXCEPTION 'Diskon transaksi tidak valid';
    END IF;
    v_diskon_amount := ROUND(v_computed_subtotal * p_diskon_persen / 100, 2);
  ELSE
    v_diskon_amount := LEAST(GREATEST(COALESCE(p_diskon_amount, 0), 0), v_computed_subtotal);
  END IF;

  v_after_diskon := v_computed_subtotal - v_diskon_amount;

  IF p_ppn_persen IS NOT NULL AND p_ppn_persen > 0 THEN
    v_ppn_amount := ROUND(v_after_diskon * p_ppn_persen / 100, 2);
  ELSE
    v_ppn_amount := 0;
  END IF;

  v_total := GREATEST(v_after_diskon + v_ppn_amount, 0);

  -- 5. Validate payment against the server-recomputed total.
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

  v_nomor_nota := public.generate_nomor_nota();

  INSERT INTO public.transactions (
    tenant_id, nomor_nota, kasir_id, customer_id, subtotal, diskon_persen, diskon_amount,
    ppn_persen, ppn_amount, total, metode_bayar, uang_diterima,
    kembalian, catatan, payment_status, paid_at, confirmed_by, idempotency_key, request_fingerprint
  )
  VALUES (
    v_tenant_id, v_nomor_nota, p_kasir_id, p_customer_id,
    v_computed_subtotal, COALESCE(p_diskon_persen, 0), v_diskon_amount,
    COALESCE(p_ppn_persen, 0), v_ppn_amount, v_total,
    p_metode_bayar,
    CASE WHEN p_metode_bayar = 'tunai' THEN p_uang_diterima ELSE NULL END,
    v_kembalian,
    p_catatan, v_payment_status, v_paid_at, v_confirmed_by, btrim(p_idempotency_key), v_request_fingerprint
  )
  RETURNING id INTO v_transaction_id;

  -- 6. Insert items (with immutable rasio/base_qty/nama_satuan snapshots) + deduct aggregate base qty.
  FOR v_demand_row IN SELECT * FROM tmp_demand ORDER BY product_id
  LOOP
    SELECT id, nama, stok, harga_beli INTO v_product
    FROM public.products
    WHERE id = v_demand_row.product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    v_stok_potong := v_demand_row.total_base_qty;

    INSERT INTO public.transaction_items (
      tenant_id, transaction_id, product_id, nama_produk, harga_satuan, harga_beli,
      qty, subtotal, diskon_item_persen, rasio, base_qty, nama_satuan
    )
    VALUES (
      v_tenant_id, v_transaction_id, v_demand_row.product_id, v_demand_row.nama_produk, v_demand_row.harga_satuan,
      COALESCE(v_product.harga_beli, 0), v_demand_row.qty, v_demand_row.item_subtotal, v_demand_row.diskon_item_persen,
      v_demand_row.rasio, v_stok_potong, v_demand_row.nama_satuan
    );

    UPDATE public.products
    SET stok = COALESCE(stok, 0) - v_stok_potong
    WHERE id = v_demand_row.product_id AND tenant_id = v_tenant_id;

    INSERT INTO public.stock_adjustments (
      tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
      keterangan, reference_id
    )
    VALUES (
      v_tenant_id, v_demand_row.product_id, p_kasir_id, 'terjual',
      COALESCE(v_product.stok, 0), -v_stok_potong, COALESCE(v_product.stok, 0) - v_stok_potong,
      'Penjualan ' || v_nomor_nota, v_transaction_id::TEXT
    );
  END LOOP;

  -- 7. Receivable for hutang payments, using the server-recomputed total.
  IF p_metode_bayar = 'hutang' AND p_customer_id IS NOT NULL THEN
    INSERT INTO public.receivables (
      tenant_id, customer_id, transaction_id, nomor_nota,
      total_tagihan, jumlah_dibayar, sisa_hutang, status
    ) VALUES (
      v_tenant_id, p_customer_id, v_transaction_id, v_nomor_nota,
      v_total, 0, v_total, 'belum_lunas'
    );

    UPDATE public.customers
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
    'kembalian', v_kembalian,
    'idempotent', v_idempotent
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  public.metode_bayar, numeric, numeric, text, integer, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_transaction_atomic(
  jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric,
  public.metode_bayar, numeric, numeric, text, integer, text
) TO authenticated, service_role;

-- ====================================================================
-- 4. Hardened cancel_pending_transaction (replaces 011)
-- ====================================================================
-- Restores base_qty (the actual deducted quantity) instead of v_item.qty
-- (the unit quantity). Tenant-scoped and idempotent.

CREATE OR REPLACE FUNCTION public.cancel_pending_transaction(
  p_transaction_id INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_transaction public.transactions%ROWTYPE;
  v_item public.transaction_items%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_restore_qty NUMERIC(12,3);
  v_current_user UUID := auth.uid();
  v_tenant_id UUID := public.get_my_tenant_id();
BEGIN
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant belum terdaftar atau tidak aktif';
  END IF;

  SELECT *
  INTO v_transaction
  FROM public.transactions
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  IF v_transaction.payment_status = 'dibayar' THEN
    RAISE EXCEPTION 'Transaksi yang sudah dibayar tidak bisa dibatalkan dari menu pending';
  END IF;

  IF NOT (public.is_admin() OR v_transaction.kasir_id = v_current_user) THEN
    RAISE EXCEPTION 'Anda tidak berhak membatalkan transaksi ini';
  END IF;

  -- Idempotent: already cancelled -> return current state
  IF v_transaction.status = 'batal' THEN
    RETURN jsonb_build_object(
      'transaction_id', v_transaction.id,
      'status', v_transaction.status,
      'payment_status', v_transaction.payment_status
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
      AND inventory_snapshot_status = 'ambiguous_legacy'
  ) THEN
    RAISE EXCEPTION 'Transaksi lama memiliki konversi stok ambigu; pembatalan memerlukan rekonsiliasi manual';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Restore the exact base quantity that was deducted, not the unit qty.
    v_restore_qty := COALESCE(v_item.base_qty, v_item.qty * COALESCE(v_item.rasio, 1), v_item.qty);

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_item.product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    UPDATE public.products
    SET stok = COALESCE(stok, 0) + v_restore_qty
    WHERE id = v_item.product_id AND tenant_id = v_tenant_id;

    INSERT INTO public.stock_adjustments (
      tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
      keterangan, reference_id
    )
    VALUES (
      v_tenant_id, v_item.product_id, v_current_user, 'masuk',
      COALESCE(v_product.stok, 0),
      v_restore_qty,
      COALESCE(v_product.stok, 0) + v_restore_qty,
      COALESCE(p_reason, 'Pembatalan transaksi pending ') || v_transaction.nomor_nota,
      p_transaction_id::TEXT
    );
  END LOOP;

  UPDATE public.transactions
  SET
    status = 'batal',
    payment_status = 'gagal',
    catatan = CONCAT_WS(E'\n', NULLIF(catatan, ''), COALESCE(p_reason, 'Dibatalkan dari transaksi pending'))
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction_id', p_transaction_id,
    'status', 'batal',
    'payment_status', 'gagal'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_pending_transaction(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_pending_transaction(integer, text) TO authenticated, service_role;

-- ====================================================================
-- 5. Hardened cancel_transaction_atomic (replaces 017)
-- ====================================================================
-- Same base_qty restoration, tenant-scoped, idempotent.

CREATE OR REPLACE FUNCTION public.cancel_transaction_atomic(
  p_transaction_id INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_transaction public.transactions%ROWTYPE;
  v_item public.transaction_items%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_receivable public.receivables%ROWTYPE;
  v_restore_qty NUMERIC(12,3);
  v_current_user UUID := auth.uid();
  v_tenant_id UUID := public.get_my_tenant_id();
BEGIN
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'User belum terautentikasi';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant belum terdaftar atau tidak aktif';
  END IF;

  SELECT *
  INTO v_transaction
  FROM public.transactions
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan';
  END IF;

  -- Idempotent before touching the ledger: debt and stock change once only.
  IF v_transaction.status = 'batal' THEN
    RETURN jsonb_build_object(
      'transaction_id', v_transaction.id,
      'status', v_transaction.status
    );
  END IF;

  IF NOT (public.is_admin() OR v_transaction.kasir_id = v_current_user) THEN
    RAISE EXCEPTION 'Anda tidak berhak membatalkan transaksi ini';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
      AND inventory_snapshot_status = 'ambiguous_legacy'
  ) THEN
    RAISE EXCEPTION 'Transaksi lama memiliki konversi stok ambigu; pembatalan memerlukan rekonsiliasi manual';
  END IF;

  SELECT * INTO v_receivable
  FROM public.receivables
  WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF FOUND THEN
    IF COALESCE(v_receivable.jumlah_dibayar, 0) > 0 OR EXISTS (
      SELECT 1 FROM public.receivable_payments
      WHERE receivable_id = v_receivable.id AND tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Transaksi memiliki pembayaran piutang; balikkan pembayaran sebelum pembatalan';
    END IF;

    -- Customer row lock serializes this decrement with receivable payments.
    PERFORM 1 FROM public.customers
    WHERE id = v_receivable.customer_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    UPDATE public.customers
    SET total_hutang = GREATEST(0, total_hutang - v_receivable.sisa_hutang),
        updated_at = NOW()
    WHERE id = v_receivable.customer_id AND tenant_id = v_tenant_id;

    UPDATE public.receivables
    SET status = 'dibatalkan', sisa_hutang = 0, updated_at = NOW(),
        catatan = CONCAT_WS(E'\n', NULLIF(catatan, ''), 'Dibatalkan bersama transaksi sumber')
    WHERE id = v_receivable.id AND tenant_id = v_tenant_id;
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.transaction_items
    WHERE transaction_id = p_transaction_id AND tenant_id = v_tenant_id
    ORDER BY id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Restore the exact base quantity that was deducted, not the unit qty.
    v_restore_qty := COALESCE(v_item.base_qty, v_item.qty * COALESCE(v_item.rasio, 1), v_item.qty);

    SELECT *
    INTO v_product
    FROM public.products
    WHERE id = v_item.product_id AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk untuk item transaksi tidak ditemukan';
    END IF;

    UPDATE public.products
    SET stok = COALESCE(stok, 0) + v_restore_qty
    WHERE id = v_item.product_id AND tenant_id = v_tenant_id;

    INSERT INTO public.stock_adjustments (
      tenant_id, product_id, user_id, jenis, jumlah_sebelum, jumlah_perubahan, jumlah_sesudah,
      keterangan, reference_id
    )
    VALUES (
      v_tenant_id, v_item.product_id, v_current_user, 'masuk',
      COALESCE(v_product.stok, 0),
      v_restore_qty,
      COALESCE(v_product.stok, 0) + v_restore_qty,
      'Pembatalan transaksi ' || v_transaction.nomor_nota,
      p_transaction_id::TEXT
    );
  END LOOP;

  UPDATE public.transactions
  SET status = 'batal'
  WHERE id = p_transaction_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'transaction_id', p_transaction_id,
    'status', 'batal'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_transaction_atomic(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_transaction_atomic(integer) TO authenticated, service_role;
