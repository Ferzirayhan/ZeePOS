-- ====================================================================
-- Migrasi 052: Tambah opsi 'hutang' ke enum metode_bayar
-- ====================================================================
ALTER TYPE metode_bayar ADD VALUE IF NOT EXISTS 'hutang';
