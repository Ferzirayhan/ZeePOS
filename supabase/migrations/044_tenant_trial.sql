-- Migration 044: Tenant 7-day trial support

ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trial',
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'trial';

-- Update existing tenants if any
UPDATE tenants 
SET 
  trial_ends_at = COALESCE(trial_ends_at, created_at + INTERVAL '7 days', NOW() + INTERVAL '7 days'),
  subscription_status = COALESCE(subscription_status, 'trial'),
  subscription_plan = COALESCE(subscription_plan, 'trial')
WHERE subscription_status IS NULL;

-- Update register_tenant RPC to explicitly set 7-day trial
CREATE OR REPLACE FUNCTION register_tenant(
  p_tenant_name TEXT,
  p_tenant_slug TEXT,
  p_user_name TEXT,
  p_username TEXT
)
RETURNS JSON AS $$
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

  RETURN json_build_object(
    'tenant_id', v_tenant_id,
    'profile_id', v_user_id,
    'subscription_status', 'trial',
    'trial_ends_at', v_trial_end
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
