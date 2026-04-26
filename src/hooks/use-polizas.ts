import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  findRemotePolizaByFingerprint,
  queuePolizaCreate,
  queuePolizaDelete,
  queuePolizaPausaCreate,
  queuePolizaPausaResume,
  queuePolizaSetActive,
  queuePolizaUpdate,
  type CrearPolizaPausaInput,
} from '@/lib/offline/polizas-actions'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import {
  getCachedPolizaEstadoHistorialSnapshot,
  getCachedPolizaPausasSnapshot,
  getCachedPolizasSnapshot,
  isLocalNumberId,
  upsertCachedPolizaEstadoHistorial,
  upsertCachedPolizaPausas,
  upsertCachedPolizas,
} from '@/lib/offline/cache'
import type { Poliza, PolizaEstadoHistorial, PolizaPausa } from '@/types/domain.types'
import type { CrearPolizaInput, EditarPolizaInput } from '@/schemas/poliza.schema'

export const polizasKeys = {
  all: ['polizas'] as const,
  list: () => ['polizas', 'list'] as const,
  detail: (id: number) => ['polizas', 'detail', id] as const,
  history: (polizaId?: number) => ['polizas', 'history', polizaId] as const,
  pauses: () => ['polizas', 'pauses'] as const,
}

const SELECT_POLIZA = `*, cliente:clientes(*), maquina:maquinas(*)`

export function usePolizasQuery() {
  return useQuery({
    queryKey: polizasKeys.list(),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(
        ownerId,
        ['poliza.create', 'poliza.update', 'poliza.set_active', 'poliza.delete'],
      )
      if (shouldUseLocalOnly) {
        return getCachedPolizasSnapshot(ownerId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('polizas')
            .select(SELECT_POLIZA)
            .order('created_at', { ascending: false })
          if (error) throw error
          await upsertCachedPolizas(ownerId, data as Poliza[])
          return getCachedPolizasSnapshot(ownerId)
        },
        local: () => getCachedPolizasSnapshot(ownerId),
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function usePolizaEstadoHistorialQuery(polizaId?: number) {
  return useQuery({
    queryKey: polizasKeys.history(polizaId),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = (polizaId != null && isLocalNumberId(polizaId)) || await hasBlockingRemoteFetchCommands(
        ownerId,
        ['poliza.create', 'poliza.update', 'poliza.set_active', 'poliza.delete'],
        polizaId != null ? { entityId: polizaId } : undefined,
      )
      if (shouldUseLocalOnly) {
        return getCachedPolizaEstadoHistorialSnapshot(ownerId, polizaId)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('poliza_estado_historial')
            .select('*')
            .order('changed_at', { ascending: true })

          if (polizaId) query = query.eq('poliza_id', polizaId)

          const { data, error } = await query
          if (error) throw error
          await upsertCachedPolizaEstadoHistorial(ownerId, data as PolizaEstadoHistorial[])
          return getCachedPolizaEstadoHistorialSnapshot(ownerId, polizaId)
        },
        local: () => getCachedPolizaEstadoHistorialSnapshot(ownerId, polizaId),
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function usePolizaPausasQuery() {
  return useQuery({
    queryKey: polizasKeys.pauses(),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, [
        'poliza_pause.create',
        'poliza_pause.resume',
      ])
      if (shouldUseLocalOnly) {
        return getCachedPolizaPausasSnapshot(ownerId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('poliza_pausas')
            .select('*')
            .order('fecha_inicio', { ascending: false })
          if (error) throw error
          await upsertCachedPolizaPausas(ownerId, data as PolizaPausa[])
          return getCachedPolizaPausasSnapshot(ownerId)
        },
        local: () => getCachedPolizaPausasSnapshot(ownerId),
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useCrearPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearPolizaInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear la póliza.')
      }

      if (isBrowserOnline()) {
        try {
          const hasLocalReferences = isLocalNumberId(data.cliente_id) || isLocalNumberId(data.maquina_id)
          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          const existing = await findRemotePolizaByFingerprint(data.cliente_id, data.maquina_id, data.fecha_inicio)
          if (existing) {
            return existing
          }

          const { data: created, error } = await supabase
            .from('polizas')
            .insert(data)
            .select(SELECT_POLIZA)
            .single()
          if (error) throw error
          return created as Poliza
        } catch (error) {
          if (error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') {
            return queuePolizaCreate(ownerId, data)
          }

          if (!isLikelyNetworkError(error)) {
            const duplicated = await findRemotePolizaByFingerprint(data.cliente_id, data.maquina_id, data.fecha_inicio)
            if (duplicated) {
              return duplicated
            }

            throw error
          }
        }
      }

      return queuePolizaCreate(ownerId, data)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedPolizas(ownerId, [created])
      }
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
    },
  })
}

export function useEditarPolizaMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarPolizaInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar la póliza.')
      }

      if (isBrowserOnline() && !isLocalNumberId(id)) {
        try {
          const { data: updated, error } = await supabase
            .from('polizas')
            .update(data)
            .eq('id', id)
            .select(SELECT_POLIZA)
            .single()
          if (error) throw error
          return updated as Poliza
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queuePolizaUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedPolizas(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
      await qc.invalidateQueries({ queryKey: polizasKeys.history(updated.id) })
    },
  })
}

export function useCrearPolizaPausaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearPolizaPausaInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para pausar las pólizas.')
      }

      const payload = {
        fecha_inicio: data.fecha_inicio,
        motivo: data.motivo?.trim() || null,
      }

      if (isBrowserOnline()) {
        try {
          const { data: created, error } = await supabase
            .from('poliza_pausas')
            .insert({
              ...payload,
              fecha_reanudacion: null,
              created_by: ownerId,
            })
            .select('*')
            .single()
          if (error) throw error
          return created as PolizaPausa
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queuePolizaPausaCreate(ownerId, payload)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedPolizaPausas(ownerId, [created])
      }
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
    },
  })
}

export function useReanudarPolizaPausaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, fecha_reanudacion }: { id: number; fecha_reanudacion: string }) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para reanudar las pólizas.')
      }

      if (isBrowserOnline() && !isLocalNumberId(id)) {
        try {
          const { data: updated, error } = await supabase
            .from('poliza_pausas')
            .update({
              fecha_reanudacion,
              resumed_at: new Date().toISOString(),
              resumed_by: ownerId,
            })
            .eq('id', id)
            .select('*')
            .single()
          if (error) throw error
          return updated as PolizaPausa
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queuePolizaPausaResume(ownerId, id, fecha_reanudacion)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedPolizaPausas(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
    },
  })
}

export function useDesactivarPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para desactivar la póliza.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('polizas')
            .update({ activa: false })
            .eq('id', id)
            .select(SELECT_POLIZA)
            .single()
          if (error) throw error
          return updated as Poliza
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queuePolizaSetActive(ownerId, id, false)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedPolizas(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
    },
  })
}

export function useActivarPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para activar la póliza.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('polizas')
            .update({ activa: true })
            .eq('id', id)
            .select(SELECT_POLIZA)
            .single()
          if (error) throw error
          return updated as Poliza
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queuePolizaSetActive(ownerId, id, true)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedPolizas(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
    },
  })
}

export function useEliminarPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para eliminar la póliza.')
      }

      if (isBrowserOnline()) {
        try {
          const { error } = await supabase
            .from('polizas')
            .delete()
            .eq('id', id)
          if (error) throw error
          return id
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queuePolizaDelete(ownerId, id)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: polizasKeys.all })
    },
  })
}
