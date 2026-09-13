-- Pengaturan toko
INSERT INTO store_settings (key, value) VALUES
('nama_toko', 'ZeePOS Store'),
('alamat', 'Jl. Utama No. 123, Jakarta'),
('no_telp', '0812-3456-7890'),
('header_struk', 'ZeePOS Store\nJl. Utama No. 123, Jakarta\nTelp: 0812-3456-7890'),
('footer_struk', 'Terima kasih telah berbelanja!\nBarang yang sudah dibeli tidak dapat dikembalikan.'),
('ppn_persen', '0'),
('payment_qris_label', 'QRIS ZeePOS'),
('payment_transfer_label', 'Transfer Bank'),
('payment_transfer_account_name', 'ZeePOS Store'),
('payment_transfer_account_number', ''),
('payment_transfer_bank', ''),
('payment_whatsapp_number', ''),
('payment_confirmation_note', 'Pastikan dana sudah masuk sebelum struk dicetak.'),
('versi_app', '1.0.0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Data kategori dan produk sengaja dikosongkan
-- agar admin bisa mengisi sendiri dari aplikasi.

-- Catatan pembuatan user auth
-- Email: admin@zeepos.com | Password: Admin@123
-- Email: kasir1@zeepos.com | Password: Kasir@123
-- Setelah user dibuat di dashboard, data profile bisa diinsert manual atau via trigger.
