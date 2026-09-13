export type UserRole = 'admin' | 'kasir'
export type SatuanType = 'pcs' | 'lusin' | 'kg' | 'meter' | 'pack' | 'gram' | 'dus' | 'ikat' | 'bal' | 'roll' | 'batang' | 'lembar'
export type MetodeBayar = 'tunai' | 'transfer' | 'qris'
export type StatusTransaksi = 'selesai' | 'batal'
export type PaymentStatus = 'menunggu_konfirmasi' | 'dibayar' | 'gagal'
export type JenisAdjustment = 'masuk' | 'keluar' | 'koreksi' | 'terjual'
export type StokStatus = 'aman' | 'menipis' | 'habis'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          nama: string
          username: string
          role: UserRole | null
          is_active: boolean | null
          tenant_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          nama: string
          username: string
          role?: UserRole | null
          is_active?: boolean | null
          tenant_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          nama?: string
          username?: string
          role?: UserRole | null
          is_active?: boolean | null
          tenant_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: number
          nama: string
          deskripsi: string | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: number
          nama: string
          deskripsi?: string | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: number
          nama?: string
          deskripsi?: string | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          id: number
          sku: string | null
          barcode: string | null
          nama: string
          deskripsi: string | null
          category_id: number | null
          satuan: SatuanType | null
          harga_beli: number | null
          harga_jual: number
          diskon_produk_persen: number | null
          product_group_id: number | null
          stok: number | null
          stok_minimum: number | null
          foto_url: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          sku?: string | null
          barcode?: string | null
          nama: string
          deskripsi?: string | null
          category_id?: number | null
          satuan?: SatuanType | null
          harga_beli?: number | null
          harga_jual: number
          diskon_produk_persen?: number | null
          product_group_id?: number | null
          stok?: number | null
          stok_minimum?: number | null
          foto_url?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          sku?: string | null
          barcode?: string | null
          nama?: string
          deskripsi?: string | null
          category_id?: number | null
          satuan?: SatuanType | null
          harga_beli?: number | null
          harga_jual?: number
          diskon_produk_persen?: number | null
          product_group_id?: number | null
          stok?: number | null
          stok_minimum?: number | null
          foto_url?: string | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      product_discount_tiers: {
        Row: {
          id: number
          product_id: number
          min_qty: number
          diskon_persen: number
          created_at: string | null
        }
        Insert: {
          id?: number
          product_id: number
          min_qty: number
          diskon_persen: number
          created_at?: string | null
        }
        Update: {
          id?: number
          product_id?: number
          min_qty?: number
          diskon_persen?: number
          created_at?: string | null
        }
        Relationships: []
      }
      product_price_history: {
        Row: {
          id: number
          product_id: number
          harga_beli: number
          harga_jual: number
          changed_by: string | null
          keterangan: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          product_id: number
          harga_beli: number
          harga_jual: number
          changed_by?: string | null
          keterangan?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          product_id?: number
          harga_beli?: number
          harga_jual?: number
          changed_by?: string | null
          keterangan?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          id: number
          user_id: string | null
          entity_type: string
          entity_id: string | null
          action: string
          description: string
          metadata: Record<string, unknown> | null
          created_at: string
        }
        Insert: {
          id?: number
          user_id?: string | null
          entity_type: string
          entity_id?: string | null
          action: string
          description: string
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: number
          user_id?: string | null
          entity_type?: string
          entity_id?: string | null
          action?: string
          description?: string
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          id: number
          nomor_nota: string
          kasir_id: string | null
          subtotal: number
          diskon_persen: number | null
          diskon_amount: number | null
          ppn_persen: number | null
          ppn_amount: number | null
          total: number
          metode_bayar: MetodeBayar
          uang_diterima: number | null
          kembalian: number | null
          catatan: string | null
          status: StatusTransaksi | null
          payment_status: PaymentStatus
          paid_at: string | null
          confirmed_by: string | null
          payment_reference: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          nomor_nota: string
          kasir_id?: string | null
          subtotal: number
          diskon_persen?: number | null
          diskon_amount?: number | null
          ppn_persen?: number | null
          ppn_amount?: number | null
          total: number
          metode_bayar: MetodeBayar
          uang_diterima?: number | null
          kembalian?: number | null
          catatan?: string | null
          status?: StatusTransaksi | null
          payment_status?: PaymentStatus
          paid_at?: string | null
          confirmed_by?: string | null
          payment_reference?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          nomor_nota?: string
          kasir_id?: string | null
          subtotal?: number
          diskon_persen?: number | null
          diskon_amount?: number | null
          ppn_persen?: number | null
          ppn_amount?: number | null
          total?: number
          metode_bayar?: MetodeBayar
          uang_diterima?: number | null
          kembalian?: number | null
          catatan?: string | null
          status?: StatusTransaksi | null
          payment_status?: PaymentStatus
          paid_at?: string | null
          confirmed_by?: string | null
          payment_reference?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      transaction_items: {
        Row: {
          id: number
          transaction_id: number | null
          product_id: number | null
          nama_produk: string
          harga_satuan: number
          harga_beli: number
          qty: number
          subtotal: number
          laba_kotor: number | null
          diskon_item_persen: number | null
        }
        Insert: {
          id?: number
          transaction_id?: number | null
          product_id?: number | null
          nama_produk: string
          harga_satuan: number
          harga_beli?: number
          qty: number
          subtotal: number
          diskon_item_persen?: number | null
          laba_kotor?: never
        }
        Update: {
          id?: number
          transaction_id?: number | null
          product_id?: number | null
          nama_produk?: string
          harga_satuan?: number
          harga_beli?: number
          qty?: number
          subtotal?: number
          diskon_item_persen?: number | null
          laba_kotor?: never
        }
        Relationships: []
      }
      stock_adjustments: {
        Row: {
          id: number
          product_id: number | null
          user_id: string | null
          jenis: JenisAdjustment
          jumlah_sebelum: number
          jumlah_perubahan: number
          jumlah_sesudah: number
          keterangan: string | null
          reference_id: string | null
          created_at: string | null
        }
        Insert: {
          id?: number
          product_id?: number | null
          user_id?: string | null
          jenis: JenisAdjustment
          jumlah_sebelum: number
          jumlah_perubahan: number
          jumlah_sesudah: number
          keterangan?: string | null
          reference_id?: string | null
          created_at?: string | null
        }
        Update: {
          id?: number
          product_id?: number | null
          user_id?: string | null
          jenis?: JenisAdjustment
          jumlah_sebelum?: number
          jumlah_perubahan?: number
          jumlah_sesudah?: number
          keterangan?: string | null
          reference_id?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      store_settings: {
        Row: {
          id: number
          key: string
          value: string | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          key: string
          value?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          key?: string
          value?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      products_with_category: {
        Row: {
          id: number | null
          sku: string | null
          barcode: string | null
          nama: string | null
          deskripsi: string | null
          category_id: number | null
          satuan: SatuanType | null
          harga_beli: number | null
          harga_jual: number | null
          diskon_produk_persen: number | null
          product_group_id: number | null
          stok: number | null
          stok_minimum: number | null
          foto_url: string | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
          category_nama: string | null
          stok_status: StokStatus | null
        }
        Relationships: []
      }
      transactions_with_kasir: {
        Row: {
          id: number | null
          nomor_nota: string | null
          kasir_id: string | null
          subtotal: number | null
          diskon_persen: number | null
          diskon_amount: number | null
          ppn_persen: number | null
          ppn_amount: number | null
          total: number | null
          metode_bayar: MetodeBayar | null
          uang_diterima: number | null
          kembalian: number | null
          catatan: string | null
          status: StatusTransaksi | null
          payment_status: PaymentStatus | null
          paid_at: string | null
          confirmed_by: string | null
          payment_reference: string | null
          created_at: string | null
          kasir_nama: string | null
          confirmed_by_nama: string | null
          jumlah_item: number | null
          laba_kotor: number | null
        }
        Relationships: []
      }
      audit_logs_with_user: {
        Row: {
          id: number | null
          user_id: string | null
          entity_type: string | null
          entity_id: string | null
          action: string | null
          description: string | null
          metadata: Record<string, unknown> | null
          created_at: string | null
          actor_nama: string | null
          actor_role: UserRole | null
        }
        Relationships: []
      }
    }
    Functions: {
      register_tenant: {
        Args: {
          p_tenant_name: string
          p_tenant_slug: string
          p_user_name: string
          p_username: string
        }
        Returns: {
          tenant_id: string
          profile_id: string
        }
      }
      create_transaction_atomic: {
        Args: {
          p_items: string
          p_kasir_id: string
          p_subtotal: number
          p_diskon_persen: number
          p_diskon_amount: number
          p_ppn_persen: number
          p_ppn_amount: number
          p_total: number
          p_metode_bayar: MetodeBayar
          p_uang_diterima: number | null
          p_kembalian: number | null
          p_catatan: string | null
        }
        Returns: {
          transaction_id: number
          nomor_nota: string
          payment_status: PaymentStatus
        }
      }
      confirm_transaction_payment: {
        Args: {
          p_transaction_id: number
          p_payment_reference?: string | null
        }
        Returns: {
          transaction_id: number
          payment_status: PaymentStatus
        }
      }
      get_profit_summary: {
        Args: {
          p_date_from: string
          p_date_to: string
        }
        Returns: {
          tanggal: string
          total_omzet: number
          total_hpp: number
          total_laba: number
          jumlah_transaksi: number
        }[]
      }
      cancel_pending_transaction: {
        Args: {
          p_transaction_id: number
          p_reason?: string | null
        }
        Returns: {
          transaction_id: number
          status: StatusTransaksi
          payment_status: PaymentStatus
        }
      }
      generate_nomor_nota: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_dashboard_stats: {
        Args: Record<PropertyKey, never>
        Returns: {
          total_penjualan_hari_ini: number
          jumlah_transaksi_hari_ini: number
          jumlah_produk_stok_menipis: number
          produk_terlaris_hari_ini: {
            product_id: number | null
            nama: string | null
            qty: number
          } | null
        }
      }
      get_sales_by_date: {
        Args: {
          date_from: string
          date_to: string
        }
        Returns: {
          tanggal: string
          total_penjualan: number
          jumlah_transaksi: number
        }[]
      }
      get_top_products: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_limit?: number
        }
        Returns: {
          product_id: number
          nama_produk: string
          total_qty: number
          total_penjualan: number
        }[]
      }
      cancel_transaction_atomic: {
        Args: {
          p_transaction_id: number
        }
        Returns: {
          transaction_id: number
          status: string
        }
      }
      repack_stock_atomic: {
        Args: {
          p_source_product_id: number
          p_target_product_id: number
          p_source_qty: number
          p_target_qty: number
          p_user_id?: string | null
        }
        Returns: {
          success: boolean
          source_stock: number
          target_stock: number
        }
      }
      bulk_update_product_prices: {
        Args: {
          p_updates: string
          p_keterangan?: string | null
          p_user_id?: string | null
        }
        Returns: number
      }
      adjust_stock_atomic: {
        Args: {
          p_product_id: number
          p_jenis: string
          p_jumlah: number
          p_keterangan?: string | null
          p_user_id?: string | null
        }
        Returns: {
          stok_sebelum: number
          stok_sesudah: number
          jumlah_perubahan: number
        }
      }
    }
    Enums: {
      user_role: UserRole
      satuan_type: SatuanType
      metode_bayar: MetodeBayar
      status_transaksi: StatusTransaksi
      payment_status: PaymentStatus
      jenis_adjustment: JenisAdjustment
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type ProductDiscountTier = Database['public']['Tables']['product_discount_tiers']['Row']
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Category = Database['public']['Tables']['categories']['Row']
export type Product = Database['public']['Tables']['products']['Row']
export type Transaction = Database['public']['Tables']['transactions']['Row']
export type TransactionItem = Database['public']['Tables']['transaction_items']['Row']
export type StockAdjustment = Database['public']['Tables']['stock_adjustments']['Row']
export type StoreSetting = Database['public']['Tables']['store_settings']['Row']
export type ProductWithCategory =
  Database['public']['Views']['products_with_category']['Row']
export type TransactionWithKasir =
  Database['public']['Views']['transactions_with_kasir']['Row']
