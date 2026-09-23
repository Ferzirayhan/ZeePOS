/**
 * Uji behavioural bounded wait bersama (task 10.1, design C.1, Property 13).
 *
 * Fokusnya satu pertanyaan: apakah pemanggil SELALU mendapat jawaban dalam
 * batas waktu? Task 1 mengukur bahwa tanpa mekanisme ini, `supabase.rpc` yang
 * tidak pernah settle membuat blok `finally` pemanggil tidak pernah berjalan
 * (`{ elapsedMs: 60000, finallyRan: false }`).
 *
 * **Validates: Requirements 2.7**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'

import {
  REQUEST_TIMEOUT_HEADER,
  RequestTimeoutError,
  SUPABASE_REQUEST_TIMEOUT_MS,
  createTimeoutFetch,
  isRequestTimeoutError,
  runWithTimeout,
} from '../lib/fetchWithTimeout'

/** Permintaan yang tidak pernah dijawab, hanya patuh pada pembatalan. */
function hangingFetch() {
  const seen: { init?: RequestInit; signal?: AbortSignal | null }[] = []

  const impl = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        seen.push({ init, signal: init?.signal })
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      }),
  )

  return { impl, seen }
}

describe('runWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('menolak dengan RequestTimeoutError tepat pada batas waktu', async () => {
    const never = () => new Promise<string>(() => {})
    const attempt = runWithTimeout(never, 15_000, 'Simpan transaksi')

    let settled = false
    void attempt.catch(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(14_999)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(attempt).rejects.toBeInstanceOf(RequestTimeoutError)
    await expect(attempt).rejects.toThrow('15 detik')
  })

  it('membatalkan operasi lewat signal yang diberikannya', async () => {
    let received: AbortSignal | undefined
    const attempt = runWithTimeout(
      (signal) => {
        received = signal
        return new Promise<string>(() => {})
      },
      5_000,
      'Muat katalog',
    )

    void attempt.catch(() => {})
    expect(received?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(5_000)
    await expect(attempt).rejects.toSatisfy(isRequestTimeoutError)
    expect(received?.aborted).toBe(true)
  })

  it('tidak mengubah hasil operasi yang settle sebelum batas waktu', async () => {
    const attempt = runWithTimeout(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 1_000)),
      15_000,
      'Muat produk',
    )

    await vi.advanceTimersByTimeAsync(1_000)
    await expect(attempt).resolves.toBe('ok')

    // Melewati deadline setelah operasi selesai tidak memunculkan timeout susulan.
    await vi.advanceTimersByTimeAsync(30_000)
  })

  it('meneruskan kegagalan asli operasi apa adanya', async () => {
    const attempt = runWithTimeout(
      () => Promise.reject(new Error('duplicate key value violates unique constraint')),
      15_000,
      'Simpan transaksi',
    )

    await expect(attempt).rejects.toThrow('duplicate key value')
    await expect(attempt).rejects.not.toSatisfy(isRequestTimeoutError)
  })

  it('PROPERTY: operasi yang tidak pernah settle selalu ditolak pada batas waktunya', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 100, max: 120_000 }), async (timeoutMs) => {
        const attempt = runWithTimeout(
          () => new Promise<void>(() => {}),
          timeoutMs,
          'Permintaan server',
        )

        let outcome: 'pending' | 'timeout' | 'other' = 'pending'
        const watch = attempt.then(
          () => {
            outcome = 'other'
          },
          (error: unknown) => {
            outcome = isRequestTimeoutError(error) ? 'timeout' : 'other'
          },
        )

        await vi.advanceTimersByTimeAsync(timeoutMs - 1)
        expect(outcome).toBe('pending')

        await vi.advanceTimersByTimeAsync(1)
        await watch
        expect(outcome).toBe('timeout')
      }),
      { numRuns: 25 },
    )
  })
})

describe('createTimeoutFetch', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('memberi batas waktu default pada permintaan yang menggantung', async () => {
    const { impl, seen } = hangingFetch()
    globalThis.fetch = impl as unknown as typeof fetch

    const timeoutFetch = createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS)
    const attempt = timeoutFetch('https://example.supabase.co/rest/v1/products')
    void attempt.catch(() => {})

    await vi.advanceTimersByTimeAsync(SUPABASE_REQUEST_TIMEOUT_MS)

    await expect(attempt).rejects.toSatisfy(isRequestTimeoutError)
    // Permintaannya benar-benar dibatalkan, bukan sekadar diabaikan.
    expect(seen[0]?.signal?.aborted).toBe(true)
  })

  it('menghormati AbortSignal pemanggil tanpa menyamarkannya sebagai timeout', async () => {
    const { impl, seen } = hangingFetch()
    globalThis.fetch = impl as unknown as typeof fetch

    const caller = new AbortController()
    const timeoutFetch = createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS)
    const attempt = timeoutFetch('https://example.supabase.co/rest/v1/products', {
      signal: caller.signal,
    })
    void attempt.catch(() => {})

    caller.abort()
    await vi.advanceTimersByTimeAsync(0)

    // Pembatalan milik supabase-js tetap terasa di lapisan jaringan…
    expect(seen[0]?.signal?.aborted).toBe(true)
    // …dan tetap dilaporkan sebagai pembatalan, bukan sebagai timeout.
    await expect(attempt).rejects.not.toSatisfy(isRequestTimeoutError)
  })

  it('meneruskan respons yang datang sebelum batas waktu apa adanya', async () => {
    const response = new Response('{}', { status: 200 })
    globalThis.fetch = vi.fn(async () => response) as unknown as typeof fetch

    const timeoutFetch = createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS)
    await expect(
      timeoutFetch('https://example.supabase.co/auth/v1/health'),
    ).resolves.toBe(response)
  })

  it('header batas waktu per-permintaan dipakai lalu DIBUANG sebelum dikirim', async () => {
    const { impl, seen } = hangingFetch()
    globalThis.fetch = impl as unknown as typeof fetch

    const timeoutFetch = createTimeoutFetch(SUPABASE_REQUEST_TIMEOUT_MS)
    const attempt = timeoutFetch('https://example.supabase.co/storage/v1/object/products/a.jpg', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        [REQUEST_TIMEOUT_HEADER]: '60000',
      },
    })
    void attempt.catch(() => {})

    const sentHeaders = new Headers(seen[0]?.init?.headers)
    expect(sentHeaders.has(REQUEST_TIMEOUT_HEADER)).toBe(false)
    expect(sentHeaders.get('authorization')).toBe('Bearer token')

    // Batas waktu default sudah lewat, tetapi unggahan masih diberi ruang.
    await vi.advanceTimersByTimeAsync(SUPABASE_REQUEST_TIMEOUT_MS + 1_000)
    expect(seen[0]?.signal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    await expect(attempt).rejects.toSatisfy(isRequestTimeoutError)
  })
})
