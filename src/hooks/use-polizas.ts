import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Poliza, PolizaEstadoHistorial } from '@/types/domain.types'
import type { CrearPolizaInput, EditarPolizaInput } from '@/schemas/poliza.schema'

export const polizasKeys = {
  all: ['polizas'] as const,
  list: () => ['polizas', 'list'] as const,
  detail: (id: number) => ['polizas', 'detail', id] as const,
  history: (polizaId?: number) => ['polizas', 'history', polizaId] as const,
}

const SELECT_POLIZA = `*, cliente:clientes(*), maquina:maquinas(*)`

export function usePolizasQuery() {
  return useQuery({
    queryKey: polizasKeys.list(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('polizas')
        .select(SELECT_POLIZA)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Poliza[]
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function usePolizaEstadoHistorialQuery(polizaId?: number) {
  return useQuery({
    queryKey: polizasKeys.history(polizaId),
    queryFn: async () => {
      let query = supabase
        .from('poliza_estado_historial')
        .select('*')
        .order('changed_at', { ascending: true })

      if (polizaId) query = query.eq('poliza_id', polizaId)

      const { data, error } = await query
      if (error) throw error
      return data as PolizaEstadoHistorial[]
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useCrearPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearPolizaInput) => {
      const { data: created, error } = await supabase
        .from('polizas')
        .insert(data)
        .select(SELECT_POLIZA)
        .single()
      if (error) throw error
      return created as Poliza
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: polizasKeys.all }),
  })
}

export function useEditarPolizaMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarPolizaInput) => {
      const { data: updated, error } = await supabase
        .from('polizas')
        .update(data)
        .eq('id', id)
        .select(SELECT_POLIZA)
        .single()
      if (error) throw error
      return updated as Poliza
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: polizasKeys.all }),
  })
}

export function useDesactivarPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data: updated, error } = await supabase
        .from('polizas')
        .update({ activa: false })
        .eq('id', id)
        .select(SELECT_POLIZA)
        .single()
      if (error) throw error
      return updated as Poliza
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: polizasKeys.all }),
  })
}

export function useActivarPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data: updated, error } = await supabase
        .from('polizas')
        .update({ activa: true })
        .eq('id', id)
        .select(SELECT_POLIZA)
        .single()
      if (error) throw error
      return updated as Poliza
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: polizasKeys.all }),
  })
}

export function useEliminarPolizaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from('polizas')
        .delete()
        .eq('id', id)
      if (error) throw error
      return id
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: polizasKeys.all }),
  })
}
