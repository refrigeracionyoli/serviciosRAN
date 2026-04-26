import { supabase } from '@/lib/supabase'
import type { ServicioStatus, UserRole } from '@/types/domain.types'

export interface RemoteWritableServiceSnapshot {
  id: number
  tecnico_id: string | null
  status: ServicioStatus
  updated_at: string
  costo_refacciones: number | null
  costo_mano_obra: number | null
}

interface CurrentServiceActor {
  id: string
  role: UserRole
}

async function getCurrentServiceActor(): Promise<CurrentServiceActor> {
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError) throw authError

  const currentUser = authData.user
  if (!currentUser) {
    throw new Error('No hay sesión activa para sincronizar cambios del servicio.')
  }

  const roleFromAuth = currentUser.user_metadata?.role ?? currentUser.app_metadata?.role
  if (roleFromAuth === 'admin' || roleFromAuth === 'tecnico') {
    return {
      id: currentUser.id,
      role: roleFromAuth,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (profileError) throw profileError

  return {
    id: currentUser.id,
    role: profile.role as UserRole,
  }
}

export async function assertCurrentUserCanWriteRemoteService(serviceId: number): Promise<RemoteWritableServiceSnapshot> {
  const actor = await getCurrentServiceActor()

  const { data: service, error: serviceError } = await supabase
    .from('servicios')
    .select('id, tecnico_id, status, updated_at, costo_refacciones, costo_mano_obra')
    .eq('id', serviceId)
    .single()

  if (serviceError) throw serviceError

  const typedService = service

  if (actor.role !== 'admin' && typedService.tecnico_id !== actor.id) {
    throw new Error('No tienes permiso para sincronizar cambios de este servicio.')
  }

  return typedService
}
