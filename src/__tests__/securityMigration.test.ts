import { describe, expect, it } from 'vitest'
import migrationSql from '../../supabase/migrations/054_security_boundary_hardening.sql?raw'
import productsApi from '../api/products.ts?raw'

const sql = () => migrationSql.replace(/\s+/g, ' ')

describe('security boundary hardening migration', () => {
  it('requires active profile and active tenant for tenant and admin helpers', () => {
    const migration = sql()
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_tenant_id\(\).*SECURITY DEFINER.*SET search_path = pg_catalog, public.*p\.is_active IS TRUE.*t\.is_active IS TRUE/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.is_admin\(\).*SECURITY DEFINER.*SET search_path = pg_catalog, public.*p\.role = 'admin'.*p\.is_active IS TRUE.*t\.is_active IS TRUE/i)
  })

  it('removes direct profile creation and limits profile changes to RPCs', () => {
    const migration = sql()
    expect(migration).toContain('DROP POLICY IF EXISTS "Users can insert own profile during registration" ON public.profiles')
    expect(migration).not.toMatch(/CREATE POLICY[^;]+ON public\.profiles FOR INSERT/i)
    expect(migration).not.toMatch(/CREATE POLICY[^;]+ON public\.profiles FOR UPDATE/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.update_my_profile\(p_nama text, p_username text\)/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.set_staff_active\(p_user_id uuid, p_is_active boolean\).*public\.is_admin\(\)/i)
  })

  it('uses operation-specific tenant policies and denies direct ledger mutation', () => {
    const migration = sql()
    expect(migration).not.toMatch(/CREATE POLICY[^;]+FOR ALL/i)
    for (const table of ['transaction_items', 'stock_adjustments', 'product_price_history', 'audit_logs', 'receivables', 'receivable_payments']) {
      expect(migration).toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${table} FOR SELECT`, 'i'))
      expect(migration).not.toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${table} FOR (INSERT|UPDATE|DELETE)`, 'i'))
    }
    for (const table of ['categories', 'products', 'product_units', 'product_discount_tiers', 'store_settings']) {
      expect(migration).toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${table} FOR SELECT`, 'i'))
      expect(migration).toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${table} FOR INSERT[^;]+is_admin`, 'i'))
      expect(migration).toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${table} FOR UPDATE[^;]+is_admin`, 'i'))
      expect(migration).toMatch(new RegExp(`CREATE POLICY[^;]+ON public\\.${table} FOR DELETE[^;]+is_admin`, 'i'))
    }
  })

  it('keeps tenant billing state out of direct client updates', () => {
    const migration = sql()
    expect(migration).not.toMatch(/CREATE POLICY[^;]+ON public\.tenants FOR UPDATE/i)
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.update_tenant_branding\(p_nama text, p_slug text\)/i)
    expect(migration).not.toMatch(/UPDATE public\.tenants SET[^;]*(subscription_status|subscription_plan|trial_ends_at|is_active)/i)
  })

  it('binds stock actors to auth uid and enforces admin stock operations', () => {
    const migration = sql()
    expect(migration).toMatch(/adjust_stock_atomic[\s\S]*v_actor uuid := auth\.uid\(\)[\s\S]*IF NOT public\.is_admin\(\)/i)
    expect(migration).toMatch(/repack_stock_atomic[\s\S]*v_actor uuid := auth\.uid\(\)[\s\S]*IF NOT public\.is_admin\(\)/i)
    expect(migration).toMatch(/p_user_id IS DISTINCT FROM v_actor/i)
  })

  it('normalizes nullable product stock throughout repack bookkeeping', () => {
    const repack = sql().match(/CREATE OR REPLACE FUNCTION public\.repack_stock_atomic\([\s\S]*?\$\$;/i)?.[0] ?? ''
    expect(repack).toMatch(/v_source_stock_before numeric\(12,3\)/i)
    expect(repack).toMatch(/v_target_stock_before numeric\(12,3\)/i)
    expect(repack).toMatch(/v_source_stock_before := COALESCE\(v_source\.stok, 0\)/i)
    expect(repack).toMatch(/v_target_stock_before := COALESCE\(v_target\.stok, 0\)/i)
    expect(repack).not.toMatch(/(?:VALUES|jsonb_build_object)[\s\S]*v_(?:source|target)\.stok/i)
  })

  it('requires active admin for every catalog price mutator', () => {
    const migration = sql()
    const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\([^$]*?AS \$\$([\s\S]*?)\$\$;/gi)]
    const priceMutators = functions.filter(([, , body]) => /UPDATE public\.products SET[^;]*harga_(?:beli|jual)/i.test(body))

    expect(priceMutators.map(([, name]) => name)).toEqual(['bulk_update_product_prices'])
    for (const [, , body] of priceMutators) {
      expect(body).toMatch(/v_actor uuid := auth\.uid\(\)/i)
      expect(body).toMatch(/IF NOT public\.is_admin\(\)/i)
    }
  })

  it('hardens the exact legacy bulk price RPC without adding an overload', () => {
    const migration = sql()
    expect(migration.match(/CREATE OR REPLACE FUNCTION public\.bulk_update_product_prices\(/gi)).toHaveLength(1)
    expect(migration).toMatch(/bulk_update_product_prices\( p_updates jsonb, p_keterangan text DEFAULT NULL, p_user_id uuid DEFAULT NULL \)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public/i)
    expect(migration).toMatch(/p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_actor/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.bulk_update_product_prices\(jsonb, text, uuid\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.bulk_update_product_prices\(jsonb, text, uuid\) TO authenticated/i)
  })

  it('passes bulk price updates as a JSON array instead of a string', () => {
    expect(productsApi).toMatch(/p_updates:\s*updates/)
    expect(productsApi).not.toMatch(/p_updates:\s*JSON\.stringify\(updates\)/)
  })

  it('accepts array payloads, safely normalizes legacy strings, and preserves price reasons', () => {
    const migration = sql()
    const bulkPrice = migration.match(/CREATE OR REPLACE FUNCTION public\.bulk_update_product_prices\([\s\S]*?\$\$;/i)?.[0] ?? ''
    const priceTrigger = migration.match(/CREATE OR REPLACE FUNCTION public\.record_price_change\(\)[\s\S]*?\$\$;/i)?.[0] ?? ''

    expect(bulkPrice).toMatch(/jsonb_typeof\(p_updates\) = 'string'/i)
    expect(bulkPrice).toMatch(/v_updates := \(p_updates #>> '\{\}'\)::jsonb/i)
    expect(bulkPrice).toMatch(/jsonb_typeof\(v_updates\) IS DISTINCT FROM 'array'/i)
    expect(bulkPrice).toMatch(/set_config\('zeepos\.price_change_reason', COALESCE\(p_keterangan, ''\), true\)/i)
    expect(priceTrigger).toMatch(/changed_by[\s\S]*auth\.uid\(\)/i)
    expect(priceTrigger).toMatch(/NULLIF\(current_setting\('zeepos\.price_change_reason', true\), ''\)/i)
  })

  it('defaults future functions to no public execution and installs an exact RPC allowlist', () => {
    const migration = sql()
    expect(migration).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/i)
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.close_cash_shift\(uuid, numeric, numeric, text\) FROM PUBLIC, anon/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.close_cash_shift\(uuid, numeric, numeric, text\) TO authenticated, service_role/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_transaction_atomic\(jsonb, uuid, numeric, numeric, numeric, numeric, numeric, numeric, public\.metode_bayar, numeric, numeric, text, integer\) TO authenticated, service_role/i)
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.record_price_change\(\) FROM PUBLIC, anon, authenticated, service_role/i)
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.check_transaction_customer_tenant\(\) FROM PUBLIC, anon, authenticated, service_role/i)
  })

  it('revokes public and anonymous execution from every existing public function', () => {
    expect(sql()).toMatch(/FOR v_function IN SELECT p\.oid::regprocedure AS signature[\s\S]*n\.nspname = 'public'[\s\S]*REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon/i)
  })

  it('keeps trusted audit insertion internal while exposing only actor-bound logging', () => {
    const migration = sql()
    const internalAudit = migration.match(/CREATE OR REPLACE FUNCTION public\.insert_audit_log\([\s\S]*?\$\$;/i)?.[0] ?? ''
    expect(internalAudit).not.toMatch(/p_user_id IS DISTINCT FROM auth\.uid\(\)|p_user_id IS DISTINCT FROM v_actor/i)
    expect(internalAudit).toMatch(/SELECT p\.tenant_id INTO v_tenant FROM public\.profiles AS p WHERE p\.id = p_user_id/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.insert_audit_log\([^;]+\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.insert_audit_log\([^;]+\) TO service_role/i)
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.log_my_audit_event\([^;]+\) FROM PUBLIC, anon, authenticated/i)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.log_my_audit_event\([^;]+\) TO authenticated/i)
    expect(migration).toMatch(/VALUES\s*\(v_tenant,\s*auth\.uid\(\)/i)
    expect(migration).not.toMatch(/CREATE POLICY[^;]+ON public\.audit_logs FOR INSERT/i)
  })

  it('revokes direct execution of audit trigger functions', () => {
    for (const triggerFunction of ['log_transaction_audit', 'log_stock_adjustment_audit', 'log_price_history_audit']) {
      expect(sql()).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${triggerFunction}\\(\\) FROM PUBLIC, anon, authenticated`, 'i'))
    }
  })

  it('allows only a shift owner or tenant admin to close a cash shift', () => {
    expect(sql()).toMatch(/close_cash_shift[\s\S]*IF v_shift\.kasir_id IS DISTINCT FROM v_user_id AND NOT public\.is_admin\(\)/i)
  })

  it('isolates product image writes by tenant prefix', () => {
    const migration = sql()
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(migration).toMatch(new RegExp(`CREATE POLICY[^;]+ON storage\\.objects FOR ${operation}[^;]+is_admin[^;]+\\(storage\\.foldername\\(name\\)\\)\\[1\\] = (?:public\\.)?get_my_tenant_id\\(\\)::text`, 'i'))
    }
  })

  it('rejects transaction customers from another tenant', () => {
    expect(sql()).toMatch(/CREATE TRIGGER transactions_customer_tenant_guard[\s\S]*check_transaction_customer_tenant/i)
  })
})
