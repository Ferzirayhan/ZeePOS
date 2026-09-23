import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { useAuthStore } from '../../stores/authStore'

/**
 * Nilai batas waktu ini TIDAK bermasalah dan tidak diubah. Task 1 mengukur
 * bahwa akar cacat 1.8 adalah percabangannya, bukan nilainya: pada detik ke-8,1
 * dengan `getSession` yang baru resolve di detik ke-12, `AuthProvider` sudah
 * merender rute terproteksi (`{ elapsedMs: 8100, getSessionResolvedAtMs: 12000,
 * loginShown: true, loadingScreenShown: false }`), lalu `PrivateRoute` melihat
 * `session === null` dan melempar kasir bersesi sah ke `/login`.
 *
 * Jadi kadaluwarsanya kini berarti KEGAGALAN yang bisa dicoba ulang, bukan izin
 * merender anak.
 */
const AUTH_TIMEOUT_MS = 8000

function AuthLoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-700 via-blue-600 to-blue-500 px-6 py-12">
      <div className="w-full max-w-md rounded-[2rem] bg-white/95 p-8 text-center shadow-2xl shadow-blue-950/20 backdrop-blur">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
        <h1 className="mt-6 text-2xl font-bold text-slate-900">
          Menyiapkan sesi aplikasi
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Mohon tunggu, kami sedang memeriksa autentikasi Supabase.
        </p>
      </div>
    </main>
  )
}

interface AuthFailureScreenProps {
  onRetry: () => void
  message?: string | null
}

function AuthFailureScreen({ onRetry, message }: AuthFailureScreenProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600 px-6 py-12">
      <div
        role="alert"
        className="w-full max-w-md rounded-[2rem] bg-white/95 p-8 text-center shadow-2xl shadow-slate-950/20 backdrop-blur"
      >
        <h1 className="text-2xl font-bold text-slate-900">
          Sesi belum dapat dimuat
        </h1>
        <p className="mt-3 text-sm text-slate-600">
          Server belum ngerespons pas ngecek akun lo. Sesi login lo aman kok,
          coba periksa koneksi internet lalu coba lagi ya.
        </p>
        {message ? (
          <p className="mt-3 break-words text-xs text-slate-500">{message}</p>
        ) : null}
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 w-full rounded-2xl bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
        >
          Coba Lagi
        </button>
      </div>
    </main>
  )
}

export function AuthProvider({ children }: PropsWithChildren) {
  const initialize = useAuthStore((state) => state.initialize)
  const reinitialize = useAuthStore((state) => state.reinitialize)
  const initialized = useAuthStore((state) => state.initialized)
  const error = useAuthStore((state) => state.error)
  const [attempt, setAttempt] = useState(0)
  // Batas waktu dicatat per percobaan, bukan sebagai boolean yang direset di
  // dalam effect: percobaan baru otomatis "belum kadaluwarsa".
  const [timedOutAttempt, setTimedOutAttempt] = useState(-1)
  const timedOut = timedOutAttempt === attempt

  useEffect(() => {
    // Percobaan pertama memakai `initialize()` yang idempoten; percobaan ulang
    // memakai `reinitialize()` karena `initialize()` sengaja menolak berjalan
    // dua kali (penjaga anti-langganan-ganda, klausa 3.12).
    void (attempt === 0 ? initialize() : reinitialize())

    const timer = window.setTimeout(
      () => setTimedOutAttempt(attempt),
      AUTH_TIMEOUT_MS,
    )

    return () => window.clearTimeout(timer)
  }, [attempt, initialize, reinitialize])

  // `initialized` adalah penanda "status auth sudah resolve": setiap jalur akhir
  // di `initialize` menyetelnya true, dan hanya `reinitialize` yang membukanya
  // lagi. `loading` TIDAK dipakai sebagai gerbang karena ia juga true saat
  // login, logout, dan refresh token — saat itu anak harus tetap dirender dan
  // halaman yang bersangkutan mengurus indikator prosesnya sendiri.
  if (!initialized) {
    if (timedOut) {
      return (
        <AuthFailureScreen
          onRetry={() => setAttempt((count) => count + 1)}
          message={error}
        />
      )
    }

    return <AuthLoadingScreen />
  }

  return children
}
