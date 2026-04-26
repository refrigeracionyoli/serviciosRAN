import { Outlet } from 'react-router-dom'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { useAuthStateListener } from '@/hooks/use-auth'
import { useOfflineAdminPreload } from '@/hooks/use-offline-admin-preload'
import { useInventarioTecnicoAutoReturn } from '@/hooks/use-inventario-tecnico-auto-return'
import { useOfflineSync } from '@/hooks/use-offline-sync'
import { useRealtimeInvalidations } from '@/hooks/use-realtime-invalidations'

export function AppLayout() {
  useAuthStateListener()
  useOfflineSync({ scope: 'admin' })
  useRealtimeInvalidations()
  const { isBlocking } = useOfflineAdminPreload()
  useInventarioTecnicoAutoReturn({ enabled: !isBlocking })

  return (
    <TooltipProvider delayDuration={200}>
      <div className="fixed inset-0 flex overflow-hidden bg-ran-gray">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <Outlet />
          </div>
        </main>
        <OfflineBanner scope="admin" />
      </div>
    </TooltipProvider>
  )
}
