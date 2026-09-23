/**
 * Bounded wait bersama untuk seluruh percobaan jaringan (design C.1).
 *
 * Akar cacat 1.7 dan 1.8 sama: tidak ada satu pun lapisan yang memberi batas
 * waktu pada permintaan Supabase. Pada captive portal (Wi-Fi terasosiasi tetapi
 * tidak meneruskan paket) koneksi TCP bisa menggantung menit-menitan tanpa
 * pernah settle, sehingga `await` di sisi klien tidak pernah kembali dan blok
 * `finally` yang mereset state UI tidak pernah berjalan.
 *
 * Perbaikannya HARUS berada di lapisan promise/fetch, bukan di lapisan state:
 * task 1 mengukur bahwa dengan `supabase.rpc` yang tidak pernah settle, setelah
 * 60 detik simulasi blok `finally` di `handleProcessPayment` belum berjalan
 * (`{ elapsedMs: 60000, finallyRan: false, settled: 'pending' }`). Menambal
 * state machine tidak akan pernah menolong karena kodenya memang belum sampai
 * ke sana.
 */

/** Batas waktu default untuk semua permintaan Supabase (PostgREST, RPC, auth). */
export const SUPABASE_REQUEST_TIMEOUT_MS = 15_000

/**
 * Batas waktu longgar untuk unggahan gambar produk: file 2–5 MB di jaringan
 * seluler lambat wajar melewati 15 detik, jadi deadline default akan memotong
 * unggahan yang sebenarnya masih berjalan sehat.
 */
export const PHOTO_UPLOAD_TIMEOUT_MS = 60_000

/**
 * Header internal untuk meminta batas waktu berbeda pada satu permintaan.
 *
 * Dibutuhkan karena sebagian API supabase-js tidak menyediakan jalur untuk
 * menitipkan `AbortSignal` — `storage.from().upload()` misalnya hanya menerima
 * `FileOptions`, dan `FileOptions` tidak punya `signal`. Header ini **dibaca
 * lalu dibuang** oleh `createTimeoutFetch` sebelum permintaan dikirim, jadi
 * tidak pernah keluar dari peramban dan tidak menyentuh CORS.
 */
export const REQUEST_TIMEOUT_HEADER = 'x-zeepos-timeout-ms'

/**
 * Kegagalan karena batas waktu, dibedakan dari kegagalan jaringan lain supaya
 * pemanggil dapat menampilkan pesan yang dapat ditindaklanjuti ("coba lagi")
 * alih-alih pesan galat teknis.
 */
export class RequestTimeoutError extends Error {
  readonly isTimeout = true
  readonly timeoutMs: number
  readonly label: string

  constructor(label: string, timeoutMs: number) {
    super(
      `${label} tidak merespons dalam ${formatSeconds(timeoutMs)} detik.`,
    )
    this.name = 'RequestTimeoutError'
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

export function isRequestTimeoutError(error: unknown): error is RequestTimeoutError {
  return (
    error instanceof RequestTimeoutError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { isTimeout?: unknown }).isTimeout === true)
  )
}

function formatSeconds(timeoutMs: number): string {
  const seconds = timeoutMs / 1000
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
}

function readTimeoutOverride(headers: Headers): number | null {
  const raw = headers.get(REQUEST_TIMEOUT_HEADER)

  if (raw == null) {
    return null
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * Menyatukan signal pemanggil dengan signal deadline internal.
 *
 * `AbortSignal.any` dipakai bila tersedia; bila tidak, listener dipasang manual
 * lalu dilepas lagi supaya tidak menahan referensi setelah permintaan selesai.
 */
function combineSignals(
  internal: AbortController,
  caller: AbortSignal | null | undefined,
): { signal: AbortSignal; release: () => void } {
  if (!caller) {
    return { signal: internal.signal, release: () => {} }
  }

  const anyOf = (
    AbortSignal as unknown as {
      any?: (signals: AbortSignal[]) => AbortSignal
    }
  ).any

  if (typeof anyOf === 'function') {
    return {
      signal: anyOf.call(AbortSignal, [internal.signal, caller]),
      release: () => {},
    }
  }

  if (caller.aborted) {
    internal.abort((caller as { reason?: unknown }).reason)
    return { signal: internal.signal, release: () => {} }
  }

  const forward = () => internal.abort((caller as { reason?: unknown }).reason)
  caller.addEventListener('abort', forward, { once: true })

  return {
    signal: internal.signal,
    release: () => caller.removeEventListener('abort', forward),
  }
}

function labelFor(input: RequestInfo | URL): string {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input, 'http://localhost')
        : input instanceof URL
          ? input
          : new URL(input.url, 'http://localhost')
    return `Permintaan ${url.pathname}`
  } catch {
    return 'Permintaan server'
  }
}

/**
 * `fetch` yang selalu punya deadline, tanpa mematikan pembatalan milik
 * pemanggil.
 *
 * Signal yang sudah dibawa pemanggil (mis. `.abortSignal()` milik postgrest-js
 * atau pembatalan internal auth-js) tetap dihormati: keduanya digabung, jadi
 * siapa pun yang lebih dulu membatalkan tetap membatalkan permintaan.
 */
export function createTimeoutFetch(defaultTimeoutMs: number): typeof fetch {
  return async function timeoutFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    let requestInput = input
    let requestInit: RequestInit = { ...init }
    let timeoutMs = defaultTimeoutMs

    // Header override dibaca lalu DIBUANG supaya tidak pernah dikirim ke server.
    if (init?.headers != null) {
      const headers = new Headers(init.headers)
      const override = readTimeoutOverride(headers)

      if (headers.has(REQUEST_TIMEOUT_HEADER)) {
        headers.delete(REQUEST_TIMEOUT_HEADER)
        requestInit.headers = headers
      }

      if (override != null) {
        timeoutMs = override
      }
    } else if (typeof Request !== 'undefined' && input instanceof Request) {
      const override = readTimeoutOverride(input.headers)

      if (input.headers.has(REQUEST_TIMEOUT_HEADER)) {
        const headers = new Headers(input.headers)
        headers.delete(REQUEST_TIMEOUT_HEADER)
        requestInput = new Request(input, { headers })
      }

      if (override != null) {
        timeoutMs = override
      }
    }

    const callerSignal =
      requestInit.signal ??
      (typeof Request !== 'undefined' && requestInput instanceof Request
        ? requestInput.signal
        : null)

    const internal = new AbortController()
    const { signal, release } = combineSignals(internal, callerSignal)
    requestInit = { ...requestInit, signal }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      internal.abort()
    }, timeoutMs)

    try {
      return await fetch(requestInput, requestInit)
    } catch (error) {
      // Dibedakan secara eksplisit lewat flag, bukan lewat `signal.reason`,
      // supaya perilakunya sama di peramban yang belum mendukung alasan abort.
      if (timedOut) {
        throw new RequestTimeoutError(labelFor(input), timeoutMs)
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }
}

/**
 * Membungkus operasi apa pun (termasuk yang tidak melewati `fetch` kita, mis.
 * beberapa jalur internal supabase-js) dengan deadline keras.
 *
 * Berbeda dari `createTimeoutFetch`, fungsi ini menjamin promise yang
 * dikembalikan SELALU settle sebelum `timeoutMs` berlalu — itulah yang membuat
 * blok `finally` pemanggil benar-benar berjalan (Property 13).
 */
export function runWithTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new RequestTimeoutError(label, timeoutMs))
    }, timeoutMs)
  })

  const attempt = (async () => {
    try {
      return await Promise.race([run(controller.signal), deadline])
    } catch (error) {
      if (timedOut && !isRequestTimeoutError(error)) {
        // Operasi dibatalkan oleh deadline kita, jadi pesannya yang berlaku
        // adalah pesan timeout — bukan "AbortError" yang tidak berarti apa pun
        // bagi kasir.
        throw new RequestTimeoutError(label, timeoutMs)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  })()

  return attempt
}
