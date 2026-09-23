/**
 * Uji behavioural klaster B (task 9.1, design B.1, Property 10) dan klaster C
 * (task 10.3, design C.1, Property 13).
 *
 * Dua cacat yang diuji di sini sama-sama membuat aplikasi tidak dapat dipakai:
 * - `refund_transaction_atomic` tidak punya satu pun pemanggil di `src/`, jadi
 *   refund tidak dapat dijalankan dari aplikasi sama sekali.
 * - `commitTransaction` menunggu tanpa batas, sehingga saat server tidak
 *   merespons blok `finally` pemanggil tidak pernah berjalan dan kasir tidak
 *   tahu apakah penjualannya masuk.
 *
 * **Validates: Requirements 2.1, 2.7, 3.3**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isRequestTimeoutError } from '../lib/fetchWithTimeout'

const rpc = vi.fn()
const getUser = vi.fn()
const from = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => from(table),
    auth: { getUser: () => getUser() },
  },
}))

import {
  CHECKOUT_TIMEOUT_MESSAGE,
  commitTransaction,
  refundTransaction,
} from '../api/transactions'

/**
 * Jalur baca minimal yang dipakai `waitForTransactionDetail`:
 * `from('transactions').select('*').eq('id', id).maybeSingle()` dan
 * `from('transaction_items').select('*').eq('transaction_id', id).order(...)`.
 */
function mockReadPath(transaction: Record<string, unknown>) {
  from.mockImplementation((table: string) => {
    if (table === 'transactions') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: transaction, error: null }),
          }),
        }),
      }
    }

    return {
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }
  })
}

const CART_ITEM = {
  productId: 1,
  namaProduk: 'Kantong Plastik',
  hargaSatuan: 10_000,
  qty: 1,
  subtotal: 10_000,
}

afterEach(() => {
  rpc.mockReset()
  getUser.mockReset()
  from.mockReset()
})

describe('refundTransaction — validasi klien sebelum RPC (task 9.1)', () => {
  it('menolak alasan kosong secara lokal tanpa memanggil RPC', async () => {
    await expect(
      refundTransaction({ transactionId: 7, alasan: '', idempotencyKey: 'kunci-1' }),
    ).rejects.toThrow('Alasan refund wajib diisi')

    expect(rpc).not.toHaveBeenCalled()
  })

  it('menolak alasan yang hanya berisi spasi', async () => {
    await expect(
      refundTransaction({ transactionId: 7, alasan: '   ', idempotencyKey: 'kunci-1' }),
    ).rejects.toThrow('Alasan refund wajib diisi')

    expect(rpc).not.toHaveBeenCalled()
  })

  it('menolak kunci idempotensi kosong secara lokal tanpa memanggil RPC', async () => {
    await expect(
      refundTransaction({ transactionId: 7, alasan: 'Barang rusak', idempotencyKey: '  ' }),
    ).rejects.toThrow(/Kunci idempotensi .* wajib disertakan/)

    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('refundTransaction — pemanggilan RPC (task 9.1, Property 10)', () => {
  it('memakai nama parameter server yang tepat dan mengembalikan RefundResult', async () => {
    rpc.mockResolvedValue({
      data: {
        success: true,
        refund_id: 1,
        transaction_id: 7,
        nomor_nota: 'NOTA-20260922-0001',
        status: 'batal',
        total_refund: 12_500,
        idempotent: false,
      },
      error: null,
    })
    mockReadPath({ id: 7, status: 'batal', payment_status: 'dibayar' })

    const result = await refundTransaction({
      transactionId: 7,
      alasan: '  Barang rusak  ',
      idempotencyKey: '  kunci-1  ',
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    const [fnName, params] = rpc.mock.calls[0] as [string, Record<string, unknown>]

    expect(fnName).toBe('refund_transaction_atomic')
    expect(Object.keys(params).sort()).toEqual([
      'p_alasan',
      'p_idempotency_key',
      'p_transaction_id',
    ])
    expect(params).toEqual({
      p_transaction_id: 7,
      p_alasan: 'Barang rusak',
      p_idempotency_key: 'kunci-1',
    })

    expect(result).toEqual({
      success: true,
      refund_id: 1,
      transaction_id: 7,
      nomor_nota: 'NOTA-20260922-0001',
      status: 'batal',
      total_refund: 12_500,
      idempotent: false,
    })
  })

  it('menunggu jalur baca melihat status batal, konsisten dengan cancelTransaction', async () => {
    rpc.mockResolvedValue({
      data: { success: true, refund_id: 2, transaction_id: 9, status: 'batal', total_refund: 5_000 },
      error: null,
    })
    mockReadPath({ id: 9, status: 'batal', payment_status: 'dibayar' })

    await refundTransaction({ transactionId: 9, alasan: 'Salah input', idempotencyKey: 'kunci-2' })

    expect(from).toHaveBeenCalledWith('transactions')
  })

  it('meneruskan syarat shift kasir dari server apa adanya', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.',
      },
    })

    await expect(
      refundTransaction({ transactionId: 7, alasan: 'Barang rusak', idempotencyKey: 'kunci-3' }),
    ).rejects.toThrow('Refund tunai membutuhkan shift kasir aktif. Buka shift terlebih dahulu.')
  })

  it('meneruskan penolakan kunci idempotensi dari server apa adanya', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'Kunci idempotensi sudah digunakan untuk transaksi refund berbeda',
      },
    })

    await expect(
      refundTransaction({ transactionId: 7, alasan: 'Alasan lain', idempotencyKey: 'kunci-3' }),
    ).rejects.toThrow('Kunci idempotensi sudah digunakan untuk transaksi refund berbeda')
  })
})

describe('commitTransaction — deadline checkout (task 10.3, Property 13)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('settle dengan RequestTimeoutError saat RPC tidak pernah menjawab, sehingga `finally` berjalan', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'kasir-1' } }, error: null })
    // Captive portal: koneksi terbuka, respons tidak pernah datang.
    rpc.mockImplementation(() => new Promise(() => {}))

    let finallyRan = false
    let caught: unknown = null

    const attempt = (async () => {
      try {
        await commitTransaction({
          items: [CART_ITEM],
          subtotal: 10_000,
          total: 10_000,
          metodeBayar: 'tunai',
        })
      } catch (error) {
        caught = error
      } finally {
        finallyRan = true
      }
    })()

    await vi.advanceTimersByTimeAsync(20_000)
    await attempt

    expect(finallyRan).toBe(true)
    expect(isRequestTimeoutError(caught)).toBe(true)
    expect((caught as Error).message).toBe(CHECKOUT_TIMEOUT_MESSAGE)
  })

  it('pesan timeout menyebut batas waktu dan menjamin tidak ada kiriman ganda', () => {
    expect(CHECKOUT_TIMEOUT_MESSAGE).toContain('15 detik')
    expect(CHECKOUT_TIMEOUT_MESSAGE).toContain('Coba Lagi')
    expect(CHECKOUT_TIMEOUT_MESSAGE).toContain('tidak akan terkirim dua kali')
  })

  it('tidak mengubah hasil checkout yang selesai sebelum deadline', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'kasir-1' } }, error: null })
    rpc.mockResolvedValue({
      data: { transaction_id: 11, nomor_nota: 'NOTA-1', total: 10_000, idempotent: false },
      error: null,
    })

    const committed = await commitTransaction({
      items: [CART_ITEM],
      subtotal: 10_000,
      total: 10_000,
      metodeBayar: 'tunai',
      idempotencyKey: 'zeepos-abc',
    })

    expect(committed.transaction_id).toBe(11)
    expect(committed.nomor_nota).toBe('NOTA-1')

    const params = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(params.p_idempotency_key).toBe('zeepos-abc')
  })
})
