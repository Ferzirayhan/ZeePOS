import { beforeEach, describe, expect, it } from 'vitest'
import { useCartStore } from '../stores/cartStore'
import type { CartItem } from '../types'
import type { ProductWithCategory } from '../types/database'

function mockProduct(overrides: Partial<ProductWithCategory> = {}): ProductWithCategory {
  return {
    id: 1,
    nama: 'Test Produk',
    harga_jual: 10000,
    harga_beli: 7000,
    diskon_produk_persen: null,
    product_group_id: null,
    stok: 10,
    stok_minimum: 5,
    stok_status: 'aman',
    is_active: true,
    sku: 'TST-001',
    barcode: null,
    category_id: 1,
    category_nama: 'Test Kategori',
    satuan: 'pcs',
    deskripsi: null,
    foto_url: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe('cartStore', () => {
  beforeEach(() => {
    // clearCart sengaja mempertahankan tarif PPN (konfigurasi toko), jadi reset
    // tarifnya secara eksplisit supaya antar-test tetap terisolasi.
    useCartStore.getState().clearCart()
    useCartStore.getState().setPpnPersen(0)
  })

  describe('addItem', () => {
    it('menambahkan produk baru ke cart', () => {
      const product = mockProduct()
      useCartStore.getState().addItem(product)

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].qty).toBe(1)
      expect(items[0].subtotal).toBe(10000)
    })

    it('increment qty jika produk sudah ada di cart', () => {
      const product = mockProduct()
      useCartStore.getState().addItem(product)
      useCartStore.getState().addItem(product)

      const { items } = useCartStore.getState()
      expect(items).toHaveLength(1)
      expect(items[0].qty).toBe(2)
      expect(items[0].subtotal).toBe(20000)
    })

    it('throw error jika stok habis', () => {
      const product = mockProduct({ stok: 0 })
      expect(() => useCartStore.getState().addItem(product)).toThrow()
    })

    it('throw error jika qty melebihi stok', () => {
      const product = mockProduct({ stok: 1 })
      useCartStore.getState().addItem(product)
      expect(() => useCartStore.getState().addItem(product)).toThrow()
    })
  })

  describe('updateQty', () => {
    it('update qty dan recalculate subtotal', () => {
      const product = mockProduct({ stok: 5 })
      useCartStore.getState().addItem(product)
      useCartStore.getState().updateQty(1, 3)

      const { items } = useCartStore.getState()
      expect(items[0].qty).toBe(3)
      expect(items[0].subtotal).toBe(30000)
    })

    it('hapus item jika qty diupdate ke 0', () => {
      const product = mockProduct()
      useCartStore.getState().addItem(product)
      useCartStore.getState().updateQty(1, 0)

      expect(useCartStore.getState().items).toHaveLength(0)
    })

    it('throw error jika qty melebihi stok', () => {
      const product = mockProduct({ stok: 3 })
      useCartStore.getState().addItem(product)
      expect(() => useCartStore.getState().updateQty(1, 5)).toThrow()
    })
  })

  describe('kalkulasi total', () => {
    it('hitung total tanpa diskon dan PPN', () => {
      useCartStore.getState().addItem(mockProduct({ id: 1, harga_jual: 10000, stok: 5 }))
      useCartStore.getState().addItem(mockProduct({ id: 2, harga_jual: 20000, stok: 5 }))

      const { subtotal, total } = useCartStore.getState()
      expect(subtotal).toBe(30000)
      expect(total).toBe(30000)
    })

    it('hitung diskon 10% dengan benar', () => {
      useCartStore.getState().addItem(mockProduct({ harga_jual: 100000, stok: 5 }))
      useCartStore.getState().setDiskon(10)

      const { diskon_amount, total } = useCartStore.getState()
      expect(diskon_amount).toBe(10000)
      expect(total).toBe(90000)
    })

    it('hitung PPN 11% setelah diskon', () => {
      useCartStore.getState().addItem(mockProduct({ harga_jual: 100000, stok: 5 }))
      useCartStore.getState().setDiskon(10)
      useCartStore.getState().setPpnPersen(11)
      useCartStore.getState().togglePPN()

      const { ppn_amount, total } = useCartStore.getState()
      expect(ppn_amount).toBe(9900)
      expect(total).toBe(99900)
    })

    it('hitung kembalian dengan benar', () => {
      useCartStore.getState().addItem(mockProduct({ harga_jual: 75000, stok: 5 }))
      useCartStore.getState().setMetodeBayar('tunai')
      useCartStore.getState().setUangDiterima(100000)

      expect(useCartStore.getState().kembalian).toBe(25000)
    })

    it('kembalian 0 jika uang pas', () => {
      useCartStore.getState().addItem(mockProduct({ harga_jual: 50000, stok: 5 }))
      useCartStore.getState().setUangDiterima(50000)

      expect(useCartStore.getState().kembalian).toBe(0)
    })
  })

  describe('setDiskon', () => {
    it('tidak boleh lebih dari 100', () => {
      useCartStore.getState().setDiskon(150)
      expect(useCartStore.getState().diskon_persen).toBe(100)
    })

    it('tidak boleh negatif', () => {
      useCartStore.getState().setDiskon(-10)
      expect(useCartStore.getState().diskon_persen).toBe(0)
    })
  })

  describe('clearCart', () => {
    it('reset isi keranjang dan diskon transaksi', () => {
      useCartStore.getState().addItem(mockProduct())
      useCartStore.getState().setDiskon(20)
      useCartStore.getState().clearCart()

      const state = useCartStore.getState()
      expect(state.items).toHaveLength(0)
      expect(state.diskon_persen).toBe(0)
      expect(state.total).toBe(0)
    })

    it('mempertahankan tarif PPN toko agar keranjang berikutnya tetap dikutip dengan PPN', () => {
      // Regresi: ppn_persen sempat ter-reset ke 0 di sini, sehingga setelah
      // "Tahan Pesanan" / "Kosongkan Keranjang" kasir dikutip total tanpa PPN
      // sedangkan server tetap menagih PPN (checkout tunai ditolak).
      useCartStore.getState().setPpnPersen(11)
      useCartStore.getState().addItem(mockProduct())
      useCartStore.getState().clearCart()

      expect(useCartStore.getState().ppn_persen).toBe(11)

      useCartStore.getState().addItem(mockProduct())
      expect(useCartStore.getState().ppn_amount).toBeGreaterThan(0)
    })
  })

  /**
   * Preservation klausa 3.11 (baseline task 2): perilaku parkir → lanjut pesanan.
   * Nilai di bawah diamati pada kode sebelum perbaikan apa pun di batch ini.
   */
  describe('restoreCart (preservation 3.11)', () => {
    it('memulihkan line beserta stok dasar dan menegakkan kembali batas stok agregat', () => {
      useCartStore.getState().setPpnPersen(11)
      useCartStore.getState().restoreCart({
        items: [
          {
            product_id: 1,
            sku: 'TST-001',
            nama_produk: 'Test Produk (dus)',
            harga_satuan: 100000,
            qty: 3,
            subtotal: 300000,
            stok_dasar: 48,
            satuan: 'dus',
            discount_tiers: [],
            diskon_produk_persen: 0,
            diskon_item_persen: 0,
            rasio: 12,
            unit_id: 91,
          },
        ],
        diskon_persen: 5,
        use_ppn: true,
      })

      const state = useCartStore.getState()
      expect(state.items).toHaveLength(1)
      expect(state.subtotal).toBe(300000)
      expect(state.diskon_persen).toBe(5)
      expect(state.diskon_amount).toBe(15000)
      // ppn_persen toko dipertahankan saat payload tidak membawanya.
      expect(state.ppn_persen).toBe(11)
      expect(state.ppn_amount).toBe(31350)
      expect(state.total).toBe(316350)
      // uang diterima selalu direset oleh restore.
      expect(state.uang_diterima).toBe(0)

      // Batas stok agregat ditegakkan kembali: 4 dus = 48 base masih pas, 5 dus ditolak.
      useCartStore.getState().updateQty(1, 4, 91)
      expect(useCartStore.getState().items[0].qty).toBe(4)
      expect(() => useCartStore.getState().updateQty(1, 5, 91)).toThrow('melebihi stok')
    })

    it('menormalkan payload parkir lama yang menyimpan stok dalam satuan jual', () => {
      useCartStore.getState().restoreCart({
        items: [
          {
            product_id: 1,
            sku: 'TST-001',
            nama_produk: 'Test Produk (dus)',
            harga_satuan: 100000,
            qty: 1,
            subtotal: 100000,
            satuan: 'dus',
            discount_tiers: [],
            diskon_produk_persen: 0,
            diskon_item_persen: 0,
            rasio: 12,
            unit_id: 91,
            // payload lama: stok_tersedia dalam satuan jual (dus), tanpa stok_dasar
            stok_tersedia: 3,
          } as unknown as CartItem,
        ],
      })

      expect(useCartStore.getState().items[0].stok_dasar).toBe(36)
      useCartStore.getState().updateQty(1, 3, 91)
      expect(useCartStore.getState().items[0].qty).toBe(3)
      expect(() => useCartStore.getState().updateQty(1, 4, 91)).toThrow('melebihi stok')
    })
  })
})
