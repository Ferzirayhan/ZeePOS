import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  hasError: boolean
  message: string
}

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('App runtime error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#f7f9f9] px-6 py-10">
          <div className="w-full max-w-2xl rounded-[24px] border border-[#ffdad6] bg-white p-8 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#ba1a1a]">
              Runtime Error
            </p>
            <h1 className="mt-3 text-3xl font-extrabold text-[#1b1e20]">
              Halaman gagal dirender
            </h1>
            <p className="mt-3 text-sm leading-7 text-[#52627d]">
              Aplikasi menangkap error runtime supaya layar tidak kosong total.
              Silakan refresh halaman. Kalau pesan ini masih muncul, kirim pesan
              error di bawah ke saya.
            </p>
            <pre className="mt-6 overflow-x-auto rounded-[18px] bg-[#fff5f3] p-4 text-sm leading-6 text-[#ba1a1a]">
              {this.state.message || 'Unknown runtime error'}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 rounded-[14px] bg-[#2563eb] px-5 py-3 font-bold text-white"
            >
              Refresh Halaman
            </button>
          </div>
        </main>
      )
    }

    return this.props.children
  }
}
