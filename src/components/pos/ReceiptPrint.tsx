import { forwardRef } from 'react'
import type { Profile, TransactionItem, Transaction } from '../../types/database'
import { formatRupiah } from '../../utils/currency'
import { formatDateTimeIndonesia } from '../../utils/date'

interface ReceiptPrintProps {
  transaction: Transaction
  items: TransactionItem[]
  settings: Record<string, string>
  cashier: Profile | null
}

export const receiptPrintPageStyle = `
  @page {
    margin: 0;
    size: 58mm auto;
  }
  @media print {
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff;
      width: 58mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
`

function getPaymentMethodLabel(method: Transaction['metode_bayar']) {
  switch (method) {
    case 'tunai':
      return 'Tunai'
    case 'transfer':
      return 'Transfer'
    case 'qris':
      return 'QRIS'
    default:
      return method
  }
}

function getPaymentStatusLabel(status: Transaction['payment_status']) {
  switch (status) {
    case 'dibayar':
      return 'Dibayar'
    case 'menunggu_konfirmasi':
      return 'Menunggu'
    case 'gagal':
      return 'Gagal'
    default:
      return status
  }
}

export const ReceiptPrint = forwardRef<HTMLDivElement, ReceiptPrintProps>(
  function ReceiptPrint({ transaction, items, settings, cashier }, ref) {
    const isCash = transaction.metode_bayar === 'tunai'

    return (
      <div
        ref={ref}
        style={{
          width: '56mm',
          margin: '0 auto',
          padding: '4mm',
          background: 'white',
          color: 'black',
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '12px',
          lineHeight: '1.2',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
          {settings.nama_toko || 'Toko'}
        </div>
        <div style={{ textAlign: 'center', fontSize: '11px', whiteSpace: 'pre-line', marginBottom: '8px' }}>
          {settings.header_struk || 'Struk Pembelian'}
        </div>
        
        <hr style={{ borderTop: '1px dashed black', borderBottom: 'none', margin: '8px 0' }} />
        
        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', marginBottom: '8px' }}>
          <tbody>
            <tr>
              <td style={{ verticalAlign: 'top', width: '35%' }}>No</td>
              <td style={{ verticalAlign: 'top', textAlign: 'right', fontWeight: 'bold' }}>{transaction.nomor_nota}</td>
            </tr>
            <tr>
              <td style={{ verticalAlign: 'top' }}>Tanggal</td>
              <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                {transaction.created_at ? formatDateTimeIndonesia(transaction.created_at) : '-'}
              </td>
            </tr>
            <tr>
              <td style={{ verticalAlign: 'top' }}>Kasir</td>
              <td style={{ verticalAlign: 'top', textAlign: 'right' }}>{cashier?.nama ?? '-'}</td>
            </tr>
            <tr>
              <td style={{ verticalAlign: 'top' }}>Metode</td>
              <td style={{ verticalAlign: 'top', textAlign: 'right' }}>{getPaymentMethodLabel(transaction.metode_bayar)}</td>
            </tr>
            <tr>
              <td style={{ verticalAlign: 'top' }}>Status</td>
              <td style={{ verticalAlign: 'top', textAlign: 'right' }}>{getPaymentStatusLabel(transaction.payment_status)}</td>
            </tr>
            {transaction.payment_reference ? (
              <tr>
                <td style={{ verticalAlign: 'top' }}>Ref</td>
                <td style={{ verticalAlign: 'top', textAlign: 'right', wordBreak: 'break-all' }}>{transaction.payment_reference}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <hr style={{ borderTop: '1px dashed black', borderBottom: 'none', margin: '8px 0' }} />
        
        <div style={{ fontSize: '12px', marginBottom: '8px' }}>
          {items.map((item) => (
            <div key={item.id} style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: 'bold', wordBreak: 'break-word', marginBottom: '2px' }}>{item.nama_produk}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{item.qty} x {formatRupiah(Number(item.harga_satuan))}</span>
                <span>{formatRupiah(Number(item.subtotal))}</span>
              </div>
            </div>
          ))}
        </div>

        <hr style={{ borderTop: '1px dashed black', borderBottom: 'none', margin: '8px 0' }} />
        
        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td style={{ textAlign: 'right' }}>{formatRupiah(Number(transaction.subtotal))}</td>
            </tr>
            {Number(transaction.diskon_amount) > 0 && (
              <tr>
                <td>Diskon</td>
                <td style={{ textAlign: 'right' }}>{formatRupiah(Number(transaction.diskon_amount))}</td>
              </tr>
            )}
            {Number(transaction.ppn_amount) > 0 && (
              <tr>
                <td>PPN</td>
                <td style={{ textAlign: 'right' }}>{formatRupiah(Number(transaction.ppn_amount))}</td>
              </tr>
            )}
            <tr>
              <td style={{ fontWeight: 'bold', paddingTop: '4px', fontSize: '12px' }}>Total</td>
              <td style={{ fontWeight: 'bold', textAlign: 'right', paddingTop: '4px', fontSize: '12px' }}>{formatRupiah(Number(transaction.total))}</td>
            </tr>
            <tr>
              <td style={{ paddingTop: '4px' }}>{isCash ? 'Bayar' : 'Tagihan'}</td>
              <td style={{ textAlign: 'right', paddingTop: '4px' }}>
                {formatRupiah(Number(isCash ? (transaction.uang_diterima ?? transaction.total ?? 0) : transaction.total))}
              </td>
            </tr>
            <tr>
              <td style={{ fontWeight: 'bold' }}>{isCash ? 'Kembali' : 'Sisa'}</td>
              <td style={{ fontWeight: 'bold', textAlign: 'right' }}>
               {formatRupiah(Number(isCash ? (transaction.kembalian ?? 0) : 0))}
              </td>
            </tr>
          </tbody>
        </table>

        {transaction.catatan ? (
          <>
            <hr style={{ borderTop: '1px dashed black', borderBottom: 'none', margin: '8px 0' }} />
            <div style={{ fontSize: '11px' }}>
              <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Catatan</div>
              <div style={{ whiteSpace: 'pre-line', wordBreak: 'break-word' }}>{transaction.catatan}</div>
            </div>
          </>
        ) : null}

        <hr style={{ borderTop: '1px dashed black', borderBottom: 'none', margin: '8px 0' }} />
        
        <div style={{ textAlign: 'center', fontSize: '11px', whiteSpace: 'pre-line', marginTop: '4px' }}>
          {settings.footer_struk || 'Terima kasih telah berbelanja'}
        </div>
      </div>
    )
  },
)
