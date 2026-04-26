import { supabase } from '@/lib/supabase'
import { cacheSessionUserId, getCachedSessionUserId } from '@/lib/offline/auth-cache'

export async function getCurrentSessionUserId(): Promise<string | null> {
  const cachedSessionUserId = getCachedSessionUserId()

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return cachedSessionUserId
  }

  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      return cachedSessionUserId
    }

    const sessionUserId = data.session?.user.id ?? cachedSessionUserId
    if (sessionUserId) {
      cacheSessionUserId(sessionUserId)
    }

    return sessionUserId
  } catch {
    return cachedSessionUserId
  }
}

export async function getCurrentSessionUser() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.user ?? null
}
