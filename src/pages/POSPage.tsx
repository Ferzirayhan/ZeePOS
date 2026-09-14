import { format } from 'date-fns'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelPendingTransaction,
  confirmTransactionPayment,
  commitTransaction,
  getPendingTransactions,
} from '../api/transactions'
import {
  closeCashShift,
  getActiveCashShift,
  openCashShift,
} from '../api/cashShift'
import type { CashShift } from '../api/cashShift'
import {
  getActiveCategories,
  getAllProductDiscountTiersMap,
  getAllProductVariantsMap,
  getProductByBarcode,
  getProducts,
} from '../api/products'
import type { DiscountTierRow } from '../api/products'
import { getSettings } from '../api/settings'
import { getAllProductUnitsMap, getProductUnitByBarcode } from '../api/units'
import { getUnitChoices, findUnitChoice } from '../lib/units'
import type { ProductUnit } from '../types/database'
import { CartItem } from '../components/pos/CartItem'
import { ProductCard } from '../components/pos/ProductCard'
import { ReceiptModal } from '../components/pos/ReceiptModal'
import { PaymentModal } from '../components/pos/PaymentModal'
import { CustomerSelect } from '../components/pos/CustomerSelect'
import { BarcodeScannerModal } from '../components/pos/BarcodeScannerModal'
import { HeldTransactionsModal } from '../components/pos/HeldTransactionsModal'
import { NumpadModal } from '../components/pos/NumpadModal'
import { useHeldCartStore, type HeldCart } from '../stores/heldCartStore'
import { cacheCatalogProducts, getCachedCatalogProducts } from '../utils/offlineDb'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { buildReceiptBytes, printToThermal } from '../utils/escpos'
import { audioFeedback } from '../utils/audioFeedback'
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
  Customer,
  ProductWithCategory,
  Transaction,
  TransactionItem,
  TransactionWithKasir,
} from '../types/database'
import { cn } from '../utils/cn'

function getPreviewNomorNota() {
  return `NOTA-${format(new Date(), 'yyyyMMdd')}-...`
}

export function POSPage() {
  const user = useAuthStore((state) => state.user)
  const tenantId = useAuthStore((state) => state.tenant?.id) ?? user?.tenant_id ?? ''
  const isOnline = useOnlineStatus()
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const pushToast = useToastStore((state) => state.pushToast)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const processingPaymentRef = useRef(false)

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
    setPpnPersen,
    setMetodeBayar,
    setUangDiterima,
    restoreCart,
  } = useCartStore()

  // Held Carts Store
  const heldCarts = useHeldCartStore((state) => state.heldCarts)
  const holdCurrentCart = useHeldCartStore((state) => state.holdCurrentCart)
  const resumeHeldCart = useHeldCartStore((state) => state.resumeHeldCart)
  const setHeldCartTenant = useHeldCartStore((state) => state.setActiveTenant)

  useEffect(() => {
    setHeldCartTenant(tenantId || null)
  }, [setHeldCartTenant, tenantId])

  const [products, setProducts] = useState<ProductWithCategory[]>([])
  const [filteredProducts, setFilteredProducts] = useState<ProductWithCategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [tiersMap, setTiersMap] = useState<Record<number, DiscountTierRow[]>>({})
  const [variantsMap, setVariantsMap] = useState<Record<number, ProductWithCategory[]>>({})
  const [unitsMap, setUnitsMap] = useState<Record<number, ProductUnit[]>>({})
  const [unitPickerProduct, setUnitPickerProduct] = useState<ProductWithCategory | null>(null)
  const [pendingTransactions, setPendingTransactions] = useState<TransactionWithKasir[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [cancelingPayment, setCancelingPayment] = useState(false)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptTransaction, setReceiptTransaction] = useState<Transaction | null>(null)
  const [receiptItems, setReceiptItems] = useState<TransactionItem[]>([])
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const checkoutIdempotencyKeyRef = useRef<string | null>(null)
  const lastCheckoutFingerprintRef = useRef<string | null>(null)
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [isHeldModalOpen, setIsHeldModalOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [numpadItem, setNumpadItem] = useState<{ productId: number; unitId?: number; nama: string; currentQty: number } | null>(null)
  const [printingThermal, setPrintingThermal] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<TransactionWithKasir | null>(null)
  const [cancelTarget, setCancelTarget] = useState<TransactionWithKasir | null>(null)
  const [paymentReference, setPaymentReference] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [mobileSection, setMobileSection] = useState<'produk' | 'keranjang' | 'pending'>('produk')

  // Shift Kasir State
  const [activeShift, setActiveShift] = useState<CashShift | null>(null)
  const [isOpenShiftModal, setIsOpenShiftModal] = useState(false)
  const [isCloseShiftModal, setIsCloseShiftModal] = useState(false)
  const [shiftModalAwal, setShiftModalAwal] = useState('')
  const [shiftUangFisik, setShiftUangFisik] = useState('')
  const [shiftPengeluaran, setShiftPengeluaran] = useState('')
  const [shiftCatatan, setShiftCatatan] = useState('')
  const [shiftSubmitting, setShiftSubmitting] = useState(false)

  const loadActiveShift = useCallback(async () => {
    try {
      const shift = await getActiveCashShift()
      setActiveShift(shift)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadActiveShift()
  }, [loadActiveShift])

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

  const handleOpenShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const nominal = Number(shiftModalAwal.replace(/\D/g, ''))
    try {
      setShiftSubmitting(true)
      const shift = await openCashShift(nominal, shiftCatatan)
      setActiveShift(shift)
      setIsOpenShiftModal(false)
      setShiftModalAwal('')
      setShiftCatatan('')
      pushToast({
        title: 'Shift Kasir Dibuka',
        description: `Modal awal Rp ${nominal.toLocaleString('id-ID')} tersimpan.`,
        variant: 'success',
      })
    } catch (err) {
      pushToast({
        title: 'Gagal Membuka Shift',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setShiftSubmitting(false)
    }
  }

  const handleCloseShiftSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeShift) return
    const fisik = Number(shiftUangFisik.replace(/\D/g, ''))
    const keluar = Number(shiftPengeluaran.replace(/\D/g, '')) || 0
    try {
      setShiftSubmitting(true)
      const closed = await closeCashShift(activeShift.id, fisik, keluar, shiftCatatan)
      setActiveShift(null)
      setIsCloseShiftModal(false)
      setShiftUangFisik('')
      setShiftPengeluaran('')
      setShiftCatatan('')
      pushToast({
        title: 'Shift Kasir Ditutup',
        description: `Closing shift selesai. Selisih kas: Rp ${(closed.selisih ?? 0).toLocaleString('id-ID')}`,
        variant: (closed.selisih ?? 0) === 0 ? 'success' : 'warning',
      })
    } catch (err) {
      pushToast({
        title: 'Gagal Menutup Shift',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setShiftSubmitting(false)
    }
  }

  const loadCatalogData = useCallback(async () => {
    setLoading(true)

    try {
      const [productsResult, categoriesResult, settingsResult, tiersResult, variantsResult, unitsResult] = await Promise.all([
        getProducts({ isActive: true }),
        getActiveCategories(),
        getSettings(),
        getAllProductDiscountTiersMap(),
        getAllProductVariantsMap(),
        getAllProductUnitsMap(),
      ])

      setProducts(productsResult)
      setCategories(categoriesResult)
      setSettings(settingsResult)
      setTiersMap(tiersResult)
      setVariantsMap(variantsResult)
      setUnitsMap(unitsResult)
      setPpnPersen(Number(settingsResult.ppn_persen ?? 0))

      // Simpan ke offline cache IndexedDB (per-tenant)
      void cacheCatalogProducts(productsResult as unknown as Array<{ id: number | null; [key: string]: unknown }>, tenantId)
    } catch (error) {
      // Coba ambil dari offline cache jika jaringan bermasalah
      const cached = await getCachedCatalogProducts<ProductWithCategory>(tenantId)
      if (cached && cached.length > 0) {
        setProducts(cached)
        pushToast({
          title: 'Mode Offline Aktif',
          description: 'Menggunakan katalog produk yang tersimpan di memori perangkat.',
          variant: 'warning',
        })
      } else {
        pushToast({
          title: 'Gagal memuat POS',
          description:
            error instanceof Error ? error.message : 'Data POS belum berhasil dimuat.',
          variant: 'error',
        })
      }
    } finally {
      setLoading(false)
    }
  }, [pushToast, setPpnPersen, tenantId])

  const loadPendingData = useCallback(async () => {
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

  const handleAddProduct = (product: ProductWithCategory) => {
    const pid = product.id ?? 0
    const variants = variantsMap[pid]
    const units = unitsMap[pid] ?? []
    if ((units && units.length > 0) || (variants && variants.length > 0)) {
      setUnitPickerProduct(product)
      return
    }
    try {
      addItem(product, tiersMap[pid] ?? [])
      audioFeedback.playScanBeep()
      setMobileSection('keranjang')
    } catch (error) {
      audioFeedback.playWarningTone()
      pushToast({
        title: 'Tidak bisa menambah produk',
        description: error instanceof Error ? error.message : 'Qty produk melebihi stok.',
        variant: 'warning',
      })
    }
  }

  const handleSelectUnit = (product: ProductWithCategory, unit?: ProductUnit | null) => {
    setUnitPickerProduct(null)
    try {
      addItem(product, tiersMap[product.id ?? 0] ?? [], unit ?? null)
      audioFeedback.playScanBeep()
      setMobileSection('keranjang')
    } catch (error) {
      audioFeedback.playWarningTone()
      pushToast({
        title: 'Tidak bisa menambah produk',
        description: error instanceof Error ? error.message : 'Qty produk melebihi stok.',
        variant: 'warning',
      })
    }
  }

  const handleBarcodeSearch = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return

    try {
      const foundProduct = await getProductByBarcode(trimmed)

      if (foundProduct) {
        handleAddProduct(foundProduct)
        setSearchQuery('')
        pushToast({
          title: 'Produk ditambahkan',
          description: foundProduct.nama ?? 'Produk berhasil masuk keranjang.',
          variant: 'success',
        })
        return
      }

      const matchedUnit = await getProductUnitByBarcode(trimmed)
      if (matchedUnit) {
        const unitProduct = products.find(
          (p) => (p.id ?? 0) === matchedUnit.product_id,
        )
        if (unitProduct && Number(unitProduct.stok ?? 0) > 0) {
          const pid = unitProduct.id ?? 0
          const choices = getUnitChoices(unitProduct, unitsMap[pid] ?? [matchedUnit])
          if (findUnitChoice(choices, trimmed)) {
            try {
              addItem(unitProduct, tiersMap[pid] ?? [], matchedUnit)
              audioFeedback.playScanBeep()
              setMobileSection('keranjang')
              setSearchQuery('')
              pushToast({
                title: 'Produk ditambahkan',
                description: `${unitProduct.nama ?? 'Produk'} (${matchedUnit.nama_satuan}) masuk keranjang.`,
                variant: 'success',
              })
              return
            } catch (error) {
              audioFeedback.playWarningTone()
              pushToast({
                title: 'Tidak bisa menambah produk',
                description: error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                variant: 'warning',
              })
              setSearchQuery('')
              return
            }
          }
        }
      }

      const lower = trimmed.toLowerCase()
      const exactSkuMatch = products.find(
        (p) => p.sku?.toLowerCase() === lower && Number(p.stok ?? 0) > 0,
      )
      if (exactSkuMatch) {
        handleAddProduct(exactSkuMatch)
        setSearchQuery('')
        pushToast({
          title: 'Produk ditambahkan',
          description: exactSkuMatch.nama ?? 'Produk berhasil masuk keranjang.',
          variant: 'success',
        })
        return
      }

      if (filteredProducts.length === 1 && Number(filteredProducts[0].stok ?? 0) > 0) {
        handleAddProduct(filteredProducts[0])
        setSearchQuery('')
        pushToast({
          title: 'Produk ditambahkan',
          description: filteredProducts[0].nama ?? 'Produk berhasil masuk keranjang.',
          variant: 'success',
        })
        return
      }

      pushToast({
        title: 'Barcode / SKU tidak ditemukan',
        description: `Produk dengan pencarian "${trimmed}" tidak ditemukan atau stok kosong.`,
        variant: 'warning',
      })
      setSearchQuery('')
    } catch (error) {
      pushToast({
        title: 'Pencarian gagal',
        description: error instanceof Error ? error.message : 'Produk barcode tidak tersedia.',
        variant: 'warning',
      })
      setSearchQuery('')
    }
  }

  const handleHoldCurrentCart = () => {
    if (items.length === 0) {
      pushToast({
        title: 'Pesanan Masih Kosong',
        description: 'Tambahkan produk ke keranjang terlebih dahulu sebelum menahan pesanan.',
        variant: 'warning',
      })
      return
    }

    const defaultLabel = `Pesanan #${heldCarts.length + 1}`
    holdCurrentCart({
      label: defaultLabel,
      items,
      diskon_persen,
      use_ppn,
      ppn_persen,
      metode_bayar,
      total,
      customer_id: selectedCustomer?.id ?? null,
      customer_nama: selectedCustomer?.nama ?? null,
    })

    clearCart()
    setSelectedCustomer(null)
    pushToast({
      title: 'Pesanan Ditahan (F2)',
      description: `${items.length} item berhasil diparkir. Keranjang siap untuk pelanggan baru.`,
      variant: 'success',
    })
  }

  const handleResumeHeldCart = async (held: HeldCart) => {
    if (items.length > 0) {
      pushToast({
        title: 'Keranjang Sedang Berisi Item',
        description: 'Selesaikan atau tahan transaksi yang sedang aktif sebelum memuat pesanan lain.',
        variant: 'warning',
      })
      return
    }

    // Ambil sekaligus hapus dari daftar antrean parkir (klaim atomik lintas tab)
    const resumed = await resumeHeldCart(held.id)

    if (!resumed) {
      pushToast({
        title: 'Pesanan Tidak Tersedia',
        description: 'Pesanan parkir mungkin sudah dilanjutkan di tab lain atau telah dihapus.',
        variant: 'warning',
      })
      return
    }

    restoreCart({
      items: resumed.items,
      diskon_persen: resumed.diskon_persen,
      use_ppn: resumed.use_ppn,
      ppn_persen: resumed.ppn_persen,
      metode_bayar: resumed.metode_bayar,
    })

    if (resumed.customer_id) {
      setSelectedCustomer({
        id: resumed.customer_id,
        tenant_id: '',
        nama: resumed.customer_nama ?? 'Pelanggan',
        telepon: null,
        alamat: null,
        total_hutang: 0,
        catatan: null,
        is_active: true,
      })
    } else {
      setSelectedCustomer(null)
    }

    pushToast({
      title: 'Pesanan Dilanjutkan',
      description: `${resumed.label} berhasil dimuat kembali ke tiket kasir.`,
      variant: 'success',
    })
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }

  const handleThermalPrint = async () => {
    if (!receiptTransaction) return
    try {
      setPrintingThermal(true)
      const receiptData = {
        store_name: settings.nama_toko || 'ZEEPOS STORE',
        store_address: settings.alamat || '',
        store_phone: settings.no_telp || '',
        invoice: receiptTransaction.nomor_nota,
        created_at: format(new Date(receiptTransaction.created_at || Date.now()), 'dd/MM/yyyy HH:mm'),
        cashier: user?.nama || 'Kasir',
        items: receiptItems.map((item) => ({
          name: item.nama_produk,
          qty: item.qty,
          price: Number(item.subtotal || 0),
        })),
        subtotal: Number(receiptTransaction.subtotal || 0),
        discount_total: Number(receiptTransaction.diskon_amount || 0),
        ppn_total: Number(receiptTransaction.ppn_amount || 0),
        grand_total: Number(receiptTransaction.total || 0),
        payment_method_label: receiptTransaction.metode_bayar?.toUpperCase(),
        cash_received: receiptTransaction.uang_diterima ? Number(receiptTransaction.uang_diterima) : undefined,
        change: receiptTransaction.kembalian ? Number(receiptTransaction.kembalian) : undefined,
        footer: 'Terima kasih atas kunjungan Anda!',
      }

      const bytes = buildReceiptBytes(receiptData, '58mm')
      await printToThermal(bytes)

      pushToast({
        title: 'Cetak Berhasil',
        description: 'Struk berhasil dicetak langsung ke printer thermal USB.',
        variant: 'success',
      })
    } catch (err) {
      pushToast({
        title: 'Gagal Cetak Thermal',
        description: err instanceof Error ? err.message : 'Pastikan kabel printer thermal USB terhubung.',
        variant: 'error',
      })
    } finally {
      setPrintingThermal(false)
    }
  }

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Jangan trigger jika sedang ngetik di input/textarea
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      if (e.key === '/' && !isInput) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if (e.key === 'F2') {
        e.preventDefault()
        handleHoldCurrentCart()
      } else if (e.key === 'F4') {
        e.preventDefault()
        if (items.length > 0) {
          setIsPaymentModalOpen(true)
        }
      } else if (e.key === 'F8') {
        e.preventDefault()
        setIsScannerOpen(true)
      } else if (e.key === 'F9') {
        e.preventDefault()
        setIsHeldModalOpen(true)
      }
    }

    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  })

  const handleProcessPayment = async () => {
    if (items.length === 0 || processingPaymentRef.current) {
      return
    }

    if (!isOnline) {
      pushToast({
        title: 'Checkout dinonaktifkan',
        description: 'Transaksi tidak dapat diproses saat offline. Katalog tersedia untuk referensi saja.',
        variant: 'warning',
      })
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

    // Guard shift: checkout tunai wajib lewat shift kasir aktif (server juga memvalidasi).
    if (metode_bayar === 'tunai' && !activeShift) {
      pushToast({
        title: 'Shift kasir belum dibuka',
        description: 'Buka shift terlebih dahulu sebelum melakukan transaksi tunai.',
        variant: 'warning',
      })
      setIsOpenShiftModal(true)
      return
    }

    processingPaymentRef.current = true
    setProcessingPayment(true)

    // Buat fingerprint payload untuk rotasi key otomatis jika payload berubah
    const currentFingerprint = JSON.stringify({
      items: items.map((i) => `${i.product_id}:${i.unit_id ?? 'b'}:${i.qty}:${i.harga_satuan}`),
      subtotal,
      diskon_persen,
      diskon_amount,
      total,
      metode_bayar,
      uang_diterima: metode_bayar === 'tunai' ? uang_diterima : null,
      customer_id: selectedCustomer?.id ?? null,
    })

    if (!checkoutIdempotencyKeyRef.current || lastCheckoutFingerprintRef.current !== currentFingerprint) {
      const nonce = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
      checkoutIdempotencyKeyRef.current = `zeepos-${nonce}`
      lastCheckoutFingerprintRef.current = currentFingerprint
    }
    const idempotencyKey = checkoutIdempotencyKeyRef.current

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

      const committed = await commitTransaction({
        items: items.map((item) => ({
          productId: item.product_id,
          namaProduk: item.nama_produk,
          hargaSatuan: item.harga_satuan,
          qty: item.qty,
          subtotal: item.subtotal,
          diskonItemPersen: item.diskon_item_persen,
          satuan: item.satuan,
          rasio: item.rasio,
          unitId: item.unit_id,
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
        customerId: selectedCustomer?.id ?? null,
        idempotencyKey,
      })

      // 1. Transaksi telah berhasil di-commit di database
      setIsPaymentModalOpen(false)
      audioFeedback.playSuccessChime()

      const receiptTx: Transaction = committed.transaction ?? {
        id: committed.transaction_id,
        nomor_nota: committed.nomor_nota,
        kasir_id: committed.kasir_id ?? user?.id ?? null,
        subtotal: committed.subtotal,
        diskon_persen: committed.diskon_persen ?? diskon_persen,
        diskon_amount: committed.diskon_amount,
        ppn_persen: committed.ppn_persen ?? ppn_persen,
        ppn_amount: committed.ppn_amount,
        total: committed.total,
        metode_bayar: (committed.metode_bayar as Transaction['metode_bayar']) ?? metode_bayar,
        uang_diterima: committed.uang_diterima !== undefined ? committed.uang_diterima : (metode_bayar === 'tunai' ? uang_diterima : null),
        kembalian: committed.kembalian,
        catatan: committed.catatan ?? null,
        status: (committed.status as Transaction['status']) ?? 'selesai',
        payment_status: committed.payment_status,
        paid_at: committed.paid_at ?? new Date().toISOString(),
        payment_reference: null,
        confirmed_by: null,
        idempotency_key: idempotencyKey,
        created_at: committed.created_at ?? new Date().toISOString(),
      }

      const receiptItms: TransactionItem[] =
        committed.items && committed.items.length > 0
          ? committed.items
          : items.map((item, idx) => ({
              id: idx + 1,
              transaction_id: committed.transaction_id,
              product_id: item.product_id,
              nama_produk: item.nama_produk,
              harga_satuan: item.harga_satuan,
              harga_beli: 0,
              qty: item.qty,
              subtotal: item.subtotal,
              laba_kotor: null,
              diskon_item_persen: item.diskon_item_persen ?? 0,
              rasio: item.rasio ?? 1,
              base_qty: item.qty * (item.rasio ?? 1),
              nama_satuan: item.satuan ?? 'pcs',
            }))

      if (committed.payment_status === 'dibayar') {
        setReceiptTransaction(receiptTx)
        setReceiptItems(receiptItms)
        setReceiptOpen(true)
        pushToast({
          title: 'Pembayaran berhasil',
          description: `Transaksi ${committed.nomor_nota} tersimpan.`,
          variant: 'success',
        })
      } else {
        setMobileSection('pending')
        pushToast({
          title: 'Transaksi disimpan',
          description: `Transaksi ${committed.nomor_nota} menunggu konfirmasi dana masuk.`,
          variant: 'info',
        })
      }

      clearCart()
      checkoutIdempotencyKeyRef.current = null
      lastCheckoutFingerprintRef.current = null
      setSelectedCustomer(null)
      setSearchQuery('')
      setPpnPersen(Number(settings.ppn_persen ?? 0))
      searchInputRef.current?.focus()

      // 2. Refresh katalog dan antrean secara background (best-effort, tidak membatalkan status sukses)
      Promise.all([loadCatalogData(), loadPendingData()]).catch(() => {
        pushToast({
          title: 'Pembaruan latar belakang tertunda',
          description: 'Transaksi tersimpan, namun pembaruan katalog tertunda. Data akan sinkron otomatis.',
          variant: 'info',
        })
      })
    } catch (error) {
      pushToast({
        title: 'Transaksi gagal',
        description:
          error instanceof Error ? error.message : 'Sistem belum berhasil memproses pembayaran.',
        variant: 'error',
      })
    } finally {
      processingPaymentRef.current = false
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
    setSelectedCustomer(null)
    setPpnPersen(Number(settings.ppn_persen ?? 0))
    setReceiptOpen(false)
    setReceiptTransaction(null)
    setReceiptItems([])
    setSearchQuery('')
    searchInputRef.current?.focus()
  }

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pb-28 pt-16 transition-[margin] duration-200 md:pb-0 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="grid min-h-screen grid-cols-1 xl:grid-cols-[minmax(0,1fr)_390px] 2xl:grid-cols-[minmax(0,1fr)_430px]">
        {/* Mobile Header Navigation */}
        <div className="border-b border-slate-200 bg-white px-4 pb-3 pt-4 xl:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg font-black tracking-tight text-[#1f2937]">POS Kasir</p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-xs font-medium text-slate-500">{user?.nama ?? 'Kasir aktif'}</p>
                {activeShift ? (
                  <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-bold text-[#16a34a]">
                    Shift Aktif
                  </span>
                ) : (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-[#dc2626]">
                    Shift Tutup
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeShift ? (
                <button
                  type="button"
                  onClick={() => setIsCloseShiftModal(true)}
                  className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-[#dc2626] transition hover:bg-rose-50"
                >
                  Closing Shift
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModal(true)}
                  className="rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#1d4ed8]"
                >
                  Buka Shift
                </button>
              )}
              <div className="rounded-2xl bg-[#eff6ff] px-3 py-2 text-right">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Total</p>
                <CurrencyDisplay className="text-sm font-black text-[#2563eb]" value={total} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
            {[
              ['produk', `Katalog`],
              ['keranjang', `Pesanan`],
              ['pending', `Pending`],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMobileSection(value as typeof mobileSection)}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-xs font-extrabold transition-all',
                  mobileSection === value
                    ? 'bg-white text-[#2563eb] shadow-sm'
                    : 'text-slate-600',
                )}
              >
                {label}
                <span className="mt-0.5 block text-[10px] font-bold opacity-70">
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

        {!isOnline && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
            <span className="material-symbols-outlined text-amber-600 text-xl">wifi_off</span>
            <div className="text-sm">
              <span className="font-bold text-amber-800">Mode Offline Aktif.</span>{' '}
              <span className="text-amber-700">Katalog tersedia untuk referensi. Checkout dinonaktifkan sampai koneksi pulih.</span>
            </div>
          </div>
        )}

        {/* Kolom Kiri: Katalog Kasir Luas & Horizontal Category Tabs Moka POS */}
        <section
          className={cn(
            'flex flex-col min-w-0 px-4 py-6 sm:px-6 xl:px-8',
            mobileSection === 'produk' ? 'block' : 'hidden xl:flex',
          )}
        >
          {/* Top Bar: Search + Shift Control */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 flex-1 max-w-xl">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
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
                      if (trimmed) {
                        void handleBarcodeSearch(trimmed)
                      }
                    }
                  }}
                  placeholder="Cari produk / barcode (/)"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-10 text-sm font-medium text-[#1f2937] outline-none shadow-sm transition focus:border-[#2563eb] focus:ring-4 focus:ring-blue-500/10"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                )}
              </div>

              {/* Tombol Kamera Barcode Scanner (F8) */}
              <button
                type="button"
                onClick={() => setIsScannerOpen(true)}
                title="Buka Kamera Barcode Scanner (F8)"
                className="h-12 w-12 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:text-[#2563eb] hover:border-[#2563eb] hover:bg-blue-50/50 shadow-sm transition"
              >
                <span className="material-symbols-outlined text-xl">qr_code_scanner</span>
              </button>

              {/* Tombol Parkir / Held Carts List (F9) */}
              <button
                type="button"
                onClick={() => setIsHeldModalOpen(true)}
                title="Daftar Transaksi Ditahan / Parkir (F9)"
                className={cn(
                  'h-12 px-3.5 rounded-2xl border flex items-center gap-1.5 shadow-sm transition text-xs font-bold',
                  heldCarts.length > 0
                    ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                <span className="material-symbols-outlined text-lg">pause_circle</span>
                <span>{heldCarts.length > 0 ? `${heldCarts.length} Parkir` : 'Parkir'}</span>
              </button>

              {/* Tombol Fullscreen */}
              <button
                type="button"
                onClick={toggleFullscreen}
                title="Layar Penuh"
                className="h-12 w-12 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:text-[#2563eb] hover:bg-slate-50 shadow-sm transition hidden md:flex"
              >
                <span className="material-symbols-outlined text-xl">
                  {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
                </span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-3">
              {pendingTransactions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMobileSection('pending')}
                  className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-black text-amber-800 transition hover:bg-amber-100"
                >
                  <span className="material-symbols-outlined text-base text-amber-600">hourglass_top</span>
                  <span>{pendingTransactions.length} Pending</span>
                </button>
              )}

              {activeShift ? (
                <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#16a34a] animate-pulse" />
                    <span className="text-xs font-bold text-slate-700">Shift Aktif</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCloseShiftModal(true)}
                    className="ml-2 rounded-xl bg-slate-100 px-2.5 py-1 text-[11px] font-extrabold text-[#dc2626] transition hover:bg-rose-50"
                  >
                    Closing
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModal(true)}
                  className="flex items-center gap-1.5 rounded-2xl bg-[#2563eb] px-4 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-[#1d4ed8]"
                >
                  <span className="material-symbols-outlined text-base">payments</span>
                  <span>Buka Shift</span>
                </button>
              )}
            </div>
          </div>

          {/* Horizontal Category Pill Tabs ala Moka POS */}
          <div className="mt-5 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            <button
              type="button"
              onClick={() => setSelectedCategoryId('all')}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-xs font-black transition-all shrink-0',
                selectedCategoryId === 'all'
                  ? 'bg-[#2563eb] text-white shadow-md shadow-blue-500/20 scale-[1.02]'
                  : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50',
              )}
            >
              <span>Semua</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-extrabold',
                  selectedCategoryId === 'all'
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-500',
                )}
              >
                {allCategoryCount}
              </span>
            </button>

            {categories.map((category) => {
              const count = products.filter(
                (product) =>
                  product.category_id === category.id && Number(product.stok ?? 0) > 0,
              ).length;

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(category.id)}
                  className={cn(
                    'flex items-center gap-2 whitespace-nowrap rounded-2xl px-4 py-2.5 text-xs font-black transition-all shrink-0',
                    selectedCategoryId === category.id
                      ? 'bg-[#2563eb] text-white shadow-md shadow-blue-500/20 scale-[1.02]'
                      : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50',
                  )}
                >
                  <span>{category.nama}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-extrabold',
                      selectedCategoryId === category.id
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Grid Produk Responsif & Lapang */}
          <div className="mt-4 flex-1">
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5">
                {Array.from({ length: 10 }).map((_, index) => (
                  <Skeleton key={index} className="h-44 rounded-2xl" />
                ))}
              </div>
            ) : filteredProducts.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5">
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
              <div className="flex h-72 flex-col items-center justify-center rounded-3xl border border-slate-200/80 bg-white text-center shadow-sm">
                <span className="material-symbols-outlined text-5xl text-slate-300">search_off</span>
                <p className="mt-3 font-display text-base font-black text-[#1f2937]">Produk tidak ditemukan</p>
                <p className="mt-1 text-xs text-slate-400">
                  Ubah kata kunci pencarian atau pilih kategori lain.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Kolom Kanan: Order / Bill Moka POS */}
        <section
          className={cn(
            'flex flex-col border-t border-slate-200 bg-white xl:border-l xl:border-t-0 xl:sticky xl:top-0 xl:h-screen',
            mobileSection === 'produk' ? 'hidden xl:flex' : 'flex',
          )}
        >
          {/* Header Order Tiket */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Tiket Pesanan
              </span>
              <p className="font-display text-base font-black text-[#1f2937]">
                {getPreviewNomorNota()}
              </p>
            </div>
            {items.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleHoldCurrentCart}
                  title="Tahan Pesanan Ini (F2)"
                  className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 transition"
                >
                  <span className="material-symbols-outlined text-sm">pause</span>
                  <span>Tahan (F2)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowClearConfirm(true)}
                  className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-bold text-[#dc2626] hover:bg-rose-50 transition"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  <span>Reset</span>
                </button>
              </div>
            )}
          </div>

          {/* Selector Pelanggan Cepat */}
          <div className="border-b border-slate-100 bg-[#f8f9fa] px-6 py-3">
            <CustomerSelect
              selectedCustomer={selectedCustomer}
              onSelectCustomer={setSelectedCustomer}
            />
          </div>

          {/* Pending Section jika kasir membuka tab pending */}
          {mobileSection === 'pending' && (
            <div className="border-b border-slate-200 bg-amber-50/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-black text-amber-900 uppercase tracking-wider">
                  Transaksi Menunggu Pembayaran
                </span>
                <span className="rounded-full bg-amber-200/80 px-2 py-0.5 text-[10px] font-extrabold text-amber-900">
                  {pendingTransactions.length}
                </span>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {pendingTransactions.map((tx) => (
                  <div key={tx.id} className="rounded-xl bg-white p-3 border border-amber-200 shadow-sm text-xs">
                    <div className="flex justify-between font-bold text-slate-800">
                      <span>{tx.nomor_nota}</span>
                      <span className="text-[#2563eb]">Rp {Number(tx.total ?? 0).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmTarget(tx);
                          setPaymentReference(tx.payment_reference ?? '');
                          setConfirmModalOpen(true);
                        }}
                        className="flex-1 py-1.5 rounded-lg bg-[#2563eb] text-white font-bold"
                      >
                        Konfirmasi Masuk
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCancelTarget(tx);
                          setCancelReason('');
                        }}
                        className="py-1.5 px-3 rounded-lg bg-slate-100 text-rose-600 font-bold"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daftar Cart Items */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
            {items.length > 0 ? (
              items.map((item) => (
                  <CartItem
                    key={item.unit_id ? `${item.product_id}-${item.unit_id}` : String(item.product_id)}
                    item={item}
                    onDecrease={() => {
                      try {
                        updateQty(item.product_id, item.qty - 1, item.unit_id);
                      } catch (error) {
                        pushToast({
                          title: 'Qty tidak valid',
                          description:
                            error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                          variant: 'warning',
                        });
                      }
                    }}
                    onIncrease={() => {
                      try {
                        updateQty(item.product_id, item.qty + 1, item.unit_id);
                      } catch (error) {
                        pushToast({
                          title: 'Qty tidak valid',
                          description:
                            error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                          variant: 'warning',
                        });
                      }
                    }}
                    onRemove={() => removeItem(item.product_id, item.unit_id)}
                    onOpenNumpad={() =>
                      setNumpadItem({
                        productId: item.product_id,
                        unitId: item.unit_id,
                        nama: item.nama_produk,
                        currentQty: item.qty,
                      })
                    }
                    onSetQty={(qty) => {
                      try {
                        updateQty(item.product_id, qty, item.unit_id);
                      } catch (error) {
                        pushToast({
                          title: 'Qty tidak valid',
                          description:
                            error instanceof Error ? error.message : 'Qty produk melebihi stok.',
                          variant: 'warning',
                        });
                      }
                    }}
                  />
                ))
            ) : (
              <div className="flex h-56 flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-4xl text-slate-300">shopping_cart</span>
                <p className="mt-2 font-display text-sm font-bold text-slate-600">Pesanan masih kosong</p>
                <p className="text-xs text-slate-400 mt-0.5">Ketuk item di katalog untuk menambahkan.</p>
              </div>
            )}
          </div>

          {/* Ringkasan Biaya & Tombol Bayar Moka POS */}
          <div className="border-t border-slate-200 bg-[#f8f9fa] p-6 space-y-3">
            <div className="space-y-1.5 text-xs font-semibold text-slate-600">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span className="font-bold text-[#1f2937]">Rp {subtotal.toLocaleString('id-ID')}</span>
              </div>

              <div className="flex items-center justify-between">
                <span>Diskon</span>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-slate-400">%</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={diskon_persen}
                    onChange={(e) => setDiskon(Number(e.target.value))}
                    className="h-7 w-14 rounded-lg border border-slate-200 bg-white px-1.5 text-right text-xs font-bold outline-none focus:border-[#2563eb]"
                  />
                  {diskon_amount > 0 && (
                    <span className="text-[#16a34a] font-bold">
                      -Rp {diskon_amount.toLocaleString('id-ID')}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  PPN ({ppn_persen}%)
                </span>
                {ppn_amount > 0 ? (
                  <span className="font-bold text-[#1f2937]">
                    +Rp {ppn_amount.toLocaleString('id-ID')}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">0%</span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200 flex items-baseline justify-between">
              <span className="font-display text-sm font-bold text-slate-500 uppercase tracking-wider">
                Total
              </span>
              <div className="font-display text-2xl sm:text-3xl font-black text-[#2563eb]">
                Rp {total.toLocaleString('id-ID')}
              </div>
            </div>

            {/* Tombol Bayar Raksasa Moka POS */}
            <button
              type="button"
              disabled={items.length === 0 || !isOnline}
              onClick={() => setIsPaymentModalOpen(true)}
              className="mt-2 flex h-16 w-full items-center justify-between rounded-2xl bg-[#2563eb] px-6 font-display text-base font-black tracking-wide text-white shadow-lg shadow-blue-500/25 transition hover:bg-[#1d4ed8] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-2xl">point_of_sale</span>
                <span>BAYAR</span>
              </div>
              <span className="text-xl font-black">
                {items.length > 0 ? `Rp ${total.toLocaleString('id-ID')}` : 'Rp 0'}
              </span>
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
                  className="mt-1 text-[22px] font-black tracking-tight text-[#2563eb]"
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
                disabled={processingPayment || items.length === 0 || !isOnline}
                onClick={() => {
                  setIsPaymentModalOpen(true)
                }}
                className="flex min-h-[58px] min-w-[140px] items-center justify-center gap-2 rounded-2xl bg-[#2563eb] px-5 text-center font-display font-black text-white shadow-lg shadow-blue-500/25 transition hover:bg-[#1d4ed8] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
              >
                <span className="material-symbols-outlined text-xl">point_of_sale</span>
                <span className="text-sm font-black">BAYAR</span>
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
        onThermalPrint={handleThermalPrint}
        printingThermal={printingThermal}
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
                className="font-extrabold text-[#2563eb]"
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
              className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleConfirmPending()}
            disabled={confirmingPayment}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-[#2563eb] font-bold text-white disabled:opacity-60"
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
        {unitPickerProduct && (() => {
          const pid = unitPickerProduct.id ?? 0
          const choices = getUnitChoices(unitPickerProduct, unitsMap[pid] ?? [])
          return (
            <div className="space-y-2">
              {choices.map((choice) => {
                const matchedUnit =
                  choice.source === 'product_unit'
                    ? (unitsMap[pid] ?? []).find((u) => u.id === choice.unit_id) ?? null
                    : null
                return (
                  <button
                    key={choice.unit_id ? `u-${choice.unit_id}` : 'base'}
                    type="button"
                    disabled={choice.stok_tersedia <= 0}
                    onClick={() => handleSelectUnit(unitPickerProduct, matchedUnit)}
                    className="flex w-full items-center justify-between rounded-[14px] bg-[#f7f9f9] px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#eff6ff]"
                  >
                    <div>
                      <span className="font-extrabold text-[#1b1e20]">{choice.nama_satuan}</span>
                      <span className="ml-2 text-xs text-[#8b9895]">Stok: {choice.stok_tersedia}</span>
                    </div>
                    <span className="font-extrabold text-[#2563eb]">
                      {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(choice.harga_jual)}
                    </span>
                  </button>
                )
              })}
              {(variantsMap[pid] ?? []).map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  disabled={Number(variant.stok ?? 0) <= 0}
                  onClick={() => handleSelectUnit(variant)}
                  className="flex w-full items-center justify-between rounded-[14px] bg-[#f7f9f9] px-4 py-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#eff6ff]"
                >
                  <div>
                    <span className="font-extrabold text-[#1b1e20]">{variant.satuan}</span>
                    <span className="ml-2 text-xs text-[#8b9895]">Stok: {variant.stok ?? 0}</span>
                  </div>
                  <span className="font-extrabold text-[#2563eb]">
                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(Number(variant.harga_jual ?? 0))}
                  </span>
                </button>
              ))}
            </div>
          )
        })()}
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
              className="mt-2 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
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

      {/* Modal Buka Shift Kasir */}
      <Modal
        open={isOpenShiftModal}
        onClose={() => setIsOpenShiftModal(false)}
        title="Buka Shift Kasir Baru"
        description="Masukkan nominal uang kas kecil atau modal kembalian awal di laci kasir."
        size="sm"
      >
        <form onSubmit={handleOpenShiftSubmit} className="space-y-4">
          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Modal Kas Awal (Rp)
            </label>
            <input
              type="text"
              required
              placeholder="Contoh: 100.000"
              value={shiftModalAwal}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '')
                setShiftModalAwal(val ? Number(val).toLocaleString('id-ID') : '')
              }}
              className="mt-2 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm font-bold text-[#1b1e20] outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Catatan Pembukaan (Opsional)
            </label>
            <input
              type="text"
              placeholder="Contoh: Shift pagi / laci nomor 1"
              value={shiftCatatan}
              onChange={(e) => setShiftCatatan(e.target.value)}
              className="mt-2 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsOpenShiftModal(false)}
              className="rounded-[14px] bg-[#f1f3f5] px-5 py-3 font-bold text-[#52627d]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={shiftSubmitting}
              className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white transition hover:bg-[#1d4ed8] disabled:opacity-60"
            >
              {shiftSubmitting ? 'Membuka...' : 'Buka Shift Sekarang'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Closing Shift Kasir */}
      <Modal
        open={isCloseShiftModal}
        onClose={() => setIsCloseShiftModal(false)}
        title="Closing Kasir & Rekap Kas"
        description="Hitung total fisik uang di laci kasir untuk validasi dengan pencatatan sistem."
        size="md"
      >
        <form onSubmit={handleCloseShiftSubmit} className="space-y-4">
          <div className="rounded-[16px] bg-[#f7faf9] border border-[#bfdbfe] p-4 text-sm space-y-1">
            <div className="flex justify-between text-[#52627d]">
              <span>Waktu Buka Shift:</span>
              <span className="font-bold text-[#1b1e20]">
                {activeShift?.opened_at ? format(new Date(activeShift.opened_at), 'dd MMM yyyy, HH:mm') : '-'}
              </span>
            </div>
            <div className="flex justify-between text-[#52627d]">
              <span>Modal Kas Awal:</span>
              <span className="font-bold text-[#2563eb]">
                Rp {(activeShift?.modal_awal ?? 0).toLocaleString('id-ID')}
              </span>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Total Fisik Uang di Laci Kasir (Rp)
            </label>
            <input
              type="text"
              required
              placeholder="Hitung seluruh uang tunai fisik di laci"
              value={shiftUangFisik}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '')
                setShiftUangFisik(val ? Number(val).toLocaleString('id-ID') : '')
              }}
              className="mt-2 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm font-bold text-[#1b1e20] outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Pengeluaran Kas Kecil / Bon Toko (Rp)
            </label>
            <input
              type="text"
              placeholder="Contoh: beli es batu, bensin, parkir"
              value={shiftPengeluaran}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '')
                setShiftPengeluaran(val ? Number(val).toLocaleString('id-ID') : '')
              }}
              className="mt-2 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <div>
            <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
              Catatan Closing Shift
            </label>
            <textarea
              rows={2}
              placeholder="Keterangan tambahan shift kasir..."
              value={shiftCatatan}
              onChange={(e) => setShiftCatatan(e.target.value)}
              className="mt-2 w-full rounded-[14px] bg-[#f1f3f5] px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsCloseShiftModal(false)}
              className="rounded-[14px] bg-[#f1f3f5] px-5 py-3 font-bold text-[#52627d]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={shiftSubmitting}
              className="rounded-[14px] bg-[#ba1a1a] px-5 py-3 font-bold text-white transition hover:bg-[#9b1515] disabled:opacity-60"
            >
              {shiftSubmitting ? 'Memproses...' : 'Tutup Shift Kasir'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Pembayaran Moka POS */}
      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        total={total}
        subtotal={subtotal}
        diskonAmount={diskon_amount}
        ppnAmount={ppn_amount}
        metodeBayar={metode_bayar}
        onSelectMetode={setMetodeBayar}
        uangDiterima={uang_diterima}
        onUangDiterimaChange={setUangDiterima}
        kembalian={kembalian}
        onConfirmPayment={() => void handleProcessPayment()}
        isProcessing={processingPayment}
        settings={settings}
        customerName={selectedCustomer?.nama}
      />

      {/* Modal Barcode Scanner Kamera (F8) */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(code) => {
          void handleBarcodeSearch(code)
        }}
      />

      {/* Modal Transaksi Ditahan / Parkir (F9) */}
      <HeldTransactionsModal
        isOpen={isHeldModalOpen}
        onClose={() => setIsHeldModalOpen(false)}
        onResume={handleResumeHeldCart}
      />

      {/* Modal Numpad Sentuh Layar Kasir */}
      {numpadItem && (
        <NumpadModal
          isOpen={Boolean(numpadItem)}
          onClose={() => setNumpadItem(null)}
          title={`Atur Jumlah: ${numpadItem.nama}`}
          initialValue={numpadItem.currentQty}
          minValue={1}
          maxValue={9999}
          quickOptions={[1, 2, 5, 10, 20, 50, 100]}
          onConfirm={(val) => {
            try {
              updateQty(numpadItem.productId, val, numpadItem.unitId)
            } catch (err) {
              pushToast({
                title: 'Qty Tidak Valid',
                description: err instanceof Error ? err.message : 'Kuantitas melebihi stok.',
                variant: 'warning',
              })
            }
          }}
        />
      )}
    </main>
  )
}
