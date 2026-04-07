import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Cliente } from '@/types/domain.types'
import type { CrearClienteInput, EditarClienteInput } from '@/schemas/cliente.schema'

export const clientesKeys = {
  all: ['clientes'] as const,
  list: () => ['clientes', 'list'] as const,
  detail: (id: number) => ['clientes', 'detail', id] as const,
}

export function useClientesQuery() {
  return useQuery({
    queryKey: clientesKeys.list(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as Cliente[]
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useCrearClienteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CrearClienteInput) => {
      const { data: created, error } = await supabase
        .from('clientes')
        .insert(data)
        .select()
        .single()
      if (error) throw error
      return created as Cliente
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: clientesKeys.all }),
  })
}

export function useEditarClienteMutation(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: EditarClienteInput) => {
      const { data: updated, error } = await supabase
        .from('clientes')
        .update(data)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return updated as Cliente
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: clientesKeys.all }),
  })
}
