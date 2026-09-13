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
}

function NumpadContent({
  title,
  initialValue = 0,
  isCurrency = false,
  minValue = 0,
  maxValue = 999999999,
  quickOptions,
  onConfirm,
  onClose,
}: Omit<NumpadModalProps, 'isOpen'>) {
  const [valueStr, setValueStr] = useState<string>(String(initialValue || '0'))

  const handleDigit = useCallback(
    (digit: string) => {
      setValueStr((prev) => {
        if (prev === '0') return digit
        const next = prev + digit
        if (Number(next) > maxValue) return prev
        return next
      })
    },
    [maxValue],
  )

  const handleBackspace = useCallback(() => {
    setValueStr((prev) => (prev.length > 1 ? prev.slice(0, -1) : '0'))
  }, [])

  const handleClear = useCallback(() => {
    setValueStr('0')
  }, [])

  const handleConfirm = useCallback(() => {
    const num = Number(valueStr) || 0
    if (num >= minValue && num <= maxValue) {
      onConfirm(num)
      onClose()
    }
  }, [valueStr, minValue, maxValue, onConfirm, onClose])

  // Keyboard support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleDigit(e.key)
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
  }, [handleDigit, handleBackspace, handleConfirm, handleClear, onClose])

  const displayFormatted = () => {
    const n = Number(valueStr) || 0
    if (isCurrency) {
      return 'Rp ' + n.toLocaleString('id-ID')
    }
    return n.toLocaleString('id-ID')
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
                onClick={() => setValueStr(String(opt))}
                className="py-2 px-1 rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold text-slate-700 hover:bg-[#eff6ff] hover:border-[#2563eb] hover:text-[#2563eb] transition"
              >
                {isCurrency ? `+${opt / 1000}rb` : `${opt}`}
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
