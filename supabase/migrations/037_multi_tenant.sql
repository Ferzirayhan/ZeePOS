-- Multi-tenant: tenant isolation for SaaS POS

-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add tenant_id to profiles
ALTER TABLE profiles ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Add tenant_id to all data tables
ALTER TABLE categories ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE products ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE transactions ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE transaction_items ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE stock_adjustments ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE store_settings ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE audit_logs ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE product_discount_tiers ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE product_price_history ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Helper: get current user's tenant_id from their profile
CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Drop old permissive policies and create tenant-scoped ones

-- profiles
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON profiles;
CREATE POLICY "Tenant members can read own profiles"
  ON profiles FOR SELECT
  USING (tenant_id = get_my_tenant_id());
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

-- tenants: members can read their own tenant
CREATE POLICY "Members can read own tenant"
  ON tenants FOR SELECT
  USING (id = get_my_tenant_id());
CREATE POLICY "Admin can update own tenant"
  ON tenants FOR UPDATE
  USING (id = get_my_tenant_id());

-- categories
DROP POLICY IF EXISTS "Authenticated users can read categories" ON categories;
CREATE POLICY "Tenant scoped categories"
  ON categories FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- products
DROP POLICY IF EXISTS "Authenticated users can read products" ON products;
CREATE POLICY "Tenant scoped products"
  ON products FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- transactions
DROP POLICY IF EXISTS "Authenticated users can manage transactions" ON transactions;
CREATE POLICY "Tenant scoped transactions"
  ON transactions FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- transaction_items
DROP POLICY IF EXISTS "Authenticated users can manage transaction_items" ON transaction_items;
CREATE POLICY "Tenant scoped transaction_items"
  ON transaction_items FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- stock_adjustments
DROP POLICY IF EXISTS "Authenticated users can manage stock" ON stock_adjustments;
CREATE POLICY "Tenant scoped stock_adjustments"
  ON stock_adjustments FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- store_settings
DROP POLICY IF EXISTS "Authenticated users can read settings" ON store_settings;
CREATE POLICY "Tenant scoped store_settings"
  ON store_settings FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- audit_logs
DROP POLICY IF EXISTS "Authenticated users can manage audit_logs" ON audit_logs;
DROP POLICY IF EXISTS "Authenticated users can read audit_logs" ON audit_logs;
CREATE POLICY "Tenant scoped audit_logs"
  ON audit_logs FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- product_discount_tiers
DROP POLICY IF EXISTS "Authenticated users can manage product_discount_tiers" ON product_discount_tiers;
DROP POLICY IF EXISTS "Authenticated users can read product_discount_tiers" ON product_discount_tiers;
CREATE POLICY "Tenant scoped product_discount_tiers"
  ON product_discount_tiers FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- product_price_history
DROP POLICY IF EXISTS "Authenticated users can manage product_price_history" ON product_price_history;
DROP POLICY IF EXISTS "Authenticated users can read product_price_history" ON product_price_history;
CREATE POLICY "Tenant scoped product_price_history"
  ON product_price_history FOR ALL
  USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Unique constraint: store_settings key per tenant
ALTER TABLE store_settings DROP CONSTRAINT IF EXISTS store_settings_key_key;
ALTER TABLE store_settings ADD CONSTRAINT store_settings_tenant_key UNIQUE (tenant_id, key);

-- Unique constraint: product SKU/barcode per tenant
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_key;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_barcode_key;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku ON products (tenant_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_barcode ON products (tenant_id, barcode) WHERE barcode IS NOT NULL;

-- Unique constraint: username per tenant
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_tenant_username ON profiles (tenant_id, username);

-- Update views to include tenant_id filtering via RLS on base tables
-- Views inherit RLS from the underlying tables, so no changes needed

-- Registration function: creates tenant + profile in one call
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
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO tenants (nama, slug)
  VALUES (p_tenant_name, p_tenant_slug)
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
    'profile_id', v_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow insert on tenants/profiles during registration (the function is SECURITY DEFINER)
-- But we need a policy that lets new users read their tenant after creation
-- The get_my_tenant_id() function handles this since profile is created in the same transaction

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION register_tenant(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_tenant_id() TO authenticated;

-- Allow profile insert for registration (profile doesn't exist yet so get_my_tenant_id returns null)
CREATE POLICY "Users can insert own profile during registration"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());
