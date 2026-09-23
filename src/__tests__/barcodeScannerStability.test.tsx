/**
 * Klaster D — BarcodeScannerModal stabil terhadap re-render induk
 * (task 11.4, design D.4, Property 18).
 *
 * Invarian "kamera hidup selama modal terbuka" dimiliki komponen: POSPage boleh
 * terus meneruskan arrow function inline, jadi uji ini SENGAJA memakai callback
 * inline yang identitasnya baru setiap render.
 *
 * Detail harness: `rerender` dan `advanceTimersByTimeAsync` harus berada di blok
 * `act` yang TERPISAH. Bila digabung, React baru mem-flush effect pasif setelah
 * timer dimajukan, sehingga timer 150 ms milik effect kamera tidak pernah
 * terpicu dan komponen yang rusak pun tampak sehat.
 *
 * **Validates: Requirements 2.10**
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { BarcodeScannerModal } from '../components/pos/BarcodeScannerModal'

type ScanCallback = (decodedText: string) => void

const camera = vi.hoisted(() => ({
  instances: 0,
  startCount: 0,
  stopCount: 0,
  lastSuccess: null as ((decodedText: string) => void) | null,
  reset() {
    this.instances = 0
    this.startCount = 0
    this.stopCount = 0
    this.lastSuccess = null
  },
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor() {
      camera.instances += 1
    }
    start(
      _constraints: unknown,
      _config: unknown,
      onSuccess: ScanCallback,
    ): Promise<void> {
      camera.startCount += 1
      camera.lastSuccess = onSuccess
      return Promise.resolve()
    }
    stop(): Promise<void> {
      camera.stopCount += 1
      return Promise.resolve()
    }
  },
}))

interface ParentProps {
  tick: number
  isOpen?: boolean
  onScan?: (decodedText: string) => void
  onDismiss?: () => void
}

/** Meniru POSPage: callback dibuat ulang setiap render. */
function Parent({ tick, isOpen = true, onScan, onDismiss }: ParentProps) {
  return (
    <BarcodeScannerModal
      isOpen={isOpen}
      onClose={() => {
        void tick
        onDismiss?.()
      }}
      onScanSuccess={(code) => {
        void tick
        onScan?.(code)
      }}
    />
  )
}

describe('BarcodeScannerModal', () => {
  beforeEach(() => {
    camera.reset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('tidak memulai ulang kamera saat induk re-render dengan callback inline baru', async () => {
    const view = render(<Parent tick={0} />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(camera.startCount).toBe(1)

    for (const tick of [1, 2, 3]) {
      await act(async () => {
        view.rerender(<Parent tick={tick} />)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
    }

    expect(camera.startCount).toBe(1)
    expect(camera.stopCount).toBe(0)
    expect(camera.instances).toBe(1)
  })

  it('memakai callback terbaru saat pemindaian berhasil, bukan yang tertangkap saat mount', async () => {
    const firstScan = vi.fn()
    const latestScan = vi.fn()
    const latestDismiss = vi.fn()

    const view = render(<Parent tick={0} onScan={firstScan} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    await act(async () => {
      view.rerender(<Parent tick={1} onScan={latestScan} onDismiss={latestDismiss} />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    await act(async () => {
      camera.lastSuccess?.('8990001000011')
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(latestScan).toHaveBeenCalledWith('8990001000011')
    expect(latestDismiss).toHaveBeenCalled()
    expect(firstScan).not.toHaveBeenCalled()
    expect(camera.startCount).toBe(1)
  })

  it('menghentikan kamera ketika modal ditutup', async () => {
    const view = render(<Parent tick={0} isOpen />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(camera.startCount).toBe(1)

    await act(async () => {
      view.rerender(<Parent tick={1} isOpen={false} />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(camera.stopCount).toBeGreaterThanOrEqual(1)
    expect(camera.startCount).toBe(1)
  })
})
