import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { MantenimientoPoliza } from '@/types/domain.types'
import type { CrearMantenimientoInput, EditarMantenimientoInput } from '@/schemas/mantenimiento.schema'

export const mantenimientosKeys = {
  all: ['mantenimientos'] as const,
  list: (polizaId?: number) => ['mantenimientos', 'list', polizaId] as const,
  detail: (id: number) => ['mantenimientos', 'detail', id] as const,
}

interface ActualizarMantenimientoPayload {
  id: number
  data: EditarMantenimientoInput
}

const SELECT_MANTENIMIENTO = `
  *,
  poliza:polizas(*),
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo)
`

export function useMantenimientosQuery(polizaId?: number) {
  return useQuery({
    queryKey: mantenimientosKeys.list(polizaId),
    queryFn: async () => {
      let query = supabase
        .from('mantenimientos_poliza')
        .select(SELECT_MANTENIMIENTO)
        .order('fecha_visita', { ascending: false, nullsFirst: false })

      if (polizaId) query = query.eq('poliza_id', polizaId)

      const { data, error } = await query
      if (error) throw error
      return data as MantenimientoPoliza[]
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useMantenimientoDetalleQuery(id: number) {
  return useQuery({
    queryKey: mantenimientosKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mantenimientos_poliza')
        .select(SELECT_MANTENIMIENTO)
        .eq('id', id)
        .single()

      if (error) throw error
      return data as MantenimientoPoliza
    },
    enabled: id > 0,
    staleTime: 1000 * 60 * 2,
  })
}

export function useCrearMantenimientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearMantenimientoInput) => {
      const { data: created, error } = await supabase
        .from('mantenimientos_poliza')
        .insert(data)
        .select(SELECT_MANTENIMIENTO)
        .single()
      if (error) throw error
      return created as MantenimientoPoliza
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mantenimientosKeys.all }),
  })
}

export function useEditarMantenimientoMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: ActualizarMantenimientoPayload) => {
      const { data: updated, error } = await supabase
        .from('mantenimientos_poliza')
        .update(data)
        .eq('id', id)
        .select(SELECT_MANTENIMIENTO)
        .single()
      if (error) throw error
      return updated as MantenimientoPoliza
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mantenimientosKeys.all }),
  })
}
