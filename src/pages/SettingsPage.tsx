import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useSettings } from '../hooks/useSettings'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { useToastStore } from '../stores/toastStore'
import type { Profile } from '../types/database'
import { cn } from '../utils/cn'

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

type StoreProfileValues = z.infer<typeof storeProfileSchema>
type TaxValues = z.infer<typeof taxSchema>
type TaxInputValues = z.input<typeof taxSchema>
type PaymentValues = z.infer<typeof paymentSchema>
type PaymentInputValues = z.input<typeof paymentSchema>

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

  const toggleProfileActive = async (profile: Profile) => {
    setUpdatingProfileId(profile.id)

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !(profile.is_active ?? true) })
        .eq('id', profile.id)

      if (error) {
        throw new Error(error.message)
      }

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

  const addUserSteps = useMemo(
    () => [
      'Buka Supabase Studio > Authentication > Users > Add user.',
      'Isi email dan password kasir baru.',
      'Salin UUID user baru, lalu tambahkan row di tabel profiles dengan nama, username, dan role.',
    ],
    [],
  )

  const selectedPpnEnabled = watchTax('ppn_enabled')

  const handleTestPrint = () => {
    const win = window.open('', '_blank', 'width=400,height=600')

    if (!win) {
      return
    }

    win.document.write(`
      <html>
        <head>
          <title>Test Struk</title>
          <style>
            body {
              font-family: monospace;
              font-size: 13px;
              padding: 20px;
              text-align: center;
            }

            hr {
              border: none;
              border-top: 1px dashed #000;
            }
          </style>
        </head>
        <body>
          <h2>${settings.nama_toko ?? 'Nama Toko'}</h2>
          <p>${settings.alamat ?? 'Alamat toko'}</p>
          <p>Tel: ${settings.no_telp ?? '-'}</p>
          <hr/>
          <p>${settings.header_struk ?? 'Header struk'}</p>
          <hr/>
          <p>TEST PRINT - ${new Date().toLocaleString('id-ID')}</p>
          <p>Struk ini hanya untuk uji cetak.</p>
          <hr/>
          <p>${settings.footer_struk ?? 'Footer struk'}</p>
        </body>
      </html>
    `)
    win.document.close()
    win.focus()
    win.print()
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
                    ? 'rounded-[12px] bg-[#f4fffc] px-5 py-2.5 font-bold text-[#0a7c72]'
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
                    className="rounded-[14px] bg-[#0a7c72] px-5 py-3 font-bold text-white disabled:opacity-60"
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
                        className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                        className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="w-full rounded-[14px] border-none bg-[#eef0f3] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                <div className="rounded-[20px] border border-[#d5ebe7] bg-[#f4fffc] p-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0a7c72] text-white">
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
                        <span className="material-symbols-outlined text-[#0a7c72]">print</span>
                        <span className="text-sm font-medium text-[#1b1e20]">Epson TM-T82III</span>
                      </div>
                      <span className="h-2 w-2 rounded-full bg-[#0a7c72]" />
                    </div>
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      className="mt-4 w-full rounded-[12px] border border-[#c8e2de] py-2 text-sm font-bold text-[#0a7c72]"
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
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                      Label Transfer
                    </label>
                    <input
                      {...registerPayment('payment_transfer_label')}
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                      className="mt-2 h-12 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
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
                    className="mt-2 w-full rounded-[14px] border-none bg-[#f1f3f5] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15"
                  />
                  {paymentErrors.payment_confirmation_note ? (
                    <p className="mt-2 text-xs font-medium text-[#ba1a1a]">{paymentErrors.payment_confirmation_note.message}</p>
                  ) : null}
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPayment}
                    className="rounded-[14px] bg-[#0a7c72] px-5 py-3 font-bold text-white disabled:opacity-60"
                  >
                    {savingPayment ? 'Menyimpan...' : 'Simpan Pengaturan Pembayaran'}
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {activeTab === 'pengguna' ? (
            <section className="space-y-6">
              <div className="rounded-[20px] border border-[#d5ebe7] bg-[#f4fffc] p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[22px] font-extrabold text-[#1b1e20]">
                      Tambah Kasir Baru
                    </h2>
                    <p className="mt-1 text-sm text-[#52627d]">
                      Pembuatan akun auth butuh akses admin Supabase. Gunakan alur aman di bawah ini.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      pushToast({
                        title: 'Gunakan Supabase Dashboard',
                        description:
                          'Buat user di Authentication > Users, lalu tambahkan row ke tabel profiles.',
                        variant: 'info',
                      })
                    }
                    className="rounded-[14px] bg-[#0a7c72] px-5 py-3 font-bold text-white"
                  >
                    Panduan Tambah Kasir
                  </button>
                </div>
                <ol className="mt-4 space-y-2 text-sm text-[#52627d]">
                  {addUserSteps.map((step, index) => (
                    <li key={step}>
                      {index + 1}. {step}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="rounded-[20px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
                <div className="flex items-center justify-between border-b border-[#eef1f1] px-5 py-4">
                  <h2 className="text-[18px] font-extrabold text-[#1b1e20]">
                    Manajemen Pengguna
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
                                      ? 'rounded-full bg-[#ccfaf1] px-3 py-1 text-[10px] font-extrabold uppercase text-[#0a7c72]'
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
                                      ? 'text-sm font-bold text-[#0a7c72]'
                                      : 'text-sm font-bold text-[#ba1a1a]'
                                  }
                                >
                                  {profile.is_active ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                {isAdmin ? (
                                  <button
                                    type="button"
                                    disabled={updatingProfileId === profile.id}
                                    onClick={() => void toggleProfileActive(profile)}
                                    className="rounded-[12px] bg-[#eef3f3] px-4 py-2 text-sm font-bold text-[#52627d] disabled:opacity-60"
                                  >
                                    {updatingProfileId === profile.id
                                      ? 'Memproses...'
                                      : profile.is_active
                                        ? 'Nonaktifkan'
                                        : 'Aktifkan'}
                                  </button>
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

              <div className="rounded-[20px] border border-[#d5ebe7] bg-[#f4fffc] p-6">
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
                      className="h-12 w-full rounded-[14px] border-none bg-[#eef0f3] px-4 text-sm outline-none focus:ring-2 focus:ring-[#0a7c72]/15 disabled:opacity-60"
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
                    className="rounded-[14px] bg-[#0a7c72] px-5 py-3 font-bold text-white disabled:opacity-60"
                  >
                    {savingTax ? 'Menyimpan...' : 'Simpan Pengaturan Pajak'}
                  </button>
                </div>
              </form>

              <aside className="rounded-[20px] border border-[#d5ebe7] bg-[#f4fffc] p-6">
                <h3 className="font-extrabold text-[#1b1e20]">Ringkasan Saat Ini</h3>
                <p className="mt-3 text-sm text-[#52627d]">
                  PPN default saat ini:
                  <span className="ml-2 font-bold text-[#0a7c72]">
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
    </main>
  )
}
