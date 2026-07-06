import type { QueryClient, QueryKey } from '@tanstack/react-query'

export function setOfflineHydratedQueryData<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  data: T,
  updatedAt = 0,
) {
  queryClient.setQueryData(queryKey, data, { updatedAt })
}
