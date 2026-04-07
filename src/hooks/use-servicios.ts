import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Servicio, FiltrosServicio } from '@/types/domain.types'
import type { CrearServicioInput, EditarServicioInput } from '@/schemas/servicio.schema'

export const serviciosKeys = {
  all: ['servicios'] as const,
  list: (filtros?: FiltrosServicio) => ['servicios', 'list', filtros] as const,
  detail: (id: number) => ['servicios', 'detail', id] as const,
}

const SELECT_SERVICIO = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, role)
`

export function useServiciosQuery(filtros?: FiltrosServicio) {
  return useQuery({
    queryKey: serviciosKeys.list(filtros),
    queryFn: async () => {
      let query = supabase.from('servicios').select(SELECT_SERVICIO).order('created_at', { ascending: false })

      if (filtros?.status) query = query.eq('status', filtros.status)
      if (filtros?.tecnicoId) query = query.eq('tecnico_id', filtros.tecnicoId)
      if (filtros?.clienteId) query = query.eq('cliente_id', filtros.clienteId)
      if (filtros?.fechaDesde) query = query.gte('fecha_servicio', filtros.fechaDesde)
      if (filtros?.fechaHasta) query = query.lte('fecha_servicio', filtros.fechaHasta)
      if (filtros?.tipoServicio) query = query.eq('tipo_servicio', filtros.tipoServicio)

      const { data, error } = await query
      if (error) throw error
      return data as Servicio[]
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useServicioDetalleQuery(id: number) {
  return useQuery({
    queryKey: serviciosKeys.detail(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicios')
        .select(SELECT_SERVICIO)
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Servicio
    },
    staleTime: 1000 * 60 * 2,
  })
}

export function useCrearServicioMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearServicioInput) => {
      const { data: created, error } = await supabase
        .from('servicios')
        .insert(data)
        .select(SELECT_SERVICIO)
        .single()
      if (error) throw error
      return created as Servicio
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}

export function useEditarServicioMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarServicioInput) => {
      const { data: updated, error } = await supabase
        .from('servicios')
        .update(data)
        .eq('id', id)
        .select(SELECT_SERVICIO)
        .single()
      if (error) throw error
      return updated as Servicio
    },
    onSuccess: (updated) => {
      qc.setQueryData(serviciosKeys.detail(id), updated)
      qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}
