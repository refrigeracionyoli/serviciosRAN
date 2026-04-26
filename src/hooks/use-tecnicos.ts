import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { getEdgeAuthHeaders } from '@/lib/edge-auth'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  findRemoteProfileByCorreo,
  queueProfileCreate,
  queueProfileResetPassword,
  queueProfileUpdate,
} from '@/lib/offline/catalogos-actions'
import { getCachedProfilesByRole, upsertCachedProfiles } from '@/lib/offline/cache'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { getPasswordPolicyError } from '@/lib/password-policy'
import type { Profile, UserRole } from '@/types/domain.types'

const EMPLEADOS_ROLES: UserRole[] = ['admin', 'tecnico']

export const tecnicosKeys = {
  all: ['tecnicos'] as const,
  list: (includeInactive = false) => ['tecnicos', 'list', includeInactive] as const,
  empleadosList: (includeInactive = false) => ['tecnicos', 'empleados', 'list', includeInactive] as const,
}

interface TecnicosQueryOptions {
  includeInactive?: boolean
}

interface EmpleadosQueryOptions {
  includeInactive?: boolean
}

interface EditarTecnicoPayload {
  id: string
  data: Partial<Pick<Profile, 'nombre' | 'correo' | 'telefono' | 'activo'>>
}

export interface CrearTecnicoCuentaPayload {
  nombre: string
  correo: string
  telefono?: string | null
  activo?: boolean
  role: UserRole
  password: string
  notas?: string | null
}

export interface CambiarPasswordEmpleadoPayload {
  empleadoId: string
  password: string
}

interface CrearTecnicoCuentaResponse {
  profile: Profile
}

async function getAdminFunctionHeaders() {
  return getEdgeAuthHeaders()
}

async function getFunctionErrorMessage(error: unknown, fallbackMessage: string): Promise<string> {
  if (error instanceof Error) {
    if (typeof (error as { context?: unknown }).context === 'undefined') {
      return error.message
    }
  }

  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const text = (await context.text()).trim()
        if (text.length) return text
      } catch {
        // Sin cuerpo utilizable en la respuesta.
      }
      return `Error ${context.status}: ${fallbackMessage}`
    }
  }

  if (error instanceof Error) return error.message
  return fallbackMessage
}

export function useTecnicosQuery(options?: TecnicosQueryOptions) {
  const includeInactive = Boolean(options?.includeInactive)

  return useQuery({
    queryKey: tecnicosKeys.list(includeInactive),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, ['profile.create', 'profile.update'])
      if (shouldUseLocalOnly) {
        return getCachedProfilesByRole(ownerId, ['tecnico'], includeInactive)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('profiles')
            .select('*')
            .eq('role', 'tecnico')
            .order('nombre')

          if (!includeInactive) {
            query = query.eq('activo', true)
          }

          const { data, error } = await query
          if (error) throw error
          await upsertCachedProfiles(ownerId, data as Profile[])
          return getCachedProfilesByRole(ownerId, ['tecnico'], includeInactive)
        },
        local: () => getCachedProfilesByRole(ownerId, ['tecnico'], includeInactive),
      })
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useEmpleadosQuery(options?: EmpleadosQueryOptions) {
  const includeInactive = Boolean(options?.includeInactive)

  return useQuery({
    queryKey: tecnicosKeys.empleadosList(includeInactive),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, ['profile.create', 'profile.update'])
      if (shouldUseLocalOnly) {
        return getCachedProfilesByRole(ownerId, EMPLEADOS_ROLES, includeInactive)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('profiles')
            .select('*')
            .in('role', EMPLEADOS_ROLES)
            .order('nombre')

          if (!includeInactive) {
            query = query.eq('activo', true)
          }

          const { data, error } = await query
          if (error) throw error
          await upsertCachedProfiles(ownerId, data as Profile[])
          return getCachedProfilesByRole(ownerId, EMPLEADOS_ROLES, includeInactive)
        },
        local: () => getCachedProfilesByRole(ownerId, EMPLEADOS_ROLES, includeInactive),
      })
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useEditarTecnicoMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: EditarTecnicoPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el empleado.')
      }

      if (isBrowserOnline()) {
        try {
          const { data: updated, error } = await supabase
            .from('profiles')
            .update(data)
            .eq('id', id)
            .select('*')
            .single()

          if (error) throw error
          return updated as Profile
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueProfileUpdate(ownerId, id, data)
    },
    onSuccess: async (updated) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedProfiles(ownerId, [updated])
      }
      await qc.invalidateQueries({ queryKey: tecnicosKeys.all })
    },
  })
}

export function useCrearTecnicoMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CrearTecnicoCuentaPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para crear el empleado.')
      }

      const passwordError = getPasswordPolicyError(payload.password)
      if (passwordError) {
        throw new Error(passwordError)
      }

      if (isBrowserOnline()) {
        try {
          const existing = await findRemoteProfileByCorreo(payload.correo)
          if (existing) {
            return existing
          }

          const headers = await getAdminFunctionHeaders()
          const { data, error } = await supabase.functions.invoke<CrearTecnicoCuentaResponse>('admin-create-tecnico', {
            body: payload,
            headers,
          })

          if (error) {
            const message = await getFunctionErrorMessage(error, 'No se pudo crear el empleado.')
            throw new Error(message)
          }

          if (!data?.profile) {
            throw new Error('La función no devolvió el perfil del empleado creado.')
          }

          return data.profile
        } catch (error) {
          if (!isLikelyNetworkError(error)) {
            const duplicated = await findRemoteProfileByCorreo(payload.correo)
            if (duplicated) {
              return duplicated
            }

            throw error
          }
        }
      }

      return queueProfileCreate(ownerId, payload)
    },
    onSuccess: async (created) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedProfiles(ownerId, [created])
      }
      await qc.invalidateQueries({ queryKey: tecnicosKeys.all })
      await qc.invalidateQueries({ queryKey: ['servicios', 'count-by-tecnico-month'] })
    },
  })
}

export function useCambiarPasswordEmpleadoMutation() {
  return useMutation({
    mutationFn: async (payload: CambiarPasswordEmpleadoPayload) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para cambiar la contraseña del empleado.')
      }

      const passwordError = getPasswordPolicyError(payload.password)
      if (passwordError) {
        throw new Error(passwordError)
      }

      if (isBrowserOnline()) {
        try {
          const headers = await getAdminFunctionHeaders()
          const { error } = await supabase.functions.invoke('admin-reset-empleado-password', {
            body: payload,
            headers,
          })

          if (error) {
            const message = await getFunctionErrorMessage(error, 'No se pudo cambiar la contraseña del empleado.')
            throw new Error(message)
          }

          return
        } catch (error) {
          if (!isLikelyNetworkError(error)) throw error
        }
      }

      await queueProfileResetPassword(ownerId, payload.empleadoId, payload.password)
    },
  })
}
