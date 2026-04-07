import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/types/domain.types'

// ─── Query keys ───────────────────────────────────────────────
export const authKeys = {
  session: ['auth', 'session'] as const,
  perfil: ['auth', 'perfil'] as const,
}

// ─── Hooks ────────────────────────────────────────────────────

export function useSession() {
  return useQuery({
    queryKey: authKeys.session,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      return data.session
    },
    staleTime: Infinity,
  })
}

export function usePerfil() {
  const { data: session } = useSession()

  return useQuery({
    queryKey: authKeys.perfil,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session!.user.id)
        .single()
      if (error) throw error
      return data as Profile
    },
    enabled: !!session?.user?.id,
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
    isLoading: sessionLoading || (!!session && perfilLoading),
    isAuthenticated: !!session,
  }
}

export function useSignIn() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      // Verificar perfil activo
      const { data: perfil, error: perfilError } = await supabase
        .from('profiles')
        .select('activo, role')
        .eq('id', data.user.id)
        .single()

      if (perfilError) throw perfilError
      if (!perfil.activo) {
        await supabase.auth.signOut()
        throw new Error('Tu cuenta está desactivada. Contacta al administrador.')
      }

      return { session: data.session, perfil }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session })
      queryClient.invalidateQueries({ queryKey: authKeys.perfil })
    },
  })
}

export function useSignOut() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => supabase.auth.signOut(),
    onSuccess: () => {
      queryClient.clear()
    },
  })
}

/** Escucha cambios de sesión (expiración de JWT a las 8h) y redirige a /login */
export function useAuthStateListener() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        queryClient.invalidateQueries({ queryKey: authKeys.session })
        queryClient.invalidateQueries({ queryKey: authKeys.perfil })
      }
      if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
        queryClient.clear()
        navigate('/login', { replace: true })
      }
    })

    return () => subscription.unsubscribe()
  }, [queryClient, navigate])
}
