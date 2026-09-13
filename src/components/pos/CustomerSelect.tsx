import { useState, useEffect, useRef } from 'react'
import { getCustomers, createCustomer } from '../../api/customers'
import type { Customer } from '../../types/database'
import { formatRupiah } from '../../utils/currency'
import { Modal } from '../ui/Modal'
import { useToastStore } from '../../stores/toastStore'

interface CustomerSelectProps {
  selectedCustomer: Customer | null
  onSelectCustomer: (customer: Customer | null) => void
}

export function CustomerSelect({
  selectedCustomer,
  onSelectCustomer,
}: CustomerSelectProps) {
  const pushToast = useToastStore((state) => state.pushToast)
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Quick Add Modal
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [nama, setNama] = useState('')
  const [telepon, setTelepon] = useState('')
  const [alamat, setAlamat] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    let active = true
    const fetchCust = async () => {
      setLoading(true)
      try {
        const data = await getCustomers(search)
        if (active) setCustomers(data)
      } catch {
        // Ignore
      } finally {
        if (active) setLoading(false)
      }
    }
    const timer = setTimeout(() => {
      void fetchCust()
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [isOpen, search])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nama.trim()) return
    try {
      setSubmitting(true)
      const newCust = await createCustomer({ nama, telepon, alamat })
      onSelectCustomer(newCust)
      setIsQuickAddOpen(false)
      setNama('')
      setTelepon('')
      setAlamat('')
      setIsOpen(false)
      pushToast({
        title: 'Pelanggan Didaftarkan',
        description: `Pelanggan "${nama}" terpilih untuk pesanan ini.`,
        variant: 'success',
      })
    } catch (err) {
      pushToast({
        title: 'Gagal Menambah Pelanggan',
        description: err instanceof Error ? err.message : 'Terjadi kesalahan.',
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {selectedCustomer ? (
        <div className="flex items-center justify-between rounded-2xl bg-blue-50/70 border border-blue-200/80 px-3.5 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[#2563eb] text-lg">person</span>
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-800 truncate">{selectedCustomer.nama}</p>
              {Number(selectedCustomer.total_hutang || 0) > 0 ? (
                <p className="text-[10px] font-bold text-amber-700">
                  Bon berjalan: {formatRupiah(Number(selectedCustomer.total_hutang))}
                </p>
              ) : (
                <p className="text-[10px] text-slate-400">
                  {selectedCustomer.telepon || 'Pelanggan Langganan'}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSelectCustomer(null)}
            className="w-6 h-6 rounded-full hover:bg-blue-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition"
            title="Ganti ke Pelanggan Umum"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="flex-1 flex items-center justify-between rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-slate-400 text-base">person_add</span>
              <span className="font-semibold">Pelanggan Umum (Guest)</span>
            </div>
            <span className="material-symbols-outlined text-slate-400 text-sm">expand_more</span>
          </button>

          <button
            type="button"
            onClick={() => setIsQuickAddOpen(true)}
            title="Tambah Pelanggan Cepat"
            className="h-10 w-10 rounded-2xl border border-slate-200 bg-white flex items-center justify-center text-slate-600 hover:text-[#2563eb] hover:border-[#2563eb] transition shrink-0 shadow-sm"
          >
            <span className="material-symbols-outlined text-lg">add</span>
          </button>
        </div>
      )}

      {/* Dropdown Menu Pencarian Pelanggan */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          <div className="p-2.5 border-b border-slate-100 bg-slate-50">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ketik nama pelanggan..."
              className="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 outline-none focus:border-[#2563eb]"
            />
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
            <button
              type="button"
              onClick={() => {
                onSelectCustomer(null)
                setIsOpen(false)
              }}
              className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-500 hover:bg-slate-50 flex items-center justify-between"
            >
              <span>Pelanggan Umum (Tanpa Nama)</span>
              <span className="text-[10px] text-slate-400">Default</span>
            </button>

            {loading ? (
              <div className="py-4 text-center text-xs text-slate-400">Mencari...</div>
            ) : customers.length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">
                Pelanggan tidak ditemukan.{' '}
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false)
                    setIsQuickAddOpen(true)
                  }}
                  className="text-[#2563eb] font-bold underline ml-1"
                >
                  + Tambah Baru
                </button>
              </div>
            ) : (
              customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelectCustomer(c)
                    setIsOpen(false)
                  }}
                  className="w-full px-3.5 py-2.5 text-left text-xs hover:bg-blue-50/50 flex items-center justify-between transition"
                >
                  <div>
                    <p className="font-bold text-slate-800">{c.nama}</p>
                    <p className="text-[10px] text-slate-400">{c.telepon || 'Tanpa no. HP'}</p>
                  </div>
                  {Number(c.total_hutang || 0) > 0 && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/60">
                      Bon {formatRupiah(Number(c.total_hutang))}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modal Cepat Tambah Pelanggan */}
      <Modal open={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} size="sm">
        <form onSubmit={handleQuickAdd}>
          <div className="bg-[#f8f9fa] p-5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display font-black text-slate-800 text-base">Tambah Pelanggan Cepat</h3>
            <button
              type="button"
              onClick={() => setIsQuickAddOpen(false)}
              className="w-8 h-8 rounded-xl bg-slate-200/80 hover:bg-slate-300 flex items-center justify-center text-slate-600 transition"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          <div className="p-6 bg-white space-y-4">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Nama Pelanggan *
              </label>
              <input
                type="text"
                required
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder="Misal: Bu Siti Warung Sembako"
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Nomor WhatsApp / HP
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
                Alamat / Catatan
              </label>
              <input
                type="text"
                value={alamat}
                onChange={(e) => setAlamat(e.target.value)}
                placeholder="Patokan lokasi toko"
                className="mt-1.5 h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium outline-none focus:border-[#2563eb] focus:bg-white"
              />
            </div>

            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsQuickAddOpen(false)}
                className="flex-1 py-3.5 rounded-xl border border-slate-200 bg-white font-display text-sm font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-[2] py-3.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] font-display text-sm font-bold text-white shadow-md transition"
              >
                {submitting ? 'Menyimpan...' : 'Simpan & Pilih'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
