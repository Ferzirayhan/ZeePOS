import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Status jaringan yang mengukur KETERJANGKAUAN server, bukan hanya status link
 * layer (design C.2).
 *
 * `navigator.onLine` bernilai true begitu perangkat terasosiasi ke jaringan,
 * tanpa tahu apakah Supabase benar-benar terjangkau. Di captive portal (Wi-Fi
 * kafe/hotel, tethering yang kuotanya habis) kasir melihat indikator "online",
 * menekan Bayar, lalu menunggu tanpa kabar. Probe ini mengubah keadaan itu
 * menjadi status offline yang jujur.
 */

/** Batas waktu probe. Pendek karena hanya perlu tahu "terjangkau atau tidak". */
export const REACHABILITY_PROBE_TIMEOUT_MS = 5_000

/** Interval probe berkala, hanya berjalan saat tab terlihat. */
export const REACHABILITY_PROBE_INTERVAL_MS = 30_000

function getLinkOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

function getProbeUrl(): string | null {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL

  if (!baseUrl) {
    return null
  }

  // Endpoint health GoTrue: tidak butuh autentikasi dan murah.
  return `${baseUrl.replace(/\/+$/, '')}/auth/v1/health`
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

export interface NetworkStatus {
  isOnline: boolean
  /** Probe segera, untuk dipanggil setelah sebuah permintaan gagal. */
  revalidate: () => void
}

export function useNetworkStatus(): NetworkStatus {
  const [linkOnline, setLinkOnline] = useState(getLinkOnline)
  // Optimistis pada render pertama supaya tombol checkout tidak berkedip
  // nonaktif sebelum probe pertama selesai.
  const [reachable, setReachable] = useState(true)
  const inFlightRef = useRef<{ cancel: () => void } | null>(null)
  const mountedRef = useRef(true)

  const probe = useCallback(() => {
    // `navigator.onLine === false` sudah cukup untuk menyimpulkan offline.
    // Probe HANYA MENAMBAH kondisi offline; jalur offline yang sudah benar
    // (klausa 3.5) tidak boleh berubah, termasuk tidak boleh memunculkan
    // permintaan jaringan baru saat perangkat memang offline.
    if (!getLinkOnline()) {
      return
    }

    const probeUrl = getProbeUrl()

    if (!probeUrl || typeof fetch !== 'function') {
      return
    }

    // Probe sebelumnya yang masih menggantung dibatalkan, dan hasilnya dibuang:
    // pembatalan oleh kita sendiri bukan bukti apa pun tentang server.
    inFlightRef.current?.cancel()

    const controller = new AbortController()
    let superseded = false
    const handle = {
      cancel: () => {
        superseded = true
        controller.abort()
      },
    }
    inFlightRef.current = handle

    // Timeout DIHITUNG sebagai tidak terjangkau — inilah kasus captive portal
    // yang membuat `navigator.onLine` menyesatkan.
    const timer = setTimeout(() => controller.abort(), REACHABILITY_PROBE_TIMEOUT_MS)

    const settle = (value: boolean) => {
      if (!superseded && mountedRef.current) {
        setReachable(value)
      }
    }

    void Promise.resolve(
      fetch(probeUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      }),
    )
      // Respons apa pun di bawah 5xx membuktikan jalur jaringan hidup. 5xx
      // berarti gerbang Supabase menjawab tetapi tidak dapat melayani.
      .then((response) => settle((response?.status ?? 200) < 500))
      .catch(() => settle(false))
      .finally(() => {
        clearTimeout(timer)
        if (inFlightRef.current === handle) {
          inFlightRef.current = null
        }
      })
  }, [])

  useEffect(() => {
    mountedRef.current = true

    const handleOnline = () => {
      setLinkOnline(true)
      probe()
    }

    const handleOffline = () => {
      setLinkOnline(false)
    }

    const handleVisibilityChange = () => {
      if (isVisible()) {
        probe()
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    probe()

    // Interval hanya berguna saat kasir benar-benar melihat layarnya; tab
    // tersembunyi tidak perlu membangunkan radio perangkat.
    const interval = window.setInterval(() => {
      if (isVisible()) {
        probe()
      }
    }, REACHABILITY_PROBE_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      inFlightRef.current?.cancel()
      inFlightRef.current = null
    }
  }, [probe])

  return { isOnline: linkOnline && reachable, revalidate: probe }
}

/**
 * Bentuk boolean yang dipakai seluruh UI. Dipertahankan apa adanya supaya call
 * site yang ada tidak berubah; pemanggil yang perlu memicu probe ulang setelah
 * kegagalan permintaan memakai `useNetworkStatus()`.
 */
export function useOnlineStatus(): boolean {
  return useNetworkStatus().isOnline
}
