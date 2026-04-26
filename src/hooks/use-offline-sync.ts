import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { evidenciasKeys } from '@/hooks/use-evidencias'
import { inventarioKeys } from '@/hooks/use-inventario'
import { serviciosKeys } from '@/hooks/use-servicios'
import { getRecentCommands, getSyncSummary } from '@/lib/offline/commands'
import { ensureOfflineDbHealthy } from '@/lib/offline/db'
import { hydrateAdminOfflineQueryCache } from '@/lib/offline/query-hydration'
import { hydrateTecnicoOfflineQueryCache } from '@/lib/offline/tecnico-query-hydration'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { syncPendingCommands } from '@/lib/offline/sync-engine'
import { formatLocalIsoDate } from '@/lib/utils'
import { useSyncStore } from '@/stores/sync.store'

interface UseOfflineSyncOptions {
  scope?: 'admin' | 'tecnico'
  pollIntervalMs?: number
  initialDelayMs?: number
}

interface SyncSummarySnapshot {
  pendingCount: number
  failedCount: number
  conflictCount: number
  syncingCount: number
}

async function refreshAdminQueries(ownerId: string, queryClient: QueryClient) {
  await hydrateAdminOfflineQueryCache(ownerId, queryClient)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: serviciosKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['servicio-refacciones'] }),
    queryClient.invalidateQueries({ queryKey: evidenciasKeys.all }),
    queryClient.invalidateQueries({ queryKey: inventarioKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['clientes'] }),
    queryClient.invalidateQueries({ queryKey: ['maquinas'] }),
    queryClient.invalidateQueries({ queryKey: ['tecnicos'] }),
    queryClient.invalidateQueries({ queryKey: ['polizas'] }),
    queryClient.invalidateQueries({ queryKey: ['mantenimientos'] }),
    queryClient.invalidateQueries({ queryKey: ['mantenimiento-refacciones'] }),
    queryClient.invalidateQueries({ queryKey: ['maquinas-taller'] }),
  ])
}

async function refreshTecnicoQueries(ownerId: string, queryClient: QueryClient) {
  await hydrateTecnicoOfflineQueryCache(ownerId, queryClient, {
    fecha: formatLocalIsoDate(new Date()),
    tecnicoId: ownerId,
  })
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: serviciosKeys.all }),
    queryClient.invalidateQueries({ queryKey: ['servicio-refacciones'] }),
    queryClient.invalidateQueries({ queryKey: evidenciasKeys.all }),
    queryClient.invalidateQueries({ queryKey: inventarioKeys.all }),
  ])
}

export function useOfflineSync(options?: UseOfflineSyncOptions) {
  const queryClient = useQueryClient()
  const scope = options?.scope ?? 'admin'
  const pollIntervalMs = options?.pollIntervalMs ?? 3000
  const initialDelayMs = options?.initialDelayMs ?? 0
  const setPendingCount = useSyncStore((state) => state.setPendingCount)
  const setFailedCount = useSyncStore((state) => state.setFailedCount)
  const setConflictCount = useSyncStore((state) => state.setConflictCount)
  const setIsSyncing = useSyncStore((state) => state.setIsSyncing)
  const setLastSyncAt = useSyncStore((state) => state.setLastSyncAt)
  const setIsOnline = useSyncStore((state) => state.setIsOnline)
  const setAuthBlocked = useSyncStore((state) => state.setAuthBlocked)
  const setLastError = useSyncStore((state) => state.setLastError)
  const isRefreshingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let initialRunTimeout: number | null = null

    const refreshSummary = async (): Promise<SyncSummarySnapshot | null> => {
      if (cancelled || isRefreshingRef.current) return null
      isRefreshingRef.current = true

      try {
        await ensureOfflineDbHealthy()
        const ownerId = await getCurrentSessionUserId()
        if (!ownerId) {
          if (cancelled) return null
          setPendingCount(0)
          setFailedCount(0)
          setConflictCount(0)
          setLastError(null)
          setAuthBlocked(false)
          return null
        }

        const [summary, recentCommands] = await Promise.all([
          getSyncSummary(ownerId),
          getRecentCommands(ownerId, 8),
        ])

        if (cancelled) return null

        setPendingCount(
          summary.pendingCount + summary.syncingCount + summary.failedCount + summary.conflictCount,
        )
        setFailedCount(summary.failedCount)
        setConflictCount(summary.conflictCount)

        const latestError = recentCommands.find((command) => Boolean(command.lastError))?.lastError ?? null
        setLastError(latestError)
        return summary
      } finally {
        isRefreshingRef.current = false
      }
    }

    const runSync = async () => {
      if (cancelled) return

      setIsSyncing(true)
      try {
        await ensureOfflineDbHealthy()
        const ownerId = await getCurrentSessionUserId()
        const result = await syncPendingCommands()
        if (cancelled) return

        setAuthBlocked(result.blockedByAuth)

        if (ownerId && result.syncedCount > 0) {
          if (scope === 'tecnico') {
            await refreshTecnicoQueries(ownerId, queryClient)
          } else {
            await refreshAdminQueries(ownerId, queryClient)
          }
          setLastSyncAt(new Date())
        }
      } finally {
        if (!cancelled) {
          setIsSyncing(false)
          await refreshSummary()
        }
      }
    }

    const handleOnline = async () => {
      setIsOnline(true)
      await runSync()
    }

    const handleOffline = async () => {
      setIsOnline(false)
      await refreshSummary()
    }

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return
      await refreshSummary()
      if (navigator.onLine) {
        await runSync()
      }
    }

    const scheduleInitialWork = async () => {
      const summary = await refreshSummary()
      if (!summary || !navigator.onLine) {
        return
      }

      if (summary.pendingCount > 0 || summary.failedCount > 0 || summary.syncingCount > 0) {
        await runSync()
      }
    }

    if (initialDelayMs > 0) {
      initialRunTimeout = window.setTimeout(() => {
        void scheduleInitialWork()
      }, initialDelayMs)
    } else {
      void scheduleInitialWork()
    }

    const interval = window.setInterval(() => {
      void refreshSummary()
    }, pollIntervalMs)

    const onOnline = () => {
      void handleOnline()
    }
    const onOffline = () => {
      void handleOffline()
    }
    const onVisibilityChange = () => {
      void handleVisibilityChange()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      if (initialRunTimeout != null) {
        window.clearTimeout(initialRunTimeout)
      }
      window.clearInterval(interval)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [
    queryClient,
    setAuthBlocked,
    setConflictCount,
    setFailedCount,
    setIsOnline,
    setIsSyncing,
    setLastError,
    setLastSyncAt,
    setPendingCount,
    scope,
    pollIntervalMs,
    initialDelayMs,
  ])
}
