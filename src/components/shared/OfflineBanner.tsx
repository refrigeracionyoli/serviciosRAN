import { WifiOff } from 'lucide-react'
import { useSyncStore } from '@/stores/sync.store'

export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing } = useSyncStore()

  if (isOnline && pendingCount === 0) return null

  if (isSyncing) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ran-blue px-4 py-2 shadow-lg">
        <p className="text-sm font-medium text-white">
          Sincronizando {pendingCount} cambios…
        </p>
      </div>
    )
  }

  if (!isOnline) {
    return (
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full bg-ran-slate px-4 py-2 shadow-lg">
        <WifiOff className="h-4 w-4 text-white" />
        <p className="text-sm font-medium text-white">
          Sin conexión — modo offline
          {pendingCount > 0 && ` · ${pendingCount} cambios pendientes`}
        </p>
      </div>
    )
  }

  return null
}
