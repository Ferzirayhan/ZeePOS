import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getCustomers,
  createCustomer,
  getReceivables,
  payReceivable,
} from '../api/customers'
import type { Customer, Receivable } from '../types/database'
import { formatRupiah } from '../utils/currency'
import { Modal } from '../components/ui/Modal'
import { useToastStore } from '../stores/toastStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../utils/cn'

export function CustomersPage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const pushToast = useToastStore((state) => state.pushToast)
  const [activeTab, setActiveTab] = useState<'customers' | 'receivables'>('customers')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Modal Tambah Pelanggan
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [nama, setNama] = useState('')
  const [telepon, setTelepon] = useState('')
  const [alamat, setAlamat] = useState('')
  const [catatan, setCatatan] = useState('')
  const [submittingCustomer, setSubmittingCustomer] = useState(false)

  // Modal Bayar Piutang
  const [selectedReceivable, setSelectedReceivable] = useState<Receivable | null>(null)
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState<string>('')
  const [nominalBayar, setNominalBayar] = useState('')
  const [metodeBayar, setMetodeBayar] = useState('tunai')
  const [catatanBayar, setCatatanBayar] = useState('')
  const [submittingPayment, setSubmittingPayment] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [custData, recData] = await Promise.all([
        getCustomers(search),
        getReceivables(),
      ])
      setCustomers(custData)
      setReceivables(recData)
    } catch (err) {
      pushToast({
        title: 'Gagal memuat data pelanggan',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [search, pushToast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nama.trim()) return

    try {
      setSubmittingCustomer(true)
      await createCustomer({ nama, telepon, alamat, catatan })
      setIsAddModalOpen(false)
      setNama('')
      setTelepon('')
      setAlamat('')
      setCatatan('')
      pushToast({
        title: 'Pelanggan Tersimpan',
        description: `Pelanggan "${nama}" berhasil didaftarkan.`,
        variant: 'success',
      })
      void loadData()
    } catch (err) {
      pushToast({
        title: 'Gagal Menambah Pelanggan',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setSubmittingCustomer(false)
    }
  }

  // Map untuk menyimpan idempotency key per-receivable ID agar stabil bahkan jika modal ditutup-buka
  const receivableIdempotencyMap = useRef<Record<number, string>>({})

  const handleOpenPayModal = (r: Receivable) => {
    setSelectedReceivable(r)
    setNominalBayar(String(r.sisa_hutang))
    setMetodeBayar('tunai')
    setCatatanBayar('')
    if (!receivableIdempotencyMap.current[r.id]) {
      receivableIdempotencyMap.current[r.id] = crypto.randomUUID()
    }
    setPaymentIdempotencyKey(receivableIdempotencyMap.current[r.id])
  }

  const handleClosePayModal = () => {
    setSelectedReceivable(null)
    setNominalBayar('')
    setCatatanBayar('')
    // Biarkan key tersimpan di ref sampai pembayaran benar-benar berhasil terkonfirmasi
  }

  const handlePaySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedReceivable) return
    const jumlah = Number(nominalBayar.replace(/\D/g, ''))
    if (jumlah <= 0) return

    const keyToUse = paymentIdempotencyKey || crypto.randomUUID()
    if (!paymentIdempotencyKey) {
      setPaymentIdempotencyKey(keyToUse)
    }

    try {
      setSubmittingPayment(true)
      const res = await payReceivable({
        receivableId: selectedReceivable.id,
        jumlah,
        metodeBayar,
        catatan: catatanBayar,
        idempotencyKey: keyToUse,
      })

      delete receivableIdempotencyMap.current[selectedReceivable.id]
      handleClosePayModal()
      pushToast({
        title: 'Pembayaran Piutang Berhasil',
        description: `Penerimaan Rp ${jumlah.toLocaleString('id-ID')} tersimpan. Status: ${res.status.toUpperCase()}`,
        variant: 'success',
      })
      void loadData()
    } catch (err) {
      pushToast({
        title: 'Gagal Memproses Pembayaran',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan sistem',
        variant: 'error',
      })
    } finally {
      setSubmittingPayment(false)
    }
  }

  const totalHutangKeseluruhan = customers.reduce((sum, c) => sum + Number(c.total_hutang || 0), 0)
  const totalPiutangBelumLunas = receivables
    .filter((r) => r.status !== 'lunas')
    .reduce((sum, r) => sum + Number(r.sisa_hutang || 0), 0)

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pb-28 pt-16 transition-[margin] duration-200 md:pb-8 md:pt-6',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header Halaman */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-black text-[#1f2937]">
            Pelanggan & Buku Piutang
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Kelola data pelanggan tetap, catatan bon toko, dan cicilan tagihan pelanggan.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#2563eb] px-5 py-3.5 font-display text-sm font-bold text-white shadow-lg shadow-blue-500/20 hover:bg-[#1d4ed8] transition"
        >
          <span className="material-symbols-outlined text-lg">person_add</span>
          <span>Tambah Pelanggan</span>
        </button>
      </div>

      {/* Ringkasan Statistik */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Pelanggan</span>
          <p className="mt-2 font-display text-3xl font-black text-[#1f2937]">{customers.length}</p>
          <p className="text-xs text-slate-400 mt-1">Pelanggan terdaftar aktif</p>
        </div>

        <div className="rounded-3xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Total Piutang Berjalan</span>
          <p className="mt-2 font-display text-3xl font-black text-amber-900">
            {formatRupiah(totalPiutangBelumLunas || totalHutangKeseluruhan)}
          </p>
          <p className="text-xs text-amber-700/80 mt-1">Tagihan bon belum lunas</p>
        </div>

        <div className="rounded-3xl border border-blue-200 bg-blue-50/50 p-5 shadow-sm">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Nota Piutang Aktif</span>
          <p className="mt-2 font-display text-3xl font-black text-blue-900">
            {receivables.filter((r) => r.status !== 'lunas').length}
          </p>
          <p className="text-xs text-blue-700/80 mt-1">Faktur bon sedang berjalan</p>
        </div>
      </div>

      {/* Tab Navigasi */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className={cn(
            'px-5 py-2.5 rounded-2xl font-display text-sm font-bold transition',
            activeTab === 'customers'
              ? 'bg-[#2563eb] text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          Daftar Pelanggan ({customers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('receivables')}
          className={cn(
            'px-5 py-2.5 rounded-2xl font-display text-sm font-bold transition',
            activeTab === 'receivables'
              ? 'bg-[#2563eb] text-white shadow-md'
              : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          Buku Piutang / Bon ({receivables.length})
        </button>
      </div>

      {/* Konten Tab Pelanggan */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama pelanggan..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium text-[#1f2937] outline-none shadow-sm transition focus:border-[#2563eb]"
            />
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#1f2937]">
                <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-6 py-4">Nama Pelanggan</th>
                    <th className="px-6 py-4">No. Telepon / WA</th>
                    <th className="px-6 py-4">Alamat</th>
                    <th className="px-6 py-4 text-right">Saldo Hutang</th>
                    <th className="px-6 py-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400">
                        Memuat data pelanggan...
                      </td>
                    </tr>
                  ) : customers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400">
                        Belum ada data pelanggan terdaftar.
                      </td>
                    </tr>
                  ) : (
                    customers.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition">
                        <td className="px-6 py-4 font-bold text-slate-800">
                          {c.nama}
                          {c.catatan && <p className="text-xs font-normal text-slate-400">{c.catatan}</p>}
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-600">
                          {c.telepon ? (
                            <a
                              href={`https://wa.me/${c.telepon.replace(/\D/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#2563eb] hover:underline inline-flex items-center gap-1"
                            >
                              <span>{c.telepon}</span>
                            </a>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-xs max-w-xs truncate">
                          {c.alamat || '-'}
                        </td>
                        <td className="px-6 py-4 text-right font-display font-black text-slate-800">
                          {Number(c.total_hutang) > 0 ? (
                            <span className="text-amber-600">{formatRupiah(Number(c.total_hutang))}</span>
                          ) : (
                            <span className="text-[#16a34a]">Rp 0</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span
                            className={cn(
                              'inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase',
                              Number(c.total_hutang) > 0
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-[#16a34a]',
                            )}
                          >
                            {Number(c.total_hutang) > 0 ? 'Ada Bon' : 'Lunas'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Konten Tab Buku Piutang */}
      {activeTab === 'receivables' && (
        <div className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#1f2937]">
              <thead className="bg-slate-50 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-6 py-4">Nomor Nota</th>
                  <th className="px-6 py-4">Pelanggan</th>
                  <th className="px-6 py-4 text-right">Total Bon</th>
                  <th className="px-6 py-4 text-right">Sudah Dibayar</th>
                  <th className="px-6 py-4 text-right">Sisa Hutang</th>
                  <th className="px-6 py-4 text-center">Status</th>
                  <th className="px-6 py-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receivables.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      Tidak ada catatan piutang aktif.
                    </td>
                  </tr>
                ) : (
                  receivables.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80 transition">
                      <td className="px-6 py-4 font-mono font-bold text-[#2563eb]">
                        {r.nomor_nota}
                        {r.jatuh_tempo && (
                          <p className="text-[10px] font-sans text-slate-400">
                            Jatuh tempo: {new Date(r.jatuh_tempo).toLocaleDateString('id-ID')}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 font-bold text-slate-800">
                        {r.customer?.nama || `Pelanggan #${r.customer_id}`}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-slate-600">
                        {formatRupiah(Number(r.total_tagihan))}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-[#16a34a]">
                        {formatRupiah(Number(r.jumlah_dibayar))}
                      </td>
                      <td className="px-6 py-4 text-right font-display font-black text-amber-600">
                        {formatRupiah(Number(r.sisa_hutang))}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className={cn(
                            'inline-block px-2.5 py-1 rounded-full text-[10px] font-black uppercase',
                            r.status === 'lunas'
                              ? 'bg-emerald-100 text-[#16a34a]'
                              : r.status === 'sebagian'
                                ? 'bg-blue-100 text-[#2563eb]'
                                : 'bg-amber-100 text-amber-800',
                          )}
                        >
                          {r.status === 'belum_lunas' ? 'Belum Lunas' : r.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {r.status !== 'lunas' ? (
                          <button
                            type="button"
                            onClick={() => handleOpenPayModal(r)}
                            className="px-3.5 py-1.5 rounded-xl bg-[#2563eb] text-white text-xs font-bold hover:bg-[#1d4ed8] transition shadow-sm"
                          >
                            Bayar Cicilan
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Selesai</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tambah Pelanggan */}
      <Modal open={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} size="sm">
        <form onSubmit={handleCreateCustomer}>
          <div className="bg-[#f8f9fa] p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display font-black text-slate-800 text-base">Tambah Pelanggan Baru</h3>
            <button
              type="button"
              onClick={() => setIsAddModalOpen(false)}
              className="w-8 h-8 rounded-xl bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 transition"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <div className="p-6 bg-white space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Nama Lengkap / Nama Toko *
              </label>
              <input
                type="text"
                required
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder="Contoh: Pak Budi / Toko Berkah"
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Nomor Telepon / WhatsApp
              </label>
              <input
                type="tel"
                value={telepon}
                onChange={(e) => setTelepon(e.target.value)}
                placeholder="081234567890"
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Alamat Pelanggan
              </label>
              <textarea
                rows={2}
                value={alamat}
                onChange={(e) => setAlamat(e.target.value)}
                placeholder="Alamat atau patokan toko"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Catatan
              </label>
              <input
                type="text"
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="Misal: langganan kantong plastik HD"
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
              />
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="flex-1 py-3.5 rounded-xl border border-slate-200 bg-white font-display text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submittingCustomer}
                className="flex-[2] py-3.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] font-display text-sm font-bold text-white shadow-md transition"
              >
                {submittingCustomer ? 'Menyimpan...' : 'Simpan Pelanggan'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Modal Bayar Piutang */}
      <Modal open={Boolean(selectedReceivable)} onClose={handleClosePayModal} size="sm">
        {selectedReceivable && (
          <form onSubmit={handlePaySubmit}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-display font-black text-slate-900 text-lg">Bayar Tagihan Piutang</h3>
                <p className="text-xs text-slate-500">Nota: {selectedReceivable.nomor_nota}</p>
              </div>
              <button
                type="button"
                onClick={handleClosePayModal}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition"
              >
                ✕
              </button>
            </div>

            <div className="p-6 bg-white space-y-4">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Sisa Hutang</p>
                  <p className="text-xs text-amber-600 mt-0.5">{selectedReceivable.customer?.nama || 'Pelanggan'}</p>
                </div>
                <div className="font-display text-2xl font-black text-amber-900">
                  {formatRupiah(Number(selectedReceivable.sisa_hutang))}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Jumlah yang Dibayarkan (Rp) *
                </label>
                <input
                  type="text"
                  required
                  value={nominalBayar ? new Intl.NumberFormat('id-ID').format(Number(nominalBayar)) : ''}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '')
                    setNominalBayar(raw)
                  }}
                  placeholder="0"
                  className="mt-1.5 h-14 w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 font-display text-xl font-black text-slate-800 outline-none focus:border-[#2563eb] focus:bg-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Metode Pembayaran
                </label>
                <select
                  value={metodeBayar}
                  onChange={(e) => setMetodeBayar(e.target.value)}
                  className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-700 outline-none focus:border-[#2563eb]"
                >
                  <option value="tunai">Tunai / Kas Toko</option>
                  <option value="transfer">Transfer Bank</option>
                  <option value="qris">QRIS</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Catatan Pembayaran
                </label>
                <input
                  type="text"
                  value={catatanBayar}
                  onChange={(e) => setCatatanBayar(e.target.value)}
                  placeholder="Misal: Cicilan ke-1 tunai"
                  className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
                />
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClosePayModal}
                  className="flex-1 py-3.5 rounded-xl border border-slate-200 bg-white font-display text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment || Number(nominalBayar) <= 0}
                  className="flex-[2] py-3.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] font-display text-sm font-bold text-white shadow-md transition disabled:opacity-50"
                >
                  {submittingPayment ? 'Memproses...' : 'Simpan Pembayaran'}
                </button>
              </div>
            </div>
          </form>
        )}
      </Modal>
      </div>
    </main>
  )
}
