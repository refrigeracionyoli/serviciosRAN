import { Outlet, NavLink } from 'react-router-dom'
import { ClipboardList, Package, Home } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth, useAuthStateListener } from '@/hooks/use-auth'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { Badge } from '@/components/ui/badge'
import { useOfflineSync } from '@/hooks/use-offline-sync'

const mobileNav = [
  { to: '/tecnico', label: 'Inicio', icon: Home, exact: true },
  { to: '/tecnico/inventario', label: 'Inventario', icon: Package },
]

export function MobileLayout() {
  useAuthStateListener()
  useOfflineSync()

  const { perfil } = useAuth()
  const { data: servicios } = useServiciosQuery()
  const pendientes = servicios?.filter((s) => s.status === 'pendiente' || s.status === 'en_ruta').length ?? 0

  return (
    <div className="flex h-screen flex-col bg-ran-gray">
      {/* Header móvil */}
      <header className="flex h-14 items-center justify-between border-b border-border bg-ran-navy px-4">
        <div>
          <p className="text-sm font-semibold text-white leading-none">
            {perfil?.nombre ?? 'Técnico'}
          </p>
          <p className="text-xs text-ran-ice/70 leading-none mt-0.5">Servicios RAN</p>
        </div>
        <div className="flex items-center gap-2">
          {pendientes > 0 && (
            <Badge variant="secondary" className="bg-white/20 text-white text-xs">
              {pendientes} pend.
            </Badge>
          )}
        </div>
      </header>

      {/* Contenido */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom Navigation */}
      <nav className="flex border-t border-border bg-white pb-safe">
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
                isActive ? 'text-ran-navy' : 'text-ran-slate',
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn('h-5 w-5', isActive && 'fill-ran-ice')} />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <NavLink
          to="/tecnico"
          className={({ isActive }) =>
            cn(
              'flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium transition-colors',
              isActive ? 'text-ran-navy' : 'text-ran-slate',
            )
          }
        >
          {({ isActive }) => (
            <>
              <div className="relative">
                <ClipboardList className={cn('h-5 w-5', isActive && 'fill-ran-ice')} />
                {pendientes > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-ran-navy text-[10px] text-white font-bold">
                    {pendientes > 9 ? '9+' : pendientes}
                  </span>
                )}
              </div>
              <span>Servicios</span>
            </>
          )}
        </NavLink>
      </nav>
    </div>
  )
}
