/**
 * Uji behavioural gate auth (task 10.5, design C.3, Property 15).
 *
 * Task 1 mengukur akar cacat 1.8: nilai `AUTH_TIMEOUT_MS = 8000` bukan
 * masalahnya, percabangannya yang salah. Dengan `getSession` yang baru resolve
 * di detik ke-12, pada detik ke-8,1 tercatat `{ loginShown: true,
 * loadingScreenShown: false }` — kasir bersesi sah dilempar ke `/login`.
 *
 * Jadi yang diuji di sini: kadaluwarsa batas waktu HARUS menjadi layar
 * kegagalan yang dapat dicoba ulang, dan percobaan ulang tidak boleh menambah
 * langganan auth (klausa 3.12).
 *
 * **Validates: Requirements 2.8, 3.12**
 */
import { createElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  /** `null` berarti getSession tidak pernah settle (captive portal). */
  resolveAfterMs: 0 as number | null,
  session: null as unknown,
  getSessionCalls: 0,
  onAuthStateChangeCalls: 0,
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const key of ['select', 'eq']) {
        chain[key] = () => chain
      }
      chain.maybeSingle = () =>
        Promise.resolve({
          data: { id: 'kasir-1', role: 'kasir', tenant_id: 'tenant-1' },
          error: null,
        })
      return chain
    }),
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(() => {
        authMock.getSessionCalls += 1
        const delay = authMock.resolveAfterMs

        if (delay == null) {
          return new Promise(() => {})
        }

        return new Promise((resolve) => {
          setTimeout(
            () => resolve({ data: { session: authMock.session }, error: null }),
            delay,
          )
        })
      }),
      onAuthStateChange: vi.fn(() => {
        authMock.onAuthStateChangeCalls += 1
        return { data: { subscription: { unsubscribe: () => {} } } }
      }),
      signOut: vi.fn(),
    },
  },
}))

const SESSION = {
  access_token: 'token',
  user: { id: 'kasir-1', email: 'kasir@toko.test' },
}

async function renderGuardedApp() {
  vi.resetModules()
  const { AuthProvider } = await import('../components/auth/AuthProvider')
  const { PrivateRoute } = await import('../components/auth/PrivateRoute')

  return render(
    createElement(
      AuthProvider,
      null,
      createElement(
        MemoryRouter,
        { initialEntries: ['/pos'] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/login',
            element: createElement('div', null, 'HALAMAN LOGIN'),
          }),
          createElement(Route, {
            path: '/pos',
            element: createElement(
              PrivateRoute,
              null,
              createElement('div', null, 'HALAMAN POS'),
            ),
          }),
        ),
      ),
    ),
  )
}

describe('AuthProvider — batas waktu sebagai kegagalan, bukan bypass', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    authMock.resolveAfterMs = 0
    authMock.session = SESSION
    authMock.getSessionCalls = 0
    authMock.onAuthStateChangeCalls = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sesi yang resolve cepat merender anak seperti biasa', async () => {
    authMock.resolveAfterMs = 50

    await renderGuardedApp()

    expect(screen.queryByText('HALAMAN POS')).toBeNull()
    expect(screen.queryByText('Menyiapkan sesi aplikasi')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(screen.queryByText('HALAMAN POS')).not.toBeNull()
    expect(screen.queryByText('HALAMAN LOGIN')).toBeNull()
  })

  it('batas waktu dengan sesi belum resolve menampilkan layar kegagalan, bukan /login', async () => {
    authMock.resolveAfterMs = 12_000

    await renderGuardedApp()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100)
    })

    expect(screen.queryByText('HALAMAN LOGIN')).toBeNull()
    expect(screen.queryByText('HALAMAN POS')).toBeNull()
    expect(screen.queryByText('Sesi belum dapat dimuat')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Coba Lagi' })).not.toBeNull()
  })

  it('sesi yang terlambat resolve tetap sampai ke rute terproteksi tanpa reload', async () => {
    authMock.resolveAfterMs = 12_000

    await renderGuardedApp()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_500)
    })

    expect(screen.queryByText('HALAMAN LOGIN')).toBeNull()
    expect(screen.queryByText('HALAMAN POS')).not.toBeNull()
  })

  it('Coba Lagi menjalankan ulang inisialisasi tanpa menambah langganan auth', async () => {
    // Percobaan pertama menggantung selamanya.
    authMock.resolveAfterMs = null

    await renderGuardedApp()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100)
    })

    expect(screen.queryByText('Sesi belum dapat dimuat')).not.toBeNull()
    expect(authMock.getSessionCalls).toBe(1)
    expect(authMock.onAuthStateChangeCalls).toBe(0)

    // Jaringan pulih, kasir menekan Coba Lagi.
    authMock.resolveAfterMs = 0

    // Klik dan pemajuan timer dipisah: efek retry baru berjalan saat act
    // terluar selesai, jadi timer yang didaftarkannya harus dimajukan sesudahnya.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(authMock.getSessionCalls).toBe(2)
    expect(screen.queryByText('HALAMAN POS')).not.toBeNull()
    expect(screen.queryByText('HALAMAN LOGIN')).toBeNull()
    // Anti-langganan-ganda (3.12): percobaan ulang TIDAK mendaftarkan listener kedua.
    expect(authMock.onAuthStateChangeCalls).toBe(1)
  })

  it('tanpa sesi, anak tetap dirender setelah status auth resolve (jalur login normal)', async () => {
    authMock.resolveAfterMs = 10
    authMock.session = null

    await renderGuardedApp()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // Di sini `/login` MEMANG benar: status auth sudah resolve dan sesinya kosong.
    expect(screen.queryByText('HALAMAN LOGIN')).not.toBeNull()
    expect(screen.queryByText('Sesi belum dapat dimuat')).toBeNull()
  })
})
