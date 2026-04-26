import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { requireRole } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const EMPLEADO_ROLES = ['admin', 'tecnico'] as const
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ResetEmpleadoPasswordPayload {
  empleadoId: string
  password: string
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Response('La contraseña debe tener al menos 8 caracteres.', { status: 400 })
  }

  const checks = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]

  const complexityScore = checks.filter(Boolean).length
  if (complexityScore < 3) {
    throw new Response(
      'La contraseña debe incluir al menos 3 de 4 tipos: mayúsculas, minúsculas, números y símbolos.',
      { status: 400 },
    )
  }

  if (/(1234|password|qwerty|admin|asdf)/i.test(password)) {
    throw new Response('La contraseña contiene patrones inseguros. Elige una más robusta.', { status: 400 })
  }
}

function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Response('Falta configuración SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY', { status: 500 })
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function parsePayload(payload: unknown): ResetEmpleadoPasswordPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Response('Payload inválido', { status: 400 })
  }

  const body = payload as Record<string, unknown>
  const empleadoId = typeof body.empleadoId === 'string' ? body.empleadoId.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!UUID_REGEX.test(empleadoId)) {
    throw new Response('Empleado inválido.', { status: 400 })
  }

  validatePassword(password)

  return { empleadoId, password }
}

function mapUpdatePasswordError(errorMessage: string): string {
  const normalized = errorMessage.toLowerCase()

  if (normalized.includes('password') && normalized.includes('weak')) {
    return 'La contraseña no cumple con los requisitos de seguridad de Auth.'
  }

  if (normalized.includes('user') && normalized.includes('not found')) {
    return 'No se encontró el usuario en Auth.'
  }

  return `No se pudo actualizar la contraseña: ${errorMessage}`
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
    return new Response('Método no permitido', {
      status: 405,
      headers: corsHeaders,
    })
  }

  try {
    await requireRole(req, 'admin')
    const payload = parsePayload(await req.json())
    const serviceClient = createServiceClient()

    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('id, role')
      .eq('id', payload.empleadoId)
      .maybeSingle()

    if (profileError) {
      throw new Response(`No se pudo validar el perfil del empleado: ${profileError.message}`, { status: 500 })
    }

    if (!profile) {
      throw new Response('Empleado no encontrado.', { status: 404 })
    }

    if (!EMPLEADO_ROLES.includes(profile.role as (typeof EMPLEADO_ROLES)[number])) {
      throw new Response('El usuario seleccionado no pertenece al catálogo de empleados.', { status: 400 })
    }

    const { error: updateError } = await serviceClient.auth.admin.updateUserById(payload.empleadoId, {
      password: payload.password,
    })

    if (updateError) {
      throw new Response(mapUpdatePasswordError(updateError.message), { status: 400 })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  } catch (err) {
    if (err instanceof Response) {
      const message = await err.text()
      return new Response(message, {
        status: err.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain',
        },
      })
    }

    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  }
})
