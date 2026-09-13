-- Migration 048: Ensure every tenant has a default category and auto-seed 'Umum' on registration

-- 1. Insert default 'Umum' category for any existing tenants that have 0 categories
INSERT INTO public.categories (nama, deskripsi, is_active, tenant_id)
SELECT 'Umum', 'Kategori produk umum', true, t.id
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories c WHERE c.tenant_id = t.id
);

-- 2. Update register_tenant RPC to auto-seed 'Umum' category
CREATE OR REPLACE FUNCTION public.register_tenant(
  p_tenant_name text,
  p_tenant_slug text,
  p_user_name text,
  p_username text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_trial_end TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_trial_end := NOW() + INTERVAL '7 days';

  INSERT INTO tenants (nama, slug, subscription_status, subscription_plan, trial_ends_at)
  VALUES (p_tenant_name, p_tenant_slug, 'trial', 'trial', v_trial_end)
  RETURNING id INTO v_tenant_id;

  INSERT INTO profiles (id, nama, username, role, is_active, tenant_id)
  VALUES (v_user_id, p_user_name, p_username, 'admin', true, v_tenant_id);

  -- Seed default store settings
  INSERT INTO store_settings (tenant_id, key, value) VALUES
    (v_tenant_id, 'nama_toko', p_tenant_name),
    (v_tenant_id, 'alamat', ''),
    (v_tenant_id, 'no_telp', ''),
    (v_tenant_id, 'header_struk', p_tenant_name),
    (v_tenant_id, 'footer_struk', 'Terima kasih telah berbelanja'),
    (v_tenant_id, 'ppn_persen', '0');

  -- Auto-seed default 'Umum' category so new products can be created immediately
  INSERT INTO categories (nama, deskripsi, is_active, tenant_id)
  VALUES ('Umum', 'Kategori produk umum', true, v_tenant_id);

  RETURN json_build_object(
    'tenant_id', v_tenant_id,
    'profile_id', v_user_id,
    'subscription_status', 'trial',
    'trial_ends_at', v_trial_end
  );
END;
$function$;
