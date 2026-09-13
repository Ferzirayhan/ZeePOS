import { Modal } from '../ui/Modal'
import { useHeldCartStore, type HeldCart } from '../../stores/heldCartStore'

interface HeldTransactionsModalProps {
  isOpen: boolean
  onClose: () => void
  onResume: (cart: HeldCart) => void
}

export function HeldTransactionsModal({
  isOpen,
  onClose,
  onResume,
}: HeldTransactionsModalProps) {
  const heldCarts = useHeldCartStore((state) => state.heldCarts)
  const deleteHeldCart = useHeldCartStore((state) => state.deleteHeldCart)

  return (
    <Modal open={isOpen} onClose={onClose} size="md">
      <div className="bg-[#f8f9fa] p-5 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm">
            {heldCarts.length}
          </div>
          <div>
            <h3 className="font-display font-black text-slate-800 text-base">Pesanan Ditahan</h3>
            <p className="text-xs text-slate-500">Daftar transaksi yang diparkir sementara</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-xl bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 transition"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="p-6 bg-white space-y-3 max-h-[60vh] overflow-y-auto">
        {heldCarts.length === 0 ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <span className="material-symbols-outlined text-5xl text-slate-300">hourglass_empty</span>
            <p className="text-sm font-medium">Tidak ada transaksi yang sedang ditahan.</p>
            <p className="text-xs text-slate-400">Gunakan tombol "Tahan" di kasir saat pelanggan ingin menambah belanjaan.</p>
          </div>
        ) : (
          heldCarts.map((held) => {
            const itemCount = held.items.reduce((sum, item) => sum + item.qty, 0)
            const dateStr = new Date(held.created_at).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <div
                key={held.id}
                className="p-4 rounded-2xl border border-slate-200 bg-slate-50 hover:bg-[#eff6ff] hover:border-[#2563eb]/40 transition flex items-center justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm font-black text-slate-800 truncate">
                      {held.label}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">
                      {dateStr}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {itemCount} item ({held.items.map((i) => i.nama_produk).join(', ')})
                  </p>
                  <p className="font-display text-base font-black text-[#2563eb] mt-1">
                    Rp {held.total.toLocaleString('id-ID')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      onResume(held)
                      onClose()
                    }}
                    className="px-3.5 py-2.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-black transition flex items-center gap-1.5 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-base">play_arrow</span>
                    <span>Lanjutkan</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteHeldCart(held.id)}
                    className="w-9 h-9 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-300 text-slate-400 hover:text-[#dc2626] transition flex items-center justify-center"
                    title="Hapus Transaksi Ditahan"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
        >
          Tutup
        </button>
      </div>
    </Modal>
  )
}
