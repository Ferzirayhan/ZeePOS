import { format } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelPendingTransaction,
  confirmTransactionPayment,
  createTransaction,
  getPendingTransactions,
} from '../api/transactions'
import {
  getActiveCategories,
  getAllProductDiscountTiersMap,
  getAllProductVariantsMap,
  getProductByBarcode,
  getProducts,
} from '../api/products'
import type { DiscountTierRow } from '../api/products'
import { getSettings } from '../api/settings'
import { CartItem } from '../components/pos/CartItem'
import { ProductCard } from '../components/pos/ProductCard'
import { ReceiptModal } from '../components/pos/ReceiptModal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { Modal } from '../components/ui/Modal'
import { Skeleton } from '../components/ui/Skeleton'
import { useCartStore } from '../stores/cartStore'
import { useAuthStore } from '../stores/authStore'
import { useToastStore } from '../stores/toastStore'
import { useUIStore } from '../stores/uiStore'
import type {
  Category,
  ProductWithCategory,
  Transaction,
  TransactionItem,
  TransactionWithKasir,
} from '../types/database'
import { cn } from '../utils/cn'

const paymentMethods = [
  { value: 'tunai', label: 'Tunai', icon: 'payments' },
  { value: 'transfer', label: 'Transfer', icon: 'account_balance' },
  { value: 'qris', label: 'QRIS', icon: 'qr_code_2' },
] as const

function getPreviewNomorNota() {
  return `NOTA-${format(new Date(), 'yyyyMMdd')}-...`
}

function isBarcodeQuery(value: string) {
  const normalizedValue = value.trim()
  // All-numeric (EAN/UPC scanner output) or PRD-XXXXXX internal SKU format
  return /^\d{8,}$/.test(normalizedValue) || /^PRD-\d+$/i.test(normalizedValue)
}

function formatPendingTime(value: string | null) {
  if (!value) {
    return '-'
  }

  return format(new Date(value), 'HH:mm')
}

export function POSPage() {
  const user = useAuthStore((state) => state.user)
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const pushToast = useToastStore((state) => state.pushToast)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const {
    items,
    diskon_persen,
    use_ppn,
    metode_bayar,
    uang_diterima,
    subtotal,
    diskon_amount,
    ppn_amount,
    total,
    kembalian,
    ppn_persen,
    addItem,
    removeItem,
    updateQty,
    clearCart,
    setDiskon,
    togglePPN,
    setPpnPersen,
    setMetodeBayar,
    setUangDiterima,
  } = useCartStore()

  const [products, setProducts] = useState<ProductWithCategory[]>([])
  const [filteredProducts, setFilteredProducts] = useState<ProductWithCategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tiersMap, setTiersMap] = useState<Record<number, DiscountTierRow[]>>({})
  const [variantsMap, setVariantsMap] = useState<Record<number, ProductWithCategory[]>>({})
  const [unitPickerProduct, setUnitPickerProduct] = useState<ProductWithCategory | null>(null)
  const [pendingTransactions, setPendingTransactions] = useState<TransactionWithKasir[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [uangInput, setUangInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingLoading, setPendingLoading] = useState(true)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [cancelingPayment, setCancelingPayment] = useState(false)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptTransaction, setReceiptTransaction] = useState<Transaction | null>(null)
  const [receiptItems, setReceiptItems] = useState<TransactionItem[]>([])
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<TransactionWithKasir | null>(null)
  const [cancelTarget, setCancelTarget] = useState<TransactionWithKasir | null>(null)
  const [paymentReference, setPaymentReference] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [mobileSection, setMobileSection] = useState<'produk' | 'keranjang' | 'pending'>('produk')

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim())
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [searchQuery])

  const loadCatalogData = useCallback(async () => {
    setLoading(true)

    try {
      const [productsResult, categoriesResult, settingsResult, tiersResult, variantsResult] = await Promise.all([
        getProducts({ isActive: true }),
        getActiveCategories(),
        getSettings(),
        getAllProductDiscountTiersMap(),
        getAllProductVariantsMap(),
      ])

      setProducts(productsResult)
      setCategories(categoriesResult)
      setSettings(settingsResult)
      setTiersMap(tiersResult)
      setVariantsMap(variantsResult)
      setPpnPersen(Number(settingsResult.ppn_persen ?? 0))
    } catch (error) {
      pushToast({
        title: 'Gagal memuat POS',
        description:
          error instanceof Error ? error.message : 'Data POS belum berhasil dimuat.',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [pushToast, setPpnPersen])

  const loadPendingData = useCallback(async () => {
    setPendingLoading(true)

    try {
      const result = await getPendingTransactions()
      setPendingTransactions(result)
    } catch (error) {
      pushToast({
        title: 'Gagal memuat pembayaran pending',
        description:
          error instanceof Error
            ? error.message
            : 'Daftar transaksi pending belum berhasil dimuat.',
        variant: 'error',
      })
    } finally {
      setPendingLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void Promise.all([loadCatalogData(), loadPendingData()])
  }, [loadCatalogData, loadPendingData])

  useEffect(() => {
    // Only show root/standalone products (not variants) in the catalog
    let activeProducts = products.filter((p) => {
      const gid = p.product_group_id
      return gid === null || gid === p.id
    })

    if (selectedCategoryId !== 'all') {
      activeProducts = activeProducts.filter((product) => product.category_id === selectedCategoryId)
    }

    if (debouncedSearch) {
      const lowerCaseQuery = debouncedSearch.toLowerCase()
      activeProducts = activeProducts.filter((product) => {
        const nama = product.nama?.toLowerCase() ?? ''
        const sku = product.sku?.toLowerCase() ?? ''
        const barcode = product.barcode?.toLowerCase() ?? ''
        return (
          nama.includes(lowerCaseQuery) ||
          sku.includes(lowerCaseQuery) ||
          barcode.includes(lowerCaseQuery)
        )
      })
    }

    setFilteredProducts(activeProducts)
  }, [debouncedSearch, products, selectedCategoryId])

  const allCategoryCount = useMemo(
    () => products.filter((product) => Number(product.stok ?? 0) > 0).length,
    [products],
  )

  const quickCashButtons = useMemo(() => {
    return [total, 50_000, 100_000].filter((value, index, array) => array.indexOf(value) === index)
  }, [total])

  const isPaymentDisabled =
    items.length === 0 || (metode_bayar === 'tunai' && uang_diterima < total)

  const handleAddProduct = (product: ProductWithCategory) => {
    const variants = variantsMap[product.id ?? 0]
    if (variants && variants.length > 0) {
      setUnitPickerProduct(product)
      return
    }
    try {
      addItem(product, tiersMap[product.id ?? 0] ?? [])
      setMobileSection('keranjang')
    } catch (error) {
      pushToast({
        title: 'Tidak bisa menambah produk',
        description: error instanceof Error ? error.message : 'Qty produk melebihi stok.',
        variant: 'warning',
      })
    }
  }

  const handleSelectUnit = (product: ProductWithCategory) => {
    setUnitPickerProduct(null)
    try {
      addItem(product, tiersMap[product.id ?? 0] ?? [])
      setMobileSection('keranjang')
    } catch (error) {
      pushToast({
        title: 'Tidak bisa menambah produk',
        description: error instanceof Error ? error.message : 'Qty produk melebihi stok.',
        variant: 'warning',
      })
    }
  }

  const handleBarcodeSearch = async (value: string) => {
    try {
      const foundProduct = await getProductByBarcode(value)

      if (!foundProduct) {
        pushToast({
          title: 'Barcode tidak ditemukan',
          description: 'Produk dengan barcode tersebut belum ada di database.',
          variant: 'warning',
        })
        setSearchQuery('')
        return
      }

      addItem(foundProduct, tiersMap[foundProduct.id ?? 0] ?? [])
      setSearchQuery('')
      pushToast({
        title: 'Produk ditambahkan',
        description: foundProduct.nama ?? 'Produk berhasil masuk keranjang.',
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Barcode tidak ditemukan',
        description: error instanceof Error ? error.message : 'Produk barcode tidak tersedia.',
        variant: 'warning',
      })
      setSearchQuery('')
    }
  }

  const handleProcessPayment = async () => {
    if (items.length === 0) {
      return
    }

    if (metode_bayar === 'tunai' && uang_diterima < total) {
      pushToast({
        title: 'Uang kurang',
        description: 'Nominal uang diterima masih di bawah total pembayaran.',
        variant: 'warning',
      })
      return
    }

    try {
      const freshProducts = await getProducts({ isActive: true })
      const productMap = new Map(freshProducts.map((product) => [product.id, product]))

      for (const item of items) {
        const fresh = productMap.get(item.product_id)

        if (!fresh) {
          pushToast({
            title: 'Produk tidak ditemukan',
            description: `${item.nama_produk} sudah tidak aktif. Hapus dari keranjang sebelum melanjutkan.`,
            variant: 'error',
          })
          return
        }

        const freshStok = Number(fresh.stok ?? 0)

        if (item.qty > freshStok) {
          pushToast({
            title: 'Stok tidak cukup',
            description: `Stok ${item.nama_produk} tersisa ${freshStok}, tapi di keranjang ada ${item.qty}.`,
            variant: 'error',
          })
          return
        }
      }

      setProcessingPayment(true)

      const result = await createTransaction({
        items: items.map((item) => ({
          productId: item.product_id,
          namaProduk: item.nama_produk,
          hargaSatuan: item.harga_satuan,
          qty: item.qty,
          subtotal: item.subtotal,
          diskonItemPersen: item.diskon_item_persen,
        })),
        subtotal,
        diskonPersen: diskon_persen,
        diskonAmount: diskon_amount,
        ppnPersen: use_ppn ? ppn_persen : 0,
        ppnAmount: ppn_amount,
        total,
        metodeBayar: metode_bayar,
        uangDiterima: metode_bayar === 'tunai' ? uang_diterima : null,
        kembalian: metode_bayar === 'tunai' ? kembalian : 0,
      })

      await Promise.all([loadCatalogData(), loadPendingData()])

      if (result.transaction.payment_status === 'dibayar') {
        setReceiptTransaction(result.transaction)
        setReceiptItems(result.items)
        setReceiptOpen(true)
        pushToast({
          title: 'Pembayaran berhasil',
          description: `Transaksi ${result.transaction.nomor_nota} tersimpan.`,
          variant: 'success',
        })
      } else {
        setMobileSection('pending')
        pushToast({
          title: 'Transaksi disimpan',
          description: `Transaksi ${result.transaction.nomor_nota} menunggu konfirmasi dana masuk.`,
          variant: 'info',
        })
      }

      clearCart()
      setSearchQuery('')
      setUangInput('')
      setPpnPersen(Number(settings.ppn_persen ?? 0))
      searchInputRef.current?.focus()
    } catch (error) {
      pushToast({
        title: 'Transaksi gagal',
        description:
          error instanceof Error ? error.message : 'Sistem belum berhasil memproses pembayaran.',
        variant: 'error',
      })
    } finally {
      setProcessingPayment(false)
    }
  }

  const handleConfirmPending = async () => {
    if (!confirmTarget?.id) {
      return
    }

    setConfirmingPayment(true)

    try {
      const detail = await confirmTransactionPayment(confirmTarget.id, paymentReference || null)
      await Promise.all([loadPendingData(), loadCatalogData()])
      setConfirmModalOpen(false)
      setConfirmTarget(null)
      setPaymentReference('')
      setReceiptTransaction(detail.transaction)
      setReceiptItems(detail.items)
      setReceiptOpen(true)
      pushToast({
        title: 'Pembayaran dikonfirmasi',
        description: `Dana untuk ${detail.transaction.nomor_nota} sudah ditandai masuk.`,
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Konfirmasi gagal',
        description:
          error instanceof Error ? error.message : 'Pembayaran belum berhasil dikonfirmasi.',
        variant: 'error',
      })
    } finally {
      setConfirmingPayment(false)
    }
  }

  const handleCancelPending = async () => {
    if (!cancelTarget?.id) {
      return
    }

    const trimmedReason = cancelReason.trim()

    if (!trimmedReason) {
      pushToast({
        title: 'Alasan wajib diisi',
        description: 'Tulis alasan pembatalan supaya admin bisa menelusuri koreksi kasir.',
        variant: 'warning',
      })
      return
    }

    setCancelingPayment(true)

    try {
      await cancelPendingTransaction(cancelTarget.id, `Dibatalkan dari kasir: ${trimmedReason}`)
      await Promise.all([loadPendingData(), loadCatalogData()])
      pushToast({
        title: 'Transaksi pending dibatalkan',
        description: `${cancelTarget.nomor_nota ?? 'Transaksi'} berhasil dibatalkan.`,
        variant: 'success',
      })
      setCancelTarget(null)
      setCancelReason('')
    } catch (error) {
      pushToast({
        title: 'Gagal membatalkan transaksi',
        description:
          error instanceof Error ? error.message : 'Transaksi pending belum berhasil dibatalkan.',
        variant: 'error',
      })
    } finally {
      setCancelingPayment(false)
    }
  }

  const handleNewTransaction = () => {
    clearCart()
    setPpnPersen(Number(settings.ppn_persen ?? 0))
    setReceiptOpen(false)
    setReceiptTransaction(null)
    setReceiptItems([])
    setSearchQuery('')
    setUangInput('')
    searchInputRef.current?.focus()
  }

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pb-28 pt-16 transition-[margin] duration-200 md:pb-0 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_360px]">
        <div className="border-b border-[#eef1f1] bg-white px-4 pb-3 pt-4 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold tracking-[-0.03em] text-[#1b1e20]">POS Kasir</p>
              <p className="text-xs font-medium text-[#8b9895]">{user?.nama ?? 'Kasir aktif'}</p>
            </div>
            <div className="rounded-2xl bg-[#f4fffc] px-3 py-2 text-right">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">Total</p>
              <CurrencyDisplay className="text-sm font-extrabold text-[#0a7c72]" value={total} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-[18px] bg-[#f2f5f5] p-1">
            {[
              ['produk', `Produk`],
              ['keranjang', `Keranjang`],
              ['pending', `Pending`],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMobileSection(value as typeof mobileSection)}
                className={cn(
                  'rounded-[14px] px-3 py-3 text-xs font-extrabold transition-colors',
                  mobileSection === value
                    ? 'bg-white text-[#0a7c72] shadow-[0_8px_18px_rgba(15,23,42,0.08)]'
                    : 'text-[#6f7b79]',
                )}
              >
                {label}
                <span className="mt-1 block text-[10px] font-bold opacity-70">
                  {value === 'produk'
                    ? filteredProducts.length
                    : value === 'keranjang'
                      ? items.length
                      : pendingTransactions.length}
                </span>
              </button>
            ))}
          </div>
        </div>

        <section
          className={cn(
            'border-b border-[#eef1f1] bg-white px-4 py-6 md:border-b-0 md:border-r',
            mobileSection === 'produk' ? 'block' : 'hidden md:block',
          )}
        >
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Cari Produk
            </p>
            <div className="relative mt-3">
              <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#98a19f]">
                search
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    const trimmed = searchQuery.trim()
                    if (isBarcodeQuery(trimmed)) {
                      void handleBarcodeSearch(trimmed)
                    }
                  }
                }}
                placeholder="Nama produk atau SKU"
                className="h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
              />
            </div>
          </div>

          <div className="mt-8">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Kategori
            </p>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2 md:block md:space-y-2 md:overflow-visible md:pb-0">
              <button
                type="button"
                onClick={() => setSelectedCategoryId('all')}
                className={cn(
                  'flex min-w-[140px] items-center justify-between rounded-[14px] px-4 py-3 text-left text-sm font-bold transition-colors md:w-full',
                  selectedCategoryId === 'all'
                    ? 'bg-[#0a7c72] text-white'
                    : 'bg-white text-[#2e3132] shadow-[0_4px_16px_rgba(15,23,42,0.04)]',
                )}
              >
                <span>Semua</span>
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px]">
                  {allCategoryCount}
                </span>
              </button>

              {categories.map((category) => {
                const count = products.filter(
                  (product) =>
                    product.category_id === category.id && Number(product.stok ?? 0) > 0,
                ).length

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(category.id)}
                    className={cn(
                      'flex min-w-[160px] items-center justify-between rounded-[14px] px-4 py-3 text-left text-sm font-semibold transition-colors md:w-full',
                      selectedCategoryId === category.id
                        ? 'bg-[#e7f8f6] text-[#0a7c72]'
                        : 'bg-white text-[#52627d] shadow-[0_4px_16px_rgba(15,23,42,0.04)] hover:bg-[#f7f9f9]',
                    )}
                  >
                    <span>{category.nama}</span>
                    <span className="text-[10px]">{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-auto pt-8 text-xs font-medium text-[#98a19f]">
            Scan barcode juga didukung. Barcode hanya diproses saat Enter ditekan.
          </div>
        </section>

        <section
          className={cn(
            'px-4 py-6 sm:px-6 md:px-5 xl:px-6',
            mobileSection === 'produk' ? 'block' : 'hidden md:block',
          )}
        >
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-[20px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
                Katalog Produk
              </h1>
              <p className="mt-1 text-sm font-medium text-[#8b9895]">
                Pilih produk untuk menambahkannya ke nota penjualan.
              </p>
            </div>
            <div className="hidden items-center gap-3 self-start rounded-full bg-white px-4 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.04)] md:flex">
              <span className="material-symbols-outlined text-[#8b9895]">account_circle</span>
              <div>
                <p className="text-sm font-bold text-[#1b1e20]">{user?.nama ?? 'Kasir'}</p>
                <p className="text-[11px] font-medium text-[#8b9895]">Belanja</p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 12 }).map((_, index) => (
                <Skeleton key={index} className="h-[220px] rounded-[18px]" />
              ))}
            </div>
          ) : filteredProducts.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAdd={handleAddProduct}
                  variantSatuans={(variantsMap[product.id ?? 0] ?? []).map((v) => v.satuan ?? '')}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-[420px] flex-col items-center justify-center rounded-[20px] bg-white text-center shadow-[0_6px_20px_rgba(15,23,42,0.04)]">
              <span className="material-symbols-outlined text-[48px] text-[#c3cbca]">search_off</span>
              <p className="mt-4 text-lg font-bold text-[#1b1e20]">Produk tidak ditemukan</p>
              <p className="mt-2 text-sm font-medium text-[#8b9895]">
                Coba ubah kata kunci pencarian atau pilih kategori lain.
              </p>
            </div>
          )}
        </section>

        <section
          className={cn(
            'border-t border-[#eef1f1] bg-white px-4 py-5 shadow-[0_-8px_24px_rgba(15,23,42,0.03)] md:col-span-2 xl:col-span-1 xl:border-l xl:border-t-0 xl:shadow-[-8px_0_24px_rgba(15,23,42,0.03)]',
            mobileSection === 'produk' ? 'hidden md:block' : 'block',
          )}
        >
          <div
            className={cn(
              'rounded-[18px] border border-[#eef1f1] bg-[#f8fbfb] p-4',
              mobileSection === 'keranjang' ? 'hidden md:block' : 'block',
            )}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Pending Hari Ini
                </p>
                <p className="mt-1 text-sm font-bold text-[#1b1e20]">
                  {pendingTransactions.length} transaksi menunggu konfirmasi
                </p>
              </div>
              <span className="rounded-full bg-[#fff5e8] px-3 py-1 text-[10px] font-extrabold uppercase text-[#855300]">
                Non Tunai
              </span>
            </div>

            <div className="custom-scrollbar mt-3 max-h-[180px] space-y-3 overflow-y-auto pr-1">
              {pendingLoading ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-20 rounded-[14px]" />
                ))
              ) : pendingTransactions.length > 0 ? (
                pendingTransactions.map((transaction) => (
                  <div key={transaction.id} className="rounded-[16px] bg-white p-3 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-extrabold text-[#1b1e20]">
                          {transaction.nomor_nota ?? '-'}
                        </p>
                        <p className="mt-1 text-xs font-medium text-[#8b9895]">
                          {transaction.metode_bayar?.toUpperCase()} • {formatPendingTime(transaction.created_at)}
                        </p>
                      </div>
                      <CurrencyDisplay
                        className="text-sm font-extrabold text-[#0a7c72]"
                        value={Number(transaction.total ?? 0)}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmTarget(transaction)
                          setPaymentReference(transaction.payment_reference ?? '')
                          setConfirmModalOpen(true)
                        }}
                        className="rounded-[12px] bg-[#0a7c72] px-3 py-2 text-xs font-bold text-white"
                      >
                        Dana Sudah Masuk
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCancelTarget(transaction)
                          setCancelReason('')
                        }}
                        className="rounded-[12px] bg-[#fff1eb] px-3 py-2 text-xs font-bold text-[#ba5a2b]"
                      >
                        Batalkan
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[14px] bg-white px-4 py-5 text-center text-sm font-medium text-[#8b9895]">
                  Belum ada transaksi QRIS atau transfer yang menunggu konfirmasi.
                </div>
              )}
            </div>
          </div>

          <div className={cn('mt-5 flex items-center justify-between border-b border-[#eef1f1] pb-4', mobileSection === 'pending' ? 'hidden md:flex' : 'flex')}>
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Nota Penjualan
              </p>
              <p className="mt-1 text-base font-extrabold text-[#1b1e20]">{getPreviewNomorNota()}</p>
            </div>
            <button
              type="button"
              onClick={() => items.length > 0 && setShowClearConfirm(true)}
              disabled={items.length === 0}
              className="text-xs font-bold uppercase tracking-[0.08em] text-[#d63f2f] disabled:cursor-not-allowed disabled:text-[#c7cfd1]"
            >
              Hapus Semua
            </button>
          </div>

          <div className={cn('custom-scrollbar mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1 md:max-h-[calc(100vh-560px)]', mobileSection === 'pending' ? 'hidden md:block' : 'block')}>
            {items.length > 0 ? (
              items.map((item) => (
                <CartItem
                  key={item.product_id}
                  item={item}
                  onDecrease={() => {
                    try {
                      updateQty(item.product_id, item.qty - 1)
                    } catch (error) {
                      pushToast({
                        title: 'Qty tidak valid',
                        description:
                          error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                        variant: 'warning',
                      })
                    }
                  }}
                  onIncrease={() => {
                    try {
                      updateQty(item.product_id, item.qty + 1)
                    } catch (error) {
                      pushToast({
                        title: 'Qty tidak valid',
                        description:
                          error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                        variant: 'warning',
                      })
                    }
                  }}
                  onSetQty={(qty) => {
                    try {
                      updateQty(item.product_id, qty)
                    } catch (error) {
                      pushToast({
                        title: 'Qty tidak valid',
                        description:
                          error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                        variant: 'warning',
                      })
                    }
                  }}
                  onRemove={() => removeItem(item.product_id)}
                />
              ))
            ) : (
              <div className="flex h-48 flex-col items-center justify-center rounded-[18px] bg-[#f7f9f9] text-center">
                <span className="material-symbols-outlined text-[40px] text-[#c3cbca]">shopping_cart</span>
                <p className="mt-3 text-sm font-bold text-[#1b1e20]">Keranjang masih kosong</p>
                <p className="mt-1 text-xs font-medium text-[#8b9895]">
                  Klik produk di katalog untuk mulai transaksi.
                </p>
              </div>
            )}
          </div>

          <div className={cn('mt-4 rounded-[20px] bg-[#f7f9f9] p-4', mobileSection === 'pending' ? 'hidden md:block' : 'block')}>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[#6d7a77]">Subtotal</span>
                <CurrencyDisplay className="font-bold text-[#1b1e20]" value={subtotal} />
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[#6d7a77]">Diskon</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#8b9895]">%</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={diskon_persen}
                    onChange={(event) => setDiskon(Number(event.target.value))}
                    className="h-8 w-20 rounded-[10px] border-none bg-white px-3 text-right text-sm font-bold outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-[#6d7a77]">
                  <input
                    type="checkbox"
                    checked={use_ppn}
                    onChange={() => togglePPN()}
                    className="h-4 w-4 rounded border-[#c9d1cf] text-[#0a7c72] focus:ring-[#0a7c72]/15"
                  />
                  PPN ({ppn_persen}%)
                </label>
                <CurrencyDisplay className="font-bold text-[#1b1e20]" value={ppn_amount} />
              </div>
            </div>

            <div className="my-4 h-px bg-[#e6ebea]" />

            <div className="flex items-center justify-between">
              <span className="text-[16px] font-extrabold text-[#1b1e20]">Total</span>
              <CurrencyDisplay className="text-[22px] font-extrabold text-[#0a7c72]" value={total} />
            </div>

            <div className="mt-5">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Metode Pembayaran
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {paymentMethods.map((method) => (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => setMetodeBayar(method.value)}
                    className={cn(
                      'flex flex-col items-center justify-center rounded-[14px] px-2 py-3 text-[11px] font-bold transition-colors',
                      metode_bayar === method.value
                        ? 'bg-[#0a7c72] text-white shadow-[0_12px_24px_rgba(10,124,114,0.22)]'
                        : 'bg-white text-[#52627d]',
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px]">{method.icon}</span>
                    <span className="mt-1">{method.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {metode_bayar === 'tunai' ? (
              <div className="mt-5 space-y-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                    Uang Diterima
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={uangInput}
                    onChange={(event) => {
                      const raw = event.target.value.replace(/[^0-9]/g, '')
                      setUangInput(raw ? new Intl.NumberFormat('id-ID').format(parseInt(raw, 10)) : '')
                      setUangDiterima(raw ? parseInt(raw, 10) : 0)
                    }}
                    onFocus={(event) => event.target.select()}
                    placeholder="0"
                    className="mt-2 h-12 w-full rounded-[14px] border-none bg-white px-4 text-right text-lg font-extrabold text-[#1b1e20] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  />
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {quickCashButtons.map((amount, index) => (
                    <button
                      key={`${amount}-${index}`}
                      type="button"
                      onClick={() => {
                        setUangDiterima(amount)
                        setUangInput(new Intl.NumberFormat('id-ID').format(amount))
                      }}
                      className="rounded-[12px] bg-white px-3 py-2 text-xs font-bold text-[#0a7c72]"
                    >
                      {index === 0 ? 'Uang Pas' : new Intl.NumberFormat('id-ID').format(amount)}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-[14px] bg-[#fff5e8] px-4 py-3">
                  <span className="text-sm font-bold text-[#855300]">Kembalian</span>
                  <CurrencyDisplay className="text-xl font-extrabold text-[#855300]" value={kembalian} />
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[14px] bg-white px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#8b9895]">
                  Instruksi Pembayaran
                </p>
                <p className="mt-2 text-sm font-medium text-[#52627d]">
                  {settings.payment_confirmation_note ||
                    'Pastikan dana sudah masuk sebelum struk dicetak.'}
                </p>
                <div className="mt-3 space-y-2 text-sm text-[#1b1e20]">
                  {metode_bayar === 'transfer' ? (
                    <>
                      <p className="font-bold">
                        {settings.payment_transfer_label || 'Transfer Bank'}
                      </p>
                      <p>
                        {settings.payment_transfer_bank || 'Bank belum diatur'} •{' '}
                        {settings.payment_transfer_account_number || 'No. rekening belum diatur'}
                      </p>
                      <p className="text-[#6d7a77]">
                        A/N {settings.payment_transfer_account_name || 'Belum diatur'}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold">{settings.payment_qris_label || 'QRIS Toko'}</p>
                      <p className="text-[#6d7a77]">
                        Setelah customer bayar, kasir harus konfirmasi manual dana masuk.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={isPaymentDisabled || processingPayment}
              onClick={() => void handleProcessPayment()}
              className="mt-5 hidden h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-[#0a7c72] text-base font-extrabold text-white shadow-[0_12px_24px_rgba(10,124,114,0.24)] transition hover:bg-[#086b62] disabled:cursor-not-allowed disabled:opacity-50 md:flex"
            >
              <span>
                {processingPayment
                  ? 'Memproses...'
                  : metode_bayar === 'tunai'
                    ? 'PROSES PEMBAYARAN'
                    : 'SIMPAN MENUNGGU KONFIRMASI'}
              </span>
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </button>
          </div>
        </section>
      </div>

      {mobileSection !== 'pending' ? (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-40 px-3 md:hidden">
          <div className="mx-auto max-w-[560px] rounded-[26px] border border-white/90 bg-white/96 p-3 shadow-[0_18px_40px_rgba(15,23,42,0.14)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  {items.length > 0 ? `${items.length} item di keranjang` : 'Belum ada item'}
                </p>
                <CurrencyDisplay
                  className="mt-1 text-[22px] font-extrabold tracking-[-0.03em] text-[#0a7c72]"
                  value={total}
                />
                <p className="mt-1 text-xs font-medium text-[#8b9895]">
                  {metode_bayar === 'tunai'
                    ? 'Siap diproses begitu pembayaran diterima.'
                    : 'Simpan dulu, lalu konfirmasi dana masuk sebelum cetak struk.'}
                </p>
              </div>

              <button
                type="button"
                disabled={isPaymentDisabled || processingPayment || items.length === 0}
                onClick={() => {
                  if (mobileSection !== 'keranjang') {
                    setMobileSection('keranjang')
                    return
                  }

                  void handleProcessPayment()
                }}
                className="flex min-h-[62px] min-w-[140px] flex-col items-center justify-center rounded-[20px] bg-[#0a7c72] px-4 text-center text-white shadow-[0_12px_24px_rgba(10,124,114,0.22)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-[13px] font-extrabold uppercase tracking-[0.08em]">
                  {mobileSection === 'keranjang'
                    ? processingPayment
                      ? 'Memproses'
                      : metode_bayar === 'tunai'
                        ? 'Bayar'
                        : 'Simpan'
                    : 'Lihat Keranjang'}
                </span>
                <span className="mt-1 text-[11px] font-medium text-white/80">
                  {mobileSection === 'keranjang'
                    ? metode_bayar === 'tunai'
                      ? 'Proses pembayaran'
                      : 'Menunggu konfirmasi'
                    : 'Review & checkout'}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ReceiptModal
        open={receiptOpen}
        cashier={user}
        items={receiptItems}
        onClose={() => setReceiptOpen(false)}
        onNewTransaction={handleNewTransaction}
        settings={settings}
        transaction={receiptTransaction}
      />

      <Modal
        open={confirmModalOpen}
        onClose={() => {
          setConfirmModalOpen(false)
          setConfirmTarget(null)
          setPaymentReference('')
        }}
        title={`Konfirmasi ${confirmTarget?.nomor_nota ?? ''}`}
        description="Dana harus sudah benar-benar masuk sebelum transaksi diselesaikan dan struk dicetak."
        size="sm"
      >
        <div className="space-y-4">
          <div className="rounded-[16px] bg-[#f7f9f9] p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#6d7a77]">Metode</span>
              <span className="font-bold uppercase text-[#1b1e20]">
                {confirmTarget?.metode_bayar ?? '-'}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[#6d7a77]">Total</span>
              <CurrencyDisplay
                className="font-extrabold text-[#0a7c72]"
                value={Number(confirmTarget?.total ?? 0)}
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Referensi Pembayaran
            </label>
            <input
              type="text"
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
              placeholder="Contoh: mutasi bank / ID QRIS"
              className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleConfirmPending()}
            disabled={confirmingPayment}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-[#0a7c72] font-bold text-white disabled:opacity-60"
          >
            {confirmingPayment ? 'Mengonfirmasi...' : 'Dana Sudah Masuk'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        open={showClearConfirm}
        title="Hapus Semua Item?"
        description="Semua item di keranjang akan dihapus. Tindakan ini tidak bisa dibatalkan."
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        onConfirm={() => {
          clearCart()
          setUangInput('')
          setShowClearConfirm(false)
        }}
        onCancel={() => setShowClearConfirm(false)}
      />

      <Modal
        open={Boolean(unitPickerProduct)}
        onClose={() => setUnitPickerProduct(null)}
        title={`Pilih Satuan — ${unitPickerProduct?.nama ?? ''}`}
        description="Pilih satuan yang ingin ditambahkan ke keranjang."
        size="sm"
      >
        {unitPickerProduct && (
          <div className="space-y-2">
            <button
              type="button"
              disabled={Number(unitPickerProduct.stok ?? 0) <= 0}
              onClick={() => handleSelectUnit(unitPickerProduct)}
              className="flex w-full items-center justify-between rounded-[14px] bg-[#f7f9f9] px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#e7f8f6]"
            >
              <div>
                <span className="font-extrabold text-[#1b1e20]">{unitPickerProduct.satuan}</span>
                <span className="ml-2 text-xs text-[#8b9895]">Stok: {unitPickerProduct.stok ?? 0}</span>
              </div>
              <span className="font-extrabold text-[#0a7c72]">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(unitPickerProduct.harga_jual ?? 0))}
              </span>
            </button>
            {(variantsMap[unitPickerProduct.id ?? 0] ?? []).map((variant) => (
              <button
                key={variant.id}
                type="button"
                disabled={Number(variant.stok ?? 0) <= 0}
                onClick={() => handleSelectUnit(variant)}
                className="flex w-full items-center justify-between rounded-[14px] bg-[#f7f9f9] px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#e7f8f6]"
              >
                <div>
                  <span className="font-extrabold text-[#1b1e20]">{variant.satuan}</span>
                  <span className="ml-2 text-xs text-[#8b9895]">Stok: {variant.stok ?? 0}</span>
                </div>
                <span className="font-extrabold text-[#0a7c72]">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(variant.harga_jual ?? 0))}
                </span>
              </button>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => {
          setCancelTarget(null)
          setCancelReason('')
        }}
        title="Batalkan Transaksi Pending?"
        description="Stok produk akan dikembalikan dan alasan pembatalan akan tersimpan di catatan transaksi."
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Alasan Pembatalan
            </label>
            <textarea
              rows={3}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Contoh: customer salah nominal / scan produk dobel / transfer tidak jadi"
              className="mt-2 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleCancelPending()}
            disabled={cancelingPayment}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-[#ba5a2b] font-bold text-white disabled:opacity-60"
          >
            {cancelingPayment ? 'Membatalkan...' : 'Simpan Alasan dan Batalkan'}
          </button>
        </div>
      </Modal>
    </main>
  )
}
