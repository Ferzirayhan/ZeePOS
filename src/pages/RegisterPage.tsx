import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuthStore } from '../stores/authStore'

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
    <main className="min-h-screen bg-[linear-gradient(135deg,_#f8fbfb_0%,_#eef5f4_55%,_#f7faf9_100%)] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-lg items-center justify-center sm:min-h-[calc(100vh-5rem)]">
        <div className="w-full rounded-[28px] bg-white px-6 py-8 shadow-[0_20px_60px_rgba(0,32,29,0.12)] sm:px-10 sm:py-10">
          <div>
            <h1 className="text-[28px] font-extrabold leading-none tracking-[-0.03em] text-[#191c1e] sm:text-[34px]">
              {step === 1 ? 'Buat Akun' : 'Setup Toko'}
            </h1>
            <p className="mt-3 text-sm font-medium text-[#7b8785]">
              {step === 1
                ? 'Daftarkan email untuk mulai menggunakan POS'
                : 'Isi informasi toko untuk memulai'}
            </p>
          </div>

          <div className="mt-6 flex gap-2">
            <div className={`h-1 flex-1 rounded-full ${step >= 1 ? 'bg-[#0a7c72]' : 'bg-[#eef0f3]'}`} />
            <div className={`h-1 flex-1 rounded-full ${step >= 2 ? 'bg-[#0a7c72]' : 'bg-[#eef0f3]'}`} />
          </div>

          {error ? (
            <div className="mt-6 rounded-[14px] border border-[#ffdad6] bg-[#fff3f1] px-4 py-3 text-sm font-medium text-[#ba1a1a]">
              {error}
            </div>
          ) : null}

          {step === 1 ? (
            <form className="mt-8 space-y-5" onSubmit={handleStep1(onStep1)}>
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Email
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="email@contoh.com"
                  className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  {...registerStep1('email')}
                />
                {step1Errors.email ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step1Errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Minimal 6 karakter"
                    className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 pr-14 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                    {...registerStep1('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#677370] hover:bg-white/70"
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>
                {step1Errors.password ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step1Errors.password.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Konfirmasi Password
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Ulangi password"
                  className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  {...registerStep1('confirmPassword')}
                />
                {step1Errors.confirmPassword ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step1Errors.confirmPassword.message}</p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#0a7c72] px-5 py-4 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(10,124,114,0.24)] transition hover:bg-[#086b62] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Memproses...' : 'Lanjut'}
              </button>

              <p className="text-center text-sm text-[#7b8785]">
                Sudah punya akun?{' '}
                <Link to="/login" className="font-bold text-[#0a7c72] hover:underline">
                  Masuk
                </Link>
              </p>
            </form>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handleStep2(onStep2)}>
              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Nama Toko
                </label>
                <input
                  type="text"
                  placeholder="Toko Plastik Jaya"
                  className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  {...registerStep2('tenantName', {
                    onChange: (e) => {
                      setStep2Value('tenantSlug', generateSlug(e.target.value), { shouldValidate: true })
                    },
                  })}
                />
                {step2Errors.tenantName ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step2Errors.tenantName.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Slug (URL unik toko)
                </label>
                <input
                  type="text"
                  placeholder="toko-plastik-jaya"
                  className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  {...registerStep2('tenantSlug')}
                />
                {step2Errors.tenantSlug ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step2Errors.tenantSlug.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Nama Lengkap (Pemilik)
                </label>
                <input
                  type="text"
                  placeholder="Nama Anda"
                  className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  {...registerStep2('userName')}
                />
                {step2Errors.userName ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step2Errors.userName.message}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#616d6b]">
                  Username
                </label>
                <input
                  type="text"
                  placeholder="pemilik"
                  className="w-full rounded-[14px] border-none bg-[#eef0f3] py-4 px-4 text-sm text-[#191c1e] outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  {...registerStep2('username')}
                />
                {step2Errors.username ? (
                  <p className="text-sm font-medium text-[#ba1a1a]">{step2Errors.username.message}</p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#0a7c72] px-5 py-4 text-sm font-extrabold text-white shadow-[0_12px_24px_rgba(10,124,114,0.24)] transition hover:bg-[#086b62] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Membuat toko...' : 'Mulai Gunakan POS'}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
