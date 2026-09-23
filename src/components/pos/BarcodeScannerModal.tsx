import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Modal } from '../ui/Modal'

// Konstan modul, bukan variabel komponen: dipakai di dalam effect kamera yang
// dependency-nya sengaja hanya [isOpen].
const CAMERA_ELEMENT_ID = 'zeepos-camera-stream'

interface BarcodeScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScanSuccess: (decodedText: string) => void
}

export function BarcodeScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
}: BarcodeScannerModalProps) {
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [isStarting, setIsStarting] = useState<boolean>(true)
  const scannerRef = useRef<Html5Qrcode | null>(null)

  // Identitas callback tidak boleh ikut menentukan hidup-matinya kamera.
  // POSPage meneruskan arrow function inline, jadi setiap re-render induk
  // (keranjang berubah, toast, event realtime) menghasilkan prop baru. Ketika
  // prop itu masuk dependency array effect kamera, effect ter-cleanup lalu
  // dijalankan ulang: stop() → instance baru → start(), dan pemindaian yang
  // sedang berjalan hilang. Callback disimpan di ref yang disinkronkan effect
  // terpisah agar effect kamera cukup bergantung pada [isOpen].
  const onCloseRef = useRef(onClose)
  const onScanSuccessRef = useRef(onScanSuccess)

  useEffect(() => {
    onCloseRef.current = onClose
    onScanSuccessRef.current = onScanSuccess
  }, [onClose, onScanSuccess])

  useEffect(() => {
    let isMounted = true

    if (!isOpen) {
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .catch(() => {})
          .finally(() => {
            scannerRef.current = null
          })
      }
      return
    }

    const initScanner = async () => {
      setIsStarting(true)
      setErrorMessage('')
      try {
        const scanner = new Html5Qrcode(CAMERA_ELEMENT_ID)
        scannerRef.current = scanner

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (isMounted) {
              scanner
                .stop()
                .catch(() => {})
                .finally(() => {
                  scannerRef.current = null
                  onScanSuccessRef.current(decodedText)
                  onCloseRef.current()
                })
            }
          },
          () => {
            // Frame scan loop - silent ignore
          },
        )

        if (isMounted) {
          setIsStarting(false)
        }
      } catch (err) {
        if (isMounted) {
          setIsStarting(false)
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Kamera tidak dapat diakses. Coba izinin akses kamera di browser lo dulu ya.',
          )
        }
      }
    }

    // Delay sedikit agar DOM modal siap
    const timer = setTimeout(() => {
      void initScanner()
    }, 150)

    return () => {
      isMounted = false
      clearTimeout(timer)
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {}).finally(() => {
          scannerRef.current = null
        })
      }
    }
  }, [isOpen])

  return (
    <Modal open={isOpen} onClose={onClose} size="sm">
      <div className="bg-[#f8f9fa] p-5 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="material-symbols-outlined text-[#2563eb] text-2xl">photo_camera</span>
          <div>
            <h3 className="font-display font-black text-slate-800 text-base">Scan Barcode Kamera</h3>
            <p className="text-xs text-slate-500">Arahkan kamera ke barcode produk</p>
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

      <div className="p-6 bg-white space-y-4">
        <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3] flex items-center justify-center border-2 border-slate-200">
          <div id={CAMERA_ELEMENT_ID} className="w-full h-full" />
          {isStarting && (
            <div className="absolute inset-0 bg-slate-900/80 flex flex-col items-center justify-center text-white space-y-2">
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span className="text-xs font-bold">Menyiapkan kamera...</span>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 text-xs text-[#dc2626] font-medium flex items-center gap-2">
            <span className="material-symbols-outlined text-lg shrink-0">error</span>
            <span>{errorMessage}</span>
          </div>
        )}

        <p className="text-center text-xs text-slate-400">
          Atau gunakan scanner barcode USB / ketik barcode di kolom pencarian.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl border border-slate-200 bg-slate-50 font-display text-sm font-bold text-slate-600 hover:bg-slate-100 transition"
        >
          Tutup Scanner
        </button>
      </div>
    </Modal>
  )
}
