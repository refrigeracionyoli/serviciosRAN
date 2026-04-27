import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCors } from '../_shared/cors.ts'
import { requireRole } from '../_shared/auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ACCOUNT_ROLES = ['admin', 'tecnico'] as const
type AccountRole = (typeof ACCOUNT_ROLES)[number]

interface CreateTecnicoPayload {
  nombre: string
  correo: string
  telefono: string | null
  role: AccountRole
  activo: boolean
  password: string
  notas: string | null
}

function validatePassword(password: string): void {
  if (password.length < 8) {
    throw new Response('La contraseña debe tener al menos 8 caracteres', { status: 400 })
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

function toNullable(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function parsePayload(payload: unknown): CreateTecnicoPayload {
  if (typeof payload !== 'object' || payload === null) {
    throw new Response('Payload inválido', { status: 400 })
  }

  const body = payload as Record<string, unknown>
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''
  const correo = typeof body.correo === 'string' ? body.correo.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const telefono = toNullable(body.telefono)
  const notas = toNullable(body.notas)
  const role = ACCOUNT_ROLES.includes(body.role as AccountRole) ? (body.role as AccountRole) : 'tecnico'
  const activo = typeof body.activo === 'boolean' ? body.activo : true

  if (nombre.length < 2) {
    throw new Response('El nombre es requerido', { status: 400 })
  }

  if (!EMAIL_REGEX.test(correo)) {
    throw new Response('Correo inválido', { status: 400 })
  }

  validatePassword(password)

  return {
    nombre,
    correo,
    telefono,
    role,
    activo,
    password,
    notas,
  }
}

function mapAdminCreateUserError(errorMessage: string): string {
  const normalized = errorMessage.toLowerCase()
  if (
    normalized.includes('already') ||
    normalized.includes('registered') ||
    normalized.includes('duplicate') ||
    normalized.includes('email_exists')
  ) {
    return 'Ya existe una cuenta con ese correo.'
  }

  return `No se pudo crear el usuario en Auth: ${errorMessage}`
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  const corsHeaders = getCorsHeaders(req)

  if (req.method !== 'POST') {
    return new Response('Método no permitido', {
      status: 405,
      headers: corsHeaders,
    })
  }

  let createdUserId: string | null = null

  try {
    await requireRole(req, 'admin')
    const payload = parsePayload(await req.json())
    const serviceClient = createServiceClient()

    const { data: existingProfile, error: existingProfileError } = await serviceClient
      .from('profiles')
      .select('id')
      .eq('correo', payload.correo)
      .maybeSingle()

    if (existingProfileError) {
      throw new Response(`No se pudo validar correo existente: ${existingProfileError.message}`, { status: 500 })
    }

    if (existingProfile) {
      throw new Response('Ya existe un empleado con ese correo.', { status: 409 })
    }

    const { data: createdUser, error: createUserError } = await serviceClient.auth.admin.createUser({
      email: payload.correo,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        nombre: payload.nombre,
        role: payload.role,
        notas: payload.notas ?? undefined,
      },
    })

    if (createUserError || !createdUser?.user?.id) {
      const detail = mapAdminCreateUserError(createUserError?.message ?? 'No se recibió user.id')
      throw new Response(detail, { status: 400 })
    }

    createdUserId = createdUser.user.id

    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .upsert({
        id: createdUser.user.id,
        nombre: payload.nombre,
        correo: payload.correo,
        telefono: payload.telefono,
        role: payload.role,
        activo: payload.activo,
      }, {
        onConflict: 'id',
      })
      .select('*')
      .single()

    if (profileError) {
      throw new Response(`No se pudo completar el perfil del empleado: ${profileError.message}`, { status: 500 })
    }

    return new Response(JSON.stringify({ profile }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    })
  } catch (err) {
    if (createdUserId) {
      try {
        const serviceClient = createServiceClient()
        await serviceClient.auth.admin.deleteUser(createdUserId)
      } catch {
        // Evita ocultar el error original si falla la limpieza.
      }
    }

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
