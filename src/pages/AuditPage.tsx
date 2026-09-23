import { format, subDays } from 'date-fns'
import { id as localeId } from 'date-fns/locale'
import { useCallback, useEffect, useState } from 'react'
import { getAuditLogs } from '../api/audit'
import { Skeleton } from '../components/ui/Skeleton'
import { useUIStore } from '../stores/uiStore'
import { useToastStore } from '../stores/toastStore'
import { cn } from '../utils/cn'

function formatDateInput(date: Date) {
  return format(date, 'yyyy-MM-dd')
}

function getActionLabel(action: string) {
  switch (action) {
    case 'transaction_created':
      return 'Transaksi Dibuat'
    case 'transaction_cancelled':
      return 'Transaksi Dibatalkan'
    case 'payment_confirmed':
      return 'Pembayaran Dikonfirmasi'
    case 'stock_adjustment':
      return 'Penyesuaian Stok'
    case 'price_updated':
      return 'Harga Diubah'
    case 'receipt_reprint':
      return 'Struk Dicetak Ulang'
    default:
      return action.replaceAll('_', ' ')
  }
}

export function AuditPage() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const pushToast = useToastStore((state) => state.pushToast)
  const [dateFrom, setDateFrom] = useState(formatDateInput(subDays(new Date(), 6)))
  const [dateTo, setDateTo] = useState(formatDateInput(new Date()))
  const [action, setAction] = useState('all')
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof getAuditLogs>>>([])

  const loadAudit = useCallback(async () => {
    setLoading(true)

    try {
      const result = await getAuditLogs({
        dateFrom,
        dateTo,
        action,
        limit: 120,
      })
      setLogs(result)
    } catch (error) {
      pushToast({
        title: 'Gagal memuat audit',
        description: error instanceof Error ? error.message : 'Log audit belum berhasil dimuat.',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [action, dateFrom, dateTo, pushToast])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  return (
    <main
      className={cn(
        'min-h-screen bg-[#f7f9f9] pt-[calc(env(safe-area-inset-top,0px)+4.75rem)] transition-[margin] duration-200 md:pt-0',
        sidebarCollapsed ? 'md:ml-16' : 'md:ml-[220px]',
      )}
    >
      <div className="min-h-screen bg-white md:rounded-l-[24px]">
        <header className="border-b border-[#eef1f1] px-4 py-4 sm:px-6">
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-[#1b1e20]">
            Audit Aktivitas
          </h1>
          <p className="mt-1 text-sm font-medium text-[#8b9895]">
            Pantau siapa yang membuat transaksi, membatalkan, mengubah stok, dan memperbarui harga.
          </p>
        </header>

        <div className="space-y-6 bg-[#f7f9f9] px-4 py-4 sm:px-6 sm:py-6">
          <section className="rounded-[20px] bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Dari
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                />
              </div>
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Sampai
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                />
              </div>
              <div>
                <label className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
                  Jenis Aktivitas
                </label>
                <select
                  value={action}
                  onChange={(event) => setAction(event.target.value)}
                  className="mt-2 h-12 w-full rounded-[16px] border border-transparent bg-[#f1f3f5] px-4 text-sm font-semibold text-[#1b1e20] outline-none focus:border-[#bfdbfe] focus:ring-2 focus:ring-[#2563eb]/10"
                >
                  <option value="all">Semua Aktivitas</option>
                  <option value="transaction_created">Transaksi Dibuat</option>
                  <option value="transaction_cancelled">Transaksi Dibatalkan</option>
                  <option value="payment_confirmed">Pembayaran Dikonfirmasi</option>
                  <option value="stock_adjustment">Penyesuaian Stok</option>
                  <option value="price_updated">Harga Diubah</option>
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-[20px] bg-white shadow-[0_6px_24px_rgba(15,23,42,0.04)]">
            <div className="border-b border-[#eef1f1] px-5 py-4">
              <h2 className="text-[18px] font-extrabold text-[#1b1e20]">Jejak Aktivitas Sistem</h2>
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              {loading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-24 rounded-[16px]" />
                ))
              ) : logs.length > 0 ? (
                logs.map((log) => (
                  <article
                    key={log.id}
                    className="rounded-[18px] border border-[#eef1f1] bg-[#fbfdfd] p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-[10px] font-extrabold uppercase text-[#2563eb]">
                            {getActionLabel(log.action)}
                          </span>
                          <span className="text-xs font-medium text-[#8b9895]">
                            {log.actorNama ?? 'Sistem'}{log.actorRole ? ` · ${log.actorRole}` : ''}
                          </span>
                        </div>
                        <p className="mt-3 text-sm font-bold text-[#1b1e20]">{log.description}</p>
                        <p className="mt-1 text-xs text-[#8b9895]">
                          {log.createdAt
                            ? format(new Date(log.createdAt), 'dd MMM yyyy, HH:mm', { locale: localeId })
                            : '-'}
                        </p>
                      </div>
                      <div className="text-xs text-[#52627d] sm:max-w-[340px] sm:text-right">
                        {log.metadata.nomor_nota ? <p>Nota: {String(log.metadata.nomor_nota)}</p> : null}
                        {typeof log.metadata.keterangan === 'string' && log.metadata.keterangan ? (
                          <p>Keterangan: {log.metadata.keterangan}</p>
                        ) : null}
                        {typeof log.metadata.reference_id === 'string' && log.metadata.reference_id ? (
                          <p>Ref: {log.metadata.reference_id}</p>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="rounded-[16px] bg-[#f8fbfb] px-4 py-8 text-center text-sm text-[#8b9895]">
                  Belum ada log audit pada filter ini.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
