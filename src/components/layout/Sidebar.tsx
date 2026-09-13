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
  { label: 'Panduan', path: '/panduan', icon: 'school' },
  { label: 'Produk', path: '/produk', icon: 'package_2', adminOnly: true },
  { label: 'Stok', path: '/stok', icon: 'inventory_2', adminOnly: true },
  { label: 'Laporan', path: '/laporan', icon: 'history', adminOnly: true },
  { label: 'Audit', path: '/audit', icon: 'policy', adminOnly: true },
  { label: 'Pengaturan', path: '/pengaturan', icon: 'settings', adminOnly: true },
]

export function Sidebar() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const logout = useAuthStore((state) => state.logout)
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const mobileSidebarOpen = useUIStore((state) => state.mobileSidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const setMobileSidebarOpen = useUIStore((state) => state.setMobileSidebarOpen)
  const { settings } = useSettings()
  const [lowStockCount, setLowStockCount] = useState<number>(0)

  const storeName = settings.nama_toko || 'ZeePOS'

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
          className="fixed inset-0 z-40 bg-[#06231f]/30 md:hidden"
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
      <div className={cn('flex items-start justify-between px-1 md:px-0', desktopCollapsed ? 'md:px-0.5' : 'md:px-3')}>
        <div className={cn(desktopCollapsed ? 'md:hidden' : '')}>
          <div className="flex items-center gap-2.5">
            <BrandMark size="sm" text={storeName} className="shadow-[0_8px_18px_rgba(10,124,114,0.14)]" />
            <div>
              <p className="text-[13px] font-extrabold leading-none tracking-[-0.02em] text-[#0a7c72]">
                {storeName}
              </p>
              <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[#8b9895]">
                Management System
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(false)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#52627d] transition-colors hover:bg-[#f7f9f9] md:hidden"
          aria-label="Tutup sidebar"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
        <button
          type="button"
          onClick={toggleSidebar}
          className="hidden h-9 w-9 items-center justify-center rounded-full text-[#52627d] transition-colors hover:bg-[#f7f9f9] md:flex"
          aria-label={sidebarCollapsed ? 'Buka sidebar' : 'Tutup sidebar'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {sidebarCollapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'}
          </span>
        </button>
      </div>

      {desktopCollapsed ? (
        <div className="mt-3 hidden justify-center md:flex">
          <BrandMark size="sm" className="shadow-[0_8px_16px_rgba(10,124,114,0.12)]" />
        </div>
      ) : null}

      <nav className="mt-6 flex-1 space-y-1.5">
        {visibleMenus.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => setMobileSidebarOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center rounded-[16px] text-[14px] transition-colors duration-200',
                desktopCollapsed
                  ? 'gap-3 px-4 py-3 md:mx-auto md:h-11 md:w-11 md:justify-center md:rounded-[14px] md:px-0 md:py-0'
                  : 'gap-3 px-4 py-3',
                isActive
                  ? 'bg-[#eef8f6] font-semibold text-[#0a7c72]'
                  : 'font-medium text-[#52627d] hover:bg-[#f7f9f9]',
              )
            }
            title={desktopCollapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn('material-symbols-outlined', desktopCollapsed && 'md:text-[20px]')}
                  style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {item.icon}
                </span>
                <span className={cn('truncate', desktopCollapsed ? 'md:hidden' : '')}>
                  {item.label}
                </span>
                {!desktopCollapsed && item.path === '/stok' && lowStockCount > 0 ? (
                  <Badge className="ml-auto" variant="warning">
                    {lowStockCount}
                  </Badge>
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-[#eef1f1] pt-4">
        {!desktopCollapsed ? (
          <div className="px-4 py-2">
            <p className="text-sm font-bold text-on-surface">{user?.nama ?? 'Pengguna'}</p>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-outline">
              {user?.role ?? 'Tanpa role'}
            </p>
            <p className="mt-3 text-[10px] font-medium text-[#8b9895]">Made by Ezi with love</p>
          </div>
        ) : (
          <div className="hidden justify-center px-1 py-2 md:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef8f6] text-[#0a7c72]">
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
            'mt-2 flex w-full items-center rounded-[16px] text-[#df3d2f] transition-colors duration-200 hover:bg-[#fff1ed]',
            desktopCollapsed
              ? 'gap-3 px-4 py-3 md:mx-auto md:h-11 md:w-11 md:justify-center md:rounded-[14px] md:px-0 md:py-0'
              : 'gap-3 px-4 py-3',
          )}
          title={desktopCollapsed ? 'Keluar' : undefined}
        >
          <span className={cn('material-symbols-outlined text-[20px]', desktopCollapsed && 'md:text-[20px]')}>
            logout
          </span>
          <span className={cn('font-medium', desktopCollapsed ? 'md:hidden' : '')}>Keluar</span>
        </button>
      </div>
      </aside>
    </>
  )
}
