import { describe, expect, it } from 'vitest'
import migrationSql from '../../supabase/migrations/055_transaction_inventory_invariants.sql?raw'
import transactionsApi from '../api/transactions.ts?raw'

const sql = () => migrationSql.replace(/\s+/g, ' ')

describe('transaction and inventory invariants migration — schema snapshots', () => {
  it('persists an immutable unit conversion ratio snapshot on transaction_items', () => {
    expect(sql()).toMatch(
      /ALTER TABLE public\.transaction_items\s+ADD COLUMN IF NOT EXISTS rasio NUMERIC\(12,3\)(?:\s+DEFAULT\s+1)?/i,
    )
  })

  it('persists an immutable base-quantity snapshot on transaction_items', () => {
    expect(sql()).toMatch(
      /ALTER TABLE public\.transaction_items\s+ADD COLUMN IF NOT EXISTS base_qty NUMERIC\(12,3\)/i,
    )
  })

  it('persists an immutable unit name snapshot on transaction_items', () => {
    expect(sql()).toMatch(
      /ALTER TABLE public\.transaction_items\s+ADD COLUMN IF NOT EXISTS nama_satuan TEXT/i,
    )
  })

  it('backfills only ratios exactly identifiable from persisted unit metadata', () => {
    expect(sql()).toMatch(/UPDATE public\.transaction_items[\s\S]*FROM public\.product_units/i)
    expect(sql()).toMatch(/pu\.product_id = ti\.product_id[\s\S]*pu\.tenant_id = ti\.tenant_id/i)
    expect(sql()).not.toMatch(/base_qty = COALESCE\(ti\.base_qty, ti\.qty \* COALESCE\(ti\.rasio, 1\)\)/i)
  })

  it('marks unresolved legacy rows ambiguous and requires safe snapshots for new rows', () => {
    expect(sql()).toMatch(/inventory_snapshot_status[\s\S]*ambiguous_legacy/i)
    expect(sql()).toMatch(/CHECK \(inventory_snapshot_status = 'ambiguous_legacy' OR \(rasio IS NOT NULL AND base_qty IS NOT NULL/i)
  })

  it('adds a tenant-scoped idempotency key and payload fingerprint to transactions', () => {
    expect(sql()).toMatch(/ALTER TABLE public\.transactions\s+ADD COLUMN IF NOT EXISTS idempotency_key TEXT/i)
    expect(sql()).toMatch(/ADD COLUMN IF NOT EXISTS request_fingerprint TEXT/i)
  })

  it('enforces idempotency key uniqueness within a single tenant only', () => {
    const migration = sql()
    expect(migration).toMatch(/CREATE UNIQUE INDEX.*ON public\.transactions.*\(tenant_id, idempotency_key\).*WHERE idempotency_key IS NOT NULL/i)
  })
})

describe('create_transaction_atomic — server-side discount and stock aggregation', () => {
  const createFn = () => {
    const migration = sql()
    const match = migration.match(/CREATE OR REPLACE FUNCTION public\.create_transaction_atomic\([\s\S]*?\$function\$;/i)
    return match?.[0] ?? ''
  }

  it('accepts a tenant-scoped idempotency key parameter', () => {
    expect(createFn()).toMatch(/p_idempotency_key text/i)
  })

  it('installs pgcrypto safely in extensions without relocating an existing install', () => {
    const migration = sql()
    expect(migration).toMatch(/CREATE SCHEMA IF NOT EXISTS extensions/i)
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions/i)
    expect(migration).toMatch(/IF pgcrypto_schema <> 'extensions'[\s\S]*CREATE OR REPLACE FUNCTION extensions\.digest/i)
    expect(migration).not.toMatch(/ALTER EXTENSION pgcrypto SET SCHEMA/i)
  })

  it('server-computes a deterministic fingerprint and binds retries to it', () => {
    const fn = createFn()
    expect(fn).toMatch(/extensions\.digest\([\s\S]*sha256/i)
    expect(fn).not.toMatch(/(?<!\.)\bdigest\s*\(/i)
    expect(fn).toMatch(/request_fingerprint[\s\S]*v_request_fingerprint/i)
    expect(fn).toMatch(/Kunci idempotensi sudah digunakan untuk payload berbeda/i)
  })

  it('recomputes item discounts from product_discount_tiers, ignoring client diskon_item_persen', () => {
    const fn = createFn()
    expect(fn).toMatch(/product_discount_tiers/i)
    expect(fn).toMatch(/v_diskon_item_persen\s*:=\s*GREATEST\(\s*v_tier_diskon/i)
    expect(fn).toMatch(/v_qty\s*>=\s*d\.min_qty/i)
  })

  it('aggregates base-qty demand by product before any deduction', () => {
    const fn = createFn()
    expect(fn).toMatch(/GROUP BY.*product_id/i)
    expect(fn).toMatch(/v_demand.*base_qty/i)
  })

  it('checks aggregate demand against product stock before deducting', () => {
    expect(createFn()).toMatch(/v_demand\.total_base_qty.*v_product\.stok|v_product\.stok.*v_demand\.total_base_qty/i)
  })

  it('validates the customer belongs to the transaction tenant inside the RPC', () => {
    expect(createFn()).toMatch(/SELECT 1 FROM public\.customers[\s\S]*WHERE.*id = p_customer_id.*AND tenant_id = v_tenant_id/i)
  })

  it('returns subtotal, diskon_amount, ppn_amount, total, kembalian, and idempotency state for recovery', () => {
    const fn = createFn()
    expect(fn).toMatch(/'transaction_id', v_transaction_id/i)
    expect(fn).toMatch(/'subtotal', v_computed_subtotal/i)
    expect(fn).toMatch(/'diskon_amount', v_diskon_amount/i)
    expect(fn).toMatch(/'ppn_amount', v_ppn_amount/i)
    expect(fn).toMatch(/'total', v_total/i)
    expect(fn).toMatch(/'kembalian', v_kembalian/i)
    expect(fn).toMatch(/'idempotent', (v_idempotent|true|false)/i)
  })

  it('persists rasio, base_qty, and nama_satuan snapshots on each transaction item', () => {
    const fn = createFn()
    expect(fn).toMatch(/INSERT INTO.*transaction_items[\s\S]*rasio[\s\S]*base_qty[\s\S]*nama_satuan/i)
  })

  it('deducts the aggregate base quantity from products.stok', () => {
    expect(createFn()).toMatch(/UPDATE.*products[\s\S]*SET stok = COALESCE\(stok, 0\) - v_stok_potong/i)
  })
})

describe('cancellation paths restore exact base quantity idempotently', () => {
  const cancelPendingFn = () => {
    const migration = sql()
    const match = migration.match(/CREATE OR REPLACE FUNCTION public\.cancel_pending_transaction\([\s\S]*?\$\$;/i)
    return match?.[0] ?? ''
  }

  const cancelAtomicFn = () => {
    const migration = sql()
    const match = migration.match(/CREATE OR REPLACE FUNCTION public\.cancel_transaction_atomic\([\s\S]*?\$\$;/i)
    return match?.[0] ?? ''
  }

  it('cancel_pending_transaction restores base_qty (not unit qty) to products.stok', () => {
    const fn = cancelPendingFn()
    expect(fn).toMatch(/COALESCE\(v_item\.base_qty[\s\S]*\)/i)
    expect(fn).not.toMatch(/SET stok = COALESCE\(stok, 0\) \+ v_item\.qty\b/i)
  })

  it('cancel_pending_transaction records base_qty in the stock adjustment', () => {
    const fn = cancelPendingFn()
    expect(fn).toMatch(/v_restore_qty\s*:=\s*COALESCE\(v_item\.base_qty/i)
    expect(fn).toMatch(/'masuk'[\s\S]*v_restore_qty[\s\S]*v_restore_qty/i)
  })

  it('cancel_pending_transaction is idempotent on repeated cancellation', () => {
    expect(cancelPendingFn()).toMatch(/IF v_transaction\.status = 'batal'[\s\S]*RETURN/i)
  })

  it('cancel_pending_transaction is tenant-scoped', () => {
    expect(cancelPendingFn()).toMatch(/WHERE id = p_transaction_id AND tenant_id = v_tenant_id/i)
  })

  it('cancel_transaction_atomic restores base_qty (not unit qty) to products.stok', () => {
    const fn = cancelAtomicFn()
    expect(fn).toMatch(/COALESCE\(v_item\.base_qty[\s\S]*\)/i)
    expect(fn).not.toMatch(/SET stok = COALESCE\(stok, 0\) \+ v_item\.qty\b/i)
  })

  it('cancel_transaction_atomic records base_qty in the stock adjustment', () => {
    const fn = cancelAtomicFn()
    expect(fn).toMatch(/v_restore_qty\s*:=\s*COALESCE\(v_item\.base_qty/i)
    expect(fn).toMatch(/'masuk'[\s\S]*v_restore_qty[\s\S]*v_restore_qty/i)
  })

  it('cancel_transaction_atomic is idempotent on repeated cancellation', () => {
    expect(cancelAtomicFn()).toMatch(/IF v_transaction\.status = 'batal'[\s\S]*RETURN/i)
  })

  it('cancel_transaction_atomic is tenant-scoped', () => {
    expect(cancelAtomicFn()).toMatch(/WHERE id = p_transaction_id AND tenant_id = v_tenant_id/i)
  })

  it('both cancellation paths reject ambiguous legacy inventory snapshots before restoring stock', () => {
    for (const fn of [cancelPendingFn(), cancelAtomicFn()]) {
      expect(fn).toMatch(/ambiguous_legacy[\s\S]*rekonsiliasi manual/i)
    }
  })

  it('locks the linked receivable and rejects cancellation after any receivable payment', () => {
    const fn = cancelAtomicFn()
    expect(fn).toMatch(/FROM public\.receivables[\s\S]*FOR UPDATE/i)
    expect(fn).toMatch(/jumlah_dibayar[^;]*> 0[\s\S]*pembayaran piutang/i)
  })

  it('cancels an unpaid receivable and decrements customer debt once without going negative', () => {
    const fn = cancelAtomicFn()
    expect(fn).toMatch(/UPDATE public\.receivables[\s\S]*status = 'dibatalkan'/i)
    expect(fn).toMatch(/UPDATE public\.customers[\s\S]*GREATEST\(0, total_hutang - v_receivable\.sisa_hutang\)/i)
    expect(fn).toMatch(/IF v_transaction\.status = 'batal'[\s\S]*RETURN/i)
  })
})

describe('transactions API — idempotency key and recovery data', () => {
  it('CreateTransactionInput accepts an idempotency key', () => {
    expect(transactionsApi).toMatch(/idempotencyKey\?:\s*string \| null/i)
  })

  it('createTransaction sends the idempotency key to the RPC', () => {
    expect(transactionsApi).toMatch(/p_idempotency_key/i)
    expect(transactionsApi).toMatch(/idempotencyKey/i)
  })
})
