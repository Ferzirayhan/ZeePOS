# Deployment runbook

This runbook separates database changes from the static frontend release. Commands below are operator instructions; do not run them against production without the approvals, project reference, backup, and change window required by your organization.

## 1. Pre-deployment checks

1. Confirm the target Supabase project reference and production frontend URL.
2. Confirm the checked-out commit passed `npm test`, `npm run test:coverage`, `npm run lint`, and `npm run build` on Node 20.
3. Verify `VITE_SUPABASE_URL` points to the target project and `VITE_SUPABASE_ANON_KEY` is that project's public anon key. Never place a service-role key in frontend or hosting variables.
4. Review every pending file in `supabase/migrations/` in numeric order and compare the remote migration history.

## 2. Back up before migration

Create and verify a restorable database backup before changing production. Use a Supabase dashboard backup/PITR snapshot when available, or an operator-approved `pg_dump` procedure. Record the backup identifier, creation time, target project, and restore owner in the change ticket. Do not continue until the backup is complete and its retention is confirmed.

Storage objects are not included in a database-only backup. Back up irreplaceable objects in the `product-images` bucket separately if required by the recovery policy.

## 3. Link and apply migrations

Use the Supabase CLI only from an authenticated operator environment where it is installed:

```bash
supabase login
supabase link --project-ref <production-project-ref>
supabase migration list
supabase db push --dry-run
supabase db push
supabase migration list
```

Migrations are applied in filename order. Inspect the dry-run and ensure all expected earlier migrations are already recorded. Do not edit an already-applied migration; add a forward migration instead.

**Production gate:** `054_security_boundary_hardening.sql` followed by `055_transaction_inventory_invariants.sql` must be applied to the live Supabase project before the frontend deploy. The repository tests are SQL static checks only; they do not claim that these migrations ran successfully on a live database.

## 4. Auth redirect URLs

For local development, configure the Supabase site URL and allowed redirect URL as `http://localhost:5173` (the committed local CLI config uses the equivalent loopback URL `http://127.0.0.1:5173`).

In Supabase Dashboard → Authentication → URL Configuration:

- set **Site URL** to the canonical production URL, for example `https://pos.example.com`;
- add that exact production URL and any required callback path to the redirect allow-list;
- remove obsolete preview or localhost URLs from the production project when they are no longer needed.

Test password recovery and login redirects after changing these values.

## 5. Storage bucket and policies

Confirm the private `product-images` bucket exists. Verify the policies created by migrations `016_storage_products_bucket.sql` and `054_security_boundary_hardening.sql` are present. Authenticated users may read required images, while writes must require an active tenant admin and an object key whose first folder is that tenant ID. Do not replace these tenant-scoped policies with a public bucket.

## 6. Frontend deployment

Only after the production migration gate and configuration checks pass:

```bash
npm ci
npm test
npm run test:coverage
npm run lint
npm run build
```

Deploy `dist/` through the configured Vercel or Cloudflare Pages project using Node 20 and the production `VITE_SUPABASE_URL` and anon key. Retain the previous frontend artifact/release for rollback.

## 7. Smoke tests

Run these smoke tests as both an admin and, where applicable, a cashier in a dedicated production test tenant:

1. Sign in and confirm the redirect returns to the production URL.
2. Load products and verify tenant data isolation.
3. Upload and display a product image; confirm its key is tenant-prefixed.
4. Complete a cash sale and verify stock decreases once.
5. Retry the same checkout request and verify idempotency prevents a duplicate transaction.
6. Attempt an over-stock or cross-tenant transaction and verify it is rejected.
7. Confirm dashboard/report totals and print a receipt.
8. Confirm no secrets or service-role credentials appear in the browser bundle or console.

## 8. Rollback strategy

Prefer forward database fixes because destructive down migrations can invalidate data written under the new schema. If smoke tests fail:

1. stop the rollout and redeploy the previous frontend artifact;
2. disable affected write paths if frontend rollback is insufficient;
3. capture logs and affected transaction IDs;
4. apply a reviewed forward migration to repair database behavior;
5. restore the pre-migration backup only as the incident lead's last resort, after assessing data created since the backup and separately restoring storage objects if needed.

Never delete production migration-history rows to simulate a rollback.
