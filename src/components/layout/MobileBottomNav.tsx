import { NavLink } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { useCartStore } from '../../stores/cartStore'
import { cn } from '../../utils/cn'

interface MobileNavItem {
  path: string
  label: string
  icon: string
  adminOnly?: boolean
}

const baseItems: MobileNavItem[] = [
  { path: '/pos', label: 'Kasir', icon: 'point_of_sale' },
  { path: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { path: '/produk', label: 'Produk', icon: 'package_2', adminOnly: true },
  { path: '/stok', label: 'Stok', icon: 'inventory_2', adminOnly: true },
  { path: '/laporan', label: 'Laporan', icon: 'history', adminOnly: true },
  { path: '/pengaturan', label: 'Setelan', icon: 'settings', adminOnly: true },
]

export function MobileBottomNav() {
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const cartItemsCount = useCartStore((state) => state.items.reduce((acc, item) => acc + item.qty, 0))

  const visibleItems = baseItems.filter((item) => (item.adminOnly ? isAdmin : true)).slice(0, 5)

  return (
    <nav className="fixed inset-x-0 bottom-0 z-[70] px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] pt-2 md:hidden">
      <div className="mx-auto max-w-[460px] rounded-3xl border border-slate-200/90 bg-white/95 p-1.5 shadow-xl shadow-slate-900/10 backdrop-blur-md">
        <div className="grid grid-cols-5 gap-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'relative flex min-h-[52px] flex-col items-center justify-center rounded-2xl px-1 py-1 text-[10px] font-black transition-all duration-200 active:scale-[0.95]',
                  isActive
                    ? 'bg-blue-50 text-blue-600 shadow-sm shadow-blue-500/10 font-black'
                    : 'text-slate-500 hover:text-slate-800',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <span
                      className={cn('material-symbols-outlined text-[20px]', isActive && 'text-blue-600')}
                      style={{ fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      {item.icon}
                    </span>
                    {item.path === '/pos' && cartItemsCount > 0 ? (
                      <span className="absolute -right-2 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-black text-white shadow-sm shadow-blue-500/30">
                        {cartItemsCount}
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-1 truncate text-[10px]">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}
