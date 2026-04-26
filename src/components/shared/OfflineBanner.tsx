import { useState } from 'react'
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react'
import { useSyncStore } from '@/stores/sync.store'
import { SyncCenter } from '@/components/shared/SyncCenter'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface OfflineBannerProps {
  scope: 'admin' | 'tecnico'
}

export function OfflineBanner({ scope }: OfflineBannerProps) {
  const [openSyncCenter, setOpenSyncCenter] = useState(false)
  const isOnline = useSyncStore((state) => state.isOnline)
  const pendingCount = useSyncStore((state) => state.pendingCount)
  const failedCount = useSyncStore((state) => state.failedCount)
  const conflictCount = useSyncStore((state) => state.conflictCount)
  const isSyncing = useSyncStore((state) => state.isSyncing)
  const authBlocked = useSyncStore((state) => state.authBlocked)
  const showOnlineAttention = scope === 'admin' && (authBlocked || failedCount > 0 || conflictCount > 0)

  if (isOnline && !showOnlineAttention) {
    return null
  }

  let className = 'bg-ran-slate'
  let adminClassName = 'border-slate-200/90 bg-white/95 text-slate-600'
  let icon = <WifiOff className="h-4 w-4 text-white" />
  let adminIcon = <WifiOff className="h-4 w-4" />
  let text = 'Modo offline'

  if (scope === 'tecnico') {
    text = pendingCount > 0
      ? `Modo offline — ${pendingCount} cambio(s) por sincronizar`
      : 'Modo offline'
  }

  if (scope === 'admin' && isSyncing) {
    className = 'bg-ran-blue'
    adminClassName = 'border-blue-200 bg-blue-50/95 text-ran-blue'
    icon = <RefreshCw className="h-4 w-4 animate-spin text-white" />
    adminIcon = <RefreshCw className="h-4 w-4 animate-spin" />
    text = `Sincronizando ${pendingCount} cambio(s)…`
  } else if (scope === 'admin' && authBlocked) {
    className = 'bg-amber-600'
    adminClassName = 'border-amber-200 bg-amber-50/95 text-amber-700'
    icon = <AlertTriangle className="h-4 w-4 text-white" />
    adminIcon = <AlertTriangle className="h-4 w-4" />
    text = 'Sincronización bloqueada por autenticación'
  } else if (scope === 'admin' && (conflictCount > 0 || failedCount > 0)) {
    className = 'bg-orange-600'
    adminClassName = 'border-orange-200 bg-orange-50/95 text-orange-700'
    icon = <AlertTriangle className="h-4 w-4 text-white" />
    adminIcon = <AlertTriangle className="h-4 w-4" />
    text = `${conflictCount || failedCount} cambio(s) requieren atención`
  } else if (!isOnline) {
    text = pendingCount > 0
      ? scope === 'tecnico'
        ? `Modo offline — ${pendingCount} cambio(s) por sincronizar`
        : `Modo offline — ${pendingCount} cambio(s) pendientes`
      : 'Modo offline'
  } else if (scope === 'admin' && pendingCount > 0) {
    className = 'bg-ran-navy'
    adminClassName = 'border-ran-ice bg-ran-ice/60 text-ran-navy'
    icon = <RefreshCw className="h-4 w-4 text-white" />
    adminIcon = <RefreshCw className="h-4 w-4" />
    text = `${pendingCount} cambio(s) pendientes de sincronizar`
  }

  if (scope === 'admin') {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={text}
              aria-haspopup="dialog"
              title={text}
              onClick={() => setOpenSyncCenter(true)}
              className={`fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-50 flex h-11 w-11 items-center justify-center rounded-full border shadow-lg backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ran-navy/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${adminClassName}`}
            >
              {adminIcon}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            align="end"
            sideOffset={10}
            className="rounded-xl border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-xl backdrop-blur"
          >
            {text}
          </TooltipContent>
        </Tooltip>

        <SyncCenter scope={scope} open={openSyncCenter} onClose={() => setOpenSyncCenter(false)} />
      </>
    )
  }

  let mobileBadge: string | null = null
  if (pendingCount > 0) {
    mobileBadge = pendingCount > 99 ? '99+' : String(pendingCount)
  }

  return (
    <>
      <button
        type="button"
        aria-label={text}
        title={text}
        onClick={() => setOpenSyncCenter(true)}
        className={`fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] right-3 z-50 flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg transition-transform hover:scale-[1.02] md:bottom-4 md:left-1/2 md:right-auto md:h-auto md:w-auto md:-translate-x-1/2 md:justify-start md:gap-2 md:rounded-full md:px-4 md:py-2 ${className}`}
      >
        {icon}
        {mobileBadge && (
          <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-ran-navy shadow-sm md:hidden">
            {mobileBadge}
          </span>
        )}
        <p className="hidden text-sm font-medium text-white md:block">{text}</p>
      </button>

      <SyncCenter scope={scope} open={openSyncCenter} onClose={() => setOpenSyncCenter(false)} />
    </>
  )
}
