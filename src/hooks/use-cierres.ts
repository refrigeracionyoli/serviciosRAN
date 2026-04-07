import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Cierre } from '@/types/domain.types'
import type { CierreInput } from '@/schemas/cliente.schema'
import { serviciosKeys } from './use-servicios'

export const cierresKeys = {
  all: ['cierres'] as const,
  byServicio: (servicioId: number) => ['cierres', 'servicio', servicioId] as const,
}

export function useCierreQuery(servicioId: number) {
  return useQuery({
    queryKey: cierresKeys.byServicio(servicioId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cierres')
        .select('*, tecnico:profiles(id, nombre)')
        .eq('servicio_id', servicioId)
        .maybeSingle()
      if (error) throw error
      return data as Cierre | null
    },
  })
}

export function useCerrarServicioMutation(servicioId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CierreInput) => {
      // 1. Crear el cierre
      const { data: cierre, error: cierreError } = await supabase
        .from('cierres')
        .insert(data)
        .select()
        .single()
      if (cierreError) throw cierreError

      // 2. Cambiar status del servicio a 'cerrado' (solo admin puede hacer esto por RLS)
      const { error: statusError } = await supabase
        .from('servicios')
        .update({ status: 'cerrado' })
        .eq('id', servicioId)
      if (statusError) throw statusError

      return cierre as Cierre
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviciosKeys.detail(servicioId) })
      qc.invalidateQueries({ queryKey: serviciosKeys.all })
      qc.invalidateQueries({ queryKey: cierresKeys.byServicio(servicioId) })
    },
  })
}
