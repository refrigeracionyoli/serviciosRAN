import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const INVALID_JWT_REGEX = /\binvalid jwt\b/i

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan variables de entorno: VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY son requeridas.',
  )
}

let supabaseClient: SupabaseClient | null = null
let isInvalidJwtSignOutInProgress = false

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function extractAuthToken(input: RequestInfo | URL, init?: RequestInit): string | null {
  const fromHeaders = (headers: Headers | null): string | null => {
    if (!headers) return null
    const auth = headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) return null
    return auth.slice('Bearer '.length)
  }

  if (init?.headers) {
    const headerBag = new Headers(init.headers)
    const token = fromHeaders(headerBag)
    if (token) return token
  }

  if (typeof input !== 'string' && !(input instanceof URL)) {
    return fromHeaders(input.headers)
  }

  return null
}

async function handleInvalidJwtResponse(input: RequestInfo | URL, init: RequestInit | undefined, response: Response) {
  if (response.status !== 401) return

  const requestUrl = getRequestUrl(input)
  if (requestUrl.includes('/auth/v1/')) return
  if (requestUrl.includes('/functions/v1/')) return

  let rawText = ''
  try {
    rawText = await response.clone().text()
  } catch {
    return
  }

  if (!INVALID_JWT_REGEX.test(rawText)) return
  if (isInvalidJwtSignOutInProgress) return

  const requestToken = extractAuthToken(input, init)
  if (!requestToken) return

  const client = supabaseClient
  if (!client) return

  const { data } = await client.auth.getSession()
  const activeToken = data.session?.access_token
  if (!activeToken || activeToken !== requestToken) {
    // Evita cerrar sesión por respuestas tardías de requests con token viejo.
    return
  }

  isInvalidJwtSignOutInProgress = true
  try {
    await supabaseClient?.auth.signOut({ scope: 'local' })
  } catch {
    // Ignorar error secundario de cierre de sesión.
  } finally {
    isInvalidJwtSignOutInProgress = false
  }
}

const wrappedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  void handleInvalidJwtResponse(input, init, response)
  return response
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: wrappedFetch,
  },
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

supabaseClient = supabase
