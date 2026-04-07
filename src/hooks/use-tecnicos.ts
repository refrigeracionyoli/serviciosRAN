import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/domain.types'

export const tecnicosKeys = {
  all: ['tecnicos'] as const,
  list: () => ['tecnicos', 'list'] as const,
}

export function useTecnicosQuery() {
  return useQuery({
    queryKey: tecnicosKeys.list(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'tecnico')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as Profile[]
    },
    staleTime: 1000 * 60 * 10,
  })
}
