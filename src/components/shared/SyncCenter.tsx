import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, CheckCircle2, RefreshCw, WifiOff, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { getRecentCommands } from '@/lib/offline/commands'
import { ensureOfflineDbHealthy } from '@/lib/offline/db'
import { discardOfflineCommand } from '@/lib/offline/discard'
import { getSyncCommandPresentation } from '@/lib/offline/sync-presenter'
import { hydrateAdminOfflineQueryCache } from '@/lib/offline/query-hydration'
import { hydrateTecnicoOfflineQueryCache } from '@/lib/offline/tecnico-query-hydration'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { syncPendingCommands } from '@/lib/offline/sync-engine'
import { useToast } from '@/hooks/use-toast'
import { useSyncStore } from '@/stores/sync.store'
import { formatDateTime, formatLocalIsoDate } from '@/lib/utils'

interface SyncCenterProps {
  scope: 'admin' | 'tecnico'
  open: boolean
  onClose: () => void
}

function getStatusLabel(status: string): string {
  if (status === 'pending') return 'Pendiente'
  if (status === 'syncing') return 'Sincronizando'
  if (status === 'failed') return 'Error'
  if (status === 'conflict') return 'Conflicto'
  if (status === 'done') return 'Sincronizado'
  return status
}

function getStatusClass(status: string): string {
  if (status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (status === 'syncing') return 'border-blue-200 bg-blue-50 text-blue-800'
  if (status === 'failed') return 'border-red-200 bg-red-50 text-red-800'
  if (status === 'conflict') return 'border-orange-200 bg-orange-50 text-orange-800'
  if (status === 'done') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export function SyncCenter({ scope, open, onClose }: SyncCenterProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [isRunning, setIsRunning] = useState(false)
  const [discardingId, setDiscardingId] = useState<string | null>(null)
  const pendingCount = useSyncStore((state) => state.pendingCount)
  const failedCount = useSyncStore((state) => state.failedCount)
  const conflictCount = useSyncStore((state) => state.conflictCount)
  const authBlocked = useSyncStore((state) => state.authBlocked)
  const isOnline = useSyncStore((state) => state.isOnline)
  const lastSyncAt = useSyncStore((state) => state.lastSyncAt)

  const recentCommands = useLiveQuery(async () => {
    const ownerId = await getCurrentSessionUserId()
    if (!ownerId) return []
    await ensureOfflineDbHealthy()
    return getRecentCommands(ownerId, 10)
  }, [], [])

  if (!open) return null

  const handleSyncNow = async () => {
    setIsRunning(true)
    try {
      const ownerId = await getCurrentSessionUserId()
      const result = await syncPendingCommands()
      if (ownerId && result.syncedCount > 0) {
        if (scope === 'tecnico') {
          await hydrateTecnicoOfflineQueryCache(ownerId, queryClient, {
            fecha: formatLocalIsoDate(new Date()),
            tecnicoId: ownerId,
          })
        } else {
          await hydrateAdminOfflineQueryCache(ownerId, queryClient)
        }
        await queryClient.invalidateQueries()
      }
    } finally {
      setIsRunning(false)
    }
  }

  const handleDiscard = async (commandId: string) => {
    setDiscardingId(commandId)
    try {
      const ownerId = await getCurrentSessionUserId()
      const result = await discardOfflineCommand(commandId)
      if (ownerId) {
        if (scope === 'tecnico') {
          await hydrateTecnicoOfflineQueryCache(ownerId, queryClient, {
            fecha: formatLocalIsoDate(new Date()),
            tecnicoId: ownerId,
          })
        } else {
          await hydrateAdminOfflineQueryCache(ownerId, queryClient)
        }
      }
      await queryClient.invalidateQueries()
      toast({
        title: 'Cambio descartado',
        description: result.discardedCount > 1
          ? `Se descartaron ${result.discardedCount} cambios relacionados.`
          : 'El cambio con error ya no volverá a sincronizarse.',
      })
    } catch (error) {
      toast({
        title: 'No se pudo descartar',
        description: error instanceof Error ? error.message : 'Ocurrió un error al limpiar el cambio fallido.',
        variant: 'destructive',
      })
    } finally {
      setDiscardingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-[2px]">
      <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
        <div className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] border border-slate-200 bg-white shadow-2xl sm:max-h-[min(100dvh-2rem,52rem)] sm:rounded-[28px]">
          <div className="shrink-0 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-ran-navy">Centro de sincronización</h3>
                <p className="text-sm text-ran-slate">
                  {lastSyncAt ? `Última sincronización: ${formatDateTime(lastSyncAt)}` : 'Aún no se ha sincronizado.'}
                </p>
              </div>

              <Button type="button" variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 rounded-full">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pendientes</p>
                <p className="mt-1 text-2xl font-extrabold text-ran-navy">{pendingCount}</p>
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Errores</p>
                <p className="mt-1 text-2xl font-extrabold text-red-800">{failedCount}</p>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Conflictos</p>
                <p className="mt-1 text-2xl font-extrabold text-orange-800">{conflictCount}</p>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Conexión</p>
                <p className="mt-1 text-sm font-bold text-blue-900">{isOnline ? 'En línea' : 'Sin conexión'}</p>
              </div>
            </div>

            {authBlocked && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                  <p className="text-sm text-amber-800">
                    La sincronización quedó bloqueada por autenticación. Inicia sesión nuevamente para continuar.
                  </p>
                </div>
              </div>
            )}

            {!isOnline && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start gap-3">
                  <WifiOff className="mt-0.5 h-4 w-4 text-slate-600" />
                  <p className="text-sm text-slate-700">
                    Los cambios seguirán guardándose localmente y se intentarán enviar cuando vuelva la red.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Actividad reciente</h4>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void handleSyncNow()
                  }}
                  disabled={isRunning || !isOnline}
                  className="w-full rounded-xl sm:w-auto"
                >
                  <RefreshCw className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} />
                  Sincronizar ahora
                </Button>
              </div>

              <div className="space-y-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]">
                {(recentCommands ?? []).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    No hay actividad de sincronización registrada todavía.
                  </div>
                ) : (
                  recentCommands?.map((command) => {
                    const presentation = getSyncCommandPresentation(command)

                    return (
                      <article key={command.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ran-navy">{presentation.title}</p>
                            {presentation.description && (
                              <p className="mt-1 text-xs text-slate-600">{presentation.description}</p>
                            )}
                            <p className="mt-1 text-xs text-slate-500">{formatDateTime(command.updatedAt)}</p>
                            {command.lastError && (
                              <p className="mt-2 text-xs text-red-700">{command.lastError}</p>
                            )}
                          </div>

                          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getStatusClass(command.status)}`}>
                            {command.status === 'done' ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : null}
                            {getStatusLabel(command.status)}
                          </span>
                        </div>

                        {(command.status === 'failed' || command.status === 'conflict') && (
                          <div className="mt-3 flex justify-end">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => {
                                void handleDiscard(command.id)
                              }}
                              disabled={discardingId === command.id}
                            >
                              {discardingId === command.id ? 'Descartando…' : 'Descartar'}
                            </Button>
                          </div>
                        )}
                      </article>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
