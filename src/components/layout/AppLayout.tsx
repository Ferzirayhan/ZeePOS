import { BrandMark } from '../app/BrandMark'
import { PWAInstallPrompt } from '../app/PWAInstallPrompt'
import { Outlet } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettings } from '../../hooks/useSettings'
import { Sidebar } from './Sidebar'
import { ToastViewport } from '../ui/Toast'
import { cn } from '../../utils/cn'
import { MobileBottomNav } from './MobileBottomNav'

export function AppLayout() {
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const toggleMobileSidebar = useUIStore((state) => state.toggleMobileSidebar)
  const user = useAuthStore((state) => state.user)
  const { settings } = useSettings()
  const storeName = settings.nama_toko || 'ZeePOS'
  const initial = (user?.nama ?? storeName).charAt(0).toUpperCase()

  return (
    <div
      className="min-h-screen bg-[#f7f9f9] pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] text-on-surface md:pb-0"
      style={{
        ['--app-sidebar-width' as string]: sidebarCollapsed ? '4rem' : '220px',
        ['--mobile-header-height' as string]: 'calc(env(safe-area-inset-top, 0px) + 4.5rem)',
      }}
    >
      <ToastViewport />
      <PWAInstallPrompt />
      <Sidebar />
      <MobileBottomNav />
      <div className="fixed inset-x-0 top-0 z-[70] bg-[linear-gradient(180deg,rgba(247,249,249,0.96)_0%,rgba(247,249,249,0.82)_100%)] px-3 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.6rem)] backdrop-blur md:hidden">
        <div className="flex items-center gap-3 rounded-[22px] border border-white/80 bg-white/96 px-3 py-2.5 shadow-[0_12px_28px_rgba(15,23,42,0.07)]">
          <button
            type="button"
            onClick={toggleMobileSidebar}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-[#eff6ff] text-[#2563eb] shadow-[0_6px_14px_rgba(37,99,235,0.08)]',
            )}
            aria-label="Buka navigasi"
          >
            <span className="material-symbols-outlined text-[21px]">menu</span>
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandMark size="sm" text={storeName} className="shadow-[0_8px_18px_rgba(37,99,235,0.14)]" />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-extrabold tracking-[-0.03em] text-[#2563eb]">
                  {storeName}
                </p>
                <p className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-[#8b9895]">
                  {user?.nama ?? 'Management System'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] bg-[#2563eb] text-sm font-extrabold text-white shadow-[0_8px_16px_rgba(37,99,235,0.18)]">
            {initial}
          </div>
        </div>
      </div>
      <Outlet />
    </div>
  )
}
