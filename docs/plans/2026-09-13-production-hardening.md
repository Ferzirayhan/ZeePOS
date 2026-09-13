# ZeePOS Production Hardening Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Menutup celah keamanan multi-tenant dan memperbaiki invariant transaksi, stok, checkout, cart, offline cache, printing, serta quality gate agar ZeePOS layak masuk tahap UAT production.

**Architecture:** Database Supabase/PostgreSQL menjadi trust boundary: identitas, tenant, role, harga, diskon, stok, dan idempotency ditentukan server. Frontend hanya mengirim intent, memakai stable cart-line identity, serta membedakan offline catalog-only dari transaksi online. Perubahan database dibuat lewat migration baru agar instalasi existing bisa di-upgrade tanpa mengedit histori migration.

**Tech Stack:** PostgreSQL/Supabase RLS & RPC, React 18, TypeScript, Zustand, Vitest, React Testing Library, GitHub Actions.

---

## Task 1: Security boundary migration

Create `supabase/migrations/054_security_boundary_hardening.sql` plus SQL/static assertions. Add active membership/admin helpers, remove direct profile insertion/security-column updates, split RLS by operation and role, make ledger/audit writes RPC-only, derive actors from `auth.uid()`, verify shift owner/admin, tenant-scope customers and storage paths, and revoke default execute privileges. Verify through Supabase reset/tests if available; otherwise use explicit static checks and document the limitation.

## Task 2: Transaction and inventory invariants

Create `supabase/migrations/055_transaction_inventory_invariants.sql` and regression tests. Persist immutable unit/base-quantity snapshots and tenant-scoped idempotency keys. Aggregate base stock by product before deduction, compute discounts server-side, validate customer tenant, return enough committed data for recovery, and make both cancellation paths restore exact base quantity idempotently. Update `src/api/transactions.ts` and generated/manual types.

## Task 3: Checkout and cart correctness

Write failing tests, then update `src/pages/POSPage.tsx`, `src/stores/cartStore.ts`, `src/stores/heldCartStore.ts`, and related components. Use product+unit stable line identity, consume held carts, include/reset customer state, lock payment synchronously before the first await, and reuse a stable idempotency key during retry/recovery.

## Task 4: Canonical multi-unit POS

Connect `product_units` to POS choices and barcode lookup through `src/api/units.ts`, `src/api/products.ts`, `src/pages/POSPage.tsx`, and cart state. Aggregate frontend base-stock requirements by product. Keep product variants explicitly independent from unit conversions and document that invariant.

### Invariant: variants vs. units are independent

ZeePOS models two distinct multi-line concepts for a single catalog item. They MUST stay independent:

- **Product variant** = a separate `products` row sharing a `product_group_id` with a root product. A variant is its own stockable item: it has its own `stok`, `sku`, `barcode`, and `harga_jual`. Adding a variant to the cart creates a cart line keyed by that variant's `product_id` with `unit_id = null` and `rasio = 1`. Variant stock is never converted; it is deducted 1:1 from the variant's own `products.stok`.
- **Product unit** = a `product_units` row on a single product. A unit is a sales-pack (e.g. dus = 12 pcs) that converts a sale quantity to a base quantity (`qty * rasio`) deducted from that one product's `products.stok`. Adding a unit creates a cart line keyed by `product_id + unit_id` carrying the unit's `rasio` and `harga_jual`.

Rules enforced by this separation:
1. A cart line is identified by `product_id + unit_id`. Two lines of the same `product_id` with different `unit_id` are independent unit lines (units). Two lines of different `product_id` (even if they share a `product_group_id`) are independent variant lines.
2. Base-stock demand is aggregated only across lines that share the same `product_id` (i.e. across units of one product). Variant lines never pool stock with each other, because each variant owns its own `products.stok`.
3. The server RPC (`create_transaction_atomic`) re-derives `rasio`, `harga_jual`, and `diskon_item_persen` from the database and aggregates base-qty demand per `product_id` before deduction. The frontend mirrors this aggregation (`aggregateBaseStockDemand`) so the UI cannot let a cashier add more units than base stock allows.
4. Barcode lookup consults `products.barcode` first, then `product_units.barcode`. A variant barcode resolves to the variant product; a unit barcode resolves to the parent product plus the matching `product_units` row. The two lookup paths never cross.

## Task 5: Offline catalog-only safety

Partition and transactionally replace IndexedDB snapshots by tenant, track freshness/version, clear sensitive cache on logout/account switch, and disable checkout while offline. Align `public/sw.js`, `README.md`, and `APP_GUIDE.md` so the claim is catalog-only rather than offline sales. Add regression tests.

## Task 6: Print/storage/browser hardening

Replace raw database-string HTML interpolation in product/settings printing with text-safe DOM or React rendering, sever popup opener access, add compatible security headers/CSP, and tenant-scope product-image keys/policies. Add malicious-string regression tests.

## Task 7: Quality gates and operations

Add `.github/workflows/ci.yml`, coverage tooling/configuration, database migration static checks, and `docs/DEPLOYMENT.md`. CI runs install, tests/coverage, lint, build, and migration checks. Document Supabase migrations, auth redirects, storage, backup, rollback, and smoke tests. Audit dependencies without forced major upgrades.

## Task 8: Final integration and pull request

Rebase on `origin/main`, run independent spec/security/code-quality reviews, fix blockers, run all local gates, push `fix/production-hardening`, and open a non-auto-merged PR. Verify PR URL/state/head SHA and report live-Supabase migration as an explicit operator step.
