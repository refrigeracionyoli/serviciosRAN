import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function getSupabaseApiKey(): string {
  return SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
}

export type AppRole = 'admin' | 'tecnico'

export interface AuthContext {
  userId: string
  role: AppRole
}

function createAuthClient() {
  const apiKey = getSupabaseApiKey()
  if (!SUPABASE_URL || !apiKey) {
    throw new Response('Falta configuracion SUPABASE_URL y una API key de Supabase', { status: 500 })
  }

  return createClient(SUPABASE_URL, apiKey)
}

function createUserScopedClient(token: string) {
  const apiKey = getSupabaseApiKey()
  if (!SUPABASE_URL || !apiKey) {
    throw new Response('Falta configuracion SUPABASE_URL y una API key de Supabase', { status: 500 })
  }

  return createClient(SUPABASE_URL, apiKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) throw new Response('Unauthorized', { status: 401 })

  const supabase = createAuthClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user) throw new Response('Unauthorized', { status: 401 })

  const userClient = createUserScopedClient(token)
  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('role, activo')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Response(`No se pudo cargar el perfil: ${profileError.message}`, { status: 500 })
  }
  if (!profile) {
    throw new Response('Perfil no encontrado', { status: 403 })
  }
  if (!profile.activo) throw new Response('Account disabled', { status: 403 })

  return {
    userId: user.id,
    role: profile.role as AppRole,
  }
}

export async function requireRole(
  req: Request,
  role: AppRole,
): Promise<AuthContext> {
  const auth = await requireAuth(req)
  if (auth.role !== role) throw new Response('Forbidden', { status: 403 })
  return auth
}

export async function requireAnyRole(
  req: Request,
  roles: readonly AppRole[],
): Promise<AuthContext> {
  const auth = await requireAuth(req)
  if (!roles.includes(auth.role)) throw new Response('Forbidden', { status: 403 })
  return auth
}
