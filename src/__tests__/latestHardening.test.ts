import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import productsApiSource from '../api/products.ts?raw'
import migration057 from '../../supabase/migrations/057_strict_financial_ledger_and_refunds.sql?raw'
import migration058 from '../../supabase/migrations/058_atomic_discount_tiers.sql?raw'

const compact = (source: string) => source.replace(/\s+/g, ' ')

describe('latest production hardening', () => {
  it('loads every route page on demand instead of adding it to the initial bundle', () => {
    for (const page of [
      'LandingPage', 'LoginPage', 'RegisterPage', 'DashboardPage', 'POSPage',
      'CustomersPage', 'GuidePage', 'ProductsPage', 'StockPage', 'ReportsPage',
      'AuditPage', 'SettingsPage', 'NotFoundPage',
    ]) {
      expect(appSource).toMatch(new RegExp(`const ${page} = lazy\\(`))
      expect(appSource).toMatch(new RegExp(`import\\('./pages/${page}'\\)`))
      expect(appSource).not.toMatch(new RegExp(`import \\{ ${page} \\} from './pages/${page}'`))
    }
    expect(appSource).toContain('<Suspense fallback={<RouteLoader />}>')
  })

  it('keeps refund, receivable idempotency, and server-authoritative tax in the latest migration', () => {
    const sql = compact(migration057)
    expect(sql).toMatch(/refund_transaction_atomic\([\s\S]*p_idempotency_key text[\s\S]*Hanya transaksi yang sudah dibayar/i)
    expect(sql).toMatch(/pay_receivable_atomic\([\s\S]*Kunci idempotensi .* wajib disertakan/i)
    expect(sql).toMatch(/SELECT value INTO v_setting_ppn_val[\s\S]*WHERE tenant_id = v_tenant_id AND key = 'ppn_persen'/i)
    expect(sql).toMatch(/v_server_ppn_persen := COALESCE\(NULLIF\(v_setting_ppn_val, ''\)::NUMERIC, 0\)/i)
  })

  it('replaces discount tiers through the tenant-scoped atomic RPC', () => {
    const sql = compact(migration058)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.replace_product_discount_tiers\([\s\S]*SECURITY DEFINER[\s\S]*public\.is_admin\(\)/i)
    expect(sql).toMatch(/WHERE id = p_product_id AND tenant_id = v_tenant_id FOR UPDATE/i)
    expect(sql).toMatch(/DELETE FROM public\.product_discount_tiers[\s\S]*INSERT INTO public\.product_discount_tiers/i)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.replace_product_discount_tiers\(integer, jsonb\) FROM PUBLIC, anon/i)
    expect(productsApiSource).toMatch(/rpc\('replace_product_discount_tiers'/)
    expect(productsApiSource).not.toMatch(/from\('product_discount_tiers'\)\.delete\(\)/)
  })
})
