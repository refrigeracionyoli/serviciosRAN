import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { getSyncSummary } from '@/lib/offline/commands'
import {
  hasPreloadedAdminRouteModules,
  preloadAdminRouteModules,
} from '@/lib/offline/admin-route-preload'
import { preloadAdminOfflineData } from '@/lib/offline/preload'
import { hydrateAdminOfflineQueryCache } from '@/lib/offline/query-hydration'
import { hasAdminPreloadState } from '@/lib/offline/preload-state'

const PRELOAD_RETRY_INTERVAL_MS = 1000 * 60 * 60 * 4
const PRELOAD_BOOTSTRAP_RETRY_INTERVAL_MS = 5000

interface ReadyState {
  ownerId: string | null
  value: boolean
}

export function useOfflineAdminPreload() {
  const { user, perfil } = useAuth()
  const queryClient = useQueryClient()
  const adminOwnerId = user?.id && perfil?.role === 'admin' ? user.id : null
  const persistedReady = useMemo(() => {
    if (!adminOwnerId) return true
    return hasAdminPreloadState(adminOwnerId)
  }, [adminOwnerId])
  const [readyState, setReadyState] = useState<ReadyState>(() => ({
    ownerId: adminOwnerId,
    value: persistedReady,
  }))
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ))
  const [isRunning, setIsRunning] = useState(false)
  const [isCodeReady, setIsCodeReady] = useState(() => (
    adminOwnerId ? hasPreloadedAdminRouteModules() : true
  ))
  const [isBootstrapping, setIsBootstrapping] = useState(() => Boolean(adminOwnerId && !persistedReady))
  const [isInitializing, setIsInitializing] = useState(() => Boolean(adminOwnerId))

  useEffect(() => {
    if (!adminOwnerId) {
      setReadyState({ ownerId: null, value: true })
      setIsRunning(false)
      setIsCodeReady(true)
      setIsBootstrapping(false)
      setIsInitializing(false)
      return undefined
    }

    let cancelled = false
    let timeoutId: number | null = null

    setIsOnline(navigator.onLine)
    setIsInitializing(true)
    setIsCodeReady(hasPreloadedAdminRouteModules())

    setReadyState((current) => (
      current.ownerId === adminOwnerId
        ? current
        : { ownerId: adminOwnerId, value: persistedReady }
    ))
    setIsBootstrapping(!persistedReady)

    const refreshReadyState = () => {
      if (cancelled) return false

      const nextReady = hasAdminPreloadState(adminOwnerId)
      setReadyState({ ownerId: adminOwnerId, value: nextReady })
      if (nextReady) {
        setIsBootstrapping(false)
      }
      return nextReady
    }

    const ensureRouteModules = async () => {
      await preloadAdminRouteModules()
      if (cancelled) return
      setIsCodeReady(true)
    }

    const hydrateQueries = async () => {
      await hydrateAdminOfflineQueryCache(adminOwnerId, queryClient)
      if (cancelled) return
      setReadyState({ ownerId: adminOwnerId, value: true })
      setIsBootstrapping(false)
    }

    const needsBootstrap = !hasAdminPreloadState(adminOwnerId)
    setReadyState({ ownerId: adminOwnerId, value: !needsBootstrap })
    setIsBootstrapping(needsBootstrap)

    const runPreload = async (options?: { force?: boolean; allowHidden?: boolean; keepInitializing?: boolean }) => {
      if (cancelled || !navigator.onLine) return
      if (!options?.allowHidden && document.visibilityState === 'hidden') return

      const requiresBootstrap = !hasAdminPreloadState(adminOwnerId)

      const summary = await getSyncSummary(adminOwnerId)
      if (cancelled) return

      const blockingCommandCount = (
        summary.pendingCount
        + summary.syncingCount
      )

      if (blockingCommandCount > 0) {
        refreshReadyState()
        return
      }

      setIsRunning(true)
      if (requiresBootstrap) {
        setIsBootstrapping(true)
      }

      try {
        await Promise.all([
          ensureRouteModules(),
          preloadAdminOfflineData(adminOwnerId, { force: options?.force }),
        ])
        if (cancelled) return
        await hydrateQueries()
      } catch {
        refreshReadyState()
      } finally {
        if (!cancelled) {
          setIsRunning(false)
          if (!options?.keepInitializing && hasAdminPreloadState(adminOwnerId)) {
            setIsInitializing(false)
          }
        }
      }
    }

    const scheduleNextRun = () => {
      if (cancelled) return

      const delay = hasAdminPreloadState(adminOwnerId)
        ? PRELOAD_RETRY_INTERVAL_MS
        : PRELOAD_BOOTSTRAP_RETRY_INTERVAL_MS

      timeoutId = window.setTimeout(() => {
        void runPreload().finally(() => {
          scheduleNextRun()
        })
      }, delay)
    }

    if (persistedReady) {
      const bootstrapTasks = [hydrateQueries()]

      if (navigator.onLine || hasPreloadedAdminRouteModules()) {
        bootstrapTasks.push(ensureRouteModules())
      }

      void Promise.all(bootstrapTasks).finally(() => {
        if (!cancelled) {
          setIsInitializing(false)
        }
      })
    }

    void runPreload({
      force: needsBootstrap,
      allowHidden: needsBootstrap,
      keepInitializing: !needsBootstrap,
    }).finally(() => {
      scheduleNextRun()
    })

    const onOnline = () => {
      setIsOnline(true)
      void runPreload({
        force: !hasAdminPreloadState(adminOwnerId),
        allowHidden: true,
        keepInitializing: false,
      })
    }

    const onOffline = () => {
      setIsOnline(false)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runPreload({ keepInitializing: false })
      }
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [adminOwnerId, persistedReady, queryClient])

  const isReady = adminOwnerId
    ? readyState.ownerId === adminOwnerId
      ? readyState.value
      : persistedReady
    : true

  const isBlocking = useMemo(() => {
    if (!adminOwnerId) return false
    if (isInitializing) return true
    const requiresInitialSnapshot = !persistedReady
    if (!isCodeReady) return isOnline || requiresInitialSnapshot
    return !isReady && (isBootstrapping || requiresInitialSnapshot)
  }, [adminOwnerId, isBootstrapping, isCodeReady, isInitializing, isOnline, isReady, persistedReady])

  return {
    isBlocking,
    isReady,
    isRunning,
  }
}
