import type { CartItem as CartItemType } from '../../types'
import { formatRupiah } from '../../utils/currency'

interface CartItemProps {
  item: CartItemType
  onDecrease: () => void
  onIncrease: () => void
  onRemove: () => void
  onSetQty: (qty: number) => void
  onOpenNumpad?: () => void
}

export function CartItem({ item, onDecrease, onIncrease, onRemove, onSetQty, onOpenNumpad }: CartItemProps) {
  return (
    <div className="flex gap-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm transition-all hover:border-slate-300">
      {item.foto_url ? (
        <img
          src={item.foto_url}
          alt={item.nama_produk}
          className="h-14 w-14 rounded-xl object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <span className="material-symbols-outlined text-[24px]">shopping_bag</span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-1 text-xs sm:text-sm font-extrabold text-slate-900">
              {item.nama_produk}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <p className="text-xs font-bold text-slate-500">
                {formatRupiah(item.harga_satuan)}
              </p>
              {item.diskon_item_persen > 0 && (
                <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[9px] font-black text-blue-600">
                  Diskon {item.diskon_item_persen}%
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Hapus item"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center rounded-xl bg-slate-100/90 p-0.5 border border-slate-200/60">
            <button
              type="button"
              onClick={onDecrease}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-xs transition-all hover:bg-blue-600 hover:text-white active:scale-95"
            >
              <span className="material-symbols-outlined text-[16px]">remove</span>
            </button>
            <input
              type="number"
              step="0.01"
              min={0.01}
              value={item.qty}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                if (!isNaN(val) && val > 0) {
                  onSetQty(val)
                }
              }}
              className="w-12 bg-transparent text-center text-xs font-black text-slate-900 outline-none"
            />
            <span className="mr-1 text-[9px] font-black text-slate-400 uppercase">{item.satuan}</span>
            <button
              type="button"
              onClick={onIncrease}
              disabled={item.qty >= item.stok_tersedia}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-blue-600 shadow-xs transition-all hover:bg-blue-600 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
            </button>
            {onOpenNumpad && (
              <button
                type="button"
                onClick={onOpenNumpad}
                title="Buka Tombol Numpad"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white hover:text-blue-600"
              >
                <span className="material-symbols-outlined text-[16px]">dialpad</span>
              </button>
            )}
          </div>

          <p className="text-xs sm:text-sm font-black text-slate-900">{formatRupiah(item.subtotal)}</p>
        </div>

        {(item.satuan === 'kg' || item.satuan === 'liter' || item.satuan === 'pack') && (
          <div className="mt-2 flex items-center gap-1">
            {[0.25, 0.5, 0.75].map((fraction) => (
              <button
                key={fraction}
                type="button"
                onClick={() => onSetQty(fraction)}
                className="rounded-md bg-blue-50 px-2 py-0.5 text-[9px] font-black text-blue-600 border border-blue-100 transition-all hover:bg-blue-600 hover:text-white"
                disabled={fraction > item.stok_tersedia}
              >
                {fraction}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
