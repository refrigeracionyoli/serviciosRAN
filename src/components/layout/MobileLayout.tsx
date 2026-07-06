import { startTransition, useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { ClipboardList, LogOut, Package, UserRound } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { useAuth, useAuthStateListener, useSignOut } from '@/hooks/use-auth'
import { useInventarioTecnicoAutoReturn } from '@/hooks/use-inventario-tecnico-auto-return'
import { useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useInventarioTecnicoQuery } from '@/hooks/use-inventario'
import { useOfflineTecnicoPreload } from '@/hooks/use-offline-tecnico-preload'
import { useOfflineSync } from '@/hooks/use-offline-sync'
import { useRealtimeInvalidations } from '@/hooks/use-realtime-invalidations'
import { cn, formatLocalIsoDate } from '@/lib/utils'

const mobileNav = [
  { to: '/tecnico', label: 'Servicios', icon: ClipboardList, exact: true },
  { to: '/tecnico/inventario', label: 'Inventario', icon: Package },
  { to: '/tecnico/perfil', label: 'Perfil', icon: UserRound },
]

export function MobileLayout() {
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [warmupsEnabled, setWarmupsEnabled] = useState(false)
  const location = useLocation()
  useAuthStateListener()
  useOfflineSync({ scope: 'tecnico', pollIntervalMs: 10_000, initialDelayMs: 350 })
  useRealtimeInvalidations()
  const { isBlocking } = useOfflineTecnicoPreload()
  useInventarioTecnicoAutoReturn({ enabled: !isBlocking })

  const { perfil, user } = useAuth()
  const { mutate: signOut, isPending: isSigningOut } = useSignOut()
  const today = formatLocalIsoDate(new Date())
  const isServiciosRoute = location.pathname === '/tecnico'
  const isInventarioRoute = location.pathname === '/tecnico/inventario'

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [])

  useEffect(() => {
    let frameId = 0
    let timeoutId = 0

    frameId = window.requestAnimationFrame(() => {
      timeoutId = window.setTimeout(() => {
        startTransition(() => {
          setWarmupsEnabled(true)
        })
      }, 180)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(timeoutId)
    }
  }, [])

  const { data: servicios = [] } = useServiciosQuery({
    status: 'en_ruta',
    tecnicoId: user?.id ?? null,
    clienteId: null,
    fechaDesde: today,
    fechaHasta: today,
    tipoServicio: null,
    search: null,
  }, {
    enabled: Boolean(user?.id) && warmupsEnabled && !isServiciosRoute,
  })
  useServiciosQuery({
    status: 'completado',
    tecnicoId: user?.id ?? null,
    clienteId: null,
    fechaDesde: today,
    fechaHasta: today,
    tipoServicio: null,
    search: null,
  }, {
    enabled: Boolean(user?.id) && warmupsEnabled && !isServiciosRoute,
  })
  const { data: mantenimientos = [] } = useMantenimientosQuery({
    tecnicoId: user?.id ?? null,
    statuses: ['pendiente', 'en_ruta'],
    enabled: Boolean(user?.id),
  })

  // Warmup offline para rutas críticas del técnico.
  useInventarioTecnicoQuery(today, user?.id, {
    enabled: Boolean(user?.id) && warmupsEnabled && !isInventarioRoute,
  })

  const pendientesServicios = servicios.filter((s) => s.status === 'en_ruta' && s.fecha_servicio === today).length
  const pendientesMantenimientos = mantenimientos.filter((mantenimiento) => (
    (mantenimiento.tecnico_id === user?.id || mantenimiento.tecnico?.id === user?.id)
    && (mantenimiento.status === 'pendiente' || mantenimiento.status === 'en_ruta')
  )).length
  const pendientes = pendientesServicios + pendientesMantenimientos

  return (
    <>
        <div className="fixed inset-0 flex h-[100svh] min-h-[100svh] max-h-[100svh] flex-col overflow-hidden bg-ran-gray supports-[height:100dvh]:h-[100dvh] supports-[height:100dvh]:max-h-[100dvh]">
          <header className="relative overflow-hidden border-b border-ran-navy/10 bg-white">
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-ran-navy via-ran-blue to-sky-500" />
            <div
              className="relative px-3.5 pb-3.5 pt-3"
              style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-[0_18px_36px_-26px_rgba(15,23,42,0.75)]">
                    <img src="/icons/Ran_logo.png" alt="Servicios RAN" className="h-6.5 w-auto" />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/80">
                      Servicios RAN
                    </p>
                    <p className="truncate text-[15px] font-bold text-white">
                      {perfil?.nombre ?? 'Técnico'}
                    </p>
                  </div>
                </div>

              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => setLogoutOpen(true)}
                className="h-9 w-9 rounded-xl border border-white/20 bg-white/15 text-white shadow-none hover:bg-white/25 hover:text-white"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main
          className="flex-1 overflow-y-auto overscroll-y-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <Outlet />
        </main>

        <nav
          className="shrink-0 flex border-t border-border bg-white/95 px-1 pb-2 pt-0.5 backdrop-blur"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
        >
          {mobileNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
                  isActive ? 'text-ran-navy' : 'text-ran-slate',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <div className="relative">
                    <item.icon className={cn('h-[18px] w-[18px]', isActive && 'fill-ran-ice')} />
                    {item.to === '/tecnico' && pendientes > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-ran-navy text-[9px] font-bold text-white">
                        {pendientes > 9 ? '9+' : pendientes}
                      </span>
                    )}
                  </div>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <OfflineBanner scope="tecnico" />
      </div>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent className="max-w-sm rounded-3xl border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar sesión</AlertDialogTitle>
            <AlertDialogDescription>
              Se cerrará la sesión en este dispositivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
              onClick={() => signOut()}
              disabled={isSigningOut}
            >
              {isSigningOut ? 'Saliendo...' : 'Cerrar sesión'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
