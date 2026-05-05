import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  findRemoteClienteByCodigo,
  queueClienteCreate,
  queueClienteDelete,
  queueClienteUpdate,
} from '@/lib/offline/catalogos-actions'
import { isBrowserOnline, isLikelyNetworkError, isLikelyUniqueViolation } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { fetchPaginatedRows } from '@/lib/supabase-pagination'
import {
  getCachedClientesSnapshot,
  getCachedServiciosSnapshot,
  isLocalNumberId,
  upsertCachedClientes,
} from '@/lib/offline/cache'
import type { Cliente } from '@/types/domain.types'
import type { CrearClienteInput, EditarClienteInput } from '@/schemas/cliente.schema'

export const clientesKeys = {
  all: ['clientes'] as const,
  list: (includeInactive = false) => ['clientes', 'list', includeInactive] as const,
  detail: (id: number) => ['clientes', 'detail', id] as const,
}

interface ClientesQueryOptions {
  includeInactive?: boolean
}

interface EditarClientePayload {
  id: number
  data: EditarClienteInput
}

export function useClienteDetalleQuery(id?: number) {
  return useQuery({
    queryKey: clientesKeys.detail(id ?? 0),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId || typeof id !== 'number') {
        throw new Error('No hay contexto suficiente para consultar el cliente.')
      }

      const shouldUseLocalOnly = isLocalNumberId(id) || await hasBlockingRemoteFetchCommands(
        ownerId,
        ['cliente.create', 'cliente.update', 'cliente.delete'],
        { entityId: id },
      )

      if (shouldUseLocalOnly) {
        const clientes = await getCachedClientesSnapshot(ownerId, true)
        const cached = clientes.find((cliente) => cliente.id === id)
        if (!cached) {
          throw new Error('No hay datos locales para este cliente.')
        }
        return cached
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('clientes')
            .select('*')
            .eq('id', id)
            .single()
          if (error) throw error
          return data as Cliente
        },
        local: async () => {
          const clientes = await getCachedClientesSnapshot(ownerId, true)
          const cached = clientes.find((cliente) => cliente.id === id)
          if (!cached) {
            throw new Error('No hay datos locales para este cliente.')
          }
          return cached
        },
        onRemoteSuccess: (cliente) => upsertCachedClientes(ownerId, [cliente]),
      })
    },
    enabled: typeof id === 'number' && Number.isFinite(id),
    staleTime: 1000 * 60 * 5,
  })
}

export function useClientesQuery(options?: ClientesQueryOptions) {
  const includeInactive = Boolean(options?.includeInactive)

  return useQuery({
    queryKey: clientesKeys.list(includeInactive),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(
        ownerId,
        ['cliente.create', 'cliente.update', 'cliente.delete'],
      )
      if (shouldUseLocalOnly) {
        return getCachedClientesSnapshot(ownerId, includeInactive)
      }

      return withOfflineFallback({
        remote: async () => {
          const clientes = await fetchPaginatedRows<Cliente>((from, to) => {
            let query = supabase
              .from('clientes')
              .select('*')
              .order('nombre')

            if (!includeInactive) {
              query = query.eq('activo', true)
            }

            return query.range(from, to)
          })

          return clientes
        },
        local: () => getCachedClientesSnapshot(ownerId, includeInactive),
        onRemoteSuccess: (clientes) => upsertCachedClientes(ownerId, clientes),
      })
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearClienteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearClienteInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear el cliente.')
      }

      if (isBrowserOnline()) {
        try {
          const existing = await findRemoteClienteByCodigo(data.codigo_cliente)
          if (existing) {
            return existing
          }

          const { data: created, error } = await supabase
            .from('clientes')
            .insert(data)
            .select()
            .single()
          if (error) throw error
          return created as Cliente
        } catch (error) {
          if (isLikelyUniqueViolation(error)) {
            const duplicated = await findRemoteClienteByCodigo(data.codigo_cliente)
            if (duplicated) {
              return duplicated
            }
          }

          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueClienteCreate(ownerId, data)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedClientes(ownerId, [created])
      }
      await qc.invalidateQueries({ queryKey: clientesKeys.all })
    },
  })
}

export function useEditarClienteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: EditarClientePayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el cliente.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('clientes')
            .update(data)
            .eq('id', id)
            .select()
            .single()
          if (error) throw error
          return updated as Cliente
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueClienteUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedClientes(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: clientesKeys.all })
    },
  })
}

export function useEliminarClienteMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (id: number) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para eliminar el cliente.')
      }

      const cachedServicios = await getCachedServiciosSnapshot(ownerId)
      if (cachedServicios.some((servicio) => servicio.cliente_id === id)) {
        throw new Error('No se puede eliminar porque el cliente ya tiene servicios registrados.')
      }

      if (isBrowserOnline()) {
        try {
          const { error } = await supabase
            .from('clientes')
            .delete()
            .eq('id', id)

          if (error) throw error
          return id
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueClienteDelete(ownerId, id)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: clientesKeys.all })
    },
  })
}
