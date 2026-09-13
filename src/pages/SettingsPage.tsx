import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { createStaffMember, resetStaffPassword, updateStaffStatus } from '../api/staff'
import { useSettings } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { useToastStore } from '../stores/toastStore'
import type { Profile } from '../types/database'
import { cn } from '../utils/cn'
import { openPrintWindow, writeSafePrintDocument } from '../utils/printWindow'

const storeProfileSchema = z.object({
  nama_toko: z.string().min(2, 'Nama toko wajib diisi'),
  alamat: z.string().min(5, 'Alamat wajib diisi'),
  no_telp: z.string().min(8, 'Nomor telepon wajib diisi'),
  header_struk: z.string().min(5, 'Header struk wajib diisi'),
  footer_struk: z.string().min(5, 'Footer struk wajib diisi'),
})

const taxSchema = z.object({
  ppn_enabled: z.boolean(),
  ppn_persen: z.coerce.number().min(0, 'PPN tidak boleh negatif').max(100, 'PPN maksimal 100%'),
})

const paymentSchema = z.object({
  payment_qris_label: z.string().trim().min(2, 'Label QRIS wajib diisi'),
  payment_transfer_label: z.string().trim().min(2, 'Label transfer wajib diisi'),
  payment_transfer_account_name: z.string().trim().min(2, 'Nama rekening wajib diisi'),
  payment_transfer_account_number: z.string().trim().min(3, 'Nomor rekening wajib diisi'),
  payment_transfer_bank: z.string().trim().min(2, 'Nama bank wajib diisi'),
  payment_whatsapp_number: z.string().trim().optional(),
  payment_confirmation_note: z.string().trim().min(5, 'Catatan konfirmasi wajib diisi'),
})

const newStaffSchema = z.object({
  nama: z.string().trim().min(2, 'Nama minimal 2 karakter'),
  username: z
    .string()
    .trim()
    .min(3, 'Username minimal 3 karakter')
    .regex(/^[a-z0-9_.-]+$/i, 'Hanya huruf, angka, titik, strip, underscore'),
  email: z.string().trim().email('Format email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  role: z.enum(['kasir', 'admin']),
})

const resetPasswordSchema = z.object({
  new_password: z.string().min(6, 'Password minimal 6 karakter'),
})

type StoreProfileValues = z.infer<typeof storeProfileSchema>
type TaxValues = z.infer<typeof taxSchema>
type TaxInputValues = z.input<typeof taxSchema>
type PaymentValues = z.infer<typeof paymentSchema>
type PaymentInputValues = z.input<typeof paymentSchema>
type NewStaffValues = z.infer<typeof newStaffSchema>
type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

type SettingsTab = 'toko' | 'pengguna' | 'printer' | 'pajak' | 'pembayaran'

export function SettingsPage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const { settings, loading, saveSettings } = useSettings()
  const pushToast = useToastStore((state) => state.pushToast)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const [activeTab, setActiveTab] = useState<SettingsTab>('toko')
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [savingStore, setSavingStore] = useState(false)
  const [savingTax, setSavingTax] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [updatingProfileId, setUpdatingProfileId] = useState<string | null>(null)
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false)
  const [resetTargetUser, setResetTargetUser] = useState<Profile | null>(null)
  const [staffSubmitting, setStaffSubmitting] = useState(false)

  const {
    register: registerStaff,
    handleSubmit: handleSubmitStaff,
    reset: resetStaffForm,
    formState: { errors: staffErrors },
  } = useForm<NewStaffValues>({
    resolver: zodResolver(newStaffSchema),
    defaultValues: {
      nama: '',
      username: '',
      email: '',
      password: '',
      role: 'kasir',
    },
  })

  const {
    register: registerResetPw,
    handleSubmit: handleSubmitResetPw,
    reset: resetResetPwForm,
    formState: { errors: resetPwErrors },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      new_password: '',
    },
  })

  const {
    register: registerStore,
    handleSubmit: handleSubmitStore,
    reset: resetStoreForm,
    formState: { errors: storeErrors },
  } = useForm<StoreProfileValues>({
    resolver: zodResolver(storeProfileSchema),
    defaultValues: {
      nama_toko: '',
      alamat: '',
      no_telp: '',
      header_struk: '',
      footer_struk: '',
    },
  })

  const {
    register: registerTax,
    handleSubmit: handleSubmitTax,
    reset: resetTaxForm,
    watch: watchTax,
    formState: { errors: taxErrors },
  } = useForm<TaxInputValues, unknown, TaxValues>({
    resolver: zodResolver(taxSchema),
    defaultValues: {
      ppn_enabled: false,
      ppn_persen: 0,
    },
  })

  const {
    register: registerPayment,
    handleSubmit: handleSubmitPayment,
    reset: resetPaymentForm,
    formState: { errors: paymentErrors },
  } = useForm<PaymentInputValues, unknown, PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      payment_qris_label: '',
      payment_transfer_label: '',
      payment_transfer_account_name: '',
      payment_transfer_account_number: '',
      payment_transfer_bank: '',
      payment_whatsapp_number: '',
      payment_confirmation_note: '',
    },
  })

  useEffect(() => {
    resetStoreForm({
      nama_toko: settings.nama_toko ?? '',
      alamat: settings.alamat ?? '',
      no_telp: settings.no_telp ?? '',
      header_struk: settings.header_struk ?? '',
      footer_struk: settings.footer_struk ?? '',
    })

    const ppnPersen = Number(settings.ppn_persen ?? 0)
    resetTaxForm({
      ppn_enabled: ppnPersen > 0,
      ppn_persen: ppnPersen,
    })
    resetPaymentForm({
      payment_qris_label: settings.payment_qris_label ?? 'QRIS Toko',
      payment_transfer_label: settings.payment_transfer_label ?? 'Transfer Bank',
      payment_transfer_account_name: settings.payment_transfer_account_name ?? '',
      payment_transfer_account_number: settings.payment_transfer_account_number ?? '',
      payment_transfer_bank: settings.payment_transfer_bank ?? '',
      payment_whatsapp_number: settings.payment_whatsapp_number ?? '',
      payment_confirmation_note:
        settings.payment_confirmation_note ??
        'Pastikan dana sudah masuk sebelum struk dicetak.',
    })
  }, [resetPaymentForm, resetStoreForm, resetTaxForm, settings])

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true)

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('nama', { ascending: true })

      if (error) {
        throw new Error(error.message)
      }

      setProfiles(data ?? [])
    } catch (loadError) {
      pushToast({
        title: 'Gagal memuat pengguna',
        description:
          loadError instanceof Error
            ? loadError.message
            : 'Daftar pengguna belum berhasil dimuat.',
        variant: 'error',
      })
    } finally {
      setProfilesLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  const onSubmitStore = async (values: StoreProfileValues) => {
    setSavingStore(true)

    try {
      await saveSettings(values)
      pushToast({
        title: 'Profil toko diperbarui',
        description: 'Informasi toko berhasil disimpan.',
        variant: 'success',
      })
    } catch (saveError) {
      pushToast({
        title: 'Gagal menyimpan profil toko',
        description:
          saveError instanceof Error ? saveError.message : 'Perubahan belum berhasil disimpan.',
        variant: 'error',
      })
    } finally {
      setSavingStore(false)
    }
  }

  const onSubmitTax = async (values: TaxValues) => {
    setSavingTax(true)

    try {
      await saveSettings({
        ppn_persen: values.ppn_enabled ? String(values.ppn_persen) : '0',
      })
      pushToast({
        title: 'Pengaturan pajak diperbarui',
        description: 'Konfigurasi PPN berhasil disimpan.',
        variant: 'success',
      })
    } catch (saveError) {
      pushToast({
        title: 'Gagal menyimpan pajak',
        description:
          saveError instanceof Error ? saveError.message : 'Konfigurasi pajak belum tersimpan.',
        variant: 'error',
      })
    } finally {
      setSavingTax(false)
    }
  }

  const onSubmitPayment = async (values: PaymentValues) => {
    setSavingPayment(true)

    try {
      await saveSettings(values)
      pushToast({
        title: 'Pengaturan pembayaran diperbarui',
        description: 'Instruksi QRIS, transfer, dan WhatsApp berhasil disimpan.',
        variant: 'success',
      })
    } catch (saveError) {
      pushToast({
        title: 'Gagal menyimpan pembayaran',
        description:
          saveError instanceof Error
            ? saveError.message
            : 'Pengaturan pembayaran belum berhasil disimpan.',
        variant: 'error',
      })
    } finally {
      setSavingPayment(false)
    }
  }

  const handleCreateStaff = async (values: NewStaffValues) => {
    try {
      setStaffSubmitting(true)
      await createStaffMember({
        email: values.email,
        password: values.password,
        nama: values.nama,
        username: values.username,
        role: values.role,
      })
      pushToast({
        title: 'Staf Berhasil Ditambahkan',
        description: `Akun ${values.nama} (${values.role}) siap digunakan login.`,
        variant: 'success',
      })
      resetStaffForm()
      setIsAddStaffOpen(false)
      await loadProfiles()
    } catch (createErr) {
      pushToast({
        title: 'Gagal Menambah Staf',
        description: createErr instanceof Error ? createErr.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setStaffSubmitting(false)
    }
  }

  const handleResetPassword = async (values: ResetPasswordValues) => {
    if (!resetTargetUser) return
    try {
      setStaffSubmitting(true)
      await resetStaffPassword(resetTargetUser.id, values.new_password)
      pushToast({
        title: 'Password Berhasil Direset',
        description: `Password untuk ${resetTargetUser.nama} telah diperbarui.`,
        variant: 'success',
      })
      resetResetPwForm()
      setResetTargetUser(null)
    } catch (resetErr) {
      pushToast({
        title: 'Gagal Reset Password',
        description: resetErr instanceof Error ? resetErr.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setStaffSubmitting(false)
    }
  }

  const toggleProfileActive = async (profile: Profile) => {
    setUpdatingProfileId(profile.id)

    try {
      await updateStaffStatus(profile.id, !(profile.is_active ?? true))

      await loadProfiles()
      pushToast({
        title: 'Status kasir diperbarui',
        description: `${profile.nama} sekarang ${(profile.is_active ?? true) ? 'nonaktif' : 'aktif'}.`,
        variant: 'success',
      })
    } catch (updateError) {
      pushToast({
        title: 'Gagal memperbarui pengguna',
        description:
          updateError instanceof Error
            ? updateError.message
            : 'Status pengguna belum berhasil diubah.',
        variant: 'error',
      })
    } finally {
      setUpdatingProfileId(null)
    }
  }

  const selectedPpnEnabled = watchTax('ppn_enabled')

  const handleTestPrint = () => {
    const win = openPrintWindow('', '400', '600')

    if (!win) {
      return
    }

    writeSafePrintDocument(win.document, win, {
      title: 'Test Struk',
      styleCss:
        'body{font-family:monospace;font-size:13px;padding:20px;text-align:center}hr{border:none;border-top:1px dashed #000}',
      slots: [
        { id: 'nama', text: settings.nama_toko ?? 'Nama Toko' },
        { id: 'alamat', text: settings.alamat ?? 'Alamat toko' },
        { id: 'telp', text: `Tel: ${settings.no_telp ?? '-'}` },
        { id: 'hr1', trustedHtml: '<hr/>' },
        { id: 'header', text: settings.header_struk ?? 'Header struk' },
        { id: 'hr2', trustedHtml: '<hr/>' },
        { id: 'test', text: `TEST PRINT - ${new Date().toLocaleString('id-ID')}` },
        { id: 'note', text: 'Struk ini hanya untuk uji cetak.' },
        { id: 'hr3', trustedHtml: '<hr/>' },
        { id: 'footer', text: settings.footer_struk ?? 'Footer struk' },
      ],
    })
  }

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pt-16 transition-[margin] duration-200 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="min-h-screen bg-white md:rounded-l-[24px]">
        <header className="border-b border-[#eef1f1] px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
              Pengaturan
            </h1>
            <p className="mt-1 text-sm font-medium text-[#8b9895]">
              Konfigurasi identitas toko, pengguna, printer, dan pajak.
            </p>
          </div>
        </header>

        <div className="space-y-6 bg-[#f7f9f9] px-4 py-4 sm:px-6 sm:py-6">
          <section className="flex max-w-full gap-1 overflow-x-auto rounded-[16px] bg-white p-1 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            {[
              ['toko', 'Toko'],
              ['pengguna', 'Pengguna'],
              ['printer', 'Printer'],
              ['pajak', 'Pajak & Diskon'],
              ['pembayaran', 'Pembayaran'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value as SettingsTab)}
                className={
                  activeTab === value
                    ? 'rounded-[12px] bg-[#eff6ff] px-5 py-2.5 font-bold text-[#2563eb]'
                    : 'rounded-[12px] px-5 py-2.5 font-medium text-[#7d8987]'
                }
              >
                {label}
              </button>
            ))}
          </section>

          {activeTab === 'toko' ? (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <form
                className="rounded-[20px] bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.04)]"
                onSubmit={handleSubmitStore(onSubmitStore)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                      Identitas Toko
                    </h2>
                    <p className="mt-1 text-sm text-[#8b9895]">
                      Informasi ini akan tampil pada header dan struk belanja.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={savingStore || loading}
                    className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white disabled:opacity-60"
                  >
                    {savingStore ? 'Menyimpan...' : 'Simpan Perubahan'}
                  </button>
                </div>

                <div className="mt-6 grid gap-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="space-y-2">
                      <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                        Nama Toko
                      </span>
                      <input
                        className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                        {...registerStore('nama_toko')}
                      />
                      {storeErrors.nama_toko ? (
                        <span className="text-sm text-[#ba1a1a]">
                          {storeErrors.nama_toko.message}
                        </span>
                      ) : null}
                    </label>

                    <label className="space-y-2">
                      <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                        No. Telepon
                      </span>
                      <input
                        className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                        {...registerStore('no_telp')}
                      />
                      {storeErrors.no_telp ? (
                        <span className="text-sm text-[#ba1a1a]">
                          {storeErrors.no_telp.message}
                        </span>
                      ) : null}
                    </label>
                  </div>

                  <label className="space-y-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Alamat Lengkap
                    </span>
                    <textarea
                      rows={3}
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      {...registerStore('alamat')}
                    />
                    {storeErrors.alamat ? (
                      <span className="text-sm text-[#ba1a1a]">
                        {storeErrors.alamat.message}
                      </span>
                    ) : null}
                  </label>

                  <label className="space-y-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Header Struk
                    </span>
                    <textarea
                      rows={4}
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      {...registerStore('header_struk')}
                    />
                    {storeErrors.header_struk ? (
                      <span className="text-sm text-[#ba1a1a]">
                        {storeErrors.header_struk.message}
                      </span>
                    ) : null}
                  </label>

                  <label className="space-y-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Footer Struk
                    </span>
                    <textarea
                      rows={4}
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                      {...registerStore('footer_struk')}
                    />
                    {storeErrors.footer_struk ? (
                      <span className="text-sm text-[#ba1a1a]">
                        {storeErrors.footer_struk.message}
                      </span>
                    ) : null}
                  </label>
                </div>
              </form>

              <aside className="space-y-6">
                <div className="rounded-[20px] border border-[#bfdbfe] bg-[#eff6ff] p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2563eb] text-white">
                      <span className="material-symbols-outlined">storefront</span>
                    </div>
                    <div>
                      <h3 className="font-extrabold text-[#1b1e20]">
                        {settings.nama_toko ?? 'Toko Anda'}
                      </h3>
                      <p className="text-sm text-[#52627d]">
                        {settings.no_telp ?? '0812-3456-7890'}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-[#52627d]">
                    {settings.alamat ?? 'Alamat toko belum diatur.'}
                  </p>
                </div>

                <div className="rounded-[20px] bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
                  <h3 className="font-extrabold text-[#1b1e20]">Printer Cepat</h3>
                  <div className="mt-4 rounded-[16px] bg-[#f7f9f9] p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-[#2563eb]">print</span>
                        <span className="text-sm font-medium text-[#1b1e20]">Epson TM-T82III</span>
                      </div>
                      <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
                    </div>
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      className="mt-4 w-full rounded-[12px] border border-[#bfdbfe] py-2 text-sm font-bold text-[#2563eb]"
                    >
                      Test Print Struk
                    </button>
                  </div>
                </div>
              </aside>
            </section>
          ) : null}

          {activeTab === 'pembayaran' ? (
            <section className="rounded-[20px] bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
              <form className="space-y-5" onSubmit={handleSubmitPayment(onSubmitPayment)}>
                <div>
                  <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                    Pengaturan Pembayaran Non Tunai
                  </h2>
                  <p className="mt-1 text-sm font-medium text-[#8b9895]">
                    Informasi ini akan dipakai di halaman POS saat kasir memproses QRIS dan transfer.
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Label QRIS
                    </label>
                    <input
                      {...registerPayment('payment_qris_label')}
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                    {paymentErrors.payment_qris_label ? (
                      <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_qris_label.message}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Nomor WhatsApp Toko
                    </label>
                    <input
                      {...registerPayment('payment_whatsapp_number')}
                      placeholder="62812xxxx"
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Label Transfer
                    </label>
                    <input
                      {...registerPayment('payment_transfer_label')}
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                    {paymentErrors.payment_transfer_label ? (
                      <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_transfer_label.message}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Nama Bank
                    </label>
                    <input
                      {...registerPayment('payment_transfer_bank')}
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                    {paymentErrors.payment_transfer_bank ? (
                      <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_transfer_bank.message}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Nama Rekening
                    </label>
                    <input
                      {...registerPayment('payment_transfer_account_name')}
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                    {paymentErrors.payment_transfer_account_name ? (
                      <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_transfer_account_name.message}</p>
                    ) : null}
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Nomor Rekening
                    </label>
                    <input
                      {...registerPayment('payment_transfer_account_number')}
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                    />
                    {paymentErrors.payment_transfer_account_number ? (
                      <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_transfer_account_number.message}</p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                    Catatan Konfirmasi
                  </label>
                  <textarea
                    {...registerPayment('payment_confirmation_note')}
                    rows={4}
                    className="mt-2 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                  />
                  {paymentErrors.payment_confirmation_note ? (
                    <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_confirmation_note.message}</p>
                  ) : null}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPayment}
                    className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white disabled:opacity-60"
                  >
                    {savingPayment ? 'Menyimpan...' : 'Simpan Pengaturan Pembayaran'}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {activeTab === 'pengguna' ? (
            <section className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-[20px] border border-[#bfdbfe] bg-[#eff6ff] p-6">
                <div>
                  <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                    Kelola Kasir & Tim
                  </h2>
                  <p className="mt-1 text-sm text-[#52627d]">
                    Daftarkan akun kasir atau staf tambahan untuk toko Anda secara instan.
                  </p>
                </div>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetStaffForm()
                      setIsAddStaffOpen(true)
                    }}
                    className="inline-flex items-center justify-center rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white shadow-sm transition hover:bg-[#1d4ed8]"
                  >
                    + Tambah Kasir / Staf
                  </button>
                ) : null}
              </div>

              <div className="rounded-[20px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between border-b border-[#eef1f1] px-5 py-4">
                  <h2 className="text-[18px] font-extrabold text-[#1b1e20]">
                    Daftar Pengguna ({profiles.length})
                  </h2>
                  <button
                    type="button"
                    onClick={() => void loadProfiles()}
                    className="rounded-[12px] bg-[#eef3f3] px-4 py-2 text-sm font-bold text-[#52627d]"
                  >
                    Refresh
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-[#f7f9f9]">
                      <tr>
                        {['Nama', 'Username', 'Role', 'Status', 'Aksi'].map((heading) => (
                          <th
                            key={heading}
                            className="px-5 py-4 text-left text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#97a19f]"
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {profilesLoading
                        ? Array.from({ length: 4 }).map((_, index) => (
                            <tr key={index} className="border-t border-[#eef1f1]">
                              {Array.from({ length: 5 }).map((__, cellIndex) => (
                                <td key={cellIndex} className="px-5 py-4">
                                  <div className="h-6 w-full animate-pulse rounded-xl bg-[#eef0f3]" />
                                </td>
                              ))}
                            </tr>
                          ))
                        : profiles.map((profile) => (
                            <tr key={profile.id} className="border-t border-[#eef1f1]">
                              <td className="px-5 py-4 font-bold text-[#1b1e20]">{profile.nama}</td>
                              <td className="px-5 py-4 text-sm text-[#52627d]">{profile.username}</td>
                              <td className="px-5 py-4">
                                <span
                                  className={
                                    profile.role === 'admin'
                                      ? 'rounded-full bg-[#ccfaf1] px-3 py-1 text-[10px] font-extrabold uppercase text-[#2563eb]'
                                      : 'rounded-full bg-[#ffddb8] px-3 py-1 text-[10px] font-extrabold uppercase text-[#855300]'
                                  }
                                >
                                  {profile.role ?? 'kasir'}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={
                                    profile.is_active
                                      ? 'text-sm font-bold text-[#2563eb]'
                                      : 'text-sm font-bold text-[#ba1a1a]'
                                  }
                                >
                                  {profile.is_active ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                {isAdmin ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      disabled={updatingProfileId === profile.id}
                                      onClick={() => void toggleProfileActive(profile)}
                                      className="rounded-[12px] bg-[#eef3f3] px-3 py-2 text-xs font-bold text-[#52627d] transition hover:bg-[#dfe5e5] disabled:opacity-60"
                                    >
                                      {updatingProfileId === profile.id
                                        ? '...'
                                        : profile.is_active
                                          ? 'Nonaktifkan'
                                          : 'Aktifkan'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        resetResetPwForm()
                                        setResetTargetUser(profile)
                                      }}
                                      className="rounded-[12px] border border-[#bfdbfe] px-3 py-2 text-xs font-bold text-[#2563eb] transition hover:bg-[#eff6ff]"
                                    >
                                      Reset Password
                                    </button>
                                  </div>
                                ) : (
                                  <span className="text-sm text-[#8b9895]">Admin only</span>
                                )}
                              </td>
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === 'printer' ? (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-[20px] bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
                <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                  Printer Struk
                </h2>
                <p className="mt-2 text-sm text-[#52627d]">
                  Konfigurasi printer lokal dilakukan dari sistem operasi atau browser.
                </p>
                <div className="mt-5 rounded-[16px] bg-[#f7f9f9] p-4">
                  <p className="font-bold text-[#1b1e20]">Rekomendasi</p>
                  <ul className="mt-3 space-y-2 text-sm text-[#52627d]">
                    <li>1. Gunakan printer thermal 58mm atau 80mm.</li>
                    <li>2. Buka menu print browser dan pilih printer default.</li>
                    <li>3. Uji cetak lewat tombol "Cetak Struk" setelah transaksi.</li>
                  </ul>
                </div>
              </div>

              <div className="rounded-[20px] border border-[#bfdbfe] bg-[#eff6ff] p-6">
                <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                  Catatan Integrasi
                </h2>
                <p className="mt-2 text-sm text-[#52627d]">
                  Untuk integrasi printer otomatis tingkat lanjut, biasanya dibutuhkan aplikasi bridge atau server lokal tambahan.
                </p>
              </div>
            </section>
          ) : null}

          {activeTab === 'pajak' ? (
            <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <form
                className="rounded-[20px] bg-white p-6 shadow-[0_6px_24px_rgba(15,23,42,0.04)]"
                onSubmit={handleSubmitTax(onSubmitTax)}
              >
                <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                  Pajak & Diskon
                </h2>
                <p className="mt-2 text-sm text-[#52627d]">
                  Atur apakah POS memakai PPN default dan berapa persentasenya.
                </p>

                <div className="mt-6 space-y-5">
                  <label className="flex items-center gap-3 rounded-[14px] bg-[#f7f9f9] px-4 py-4 text-sm font-medium text-[#52627d]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      {...registerTax('ppn_enabled')}
                    />
                    Aktifkan PPN default untuk transaksi baru
                  </label>

                  <label className="space-y-2">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Persentase PPN
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      disabled={!selectedPpnEnabled}
                      className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-60"
                      {...registerTax('ppn_persen')}
                    />
                    {taxErrors.ppn_persen ? (
                      <span className="text-sm text-[#ba1a1a]">
                        {taxErrors.ppn_persen.message}
                      </span>
                    ) : null}
                  </label>

                  <button
                    type="submit"
                    disabled={savingTax}
                    className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white disabled:opacity-60"
                  >
                    {savingTax ? 'Menyimpan...' : 'Simpan Pengaturan Pajak'}
                  </button>
                </div>
              </form>

              <aside className="rounded-[20px] border border-[#bfdbfe] bg-[#eff6ff] p-6">
                <h3 className="font-extrabold text-[#1b1e20]">Ringkasan Saat Ini</h3>
                <p className="mt-3 text-sm text-[#52627d]">
                  PPN default saat ini:
                  <span className="ml-2 font-bold text-[#2563eb]">
                    {Number(settings.ppn_persen ?? 0)}%
                  </span>
                </p>
                <p className="mt-3 text-sm text-[#52627d]">
                  Kasir tetap bisa mematikan atau menghidupkan PPN di halaman POS saat transaksi berlangsung.
                </p>
              </aside>
            </section>
          ) : null}
        </div>
      </div>

      {/* Modal Tambah Staf */}
      {isAddStaffOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between pb-4 border-b border-[#eef1f1]">
              <h3 className="text-xl font-extrabold text-[#1b1e20]">Tambah Staf / Kasir</h3>
              <button
                type="button"
                onClick={() => setIsAddStaffOpen(false)}
                className="text-[#8b9895] hover:text-[#1b1e20] text-xl font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitStaff(handleCreateStaff)} className="mt-5 space-y-4">
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Nama Lengkap
                </label>
                <input
                  {...registerStaff('nama')}
                  placeholder="Contoh: Budi Santoso"
                  className="mt-1 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                />
                {staffErrors.nama ? (
                  <p className="mt-1 text-xs text-[#ba1a1a]">{staffErrors.nama.message}</p>
                ) : null}
              </div>

              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Username
                </label>
                <input
                  {...registerStaff('username')}
                  placeholder="budi_kasir"
                  className="mt-1 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                />
                {staffErrors.username ? (
                  <p className="mt-1 text-xs text-[#ba1a1a]">{staffErrors.username.message}</p>
                ) : null}
              </div>

              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Email Login
                </label>
                <input
                  type="email"
                  {...registerStaff('email')}
                  placeholder="budi@toko.com"
                  className="mt-1 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                />
                {staffErrors.email ? (
                  <p className="mt-1 text-xs text-[#ba1a1a]">{staffErrors.email.message}</p>
                ) : null}
              </div>

              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Password
                </label>
                <input
                  type="password"
                  {...registerStaff('password')}
                  placeholder="Minimal 6 karakter"
                  className="mt-1 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                />
                {staffErrors.password ? (
                  <p className="mt-1 text-xs text-[#ba1a1a]">{staffErrors.password.message}</p>
                ) : null}
              </div>

              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Peran / Role
                </label>
                <select
                  {...registerStaff('role')}
                  className="mt-1 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                >
                  <option value="kasir">Kasir (Hanya akses kasir POS)</option>
                  <option value="admin">Admin (Akses penuh termasuk laporan & stok)</option>
                </select>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddStaffOpen(false)}
                  className="rounded-[14px] bg-[#f1f3f5] px-5 py-3 font-bold text-[#52627d]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={staffSubmitting}
                  className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white transition hover:bg-[#1d4ed8] disabled:opacity-60"
                >
                  {staffSubmitting ? 'Menyimpan...' : 'Daftarkan Staf'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal Reset Password */}
      {resetTargetUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-center justify-between pb-4 border-b border-[#eef1f1]">
              <div>
                <h3 className="text-xl font-extrabold text-[#1b1e20]">Reset Password</h3>
                <p className="text-xs text-[#52627d] mt-0.5">Untuk akun: {resetTargetUser.nama}</p>
              </div>
              <button
                type="button"
                onClick={() => setResetTargetUser(null)}
                className="text-[#8b9895] hover:text-[#1b1e20] text-xl font-bold"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitResetPw(handleResetPassword)} className="mt-5 space-y-4">
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Password Baru
                </label>
                <input
                  type="password"
                  {...registerResetPw('new_password')}
                  placeholder="Minimal 6 karakter"
                  className="mt-1 h-12 w-full rounded-[14px] bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#2563eb]/15"
                />
                {resetPwErrors.new_password ? (
                  <p className="mt-1 text-xs text-[#ba1a1a]">{resetPwErrors.new_password.message}</p>
                ) : null}
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setResetTargetUser(null)}
                  className="rounded-[14px] bg-[#f1f3f5] px-5 py-3 font-bold text-[#52627d]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={staffSubmitting}
                  className="rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white transition hover:bg-[#1d4ed8] disabled:opacity-60"
                >
                  {staffSubmitting ? 'Menyimpan...' : 'Ganti Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  )
}
