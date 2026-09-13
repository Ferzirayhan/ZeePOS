import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { zodResolver } from '@hookform/resolvers/zod'
import JsBarcode from 'jsbarcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  archiveCategory,
  archiveProduct,
  bulkUpdateProductPrices,
  createCategory,
  createProduct,
  createProductVariant,
  deleteCategory,
  deleteProduct,
  deleteProductVariant,
  getCategories,
  getProductDiscountTiers,
  getProductPriceHistory,
  getProductStats,
  getProductsPage,
  getProductVariants,
  saveProductDiscountTiers,
  updateCategory,
  updateProduct,
  uploadProductPhoto,
  getProducts,
} from '../api/products'
import type { DiscountTierRow, ProductPriceHistory, ProductVariantInput } from '../api/products'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Modal } from '../components/ui/Modal'
import { Skeleton } from '../components/ui/Skeleton'
import { useUIStore } from '../stores/uiStore'
import { useToastStore } from '../stores/toastStore'
import type { Category, ProductWithCategory, SatuanType } from '../types/database'
import { formatRupiah } from '../utils/currency'
import { exportToExcel } from '../utils/export'
import { cn } from '../utils/cn'

const productSchema = z.object({
  sku: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  nama: z.string().trim().min(2, 'Nama produk minimal 2 karakter'),
  deskripsi: z.string().trim().optional(),
  category_id: z.coerce.number().optional().nullable(),
  satuan: z.enum(['pcs', 'lusin', 'kg', 'meter', 'pack', 'gram', 'dus', 'ikat', 'bal', 'roll', 'batang', 'lembar']),
  harga_beli: z.coerce.number().min(0, 'Harga beli tidak boleh negatif'),
  harga_jual: z.coerce.number().min(1, 'Harga jual wajib diisi'),
  diskon_produk_persen: z.coerce.number().min(0).max(99, 'Diskon maks 99%'),
  stok: z.coerce.number().min(0, 'Stok tidak boleh negatif'),
  stok_minimum: z.coerce.number().min(0, 'Stok minimum tidak boleh negatif'),
  is_active: z.boolean(),
})

type ProductFormValues = z.infer<typeof productSchema>
type ProductFormInput = z.input<typeof productSchema>
const categorySchema = z.object({
  nama: z.string().trim().min(2, 'Nama kategori minimal 2 karakter'),
  deskripsi: z.string().trim().optional(),
  is_active: z.boolean(),
})
type CategoryFormValues = z.infer<typeof categorySchema>
type CategoryFormInput = z.input<typeof categorySchema>

type ProductSortKey = 'nama' | 'harga_jual' | 'harga_beli' | 'stok' | 'created_at'
type ProductStatusFilter = 'all' | 'active' | 'inactive'

const satuanOptions: Array<{ value: SatuanType; label: string }> = [
  { value: 'pcs', label: 'Pcs' },
  { value: 'lusin', label: 'Lusin' },
  { value: 'kg', label: 'Kg' },
  { value: 'meter', label: 'Meter' },
  { value: 'pack', label: 'Pack' },
  { value: 'gram', label: 'Gram' },
  { value: 'dus', label: 'Dus' },
  { value: 'ikat', label: 'Ikat' },
  { value: 'bal', label: 'Bal' },
  { value: 'roll', label: 'Roll' },
  { value: 'batang', label: 'Batang' },
  { value: 'lembar', label: 'Lembar' },
]

function generateSkuSeed() {
  const suffix = Date.now().toString().slice(-6)
  return `PRD-${suffix}`
}

function ProductBarcodePreview({ value, className }: { value: string; className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !value) {
      return
    }

    JsBarcode(svgRef.current, value, {
      format: 'CODE128',
      displayValue: true,
      background: 'transparent',
      lineColor: '#1b1e20',
      width: 1.7,
      height: 54,
      fontSize: 14,
      margin: 0,
    })
  }, [value])

  return <svg ref={svgRef} className={className} />
}

function PriceHistorySection({ productId }: { productId: number }) {
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<ProductPriceHistory[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !productId) {
      return
    }

    let isMounted = true

    const loadHistory = async () => {
      setLoading(true)

      try {
        const result = await getProductPriceHistory(productId)
        if (isMounted) {
          setHistory(result)
        }
      } catch {
        if (isMounted) {
          setHistory([])
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void loadHistory()

    return () => {
      isMounted = false
    }
  }, [open, productId])

  return (
    <div className="rounded-[14px] border border-[#eef1f1]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-[#52627d]"
      >
        <span>Riwayat Harga Beli</span>
        <span className="material-symbols-outlined text-[18px]">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open ? (
        <div className="border-t border-[#eef1f1] px-4 pb-4 pt-3">
          {loading ? (
            <Skeleton className="h-20 rounded-[10px]" />
          ) : history.length > 0 ? (
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <p className="font-bold text-[#1b1e20]">
                      Beli: {formatRupiah(item.harga_beli)} {'->'} Jual: {formatRupiah(item.harga_jual)}
                    </p>
                    <p className="text-xs text-[#8b9895]">
                      {item.created_at
                        ? format(new Date(item.created_at), 'dd MMM yyyy, HH:mm', { locale: localeId })
                        : '-'}
                      {item.keterangan ? ` · ${item.keterangan}` : ''}
                    </p>
                  </div>
                  <span className="text-right text-xs font-bold text-[#2563eb]">
                    {item.harga_beli > 0
                      ? `Margin ${(((item.harga_jual - item.harga_beli) / item.harga_beli) * 100).toFixed(1)}%`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#8b9895]">Belum ada riwayat perubahan harga.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

interface ProductDrawerProps {
  open: boolean
  onClose: () => void
  categories: Category[]
  initialProduct: ProductWithCategory | null
  onSaved: () => Promise<void>
}

interface CategoryManagerProps {
  open: boolean
  categories: Category[]
  onClose: () => void
  onSaved: () => Promise<void>
}

function CategoryManager({ open, categories, onClose, onSaved }: CategoryManagerProps) {
  const pushToast = useToastStore((state) => state.pushToast)
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Category | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CategoryFormInput, unknown, CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      nama: '',
      deskripsi: '',
      is_active: true,
    },
  })

  useEffect(() => {
    if (!open) {
      return
    }

    reset({
      nama: selectedCategory?.nama ?? '',
      deskripsi: selectedCategory?.deskripsi ?? '',
      is_active: selectedCategory?.is_active ?? true,
    })
  }, [open, reset, selectedCategory])

  const handleSaveCategory = async (values: CategoryFormValues) => {
    setSubmitting(true)
    const wasEditing = Boolean(selectedCategory?.id)

    try {
      if (selectedCategory?.id) {
        await updateCategory(selectedCategory.id, {
          nama: values.nama,
          deskripsi: values.deskripsi || null,
          is_active: values.is_active,
        })
      } else {
        await createCategory({
          nama: values.nama,
          deskripsi: values.deskripsi || null,
          is_active: values.is_active,
        })
      }

      await onSaved()
      setSelectedCategory(null)
      reset({ nama: '', deskripsi: '', is_active: true })
      pushToast({
        title: wasEditing ? 'Kategori diperbarui' : 'Kategori ditambahkan',
        description: `${values.nama} berhasil disimpan.`,
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Gagal menyimpan kategori',
        description: error instanceof Error ? error.message : 'Kategori belum berhasil disimpan.',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteCategory = async () => {
    if (!deleteTarget?.id) {
      return
    }

    setDeleteLoading(true)

    try {
      await deleteCategory(deleteTarget.id)
      await onSaved()
      if (selectedCategory?.id === deleteTarget.id) {
        setSelectedCategory(null)
        reset({ nama: '', deskripsi: '', is_active: true })
      }
      pushToast({
        title: 'Kategori dihapus',
        description: `${deleteTarget.nama ?? 'Kategori'} berhasil dihapus permanen.`,
        variant: 'success',
      })
      setDeleteTarget(null)
    } catch (error) {
      pushToast({
        title: 'Gagal menghapus kategori',
        description: error instanceof Error ? error.message : 'Kategori belum berhasil dihapus.',
        variant: 'error',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleArchiveCategory = async () => {
    if (!archiveTarget?.id) {
      return
    }

    setArchiveLoading(true)

    try {
      await archiveCategory(archiveTarget.id)
      await onSaved()
      if (selectedCategory?.id === archiveTarget.id) {
        setSelectedCategory({
          ...archiveTarget,
          is_active: false,
        })
      }
      pushToast({
        title: 'Kategori diarsipkan',
        description: `${archiveTarget.nama ?? 'Kategori'} dipindahkan ke status nonaktif.`,
        variant: 'success',
      })
      setArchiveTarget(null)
    } catch (error) {
      pushToast({
        title: 'Gagal mengarsipkan kategori',
        description: error instanceof Error ? error.message : 'Kategori belum berhasil diarsipkan.',
        variant: 'error',
      })
    } finally {
      setArchiveLoading(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={() => {
          setSelectedCategory(null)
          onClose()
        }}
        title="Kelola Kategori"
        description="Tambah, edit, arsipkan, atau hapus kategori produk."
        size="lg"
      >
        <div className="grid gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-3 rounded-[18px] bg-[#f7f9f9] p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">
                Daftar Kategori
              </h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory(null)
                  reset({ nama: '', deskripsi: '', is_active: true })
                }}
                className="rounded-[10px] bg-white px-3 py-2 text-xs font-bold text-[#2563eb]"
              >
                Baru
              </button>
            </div>
            <div className="space-y-2">
              {categories.length > 0 ? (
                categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-[14px] px-4 py-3 text-left',
                      selectedCategory?.id === category.id
                        ? 'bg-[#eff6ff] text-[#2563eb]'
                        : 'bg-white text-[#2e3132]',
                    )}
                  >
                    <span className="font-semibold">{category.nama}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase',
                        category.is_active
                          ? 'bg-[#dcfce7] text-[#16a34a]'
                          : 'bg-[#edeef0] text-[#6d7a77]',
                      )}
                    >
                      {category.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rounded-[14px] bg-white px-4 py-5 text-sm text-[#8b9895]">
                  Belum ada kategori. Tambahkan kategori pertama dulu.
                </div>
              )}
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit(handleSaveCategory)}>
            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Nama Kategori
              </label>
              <input
                type="text"
                className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                placeholder="Contoh: Ember & Baskom"
                {...register('nama')}
              />
              {errors.nama ? <p className="text-sm text-[#ba1a1a]">{errors.nama.message}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Deskripsi
              </label>
              <textarea
                rows={4}
                className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                placeholder="Deskripsi kategori opsional"
                {...register('deskripsi')}
              />
            </div>

            <label className="flex items-center gap-3 rounded-[14px] bg-[#f8fbfb] px-4 py-3 text-sm font-medium text-[#52627d]">
              <input type="checkbox" className="h-4 w-4 rounded" {...register('is_active')} />
              Kategori aktif dan bisa dipilih saat tambah produk
            </label>

            <div className="flex flex-wrap justify-between gap-3 pt-4">
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={!selectedCategory}
                  onClick={() => selectedCategory && setArchiveTarget(selectedCategory)}
                  className="rounded-[14px] bg-[#eef3f3] px-5 py-3 font-bold text-[#52627d] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Arsipkan
                </button>
                <button
                  type="button"
                  disabled={!selectedCategory}
                  onClick={() => selectedCategory && setDeleteTarget(selectedCategory)}
                  className="rounded-[14px] bg-[#fff1ed] px-5 py-3 font-bold text-[#ba1a1a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Hapus
                </button>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-[14px] bg-[#2563eb] px-6 py-3 font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] disabled:opacity-60"
              >
                {submitting ? 'Menyimpan...' : selectedCategory ? 'Update Kategori' : 'Tambah Kategori'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Arsipkan kategori?"
        description={`Kategori ${archiveTarget?.nama ?? ''} akan disembunyikan dari pilihan aktif, tapi datanya tetap tersimpan.`}
        confirmLabel="Arsipkan"
        loading={archiveLoading}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void handleArchiveCategory()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus kategori?"
        description={`Kategori ${deleteTarget?.nama ?? ''} akan dihapus permanen dari sistem.`}
        confirmLabel="Hapus"
        variant="danger"
        loading={deleteLoading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteCategory()}
      />
    </>
  )
}

function VariantSection({
  rootProduct,
}: {
  rootProduct: ProductWithCategory
}) {
  const pushToast = useToastStore((state) => state.pushToast)
  const [open, setOpen] = useState(false)
  const [variants, setVariants] = useState<ProductWithCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ProductVariantInput>({
    satuan: 'pcs',
    harga_beli: 0,
    harga_jual: 0,
    stok: 0,
    stok_minimum: 0,
    sku: null,
    barcode: null,
  })

  useEffect(() => {
    if (!open || !rootProduct.id) return
    let mounted = true
    setLoading(true)
    getProductVariants(rootProduct.id)
      .then((data) => { if (mounted) setVariants(data) })
      .catch(() => { if (mounted) setVariants([]) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [open, rootProduct.id])

  const handleAddVariant = async () => {
    if (!form.harga_jual || !form.satuan) return
    setSaving(true)
    try {
      await createProductVariant(rootProduct, form)
      const updated = await getProductVariants(rootProduct.id ?? 0)
      setVariants(updated)
      setShowForm(false)
      setForm({ satuan: 'pcs', harga_beli: 0, harga_jual: 0, stok: 0, stok_minimum: 0, sku: null, barcode: null })
      pushToast({ title: 'Varian ditambahkan', description: `Varian ${form.satuan} berhasil dibuat.`, variant: 'success' })
    } catch (err) {
      pushToast({ title: 'Gagal tambah varian', description: err instanceof Error ? err.message : 'Terjadi kesalahan.', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveVariant = async (variantId: number, satuan: string) => {
    try {
      await deleteProductVariant(variantId)
      setVariants((prev) => prev.filter((v) => v.id !== variantId))
      pushToast({ title: 'Varian dihapus', description: `Varian ${satuan} dinonaktifkan.`, variant: 'success' })
    } catch (err) {
      pushToast({ title: 'Gagal hapus varian', description: err instanceof Error ? err.message : 'Terjadi kesalahan.', variant: 'error' })
    }
  }

  const hargaBeli = Number(rootProduct.harga_beli ?? 0)
  const hargaJual = Number(rootProduct.harga_jual ?? 0)
  const ratio = form.harga_beli > 0 && hargaBeli > 0 ? form.harga_beli / hargaBeli : null

  return (
    <div className="rounded-[18px] border border-[#eef1f1] bg-[#f9fbfb]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-[#1b1e20]"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-[#2563eb]">layers</span>
          Varian Unit
          {variants.length > 0 && (
            <span className="rounded-full bg-[#2563eb] px-2 py-0.5 text-[10px] font-extrabold text-white">
              {variants.length}
            </span>
          )}
        </div>
        <span className="material-symbols-outlined text-[18px] text-[#8b9895]">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="border-t border-[#eef1f1] px-4 pb-4 pt-3 space-y-3">
          <p className="text-xs text-[#8b9895]">
            Buat varian satuan berbeda (pak, kg, lusin) dari produk ini. Varian berbagi nama &amp; kategori yang sama.
          </p>

          {loading ? (
            <Skeleton className="h-12 rounded-[12px]" />
          ) : (
            <>
              {variants.length > 0 && (
                <div className="space-y-2">
                  {variants.map((v) => (
                    <div key={v.id} className="flex items-center justify-between rounded-[12px] bg-white px-3 py-2.5 text-sm">
                      <div>
                        <span className="font-bold text-[#1b1e20]">{v.satuan}</span>
                        <span className="ml-2 text-xs text-[#8b9895]">
                          Jual: {formatRupiah(Number(v.harga_jual ?? 0))}
                          {Number(v.harga_beli ?? 0) > 0 && ` · Beli: ${formatRupiah(Number(v.harga_beli ?? 0))}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRemoveVariant(v.id ?? 0, v.satuan ?? '')}
                        className="rounded-full p-1 text-[#a0aaa7] hover:bg-[#fff1ed] hover:text-[#d63f2f]"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showForm ? (
                <div className="space-y-3 rounded-[14px] bg-white p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">Satuan</label>
                      <select
                        value={form.satuan}
                        onChange={(e) => setForm((f) => ({ ...f, satuan: e.target.value }))}
                        className="h-10 w-full rounded-[12px] border-none bg-[#eef0f3] px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      >
                        {satuanOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">
                        Harga Beli
                        {ratio && (
                          <span className="ml-1 text-[#2563eb]">
                            (×{ratio.toFixed(2)} dari induk)
                          </span>
                        )}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={form.harga_beli || ''}
                        placeholder={String(hargaBeli)}
                        onChange={(e) => {
                          const beli = Number(e.target.value)
                          const suggestedJual = beli > 0 && hargaBeli > 0
                            ? Math.round(beli / hargaBeli * hargaJual)
                            : form.harga_jual
                          setForm((f) => ({ ...f, harga_beli: beli, harga_jual: suggestedJual }))
                        }}
                        className="h-10 w-full rounded-[12px] border-none bg-[#eef0f3] px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">Harga Jual</label>
                      <input
                        type="number"
                        min={1}
                        value={form.harga_jual || ''}
                        onChange={(e) => setForm((f) => ({ ...f, harga_jual: Number(e.target.value) }))}
                        className="h-10 w-full rounded-[12px] border-none bg-[#eef0f3] px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">Stok Awal</label>
                      <input
                        type="number"
                        min={0}
                        value={form.stok || ''}
                        onChange={(e) => setForm((f) => ({ ...f, stok: Number(e.target.value) }))}
                        className="h-10 w-full rounded-[12px] border-none bg-[#eef0f3] px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">SKU (opsional)</label>
                    <input
                      type="text"
                      value={form.sku ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value || null }))}
                      className="h-10 w-full rounded-[12px] border-none bg-[#eef0f3] px-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="flex-1 rounded-[12px] bg-[#eef0f3] py-2 text-sm font-bold text-[#52627d]"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={saving || !form.harga_jual}
                      onClick={() => void handleAddVariant()}
                      className="flex-1 rounded-[12px] bg-[#2563eb] py-2 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {saving ? 'Menyimpan...' : 'Simpan Varian'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-dashed border-[#bfdbfe] py-2.5 text-sm font-bold text-[#2563eb]"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  Tambah Varian Unit
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ProductDrawer({
  open,
  onClose,
  categories,
  initialProduct,
  onSaved,
}: ProductDrawerProps) {
  const pushToast = useToastStore((state) => state.pushToast)
  const [submitting, setSubmitting] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  const [discountTiers, setDiscountTiers] = useState<DiscountTierRow[]>([])
  const [ongkosKirim, setOngkosKirim] = useState(0)
  const [showHppCalc, setShowHppCalc] = useState(false)
  const [tiersLoading, setTiersLoading] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProductFormInput, unknown, ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: '',
      barcode: '',
      nama: '',
      deskripsi: '',
      category_id: categories[0]?.id ?? 0,
      satuan: 'pcs',
      harga_beli: 0,
      harga_jual: 0,
      diskon_produk_persen: 0,
      stok: 0,
      stok_minimum: 5,
      is_active: true,
    },
  })

  useEffect(() => {
    if (!open) {
      setDiscountTiers([])
      setOngkosKirim(0)
      setShowHppCalc(false)
      return
    }

    if (initialProduct?.id) {
      setTiersLoading(true)
      getProductDiscountTiers(initialProduct.id)
        .then(setDiscountTiers)
        .catch(() => setDiscountTiers([]))
        .finally(() => setTiersLoading(false))
    } else {
      setDiscountTiers([])
    }

    if (initialProduct) {
      reset({
        sku: initialProduct.sku ?? '',
        barcode: initialProduct.barcode ?? '',
        nama: initialProduct.nama ?? '',
        deskripsi: initialProduct.deskripsi ?? '',
        category_id: initialProduct.category_id ?? categories[0]?.id ?? 0,
        satuan: initialProduct.satuan ?? 'pcs',
        harga_beli: Number(initialProduct.harga_beli ?? 0),
        harga_jual: Number(initialProduct.harga_jual ?? 0),
        diskon_produk_persen: Number(initialProduct.diskon_produk_persen ?? 0),
        stok: Number(initialProduct.stok ?? 0),
        stok_minimum: Number(initialProduct.stok_minimum ?? 5),
        is_active: initialProduct.is_active ?? true,
      })
      setPhotoPreview(initialProduct.foto_url ?? null)
      setPhotoFile(null)
      return
    }

    reset({
      sku: generateSkuSeed(),
      barcode: '',
      nama: '',
      deskripsi: '',
      category_id: categories[0]?.id ?? 0,
      satuan: 'pcs',
      harga_beli: 0,
      harga_jual: 0,
      diskon_produk_persen: 0,
      stok: 0,
      stok_minimum: 5,
      is_active: true,
    })
    setPhotoPreview(null)
    setPhotoFile(null)
  }, [categories, initialProduct, open, reset])

  useEffect(() => {
    if (!photoFile) {
      return undefined
    }

    const objectUrl = URL.createObjectURL(photoFile)
    setPhotoPreview(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [photoFile])

  const barcodeValue = watch('barcode') || watch('sku') || 'PRD-ZEE'
  const watchedHargaBeli = Number(watch('harga_beli') ?? 0)
  const hasCategories = categories.length > 0

  const hppTotal = watchedHargaBeli + ongkosKirim
  const marginScenarios = [10, 20, 30].map((margin) => ({
    margin,
    hargaJual: hppTotal > 0 ? Math.round(hppTotal / (1 - margin / 100)) : 0,
  }))

  const onSubmit = async (values: ProductFormValues) => {
    setSubmitting(true)

    try {
      let fotoUrl = initialProduct?.foto_url ?? null

      if (photoFile) {
        fotoUrl = await uploadProductPhoto(photoFile)
      }

      const payload = {
        sku: values.sku || null,
        barcode: values.barcode || null,
        nama: values.nama,
        deskripsi: values.deskripsi || null,
        category_id:
          values.category_id && values.category_id > 0
            ? values.category_id
            : (categories[0]?.id ?? null),
        satuan: values.satuan,
        harga_beli: values.harga_beli,
        harga_jual: values.harga_jual,
        diskon_produk_persen: values.diskon_produk_persen,
        stok: values.stok,
        stok_minimum: values.stok_minimum,
        foto_url: fotoUrl,
        is_active: values.is_active,
      }

      let savedId: number
      if (initialProduct?.id) {
        await updateProduct(initialProduct.id, payload)
        savedId = initialProduct.id
      } else {
        const created = await createProduct(payload)
        savedId = created.id
      }

      await saveProductDiscountTiers(savedId, discountTiers)
      await onSaved()
      onClose()
      pushToast({
        title: initialProduct ? 'Produk diperbarui' : 'Produk ditambahkan',
        description: `${values.nama} berhasil disimpan.`,
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Gagal menyimpan produk',
        description: error instanceof Error ? error.message : 'Produk belum berhasil disimpan.',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/25 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Tutup drawer" />
      <aside className="absolute right-0 top-0 z-[91] flex h-full w-full max-w-[540px] flex-col bg-white shadow-[-24px_0_60px_rgba(15,23,42,0.16)]">
        <div className="flex items-start justify-between border-b border-[#eef1f1] px-6 py-5">
          <div>
            <h2 className="text-[30px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
              {initialProduct ? 'Edit Produk' : 'Tambah Produk Baru'}
            </h2>
            <p className="mt-1 text-sm text-[#8b9895]">
              Lengkapi detail produk untuk menyimpan ke inventaris.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-[#74807d] hover:bg-[#f7f9f9]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <form className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="grid gap-6">
            <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-4">
              <label className="flex h-[92px] cursor-pointer flex-col items-center justify-center rounded-[20px] border border-dashed border-[#bfdbfe] bg-[#f9fbfb] text-center text-[#75827f]">
                {photoPreview ? (
                  <img src={photoPreview} alt="Preview produk" className="h-full w-full rounded-[20px] object-cover" />
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[28px]">add_a_photo</span>
                    <span className="mt-1 text-[10px] font-bold uppercase">Upload Foto</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)}
                />
              </label>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Nama Produk
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Kopi Susu Aren / Botol Minum / Beras 5kg"
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('nama')}
                />
                {errors.nama ? <p className="text-sm text-[#ba1a1a]">{errors.nama.message}</p> : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  SKU
                </label>
                <input
                  type="text"
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('sku')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Barcode
                </label>
                <input
                  type="text"
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('barcode')}
                />
              </div>
            </div>

            {!hasCategories ? (
              <div className="rounded-[14px] border border-[#ffddb8] bg-[#fff7ed] px-4 py-3 text-sm font-medium text-[#855300]">
                Buat kategori dulu sebelum menambahkan produk baru.
              </div>
            ) : null}

            <div className="rounded-[18px] border border-[#eef1f1] bg-[#fcfdfd] p-4">
              <ProductBarcodePreview className="mx-auto h-[80px] w-full max-w-[320px]" value={barcodeValue} />
            </div>

            {initialProduct ? (
              <PriceHistorySection productId={initialProduct.id ?? 0} />
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                    Kategori
                  </label>
                  <button
                    type="button"
                    onClick={async () => {
                      const nama = window.prompt('Masukkan nama kategori baru:')
                      if (nama && nama.trim()) {
                        try {
                          const cat = await createCategory({ nama: nama.trim(), is_active: true })
                          setValue('category_id', cat.id)
                          pushToast({
                            title: 'Kategori dibuat',
                            description: `Kategori "${nama.trim()}" berhasil dibuat.`,
                            variant: 'success',
                          })
                          await onSaved()
                        } catch (err) {
                          pushToast({
                            title: 'Gagal membuat kategori',
                            description: err instanceof Error ? err.message : 'Error membuat kategori.',
                            variant: 'error',
                          })
                        }
                      }
                    }}
                    className="text-[11px] font-bold text-[#2563eb] hover:underline"
                  >
                    + Kategori Baru
                  </button>
                </div>
                <select
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('category_id')}
                >
                  <option value={0}>Pilih kategori</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.nama}
                    </option>
                  ))}
                </select>
                {errors.category_id ? (
                  <p className="text-sm text-[#ba1a1a]">{errors.category_id.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Satuan
                </label>
                <select
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('satuan')}
                >
                  {satuanOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Harga Beli
                </label>
                <input
                  type="number"
                  min={0}
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('harga_beli')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Harga Jual
                </label>
                <input
                  type="number"
                  min={0}
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('harga_jual')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Diskon Produk (%)
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  max={99}
                  step={0.01}
                  placeholder="0 = tidak ada diskon"
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 pr-12 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('diskon_produk_persen')}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-[#8b9895]">%</span>
              </div>
              {errors.diskon_produk_persen ? (
                <p className="text-sm text-[#ba1a1a]">{errors.diskon_produk_persen.message}</p>
              ) : (
                <p className="text-xs text-[#8b9895]">
                  Diskon tetap yang selalu berlaku untuk produk ini (promo/clearance).
                </p>
              )}
            </div>

            {/* HPP Calculator */}
            <div className="rounded-[18px] border border-[#eef1f1] bg-[#f9fbfb]">
              <button
                type="button"
                onClick={() => setShowHppCalc((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-[#1b1e20]"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#2563eb]">calculate</span>
                  Kalkulator HPP
                </div>
                <span className="material-symbols-outlined text-[18px] text-[#8b9895]">
                  {showHppCalc ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {showHppCalc && (
                <div className="border-t border-[#eef1f1] px-4 pb-4 pt-3 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#6d7a77]">Harga Beli</span>
                    <span className="font-bold text-[#1b1e20]">
                      {watchedHargaBeli > 0
                        ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(watchedHargaBeli)
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <label className="text-[#6d7a77]">Ongkos Kirim</label>
                    <input
                      type="number"
                      min={0}
                      value={ongkosKirim}
                      onChange={(e) => setOngkosKirim(Number(e.target.value))}
                      className="h-8 w-32 rounded-[10px] border-none bg-white px-3 text-right text-sm font-bold outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                  </div>
                  <div className="flex items-center justify-between text-sm border-t border-[#eef1f1] pt-2">
                    <span className="font-bold text-[#1b1e20]">HPP</span>
                    <span className="font-extrabold text-[#2563eb]">
                      {hppTotal > 0
                        ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(hppTotal)
                        : '—'}
                    </span>
                  </div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">
                    Saran Harga Jual
                  </p>
                  <div className="space-y-2">
                    {marginScenarios.map(({ margin, hargaJual }) => (
                      <div key={margin} className="flex items-center justify-between rounded-[12px] bg-white px-3 py-2">
                        <span className="text-xs font-bold text-[#6d7a77]">Margin {margin}%</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-extrabold text-[#1b1e20]">
                            {hargaJual > 0
                              ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(hargaJual)
                              : '—'}
                          </span>
                          {hargaJual > 0 && (
                            <button
                              type="button"
                              onClick={() => setValue('harga_jual', hargaJual)}
                              className="rounded-[8px] bg-[#2563eb] px-2 py-1 text-[10px] font-extrabold text-white"
                            >
                              Pakai
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Diskon Kuantitas */}
            <div className="rounded-[18px] border border-[#eef1f1] bg-[#f9fbfb] px-4 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#2563eb]">local_offer</span>
                  <span className="text-sm font-bold text-[#1b1e20]">Diskon Kuantitas</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDiscountTiers([...discountTiers, { min_qty: 0, diskon_persen: 0 }])}
                  className="rounded-[10px] bg-[#eff6ff] px-3 py-1.5 text-[11px] font-extrabold text-[#2563eb]"
                >
                  + Tambah Tier
                </button>
              </div>

              {tiersLoading ? (
                <p className="text-xs text-[#8b9895]">Memuat...</p>
              ) : discountTiers.length === 0 ? (
                <p className="text-xs font-medium text-[#8b9895]">
                  Belum ada tier. Klik "+ Tambah Tier" untuk buat diskon grosir.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895] px-1">
                    <span>Min. Qty</span>
                    <span>Diskon %</span>
                    <span />
                  </div>
                  {discountTiers.map((tier, index) => (
                    <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                      <input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={tier.min_qty || ''}
                        placeholder="e.g. 12"
                        onChange={(e) => {
                          const updated = [...discountTiers]
                          updated[index] = { ...updated[index], min_qty: Number(e.target.value) }
                          setDiscountTiers(updated)
                        }}
                        className="h-10 w-full rounded-[12px] border-none bg-white px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                      <input
                        type="number"
                        min={0.01}
                        max={100}
                        step={0.01}
                        value={tier.diskon_persen || ''}
                        placeholder="e.g. 10"
                        onChange={(e) => {
                          const updated = [...discountTiers]
                          updated[index] = { ...updated[index], diskon_persen: Number(e.target.value) }
                          setDiscountTiers(updated)
                        }}
                        className="h-10 w-full rounded-[12px] border-none bg-white px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      />
                      <button
                        type="button"
                        onClick={() => setDiscountTiers(discountTiers.filter((_, i) => i !== index))}
                        className="rounded-full p-1.5 text-[#a0aaa7] hover:bg-[#fff1ed] hover:text-[#d63f2f]"
                      >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {initialProduct ? (
              <VariantSection rootProduct={initialProduct} />
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Stok Awal
                </label>
                <input
                  type="number"
                  min={0}
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('stok')}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Stok Minimum
                </label>
                <input
                  type="number"
                  min={0}
                  className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  {...register('stok_minimum')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Deskripsi
              </label>
              <textarea
                rows={3}
                className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                {...register('deskripsi')}
              />
            </div>

            <label className="flex items-center gap-3 rounded-[14px] bg-[#f8fbfb] px-4 py-3 text-sm font-medium text-[#52627d]">
              <input type="checkbox" className="h-4 w-4 rounded" {...register('is_active')} />
              Produk aktif dan tampil di katalog
            </label>
          </div>

          <div className="mt-8 flex justify-end gap-3 border-t border-[#eef1f1] pt-6">
            <button type="button" onClick={onClose} className="rounded-[14px] px-5 py-3 font-bold text-[#52627d]">
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !hasCategories}
              className="rounded-[14px] bg-[#2563eb] px-6 py-3 font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] disabled:opacity-60"
            >
              {submitting ? 'Menyimpan...' : 'Simpan Produk'}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}

export function ProductsPage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const pushToast = useToastStore((state) => state.pushToast)
  const [products, setProducts] = useState<ProductWithCategory[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)
  const [barcodeOpen, setBarcodeOpen] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductWithCategory | null>(null)
  const [barcodeProduct, setBarcodeProduct] = useState<ProductWithCategory | null>(null)
  const [archiveProductTarget, setArchiveProductTarget] = useState<ProductWithCategory | null>(null)
  const [deleteProductTarget, setDeleteProductTarget] = useState<ProductWithCategory | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<number | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>('active')
  const [stokFilter, setStokFilter] = useState<'all' | 'aman' | 'menipis' | 'habis'>('all')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(10)
  const [totalCount, setTotalCount] = useState(0)
  const [sortBy, setSortBy] = useState<ProductSortKey>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalCategories: 0,
    lowStockProducts: 0,
    inactiveProducts: 0,
  })
  const [allCategories, setAllCategories] = useState<Category[]>([])

  // Bulk price update state
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false)
  const [bulkCategoryId, setBulkCategoryId] = useState<number | 'all'>('all')
  const [bulkJenis, setBulkJenis] = useState<'naik' | 'turun'>('naik')
  const [bulkMode, setBulkMode] = useState<'persen' | 'nominal'>('persen')
  const [bulkNilai, setBulkNilai] = useState(0)
  const [bulkPreview, setBulkPreview] = useState<{ product_id: number; nama: string; harga_lama: number; harga_baru: number }[]>([])
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false)
  const [bulkSubmitting, setBulkSubmitting] = useState(false)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [searchInput])

  const loadProducts = useCallback(async () => {
    setLoading(true)

    try {
      const [pageResult, categoryResult, statResult] = await Promise.all([
        getProductsPage({
          page,
          pageSize,
          search: search || undefined,
          categoryId: categoryId === 'all' ? undefined : categoryId,
          isActive:
            statusFilter === 'all' ? undefined : statusFilter === 'active',
          stokStatus: stokFilter === 'all' ? undefined : stokFilter,
          sortBy,
          sortDirection,
        }),
        getCategories(true),
        getProductStats(),
      ])

      setProducts(pageResult.data)
      setTotalCount(pageResult.count)
      setAllCategories(categoryResult)
      setCategories(categoryResult.filter((category) => category.is_active))
      setStats(statResult)
    } catch (error) {
      pushToast({
        title: 'Gagal memuat produk',
        description: error instanceof Error ? error.message : 'Data produk belum tersedia.',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [categoryId, page, pageSize, pushToast, search, sortBy, sortDirection, statusFilter, stokFilter])

  useEffect(() => {
    void loadProducts()
  }, [loadProducts])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const handleBulkPreview = async () => {
    if (!bulkNilai || bulkNilai <= 0) return
    setBulkPreviewLoading(true)
    try {
      const allProducts = await getProducts({
        categoryId: bulkCategoryId === 'all' ? undefined : bulkCategoryId,
        isActive: true,
      })
      const previews = allProducts.map((p) => {
        const hargaLama = Number(p.harga_jual ?? 0)
        let hargaBaru: number
        if (bulkMode === 'persen') {
          hargaBaru = bulkJenis === 'naik'
            ? Math.round(hargaLama * (1 + bulkNilai / 100))
            : Math.max(1, Math.round(hargaLama * (1 - bulkNilai / 100)))
        } else {
          hargaBaru = bulkJenis === 'naik'
            ? hargaLama + bulkNilai
            : Math.max(1, hargaLama - bulkNilai)
        }
        return { product_id: p.id ?? 0, nama: p.nama ?? '', harga_lama: hargaLama, harga_baru: hargaBaru }
      })
      setBulkPreview(previews)
    } catch (error) {
      pushToast({
        title: 'Gagal memuat preview',
        description: error instanceof Error ? error.message : 'Coba lagi.',
        variant: 'error',
      })
    } finally {
      setBulkPreviewLoading(false)
    }
  }

  const handleBulkSubmit = async () => {
    if (bulkPreview.length === 0) return
    setBulkSubmitting(true)
    try {
      const updates = bulkPreview.map((p) => ({ product_id: p.product_id, harga_jual: p.harga_baru }))
      const keterangan = `Update massal: ${bulkJenis} ${bulkNilai}${bulkMode === 'persen' ? '%' : ' nominal'}`
      const count = await bulkUpdateProductPrices(updates, keterangan)
      setBulkPriceOpen(false)
      setBulkPreview([])
      setBulkNilai(0)
      await loadProducts()
      pushToast({
        title: 'Harga diperbarui',
        description: `${count} produk berhasil diupdate.`,
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Gagal update harga',
        description: error instanceof Error ? error.message : 'Coba lagi.',
        variant: 'error',
      })
    } finally {
      setBulkSubmitting(false)
    }
  }

  const statCards = [
    { label: 'Total Produk', value: stats.totalProducts, color: 'border-[#2563eb]' },
    { label: 'Kategori', value: stats.totalCategories, color: 'border-[#a86b00]' },
    { label: 'Stok Menipis', value: stats.lowStockProducts, color: 'border-[#d97706]' },
    { label: 'Produk Nonaktif', value: stats.inactiveProducts, color: 'border-[#b45f36]' },
  ]

  const handleSort = (key: ProductSortKey) => {
    if (sortBy === key) {
      setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))
      return
    }

    setSortBy(key)
    setSortDirection('asc')
  }

  const handleEdit = (product: ProductWithCategory) => {
    setSelectedProduct(product)
    setDrawerOpen(true)
  }

  const handlePrintBarcode = () => {
    if (!barcodeProduct?.barcode && !barcodeProduct?.sku) {
      return
    }

    const barcodeNode = document.getElementById('barcode-print-area')

    if (!barcodeNode) {
      return
    }

    const printWindow = window.open('', '_blank', 'width=420,height=600')

    if (!printWindow) {
      return
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>${barcodeProduct.nama ?? 'Barcode Produk'}</title>
          <style>
            body { font-family: sans-serif; padding: 24px; text-align: center; }
            svg { width: 100%; height: auto; }
          </style>
        </head>
        <body>
          <h2>${barcodeProduct.nama ?? ''}</h2>
          ${barcodeNode.innerHTML}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const handleDeleteProduct = async () => {
    if (!deleteProductTarget?.id) {
      return
    }

    const deletedId = deleteProductTarget.id
    const deletedName = deleteProductTarget.nama ?? 'Produk'
    setDeleteLoading(true)

    try {
      await deleteProduct(deletedId)
      setProducts((current) => current.filter((product) => product.id !== deletedId))
      setTotalCount((current) => Math.max(0, current - 1))
      setStatusFilter('active')
      setDeleteProductTarget(null)
      pushToast({
        title: 'Produk dihapus',
        description: `${deletedName} berhasil dihapus permanen dari katalog.`,
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Gagal menghapus produk',
        description: error instanceof Error ? error.message : 'Produk belum berhasil dihapus.',
        variant: 'error',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleArchiveProduct = async () => {
    if (!archiveProductTarget?.id) {
      return
    }

    const archivedId = archiveProductTarget.id
    const archivedName = archiveProductTarget.nama ?? 'Produk'
    setArchiveLoading(true)

    try {
      await archiveProduct(archivedId)
      setProducts((current) => current.filter((product) => product.id !== archivedId))
      setTotalCount((current) => Math.max(0, current - 1))
      setStatusFilter('active')
      setArchiveProductTarget(null)
      pushToast({
        title: 'Produk diarsipkan',
        description: `${archivedName} dipindahkan ke status nonaktif.`,
        variant: 'success',
      })
    } catch (error) {
      pushToast({
        title: 'Gagal mengarsipkan produk',
        description: error instanceof Error ? error.message : 'Produk belum berhasil diarsipkan.',
        variant: 'error',
      })
    } finally {
      setArchiveLoading(false)
    }
  }

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pt-16 transition-[margin] duration-200 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="min-h-screen bg-white md:rounded-l-[24px]">
        <header className="flex flex-col gap-3 border-b border-[#eef1f1] px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-[320px]">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#98a19f]">
              search
            </span>
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Cari produk berdasarkan nama, SKU, atau barcode..."
              className="h-11 w-full rounded-full border-none bg-[#f1f3f5] pl-12 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 sm:flex-row xl:justify-end">
            <button
              type="button"
              onClick={async () => {
                try {
                  const allProducts = await getProducts()
                  const rows = allProducts.map((p) => ({
                    SKU: p.sku ?? '-',
                    Barcode: p.barcode ?? '-',
                    Nama: p.nama ?? '-',
                    Kategori: p.category_nama ?? 'Tanpa Kategori',
                    Satuan: p.satuan ?? 'pcs',
                    'Harga Beli': Number(p.harga_beli ?? 0),
                    'Harga Jual': Number(p.harga_jual ?? 0),
                    Stok: Number(p.stok ?? 0),
                    'Stok Minimum': Number(p.stok_minimum ?? 0),
                    Status: p.is_active ? 'Aktif' : 'Nonaktif',
                  }))
                  exportToExcel(rows, `katalog-produk-${new Date().toISOString().slice(0, 10)}.xlsx`, 'Produk')
                  pushToast({
                    title: 'Export Berhasil',
                    description: `${rows.length} produk diekspor ke Excel.`,
                    variant: 'success',
                  })
                } catch (err) {
                  pushToast({
                    title: 'Export Gagal',
                    description: err instanceof Error ? err.message : 'Terjadi kesalahan sistem',
                    variant: 'error',
                  })
                }
              }}
              className="flex items-center justify-center gap-2 rounded-[14px] bg-white px-4 py-3 font-bold text-[#2563eb] shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export Excel
            </button>

            <button
              type="button"
              onClick={() => setCategoryManagerOpen(true)}
              className="flex items-center justify-center gap-2 rounded-[14px] bg-white px-5 py-3 font-bold text-[#2563eb] shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
            >
              <span className="material-symbols-outlined text-[18px]">category</span>
              Kelola Kategori
            </button>

            <button
              type="button"
              onClick={() => { setBulkPreview([]); setBulkNilai(0); setBulkPriceOpen(true) }}
              className="flex items-center justify-center gap-2 rounded-[14px] bg-white px-5 py-3 font-bold text-[#855300] shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
            >
              <span className="material-symbols-outlined text-[18px]">trending_up</span>
              Update Harga Massal
            </button>

            <button
              type="button"
              onClick={() => {
                setSelectedProduct(null)
                setDrawerOpen(true)
              }}
              disabled={categories.length === 0}
              className="flex items-center justify-center gap-2 rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Tambah Produk
            </button>
          </div>
        </header>

        <div className="space-y-6 bg-[#f7f9f9] px-4 py-4 sm:px-6 sm:py-6">
          <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
                Manajemen Produk
              </h1>
              <p className="mt-1 text-sm font-medium text-[#8b9895]">
                Kelola katalog, harga jual, stok, dan barcode produk toko.
              </p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {statCards.map((card) => (
              <div key={card.label} className={cn('rounded-[18px] border-l-4 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]', card.color)}>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  {card.label}
                </p>
                <p className="mt-2 text-[28px] font-extrabold text-[#1b1e20]">{card.value}</p>
              </div>
            ))}
          </section>

          <section className="rounded-[20px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eef1f1] px-5 py-4">
              <h2 className="text-[18px] font-extrabold text-[#1b1e20]">Daftar Inventaris</h2>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={categoryId}
                  onChange={(event) =>
                    setCategoryId(event.target.value === 'all' ? 'all' : Number(event.target.value))
                  }
                  className="h-10 rounded-[12px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                >
                  <option value="all">Semua Kategori</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.nama}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value as ProductStatusFilter)
                    setPage(1)
                  }}
                  className="h-10 rounded-[12px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                >
                  <option value="all">Semua Status</option>
                  <option value="active">Aktif</option>
                  <option value="inactive">Nonaktif</option>
                </select>

                <select
                  value={stokFilter}
                  onChange={(event) => {
                    setStokFilter(event.target.value as typeof stokFilter)
                    setPage(1)
                  }}
                  className="h-10 rounded-[12px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                >
                  <option value="all">Semua Stok</option>
                  <option value="aman">Aman</option>
                  <option value="menipis">Menipis</option>
                  <option value="habis">Habis</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto hidden md:block">
              <table className="min-w-full">
                <thead className="bg-[#f7f9f9]">
                  <tr>
                    {[
                      ['Foto', null],
                      ['Nama & SKU', 'nama'],
                      ['Kategori', null],
                      ['Harga Beli', 'harga_beli'],
                      ['Harga Jual', 'harga_jual'],
                      ['Margin%', null],
                      ['Stok', 'stok'],
                      ['Aksi', null],
                    ].map(([label, sortKey]) => (
                      <th
                        key={label}
                        className="px-5 py-4 text-left text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#97a19f]"
                      >
                        {sortKey ? (
                          <button
                            type="button"
                            onClick={() => handleSort(sortKey as ProductSortKey)}
                            className="inline-flex items-center gap-2"
                          >
                            <span>{label}</span>
                            <span className="text-[10px] text-[#97a19f]">
                              {sortBy === sortKey ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                            </span>
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 10 }).map((_, index) => (
                        <tr key={index} className="border-t border-[#eef1f1]">
                          {Array.from({ length: 8 }).map((__, cellIndex) => (
                            <td key={cellIndex} className="px-5 py-4">
                              <Skeleton className="h-10 w-full rounded-xl" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : null}

                  {!loading && products.length > 0
                    ? products.map((product) => {
                        const hargaBeli = Number(product.harga_beli ?? 0)
                        const hargaJual = Number(product.harga_jual ?? 0)
                        const margin = hargaBeli > 0 ? ((hargaJual - hargaBeli) / hargaBeli) * 100 : 0

                        return (
                          <tr key={product.id} className="group border-t border-[#eef1f1] hover:bg-[#fbfdfd]">
                            <td className="px-5 py-4">
                              {product.foto_url ? (
                                <img src={product.foto_url} alt={product.nama ?? 'Produk'} className="h-12 w-12 rounded-[14px] object-cover" />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#eff6ff] text-[#2563eb]">
                                  <span className="material-symbols-outlined">inventory_2</span>
                                </div>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              <div>
                                <p className="font-extrabold text-[#1b1e20]">{product.nama ?? '-'}</p>
                                <p className="mt-1 text-xs text-[#8b9895]">
                                  SKU: {product.sku ?? '-'} | Barcode: {product.barcode ?? '-'}
                                </p>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-sm font-medium text-[#52627d]">
                              {product.category_nama ?? 'Tanpa kategori'}
                            </td>
                            <td className="px-5 py-4 text-sm font-bold text-[#1b1e20]">
                              {formatRupiah(hargaBeli)}
                            </td>
                            <td className="px-5 py-4 text-sm font-bold text-[#2563eb]">
                              {formatRupiah(hargaJual)}
                            </td>
                            <td className="px-5 py-4 text-sm font-bold text-[#1b1e20]">
                              {margin.toFixed(1)}%
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-[#1b1e20]">
                                  {product.stok ?? 0}
                                </span>
                                <span
                                  className={cn(
                                    'rounded-full px-3 py-1 text-[10px] font-extrabold uppercase',
                                    product.stok_status === 'habis' && 'bg-[#ffdad6] text-[#ba1a1a]',
                                    product.stok_status === 'menipis' && 'bg-[#ffddb8] text-[#855300]',
                                    product.stok_status === 'aman' && 'bg-[#dcfce7] text-[#16a34a]',
                                  )}
                                >
                                  {product.stok_status ?? 'aman'}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => handleEdit(product)}
                                  className="rounded-[12px] p-2 text-[#2563eb] hover:bg-[#eff6ff]"
                                >
                                  <span className="material-symbols-outlined text-[18px]">edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBarcodeProduct(product)
                                    setBarcodeOpen(true)
                                  }}
                                  className="rounded-[12px] p-2 text-[#a86b00] hover:bg-[#fff7ed]"
                                >
                                  <span className="material-symbols-outlined text-[18px]">barcode</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setArchiveProductTarget(product)}
                                  className="rounded-[12px] p-2 text-[#52627d] hover:bg-[#eef3f3]"
                                >
                                  <span className="material-symbols-outlined text-[18px]">visibility_off</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteProductTarget(product)}
                                  className="rounded-[12px] p-2 text-[#ba1a1a] hover:bg-[#fff1ed]"
                                >
                                  <span className="material-symbols-outlined text-[18px]">delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    : null}
                </tbody>
              </table>
            </div>

            {!loading ? (
              <div className="space-y-4 p-4 md:hidden">
                {products.length > 0 ? (
                  products.map((product) => {
                    const hargaBeli = Number(product.harga_beli ?? 0)
                    const hargaJual = Number(product.harga_jual ?? 0)
                    const margin = hargaBeli > 0 ? ((hargaJual - hargaBeli) / hargaBeli) * 100 : 0

                    return (
                      <article key={product.id} className="rounded-[18px] border border-[#eef1f1] bg-[#fbfdfd] p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
                        <div className="flex items-start gap-3">
                          {product.foto_url ? (
                            <img src={product.foto_url} alt={product.nama ?? 'Produk'} className="h-14 w-14 rounded-[14px] object-cover" />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-[#eff6ff] text-[#2563eb]">
                              <span className="material-symbols-outlined">inventory_2</span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 font-extrabold text-[#1b1e20]">{product.nama ?? '-'}</p>
                            <p className="mt-1 text-xs text-[#8b9895]">SKU: {product.sku ?? '-'}</p>
                            <p className="text-xs text-[#8b9895]">Barcode: {product.barcode ?? '-'}</p>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <p className="text-[#8b9895]">Kategori</p>
                            <p className="font-bold text-[#1b1e20]">{product.category_nama ?? 'Tanpa kategori'}</p>
                          </div>
                          <div>
                            <p className="text-[#8b9895]">Stok</p>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-[#1b1e20]">{product.stok ?? 0}</p>
                              <span
                                className={cn(
                                  'rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase',
                                  product.stok_status === 'habis' && 'bg-[#ffdad6] text-[#ba1a1a]',
                                  product.stok_status === 'menipis' && 'bg-[#ffddb8] text-[#855300]',
                                  product.stok_status === 'aman' && 'bg-[#dcfce7] text-[#16a34a]',
                                )}
                              >
                                {product.stok_status ?? 'aman'}
                              </span>
                            </div>
                          </div>
                          <div>
                            <p className="text-[#8b9895]">Harga Beli</p>
                            <p className="font-bold text-[#1b1e20]">{formatRupiah(hargaBeli)}</p>
                          </div>
                          <div>
                            <p className="text-[#8b9895]">Harga Jual</p>
                            <p className="font-bold text-[#2563eb]">{formatRupiah(hargaJual)}</p>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="text-[#8b9895]">Margin</span>
                          <span className="font-bold text-[#1b1e20]">{margin.toFixed(1)}%</span>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <button
                            type="button"
                            onClick={() => handleEdit(product)}
                            className="rounded-[12px] bg-[#eff6ff] px-3 py-2 text-xs font-bold text-[#2563eb]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBarcodeProduct(product)
                              setBarcodeOpen(true)
                            }}
                            className="rounded-[12px] bg-[#fff7ed] px-3 py-2 text-xs font-bold text-[#a86b00]"
                          >
                            Barcode
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchiveProductTarget(product)}
                            className="rounded-[12px] bg-[#eef3f3] px-3 py-2 text-xs font-bold text-[#52627d]"
                          >
                            Arsipkan
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteProductTarget(product)}
                            className="rounded-[12px] bg-[#fff1ed] px-3 py-2 text-xs font-bold text-[#ba1a1a]"
                          >
                            Hapus
                          </button>
                        </div>
                      </article>
                    )
                  })
                ) : null}
              </div>
            ) : null}

            {!loading && products.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-lg font-extrabold text-[#1b1e20]">Produk tidak ditemukan</p>
                <p className="mt-2 text-sm text-[#8b9895]">
                  Ubah filter pencarian atau tambahkan produk baru.
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-[#eef1f1] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#8b9895]">
                Menampilkan {products.length === 0 ? 0 : (page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, totalCount)} dari {totalCount} produk
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="rounded-[12px] bg-[#f1f3f5] px-4 py-2 text-sm font-bold text-[#52627d] disabled:opacity-40"
                >
                  Sebelumnya
                </button>
                <span className="rounded-[12px] bg-[#2563eb] px-3 py-2 text-sm font-bold text-white">
                  {page}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="rounded-[12px] bg-[#f1f3f5] px-4 py-2 text-sm font-bold text-[#52627d] disabled:opacity-40"
                >
                  Berikutnya
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ProductDrawer
        open={drawerOpen}
        categories={categories}
        initialProduct={selectedProduct}
        onClose={() => setDrawerOpen(false)}
        onSaved={loadProducts}
      />

      <CategoryManager
        open={categoryManagerOpen}
        categories={allCategories}
        onClose={() => setCategoryManagerOpen(false)}
        onSaved={loadProducts}
      />

      <Modal
        open={barcodeOpen}
        onClose={() => setBarcodeOpen(false)}
        size="sm"
        title={barcodeProduct?.nama ?? 'Barcode Produk'}
        description="Tampilkan barcode besar dan cetak bila diperlukan."
      >
        <div className="space-y-6">
          <div id="barcode-print-area" className="rounded-[18px] border border-[#eef1f1] bg-white p-6 text-center">
            <ProductBarcodePreview
              className="mx-auto h-[110px] w-full max-w-[320px]"
              value={barcodeProduct?.barcode || barcodeProduct?.sku || 'PRD-ZEE'}
            />
            <p className="mt-4 text-sm font-bold text-[#1b1e20]">{barcodeProduct?.nama ?? '-'}</p>
            <p className="mt-1 text-xs text-[#8b9895]">
              {barcodeProduct?.barcode || barcodeProduct?.sku || '-'}
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handlePrintBarcode}
              className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white"
            >
              Cetak Barcode
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiveProductTarget)}
        title="Arsipkan produk?"
        description={`Produk ${archiveProductTarget?.nama ?? ''} akan disembunyikan dari katalog aktif, tapi datanya tetap tersimpan.`}
        confirmLabel="Arsipkan"
        loading={archiveLoading}
        onCancel={() => setArchiveProductTarget(null)}
        onConfirm={() => void handleArchiveProduct()}
      />

      <ConfirmDialog
        open={Boolean(deleteProductTarget)}
        title="Hapus produk?"
        description={`Produk ${deleteProductTarget?.nama ?? ''} akan dihapus permanen dari katalog.`}
        confirmLabel="Hapus"
        variant="danger"
        loading={deleteLoading}
        onCancel={() => setDeleteProductTarget(null)}
        onConfirm={() => void handleDeleteProduct()}
      />

      {/* Bulk Price Update Modal */}
      <Modal
        open={bulkPriceOpen}
        onClose={() => setBulkPriceOpen(false)}
        size="lg"
        title="Update Harga Massal"
        description="Naikkan atau turunkan harga banyak produk sekaligus."
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Kategori
              </label>
              <select
                value={bulkCategoryId}
                onChange={(e) => { setBulkCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value)); setBulkPreview([]) }}
                className="h-11 w-full rounded-[12px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
              >
                <option value="all">Semua Kategori</option>
                {allCategories.filter((c) => c.is_active).map((c) => (
                  <option key={c.id} value={c.id}>{c.nama}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Jenis
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['naik', 'turun'] as const).map((j) => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => { setBulkJenis(j); setBulkPreview([]) }}
                    className={cn(
                      'h-11 rounded-[12px] text-sm font-bold',
                      bulkJenis === j
                        ? j === 'naik' ? 'bg-[#2563eb] text-white' : 'bg-[#d63f2f] text-white'
                        : 'bg-[#eef0f3] text-[#52627d]',
                    )}
                  >
                    {j === 'naik' ? '↑ Naik' : '↓ Turun'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['persen', 'nominal'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setBulkMode(m); setBulkPreview([]) }}
                    className={cn(
                      'h-11 rounded-[12px] text-sm font-bold',
                      bulkMode === m ? 'bg-[#2563eb] text-white' : 'bg-[#eef0f3] text-[#52627d]',
                    )}
                  >
                    {m === 'persen' ? 'Persentase (%)' : 'Nominal (Rp)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                Nilai {bulkMode === 'persen' ? '(%)' : '(Rp)'}
              </label>
              <input
                type="number"
                min={0.01}
                value={bulkNilai || ''}
                placeholder={bulkMode === 'persen' ? 'e.g. 15' : 'e.g. 500'}
                onChange={(e) => { setBulkNilai(Number(e.target.value)); setBulkPreview([]) }}
                className="h-11 w-full rounded-[12px] border-none bg-[#eef0f3] px-4 text-sm font-bold outline-none focus:ring-2 focus:ring-[#2563eb]/15"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={!bulkNilai || bulkNilai <= 0 || bulkPreviewLoading}
            onClick={() => void handleBulkPreview()}
            className="w-full rounded-[12px] bg-[#eef0f3] py-3 text-sm font-bold text-[#1b1e20] disabled:opacity-50"
          >
            {bulkPreviewLoading ? 'Memuat preview...' : 'Preview Perubahan'}
          </button>

          {bulkPreview.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-bold text-[#1b1e20]">
                Preview ({bulkPreview.length} produk)
              </p>
              <div className="custom-scrollbar max-h-[240px] overflow-y-auto rounded-[14px] border border-[#eef1f1]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#f7f9f9] text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#8b9895]">
                    <tr>
                      <th className="px-4 py-2 text-left">Produk</th>
                      <th className="px-4 py-2 text-right">Harga Lama</th>
                      <th className="px-4 py-2 text-right">Harga Baru</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreview.map((p) => (
                      <tr key={p.product_id} className="border-t border-[#eef1f1]">
                        <td className="px-4 py-2 font-medium text-[#1b1e20]">{p.nama}</td>
                        <td className="px-4 py-2 text-right text-[#8b9895]">
                          {formatRupiah(p.harga_lama)}
                        </td>
                        <td className={cn('px-4 py-2 text-right font-bold', bulkJenis === 'naik' ? 'text-[#2563eb]' : 'text-[#d63f2f]')}>
                          {formatRupiah(p.harga_baru)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                disabled={bulkSubmitting}
                onClick={() => void handleBulkSubmit()}
                className="w-full rounded-[14px] bg-[#2563eb] py-3 font-bold text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] disabled:opacity-50"
              >
                {bulkSubmitting ? 'Menyimpan...' : `Terapkan ke ${bulkPreview.length} Produk`}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </main>
  )
}
