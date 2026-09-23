import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNetworkStatus, useOnlineStatus } from '../hooks/useOnlineStatus'

describe('useOnlineStatus', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine')
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>

  function setOnline(value: boolean) {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value,
      writable: true,
    })
  }

  function setVisibility(state: DocumentVisibilityState) {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: state,
    })
  }

  /** Probe menjawab dengan status HTTP tertentu. */
  function probeResponds(status = 200) {
    fetchMock.mockImplementation(async () => new Response('{}', { status }))
  }

  /** Probe gagal seperti di captive portal: koneksi ditolak / CORS diblokir. */
  function probeFails() {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
  }

  beforeEach(() => {
    setOnline(true)
    setVisibility('visible')
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(navigator, 'onLine', originalOnLine)
    }
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  it('mengembalikan true saat navigator.onLine bernilai true', () => {
    setOnline(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('mengembalikan false saat navigator.onLine bernilai false', () => {
    setOnline(false)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
  })

  /**
   * Preservation klausa 3.5: `navigator.onLine === false` tetap langsung
   * berarti offline TANPA probe. Probe hanya MENAMBAH kondisi offline; jalur
   * offline yang sudah benar tidak boleh berubah, termasuk tidak boleh
   * memunculkan permintaan jaringan baru saat perangkat memang offline.
   */
  it('tidak melakukan probe jaringan apa pun saat navigator.onLine false', () => {
    setOnline(false)
    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('memperbarui status saat event online/offline diaktifkan', () => {
    setOnline(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    setOnline(false)
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    setOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })

  it('nilai awal optimistis: online pada render pertama sebelum probe selesai', () => {
    probeFails()
    const { result } = renderHook(() => useOnlineStatus())

    // Tombol checkout tidak boleh berkedip nonaktif sebelum ada bukti.
    expect(result.current).toBe(true)
  })

  it('onLine true tetapi server tidak terjangkau → offline', async () => {
    probeFails()
    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current).toBe(false)
  })

  it('probe memakai endpoint health tanpa cache', async () => {
    probeResponds()
    renderHook(() => useOnlineStatus())

    await act(async () => {
      await Promise.resolve()
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/auth\/v1\/health$/)
    expect(init.method).toBe('GET')
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('probe berhasil → tetap online', async () => {
    probeResponds()
    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current).toBe(true)
  })

  it('server menjawab 5xx → offline (gerbang hidup, layanan tidak melayani)', async () => {
    probeResponds(503)
    const { result } = renderHook(() => useOnlineStatus())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current).toBe(false)
  })

  it('pulih kembali ke online ketika probe berikutnya berhasil', async () => {
    probeFails()
    const { result } = renderHook(() => useNetworkStatus())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.isOnline).toBe(false)

    probeResponds()
    await act(async () => {
      result.current.revalidate()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.isOnline).toBe(true)
  })

  it('revalidate() memicu probe segera', async () => {
    probeResponds()
    const { result } = renderHook(() => useNetworkStatus())

    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.revalidate()
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tidak ada probe berkala saat tab tersembunyi', () => {
    vi.useFakeTimers()
    probeResponds()
    renderHook(() => useOnlineStatus())

    expect(fetchMock).toHaveBeenCalledTimes(1)

    setVisibility('hidden')
    act(() => {
      vi.advanceTimersByTime(120_000)
    })

    // Tab tersembunyi: tidak ada probe tambahan sama sekali.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('probe segera saat tab kembali terlihat', () => {
    probeResponds()
    renderHook(() => useOnlineStatus())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('event online memicu probe, bukan sekadar menyetel status', () => {
    setOnline(false)
    probeResponds()
    renderHook(() => useOnlineStatus())
    expect(fetchMock).not.toHaveBeenCalled()

    setOnline(true)
    act(() => {
      window.dispatchEvent(new Event('online'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
