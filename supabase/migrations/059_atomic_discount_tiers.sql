-- Replace a product's quantity discount tiers in one tenant-scoped transaction.
-- Direct delete + insert requests can otherwise leave a product without tiers if
-- the second request fails or the connection drops.
CREATE OR REPLACE FUNCTION public.replace_product_discount_tiers(
  p_product_id integer,
  p_tiers jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid := public.get_my_tenant_id();
  v_tier jsonb;
  v_locked_product_id integer;
  v_min_qty numeric(10,3);
  v_discount numeric(5,2);
  v_count integer := 0;
BEGIN
  IF NOT public.is_admin() OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Hanya admin aktif yang dapat mengubah tier diskon';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Produk tidak ditemukan';
  END IF;

  SELECT id INTO v_locked_product_id
  FROM public.products
  WHERE id = p_product_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan';
  END IF;

  IF p_tiers IS NULL OR jsonb_typeof(p_tiers) <> 'array' THEN
    RAISE EXCEPTION 'Tier diskon harus berupa array';
  END IF;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_tiers)
  LOOP
    IF jsonb_typeof(v_tier) <> 'object'
      OR COALESCE(v_tier ->> 'min_qty', '') !~ '^[0-9]+(?:\.[0-9]{1,3})?$'
      OR COALESCE(v_tier ->> 'diskon_persen', '') !~ '^[0-9]+(?:\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Format tier diskon tidak valid';
    END IF;

    v_min_qty := (v_tier ->> 'min_qty')::numeric(10,3);
    v_discount := (v_tier ->> 'diskon_persen')::numeric(5,2);

    IF v_min_qty <= 0 OR v_discount <= 0 OR v_discount > 100 THEN
      RAISE EXCEPTION 'Nilai tier diskon tidak valid';
    END IF;
  END LOOP;

  DELETE FROM public.product_discount_tiers
  WHERE product_id = p_product_id AND tenant_id = v_tenant_id;

  FOR v_tier IN SELECT value FROM jsonb_array_elements(p_tiers)
  LOOP
    INSERT INTO public.product_discount_tiers (
      tenant_id, product_id, min_qty, diskon_persen
    ) VALUES (
      v_tenant_id,
      p_product_id,
      (v_tier ->> 'min_qty')::numeric(10,3),
      (v_tier ->> 'diskon_persen')::numeric(5,2)
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_product_discount_tiers(integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_product_discount_tiers(integer, jsonb) TO authenticated, service_role;
