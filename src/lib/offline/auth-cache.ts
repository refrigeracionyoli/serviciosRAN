import type { Session } from '@supabase/supabase-js'
import type { Profile } from '@/types/domain.types'

const PROFILE_KEY_PREFIX = 'ran.offline.profile.'
const SESSION_USER_ID_KEY = 'ran.offline.session-user-id'
const SESSION_SNAPSHOT_KEY = 'ran.offline.session'

function getProfileKey(userId: string): string {
  return `${PROFILE_KEY_PREFIX}${userId}`
}

export function cacheProfile(profile: Profile) {
  try {
    localStorage.setItem(getProfileKey(profile.id), JSON.stringify(profile))
  } catch {
    // Ignorar quota/privacidad del navegador para no romper el flujo principal.
  }
}

export function getCachedProfile(userId: string): Profile | null {
  try {
    const raw = localStorage.getItem(getProfileKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as Profile
  } catch {
    return null
  }
}

export function clearCachedProfile(userId: string) {
  try {
    localStorage.removeItem(getProfileKey(userId))
  } catch {
    // Ignorar error secundario.
  }
}

export function clearAllCachedProfiles() {
  try {
    const keysToDelete: string[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(PROFILE_KEY_PREFIX)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach((key) => localStorage.removeItem(key))
  } catch {
    // Ignorar error secundario.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSessionLike(value: unknown): value is Session {
  if (!isRecord(value)) return false
  const user = value.user
  return isRecord(user) && typeof user.id === 'string'
}

function extractSessionSnapshot(value: unknown): Session | null {
  if (isSessionLike(value)) return value
  if (!isRecord(value)) return null

  if (isSessionLike(value.currentSession)) {
    return value.currentSession
  }

  if (isSessionLike(value.session)) {
    return value.session
  }

  return null
}

function readSessionSnapshot(key: string): Session | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return extractSessionSnapshot(JSON.parse(raw))
  } catch {
    return null
  }
}

function getPersistedSupabaseSession(): Session | null {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue

      const snapshot = readSessionSnapshot(key)
      if (snapshot) return snapshot
    }
  } catch {
    return null
  }

  return null
}

export function cacheSessionSnapshot(session: Session) {
  try {
    localStorage.setItem(SESSION_SNAPSHOT_KEY, JSON.stringify(session))
  } catch {
    // Ignorar quota/privacidad del navegador para no romper el flujo principal.
  }
}

export function getCachedSessionSnapshot(): Session | null {
  const explicitSnapshot = readSessionSnapshot(SESSION_SNAPSHOT_KEY)
  if (explicitSnapshot) return explicitSnapshot
  return getPersistedSupabaseSession()
}

export function clearCachedSessionSnapshot() {
  try {
    localStorage.removeItem(SESSION_SNAPSHOT_KEY)
  } catch {
    // Ignorar error secundario.
  }
}

export function cacheSessionUserId(userId: string) {
  try {
    localStorage.setItem(SESSION_USER_ID_KEY, userId)
  } catch {
    // Ignorar errores secundarios de localStorage.
  }
}

export function getCachedSessionUserId(): string | null {
  try {
    const value = localStorage.getItem(SESSION_USER_ID_KEY)
    return value?.trim() ? value : null
  } catch {
    return null
  }
}

export function clearCachedSessionUserId() {
  try {
    localStorage.removeItem(SESSION_USER_ID_KEY)
  } catch {
    // Ignorar errores secundarios.
  }
}

export function clearSensitiveAuthCacheStrict() {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return

  const keysToDelete: string[] = [SESSION_USER_ID_KEY, SESSION_SNAPSHOT_KEY]

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(PROFILE_KEY_PREFIX)) {
      keysToDelete.push(key)
    }
  }

  for (const key of keysToDelete) {
    localStorage.removeItem(key)
  }
}
