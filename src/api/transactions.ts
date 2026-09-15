import { supabase } from '../lib/supabase'
import type {
  MetodeBayar,
  PaymentStatus,
  StatusTransaksi,
  Transaction,
  TransactionItem,
  TransactionWithKasir,
} from '../types/database'

export interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  metodeBayar?: MetodeBayar
  paymentStatus?: PaymentStatus
  status?: StatusTransaksi
  kasirId?: string
  search?: string
}

export interface TransactionCartItem {
  productId: number
  namaProduk: string
  hargaSatuan: number
  qty: number
  subtotal: number
  diskonItemPersen?: number
  satuan?: string
  rasio?: number
  unitId?: number
}

export interface CreateTransactionInput {
  items: TransactionCartItem[]
  subtotal: number
  diskonPersen?: number
  diskonAmount?: number
  ppnPersen?: number
  ppnAmount?: number
  total: number
  metodeBayar: MetodeBayar
  uangDiterima?: number | null
  kembalian?: number | null
  catatan?: string | null
  customerId?: number | null
  idempotencyKey?: string | null
}

export interface TransactionDetail {
  transaction: Transaction
  items: TransactionItem[]
}

const TRANSACTION_SYNC_RETRY_LIMIT = 5
const TRANSACTION_SYNC_DELAY_MS = 250

async function waitForTransactionDetail(
  id: number,
  predicate: (detail: TransactionDetail) => boolean,
): Promise<TransactionDetail> {
  let lastDetail: TransactionDetail | null = null

  for (let attempt = 0; attempt < TRANSACTION_SYNC_RETRY_LIMIT; attempt += 1) {
    const detail = await getTransactionById(id)

    if (detail) {
      lastDetail = detail

      if (predicate(detail)) {
        return detail
      }
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, TRANSACTION_SYNC_DELAY_MS)
    })
  }

  if (lastDetail) {
    return lastDetail
  }

  throw new Error('Detail transaksi tidak ditemukan')
}

async function getCurrentProfileId(): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    throw new Error(error.message)
  }

  return user?.id ?? null
}

export async function getTransactions(
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
  let query = supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }

  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo)
  }

  if (filters.metodeBayar) {
    query = query.eq('metode_bayar', filters.metodeBayar)
  }

  if (filters.paymentStatus) {
    query = query.eq('payment_status', filters.paymentStatus)
  }

  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.kasirId) {
    query = query.eq('kasir_id', filters.kasirId)
  }

  if (filters.search) {
    query = query.ilike('nomor_nota', `%${filters.search}%`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getTransactionById(
  id: number,
): Promise<TransactionDetail | null> {
  const { data: transaction, error: transactionError } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (transactionError) {
    throw new Error(transactionError.message)
  }

  if (!transaction) {
    return null
  }

  const { data: items, error: itemsError } = await supabase
    .from('transaction_items')
    .select('*')
    .eq('transaction_id', id)
    .order('id', { ascending: true })

  if (itemsError) {
    throw new Error(itemsError.message)
  }

  return {
    transaction,
    items: items ?? [],
  }
}

export interface CommittedTransactionResult {
  transaction?: Transaction
  transaction_id: number
  nomor_nota: string
  payment_status: PaymentStatus
  subtotal: number
  diskon_persen?: number
  diskon_amount: number
  ppn_persen?: number
  ppn_amount: number
  total: number
  kembalian: number
  metode_bayar?: string
  uang_diterima?: number | null
  kasir_id?: string | null
  customer_id?: number | null
  catatan?: string | null
  status?: string
  paid_at?: string | null
  created_at?: string | null
  items?: TransactionItem[]
  idempotent?: boolean
}

export async function commitTransaction(
  payload: CreateTransactionInput,
): Promise<CommittedTransactionResult> {
  if (payload.items.length === 0) {
    throw new Error('Keranjang transaksi tidak boleh kosong')
  }

  const kasirId = await getCurrentProfileId()
  if (!kasirId) {
    throw new Error('Sesi kasir tidak ditemukan')
  }

  const { data, error } = await supabase.rpc('create_transaction_atomic', {
    p_items: JSON.stringify(
      payload.items.map((item) => ({
        product_id: item.productId,
        nama_produk: item.namaProduk,
        harga_satuan: item.hargaSatuan,
        qty: item.qty,
        subtotal: item.subtotal,
        diskon_item_persen: item.diskonItemPersen ?? 0,
        satuan: item.satuan ?? 'pcs',
        rasio: item.rasio ?? 1,
        unit_id: item.unitId ?? null,
      })),
    ),
    p_kasir_id: kasirId,
    p_subtotal: payload.subtotal,
    p_diskon_persen: payload.diskonPersen ?? 0,
    p_diskon_amount: payload.diskonAmount ?? 0,
    p_ppn_persen: payload.ppnPersen ?? 0,
    p_ppn_amount: payload.ppnAmount ?? 0,
    p_total: payload.total,
    p_metode_bayar: payload.metodeBayar,
    p_uang_diterima: payload.uangDiterima ?? null,
    p_kembalian: payload.kembalian ?? null,
    p_catatan: payload.catatan ?? null,
    p_customer_id: payload.customerId ?? null,
    p_idempotency_key: payload.idempotencyKey ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }

  const transactionId = Number(data?.transaction_id ?? 0)

  if (!transactionId) {
    throw new Error('Sistem belum mengembalikan transaksi yang valid')
  }

  const responseData = data as Record<string, unknown> | null
  const trxObj = (responseData?.transaction as Transaction) || undefined

  return {
    transaction: trxObj,
    transaction_id: transactionId,
    nomor_nota: String(responseData?.nomor_nota ?? ''),
    payment_status: (responseData?.payment_status as PaymentStatus) ?? 'dibayar',
    subtotal: Number(responseData?.subtotal ?? payload.subtotal),
    diskon_persen: Number(responseData?.diskon_persen ?? payload.diskonPersen ?? 0),
    diskon_amount: Number(responseData?.diskon_amount ?? payload.diskonAmount ?? 0),
    ppn_persen: Number(responseData?.ppn_persen ?? payload.ppnPersen ?? 0),
    ppn_amount: Number(responseData?.ppn_amount ?? payload.ppnAmount ?? 0),
    total: Number(responseData?.total ?? payload.total),
    kembalian: Number(responseData?.kembalian ?? payload.kembalian ?? 0),
    metode_bayar: String(responseData?.metode_bayar ?? payload.metodeBayar),
    uang_diterima: responseData?.uang_diterima !== undefined ? Number(responseData.uang_diterima) : payload.uangDiterima,
    kasir_id: (responseData?.kasir_id as string) ?? kasirId,
    customer_id: responseData?.customer_id ? Number(responseData.customer_id) : (payload.customerId ?? null),
    catatan: (responseData?.catatan as string) ?? payload.catatan ?? null,
    status: (responseData?.status as string) ?? 'selesai',
    paid_at: (responseData?.paid_at as string) ?? null,
    created_at: (responseData?.created_at as string) ?? null,
    items: Array.isArray(responseData?.items) ? (responseData.items as TransactionItem[]) : undefined,
    idempotent: Boolean(responseData?.idempotent),
  }
}

export async function createTransaction(
  payload: CreateTransactionInput,
): Promise<TransactionDetail> {
  const committed = await commitTransaction(payload)
  return waitForTransactionDetail(committed.transaction_id, () => true)
}

export async function getPendingTransactions(): Promise<TransactionWithKasir[]> {
  const now = new Date()
  const offsetMs = 7 * 60 * 60 * 1000
  const wibNow = new Date(now.getTime() + offsetMs)
  const wibDateStr = wibNow.toISOString().slice(0, 10)
  const start = new Date(`${wibDateStr}T00:00:00+07:00`).toISOString()
  // Batas atas eksklusif: semua transaksi hari ini sampai detik terakhir tercakup.
  const end = new Date(`${wibDateStr}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000

  const { data, error } = await supabase
    .from('transactions_with_kasir')
    .select('*')
    .eq('status', 'selesai')
    .eq('payment_status', 'menunggu_konfirmasi')
    .gte('created_at', start)
    .lt('created_at', new Date(end).toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function confirmTransactionPayment(
  id: number,
  paymentReference?: string | null,
): Promise<TransactionDetail> {
  const { error } = await supabase.rpc('confirm_transaction_payment', {
    p_transaction_id: id,
    p_payment_reference: paymentReference ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return waitForTransactionDetail(
    id,
    (detail) => detail.transaction.payment_status === 'dibayar',
  )
}

export async function cancelPendingTransaction(
  id: number,
  reason?: string | null,
): Promise<TransactionDetail> {
  const { error } = await supabase.rpc('cancel_pending_transaction', {
    p_transaction_id: id,
    p_reason: reason ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return waitForTransactionDetail(
    id,
    (detail) =>
      detail.transaction.status === 'batal' &&
      detail.transaction.payment_status === 'gagal',
  )
}

export async function cancelTransaction(id: number): Promise<Transaction> {
  const { error } = await supabase.rpc('cancel_transaction_atomic', {
    p_transaction_id: id,
  })

  if (error) {
    throw new Error(error.message)
  }

  const detail = await waitForTransactionDetail(
    id,
    (currentDetail) => currentDetail.transaction.status === 'batal',
  )

  return detail.transaction
}
