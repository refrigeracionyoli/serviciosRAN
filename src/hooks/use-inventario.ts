import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getCommandById, hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  createInventarioItemRemote,
  queueInventarioAdjust,
  queueInventarioItemCreate,
  queueInventarioItemSetActive,
  queueInventarioItemUpdate,
  queueInventarioTecnicoDelete,
  queueInventarioTecnicoUpsert,
} from '@/lib/offline/inventario-actions'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { flushPendingCommandsOnline, settleQueuedCommand } from '@/lib/offline/sync-engine'
import {
  isInventarioTecnicoActive,
  isMissingInventarioTecnicoHistorySchemaError,
  normalizeInventarioTecnicoRow,
} from '@/lib/inventario-tecnico'
import {
  getCachedInventarioSnapshot,
  getCachedInventarioTecnicoSnapshot,
  getCachedMovimientosInventarioSnapshot,
  upsertCachedInventario,
  upsertCachedInventarioTecnico,
  upsertCachedMovimientosInventario,
} from '@/lib/offline/cache'
import type { ItemInventario, InventarioTecnico, MovimientoInventario } from '@/types/domain.types'
import type {
  CrearItemInventarioInput,
  EditarItemInventarioInput,
  AjusteInventarioInput,
  InventarioTecnicoInput,
} from '@/schemas/inventario.schema'

export const inventarioKeys = {
  all: ['inventario'] as const,
  list: (includeInactive = false) => ['inventario', 'list', includeInactive] as const,
  tecnicoRoot: ['inventario', 'tecnico'] as const,
  tecnico: (fecha?: string, tecnicoId?: string, includeHistory = false) => (
    ['inventario', 'tecnico', fecha ?? null, tecnicoId ?? null, includeHistory] as const
  ),
  movimientosRoot: ['inventario', 'movimientos'] as const,
  movimientos: (inventarioId?: number) => ['inventario', 'movimientos', inventarioId ?? null] as const,
}

interface InventarioQueryOptions {
  includeInactive?: boolean
}

interface InventarioTecnicoQueryOptions {
  enabled?: boolean
  includeHistory?: boolean
  refetchIntervalMs?: number | false
}

interface EditarItemInventarioPayload {
  id: number
  data: EditarItemInventarioInput
}

interface ToggleActivoInventarioPayload {
  id: number
  activo: boolean
}

interface EliminarInventarioTecnicoPayload {
  id: number
}

interface InventarioItemCreateResult extends ItemInventario {
  initialMovement: MovimientoInventario | null
}

const UNRESOLVED_INVENTARIO_COMMANDS = [
  'inventario.create',
  'inventario.update',
  'inventario.set_active',
  'inventario.adjust',
  'inventario_tecnico.upsert',
  'inventario_tecnico.delete',
  'servicio.replace_refacciones',
  'mantenimiento.replace_refacciones',
  'service.complete_with_refacciones',
] as const

async function settleInventarioTecnicoCommand(commandId: string) {
  const syncStatus = isBrowserOnline()
    ? await settleQueuedCommand(commandId)
    : 'pending'

  if (syncStatus === 'pending' && isBrowserOnline()) {
    const command = await getCommandById(commandId)
    throw new Error(command?.lastError ?? 'La asignación quedó pendiente y todavía no se confirmó en la base remota.')
  }

  if (syncStatus === 'failed' || syncStatus === 'conflict') {
    const command = await getCommandById(commandId)
    throw new Error(command?.lastError ?? 'No se pudo sincronizar el inventario técnico.')
  }

  return syncStatus
}

function matchesInventarioTecnicoQuery(
  queryKey: readonly unknown[],
  row: Pick<InventarioTecnico, 'fecha' | 'tecnico_id'>,
) {
  if (queryKey[0] !== 'inventario' || queryKey[1] !== 'tecnico') {
    return false
  }

  const fecha = typeof queryKey[2] === 'string' ? queryKey[2] : null
  const tecnicoId = typeof queryKey[3] === 'string' ? queryKey[3] : null

  if (fecha && row.fecha !== fecha) return false
  if (tecnicoId && row.tecnico_id !== tecnicoId) return false

  return true
}

function queryIncludesInventarioTecnicoRow(
  queryKey: readonly unknown[],
  row: InventarioTecnico,
) {
  if (!matchesInventarioTecnicoQuery(queryKey, row)) {
    return false
  }

  const includeHistory = queryKey[4] === true
  return includeHistory || isInventarioTecnicoActive(row)
}

function mergeInventarioTecnicoIntoList(
  rows: InventarioTecnico[] | undefined,
  incoming: InventarioTecnico,
) {
  const nextRows = (rows ?? []).filter((row) => {
    if (row.id === incoming.id) return false

    return !(
      row.tecnico_id === incoming.tecnico_id
      && row.inventario_id === incoming.inventario_id
      && row.fecha === incoming.fecha
    )
  })

  nextRows.unshift(incoming)
  return nextRows.sort((left, right) => right.created_at.localeCompare(left.created_at))
}

function removeInventarioTecnicoFromList(
  rows: InventarioTecnico[] | undefined,
  target: Pick<InventarioTecnico, 'id' | 'tecnico_id' | 'inventario_id' | 'fecha'>,
) {
  return (rows ?? []).filter((row) => (
    row.id !== target.id
    && !(
      row.tecnico_id === target.tecnico_id
      && row.inventario_id === target.inventario_id
      && row.fecha === target.fecha
    )
  ))
}

function writeInventarioTecnicoToQueryCache(queryClient: QueryClient, row: InventarioTecnico) {
  const listQueries = queryClient.getQueriesData<InventarioTecnico[]>({ queryKey: inventarioKeys.tecnicoRoot })
  const targetQueryKeys = [
    inventarioKeys.tecnico(row.fecha, row.tecnico_id, false),
    inventarioKeys.tecnico(row.fecha, row.tecnico_id, true),
  ] as const
  const exactQueryHandled = new Set<string>()

  for (const [queryKey, currentRows] of listQueries) {
    if (!Array.isArray(queryKey)) continue
    if (!matchesInventarioTecnicoQuery(queryKey, row)) continue

    const keyHash = JSON.stringify(queryKey)
    const includeRow = queryIncludesInventarioTecnicoRow(queryKey, row)
    if (includeRow) {
      queryClient.setQueryData(queryKey, (current: InventarioTecnico[] | undefined) => (
        mergeInventarioTecnicoIntoList(current, row)
      ))
    } else {
      queryClient.setQueryData(queryKey, (current: InventarioTecnico[] | undefined) => (
        removeInventarioTecnicoFromList(current, row)
      ))
    }

    if (currentRows !== undefined) {
      exactQueryHandled.add(keyHash)
    }
  }

  for (const targetQueryKey of targetQueryKeys) {
    const keyHash = JSON.stringify(targetQueryKey)
    if (exactQueryHandled.has(keyHash)) continue

    if (!queryIncludesInventarioTecnicoRow(targetQueryKey, row)) {
      queryClient.setQueryData(targetQueryKey, (current: InventarioTecnico[] | undefined) => (
        removeInventarioTecnicoFromList(current, row)
      ))
      continue
    }

    queryClient.setQueryData(targetQueryKey, (current: InventarioTecnico[] | undefined) => (
      mergeInventarioTecnicoIntoList(current, row)
    ))
  }
}

export async function hydrateInventarioQueryCache(ownerId: string, queryClient: QueryClient) {
  const [inventarioActivo, inventarioCompleto, movimientos] = await Promise.all([
    getCachedInventarioSnapshot(ownerId, false),
    getCachedInventarioSnapshot(ownerId, true),
    getCachedMovimientosInventarioSnapshot(ownerId),
  ])

  queryClient.setQueryData(inventarioKeys.list(false), inventarioActivo)
  queryClient.setQueryData(inventarioKeys.list(true), inventarioCompleto)
  queryClient.setQueryData(inventarioKeys.movimientos(), movimientos)

  const tecnicoQueries = queryClient.getQueriesData<InventarioTecnico[]>({ queryKey: inventarioKeys.tecnicoRoot })
  for (const [queryKey] of tecnicoQueries) {
    if (!Array.isArray(queryKey)) continue

    const fecha = typeof queryKey[2] === 'string' ? queryKey[2] : undefined
    const tecnicoId = typeof queryKey[3] === 'string' ? queryKey[3] : undefined
    const includeHistory = queryKey[4] === true

    queryClient.setQueryData(
      queryKey,
      await getCachedInventarioTecnicoSnapshot(ownerId, {
        fecha,
        tecnicoId,
        includeReturned: includeHistory,
        includeZeroQuantity: includeHistory,
      }),
    )
  }

  const movimientoQueries = queryClient.getQueriesData<MovimientoInventario[]>({ queryKey: inventarioKeys.movimientosRoot })
  for (const [queryKey] of movimientoQueries) {
    if (!Array.isArray(queryKey)) continue

    const inventarioId = typeof queryKey[2] === 'number' ? queryKey[2] : undefined
    queryClient.setQueryData(queryKey, await getCachedMovimientosInventarioSnapshot(ownerId, inventarioId))
  }
}

export function useInventarioQuery(options?: InventarioQueryOptions) {
  const includeInactive = Boolean(options?.includeInactive)

  return useQuery({
    queryKey: inventarioKeys.list(includeInactive),
    networkMode: 'always',
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, [...UNRESOLVED_INVENTARIO_COMMANDS])
      if (shouldUseLocalOnly) {
        return getCachedInventarioSnapshot(ownerId, includeInactive)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('inventario')
            .select('*')
            .order('nombre')

          if (!includeInactive) {
            query = query.eq('activo', true)
          }

          const { data, error } = await query
          if (error) throw error
          return data as ItemInventario[]
        },
        local: () => getCachedInventarioSnapshot(ownerId, includeInactive),
        onRemoteSuccess: (items) => upsertCachedInventario(ownerId, items),
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useMovimientosQuery(inventarioId?: number) {
  return useQuery({
    queryKey: inventarioKeys.movimientos(inventarioId),
    networkMode: 'always',
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, [...UNRESOLVED_INVENTARIO_COMMANDS])
      if (shouldUseLocalOnly) {
        return getCachedMovimientosInventarioSnapshot(ownerId, inventarioId)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('movimientos_inventario')
            .select('*, item:inventario(id, nombre), usuario:profiles(id, nombre)')
            .order('created_at', { ascending: false })
            .limit(200)

          if (inventarioId) query = query.eq('inventario_id', inventarioId)

          const { data, error } = await query
          if (error) throw error
          await upsertCachedMovimientosInventario(ownerId, data as MovimientoInventario[])
          return getCachedMovimientosInventarioSnapshot(ownerId, inventarioId)
        },
        local: () => getCachedMovimientosInventarioSnapshot(ownerId, inventarioId),
      })
    },
  })
}

export function useCrearItemInventarioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearItemInventarioInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear el item.')
      }

      if (isBrowserOnline()) {
        try {
          const { item, movement } = await createInventarioItemRemote(data, {
            usuarioId: ownerId,
          })

          return {
            ...item,
            initialMovement: movement,
          } satisfies InventarioItemCreateResult
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      const created = await queueInventarioItemCreate(ownerId, data)
      return {
        ...created,
        initialMovement: null,
      } satisfies InventarioItemCreateResult
    },
    onSuccess: async (createdResult) => {
      const { initialMovement, ...created } = createdResult
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedInventario(ownerId, [created])
        if (initialMovement) {
          await upsertCachedMovimientosInventario(ownerId, [initialMovement])
        }
        await hydrateInventarioQueryCache(ownerId, qc)
      }
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
    },
  })
}

export function useEditarItemInventarioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: EditarItemInventarioPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el item.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('inventario')
            .update(data)
            .eq('id', id)
            .select()
            .single()
          if (error) throw error
          return updated as ItemInventario
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueInventarioItemUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedInventario(ownerId, [updated])
        await hydrateInventarioQueryCache(ownerId, qc)
      }
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
    },
  })
}

export function useToggleItemInventarioActivoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, activo }: ToggleActivoInventarioPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el estado del item.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('inventario')
            .update({ activo })
            .eq('id', id)
            .select()
            .single()
          if (error) throw error
          return updated as ItemInventario
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueInventarioItemSetActive(ownerId, id, activo)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedInventario(ownerId, [updated])
        await hydrateInventarioQueryCache(ownerId, qc)
      }
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
    },
  })
}

export function useAjusteInventarioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: AjusteInventarioInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para ajustar el inventario.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: item, error: fetchError } = await supabase
            .from('inventario')
            .select('stock_actual')
            .eq('id', data.inventario_id)
            .single()
          if (fetchError) throw fetchError

          const currentStock = Number(item.stock_actual ?? 0)

          let newStock = currentStock
          if (data.tipo === 'entrada') newStock = currentStock + data.cantidad
          if (data.tipo === 'salida') {
            if (currentStock < data.cantidad) {
              throw new Error(`Stock insuficiente. Disponible: ${currentStock}.`)
            }
            newStock = currentStock - data.cantidad
          }
          if (data.tipo === 'ajuste') newStock = data.cantidad

          const { error: stockError } = await supabase
            .from('inventario')
            .update({ stock_actual: newStock })
            .eq('id', data.inventario_id)

          if (stockError) throw stockError

          const { data: userData } = await supabase.auth.getUser()
          const usuarioId = userData.user?.id ?? null

          const { error: movError } = await supabase
            .from('movimientos_inventario')
            .insert({
              inventario_id: data.inventario_id,
              tipo: data.tipo,
              cantidad: data.cantidad,
              motivo: data.motivo ?? null,
              referencia_id: null,
              usuario_id: usuarioId,
            })

          if (movError) {
            await supabase
              .from('inventario')
              .update({ stock_actual: currentStock })
              .eq('id', data.inventario_id)

            throw movError
          }

          return newStock
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueInventarioAdjust(ownerId, data)
    },
    onSuccess: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await hydrateInventarioQueryCache(ownerId, qc)
      }
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
    },
  })
}

export function useInventarioTecnicoQuery(
  fecha?: string,
  tecnicoId?: string,
  options?: InventarioTecnicoQueryOptions,
) {
  const includeHistory = options?.includeHistory ?? false
  const refetchInterval = options?.refetchIntervalMs ?? false

  return useQuery({
    queryKey: inventarioKeys.tecnico(fecha, tecnicoId, includeHistory),
    networkMode: 'always',
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      if (!isBrowserOnline()) {
        return getCachedInventarioTecnicoSnapshot(ownerId, {
          fecha,
          tecnicoId,
          includeReturned: includeHistory,
          includeZeroQuantity: includeHistory,
        })
      }

      return withOfflineFallback({
        remote: async () => {
          try {
            let query = supabase
              .from('inventario_tecnico')
              .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
              .order('created_at', { ascending: false })

            if (fecha) query = query.eq('fecha', fecha)
            if (tecnicoId) query = query.eq('tecnico_id', tecnicoId)
            if (!includeHistory) {
              query = query.is('devuelto_at', null).gt('cantidad', 0)
            }

            const { data, error } = await query
            if (error) throw error
            return (data ?? []).map((row) => normalizeInventarioTecnicoRow(row)) as InventarioTecnico[]
          } catch (error) {
            if (!isMissingInventarioTecnicoHistorySchemaError(error)) {
              throw error
            }

            let legacyQuery = supabase
              .from('inventario_tecnico')
              .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
              .order('created_at', { ascending: false })

            if (fecha) legacyQuery = legacyQuery.eq('fecha', fecha)
            if (tecnicoId) legacyQuery = legacyQuery.eq('tecnico_id', tecnicoId)
            if (!includeHistory) {
              legacyQuery = legacyQuery.gt('cantidad', 0)
            }

            const { data: legacyData, error: legacyError } = await legacyQuery
            if (legacyError) throw legacyError
            return (legacyData ?? []).map((row) => normalizeInventarioTecnicoRow(row)) as InventarioTecnico[]
          }
        },
        local: () => getCachedInventarioTecnicoSnapshot(ownerId, {
          fecha,
          tecnicoId,
          includeReturned: includeHistory,
          includeZeroQuantity: includeHistory,
        }),
        onRemoteSuccess: (rows) => upsertCachedInventarioTecnico(ownerId, rows),
      })
    },
    enabled: options?.enabled ?? true,
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 1000 * 60 * 3,
  })
}

export function useGuardarInventarioTecnicoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: InventarioTecnicoInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para guardar el inventario técnico.')
      }

      const queued = await queueInventarioTecnicoUpsert(ownerId, data)
      const syncStatus = await settleInventarioTecnicoCommand(queued.commandId)

      return {
        row: queued.row,
        commandId: queued.commandId,
        syncStatus,
      }
    },
    onSuccess: async (result) => {
      const saved = result.row
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedInventarioTecnico(ownerId, [saved])
        if (saved.item) {
          await upsertCachedInventario(ownerId, [saved.item])
        }
        writeInventarioTecnicoToQueryCache(qc, saved)
        await hydrateInventarioQueryCache(ownerId, qc)
      }
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot })
      await qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
    },
  })
}

export function useEliminarInventarioTecnicoMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id }: EliminarInventarioTecnicoPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para eliminar el inventario técnico.')
      }

      const payload = await queueInventarioTecnicoDelete(ownerId, id)

      if (isBrowserOnline()) {
        await flushPendingCommandsOnline()
      }

      const cachedInventario = await getCachedInventarioSnapshot(ownerId, true)
      const cachedItem = cachedInventario.find((row) => row.id === payload.inventario_id)
      return {
        ...payload,
        tecnicoNombre: payload.tecnico_id,
        itemNombre: `Item ${payload.inventario_id}`,
        nextStock: Number(cachedItem?.stock_actual ?? 0),
      }
    },
    onSuccess: async (deleted) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        const item = await getCachedInventarioSnapshot(ownerId, true)
        const itemToUpdate = item.find((row) => row.id === deleted.inventario_id)
        if (itemToUpdate) {
          await upsertCachedInventario(ownerId, [{
            ...itemToUpdate,
            stock_actual: deleted.nextStock,
          }])
        }
        await hydrateInventarioQueryCache(ownerId, qc)
      }
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot })
      await qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
    },
  })
}
