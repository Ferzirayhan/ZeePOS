import { useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { getDashboardStats } from '../../api/reports'
import { useAuthStore } from '../../stores/authStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettings } from '../../hooks/useSettings'
import { cn } from '../../utils/cn'
import { BrandMark } from '../app/BrandMark'
import { Badge } from '../ui/Badge'

interface MenuItem {
  label: string
  path: string
  icon: string
  adminOnly?: boolean
}

const menuItems: MenuItem[] = [
  { label: 'Kasir', path: '/pos', icon: 'point_of_sale' },
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
  { label: 'Pelanggan', path: '/pelanggan', icon: 'groups' },
  { label: 'Panduan', path: '/panduan', icon: 'school' },
  { label: 'Produk', path: '/produk', icon: 'package_2', adminOnly: true },
  { label: 'Stok', path: '/stok', icon: 'inventory_2', adminOnly: true },
  { label: 'Laporan', path: '/laporan', icon: 'history', adminOnly: true },
  { label: 'Audit', path: '/audit', icon: 'policy', adminOnly: true },
  { label: 'Pengaturan', path: '/pengaturan', icon: 'settings', adminOnly: true },
]

export function Sidebar() {
  const user = useAuthStore((state) => state.user)
  const tenant = useAuthStore((state) => state.tenant)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const logout = useAuthStore((state) => state.logout)
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const mobileSidebarOpen = useUIStore((state) => state.mobileSidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const setMobileSidebarOpen = useUIStore((state) => state.setMobileSidebarOpen)
  const { settings } = useSettings()
  const [lowStockCount, setLowStockCount] = useState<number>(0)
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(() => {
    if (!tenant?.trial_ends_at) return null
    const diff = new Date(tenant.trial_ends_at).getTime() - Date.now()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
  })

  const storeName = settings.nama_toko || 'ZeePOS'

  useEffect(() => {
    const timer = setInterval(() => {
      if (!tenant?.trial_ends_at) {
        setTrialDaysRemaining(null)
        return
      }
      const diff = new Date(tenant.trial_ends_at).getTime() - Date.now()
      setTrialDaysRemaining(Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24))))
    }, 60000)

    return () => clearInterval(timer)
  }, [tenant?.trial_ends_at])

  useEffect(() => {
    void (async () => {
      try {
        const stats = await getDashboardStats()
        setLowStockCount(stats.jumlahProdukStokMenipis)
      } catch {
        setLowStockCount(0)
      }
    })()
  }, [])

  const visibleMenus = useMemo(
    () => menuItems.filter((item) => (item.adminOnly ? isAdmin : true)),
    [isAdmin],
  )
  const desktopCollapsed = sidebarCollapsed

  return (
    <>
      {mobileSidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/30 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Tutup navigasi"
        />
      ) : null}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-[#eef1f1] bg-white pb-28 pt-4 transition-all duration-200 md:pb-5',
          'w-[min(76vw,288px)] rounded-r-[24px] px-4 shadow-[18px_0_40px_rgba(15,23,42,0.12)] md:w-[220px] md:rounded-r-none md:shadow-none md:translate-x-0',
          desktopCollapsed ? 'md:w-[56px] md:px-1.5' : 'md:w-[220px] md:px-4',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
      <div className={cn('flex items-center justify-between px-1 md:px-0', desktopCollapsed ? 'md:px-0.5' : 'md:px-3')}>
        <div className={cn('min-w-0 flex-1 pr-2', desktopCollapsed ? 'md:hidden' : '')}>
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandMark size="sm" text={storeName} className="shrink-0 shadow-[0_8px_18px_rgba(37,99,235,0.14)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-extrabold leading-tight tracking-[-0.02em] text-[#2563eb] truncate">
                {storeName}
              </p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#8b9895] truncate">
                POS System
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#52627d] transition-colors hover:bg-[#f7f9f9] md:hidden"
          aria-label="Tutup sidebar"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#52627d] transition-colors hover:bg-[#f7f9f9] md:flex"
          aria-label={sidebarCollapsed ? 'Buka sidebar' : 'Tutup sidebar'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {sidebarCollapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'}
          </span>
        </button>
      </div>

      {desktopCollapsed ? (
        <div className="mt-3 hidden justify-center md:flex">
          <BrandMark size="sm" className="shadow-[0_8px_16px_rgba(37,99,235,0.12)]" />
        </div>
      ) : null}

      <nav className="mt-6 flex-1 space-y-1 overflow-y-auto custom-scrollbar">
        {visibleMenus.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setMobileSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'relative flex items-center rounded-2xl text-[14px] font-bold transition-all duration-200 group',
                desktopCollapsed
                  ? 'gap-3 px-3.5 py-2.5 md:mx-auto md:h-10 md:w-10 md:justify-center md:rounded-xl md:px-0 md:py-0'
                  : 'gap-3 px-3.5 py-2.5',
                isActive
                  ? 'bg-blue-50 text-blue-600 shadow-sm shadow-blue-500/10 font-extrabold'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
              )
            }
            title={desktopCollapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                {isActive && !desktopCollapsed ? (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-blue-600 shadow-sm shadow-blue-500/50" />
                ) : null}
                <span
                  className={cn(
                    'material-symbols-outlined text-[22px] transition-transform duration-200 group-hover:scale-110',
                    desktopCollapsed && 'md:text-[20px]',
                    isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600',
                  )}
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {item.icon}
                </span>
                <span className={cn('truncate', desktopCollapsed ? 'md:hidden' : '')}>
                  {item.label}
                </span>
                {!desktopCollapsed && item.path === '/stok' && lowStockCount > 0 ? (
                  <Badge className="ml-auto" variant="warning" dot>
                    {lowStockCount}
                  </Badge>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-100 pt-3">
        {!desktopCollapsed && trialDaysRemaining !== null ? (
          <div className="mx-1 mb-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-indigo-50/50 p-3 text-xs shadow-sm">
            <div className="flex items-center justify-between font-black text-blue-950">
              <span className="flex items-center gap-1.5 text-blue-700">
                <span className="material-symbols-outlined text-base">timer</span>
                Masa Trial
              </span>
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm shadow-blue-500/20">
                Sisa {trialDaysRemaining} Hari
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              Akses penuh semua fitur kasir cloud.
            </p>
          </div>
        ) : null}

        {!desktopCollapsed ? (
          <div className="mx-1 rounded-2xl bg-slate-50 p-3 border border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-xs font-black text-white shadow-sm shadow-blue-500/20">
                {(user?.nama ?? 'P').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-extrabold text-slate-900">{user?.nama ?? 'Pengguna'}</p>
                <p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {user?.role ?? 'Kasir'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden justify-center px-1 py-1 md:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <span className="material-symbols-outlined text-[18px]">person</span>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            setMobileSidebarOpen(false)
            void logout()
          }}
          className={cn(
            'mt-2 flex w-full items-center rounded-2xl text-red-600 font-bold transition-all duration-200 hover:bg-red-50 active:scale-[0.98]',
            desktopCollapsed
              ? 'gap-3 px-3.5 py-2.5 md:mx-auto md:h-10 md:w-10 md:justify-center md:rounded-xl md:px-0 md:py-0'
              : 'gap-3 px-3.5 py-2.5',
          )}
          title={desktopCollapsed ? 'Keluar' : undefined}
        >
          <span className={cn('material-symbols-outlined text-[20px]', desktopCollapsed && 'md:text-[20px]')}>
            logout
          </span>
          <span className={cn('truncate', desktopCollapsed ? 'md:hidden' : '')}>Keluar</span>
        </button>
      </div>
      </aside>
    </>
  )
}
