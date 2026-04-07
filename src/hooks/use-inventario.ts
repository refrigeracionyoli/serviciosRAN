import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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
  tecnico: (fecha?: string, tecnicoId?: string) => ['inventario', 'tecnico', fecha, tecnicoId] as const,
  movimientos: (inventarioId?: number) => ['inventario', 'movimientos', inventarioId] as const,
}

interface InventarioQueryOptions {
  includeInactive?: boolean
}

interface InventarioTecnicoQueryOptions {
  enabled?: boolean
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

interface InventarioTecnicoSnapshot {
  id: number
  tecnico_id: string
  inventario_id: number
  cantidad: number
  fecha: string
}

interface EliminarInventarioTecnicoResult extends InventarioTecnicoSnapshot {
  tecnicoNombre: string
  itemNombre: string
}

export function useInventarioQuery(options?: InventarioQueryOptions) {
  const includeInactive = Boolean(options?.includeInactive)

  return useQuery({
    queryKey: inventarioKeys.list(includeInactive),
    queryFn: async () => {
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
    staleTime: 1000 * 60 * 5,
  })
}

export function useMovimientosQuery(inventarioId?: number) {
  return useQuery({
    queryKey: inventarioKeys.movimientos(inventarioId),
    queryFn: async () => {
      let query = supabase
        .from('movimientos_inventario')
        .select('*, item:inventario(id, nombre), usuario:profiles(id, nombre)')
        .order('created_at', { ascending: false })
        .limit(200)

      if (inventarioId) query = query.eq('inventario_id', inventarioId)

      const { data, error } = await query
      if (error) throw error
      return data as MovimientoInventario[]
    },
  })
}

export function useCrearItemInventarioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearItemInventarioInput) => {
      const { data: created, error } = await supabase
        .from('inventario')
        .insert(data)
        .select()
        .single()
      if (error) throw error
      return created as ItemInventario
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: inventarioKeys.all }),
  })
}

export function useEditarItemInventarioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: EditarItemInventarioPayload) => {
      const { data: updated, error } = await supabase
        .from('inventario')
        .update(data)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return updated as ItemInventario
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: inventarioKeys.all }),
  })
}

export function useToggleItemInventarioActivoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, activo }: ToggleActivoInventarioPayload) => {
      const { data: updated, error } = await supabase
        .from('inventario')
        .update({ activo })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return updated as ItemInventario
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: inventarioKeys.all }),
  })
}

export function useAjusteInventarioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: AjusteInventarioInput) => {
      const { data: item, error: fetchError } = await supabase
        .from('inventario')
        .select('stock_actual')
        .eq('id', data.inventario_id)
        .single()
      if (fetchError) throw fetchError

      const currentStock = item.stock_actual

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
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventarioKeys.all })
      qc.invalidateQueries({ queryKey: inventarioKeys.movimientos() })
    },
  })
}

export function useInventarioTecnicoQuery(
  fecha?: string,
  tecnicoId?: string,
  options?: InventarioTecnicoQueryOptions,
) {
  return useQuery({
    queryKey: inventarioKeys.tecnico(fecha, tecnicoId),
    queryFn: async () => {
      let query = supabase
        .from('inventario_tecnico')
        .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
        .order('created_at', { ascending: false })

      if (fecha) query = query.eq('fecha', fecha)
      if (tecnicoId) query = query.eq('tecnico_id', tecnicoId)

      const { data, error } = await query
      if (error) throw error
      return data as InventarioTecnico[]
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 3,
  })
}

export function useGuardarInventarioTecnicoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: InventarioTecnicoInput) => {
      const { data: existing } = await supabase
        .from('inventario_tecnico')
        .select('id, cantidad')
        .eq('tecnico_id', data.tecnico_id)
        .eq('inventario_id', data.inventario_id)
        .eq('fecha', data.fecha)
        .maybeSingle()

      const previousCantidad = existing?.cantidad ?? 0
      const deltaCantidad = data.cantidad - previousCantidad

      const { data: item, error: itemError } = await supabase
        .from('inventario')
        .select('stock_actual, nombre')
        .eq('id', data.inventario_id)
        .single()

      if (itemError) throw itemError

      const currentStock = item.stock_actual

      if (deltaCantidad > 0 && currentStock < deltaCantidad) {
        throw new Error(`Stock insuficiente para asignar. Disponible: ${currentStock}.`)
      }

      const nextStock = deltaCantidad === 0
        ? currentStock
        : deltaCantidad > 0
          ? currentStock - deltaCantidad
          : currentStock + Math.abs(deltaCantidad)

      if (deltaCantidad !== 0) {
        const { error: stockError } = await supabase
          .from('inventario')
          .update({ stock_actual: nextStock })
          .eq('id', data.inventario_id)

        if (stockError) throw stockError
      }

      const { data: saved, error } = await supabase
        .from('inventario_tecnico')
        .upsert(data, { onConflict: 'tecnico_id,inventario_id,fecha' })
        .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
        .single()

      if (error) {
        if (deltaCantidad !== 0) {
          await supabase
            .from('inventario')
            .update({ stock_actual: currentStock })
            .eq('id', data.inventario_id)
        }

        throw error
      }

      if (deltaCantidad !== 0) {
        const { data: userData } = await supabase.auth.getUser()
        const usuarioId = userData.user?.id ?? null
        const tipoMovimiento = deltaCantidad > 0 ? 'salida' : 'entrada'
        const cantidadMovimiento = Math.abs(deltaCantidad)
        const tecnicoNombre = saved.tecnico?.nombre ?? data.tecnico_id
        const itemNombre = saved.item?.nombre ?? `Item ${data.inventario_id}`
        const motivoBase = deltaCantidad > 0
          ? 'Movimiento a inventario de tecnico'
          : 'Devolucion de inventario de tecnico'
        const motivo = `[INV_TECNICO:${saved.id}] ${motivoBase}: ${tecnicoNombre} | ${itemNombre} | ${data.fecha}`

        const { error: movementError } = await supabase
          .from('movimientos_inventario')
          .insert({
            inventario_id: data.inventario_id,
            tipo: tipoMovimiento,
            cantidad: cantidadMovimiento,
            motivo,
            referencia_id: saved.id,
            usuario_id: usuarioId,
          })

        if (movementError) {
          await supabase
            .from('inventario')
            .update({ stock_actual: currentStock })
            .eq('id', data.inventario_id)

          if (existing) {
            await supabase
              .from('inventario_tecnico')
              .update({ cantidad: previousCantidad })
              .eq('id', existing.id)
          } else {
            await supabase
              .from('inventario_tecnico')
              .delete()
              .eq('id', saved.id)
          }

          throw movementError
        }
      }

      return saved as InventarioTecnico
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventarioKeys.all })
      qc.invalidateQueries({ queryKey: inventarioKeys.tecnico() })
      qc.invalidateQueries({ queryKey: inventarioKeys.movimientos() })
    },
  })
}

export function useEliminarInventarioTecnicoMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id }: EliminarInventarioTecnicoPayload) => {
      const { data: existing, error: existingError } = await supabase
        .from('inventario_tecnico')
        .select('id, tecnico_id, inventario_id, cantidad, fecha')
        .eq('id', id)
        .single()

      if (existingError) throw existingError

      const snapshot = existing as InventarioTecnicoSnapshot

      const { data: itemData, error: itemError } = await supabase
        .from('inventario')
        .select('stock_actual, nombre')
        .eq('id', snapshot.inventario_id)
        .single()

      if (itemError) throw itemError

      const currentStock = itemData.stock_actual
      const nextStock = currentStock + snapshot.cantidad

      const { data: tecnicoData } = await supabase
        .from('profiles')
        .select('nombre')
        .eq('id', snapshot.tecnico_id)
        .maybeSingle()

      const tecnicoNombre = tecnicoData?.nombre ?? snapshot.tecnico_id
      const itemNombre = itemData.nombre ?? `Item ${snapshot.inventario_id}`

      const { error: stockError } = await supabase
        .from('inventario')
        .update({ stock_actual: nextStock })
        .eq('id', snapshot.inventario_id)

      if (stockError) throw stockError

      const { error: deleteError } = await supabase
        .from('inventario_tecnico')
        .delete()
        .eq('id', snapshot.id)

      if (deleteError) {
        await supabase
          .from('inventario')
          .update({ stock_actual: currentStock })
          .eq('id', snapshot.inventario_id)

        throw deleteError
      }

      const { data: userData } = await supabase.auth.getUser()
      const usuarioId = userData.user?.id ?? null
      const motivo = `[INV_TECNICO:${snapshot.id}] Eliminacion de inventario de tecnico: ${tecnicoNombre} | ${itemNombre} | ${snapshot.fecha}`

      const { error: movementError } = await supabase
        .from('movimientos_inventario')
        .insert({
          inventario_id: snapshot.inventario_id,
          tipo: 'entrada',
          cantidad: snapshot.cantidad,
          motivo,
          referencia_id: snapshot.id,
          usuario_id: usuarioId,
        })

      if (movementError) {
        await supabase
          .from('inventario')
          .update({ stock_actual: currentStock })
          .eq('id', snapshot.inventario_id)

        await supabase
          .from('inventario_tecnico')
          .upsert(
            {
              tecnico_id: snapshot.tecnico_id,
              inventario_id: snapshot.inventario_id,
              cantidad: snapshot.cantidad,
              fecha: snapshot.fecha,
            },
            { onConflict: 'tecnico_id,inventario_id,fecha' },
          )

        throw movementError
      }

      return {
        ...snapshot,
        tecnicoNombre,
        itemNombre,
      } as EliminarInventarioTecnicoResult
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: inventarioKeys.all })
      qc.invalidateQueries({ queryKey: inventarioKeys.tecnico() })
      qc.invalidateQueries({ queryKey: inventarioKeys.movimientos() })
    },
  })
}
