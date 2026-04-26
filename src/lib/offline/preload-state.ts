const ADMIN_PRELOAD_STATE_KEY_PREFIX = 'ran.offline.admin-preload.'
export const ADMIN_PRELOAD_STATE_VERSION = 1

interface PersistedAdminPreloadState {
  version: number
  completedAt: number
}

function getAdminPreloadStateKey(ownerId: string): string {
  return `${ADMIN_PRELOAD_STATE_KEY_PREFIX}${ownerId}`
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function readAdminPreloadState(ownerId: string): PersistedAdminPreloadState | null {
  if (!ownerId || !canUseLocalStorage()) return null

  try {
    const raw = localStorage.getItem(getAdminPreloadStateKey(ownerId))
    if (!raw) return null

    const parsed = JSON.parse(raw) as PersistedAdminPreloadState
    if (parsed.version !== ADMIN_PRELOAD_STATE_VERSION) {
      return null
    }

    if (!Number.isFinite(parsed.completedAt) || parsed.completedAt <= 0) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

export function hasAdminPreloadState(ownerId: string): boolean {
  return Boolean(readAdminPreloadState(ownerId))
}

export function markAdminPreloadCompleted(ownerId: string, completedAt = Date.now()) {
  if (!ownerId || !canUseLocalStorage()) return

  const payload: PersistedAdminPreloadState = {
    version: ADMIN_PRELOAD_STATE_VERSION,
    completedAt,
  }

  try {
    localStorage.setItem(getAdminPreloadStateKey(ownerId), JSON.stringify(payload))
  } catch {
    // Ignorar problemas de quota/privacidad para no romper la app.
  }
}

export function clearAdminPreloadState(ownerId?: string) {
  if (!canUseLocalStorage()) return

  try {
    if (ownerId) {
      localStorage.removeItem(getAdminPreloadStateKey(ownerId))
      return
    }

    const keysToDelete: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(ADMIN_PRELOAD_STATE_KEY_PREFIX)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Ignorar errores secundarios.
  }
}
