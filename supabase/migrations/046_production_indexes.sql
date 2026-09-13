-- Migration 046: Production query performance indexes with tenant isolation

-- 1. Fast transaction queries by date, status, and tenant
CREATE INDEX IF NOT EXISTS idx_transactions_tenant_created_status
ON public.transactions(tenant_id, created_at DESC, status, payment_status);

-- 2. Fast barcode scanner lookup on active products
CREATE INDEX IF NOT EXISTS idx_products_tenant_barcode_active
ON public.products(tenant_id, barcode)
WHERE is_active = true AND barcode IS NOT NULL;

-- 3. Fast transaction items lookup
CREATE INDEX IF NOT EXISTS idx_transaction_items_tenant_trans
ON public.transaction_items(tenant_id, transaction_id);

-- 4. Fast active cash shift lookup
CREATE INDEX IF NOT EXISTS idx_cash_shifts_tenant_status
ON public.cash_shifts(tenant_id, status);
