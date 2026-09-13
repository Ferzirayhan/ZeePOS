import { supabase } from '../lib/supabase'
import type { CashShift } from '../types/database'

export type { CashShift }

export async function getActiveCashShift(): Promise<CashShift | null> {
  const { data, error } = await supabase.rpc('get_active_cash_shift' as never)

  if (error) {
    throw new Error(error.message)
  }

  return (data as unknown as CashShift) || null
}

export async function openCashShift(modalAwal: number, catatan?: string): Promise<CashShift> {
  const { data, error } = await supabase.rpc('open_cash_shift' as never, {
    p_modal_awal: modalAwal,
    p_catatan: catatan || null,
  } as never)

  if (error) {
    throw new Error(error.message)
  }

  return data as unknown as CashShift
}

export async function closeCashShift(
  shiftId: string,
  uangFisik: number,
  pengeluaran = 0,
  catatan?: string,
): Promise<CashShift> {
  const { data, error } = await supabase.rpc('close_cash_shift' as never, {
    p_shift_id: shiftId,
    p_uang_fisik: uangFisik,
    p_pengeluaran: pengeluaran,
    p_catatan: catatan || null,
  } as never)

  if (error) {
    throw new Error(error.message)
  }

  return data as unknown as CashShift
}

export async function getShiftHistory(limit = 20): Promise<CashShift[]> {
  const { data, error } = await supabase
    .from('cash_shifts')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  return (data as CashShift[]) || []
}
