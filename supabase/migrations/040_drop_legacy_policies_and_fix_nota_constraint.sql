-- 040_drop_legacy_policies_and_fix_nota_constraint.sql
-- Remove legacy pre-multi-tenant policies that leak cross-tenant data due to OR evaluation

-- 1. audit_logs
DROP POLICY IF EXISTS "Admin can read audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Authenticated can insert own audit logs" ON audit_logs;

-- 2. categories
DROP POLICY IF EXISTS "Categories can be managed by admin" ON categories;
DROP POLICY IF EXISTS "Categories can be read by authenticated users" ON categories;

-- 3. product_discount_tiers
DROP POLICY IF EXISTS "authenticated_manage_discount_tiers" ON product_discount_tiers;

-- 4. product_price_history
DROP POLICY IF EXISTS "Admin can manage price history" ON product_price_history;
DROP POLICY IF EXISTS "Authenticated can read price history" ON product_price_history;

-- 5. products
DROP POLICY IF EXISTS "Products can be managed by admin" ON products;
DROP POLICY IF EXISTS "Products can be read by authenticated users" ON products;

-- 6. profiles
DROP POLICY IF EXISTS "Profiles can be managed by admin" ON profiles;
DROP POLICY IF EXISTS "Profiles can be read by authenticated users" ON profiles;

-- 7. stock_adjustments
DROP POLICY IF EXISTS "Stock adjustments can be changed by admin" ON stock_adjustments;
DROP POLICY IF EXISTS "Stock adjustments can be inserted by authenticated users" ON stock_adjustments;
DROP POLICY IF EXISTS "Stock adjustments can be read by authenticated users" ON stock_adjustments;

-- 8. store_settings
DROP POLICY IF EXISTS "Store settings can be inserted by admin" ON store_settings;
DROP POLICY IF EXISTS "Store settings can be read by authenticated users" ON store_settings;
DROP POLICY IF EXISTS "Store settings can be updated by admin" ON store_settings;

-- 9. transaction_items
DROP POLICY IF EXISTS "Transaction items can be changed by admin" ON transaction_items;
DROP POLICY IF EXISTS "Transaction items can be inserted by authenticated users" ON transaction_items;
DROP POLICY IF EXISTS "Transaction items can be read by authenticated users" ON transaction_items;

-- 10. transactions
DROP POLICY IF EXISTS "Transactions can be inserted by authenticated users" ON transactions;
DROP POLICY IF EXISTS "Transactions can be read by owner or admin" ON transactions;
DROP POLICY IF EXISTS "Transactions can be updated by admin" ON transactions;

-- 11. Scoped nomor_nota constraint per tenant instead of globally
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_nomor_nota_key;
DROP INDEX IF EXISTS transactions_nomor_nota_key;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_tenant_nomor_nota_key ON transactions (tenant_id, nomor_nota);

-- 12. Fix profiles select policy to allow reading own profile before or during onboarding
DROP POLICY IF EXISTS "Tenant members can read own profiles" ON profiles;
CREATE POLICY "Tenant members can read own profiles" ON profiles
  FOR SELECT
  USING (id = auth.uid() OR (tenant_id IS NOT NULL AND tenant_id = get_my_tenant_id()));
