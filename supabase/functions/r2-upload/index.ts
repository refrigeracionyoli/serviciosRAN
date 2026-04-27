import { getCorsHeaders, handleCors } from '../_shared/cors.ts'
import { requireAnyRole, type AppRole } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const R2_ACCOUNT_ID_REGEX = /^[a-f0-9]{32}$/i

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Response(`Falta secret ${name} en Edge Functions`, { status: 500 })
  return value
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/\.+/g, '.')
}

function createUserScopedSupabase(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function ensureServicioAccess(
  servicioId: number,
  token: string,
  userId: string,
  role: AppRole,
): Promise<void> {
  const supabase = createUserScopedSupabase(token)
  const { data: servicio, error } = await supabase
    .from('servicios')
    .select('tecnico_id')
    .eq('id', servicioId)
    .maybeSingle()

  if (error) throw new Response('No se pudo validar el servicio', { status: 500 })
  if (!servicio) {
    throw new Response(
      role === 'tecnico' ? 'No tienes permisos para este servicio' : 'Servicio no encontrado',
      { status: role === 'tecnico' ? 403 : 404 },
    )
  }
  if (role === 'tecnico' && servicio.tecnico_id !== userId) {
    throw new Response('No tienes permisos para cargar evidencia de este servicio', { status: 403 })
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  const corsHeaders = getCorsHeaders(req)

  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const { userId, role } = await requireAnyRole(req, ['admin', 'tecnico'])

    const url = new URL(req.url)
    const servicioId = Number(url.searchParams.get('servicioId'))
    const filename = decodeURIComponent(url.searchParams.get('filename') ?? '')
    const contentType = req.headers.get('Content-Type') ?? 'image/jpeg'

    if (!Number.isInteger(servicioId) || servicioId <= 0 || filename.length === 0) {
      return new Response(
        JSON.stringify({ error: 'servicioId y filename son requeridos' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    await ensureServicioAccess(servicioId, token, userId, role)

    const fileBuffer = await req.arrayBuffer()
    if (fileBuffer.byteLength === 0) {
      return new Response(
        JSON.stringify({ error: 'El archivo está vacío' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const accountId = getRequiredEnv('R2_ACCOUNT_ID').toLowerCase()
    if (!R2_ACCOUNT_ID_REGEX.test(accountId)) {
      throw new Response('R2_ACCOUNT_ID invalido', { status: 500 })
    }
    const accessKeyId = getRequiredEnv('R2_ACCESS_KEY_ID')
    const secretAccessKey = getRequiredEnv('R2_SECRET_ACCESS_KEY')
    const bucketName = (Deno.env.get('R2_BUCKET_NAME') ?? 'ran-evidencias').trim()

    const safeFilename = sanitizeFilename(filename)
    const tipo = filename.startsWith('orden-servicio__') ? 'orden_servicio' : 'evidencias'
    const r2Key = `${servicioId}/${tipo}/${Date.now()}-${safeFilename}`

    const aws = new AwsClient({
      accessKeyId,
      secretAccessKey,
      region: 'auto',
      service: 's3',
    })

    const r2Url = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}`

    const uploadResponse = await aws.fetch(r2Url, {
      method: 'PUT',
      body: new Uint8Array(fileBuffer),
      headers: { 'Content-Type': contentType },
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      throw new Response(`Error al subir a R2 (${uploadResponse.status}): ${errorText}`, { status: 500 })
    }

    return new Response(JSON.stringify({ r2Key }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof Response) {
      const message = await err.text()
      return new Response(message, {
        status: err.status,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
      })
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
