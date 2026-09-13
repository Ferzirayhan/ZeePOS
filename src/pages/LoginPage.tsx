import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { BrandMark } from '../components/app/BrandMark'
import { useAuthStore } from '../stores/authStore'

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
    <main className="min-h-screen bg-[linear-gradient(135deg,_#f8fbfb_0%,_#eef5f4_55%,_#f7faf9_100%)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-5xl items-center justify-center sm:min-h-[calc(100vh-5rem)]">
        <div className="grid w-full overflow-hidden rounded-[28px] bg-white shadow-[0_20px_60px_rgba(0,32,29,0.12)] lg:grid-cols-[1fr_0.92fr]">
          <section className="relative hidden min-h-[640px] overflow-hidden bg-[linear-gradient(160deg,_#0a7c72_0%,_#0b8f83_100%)] px-9 py-9 text-white lg:flex lg:flex-col lg:justify-between">
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:56px_56px] opacity-35" />
            <div className="relative z-10">
              <div className="flex items-center gap-3 text-[15px] font-bold">
                <BrandMark size="sm" inverted text="ZEE" />
                <span>ZeePOS</span>
              </div>
            </div>

            <div className="relative z-10">
              <h1 className="max-w-md text-[52px] font-extrabold leading-[1.05] tracking-[-0.03em]">
                Sistem Kasir Modern untuk Toko Anda.
              </h1>
              <p className="mt-6 max-w-md text-[17px] leading-8 text-white/80">
                Kelola stok, transaksi kasir, dan laporan keuangan toko dalam satu platform
                yang cepat dan mudah digunakan.
              </p>
            </div>

            <div className="relative z-10 flex items-center gap-4">
              <div className="flex -space-x-2">
                <div className="h-9 w-9 rounded-full border-2 border-white bg-[#f4fffc]" />
                <div className="h-9 w-9 rounded-full border-2 border-white bg-[#ffdcb8]" />
                <div className="h-9 w-9 rounded-full border-2 border-white bg-[#ffdbce]" />
              </div>
            </div>
          </section>

          <section className="flex min-h-[560px] items-center justify-center px-5 py-8 sm:px-8 sm:py-10 lg:min-h-[640px] lg:px-12">
            <div className="w-full max-w-sm">
              <div>
                <h2 className="text-[34px] font-extrabold leading-none tracking-[-0.03em] text-[#191c1e] sm:text-[42px]">
                  Selamat Datang
                </h2>
                <p className="mt-3 text-sm font-medium text-[#7b8785]">
                  Masuk ke akun kasir atau pemilik toko
                </p>
              </div>

              <form className="mt-8 space-y-5" onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                    Username
                  </label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9592]">
                      person
                    </span>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="Masukkan email Anda"
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 pl-12 pr-4 text-sm text-[#191c1e] outline-none transition focus:ring-2 focus:ring-[#0a7c72]/15"
                      {...register('email')}
                    />
                  </div>
                  {errors.email ? (
                    <p className="text-sm font-medium text-[#ba1a1a]">{errors.email.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                      Password
                    </label>
                    <button
                      type="button"
                      className="text-[11px] font-bold text-[#0a7c72] hover:underline"
                    >
                      Lupa Password?
                    </button>
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#8a9592]">
                      lock
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Masukkan password Anda"
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 pl-12 pr-14 text-sm text-[#191c1e] outline-none transition focus:ring-2 focus:ring-[#0a7c72]/15"
                      {...register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#677370] hover:bg-white/70"
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {showPassword ? 'visibility_off' : 'visibility'}
                      </span>
                    </button>
                  </div>
                  {errors.password ? (
                    <p className="text-sm font-medium text-[#ba1a1a]">
                      {errors.password.message}
                    </p>
                  ) : null}
                </div>

                <label className="flex items-center gap-3 text-sm font-medium text-[#677370]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-[#c9d1cf] text-[#0a7c72] focus:ring-[#0a7c72]/15"
                    {...register('remember')}
                  />
                  Ingat perangkat ini
                </label>

                {error ? (
                  <div className="rounded-[14px] border border-[#ffdad6] bg-[#fff3f1] px-4 py-3 text-sm font-medium text-[#ba1a1a]">
                    Email atau password salah
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading || isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#0a7c72] px-5 py-4 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(10,124,114,0.24)] transition hover:bg-[#086b62] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span>{loading || isSubmitting ? 'Memproses...' : 'Masuk'}</span>
                  <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                </button>

                <p className="text-center text-sm text-[#7b8785]">
                  Belum punya toko?{' '}
                  <Link to="/register" className="font-bold text-[#0a7c72] hover:underline">
                    Daftar Sekarang
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
