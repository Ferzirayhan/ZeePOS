import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../ui/Modal'
import { cn } from '../../utils/cn'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  total: number
  subtotal: number
  diskonAmount: number
  ppnAmount: number
  metodeBayar: string
  onSelectMetode: (m: 'tunai' | 'transfer' | 'qris' | 'hutang') => void
  uangDiterima: number
  onUangDiterimaChange: (val: number) => void
  kembalian: number
  onConfirmPayment: () => void
  isProcessing: boolean
  settings: Record<string, string>
  customerName?: string | null
}

export function PaymentModal({
  isOpen,
  onClose,
  total,
  subtotal,
  diskonAmount,
  ppnAmount,
  metodeBayar,
  onSelectMetode,
  uangDiterima,
  onUangDiterimaChange,
  kembalian,
  onConfirmPayment,
  isProcessing,
  settings,
  customerName,
}: PaymentModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const activeMethods = useMemo(() => {
    const list = [
      { id: 'tunai' as const, label: 'Tunai', icon: 'payments' },
      { id: 'qris' as const, label: 'QRIS', icon: 'qr_code_2' },
      { id: 'transfer' as const, label: 'Transfer', icon: 'account_balance' },
    ]
    if (customerName) {
      return [...list, { id: 'hutang' as const, label: 'Bon / Tempo', icon: 'receipt_long' }]
    }
    return list
  }, [customerName])

  useEffect(() => {
    if (isOpen && metodeBayar === 'tunai') {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen, metodeBayar])

  // Hitung pecahan cepat dinamis ala Moka POS
  const quickCashOptions = useMemo(() => {
    if (total <= 0) return []
    const list: number[] = [total] // Uang Pas

    // 10k ceiling
    const next10k = Math.ceil(total / 10000) * 10000
    if (next10k > total && !list.includes(next10k)) list.push(next10k)

    // 20k / 50k ceiling
    const next50k = Math.ceil(total / 50000) * 50000
    if (next50k > total && !list.includes(next50k)) list.push(next50k)

    // 100k ceiling
    const next100k = Math.ceil(total / 100000) * 100000
    if (next100k > total && !list.includes(next100k)) list.push(next100k)

    // Extra denominations if needed
    if (list.length < 4) {
      const nextHigh = (Math.ceil(total / 100000) + 1) * 100000
      if (!list.includes(nextHigh)) list.push(nextHigh)
    }

    return list.slice(0, 4)
  }, [total])

  // URL QRIS yang gagal dimuat. Error menempel pada URL (bukan boolean global):
  // ganti URL, buka ulang modal, atau pindah metode otomatis memberi kesempatan
  // mencoba ulang tanpa perlu reload halaman.
  const [failedQrisUrl, setFailedQrisUrl] = useState<string | null>(null)
  const [lastSeenUrl, setLastSeenUrl] = useState(settings.payment_qris_image_url)
  const [lastSeenOpen, setLastSeenOpen] = useState(isOpen)
  const [lastSeenMetode, setLastSeenMetode] = useState(metodeBayar)
  if (
    lastSeenUrl !== settings.payment_qris_image_url ||
    lastSeenOpen !== isOpen ||
    lastSeenMetode !== metodeBayar
  ) {
    setLastSeenUrl(settings.payment_qris_image_url)
    setLastSeenOpen(isOpen)
    setLastSeenMetode(metodeBayar)
    setFailedQrisUrl(null)
  }
  const qrisImageError = failedQrisUrl !== null && failedQrisUrl === settings.payment_qris_image_url

  const isCashInsufficient = metodeBayar === 'tunai' && uangDiterima < total
  const isTransferMissingConfig =
    metodeBayar === 'transfer' &&
    (!settings.payment_transfer_bank?.trim() ||
      !settings.payment_transfer_account_number?.trim() ||
      !settings.payment_transfer_account_name?.trim())
  const isQrisMissingConfig =
    metodeBayar === 'qris' && (!settings.payment_qris_image_url?.trim() || qrisImageError)
  const isPaymentDisabled =
    isProcessing || isCashInsufficient || isTransferMissingConfig || isQrisMissingConfig

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === ' ' && metodeBayar === 'tunai') {
      e.preventDefault()
      onUangDiterimaChange(total)
    } else if (e.key === 'Enter' && !isPaymentDisabled) {
      e.preventDefault()
      onConfirmPayment()
    }
  }

  const displayUang = uangDiterima > 0 ? new Intl.NumberFormat('id-ID').format(uangDiterima) : ''

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="sm"
    >
      <div className="bg-[#f8f9fa] p-6 border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">Total Tagihan</span>
            <div className="mt-1 font-display text-3xl sm:text-4xl font-black text-[#2563eb]">
              Rp {total.toLocaleString('id-ID')}
            </div>
          </div>
          <div className="text-right text-xs text-slate-500 font-medium">
            <p>Subtotal: Rp {subtotal.toLocaleString('id-ID')}</p>
            {diskonAmount > 0 && <p className="text-[#16a34a]">Diskon: -Rp {diskonAmount.toLocaleString('id-ID')}</p>}
            {ppnAmount > 0 && <p>PPN: +Rp {ppnAmount.toLocaleString('id-ID')}</p>}
          </div>
        </div>

        {/* Tab Metode Pembayaran ala Moka POS */}
        <div
          className={cn(
            'mt-6 grid gap-2 bg-slate-200/80 p-1 rounded-2xl',
            activeMethods.length === 4 ? 'grid-cols-4' : 'grid-cols-3',
          )}
        >
          {activeMethods.map((m) => {
            const active = metodeBayar === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectMetode(m.id)}
                className={cn(
                  'flex flex-col sm:flex-row items-center justify-center gap-1.5 py-3 px-2 rounded-xl text-xs font-black transition-all duration-200 active:scale-95',
                  active
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/80',
                )}
              >
                <span className="material-symbols-outlined text-lg">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-6 bg-white space-y-6" onKeyDown={handleKeyDown}>
        {/* Konten Tab Tunai */}
        {metodeBayar === 'tunai' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-500">
                Uang Diterima dari Pelanggan
              </label>
              <div className="relative mt-2">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-display text-xl font-black text-slate-400">
                  Rp
                </span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  value={displayUang}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, '')
                    const num = raw ? parseInt(raw, 10) : 0
                    onUangDiterimaChange(num)
                  }}
                  placeholder="0"
                  className="w-full h-16 pl-14 pr-4 rounded-2xl border-2 border-slate-200 bg-slate-50 font-display text-2xl sm:text-3xl font-black text-slate-900 outline-none transition focus:border-blue-600 focus:bg-white shadow-sm"
                />
              </div>
            </div>

            {/* Quick Cash Buttons */}
            <div>
              <span className="text-[11px] font-bold text-slate-400">Pecahan Cepat</span>
              <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {quickCashOptions.map((amount, idx) => (
                  <button
                    key={`${amount}-${idx}`}
                    type="button"
                    onClick={() => {
                      onUangDiterimaChange(amount)
                    }}
                    className={cn(
                      'py-2.5 px-3 rounded-xl border text-xs font-black transition-all active:scale-95',
                      uangDiterima === amount
                        ? 'border-blue-600 bg-blue-50 text-blue-600 shadow-sm'
                        : 'border-slate-200/80 bg-slate-50 text-slate-700 hover:bg-slate-100',
                    )}
                  >
                    {idx === 0 ? 'Uang Pas' : `Rp ${amount.toLocaleString('id-ID')}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Kotak Kembalian */}
            <div
              className={cn(
                'rounded-2xl p-4 flex items-center justify-between border transition-all duration-200 shadow-sm',
                isCashInsufficient
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700',
              )}
            >
              <div>
                <p className="text-xs font-black uppercase tracking-wider">
                  {isCashInsufficient ? 'Uang Kurang' : 'Uang Kembalian'}
                </p>
                <p className="text-[11px] opacity-80 mt-0.5 font-medium">
                  {isCashInsufficient
                    ? `Kurang Rp ${(total - uangDiterima).toLocaleString('id-ID')}`
                    : 'Kembalikan ke pelanggan'}
                </p>
              </div>
              <div className="font-display text-2xl sm:text-3xl font-black">
                Rp {Math.max(0, kembalian).toLocaleString('id-ID')}
              </div>
            </div>
          </div>
        )}

        {/* Konten Tab QRIS */}
        {metodeBayar === 'qris' && (
          <div className="space-y-4 text-center py-2">
            {settings.payment_qris_image_url && !qrisImageError ? (
              <div className="mx-auto w-48 h-48 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center p-2 shadow-sm">
                <img
                  src={settings.payment_qris_image_url}
                  alt="QRIS Toko"
                  onError={() => setFailedQrisUrl(settings.payment_qris_image_url ?? null)}
                  className="w-full h-full object-contain rounded-xl"
                />
              </div>
            ) : (
              <div className="mx-auto w-52 h-44 bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center p-4">
                <span className="material-symbols-outlined text-4xl text-slate-400">qr_code_2</span>
                <p className="text-xs font-bold text-slate-700 mt-2">
                  {qrisImageError ? 'Gambar QRIS Gagal Dimuat' : 'QRIS Belum Dikonfigurasi'}
                </p>
                <p className="text-[10px] text-slate-400 mt-1 max-w-[180px]">
                  {qrisImageError
                    ? 'Format atau host gambar QRIS diblokir kebijakan keamanan. Hubungi admin.'
                    : 'Admin belum mengunggah gambar QRIS di menu Pengaturan Toko.'}
                </p>
              </div>
            )}
            <div className="bg-blue-50 border border-blue-200/80 rounded-2xl p-3.5 text-xs text-blue-900 font-medium text-left">
              <p className="font-bold">Konfirmasi Penerimaan QRIS</p>
              <p className="text-[11px] text-blue-700 mt-0.5">
                Pastikan dana sudah masuk di notifikasi merchant Anda sebelum menekan tombol Simpan.
              </p>
            </div>
          </div>
        )}

        {/* Konten Tab Transfer Bank */}
        {metodeBayar === 'transfer' && (
          <div className="space-y-4 py-2">
            {!isTransferMissingConfig ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Rekening Tujuan</span>
                <p className="font-display text-lg font-black text-slate-900">
                  {settings.payment_transfer_bank} • {settings.payment_transfer_account_number}
                </p>
                <p className="text-xs text-slate-600 font-medium">
                  a.n. {settings.payment_transfer_account_name}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/60 p-4 text-center space-y-1.5">
                <span className="material-symbols-outlined text-3xl text-amber-500">account_balance</span>
                <p className="text-xs font-bold text-amber-900">Rekening Bank Belum Lengkap</p>
                <p className="text-[11px] text-amber-700 max-w-[260px] mx-auto">
                  Nama bank, nomor rekening, dan nama pemilik wajib dikonfigurasi oleh admin di menu Pengaturan Toko.
                </p>
              </div>
            )}
            <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3.5 text-xs text-amber-900 font-medium">
              <p className="font-bold">Cek Mutasi Rekening</p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Verifikasi mutasi masuk sebesar <b>Rp {total.toLocaleString('id-ID')}</b> sebelum menyelesaikan transaksi.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="pt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 py-3.5 rounded-2xl border border-slate-200 bg-white font-sans text-sm font-bold text-slate-600 hover:bg-slate-50 transition active:scale-95"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirmPayment}
            disabled={isPaymentDisabled}
            className={cn(
              'flex-[2] py-3.5 rounded-2xl font-sans text-sm sm:text-base font-black text-white transition-all flex items-center justify-center gap-2 shadow-lg active:scale-[0.98]',
              isPaymentDisabled
                ? 'bg-slate-300 cursor-not-allowed shadow-none'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/25',
            )}
          >
            {isProcessing ? (
              <>
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Memproses...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-xl">check_circle</span>
                <span>SELESAIKAN PEMBAYARAN</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
