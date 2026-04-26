import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function getAuthApiKey(): string {
  // Para validar JWT de usuario, ANON es la opción más estable.
  // Si SERVICE_ROLE quedó rotada/desincronizada, usarla aquí rompe toda la auth de Edge Functions.
  return SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY
}

export type AppRole = 'admin' | 'tecnico'

export interface AuthContext {
  userId: string
  role: AppRole
}

function resolveRequestApiKey(req: Request): string {
  const requestApiKey = req.headers.get('apikey')?.trim()
  if (requestApiKey) return requestApiKey
  return getAuthApiKey()
}

function createAuthClient(apiKey: string) {
  if (!SUPABASE_URL || !apiKey) {
    throw new Response('Falta configuracion SUPABASE_URL y una API key de Supabase', { status: 500 })
  }

  return createClient(SUPABASE_URL, apiKey)
}

function createUserScopedClient(token: string, apiKey: string) {
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

async function resolveAuthenticatedUserId(token: string, apiKey: string): Promise<string> {
  const supabase = createAuthClient(apiKey)
  const { data, error } = await supabase.auth.getClaims(token)
  const userId = data?.claims?.sub

  if (error || !userId) {
    throw new Response('Unauthorized', { status: 401 })
  }

  return userId
}

export async function requireAuth(req: Request): Promise<AuthContext> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) throw new Response('Unauthorized', { status: 401 })

  const apiKey = resolveRequestApiKey(req)
  const userId = await resolveAuthenticatedUserId(token, apiKey)

  const userClient = createUserScopedClient(token, apiKey)
  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('role, activo')
    .eq('id', userId)
    .single()

  if (profileError) {
    throw new Response(`No se pudo cargar el perfil: ${profileError.message}`, { status: 500 })
  }
  if (!profile) {
    throw new Response('Perfil no encontrado', { status: 403 })
  }
  if (!profile.activo) throw new Response('Account disabled', { status: 403 })

  return {
    userId,
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
