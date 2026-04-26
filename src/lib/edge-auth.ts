import { supabase } from './supabase'

const SESSION_EXPIRY_SKEW_MS = 10_000
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export async function getFreshAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error

  const currentSession = data.session
  if (!currentSession?.access_token) {
    throw new Error('No hay sesión activa. Inicia sesión nuevamente.')
  }

  if (
    currentSession.expires_at &&
    currentSession.expires_at * 1000 <= Date.now() + SESSION_EXPIRY_SKEW_MS
  ) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError || !refreshed.session?.access_token) {
      throw refreshError ?? new Error('Tu sesión expiró. Inicia sesión nuevamente.')
    }
    return refreshed.session.access_token
  }

  return currentSession.access_token
}

export async function getEdgeAuthHeaders(): Promise<Record<string, string>> {
  const accessToken = await getFreshAccessToken()
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: supabaseAnonKey,
  }
}
