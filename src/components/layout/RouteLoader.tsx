import { BrandMark } from '../app/BrandMark'

export function RouteLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f9f9] px-6">
      <div className="rounded-[24px] bg-white px-8 py-6 shadow-[0_12px_32px_rgba(15,23,42,0.06)]">
        <div className="flex items-center gap-4">
          <div className="relative h-11 w-11">
            <div className="absolute inset-0 animate-spin rounded-[16px] border-4 border-[#dff2ef] border-t-[#0a7c72]" />
            <BrandMark size="md" />
          </div>
          <div>
            <p className="text-sm font-extrabold uppercase tracking-[0.14em] text-[#0a7c72]">
              ZeePOS
            </p>
            <p className="mt-1 text-sm text-[#7d8987]">Memuat halaman...</p>
          </div>
        </div>
      </div>
    </div>
  )
}
