import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      staleTime: 1000 * 60 * 5,   // 5 minutos
      gcTime: 1000 * 60 * 10,     // 10 minutos en caché
      retry: 1,
      // Evita picos de refetch al alternar pestañas/ventanas del navegador.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      networkMode: 'always',
      retry: 0,
    },
  },
})
