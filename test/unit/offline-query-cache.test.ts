import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { setOfflineHydratedQueryData } from '@/lib/offline/query-cache'

describe('offline query hydration freshness', () => {
  it('keeps persisted snapshots stale by default', () => {
    const queryClient = new QueryClient()

    setOfflineHydratedQueryData(queryClient, ['snapshot'], ['cached'])

    expect(queryClient.getQueryState(['snapshot'])?.dataUpdatedAt).toBe(0)
  })

  it('marks a snapshot fresh when it was just downloaded', () => {
    const queryClient = new QueryClient()
    const completedAt = Date.now()

    setOfflineHydratedQueryData(queryClient, ['snapshot'], ['fresh'], completedAt)

    expect(queryClient.getQueryState(['snapshot'])?.dataUpdatedAt).toBe(completedAt)
  })
})
