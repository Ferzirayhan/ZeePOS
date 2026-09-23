import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration068Path = resolve(
  __dirname,
  '../../supabase/migrations/068_read_authorization_hardening.sql',
)
const migration068Sql = readFileSync(migration068Path, 'utf-8')

const rollback068Path = resolve(
  __dirname,
  '../../supabase/rollback/068_rollback.sql',
)
const rollback068Sql = readFileSync(rollback068Path, 'utf-8')

describe('Migration 068 guards (Task 16.8)', () => {
  it('semua 4 fungsi laporan memuat is_admin() di body dengan pesan penolakan', () => {
    const reportFunctions = [
      'get_profit_summary',
      'get_top_products',
      'get_sales_by_date',
      'get_dashboard_stats',
    ]

    for (const fn of reportFunctions) {
      expect(migration068Sql).toContain(`FUNCTION public.${fn}`)
    }

    const matches = migration068Sql.match(/is_admin\(\)/g)
    expect(matches).not.toBeNull()
    // 4 for report functions + 1 for product_price_history + 1 for profiles = 6 total
    expect(matches!.length).toBeGreaterThanOrEqual(6)

    expect(migration068Sql).toContain(
      "RAISE EXCEPTION 'Akses ditolak: laporan hanya untuk admin'",
    )
  })

  it('mencabut hak SELECT harga_beli pada products dan product_units', () => {
    expect(migration068Sql).toMatch(
      /REVOKE\s+SELECT\s*\(\s*harga_beli\s*\)\s+ON\s+public\.products\s+FROM\s+authenticated/i,
    )
    expect(migration068Sql).toMatch(
      /REVOKE\s+SELECT\s*\(\s*harga_beli\s*\)\s+ON\s+public\.product_units\s+FROM\s+authenticated/i,
    )
  })

  it('mencabut hak SELECT harga_beli dan laba_kotor pada transaction_items', () => {
    expect(migration068Sql).toMatch(
      /REVOKE\s+SELECT\s*\(\s*harga_beli\s*,\s*laba_kotor\s*\)\s+ON\s+public\.transaction_items\s+FROM\s+authenticated/i,
    )
  })

  it('mempersempit policy profiles_tenant_select dengan id = auth.uid() OR public.is_admin()', () => {
    expect(migration068Sql).toContain('profiles_tenant_select')
    expect(migration068Sql).toMatch(/id\s*=\s*auth\.uid\(\)\s+OR\s+public\.is_admin\(\)/i)
  })

  it('mempersempit policy product_price_history_tenant_select dengan is_admin()', () => {
    expect(migration068Sql).toContain('product_price_history_tenant_select')
    expect(migration068Sql).toMatch(/tenant_id\s*=\s*public\.get_my_tenant_id\(\)\s+AND\s+public\.is_admin\(\)/i)
  })

  it('mempertahankan semantik agregasi 066 (base_qty, batas eksklusif)', () => {
    expect(migration068Sql).toContain('base_qty')
    expect(migration068Sql).toContain('created_at < p_date_to')
    expect(migration068Sql).toContain('created_at < v_today_end')
  })

  it('rollback file 068 mengembalikan hak dan policy versi 067', () => {
    expect(rollback068Sql).toMatch(/GRANT\s+SELECT\s*\(\s*harga_beli\s*\)\s+ON\s+public\.products\s+TO\s+authenticated/i)
    expect(rollback068Sql).toMatch(/GRANT\s+SELECT\s*\(\s*harga_beli\s*\)\s+ON\s+public\.product_units\s+TO\s+authenticated/i)
    expect(rollback068Sql).toMatch(/GRANT\s+SELECT\s*\(\s*harga_beli\s*,\s*laba_kotor\s*\)\s+ON\s+public\.transaction_items\s+TO\s+authenticated/i)
    expect(rollback068Sql).not.toContain('is_admin()')
  })
})
