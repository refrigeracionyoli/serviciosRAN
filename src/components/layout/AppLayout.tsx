import { Outlet } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { useAuthStateListener } from '@/hooks/use-auth'
import { useOfflineSync } from '@/hooks/use-offline-sync'

export function AppLayout() {
  useAuthStateListener()
  useOfflineSync()

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-screen overflow-hidden bg-ran-gray">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
