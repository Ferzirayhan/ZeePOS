import { supabase } from '../lib/supabase'
import type { Customer, Receivable, ReceivablePayment } from '../types/database'

export async function getCustomers(search?: string): Promise<Customer[]> {
  let query = supabase
    .from('customers')
    .select('*')
    .eq('is_active', true)
    .order('nama', { ascending: true })

  if (search && search.trim()) {
    query = query.ilike('nama', `%${search.trim()}%`)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data as Customer[]) || []
}

export async function createCustomer(payload: {
  nama: string
  telepon?: string | null
  alamat?: string | null
  catatan?: string | null
}): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      nama: payload.nama.trim(),
      telepon: payload.telepon?.trim() || null,
      alamat: payload.alamat?.trim() || null,
      catatan: payload.catatan?.trim() || null,
      total_hutang: 0,
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data as Customer
}

export async function getReceivables(statusFilter?: 'belum_lunas' | 'sebagian' | 'lunas'): Promise<Receivable[]> {
  let query = supabase
    .from('receivables')
    .select('*, customer:customers(*)')
    .order('created_at', { ascending: false })

  if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data as unknown as Receivable[]) || []
}

export async function payReceivable(payload: {
  receivableId: number
  jumlah: number
  metodeBayar?: string
  catatan?: string | null
  idempotencyKey?: string | null
}): Promise<{
  success: boolean
  payment_id: number
  receivable_id: number
  jumlah_dibayar: number
  sisa_hutang: number
  status: string
  idempotent?: boolean
}> {
  const idempotencyKey = payload.idempotencyKey || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null)

  const { data, error } = await supabase.rpc('pay_receivable_atomic' as never, {
    p_receivable_id: payload.receivableId,
    p_jumlah: payload.jumlah,
    p_metode_bayar: payload.metodeBayar || 'tunai',
    p_catatan: payload.catatan || null,
    p_idempotency_key: idempotencyKey,
  } as never)

  if (error) {
    throw new Error(error.message)
  }

  return data as unknown as {
    success: boolean
    payment_id: number
    receivable_id: number
    jumlah_dibayar: number
    sisa_hutang: number
    status: string
    idempotent?: boolean
  }
}

export async function getReceivablePayments(receivableId: number): Promise<ReceivablePayment[]> {
  const { data, error } = await supabase
    .from('receivable_payments')
    .select('*')
    .eq('receivable_id', receivableId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return (data as ReceivablePayment[]) || []
}
