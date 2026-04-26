import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  cacheProfile,
  cacheSessionSnapshot,
  cacheSessionUserId,
  clearSensitiveAuthCacheStrict,
  clearCachedSessionUserId,
  getCachedSessionSnapshot,
  getCachedProfile,
} from '@/lib/offline/auth-cache'
import {
  clearOfflineState,
  forceResetOfflineState,
  upsertCachedProfile as upsertCachedProfileSnapshot,
} from '@/lib/offline/cache'
import { queueProfileUpdate } from '@/lib/offline/catalogos-actions'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { getPasswordPolicyError } from '@/lib/password-policy'
import { clearAdminPreloadState } from '@/lib/offline/preload-state'
import { clearTecnicoPreloadState } from '@/lib/offline/tecnico-preload-state'
import { useSyncStore } from '@/stores/sync.store'
import type { Profile } from '@/types/domain.types'

// ─── Query keys ───────────────────────────────────────────────
export const authKeys = {
  session: ['auth', 'session'] as const,
  perfil: ['auth', 'perfil'] as const,
}

export interface ActualizarPerfilActualPayload {
  nombre: string
  correo: string
  telefono?: string | null
}

export interface ActualizarPerfilActualResult {
  profile: Profile
  syncStatus: 'synced' | 'pending'
  emailRequiresConfirmation: boolean
}

const SENSITIVE_LOCAL_STORAGE_KEYS = ['ran.servicio-nuevo.draft']
let invalidRefreshSessionHandled = false

function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const text = error.message.toLowerCase()
  return text.includes('invalid refresh token') || text.includes('refresh token not found')
}

function normalizeNullableTelefono(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function normalizeCurrentProfileUpdatePayload(
  data: ActualizarPerfilActualPayload,
): ActualizarPerfilActualPayload {
  return {
    nombre: data.nombre.trim(),
    correo: data.correo.trim().toLowerCase(),
    telefono: normalizeNullableTelefono(data.telefono),
  }
}

function mapSignInError(error: unknown): string {
  if (isLikelyNetworkError(error)) {
    return 'No se pudo iniciar sesión por la conexión. Inténtalo nuevamente.'
  }

  const message = error instanceof Error ? error.message.trim() : ''
  const normalized = message.toLowerCase()

  if (normalized.includes('invalid login credentials')) {
    return 'Correo o contraseña incorrectos.'
  }

  if (normalized.includes('email not confirmed')) {
    return 'Tu correo todavía no ha sido confirmado.'
  }

  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Demasiados intentos. Espera un momento e inténtalo nuevamente.'
  }

  if (normalized.includes('user not found') || normalized.includes('invalid email')) {
    return 'Correo o contraseña incorrectos.'
  }

  return message || 'No se pudo iniciar sesión.'
}

function mapCurrentUserAuthUpdateError(error: unknown, fallbackMessage: string): string {
  if (isLikelyNetworkError(error)) {
    return fallbackMessage
  }

  const message = error instanceof Error ? error.message.trim() : ''
  const normalized = message.toLowerCase()

  if (normalized.includes('already') && normalized.includes('registered')) {
    return 'Ese correo ya está en uso por otra cuenta.'
  }

  if (normalized.includes('same') && normalized.includes('email')) {
    return 'Ese correo ya está configurado en tu cuenta.'
  }

  if (normalized.includes('nonce') || normalized.includes('reauth') || normalized.includes('security')) {
    return 'Por seguridad, vuelve a iniciar sesión y después intenta nuevamente.'
  }

  if (normalized.includes('weak') && normalized.includes('password')) {
    return 'La contraseña no cumple con los requisitos de seguridad de Auth.'
  }

  return message || fallbackMessage
}

async function clearSensitiveClientState() {
  const storageErrors: string[] = []

  for (const key of SENSITIVE_LOCAL_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      storageErrors.push(error instanceof Error ? error.message : `No se pudo limpiar ${key}.`)
    }
  }

  try {
    await clearOfflineState()
  } catch (error) {
    try {
      await forceResetOfflineState()
    } catch (resetError) {
      storageErrors.push(
        error instanceof Error ? error.message : 'No se pudo limpiar la base offline local.',
        resetError instanceof Error ? resetError.message : 'No se pudo reiniciar la base offline local.',
      )
    }
  }

  try {
    clearSensitiveAuthCacheStrict()
  } catch (error) {
    storageErrors.push(error instanceof Error ? error.message : 'No se pudo limpiar la sesión local.')
  }

  try {
    clearCachedSessionUserId()
    clearAdminPreloadState()
    clearTecnicoPreloadState()
    useSyncStore.getState().reset()
  } catch (error) {
    storageErrors.push(error instanceof Error ? error.message : 'No se pudo limpiar el estado auxiliar local.')
  }

  if (storageErrors.length > 0) {
    throw new Error(
      'No se pudo limpiar por completo la información sensible de este dispositivo. Cierra otras pestañas de la app e inténtalo de nuevo.',
    )
  }
}

// ─── Hooks ────────────────────────────────────────────────────

export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: async () => {
      const cachedSession = getCachedSessionSnapshot()
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) {
          if (isInvalidRefreshTokenError(error)) {
            if (!invalidRefreshSessionHandled) {
              invalidRefreshSessionHandled = true
              try {
                await supabase.auth.signOut({ scope: 'local' })
              } catch {
                // Ignorar para evitar loop de errores.
              }
            }
            return null
          }

          if (isLikelyNetworkError(error)) {
            return cachedSession
          }

          throw error
        }

        if (data.session) {
          invalidRefreshSessionHandled = false
          cacheSessionSnapshot(data.session)
          cacheSessionUserId(data.session.user.id)
          return data.session
        }

        if (cachedSession && !navigator.onLine) {
          return cachedSession
        }
      } catch (error) {
        if (isLikelyNetworkError(error)) {
          return cachedSession
        }

        throw error
      }

      return null
    },
    staleTime: Infinity,
  })
}

export function usePerfil() {
  const { data: session } = useSession()

  return useQuery({
    queryKey: authKeys.perfil,
    queryFn: async () => {
      const userId = session!.user.id

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()

      if (error) {
        if (isLikelyNetworkError(error)) {
          const cached = getCachedProfile(userId)
          if (cached) return cached
        }
        throw error
      }

      if (!data) {
        const cached = getCachedProfile(userId)
        if (cached) {
          return cached
        }

        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('No se encontró perfil para esta cuenta. Contacta al administrador.')
      }

      const profile = data as Profile
      cacheProfile(profile)
      void upsertCachedProfileSnapshot(userId, profile)
      return profile
    },
    enabled: Boolean(session?.user?.id),
    staleTime: 1000 * 60 * 5,
  })
}

export function useAuth() {
  const { data: session, isLoading: sessionLoading } = useSession()
  const { data: perfil, isLoading: perfilLoading } = usePerfil()

  return {
    user: session?.user ?? null,
    session,
    perfil: perfil ?? null,
    isLoading: sessionLoading || (Boolean(session) && perfilLoading),
    isAuthenticated: Boolean(session),
  }
}

export function useSignIn() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const normalizedEmail = email.trim().toLowerCase()
      const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      if (error) throw new Error(mapSignInError(error))

      // Verificar perfil activo
      const { data: perfil, error: perfilError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle()

      if (perfilError) {
        if (isLikelyNetworkError(perfilError)) {
          throw new Error('No se pudo validar tu cuenta por la conexión. Inténtalo nuevamente.')
        }
        throw perfilError
      }
      const typedPerfil = (perfil ?? null) as Profile | null
      if (!typedPerfil) {
        await supabase.auth.signOut({ scope: 'local' })
        throw new Error('No se encontró perfil para esta cuenta. Contacta al administrador.')
      }
      if (!typedPerfil.activo) {
        await supabase.auth.signOut()
        throw new Error('Tu cuenta está desactivada. Contacta al administrador.')
      }

      return { session: data.session, perfil: typedPerfil }
    },
    onSuccess: async ({ session, perfil }) => {
      try {
        // Evita carrera de estado al navegar inmediatamente después del login.
        await clearSensitiveClientState()
      } catch (error) {
        try {
          await supabase.auth.signOut({ scope: 'local' })
        } catch {
          // Intento secundario para no dejar la sesión abierta tras un fallo de limpieza.
        }

        queryClient.clear()
        throw error
      }

      cacheProfile(perfil)
      cacheSessionSnapshot(session)
      cacheSessionUserId(perfil.id)
      await upsertCachedProfileSnapshot(perfil.id, perfil)
      queryClient.setQueryData(authKeys.session, session)
      queryClient.setQueryData(authKeys.perfil, perfil)
      void queryClient.invalidateQueries({ queryKey: authKeys.session })
      void queryClient.invalidateQueries({ queryKey: authKeys.perfil })
    },
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      try {
        await supabase.auth.signOut({ scope: 'global' })
      } catch (error) {
        if (!isLikelyNetworkError(error)) {
          throw error
        }

        await supabase.auth.signOut({ scope: 'local' })
      }

      await clearSensitiveClientState()
    },
    onSuccess: async () => {
      queryClient.clear()
    },
  })
}

export function useActualizarPerfilActualMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      input: ActualizarPerfilActualPayload,
    ): Promise<ActualizarPerfilActualResult> => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar tu perfil.')
      }

      const currentProfile = queryClient.getQueryData<Profile>(authKeys.perfil)
        ?? getCachedProfile(ownerId)

      if (!currentProfile) {
        throw new Error('No se pudo cargar tu perfil actual.')
      }

      const data = normalizeCurrentProfileUpdatePayload(input)
      const emailChanged = data.correo !== currentProfile.correo
      let emailRequiresConfirmation = false

      if (emailChanged && !isBrowserOnline()) {
        throw new Error('Para cambiar tu correo necesitas conexión a internet.')
      }

      if (emailChanged) {
        try {
          const { data: authData, error: authError } = await supabase.auth.updateUser({
            email: data.correo,
          })

          if (authError) throw authError

          const pendingEmail = (authData.user as { new_email?: string | null } | null)?.new_email
          emailRequiresConfirmation = Boolean(
            authData.user
            && authData.user.email !== data.correo
            && pendingEmail === data.correo,
          )
        } catch (error) {
          if (!isLikelyNetworkError(error)) {
            throw new Error(mapCurrentUserAuthUpdateError(error, 'No se pudo actualizar el correo de acceso.'))
          }

          const queued = await queueProfileUpdate(ownerId, ownerId, data)
          return {
            profile: queued,
            syncStatus: 'pending',
            emailRequiresConfirmation: false,
          }
        }
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('profiles')
            .update(data)
            .eq('id', ownerId)
            .select('*')
            .single()

          if (error) throw error

          return {
            profile: updated as Profile,
            syncStatus: 'synced',
            emailRequiresConfirmation,
          }
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      const queued = await queueProfileUpdate(ownerId, ownerId, data, {
        skipAuthUpdate: emailChanged,
      })

      return {
        profile: queued,
        syncStatus: 'pending',
        emailRequiresConfirmation,
      }
    },
    onSuccess: async (result) => {
      cacheProfile(result.profile)
      await upsertCachedProfileSnapshot(result.profile.id, result.profile)
      queryClient.setQueryData(authKeys.perfil, result.profile)
    },
  })
}

export function useCambiarPasswordActualMutation() {
  return useMutation({
    mutationFn: async ({ password }: { password: string }) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para cambiar tu contraseña.')
      }

      const passwordError = getPasswordPolicyError(password)
      if (passwordError) {
        throw new Error(passwordError)
      }

      if (!isBrowserOnline()) {
        throw new Error('Para cambiar tu contraseña necesitas conexión a internet.')
      }

      try {
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
      } catch (error) {
        if (isLikelyNetworkError(error)) {
          throw new Error('Para cambiar tu contraseña necesitas conexión a internet.')
        }

        throw new Error(mapCurrentUserAuthUpdateError(error, 'No se pudo actualizar tu contraseña.'))
      }
    },
  })
}

/** Escucha cambios de sesión (expiración de JWT a las 8h) y redirige a /login */
export function useAuthStateListener() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        void queryClient.invalidateQueries({ queryKey: authKeys.session })
        void queryClient.invalidateQueries({ queryKey: authKeys.perfil })
      }

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user?.id) {
        cacheSessionSnapshot(session)
        cacheSessionUserId(session.user.id)
        const cached = getCachedProfile(session.user.id)
        if (cached) {
          queryClient.setQueryData(authKeys.perfil, cached)
        }
      }

      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        try {
          await clearSensitiveClientState()
        } catch (error) {
          console.error('No se pudo limpiar el almacenamiento sensible al cerrar sesión.', error)
        }
        queryClient.clear()
        navigate('/login', { replace: true })
      }
    })

    return () => subscription.unsubscribe()
  }, [queryClient, navigate])
}
