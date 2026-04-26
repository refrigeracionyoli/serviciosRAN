const TECNICO_PRELOAD_STATE_KEY_PREFIX = 'ran.offline.tecnico-preload.'
export const TECNICO_PRELOAD_STATE_VERSION = 1

interface PersistedTecnicoPreloadState {
  version: number
  completedAt: number
}

function getTecnicoPreloadStateKey(ownerId: string): string {
  return `${TECNICO_PRELOAD_STATE_KEY_PREFIX}${ownerId}`
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

export function readTecnicoPreloadState(ownerId: string): PersistedTecnicoPreloadState | null {
  if (!ownerId || !canUseLocalStorage()) return null

  try {
    const raw = localStorage.getItem(getTecnicoPreloadStateKey(ownerId))
    if (!raw) return null

    const parsed = JSON.parse(raw) as PersistedTecnicoPreloadState
    if (parsed.version !== TECNICO_PRELOAD_STATE_VERSION) {
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

export function hasTecnicoPreloadState(ownerId: string): boolean {
  return Boolean(readTecnicoPreloadState(ownerId))
}

export function markTecnicoPreloadCompleted(ownerId: string, completedAt = Date.now()) {
  if (!ownerId || !canUseLocalStorage()) return

  const payload: PersistedTecnicoPreloadState = {
    version: TECNICO_PRELOAD_STATE_VERSION,
    completedAt,
  }

  try {
    localStorage.setItem(getTecnicoPreloadStateKey(ownerId), JSON.stringify(payload))
  } catch {
    // Ignorar problemas de quota/privacidad para no romper la app.
  }
}

export function clearTecnicoPreloadState(ownerId?: string) {
  if (!canUseLocalStorage()) return

  try {
    if (ownerId) {
      localStorage.removeItem(getTecnicoPreloadStateKey(ownerId))
      return
    }

    const keysToDelete: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(TECNICO_PRELOAD_STATE_KEY_PREFIX)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Ignorar errores secundarios.
  }
}
