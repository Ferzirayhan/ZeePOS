import { useCallback, useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'

interface NumpadModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (val: number) => void
  title: string
  initialValue?: number
  isCurrency?: boolean
  minValue?: number
  maxValue?: number
  quickOptions?: number[]
  /**
   * Jumlah desimal yang diizinkan. Default 0 = numpad bilangan bulat, yaitu
   * perilaku sebelum presisi desimal ditambahkan (Property 17: jalur qty bulat
   * dan seluruh call site rupiah tidak boleh berubah sedikit pun).
   * Untuk baris bersatuan pecahan, pakai `getQtyDecimals(satuan)` dari
   * `src/lib/units.ts` — plafonnya terikat pada `transaction_items.qty NUMERIC(12,3)`.
   */
  decimalPlaces?: number
  /**
   * Satuan kenaikan terkecil yang dimaksud call site (mis. `0.01`). Disediakan
   * agar call site dapat mendeklarasikannya bersama `minValue`; presisi input
   * itu sendiri dikendalikan `decimalPlaces`.
   */
  step?: number
}

/** Bentuk internal `valueStr` memakai titik sebagai separator desimal agar
 *  parsing tidak bergantung locale; tampilan baru diformat ke id-ID. */
const INTERNAL_SEPARATOR = '.'

/** Membulatkan ke `decimals` desimal tanpa menyeret galat float (0.145 dst). */
function roundTo(value: number, decimals: number): number {
  if (decimals <= 0) return value
  return Number(value.toFixed(decimals))
}

/**
 * Normalisasi nilai awal ke bentuk minimal: `0.250` → `"0.25"`, `3` → `"3"`.
 * Pada `decimals = 0` string dibentuk persis seperti sebelumnya agar jalur
 * bilangan bulat tidak berubah.
 */
function normalizeInitialValue(value: number, decimals: number): string {
  if (decimals <= 0) return String(value || '0')
  if (!Number.isFinite(value) || value === 0) return '0'
  const fixed = value.toFixed(decimals)
  if (!fixed.includes('.')) return fixed
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '')
  return trimmed === '' ? '0' : trimmed
}

function NumpadContent({
  title,
  initialValue = 0,
  isCurrency = false,
  minValue = 0,
  maxValue = 999999999,
  quickOptions,
  decimalPlaces = 0,
  onConfirm,
  onClose,
}: Omit<NumpadModalProps, 'isOpen'>) {
  const allowsDecimal = decimalPlaces > 0
  const [valueStr, setValueStr] = useState<string>(() =>
    normalizeInitialValue(initialValue, decimalPlaces),
  )
  const hasSeparator = valueStr.includes(INTERNAL_SEPARATOR)

  const handleDigit = useCallback(
    (digit: string) => {
      setValueStr((prev) => {
        const sepIndex = prev.indexOf(INTERNAL_SEPARATOR)
        if (sepIndex >= 0) {
          // Presisi baris sudah penuh → digit diabaikan. Inilah yang mencegah
          // 0,25 menjadi 0,255 pada baris berpresisi 2 desimal.
          if (prev.length - sepIndex - 1 >= decimalPlaces) return prev
          const next = prev + digit
          if (Number(next) > maxValue) return prev
          return next
        }
        if (prev === '0') return digit
        const next = prev + digit
        if (Number(next) > maxValue) return prev
        return next
      })
    },
    [decimalPlaces, maxValue],
  )

  const handleSeparator = useCallback(() => {
    if (!allowsDecimal) return
    setValueStr((prev) =>
      prev.includes(INTERNAL_SEPARATOR) ? prev : (prev === '' ? '0' : prev) + INTERNAL_SEPARATOR,
    )
  }, [allowsDecimal])

  const handleBackspace = useCallback(() => {
    setValueStr((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'))
  }, [])

  const handleClear = useCallback(() => {
    setValueStr('0')
  }, [])

  const handleConfirm = useCallback(() => {
    // Dibulatkan lebih dulu, baru dibandingkan dengan batas, supaya nilai yang
    // sah tidak ditolak karena galat representasi float.
    const num = roundTo(Number(valueStr) || 0, decimalPlaces)
    if (num >= minValue && num <= maxValue) {
      onConfirm(num)
      onClose()
    }
  }, [valueStr, decimalPlaces, minValue, maxValue, onConfirm, onClose])

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key)
      } else if (e.key === ',' || e.key === '.') {
        // Keyboard Indonesia memakai koma, numpad fisik mengirim titik.
        if (allowsDecimal) {
          e.preventDefault()
          handleSeparator()
        }
      } else if (e.key === 'Backspace') {
        handleBackspace()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key.toLowerCase() === 'c') {
        handleClear()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    allowsDecimal,
    handleDigit,
    handleSeparator,
    handleBackspace,
    handleConfirm,
    handleClear,
    onClose,
  ])

  const displayFormatted = () => {
    if (!allowsDecimal) {
      const n = Number(valueStr) || 0
      return isCurrency ? 'Rp ' + n.toLocaleString('id-ID') : n.toLocaleString('id-ID')
    }

    // Bagian desimal ditampilkan apa adanya (termasuk separator yang baru
    // ditekan dan nol yang sedang diketik), bagian bulat memakai pemisah ribuan
    // id-ID. Nilai utuh tetap dibatasi `maximumFractionDigits: decimalPlaces`.
    const sepIndex = valueStr.indexOf(INTERNAL_SEPARATOR)
    const intPart = sepIndex >= 0 ? valueStr.slice(0, sepIndex) : valueStr
    const fracPart = sepIndex >= 0 ? valueStr.slice(sepIndex + 1, sepIndex + 1 + decimalPlaces) : null
    const intText = (Number(intPart) || 0).toLocaleString('id-ID', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
    const text = fracPart === null ? intText : intText + ',' + fracPart
    return isCurrency ? 'Rp ' + text : text
  }

  return (
    <>
      <div className="bg-[#f8f9fa] p-5 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-display font-black text-slate-800 text-base">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-xl bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 transition"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>

      <div className="p-6 bg-white space-y-4">
        {/* Display Nilai Layar Numpad */}
        <div className="rounded-2xl bg-slate-100 p-4 border border-slate-200 text-right">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Input Nilai</p>
          <p className="font-display text-3xl sm:text-4xl font-black text-[#1f2937] tracking-tight truncate">
            {displayFormatted()}
          </p>
        </div>

        {/* Quick Options jika ada */}
        {quickOptions && quickOptions.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {quickOptions.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setValueStr(normalizeInitialValue(opt, decimalPlaces))}
                className="py-2 px-1 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 hover:bg-[#eff6ff] hover:border-[#2563eb] hover:text-[#2563eb] transition"
              >
                {isCurrency
                  ? `+${opt / 1000}rb`
                  : allowsDecimal
                    ? opt.toLocaleString('id-ID', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: decimalPlaces,
                      })
                    : `${opt}`}
              </button>
            ))}
          </div>
        )}

        {/* Numpad Grid */}
        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => handleDigit(digit)}
              className="h-14 rounded-2xl border border-slate-200 bg-slate-50 font-display text-2xl font-black text-slate-800 hover:bg-slate-100 active:scale-95 transition"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={handleClear}
            className="h-14 rounded-2xl border border-amber-200 bg-amber-50 font-display text-lg font-black text-amber-700 hover:bg-amber-100 active:scale-95 transition"
          >
            C
          </button>
          <button
            type="button"
            onClick={() => handleDigit('0')}
            className="h-14 rounded-2xl border border-slate-200 bg-slate-50 font-display text-2xl font-black text-slate-800 hover:bg-slate-100 active:scale-95 transition"
          >
            0
          </button>
          <button
            type="button"
            onClick={handleBackspace}
            className="h-14 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-600 hover:bg-slate-100 active:scale-95 transition"
          >
            <span className="material-symbols-outlined text-2xl">backspace</span>
          </button>
          {/* Separator desimal hanya untuk baris bersatuan pecahan (kg, gram,
              meter, liter). Tanpa tombol ini, 0,25 kg tidak dapat diketik sama sekali. */}
          {allowsDecimal && (
            <button
              type="button"
              onClick={handleSeparator}
              disabled={hasSeparator}
              aria-label=","
              title="Separator desimal"
              className="col-span-3 h-14 rounded-2xl border border-slate-200 bg-slate-50 font-display text-2xl font-black text-slate-800 hover:bg-slate-100 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              ,
            </button>
          )}
        </div>

        {/* Action Button */}
        <div className="pt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 rounded-2xl border border-slate-200 bg-white font-display text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-[2] py-4 rounded-2xl bg-[#2563eb] hover:bg-[#1d4ed8] font-display text-sm font-black text-white shadow-lg shadow-blue-500/25 active:scale-[0.98] transition flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-xl">check</span>
            <span>Konfirmasi</span>
          </button>
        </div>
      </div>
    </>
  )
}

export function NumpadModal({ isOpen, onClose, ...props }: NumpadModalProps) {
  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      {isOpen && <NumpadContent onClose={onClose} {...props} />}
    </Modal>
  )
}
