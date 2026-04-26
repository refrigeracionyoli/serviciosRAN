const NETWORK_ERROR_PATTERNS = [
  'failed to fetch',
  'networkerror',
  'network request failed',
  'load failed',
  'internet disconnected',
  'fetch failed',
  'the network connection was lost',
]

const AUTH_ERROR_PATTERNS = [
  'jwt',
  'session',
  'refresh token',
  'unauthorized',
  'forbidden',
  'not authenticated',
]

function normalizeErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase()
  }

  if (typeof error === 'string') {
    return error.toLowerCase()
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') {
      return message.toLowerCase()
    }
  }

  return ''
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

export function isLikelyNetworkError(error: unknown): boolean {
  if (!isBrowserOnline()) return true

  const text = normalizeErrorText(error)
  return NETWORK_ERROR_PATTERNS.some((pattern) => text.includes(pattern))
}

export function isLikelyAuthError(error: unknown): boolean {
  const text = normalizeErrorText(error)
  return AUTH_ERROR_PATTERNS.some((pattern) => text.includes(pattern))
}

export function isLikelyUniqueViolation(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (String(code) === '23505') {
      return true
    }
  }

  const text = normalizeErrorText(error)
  return (
    text.includes('23505')
    || text.includes('duplicate key')
    || text.includes('duplicate')
    || text.includes('already exists')
    || text.includes('unique constraint')
  )
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  if (typeof error === 'object' && error !== null) {
    if ('message' in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) {
        return message
      }
    }

    if ('error' in error) {
      const message = (error as { error?: unknown }).error
      if (typeof message === 'string' && message.trim()) {
        return message
      }
    }
  }

  return fallbackMessage
}
