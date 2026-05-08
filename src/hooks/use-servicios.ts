import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/use-auth'
import { deleteServicioCompleto } from '@/lib/r2'
import {
  hasBlockingRemoteFetchCommands,
  queueServiceCompletionCommand,
} from '@/lib/offline/commands'
import {
  findRemoteServicioByOrden,
  queueServicioCreate,
  queueServicioReplaceRefaccionesCommand,
  queueServicioReplaceRefacciones,
  syncServicioUpdate,
  syncServicioReplaceRefacciones,
  queueServicioUpdate,
} from '@/lib/offline/servicios-actions'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { isBrowserOnline, isLikelyNetworkError, isLikelyUniqueViolation } from '@/lib/offline/network'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { fetchPaginatedRows } from '@/lib/supabase-pagination'
import {
  getCachedEvidenciasByServicio,
  getCachedServicioDetalleSnapshot,
  getCachedServicioRefaccionesSnapshot,
  getCachedServiciosSnapshot,
  isLocalNumberId,
  removeCachedServicio,
  replaceCachedServiciosListSnapshot,
  replaceCachedEvidenciasForServicio,
  upsertCachedServicio,
  upsertCachedServicioRefacciones,
} from '@/lib/offline/cache'
import { settleQueuedCommand } from '@/lib/offline/sync-engine'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import { buildServicioCompletionRequirementMessage, summarizeServicioEvidencias } from '@/lib/tecnico/servicio-evidencias'
import type { Evidencia, RefaccionInventorySource, Servicio, FiltrosServicio, ServicioRefaccion, ServicioStatus } from '@/types/domain.types'
import type { CrearServicioInput, EditarServicioInput } from '@/schemas/servicio.schema'
import { inventarioKeys } from './use-inventario'
import { maquinasKeys } from './use-maquinas'
import { maquinasTallerKeys } from './use-maquinas-taller'

interface NormalizedServiciosListFilters {
  status: FiltrosServicio['status']
  tecnicoId: string | null
  clienteId: number | null
  fechaDesde: string | null
  fechaHasta: string | null
  tipoServicio: FiltrosServicio['tipoServicio']
  search: string | null
}

interface ServiciosQueryOptions {
  enabled?: boolean
}

export function normalizeServiciosListFilters(
  filtros?: FiltrosServicio,
): NormalizedServiciosListFilters | null {
  const normalized: NormalizedServiciosListFilters = {
    status: filtros?.status ?? null,
    tecnicoId: filtros?.tecnicoId ?? null,
    clienteId: filtros?.clienteId ?? null,
    fechaDesde: filtros?.fechaDesde ?? null,
    fechaHasta: filtros?.fechaHasta ?? null,
    tipoServicio: filtros?.tipoServicio ?? null,
    search: filtros?.search?.trim() || null,
  }

  return Object.values(normalized).some((value) => value != null && value !== '')
    ? normalized
    : null
}

export const serviciosKeys = {
  all: ['servicios'] as const,
  list: (filtros?: FiltrosServicio) => ['servicios', 'list', normalizeServiciosListFilters(filtros)] as const,
  detail: (id: number) => ['servicios', 'detail', id] as const,
  refacciones: (id: number) => ['servicio-refacciones', id] as const,
}

const SELECT_SERVICIO = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, role)
`

const UNRESOLVED_SERVICE_COMMANDS = [
  'servicio.create',
  'servicio.update',
  'servicio.replace_refacciones',
  'servicio.close',
] as const

const UNRESOLVED_SERVICE_REFACCIONES_COMMANDS = [
  'servicio.replace_refacciones',
  'service.complete_with_refacciones',
] as const

const UNRESOLVED_SERVICE_EVIDENCIAS_COMMANDS = [
  'servicio.create',
  'service.add_evidencia',
  'service.delete_evidencia',
] as const

function compareServiciosByCreatedAtDesc(left: Servicio, right: Servicio) {
  return right.created_at.localeCompare(left.created_at)
}

function matchesServicioListFilters(
  servicio: Servicio,
  filtros: NormalizedServiciosListFilters | null | undefined,
) {
  if (!filtros) return true
  if (filtros.status && servicio.status !== filtros.status) return false
  if (filtros.tecnicoId && servicio.tecnico_id !== filtros.tecnicoId) return false
  if (filtros.clienteId && servicio.cliente_id !== filtros.clienteId) return false
  if (filtros.fechaDesde && (!servicio.fecha_servicio || servicio.fecha_servicio < filtros.fechaDesde)) return false
  if (filtros.fechaHasta && (!servicio.fecha_servicio || servicio.fecha_servicio > filtros.fechaHasta)) return false
  if (filtros.tipoServicio && servicio.tipo_servicio !== filtros.tipoServicio) return false

  if (filtros.search) {
    const needle = filtros.search.toLowerCase()
    const values = [
      servicio.orden?.toString() ?? '',
      servicio.aviso?.toString() ?? '',
      servicio.tipo_servicio ?? '',
      servicio.descripcion ?? '',
      servicio.cliente?.codigo_cliente ?? '',
      servicio.cliente?.nombre ?? '',
      servicio.maquina?.modelo ?? '',
      servicio.maquina?.serie ?? '',
      servicio.tecnico?.nombre ?? '',
    ]

    if (!values.some((value) => value.toLowerCase().includes(needle))) {
      return false
    }
  }

  return true
}

function mergeServicioIntoList(
  rows: Servicio[],
  servicio: Servicio,
  filtros: NormalizedServiciosListFilters | null | undefined,
) {
  const nextRows = rows.filter((row) => row.id !== servicio.id)
  if (!matchesServicioListFilters(servicio, filtros)) {
    return nextRows.sort(compareServiciosByCreatedAtDesc)
  }

  return [...nextRows, servicio].sort(compareServiciosByCreatedAtDesc)
}

async function loadServicioEvidenciasSnapshot(ownerId: string, serviceId: number): Promise<Evidencia[]> {
  const shouldUseLocalOnly = isLocalNumberId(serviceId) || await hasBlockingRemoteFetchCommands(
    ownerId,
    UNRESOLVED_SERVICE_EVIDENCIAS_COMMANDS,
    { entityId: serviceId },
  )

  if (shouldUseLocalOnly || !isBrowserOnline()) {
    return getCachedEvidenciasByServicio(ownerId, serviceId)
  }

  try {
    const { data, error } = await supabase
      .from('evidencias')
      .select('*')
      .eq('servicio_id', serviceId)
      .order('orden')

    if (error) {
      if (isLikelyNetworkError(error)) {
        return getCachedEvidenciasByServicio(ownerId, serviceId)
      }

      throw error
    }

    await replaceCachedEvidenciasForServicio(ownerId, serviceId, (data ?? []) as Evidencia[])
    return getCachedEvidenciasByServicio(ownerId, serviceId)
  } catch (error) {
    if (isLikelyNetworkError(error)) {
      return getCachedEvidenciasByServicio(ownerId, serviceId)
    }

    throw error
  }
}

export function writeServicioToQueryCache(queryClient: QueryClient, servicio: Servicio) {
  queryClient.setQueryData(serviciosKeys.detail(servicio.id), servicio)

  const existingListQueries = queryClient.getQueriesData<Servicio[]>({ queryKey: ['servicios', 'list'] })
  let updatedAnyList = false

  for (const [queryKey, rows] of existingListQueries) {
    if (!Array.isArray(rows)) continue

    const filtros = Array.isArray(queryKey) && queryKey.length >= 3
      ? (queryKey[2] as NormalizedServiciosListFilters | null | undefined)
      : undefined

    queryClient.setQueryData(queryKey, mergeServicioIntoList(rows, servicio, filtros))
    updatedAnyList = true
  }

  if (!updatedAnyList) {
    queryClient.setQueryData(serviciosKeys.list(), [servicio])
  }
}

function removeServicioFromQueryCache(queryClient: QueryClient, serviceId: number) {
  queryClient.removeQueries({ queryKey: serviciosKeys.detail(serviceId), exact: true })

  const existingListQueries = queryClient.getQueriesData<Servicio[]>({ queryKey: ['servicios', 'list'] })
  for (const [queryKey, rows] of existingListQueries) {
    if (!Array.isArray(rows)) continue
    queryClient.setQueryData(queryKey, rows.filter((servicio) => servicio.id !== serviceId))
  }
}

export async function refreshServicioInQueryCache(queryClient: QueryClient, serviceId: number) {
  const ownerId = await getCurrentSessionUserId()
  if (!ownerId) return

  let servicio: Servicio | null = null

  if (isBrowserOnline() && !isLocalNumberId(serviceId)) {
    try {
      const { data, error } = await supabase
        .from('servicios')
        .select(SELECT_SERVICIO)
        .eq('id', serviceId)
        .single()

      if (error) throw error
      servicio = data as Servicio
      await upsertCachedServicio(ownerId, servicio)
    } catch (error) {
      if (!isLikelyNetworkError(error)) throw error
    }
  }

  if (!servicio) {
    servicio = await getCachedServicioDetalleSnapshot(ownerId, serviceId)
  }

  if (servicio) {
    writeServicioToQueryCache(queryClient, servicio)
  }
}

async function invalidateActiveServicioQueries(queryClient: QueryClient, serviceId?: number) {
  await Promise.all([
    typeof serviceId === 'number'
      ? queryClient.invalidateQueries({ queryKey: serviciosKeys.detail(serviceId), refetchType: 'active' })
      : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: serviciosKeys.all, refetchType: 'active' }),
  ])
}

function normalizeRefaccionInventorySource(
  source: RefaccionInventorySource | null | undefined,
): RefaccionInventorySource {
  return source === 'tecnico' ? 'tecnico' : 'general'
}

function toRefaccionInputs(rows: ServicioRefaccion[]): Array<RefaccionInput & { inventory_source?: RefaccionInventorySource }> {
  return rows.map((row) => ({
    inventario_id: row.inventario_id,
    nombre_refaccion: row.nombre_refaccion,
    cantidad: row.cantidad,
    precio_unitario: row.precio_unitario,
    inventory_source: normalizeRefaccionInventorySource(row.inventory_source),
  }))
}

export function useServiciosQuery(filtros?: FiltrosServicio, options?: ServiciosQueryOptions) {
  const normalizedFilters = normalizeServiciosListFilters(filtros) ?? undefined

  return useQuery({
    queryKey: serviciosKeys.list(filtros),
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, [...UNRESOLVED_SERVICE_COMMANDS])
      if (shouldUseLocalOnly) {
        return getCachedServiciosSnapshot(ownerId, normalizedFilters)
      }

      return withOfflineFallback({
        remote: async () => {
          const servicios = await fetchPaginatedRows<Servicio>((from, to) => {
            let query = supabase.from('servicios').select(SELECT_SERVICIO).order('created_at', { ascending: false })

            if (normalizedFilters?.status) query = query.eq('status', normalizedFilters.status)
            if (normalizedFilters?.tecnicoId) query = query.eq('tecnico_id', normalizedFilters.tecnicoId)
            if (normalizedFilters?.clienteId) query = query.eq('cliente_id', normalizedFilters.clienteId)
            if (normalizedFilters?.fechaDesde) query = query.gte('fecha_servicio', normalizedFilters.fechaDesde)
            if (normalizedFilters?.fechaHasta) query = query.lte('fecha_servicio', normalizedFilters.fechaHasta)
            if (normalizedFilters?.tipoServicio) query = query.eq('tipo_servicio', normalizedFilters.tipoServicio)

            return query.range(from, to)
          })

          await replaceCachedServiciosListSnapshot(ownerId, servicios, normalizedFilters)
          return getCachedServiciosSnapshot(ownerId, normalizedFilters)
        },
        local: () => getCachedServiciosSnapshot(ownerId, normalizedFilters),
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useServicioDetalleQuery(id: number) {
  return useQuery({
    queryKey: serviciosKeys.detail(id),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) throw new Error('No hay sesión activa para consultar el servicio.')

      const shouldUseLocalOnly = isLocalNumberId(id) || await hasBlockingRemoteFetchCommands(
        ownerId,
        [...UNRESOLVED_SERVICE_COMMANDS],
        { entityId: id },
      )

      if (shouldUseLocalOnly) {
        const cached = await getCachedServicioDetalleSnapshot(ownerId, id)
        if (!cached) {
          throw new Error('No hay datos locales para este servicio.')
        }
        return cached
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('servicios')
            .select(SELECT_SERVICIO)
            .eq('id', id)
            .single()
          if (error) throw error
          await upsertCachedServicio(ownerId, data as Servicio)
          const cached = await getCachedServicioDetalleSnapshot(ownerId, id)
          if (!cached) {
            throw new Error('No se pudo guardar el servicio en caché local.')
          }
          return cached
        },
        local: async () => {
          const cached = await getCachedServicioDetalleSnapshot(ownerId, id)
          if (!cached) {
            throw new Error('No hay datos locales para este servicio.')
          }
          return cached
        },
      })
    },
    staleTime: 1000 * 60 * 2,
  })
}

export function useServicioRefaccionesQuery(serviceId: number) {
  return useQuery({
    queryKey: serviciosKeys.refacciones(serviceId),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = isLocalNumberId(serviceId) || await hasBlockingRemoteFetchCommands(
        ownerId,
        [...UNRESOLVED_SERVICE_REFACCIONES_COMMANDS],
        { entityId: serviceId },
      )

      if (shouldUseLocalOnly) {
        return getCachedServicioRefaccionesSnapshot(ownerId, serviceId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('servicio_refacciones')
            .select('*')
            .eq('servicio_id', serviceId)
            .order('id')

          if (error) throw error

          await upsertCachedServicioRefacciones(ownerId, {
            serviceId,
            items: toRefaccionInputs((data ?? []) as ServicioRefaccion[]),
          })

          return getCachedServicioRefaccionesSnapshot(ownerId, serviceId)
        },
        local: () => getCachedServicioRefaccionesSnapshot(ownerId, serviceId),
      })
    },
    enabled: serviceId > 0,
    staleTime: 1000 * 60 * 2,
  })
}

export function useCrearServicioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearServicioInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear el servicio.')
      }

      if (isBrowserOnline()) {
        try {
          const hasLocalReferences = (
            (typeof data.cliente_id === 'number' && isLocalNumberId(data.cliente_id))
            || (typeof data.maquina_id === 'number' && isLocalNumberId(data.maquina_id))
          )

          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          const existing = await findRemoteServicioByOrden(data.orden ?? null)
          if (existing) {
            return existing
          }

          const { data: created, error } = await supabase
            .from('servicios')
            .insert(data)
            .select(SELECT_SERVICIO)
            .single()
          if (error) throw error
          return created as Servicio
        } catch (error) {
          if (isLikelyUniqueViolation(error)) {
            const duplicated = await findRemoteServicioByOrden(data.orden ?? null)
            if (duplicated) {
              return duplicated
            }
          }

          if (error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') {
            return queueServicioCreate(ownerId, data)
          }

          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueServicioCreate(ownerId, data)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedServicio(ownerId, created)
      }
      writeServicioToQueryCache(qc, created)
      await invalidateActiveServicioQueries(qc, created.id)
    },
  })
}

export function useEditarServicioMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarServicioInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el servicio.')
      }

      if (isBrowserOnline() && !isLocalNumberId(id)) {
        try {
          return await syncServicioUpdate(ownerId, { serviceId: id, data })
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueServicioUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedServicio(ownerId, updated)
      }
      writeServicioToQueryCache(qc, updated)
      await refreshServicioInQueryCache(qc, updated.id)
      await invalidateActiveServicioQueries(qc, updated.id)
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
      await qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
    },
  })
}

export function useEliminarServicioMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (serviceId: number) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para eliminar el servicio.')
      }

      if (!isBrowserOnline() || isLocalNumberId(serviceId)) {
        throw new Error('No se puede eliminar un servicio sin conexión. Inténtalo nuevamente cuando tengas internet.')
      }

      return deleteServicioCompleto(serviceId)
    },
    onSuccess: async (_result, serviceId) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await removeCachedServicio(ownerId, serviceId)
      }

      removeServicioFromQueryCache(qc, serviceId)
      await Promise.all([
        qc.invalidateQueries({ queryKey: serviciosKeys.all, refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: ['evidencias'], refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: ['cierres'], refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: ['servicio-refacciones'], refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: inventarioKeys.all, refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot, refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot, refetchType: 'active' }),
        qc.invalidateQueries({ queryKey: maquinasTallerKeys.all, refetchType: 'active' }),
      ])
    },
  })
}

export function useGuardarServicioRefaccionesMutation(serviceId: number) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (items: RefaccionInput[]) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para guardar refacciones.')
      }

      const normalizedItems = items
        .map((item) => ({
          ...item,
          nombre_refaccion: item.nombre_refaccion.trim(),
        }))
        .filter((item) => item.nombre_refaccion.length > 0)

      const hasInvalidInventorySelection = normalizedItems.some(
        (item) => typeof item.inventario_id !== 'number' || item.inventario_id <= 0,
      )

      if (hasInvalidInventorySelection) {
        throw new Error('Cada refacción debe seleccionarse desde el inventario.')
      }

      if (isBrowserOnline() && !isLocalNumberId(serviceId)) {
        try {
          const hasLocalReferences = normalizedItems.some((item) => (
            typeof item.inventario_id === 'number' && isLocalNumberId(item.inventario_id)
          ))

          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          await syncServicioReplaceRefacciones(ownerId, {
            serviceId,
            items: normalizedItems,
            localMovementIds: [],
            inventorySource: 'general',
            tecnicoId: null,
            inventarioFecha: null,
            rollback: null,
          })
          return getCachedServicioRefaccionesSnapshot(ownerId, serviceId)
        } catch (error) {
          if (error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') {
            return queueServicioReplaceRefacciones(ownerId, serviceId, normalizedItems)
          }
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueServicioReplaceRefacciones(ownerId, serviceId, normalizedItems)
    },
    onSuccess: async () => {
      await refreshServicioInQueryCache(qc, serviceId)
      await qc.invalidateQueries({ queryKey: serviciosKeys.refacciones(serviceId) })
      await invalidateActiveServicioQueries(qc, serviceId)
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot })
      await qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
    },
  })
}

export interface QueueServicioRefaccionesTecnicoResult {
  commandId: string
  syncStatus: 'pending' | 'synced' | 'failed' | 'conflict'
}

export function useGuardarServicioRefaccionesTecnicoMutation(
  serviceId: number,
  tecnicoId: string | undefined,
  inventarioFecha: string,
) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (items: RefaccionInput[]): Promise<QueueServicioRefaccionesTecnicoResult> => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para guardar refacciones.')
      }

      const normalizedItems = items
        .map((item) => ({
          ...item,
          nombre_refaccion: item.nombre_refaccion.trim(),
        }))
        .filter((item) => item.nombre_refaccion.length > 0)

      if (!tecnicoId) {
        throw new Error('No se pudo determinar el técnico para asignar refacciones.')
      }

      const queued = await queueServicioReplaceRefaccionesCommand(ownerId, serviceId, normalizedItems, {
        inventorySource: 'tecnico',
        tecnicoId,
        inventarioFecha,
      })

      const syncStatus: QueueServicioRefaccionesTecnicoResult['syncStatus'] = isBrowserOnline()
        ? await settleQueuedCommand(queued.commandId)
        : 'pending'

      return {
        commandId: queued.commandId,
        syncStatus,
      }
    },
    onSuccess: async () => {
      await refreshServicioInQueryCache(qc, serviceId)
      await qc.invalidateQueries({ queryKey: serviciosKeys.refacciones(serviceId) })
      await invalidateActiveServicioQueries(qc, serviceId)
      await qc.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot })
    },
  })
}

export interface QueueServiceCompletionInput {
  serviceId: number
  items: RefaccionInput[]
  baseCostoRefacciones: number
  expectedUpdatedAt: string | null
  expectedStatus: ServicioStatus | null
}

export interface QueueServiceCompletionResult {
  commandId: string
  syncStatus: 'pending' | 'synced' | 'failed' | 'conflict'
}

export function useCompletarServicioConRefaccionesMutation() {
  const qc = useQueryClient()
  const { perfil } = useAuth()

  return useMutation({
    mutationFn: async (input: QueueServiceCompletionInput): Promise<QueueServiceCompletionResult> => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para guardar refacciones.')
      }

      if (perfil?.role === 'tecnico') {
        const evidencias = await loadServicioEvidenciasSnapshot(ownerId, input.serviceId)
        const evidenciasSummary = summarizeServicioEvidencias(evidencias)

        if (!evidenciasSummary.puedeCompletar) {
          throw new Error(buildServicioCompletionRequirementMessage(evidenciasSummary))
        }
      }

      const command = await queueServiceCompletionCommand(ownerId, {
        serviceId: input.serviceId,
        items: input.items,
        statusFinal: 'completado',
        baseCostoRefacciones: input.baseCostoRefacciones,
        expectedUpdatedAt: input.expectedUpdatedAt,
        expectedStatus: input.expectedStatus,
      })

      const syncStatus: QueueServiceCompletionResult['syncStatus'] = isBrowserOnline()
        ? await settleQueuedCommand(command.id)
        : 'pending'

      return {
        commandId: command.id,
        syncStatus,
      }
    },
    onSuccess: async (_result, variables) => {
      await refreshServicioInQueryCache(qc, variables.serviceId)
      await invalidateActiveServicioQueries(qc, variables.serviceId)
    },
  })
}
