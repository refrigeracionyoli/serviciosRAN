import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  queueMantenimientoCreate,
  queueMantenimientoReplaceRefacciones,
  queueMantenimientoUpdate,
} from '@/lib/offline/servicios-actions'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import {
  getCachedMantenimientoRefaccionesSnapshot,
  getCachedMantenimientoDetalleSnapshot,
  getCachedMantenimientosSnapshot,
  isLocalNumberId,
  upsertCachedServicioRefacciones,
  upsertCachedMantenimientos,
} from '@/lib/offline/cache'
import type { InventarioTecnico, MantenimientoPoliza, RefaccionInventorySource, ServicioRefaccion } from '@/types/domain.types'
import type { CrearMantenimientoInput, EditarMantenimientoInput } from '@/schemas/mantenimiento.schema'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import { inventarioKeys } from './use-inventario'

export const mantenimientosKeys = {
  all: ['mantenimientos'] as const,
  list: (polizaId?: number) => ['mantenimientos', 'list', polizaId] as const,
  detail: (id: number) => ['mantenimientos', 'detail', id] as const,
  refacciones: (id: number) => ['mantenimiento-refacciones', id] as const,
}

interface ActualizarMantenimientoPayload {
  id: number
  data: EditarMantenimientoInput
}

interface GuardarMantenimientoRefaccionesPayload {
  mantenimientoId: number
  items: RefaccionInput[]
}

export interface QueueMantenimientoRefaccionesTecnicoResult {
  syncStatus: 'pending' | 'synced' | 'failed' | 'conflict'
}

const SELECT_MANTENIMIENTO = `
  *,
  poliza:polizas(*),
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo)
`

const UNRESOLVED_MANTENIMIENTO_COMMANDS = [
  'mantenimiento.create',
  'mantenimiento.update',
  'mantenimiento.replace_refacciones',
] as const

function toRefaccionInputs(rows: ServicioRefaccion[]): Array<RefaccionInput & { inventory_source?: RefaccionInventorySource }> {
  return rows.map((row) => ({
    inventario_id: row.inventario_id,
    nombre_refaccion: row.nombre_refaccion,
    cantidad: row.cantidad,
    precio_unitario: row.precio_unitario,
    inventory_source: normalizeRefaccionInventorySource(row.inventory_source),
  }))
}

function normalizeRefaccionInventorySource(source: RefaccionInventorySource | null | undefined): RefaccionInventorySource {
  return source === 'tecnico' ? 'tecnico' : 'general'
}

function buildInventarioQuantityMap(
  rows: Array<Pick<ServicioRefaccion, 'inventario_id' | 'cantidad' | 'inventory_source'>>,
  source: RefaccionInventorySource,
) {
  const quantities = new Map<number, number>()

  rows
    .filter((row) => normalizeRefaccionInventorySource(row.inventory_source) === source)
    .forEach((row) => {
      if (typeof row.inventario_id !== 'number') return
      quantities.set(row.inventario_id, (quantities.get(row.inventario_id) ?? 0) + Number(row.cantidad))
    })

  return quantities
}

export function useMantenimientosQuery(polizaId?: number) {
  return useQuery({
    queryKey: mantenimientosKeys.list(polizaId),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, [...UNRESOLVED_MANTENIMIENTO_COMMANDS])
      if (shouldUseLocalOnly) {
        return getCachedMantenimientosSnapshot(ownerId, polizaId)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('mantenimientos_poliza')
            .select(SELECT_MANTENIMIENTO)
            .order('fecha_visita', { ascending: false, nullsFirst: false })

          if (polizaId) query = query.eq('poliza_id', polizaId)

          const { data, error } = await query
          if (error) throw error
          await upsertCachedMantenimientos(ownerId, data as MantenimientoPoliza[])
          return getCachedMantenimientosSnapshot(ownerId, polizaId)
        },
        local: () => getCachedMantenimientosSnapshot(ownerId, polizaId),
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useMantenimientoDetalleQuery(id: number) {
  return useQuery({
    queryKey: mantenimientosKeys.detail(id),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para consultar el mantenimiento.')
      }

      const shouldUseLocalOnly = isLocalNumberId(id) || await hasBlockingRemoteFetchCommands(
        ownerId,
        [...UNRESOLVED_MANTENIMIENTO_COMMANDS],
        { entityId: id },
      )

      if (shouldUseLocalOnly) {
        const cached = await getCachedMantenimientoDetalleSnapshot(ownerId, id)
        if (!cached) {
          throw new Error('No hay datos locales para este mantenimiento.')
        }
        return cached
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('mantenimientos_poliza')
            .select(SELECT_MANTENIMIENTO)
            .eq('id', id)
            .single()

          if (error) throw error
          await upsertCachedMantenimientos(ownerId, [data as MantenimientoPoliza])
          const cached = await getCachedMantenimientoDetalleSnapshot(ownerId, id)
          if (!cached) {
            throw new Error('No se pudo guardar el mantenimiento en caché local.')
          }
          return cached
        },
        local: async () => {
          const cached = await getCachedMantenimientoDetalleSnapshot(ownerId, id)
          if (!cached) {
            throw new Error('No hay datos locales para este mantenimiento.')
          }
          return cached
        },
      })
    },
    enabled: id > 0,
    staleTime: 1000 * 60 * 2,
  })
}

export function useMantenimientoRefaccionesQuery(mantenimientoId: number) {
  return useQuery({
    queryKey: mantenimientosKeys.refacciones(mantenimientoId),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = isLocalNumberId(mantenimientoId) || await hasBlockingRemoteFetchCommands(
        ownerId,
        ['mantenimiento.replace_refacciones'],
        { entityId: mantenimientoId },
      )

      if (shouldUseLocalOnly) {
        return getCachedMantenimientoRefaccionesSnapshot(ownerId, mantenimientoId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('servicio_refacciones')
            .select('*')
            .eq('mantenimiento_id', mantenimientoId)
            .order('id')

          if (error) throw error

          await upsertCachedServicioRefacciones(ownerId, {
            mantenimientoId,
            items: toRefaccionInputs((data ?? []) as ServicioRefaccion[]),
          })

          return getCachedMantenimientoRefaccionesSnapshot(ownerId, mantenimientoId)
        },
        local: () => getCachedMantenimientoRefaccionesSnapshot(ownerId, mantenimientoId),
      })
    },
    enabled: mantenimientoId > 0,
    staleTime: 1000 * 60 * 2,
  })
}

export function useCrearMantenimientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearMantenimientoInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear el mantenimiento.')
      }

      if (isBrowserOnline()) {
        try {
          const hasLocalReferences = (
            isLocalNumberId(data.poliza_id)
            || isLocalNumberId(data.cliente_id)
            || isLocalNumberId(data.maquina_id)
          )

          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          const { data: created, error } = await supabase
            .from('mantenimientos_poliza')
            .insert(data)
            .select(SELECT_MANTENIMIENTO)
            .single()
          if (error) throw error
          return created as MantenimientoPoliza
        } catch (error) {
          if (error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') {
            return queueMantenimientoCreate(ownerId, data)
          }

          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueMantenimientoCreate(ownerId, data)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedMantenimientos(ownerId, [created])
      }
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.all })
    },
  })
}

export function useEditarMantenimientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: ActualizarMantenimientoPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el mantenimiento.')
      }

      if (isBrowserOnline() && !isLocalNumberId(id)) {
        try {
          const { data: updated, error } = await supabase
            .from('mantenimientos_poliza')
            .update(data)
            .eq('id', id)
            .select(SELECT_MANTENIMIENTO)
            .single()
          if (error) throw error
          return updated as MantenimientoPoliza
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueMantenimientoUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedMantenimientos(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.all })
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.detail(updated.id) })
    },
  })
}

export function useGuardarMantenimientoRefaccionesMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ mantenimientoId, items }: GuardarMantenimientoRefaccionesPayload) => {
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

      if (isBrowserOnline() && !isLocalNumberId(mantenimientoId)) {
        try {
          const { error: deleteError } = await supabase.from('servicio_refacciones')
            .delete()
            .eq('mantenimiento_id', mantenimientoId)

          if (deleteError) throw deleteError

          if (normalizedItems.length > 0) {
            const { error: insertError } = await supabase.from('servicio_refacciones')
              .insert(
                normalizedItems.map((item) => ({
                  servicio_id: null,
                  mantenimiento_id: mantenimientoId,
                  inventario_id: item.inventario_id ?? null,
                  nombre_refaccion: item.nombre_refaccion,
                  cantidad: item.cantidad,
                  precio_unitario: item.precio_unitario,
                  inventory_source: 'general',
                })),
              )

            if (insertError) throw insertError
          }

          await upsertCachedServicioRefacciones(ownerId, {
            mantenimientoId,
            items: normalizedItems,
          })

          return getCachedMantenimientoRefaccionesSnapshot(ownerId, mantenimientoId)
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueMantenimientoReplaceRefacciones(ownerId, mantenimientoId, normalizedItems)
    },
    onSuccess: async (_result, variables) => {
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.refacciones(variables.mantenimientoId) })
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.detail(variables.mantenimientoId) })
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.movimientosRoot })
    },
  })
}

export function useGuardarMantenimientoRefaccionesTecnicoMutation(
  mantenimientoId: number,
  tecnicoId: string | undefined,
  inventarioFecha: string,
) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (items: RefaccionInput[]): Promise<QueueMantenimientoRefaccionesTecnicoResult> => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para guardar refacciones.')
      }

      if (!tecnicoId) {
        throw new Error('No se pudo determinar el técnico para asignar refacciones.')
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

      if (!isBrowserOnline() || isLocalNumberId(mantenimientoId)) {
        throw new Error('No se pudo guardar sin conexión en este momento.')
      }

      const { data: existingRows, error: existingError } = await supabase
        .from('servicio_refacciones')
        .select('inventario_id, nombre_refaccion, cantidad, precio_unitario, inventory_source')
        .eq('mantenimiento_id', mantenimientoId)

      if (existingError) throw existingError

      const existingItems = (existingRows ?? []) as Array<
        Pick<ServicioRefaccion, 'inventario_id' | 'nombre_refaccion' | 'cantidad' | 'precio_unitario' | 'inventory_source'>
      >

      const previousTecnicoByInventarioId = buildInventarioQuantityMap(existingItems, 'tecnico')
      const nextTecnicoByInventarioId = buildInventarioQuantityMap(
        normalizedItems.map((item) => ({
          inventario_id: item.inventario_id ?? null,
          cantidad: item.cantidad,
          inventory_source: 'tecnico' as const,
        })),
        'tecnico',
      )

      const affectedIds = Array.from(new Set([
        ...previousTecnicoByInventarioId.keys(),
        ...nextTecnicoByInventarioId.keys(),
      ]))

      if (affectedIds.length > 0) {
        const { data: inventarioTecnicoRows, error: inventarioTecnicoError } = await supabase
          .from('inventario_tecnico')
          .select('id, inventario_id, cantidad, cantidad_asignada_total, devuelto_at, devuelto_automaticamente')
          .eq('tecnico_id', tecnicoId)
          .eq('fecha', inventarioFecha)
          .is('devuelto_at', null)
          .in('inventario_id', affectedIds)

        if (inventarioTecnicoError) throw inventarioTecnicoError

        const inventarioTecnicoById = new Map(
          ((inventarioTecnicoRows ?? []) as Array<Pick<InventarioTecnico, 'id' | 'inventario_id' | 'cantidad' | 'cantidad_asignada_total' | 'devuelto_at' | 'devuelto_automaticamente'>>)
            .map((row) => [row.inventario_id, row] as const),
        )

        for (const inventarioId of affectedIds) {
          const currentRow = inventarioTecnicoById.get(inventarioId) ?? null
          const currentCantidad = currentRow?.cantidad ?? 0
          const previousCantidad = previousTecnicoByInventarioId.get(inventarioId) ?? 0
          const nextCantidadAsignada = nextTecnicoByInventarioId.get(inventarioId) ?? 0
          const nextCantidadDisponible = currentCantidad + previousCantidad - nextCantidadAsignada

          if (nextCantidadDisponible < 0) {
            throw new Error(`Inventario técnico insuficiente para la refacción ${inventarioId}.`)
          }

          if (!currentRow && nextCantidadDisponible === 0) {
            continue
          }

          const currentAssignedTotal = currentRow?.cantidad_asignada_total ?? nextCantidadDisponible
          const payload = {
            tecnico_id: tecnicoId,
            inventario_id: inventarioId,
            cantidad: nextCantidadDisponible,
            cantidad_asignada_total: currentAssignedTotal,
            fecha: inventarioFecha,
            devuelto_at: null,
            devuelto_automaticamente: false,
          }

          if (currentRow) {
            const { error: updateInventarioTecnicoError } = await supabase
              .from('inventario_tecnico')
              .update(payload)
              .eq('id', currentRow.id)

            if (updateInventarioTecnicoError) throw updateInventarioTecnicoError
          } else {
            const { error: upsertInventarioTecnicoError } = await supabase
              .from('inventario_tecnico')
              .upsert(payload, { onConflict: 'tecnico_id,inventario_id,fecha' })

            if (upsertInventarioTecnicoError) throw upsertInventarioTecnicoError
          }
        }
      }

      const { error: deleteError } = await supabase
        .from('servicio_refacciones')
        .delete()
        .eq('mantenimiento_id', mantenimientoId)
        .eq('inventory_source', 'tecnico')

      if (deleteError) throw deleteError

      if (normalizedItems.length > 0) {
        const { error: insertError } = await supabase
          .from('servicio_refacciones')
          .insert(
            normalizedItems.map((item) => ({
              servicio_id: null,
              mantenimiento_id: mantenimientoId,
              inventario_id: item.inventario_id ?? null,
              nombre_refaccion: item.nombre_refaccion,
              cantidad: item.cantidad,
              precio_unitario: item.precio_unitario,
              inventory_source: 'tecnico',
            })),
          )

        if (insertError) throw insertError
      }

      await upsertCachedServicioRefacciones(ownerId, {
        mantenimientoId,
        items: [
          ...existingItems
            .filter((row) => normalizeRefaccionInventorySource(row.inventory_source) !== 'tecnico')
            .map((row) => ({
              inventario_id: row.inventario_id,
              nombre_refaccion: row.nombre_refaccion,
              cantidad: row.cantidad,
              precio_unitario: row.precio_unitario,
              inventory_source: normalizeRefaccionInventorySource(row.inventory_source),
            })),
          ...normalizedItems.map((item) => ({
            ...item,
            inventory_source: 'tecnico' as const,
          })),
        ],
      })

      return { syncStatus: 'synced' }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.refacciones(mantenimientoId) })
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.detail(mantenimientoId) })
      await qc.invalidateQueries({ queryKey: mantenimientosKeys.all })
      await qc.invalidateQueries({ queryKey: inventarioKeys.tecnicoRoot })
    },
  })
}
