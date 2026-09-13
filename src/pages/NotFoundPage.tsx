import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6 py-8">
      <div className="w-full max-w-lg rounded-[2rem] bg-white p-10 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
          404
        </p>
        <h1 className="mt-4 text-3xl font-extrabold text-slate-900">
          Halaman tidak ditemukan
        </h1>
        <p className="mt-3 text-slate-600">
          Coba kembali ke dashboard atau login untuk melanjutkan penggunaan aplikasi.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/dashboard"
            className="rounded-2xl bg-blue-700 px-5 py-3 text-sm font-bold text-white"
          >
            Dashboard
          </Link>
          <Link
            to="/login"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-bold text-slate-700"
          >
            Login
          </Link>
        </div>
      </div>
    </main>
  )
}
