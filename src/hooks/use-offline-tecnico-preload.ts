import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { ensureOfflineDbReady } from '@/lib/offline/db'
import {
  hasPreloadedTecnicoRouteModules,
  preloadTecnicoRouteModules,
} from '@/lib/offline/tecnico-route-preload'
import { preloadTecnicoOfflineData } from '@/lib/offline/tecnico-preload'
import { hydrateTecnicoOfflineQueryCache } from '@/lib/offline/tecnico-query-hydration'
import { hasTecnicoPreloadState } from '@/lib/offline/tecnico-preload-state'
import { formatLocalIsoDate } from '@/lib/utils'

const PRELOAD_RETRY_INTERVAL_MS = 1000 * 60 * 60
const PRELOAD_BOOTSTRAP_RETRY_INTERVAL_MS = 5000
const PRELOAD_INITIAL_DELAY_MS = 240

interface ReadyState {
  ownerId: string | null
  value: boolean
}

export function useOfflineTecnicoPreload() {
  const { user, perfil } = useAuth()
  const queryClient = useQueryClient()
  const tecnicoOwnerId = user?.id && perfil?.role === 'tecnico' ? user.id : null
  const fecha = formatLocalIsoDate(new Date())
  const persistedReady = useMemo(() => {
    if (!tecnicoOwnerId) return true
    return hasTecnicoPreloadState(tecnicoOwnerId)
  }, [tecnicoOwnerId])
  const [readyState, setReadyState] = useState<ReadyState>(() => ({
    ownerId: tecnicoOwnerId,
    value: persistedReady,
  }))
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine
  ))
  const [isRunning, setIsRunning] = useState(false)
  const [isCodeReady, setIsCodeReady] = useState(() => (
    tecnicoOwnerId ? hasPreloadedTecnicoRouteModules() : true
  ))
  const [isBootstrapping, setIsBootstrapping] = useState(() => Boolean(tecnicoOwnerId && !persistedReady))
  const [isInitializing, setIsInitializing] = useState(() => Boolean(tecnicoOwnerId))

  useEffect(() => {
    if (!tecnicoOwnerId) {
      setReadyState({ ownerId: null, value: true })
      setIsRunning(false)
      setIsCodeReady(true)
      setIsBootstrapping(false)
      setIsInitializing(false)
      return undefined
    }

    let cancelled = false
    let timeoutId: number | null = null
    let initialRunTimeoutId: number | null = null

    setIsOnline(navigator.onLine)
    setIsInitializing(true)
    setIsCodeReady(hasPreloadedTecnicoRouteModules())
    setReadyState((current) => (
      current.ownerId === tecnicoOwnerId
        ? current
        : { ownerId: tecnicoOwnerId, value: persistedReady }
    ))
    setIsBootstrapping(!persistedReady)

    const refreshReadyState = () => {
      if (cancelled) return false

      const nextReady = hasTecnicoPreloadState(tecnicoOwnerId)
      setReadyState({ ownerId: tecnicoOwnerId, value: nextReady })
      if (nextReady) {
        setIsBootstrapping(false)
      }
      return nextReady
    }

    const ensureRouteModules = async () => {
      await preloadTecnicoRouteModules()
      if (cancelled) return
      setIsCodeReady(true)
    }

    const hydrateQueries = async () => {
      await ensureOfflineDbReady({ recover: true })
      await hydrateTecnicoOfflineQueryCache(tecnicoOwnerId, queryClient, {
        fecha,
        tecnicoId: tecnicoOwnerId,
      })
      if (cancelled) return
      setReadyState({ ownerId: tecnicoOwnerId, value: true })
      setIsBootstrapping(false)
    }

    const needsBootstrap = !hasTecnicoPreloadState(tecnicoOwnerId)
    setReadyState({ ownerId: tecnicoOwnerId, value: !needsBootstrap })
    setIsBootstrapping(needsBootstrap)

    const runPreload = async (options?: { force?: boolean; allowHidden?: boolean; keepInitializing?: boolean }) => {
      if (cancelled || !navigator.onLine) return
      if (!options?.allowHidden && document.visibilityState === 'hidden') return

      setIsRunning(true)
      if (!hasTecnicoPreloadState(tecnicoOwnerId)) {
        setIsBootstrapping(true)
      }

      try {
        await ensureOfflineDbReady({ recover: true })
        await Promise.all([
          ensureRouteModules(),
          preloadTecnicoOfflineData(tecnicoOwnerId, tecnicoOwnerId, {
            fecha,
            force: options?.force,
          }),
        ])
        if (cancelled) return
        await hydrateQueries()
      } catch {
        refreshReadyState()
      } finally {
        if (!cancelled) {
          setIsRunning(false)
          if (!options?.keepInitializing && hasTecnicoPreloadState(tecnicoOwnerId)) {
            setIsInitializing(false)
          }
        }
      }
    }

    const scheduleNextRun = () => {
      if (cancelled) return

      const delay = hasTecnicoPreloadState(tecnicoOwnerId)
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

      if (navigator.onLine || hasPreloadedTecnicoRouteModules()) {
        bootstrapTasks.push(ensureRouteModules())
      }

      void Promise.all(bootstrapTasks).finally(() => {
        if (!cancelled) {
          setIsInitializing(false)
        }
      })
    }

    initialRunTimeoutId = window.setTimeout(() => {
      void runPreload({
        force: needsBootstrap,
        allowHidden: needsBootstrap,
        keepInitializing: !needsBootstrap,
      }).finally(() => {
        scheduleNextRun()
      })
    }, PRELOAD_INITIAL_DELAY_MS)

    const onOnline = () => {
      setIsOnline(true)
      void runPreload({
        force: !hasTecnicoPreloadState(tecnicoOwnerId),
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
      if (initialRunTimeoutId != null) {
        window.clearTimeout(initialRunTimeoutId)
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId)
      }
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fecha, persistedReady, queryClient, tecnicoOwnerId])

  const isReady = tecnicoOwnerId
    ? readyState.ownerId === tecnicoOwnerId
      ? readyState.value
      : persistedReady
    : true

  const isBlocking = useMemo(() => {
    if (!tecnicoOwnerId) return false
    if (isInitializing) return true
    const requiresInitialSnapshot = !persistedReady
    if (!isCodeReady) return isOnline || requiresInitialSnapshot
    return !isReady && (isBootstrapping || requiresInitialSnapshot)
  }, [isBootstrapping, isCodeReady, isInitializing, isOnline, isReady, persistedReady, tecnicoOwnerId])

  return {
    isBlocking,
    isReady,
    isRunning,
  }
}
