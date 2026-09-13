import type { ProductWithCategory } from '../../types/database'
import { formatRupiah } from '../../utils/currency'
import { cn } from '../../utils/cn'

interface ProductCardProps {
  product: ProductWithCategory
  onAdd: (product: ProductWithCategory) => void
  variantSatuans?: string[]
}

export function ProductCard({ product, onAdd, variantSatuans }: ProductCardProps) {
  const stok = Number(product.stok ?? 0)
  const stokMinimum = Number(product.stok_minimum ?? 0)
  const isOutOfStock = stok <= 0
  const isLowStock = stok > 0 && stok <= stokMinimum

  const effectivePrice = (product.diskon_produk_persen ?? 0) > 0
    ? Math.round(Number(product.harga_jual ?? 0) * (1 - (product.diskon_produk_persen ?? 0) / 100))
    : Number(product.harga_jual ?? 0)

  return (
    <button
      type="button"
      disabled={isOutOfStock}
      onClick={() => onAdd(product)}
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-3 text-left shadow-sm transition-all duration-200 select-none',
        isOutOfStock
          ? 'cursor-not-allowed opacity-60 bg-slate-50/50'
          : 'hover:-translate-y-1 hover:border-blue-300 hover:shadow-xl hover:shadow-blue-500/10 active:scale-[0.98]',
      )}
    >
      <div>
        <div className="relative overflow-hidden rounded-2xl bg-slate-100">
          {product.foto_url ? (
            <img
              src={product.foto_url}
              alt={product.nama ?? 'Produk'}
              className="h-28 w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-28 w-full items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-600 to-blue-700 text-white shadow-inner">
              <span className="material-symbols-outlined text-[36px] text-white/90 transition-transform duration-300 group-hover:scale-110">
                package_2
              </span>
            </div>
          )}

          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider shadow-sm backdrop-blur-md',
                isOutOfStock
                  ? 'bg-red-500/90 text-white'
                  : isLowStock
                    ? 'bg-amber-500/90 text-white'
                    : 'bg-emerald-500/90 text-white',
              )}
            >
              {isOutOfStock ? 'Habis' : `Stok: ${stok}`}
            </span>
          </div>

          {(product.diskon_produk_persen ?? 0) > 0 ? (
            <span className="absolute right-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
              -{product.diskon_produk_persen}%
            </span>
          ) : null}

          {!isOutOfStock ? (
            <div className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white opacity-0 shadow-md transition-all duration-200 group-hover:opacity-100 group-hover:scale-100 scale-90">
              <span className="material-symbols-outlined text-[20px]">add</span>
            </div>
          ) : null}
        </div>

        <div className="mt-2.5">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
            {product.category_nama ?? 'Umum'} • {product.satuan ?? 'pcs'}
          </p>

          <h3 className="mt-0.5 line-clamp-2 min-h-[38px] text-xs sm:text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors">
            {product.nama ?? 'Produk'}
          </h3>

          {variantSatuans && variantSatuans.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-black text-blue-600 border border-blue-100">
                {product.satuan}
              </span>
              {variantSatuans.map((s) => (
                <span key={s} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 border-t border-slate-100 pt-2 flex items-baseline justify-between">
        <div>
          {(product.diskon_produk_persen ?? 0) > 0 ? (
            <span className="mr-1.5 text-[11px] font-bold text-slate-400 line-through">
              {formatRupiah(Number(product.harga_jual ?? 0))}
            </span>
          ) : null}
          <span
            className={cn(
              'text-sm sm:text-base font-black tracking-tight',
              (product.diskon_produk_persen ?? 0) > 0 ? 'text-red-600' : 'text-blue-600',
            )}
          >
            {formatRupiah(effectivePrice)}
          </span>
        </div>
      </div>
    </button>
  )
}
