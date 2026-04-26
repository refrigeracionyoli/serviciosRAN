import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/use-auth'
import { hydrateInventarioQueryCache, inventarioKeys } from '@/hooks/use-inventario'
import { autoReturnInventarioTecnicoRows } from '@/lib/offline/inventario-auto-return'
import { formatLocalIsoDate } from '@/lib/utils'

interface UseInventarioTecnicoAutoReturnOptions {
  enabled?: boolean
}

const AUTO_RETURN_RUN_DEBOUNCE_MS = 15_000
const AUTO_RETURN_INITIAL_DELAY_MS = 900
const recentRunAtByKey = new Map<string, number>()
const inFlightRunsByKey = new Map<string, Promise<void>>()

function getToday(): string {
  return formatLocalIsoDate(new Date())
}

function getMsUntilNextDay(): number {
  const now = new Date()
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return Math.max(1_000, nextMidnight.getTime() - now.getTime() + 250)
}

export function useInventarioTecnicoAutoReturn(options?: UseInventarioTecnicoAutoReturnOptions) {
  const enabled = options?.enabled ?? true
  const queryClient = useQueryClient()
  const { user, perfil } = useAuth()
  const [today, setToday] = useState(() => getToday())

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setToday(getToday())
    }, getMsUntilNextDay())

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      setToday((current) => {
        const next = getToday()
        return current === next ? current : next
      })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearTimeout(timeoutId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [today])

  useEffect(() => {
    if (!enabled || !user?.id || !perfil?.activo) {
      return undefined
    }

    let cancelled = false

    const run = async () => {
      const runKey = `${user.id}:${today}:${navigator.onLine ? 'online' : 'offline'}`
      const lastRunAt = recentRunAtByKey.get(runKey) ?? 0
      if (Date.now() - lastRunAt < AUTO_RETURN_RUN_DEBOUNCE_MS) {
        return
      }

      const existingRun = inFlightRunsByKey.get(runKey)
      if (existingRun) {
        await existingRun
        return
      }

      const pendingRun = (async () => {
        const result = await autoReturnInventarioTecnicoRows({
          ownerId: user.id,
          actorId: user.id,
          actorRole: perfil.role,
          today,
        })

        if (cancelled) return

        if (result.queuedCount > 0 || result.cleanedOrphanCount > 0) {
          await hydrateInventarioQueryCache(user.id, queryClient)
          await queryClient.invalidateQueries({ queryKey: inventarioKeys.all })
          await queryClient.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot })
          await queryClient.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
        }
      })()

      inFlightRunsByKey.set(runKey, pendingRun)

      try {
        await pendingRun
        recentRunAtByKey.set(runKey, Date.now())
      } finally {
        if (inFlightRunsByKey.get(runKey) === pendingRun) {
          inFlightRunsByKey.delete(runKey)
        }
      }
    }

    const initialRunTimeoutId = window.setTimeout(() => {
      void run()
    }, AUTO_RETURN_INITIAL_DELAY_MS)

    const handleOnline = () => {
      void run()
    }

    window.addEventListener('online', handleOnline)

    return () => {
      cancelled = true
      window.clearTimeout(initialRunTimeoutId)
      window.removeEventListener('online', handleOnline)
    }
  }, [enabled, perfil?.activo, perfil?.role, queryClient, today, user?.id])
}
