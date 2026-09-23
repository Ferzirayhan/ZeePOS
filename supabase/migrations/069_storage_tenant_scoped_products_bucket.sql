-- ====================================================================
-- Migrasi 069 — Penyempitan Kebijakan Storage Products Bucket
--
-- Mengubah bucket products dari public menjadi private (public = false).
-- Mengganti policy SELECT publik dengan policy yang dibatasi per-tenant
-- berdasarkan segmen folder pertama (/<tenant-id>/).
--
-- Prasyarat:
-- - Task 19.1 & 19.2: Semua objek lama sudah dipindahkan ke format /<tenant-id>/
-- - Task 19.3: Frontend memuat gambar lewat signed URL ber-TTL pendek
-- ====================================================================

-- 1. Hapus policy SELECT publik lama
DROP POLICY IF EXISTS product_images_public_select ON storage.objects;

-- 2. Buat policy SELECT baru yang dibatasi per-tenant untuk pengguna terautentikasi
DROP POLICY IF EXISTS product_images_tenant_select ON storage.objects;
CREATE POLICY product_images_tenant_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] = public.get_my_tenant_id()::text
  );

-- 3. Privatkan bucket products: matikan akses publik langsung
UPDATE storage.buckets
SET public = false
WHERE id = 'products';
