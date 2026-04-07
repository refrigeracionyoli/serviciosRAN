import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Maquina } from '@/types/domain.types'
import type { CrearMaquinaInput, EditarMaquinaInput } from '@/schemas/cliente.schema'

export const maquinasKeys = {
  all: ['maquinas'] as const,
  list: (clienteId?: number) => ['maquinas', 'list', clienteId] as const,
  detail: (id: number) => ['maquinas', 'detail', id] as const,
}

export function useMaquinasQuery(clienteId?: number) {
  return useQuery({
    queryKey: maquinasKeys.list(clienteId),
    queryFn: async () => {
      let query = supabase
        .from('maquinas')
        .select('*, cliente:clientes(id, nombre, codigo_cliente)')
        .eq('activo', true)
        .order('serie')

      if (clienteId) query = query.eq('cliente_id', clienteId)

      const { data, error } = await query
      if (error) throw error
      return data as Maquina[]
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearMaquinaMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearMaquinaInput) => {
      const { data: created, error } = await supabase
        .from('maquinas')
        .insert(data)
        .select()
        .single()
      if (error) throw error
      return created as Maquina
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: maquinasKeys.all }),
  })
}

export function useEditarMaquinaMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarMaquinaInput) => {
      const { data: updated, error } = await supabase
        .from('maquinas')
        .update(data)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return updated as Maquina
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: maquinasKeys.all }),
  })
}
