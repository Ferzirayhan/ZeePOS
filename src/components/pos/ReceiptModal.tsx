import { useMemo, useRef } from 'react'
import { useReactToPrint } from 'react-to-print'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { CurrencyDisplay } from '../ui/CurrencyDisplay'
import type { Profile, Transaction, TransactionItem } from '../../types/database'
import { ReceiptPrint, receiptPrintPageStyle } from './ReceiptPrint'
import { buildWhatsAppUrl } from '../../utils/whatsapp'

interface ReceiptModalProps {
  open: boolean
  onClose: () => void
  onNewTransaction: () => void
  transaction: Transaction | null
  items: TransactionItem[]
  settings: Record<string, string>
  cashier: Profile | null
  onThermalPrint?: () => void
  printingThermal?: boolean
}

export function ReceiptModal({
  open,
  onClose,
  onNewTransaction,
  transaction,
  items,
  settings,
  cashier,
  onThermalPrint,
  printingThermal = false,
}: ReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: transaction?.nomor_nota ?? 'struk-transaksi',
    pageStyle: receiptPrintPageStyle,
  })

  const whatsappText = useMemo(() => {
    if (!transaction) {
      return ''
    }

    const lines = [
      settings.nama_toko || 'Toko',
      `No. Nota: ${transaction.nomor_nota}`,
      `Kasir: ${cashier?.nama ?? '-'}`,
      '',
      ...items.map(
        (item) =>
          `${item.nama_produk} (${item.qty}x) - ${new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            maximumFractionDigits: 0,
          }).format(Number(item.subtotal))}`,
      ),
      '',
      `Total: ${new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(Number(transaction.total))}`,
      `Bayar: ${new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(Number(transaction.uang_diterima ?? transaction.total ?? 0))}`,
      `Kembalian: ${new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
      }).format(Number(transaction.kembalian ?? 0))}`,
    ]

    return lines.join('\n')
  }, [cashier?.nama, items, settings.nama_toko, transaction])

  if (!transaction) {
    return null
  }

  const isPaid = transaction.payment_status === 'dibayar'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={isPaid ? 'Pembayaran Berhasil!' : 'Pembayaran Menunggu Konfirmasi'}
      description={`Transaksi ${transaction.nomor_nota}`}
    >
      <div className="space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className={isPaid
            ? 'flex h-20 w-20 items-center justify-center rounded-full bg-[#dbeafe]'
            : 'flex h-20 w-20 items-center justify-center rounded-full bg-[#fff5e8]'}>
            <span className={isPaid
              ? 'material-symbols-outlined text-[42px] text-[#2563eb]'
              : 'material-symbols-outlined text-[42px] text-[#855300]'}>
              {isPaid ? 'check' : 'schedule'}
            </span>
          </div>
          <p className="mt-4 text-sm font-medium text-[#6d7a77]">
            {isPaid
              ? 'Pembayaran berhasil diproses dan struk siap dicetak.'
              : 'Pembayaran belum dikonfirmasi, jadi struk belum bisa dicetak.'}
          </p>
        </div>

        <div className="rounded-[20px] bg-[#f7f9f9] p-5">
          <div className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#6d7a77]">Metode Bayar</span>
              <span className="font-bold capitalize text-[#1b1e20]">
                {transaction.metode_bayar}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#6d7a77]">Status Pembayaran</span>
              <span className={isPaid
                ? 'rounded-full bg-[#ccfaf1] px-3 py-1 text-[10px] font-extrabold uppercase text-[#2563eb]'
                : 'rounded-full bg-[#fff5e8] px-3 py-1 text-[10px] font-extrabold uppercase text-[#855300]'}>
                {transaction.payment_status.replaceAll('_', ' ')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#6d7a77]">Total Belanja</span>
              <CurrencyDisplay className="font-bold text-[#1b1e20]" value={Number(transaction.total)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#6d7a77]">Bayar</span>
              <CurrencyDisplay
                className="font-bold text-[#1b1e20]"
                value={Number(transaction.uang_diterima ?? transaction.total ?? 0)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-[#2563eb]">Kembalian</span>
              <CurrencyDisplay
                className="font-extrabold text-[#2563eb]"
                value={Number(transaction.kembalian ?? 0)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#8b9895]">
            Ringkasan Item
          </p>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="text-[#1b1e20]">
                  {item.nama_produk} ({item.qty}
                  {item.nama_satuan ? ` ${item.nama_satuan}` : ''}x)
                  {Number(item.diskon_item_persen ?? 0) > 0 && (
                    <span className="ml-1 text-xs font-bold text-[#16a34a]">
                      -{Number(item.diskon_item_persen)}%
                    </span>
                  )}
                </span>
                <CurrencyDisplay value={Number(item.subtotal)} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          {onThermalPrint && (
            <Button
              className="rounded-[14px] bg-[#16a34a] hover:bg-[#15803d] text-white flex items-center justify-center gap-1.5"
              onClick={onThermalPrint}
              disabled={!isPaid || printingThermal}
            >
              <span className="material-symbols-outlined text-base">print</span>
              <span>{printingThermal ? 'Mencetak...' : 'Thermal USB'}</span>
            </Button>
          )}
          <Button
            className="rounded-[14px]"
            onClick={() => void handlePrint()}
            disabled={!isPaid}
          >
            Cetak Browser
          </Button>
          <Button
            variant="secondary"
            className="rounded-[14px]"
            onClick={() => window.open(buildWhatsAppUrl(whatsappText), '_blank')}
            disabled={!isPaid}
          >
            Kirim WA
          </Button>
          <Button variant="ghost" className="rounded-[14px]" onClick={onNewTransaction}>
            Transaksi Baru
          </Button>
        </div>
      </div>

      <div aria-hidden="true" className="fixed -left-[9999px] top-0">
        <ReceiptPrint
          ref={printRef}
          cashier={cashier}
          items={items}
          settings={settings}
          transaction={transaction}
        />
      </div>
    </Modal>
  )
}
