import { isLikelyNetworkError } from '@/lib/offline/network'

interface OfflineFallbackOptions<T> {
  remote: () => Promise<T>
  local: () => Promise<T>
  onRemoteSuccess?: (value: T) => Promise<void> | void
}

export async function withOfflineFallback<T>({
  remote,
  local,
  onRemoteSuccess,
}: OfflineFallbackOptions<T>): Promise<T> {
  try {
    const value = await remote()
    await onRemoteSuccess?.(value)
    return value
  } catch (error) {
    if (!isLikelyNetworkError(error)) {
      throw error
    }

    return local()
  }
}
