import { describe, expect, it } from 'vitest'
import productsApiSource from '../api/products.ts?raw'
import migration054 from '../../supabase/migrations/054_security_boundary_hardening.sql?raw'
import migration016 from '../../supabase/migrations/016_storage_products_bucket.sql?raw'

const collapse = (sql: string) => sql.replace(/\s+/g, ' ')

describe('product-image storage tenant scoping', () => {
  it('uploads every product image under a tenant-id path prefix', () => {
    // The frontend must build the storage object key as
    // `${tenantId}/...` so the RLS policy
    // (storage.foldername(name))[1] = get_my_tenant_id()::text
    // can enforce per-tenant isolation. A flat key (e.g. just a uuid) would
    // be uploadable by any admin regardless of the folder-name guard.
    expect(productsApiSource).toMatch(/filePath\s*=\s*`\$\{tenantId\}\/\$\{fileName\}`/)
    expect(productsApiSource).not.toMatch(/filePath\s*=\s*fileName\b/)
  })

  it('the storage bucket and MIME/size limits are declared once in 016', () => {
    const sql = collapse(migration016)
    expect(sql).toContain("bucket_id = 'products'")
    expect(sql).toContain('image/jpeg')
    expect(sql).toContain('file_size_limit')
  })

  it('migration 054 replaces the legacy public folder-name guard with a tenant-id guard', () => {
    const sql = collapse(migration054)
    // The old 016 policies checked (storage.foldername(name))[1] = 'products'.
    // 054 must drop those and replace them with the tenant-id guard for every
    // write operation.
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Admin can upload product images" ON storage\.objects/)
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Admin can update product images" ON storage\.objects/)
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Admin can delete product images" ON storage\.objects/)
    expect(sql).toMatch(
      /product_images_tenant_insert ON storage\.objects FOR INSERT[^;]+is_admin\(\)[^;]+\(storage\.foldername\(name\)\)\[1\] = public\.get_my_tenant_id\(\)::text/i,
    )
    expect(sql).toMatch(
      /product_images_tenant_update ON storage\.objects FOR UPDATE[^;]+is_admin\(\)[^;]+\(storage\.foldername\(name\)\)\[1\] = public\.get_my_tenant_id\(\)::text/i,
    )
    expect(sql).toMatch(
      /product_images_tenant_delete ON storage\.objects FOR DELETE[^;]+is_admin\(\)[^;]+\(storage\.foldername\(name\)\)\[1\] = public\.get_my_tenant_id\(\)::text/i,
    )
  })
})
