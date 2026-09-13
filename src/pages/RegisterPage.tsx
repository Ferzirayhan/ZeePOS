import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuthStore } from '../stores/authStore'
import { BrandMark } from '../components/app/BrandMark'

const step1Schema = z.object({
  email: z.string().min(1, 'Email wajib diisi').email('Format email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  confirmPassword: z.string().min(6, 'Konfirmasi password wajib diisi'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Password tidak cocok',
  path: ['confirmPassword'],
})

const step2Schema = z.object({
  tenantName: z.string().min(2, 'Nama toko wajib diisi'),
  tenantSlug: z
    .string()
    .min(3, 'Slug minimal 3 karakter')
    .regex(/^[a-z0-9-]+$/, 'Hanya huruf kecil, angka, dan strip'),
  userName: z.string().min(2, 'Nama lengkap wajib diisi'),
  username: z.string().min(3, 'Username minimal 3 karakter'),
})

type Step1Values = z.infer<typeof step1Schema>
type Step2Values = z.infer<typeof step2Schema>

export function RegisterPage() {
  const navigate = useNavigate()
  const signup = useAuthStore((state) => state.signup)
  const registerTenant = useAuthStore((state) => state.registerTenant)
  const session = useAuthStore((state) => state.session)
  const user = useAuthStore((state) => state.user)
  const needsOnboarding = useAuthStore((state) => state.needsOnboarding)
  const loading = useAuthStore((state) => state.loading)
  const error = useAuthStore((state) => state.error)
  const clearError = useAuthStore((state) => state.clearError)
  const [manualStep, setManualStep] = useState<1 | 2>(1)
  const step = needsOnboarding ? 2 : manualStep
  const setStep = setManualStep
  const [showPassword, setShowPassword] = useState(false)

  const {
    register: registerStep1,
    handleSubmit: handleStep1,
    formState: { errors: step1Errors },
  } = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
  })

  const {
    register: registerStep2,
    handleSubmit: handleStep2,
    setValue: setStep2Value,
    formState: { errors: step2Errors },
  } = useForm<Step2Values>({
    resolver: zodResolver(step2Schema),
  })

  useEffect(() => {
    clearError()
  }, [clearError])

  useEffect(() => {
    if (user && session && !needsOnboarding) {
      navigate('/dashboard', { replace: true })
    }
  }, [user, session, needsOnboarding, navigate])

  const onStep1 = async (values: Step1Values) => {
    try {
      await signup(values.email, values.password)
      setStep(2)
    } catch {
      // error handled by store
    }
  }

  const onStep2 = async (values: Step2Values) => {
    try {
      await registerTenant(values.tenantName, values.tenantSlug, values.userName, values.username)
      navigate('/dashboard', { replace: true })
    } catch {
      // error handled by store
    }
  }

  function generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40)
  }

  return (
    <main className="min-h-screen bg-[#fafbfa] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-lg items-center justify-center sm:min-h-[calc(100vh-5rem)]">
        <div className="w-full rounded-3xl border border-slate-200/80 bg-white px-6 py-8 shadow-2xl shadow-slate-900/5 sm:px-10 sm:py-10">
          <div>
            <div className="flex items-center justify-between mb-4">
              <Link to="/" className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-[#2563eb]">
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Kembali ke Beranda
              </Link>
              <BrandMark size="sm" />
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight text-[#1f2937]">
              {step === 1 ? 'Buka Akun Toko (Trial 7 Hari)' : 'Informasi Toko'}
            </h1>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {step === 1
                ? 'Nikmati akses penuh semua fitur ZeePOS gratis selama 7 hari pertama'
                : 'Lengkapi profil bisnis Anda untuk menyelesaikan setup'}
            </p>
          </div>

          <div className="mt-5 rounded-2xl bg-emerald-50 border border-emerald-200/80 p-3.5 flex items-center gap-3 text-xs font-bold text-emerald-950">
            <span className="material-symbols-outlined text-[#2563eb] text-xl">verified</span>
            <div>
              <p className="font-black text-[#2563eb]">Trial 7 Hari Otomatis Aktif</p>
              <p className="text-slate-600 font-medium text-[11px]">Tanpa kartu kredit, semua fitur kasir & stok langsung terbuka.</p>
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <div className={`h-1.5 flex-1 rounded-full transition-all ${step >= 1 ? 'bg-[#2563eb]' : 'bg-slate-200'}`} />
            <div className={`h-1.5 flex-1 rounded-full transition-all ${step >= 2 ? 'bg-[#2563eb]' : 'bg-slate-200'}`} />
          </div>

          {error ? (
            <div className="mt-6 rounded-[14px] border border-[#ffdad6] bg-[#fff3f1] px-4 py-3 text-sm font-medium text-[#ba1a1a]">
              {error}
            </div>
          ) : null}

          {step === 1 ? (
            <form className="mt-8 space-y-5" onSubmit={handleStep1(onStep1)}>
              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Email Akun
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Masukkan email Anda"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  {...registerStep1('email')}
                />
                {step1Errors.email ? (
                  <p className="text-xs font-semibold text-red-600">{step1Errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Minimal 6 karakter"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 pr-14 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                    {...registerStep1('password')}
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
                {step1Errors.password ? (
                  <p className="text-xs font-semibold text-red-600">{step1Errors.password.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Konfirmasi Password
                </label>
                <input
                  type="password"
                  placeholder="Ulangi password"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  {...registerStep1('confirmPassword')}
                />
                {step1Errors.confirmPassword ? (
                  <p className="text-xs font-semibold text-red-600">{step1Errors.confirmPassword.message}</p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2563eb] px-5 py-3.5 font-display text-sm font-black text-white shadow-lg shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loading ? 'Memproses...' : 'Lanjut ke Informasi Toko'}</span>
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>

              <p className="text-center text-xs text-slate-500 font-medium">
                Sudah punya akun?{' '}
                <Link to="/login" className="font-bold text-[#2563eb] hover:underline">
                  Masuk di sini
                </Link>
              </p>
            </form>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handleStep2(onStep2)}>
              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Nama Toko
                </label>
                <input
                  type="text"
                  placeholder="Kopi Senja / Toko Berkah"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  {...registerStep2('tenantName', {
                    onChange: (e) => {
                      setStep2Value('tenantSlug', generateSlug(e.target.value), { shouldValidate: true })
                    },
                  })}
                />
                {step2Errors.tenantName ? (
                  <p className="text-xs font-semibold text-red-600">{step2Errors.tenantName.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Slug Toko (URL Sistem)
                </label>
                <input
                  type="text"
                  placeholder="kopi-senja"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  {...registerStep2('tenantSlug')}
                />
                {step2Errors.tenantSlug ? (
                  <p className="text-xs font-semibold text-red-600">{step2Errors.tenantSlug.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Nama Lengkap Pemilik
                </label>
                <input
                  type="text"
                  placeholder="Nama Pemilik Toko"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  {...registerStep2('userName')}
                />
                {step2Errors.userName ? (
                  <p className="text-xs font-semibold text-red-600">{step2Errors.userName.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  Username Akun
                </label>
                <input
                  type="text"
                  placeholder="owner"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/70 py-3.5 px-4 text-sm text-[#1f2937] outline-none transition focus:border-[#2563eb] focus:bg-white focus:ring-4 focus:ring-blue-500/10"
                  {...registerStep2('username')}
                />
                {step2Errors.username ? (
                  <p className="text-xs font-semibold text-red-600">{step2Errors.username.message}</p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#2563eb] px-5 py-3.5 font-display text-sm font-black text-white shadow-lg shadow-[#2563eb]/20 transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span>{loading ? 'Menyiapkan Toko...' : 'Mulai Gunakan ZeePOS'}</span>
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
