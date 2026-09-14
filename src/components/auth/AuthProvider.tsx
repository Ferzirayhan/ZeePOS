import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { useAuthStore } from '../../stores/authStore'

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

export function AuthProvider({ children }: PropsWithChildren) {
  const initialize = useAuthStore((state) => state.initialize)
  const initialized = useAuthStore((state) => state.initialized)
  const loading = useAuthStore((state) => state.loading)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    void initialize()
    const timer = window.setTimeout(() => setTimedOut(true), AUTH_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [initialize])

  if (!timedOut && (!initialized || loading)) {
    return <AuthLoadingScreen />
  }

  return children
}
