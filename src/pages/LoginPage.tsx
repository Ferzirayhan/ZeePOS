import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuthStore } from '../stores/authStore'
import { BrandMark } from '../components/app/BrandMark'

const loginSchema = z.object({
  email: z.string().min(1, 'Email wajib diisi').email('Format email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  remember: z.boolean().optional(),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((state) => state.login)
  const clearError = useAuthStore((state) => state.clearError)
  const loading = useAuthStore((state) => state.loading)
  const error = useAuthStore((state) => state.error)
  const session = useAuthStore((state) => state.session)
  const [showPassword, setShowPassword] = useState(false)

  const from = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null
    return state?.from?.pathname ?? '/dashboard'
  }, [location.state])

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      remember: true,
    },
  })

  useEffect(() => {
    clearError()
  }, [clearError])

  useEffect(() => {
    if (session) {
      navigate(from, { replace: true })
    }
  }, [from, navigate, session])

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values.email, values.password)
      navigate(from, { replace: true })
    } catch {
      // Error sudah ditangani di store.
    }
  }

  return (
    <main className="min-h-screen bg-[#fafbfa] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center sm:min-h-[calc(100vh-5rem)]">
        <div className="grid w-full overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/5 lg:grid-cols-[1fr_0.95fr]">
          <section className="relative hidden min-h-[640px] bg-gradient-to-br from-blue-50/80 via-white to-blue-100/50 border-r border-slate-200/80 px-10 py-10 text-[#1f2937] lg:flex lg:flex-col lg:justify-between">
            <div className="relative z-10">
              <Link to="/" className="flex items-center gap-2.5">
                <BrandMark size="md" />
                <span className="font-extrabold text-xl tracking-tight text-[#1f2937]">ZeePOS</span>
              </Link>
            </div>

            <div className="relative z-10 space-y-4">
              <span className="inline-block rounded-full bg-blue-100/80 border border-blue-200 px-3.5 py-1 text-xs font-black uppercase tracking-wider text-[#2563eb]">
                Point of Sale Cloud
              </span>
              <h1 className="font-display text-4xl sm:text-5xl font-black leading-tight tracking-tight text-[#1f2937]">
                Sistem Kasir Pintar untuk Generasi Baru.
              </h1>
              <p className="text-base leading-relaxed text-slate-600 font-medium">
                Kelola pesanan kasir, kontrol stok barang, dan monitor laba toko langsung dari browser Anda tanpa ribet.
              </p>
            </div>

            <div className="relative z-10 flex items-center justify-between border-t border-slate-200 pt-6 text-xs text-slate-500 font-medium">
              <span>Keamanan Database RLS Mandiri</span>
              <span className="text-[#2563eb] font-bold">Multi-Tenant 100%</span>
            </div>
          </section>

          <section className="flex min-h-[560px] items-center justify-center px-6 py-8 sm:px-10 sm:py-12 lg:min-h-[640px] lg:px-14">
            <div className="w-full max-w-sm">
              <div>
                <h2 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-[#1f2937]">
                  Selamat Datang
                </h2>
                <p className="mt-2 text-sm font-medium text-slate-500">
                  Masuk ke akun kasir atau pemilik toko
                </p>
              </div>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    Email Akun
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                      person
                    </span>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="Masukkan email Anda"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 pl-12 pr-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                      {...register('email')}
                    />
                  </div>
                  {errors.email ? (
                    <p className="text-xs font-semibold text-red-600">{errors.email.message}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                      Password
                    </label>
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                      lock
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Masukkan password Anda"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 pl-12 pr-14 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                      {...register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-slate-400 hover:text-slate-600"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                  {errors.password ? (
                    <p className="text-xs font-semibold text-red-600">
                      {errors.password.message}
                    </p>
                  ) : null}
                </div>

                <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-[#2563eb] focus:ring-blue-500"
                    {...register('remember')}
                  />
                  Ingat perangkat ini
                </label>

                {error ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-600">
                    Email atau password salah. Silakan coba lagi.
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3.5 font-sans text-sm font-black text-white shadow-lg shadow-blue-500/25 transition-all duration-200 hover:from-blue-700 hover:to-indigo-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{loading || isSubmitting ? 'Memproses...' : 'Masuk ke Kasir'}</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>

                <p className="text-center text-xs text-slate-500 font-medium">
                  Belum punya toko?{' '}
                  <Link to="/register" className="font-bold text-blue-600 hover:underline">
                    Daftar Toko Gratis
                  </Link>
                </p>
              </form>

            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
