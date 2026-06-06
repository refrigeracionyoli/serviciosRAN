import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  discardPendingInstallationMachine,
  findRemoteMaquinaBySerie,
  queueMaquinaCreate,
  queueMaquinaUpdate,
} from '@/lib/offline/catalogos-actions'
import { isBrowserOnline, isLikelyNetworkError, isLikelyUniqueViolation } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { fetchPaginatedRows } from '@/lib/supabase-pagination'
import { getCachedMaquinasSnapshot, isLocalNumberId, upsertCachedMaquinas } from '@/lib/offline/cache'
import type { Maquina } from '@/types/domain.types'
import type { CrearMaquinaInput, EditarMaquinaInput } from '@/schemas/cliente.schema'

export const maquinasKeys = {
  all: ['maquinas'] as const,
  list: (clienteId?: number, includeInactive = false) => ['maquinas', 'list', clienteId, includeInactive] as const,
  detail: (id: number) => ['maquinas', 'detail', id] as const,
}

interface MaquinasQueryOptions {
  clienteId?: number
  includeInactive?: boolean
}

interface EditarMaquinaPayload {
  id: number
  data: EditarMaquinaInput
}

export function useMaquinasQuery(clienteIdOrOptions?: number | MaquinasQueryOptions) {
  const clienteId = typeof clienteIdOrOptions === 'number'
    ? clienteIdOrOptions
    : clienteIdOrOptions?.clienteId
  const includeInactive = typeof clienteIdOrOptions === 'number'
    ? false
    : Boolean(clienteIdOrOptions?.includeInactive)

  return useQuery({
    queryKey: maquinasKeys.list(clienteId, includeInactive),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(
        ownerId,
        ['maquina.create', 'maquina.update', 'servicio.update', 'servicio.close', 'taller.registrar_entrada', 'taller.registrar_salida', 'taller.reubicacion'],
      )
      if (shouldUseLocalOnly) {
        return getCachedMaquinasSnapshot(ownerId, { clienteId, includeInactive })
      }

      return withOfflineFallback({
        remote: async () => {
          const maquinas = await fetchPaginatedRows<Maquina>((from, to) => {
            let query = supabase
              .from('maquinas')
              .select('*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)')
              .order('serie')

            if (clienteId) query = query.eq('cliente_id', clienteId)
            if (!includeInactive) query = query.eq('activo', true)

            return query.range(from, to)
          })

          return maquinas
        },
        local: () => getCachedMaquinasSnapshot(ownerId, { clienteId, includeInactive }),
        onRemoteSuccess: (maquinas) => upsertCachedMaquinas(ownerId, maquinas),
      })
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearMaquinaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearMaquinaInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear la máquina.')
      }

      if (isBrowserOnline()) {
        try {
          if (typeof data.cliente_id === 'number' && isLocalNumberId(data.cliente_id)) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          const existing = await findRemoteMaquinaBySerie(data.serie)
          if (existing) {
            return existing
          }

          const { data: created, error } = await supabase
            .from('maquinas')
            .insert(data)
            .select('*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)')
            .single()
          if (error) throw error
          return created as Maquina
        } catch (error) {
          if (isLikelyUniqueViolation(error)) {
            const duplicated = await findRemoteMaquinaBySerie(data.serie)
            if (duplicated) {
              return duplicated
            }
          }

          if (error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') {
            return queueMaquinaCreate(ownerId, data)
          }

          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueMaquinaCreate(ownerId, data)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedMaquinas(ownerId, [created])
      }
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
    },
  })
}

export function useEditarMaquinaMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarMaquinaInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar la máquina.')
      }

      if (isBrowserOnline() && !isLocalNumberId(id)) {
        try {
          const { data: updated, error } = await supabase
            .from('maquinas')
            .update(data)
            .eq('id', id)
            .select('*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)')
            .single()
          if (error) throw error
          return updated as Maquina
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueMaquinaUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedMaquinas(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
    },
  })
}

export function useActualizarMaquinaMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: EditarMaquinaPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar la máquina.')
      }

      if (isBrowserOnline() && !isLocalNumberId(id)) {
        try {
          const { data: updated, error } = await supabase
            .from('maquinas')
            .update(data)
            .eq('id', id)
            .select('*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)')
            .single()
          if (error) throw error
          return updated as Maquina
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueMaquinaUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedMaquinas(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
    },
  })
}

export function useDescartarMaquinaPendienteInstalacionMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (maquinaId: number) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para descartar la máquina.')
      }

      return discardPendingInstallationMachine(ownerId, maquinaId)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
    },
  })
}
