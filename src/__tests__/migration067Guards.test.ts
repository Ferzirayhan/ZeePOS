import { describe, expect, it } from 'vitest'
import migrationSql from '../../supabase/migrations/067_receivable_tempo_refund_symmetry_and_read_paths.sql?raw'

/**
 * Penjaga teks untuk migrasi 067.
 *
 * Tidak ada Postgres di mesin ini maupun di CI (Docker mati, `psql` tidak
 * terpasang), jadi SINTAKS SQL TIDAK DAPAT DIPERIKSA di sini. Yang diasersi
 * adalah BENTUK berkas migrasi: keputusan-keputusan yang mahal untuk ditemukan
 * kembali (dan mudah dirusak oleh edit "membantu") diikat ke teks.
 *
 * Seluruh asersi dijalankan atas SQL yang komentarnya SUDAH DIBUANG, supaya
 * header penjelasan di 067 (yang memang menyebut nama objek dan keputusan yang
 * dibatalkan) tidak pernah lolos sebagai bukti perilaku.
 */

const stripSqlComments = (input: string): string =>
  input.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

const executableSql = stripSqlComments(migrationSql).replace(/\s+/g, ' ')

const block = (pattern: RegExp): string => {
  const found = executableSql.match(pattern)
  expect(found, `blok tidak ditemukan: ${pattern}`).not.toBeNull()
  return found![0]
}

const createTransactionAtomic = () =>
  block(/CREATE OR REPLACE FUNCTION public\.create_transaction_atomic\([\s\S]*?\$function\$;/i)
const refundTransactionAtomic = () =>
  block(/CREATE OR REPLACE FUNCTION public\.refund_transaction_atomic\([\s\S]*?\$function\$;/i)
const cashReceiptsSummary = () =>
  block(/CREATE OR REPLACE FUNCTION public\.get_cash_receipts_summary\([\s\S]*?\$function\$;/i)
const view = (name: string) =>
  block(new RegExp(`CREATE VIEW public\\.${name} WITH[\\s\\S]*?;`, 'i'))

/** Nama kolom keluaran sebuah select-list view, dalam urutan aslinya. */
const selectedColumns = (viewSql: string, fromClause: string): string[] => {
  const selectList = viewSql
    .slice(viewSql.indexOf(' AS SELECT ') + ' AS SELECT '.length, viewSql.indexOf(fromClause))
    .trim()

  return selectList
    .split(',')
    .map((expression) => expression.trim())
    .filter((expression) => expression.length > 0)
    .map((expression) => {
      const aliased = expression.match(/\bAS\s+([a-z_][a-z0-9_]*)\s*$/i)
      if (aliased) return aliased[1]
      const qualified = expression.match(/([a-z_][a-z0-9_]*)\s*$/i)
      return qualified ? qualified[1] : expression
    })
}

describe('migrasi 067 — jatuh tempo piutang, refund tunai, dan jalur baca', () => {
  it('mengisi jatuh_tempo dari tenor WIB pada INSERT INTO public.receivables', () => {
    const body = createTransactionAtomic()
    const receivablesInsert = body.match(/INSERT INTO public\.receivables \([\s\S]*?\);/i)?.[0] ?? ''

    expect(receivablesInsert).toContain('jatuh_tempo')
    expect(receivablesInsert).toMatch(/AT TIME ZONE 'Asia\/Jakarta'\)::date \+ v_tempo_hari/i)
    expect(body).toMatch(/key = 'tempo_hutang_hari'/i)
    expect(body).toMatch(/v_tempo_hari := LEAST\(GREATEST\(COALESCE\(NULLIF\(v_setting_tempo, ''\)::INTEGER, 14\), 0\), 365\)/i)
  })

  it('menjaga tempo_hutang_hari TIDAK masuk perhitungan request_fingerprint', () => {
    const body = createTransactionAtomic()
    const fingerprintCalls = [
      ...body.matchAll(/v_request_fingerprint := public\.zeepos_checkout_fingerprint\([^)]*\)/gi),
    ].map((match) => match[0])

    expect(fingerprintCalls).toHaveLength(2)
    for (const call of fingerprintCalls) {
      expect(call).not.toMatch(/tempo/i)
    }
    expect(body).not.toMatch(/zeepos_checkout_fingerprint\([^)]*tempo/i)
  })

  it('mempertahankan perubahan 066 verbatim saat fungsi checkout di-re-emit', () => {
    const body = createTransactionAtomic()

    expect(body).toContain('DELETE FROM tmp_demand')
    expect(body).toContain('ROUND(')
    expect(body).toMatch(/v_item_subtotal := ROUND\([^;]*, 0\)/i)
    expect(body).toMatch(/v_ppn_amount := ROUND\([^;]*, 0\)/i)
  })

  it('mewajibkan shift kasir aktif hanya untuk refund tunai', () => {
    const body = refundTransactionAtomic()

    expect(body).toMatch(
      /IF v_trx\.metode_bayar = 'tunai' AND v_shift_id IS NULL THEN RAISE EXCEPTION 'Refund tunai membutuhkan shift kasir aktif\. Buka shift terlebih dahulu\.'/i,
    )
    expect(body).toMatch(/IF NOT v_is_admin THEN RAISE EXCEPTION/i)
    expect(body).toContain('INSERT INTO public.transaction_refunds')
  })

  it('TIDAK menyentuh close_cash_shift (keputusan pembatalan 6.2 dari pengukuran)', () => {
    // Task 5 mengukur bahwa `AND status = 'selesai'` pada leg tunai close_cash_shift
    // menghasilkan selisih +12.500 di mana kode sekarang benar menghasilkan 0.
    // Karena itu 067 tidak boleh menyentuh fungsi itu sama sekali. Asersi dijalankan
    // atas SQL tanpa komentar: header 067 memang MENJELASKAN pembatalan ini.
    expect(executableSql).not.toMatch(/close_cash_shift/i)
    expect(migrationSql).toMatch(/6\.2 DIBATALKAN/)
  })

  it('tidak memuat blok backfill jatuh_tempo untuk piutang lama', () => {
    expect(executableSql).not.toMatch(/UPDATE public\.receivables[^;]*jatuh_tempo/i)
  })

  it('menyemai tempo_hutang_hari secara idempoten', () => {
    const seed = block(/INSERT INTO public\.store_settings \(tenant_id, key, value\)[\s\S]*?;/i)

    expect(seed).toMatch(/SELECT t\.id, 'tempo_hutang_hari', '14'/i)
    expect(seed).toMatch(/WHERE NOT EXISTS/i)
    expect(seed).toMatch(/ON CONFLICT \(tenant_id, key\) DO NOTHING/i)
  })
})

describe('migrasi 067 — bentuk view jalur kasir dan jalur admin', () => {
  it('membuang harga_beli dari products_with_category tanpa mengubah security_invoker', () => {
    const catalog = view('products_with_category')

    expect(catalog).toMatch(/WITH \(security_invoker = true\)/i)
    expect(catalog).not.toMatch(/harga_beli/i)
    expect(catalog).not.toMatch(/\bp\.\*/)
  })

  it('mengunci 19 kolom products_with_category supaya updated_at/created_at tidak hilang', () => {
    // getProductsPage melakukan `.order(filters.sortBy ?? 'updated_at')` DI ATAS view
    // ini, dan `created_at` adalah salah satu nilai sah sortBy. Menghapus salah satunya
    // membuat daftar produk gagal keras di PostgREST, bukan sekadar kehilangan kolom.
    const columns = selectedColumns(view('products_with_category'), 'FROM public.products p')

    expect(columns).toEqual([
      'id',
      'sku',
      'barcode',
      'nama',
      'deskripsi',
      'category_id',
      'satuan',
      'harga_jual',
      'stok',
      'stok_minimum',
      'foto_url',
      'is_active',
      'created_at',
      'updated_at',
      'diskon_produk_persen',
      'product_group_id',
      'tenant_id',
      'category_nama',
      'stok_status',
    ])
    expect(columns).toHaveLength(19)
  })

  it('menggerbangi view admin dengan security_invoker = false dan is_admin()', () => {
    for (const name of ['products_admin_with_category', 'product_units_admin']) {
      const adminView = view(name)
      expect(adminView).toMatch(/WITH \(security_invoker = false\)/i)
      expect(adminView).toMatch(/public\.is_admin\(\)/i)
      expect(adminView).toMatch(/tenant_id = public\.get_my_tenant_id\(\)/i)
      expect(adminView).toMatch(/harga_beli/i)
      expect(executableSql).toMatch(new RegExp(`REVOKE ALL ON public\\.${name} FROM PUBLIC, anon`, 'i'))
      expect(executableSql).toMatch(new RegExp(`GRANT SELECT ON public\\.${name} TO authenticated`, 'i'))
    }

    const adminProducts = selectedColumns(view('products_admin_with_category'), 'FROM public.products p')
    const kasirProducts = selectedColumns(view('products_with_category'), 'FROM public.products p')
    expect(adminProducts).toEqual(expect.arrayContaining(kasirProducts))
    expect(adminProducts).toContain('harga_beli')
  })

  it('menahan laba_kotor dan harga_beli di jalur baca kasir', () => {
    const kasirTransactions = view('transactions_with_kasir')
    const items = view('transaction_items_public')

    expect(kasirTransactions).not.toMatch(/laba_kotor/i)
    expect(kasirTransactions).toMatch(/WITH \(security_invoker = false\)/i)
    expect(kasirTransactions).toMatch(/WHERE t\.tenant_id = public\.get_my_tenant_id\(\)/i)
    expect(kasirTransactions).not.toMatch(/public\.is_admin\(\)/i)

    expect(items).toMatch(/WITH \(security_invoker = true\)/i)
    expect(items).not.toMatch(/harga_beli/i)
    expect(items).not.toMatch(/laba_kotor/i)
  })

  it('menyimpan laba_kotor hanya pada view riwayat transaksi admin', () => {
    const adminTransactions = view('transactions_with_kasir_admin')

    expect(adminTransactions).toMatch(/WITH \(security_invoker = false\)/i)
    expect(adminTransactions).toMatch(/SUM\(ti\.laba_kotor\)/i)
    expect(adminTransactions).toMatch(/public\.is_admin\(\)/i)
  })
})

describe('migrasi 067 — RPC kas dan audit path storage', () => {
  it('menggerbangi get_cash_receipts_summary dengan is_admin dan batas atas eksklusif', () => {
    const summary = cashReceiptsSummary()

    expect(summary).toMatch(/SECURITY DEFINER SET search_path = pg_catalog, public/i)
    expect(summary).toMatch(/IF NOT public\.is_admin\(\) THEN RAISE EXCEPTION/i)
    expect(summary).toMatch(/t\.paid_at < p_date_to/i)
    expect(summary).toMatch(/t\.created_at < p_date_to/i)
    expect(summary).not.toMatch(/<= p_date_to/i)
    expect(summary).toMatch(/v_kas_dari_penjualan \+ v_kas_dari_cicilan - v_refund_kas/i)
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_cash_receipts_summary\(timestamptz, timestamptz\) FROM PUBLIC, anon/i,
    )
    expect(executableSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_cash_receipts_summary\(timestamptz, timestamptz\) TO authenticated, service_role/i,
    )
  })

  it('menyaring refund_kas berdasarkan metode bayar, simetris dengan kas_dari_penjualan', () => {
    // Cacat yang ditemukan verifikasi task 7: leg refund menjumlah SEMUA
    // transaction_refunds tanpa filter metode, sehingga refund 'hutang' (yang
    // tidak memindahkan uang sama sekali) ikut mengurangi kas. Angka teramati:
    // refund_kas 55.000 padahal seharusnya 45.000, kas_diterima -50.000 padahal
    // seharusnya -40.000. Asersi di bawah mengikat filternya, sekaligus menolak
    // bentuk lama yang tanpa filter.
    const summary = cashReceiptsSummary()
    const refundLeg =
      summary.match(/INTO v_refund_kas FROM public\.transaction_refunds tr WHERE[^;]*;/i)?.[0] ?? ''

    expect(refundLeg, 'leg refund_kas tidak ditemukan').not.toBe('')
    expect(refundLeg).toMatch(/AND tr\.payment_method IN \('tunai', 'qris', 'transfer'\)/i)
    expect(refundLeg).not.toMatch(/payment_method[^)]*'hutang'/i)

    // Daftar metode pada leg refund WAJIB sama dengan daftar pada leg penjualan:
    // itulah definisi simetri yang dilanggar oleh cacat ini.
    const salesMethods = summary.match(/t\.metode_bayar IN \(([^)]*)\)/i)?.[1]
    const refundMethods = refundLeg.match(/tr\.payment_method IN \(([^)]*)\)/i)?.[1]
    expect(refundMethods).toBe(salesMethods)

    // Bentuk tanpa filter (SUM(tr.amount) yang langsung lompat ke rentang tanggal)
    // harus gagal: hapus filternya dan asersi ini menyala.
    expect(summary).not.toMatch(
      /INTO v_refund_kas FROM public\.transaction_refunds tr WHERE tr\.tenant_id = v_tenant_id AND tr\.created_at >= p_date_from/i,
    )
  })

  it('tidak memunculkan objek storage yatim sebagai target pemindahan', () => {
    const audit = view('product_image_path_audit')

    expect(audit).toMatch(/JOIN public\.products p ON p\.foto_url LIKE '%' \|\| o\.name/i)
    expect(audit).not.toMatch(/LEFT JOIN public\.products/i)
    expect(audit).toMatch(/o\.bucket_id = 'products'/i)
    expect(audit).toMatch(/\(storage\.foldername\(o\.name\)\)\[1\] IS DISTINCT FROM p\.tenant_id::text/i)
    expect(audit).toMatch(/public\.is_admin\(\)/i)
    expect(audit).toMatch(/o\.name AS object_name/i)
    expect(audit).toMatch(/p\.tenant_id,/i)
    expect(audit).toMatch(/p\.id AS product_id/i)
    expect(audit).toMatch(/AS target_name/i)
  })

  it('mencabut hak PUBLIC/anon untuk setiap fungsi dan view yang disentuh', () => {
    for (const signature of [
      'public\\.create_transaction_atomic\\(',
      'public\\.refund_transaction_atomic\\(integer, text, text\\)',
      'public\\.get_cash_receipts_summary\\(timestamptz, timestamptz\\)',
    ]) {
      expect(executableSql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${signature}`, 'i'))
    }

    for (const name of [
      'products_with_category',
      'products_admin_with_category',
      'product_units_admin',
      'transaction_items_public',
      'transactions_with_kasir',
      'transactions_with_kasir_admin',
      'product_image_path_audit',
    ]) {
      expect(executableSql).toMatch(new RegExp(`REVOKE ALL ON public\\.${name} FROM PUBLIC, anon`, 'i'))
      expect(executableSql).toMatch(new RegExp(`GRANT SELECT ON public\\.${name} TO authenticated`, 'i'))
    }
  })
})
