// @ts-nocheck
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { requireAnyRole, type AppRole } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PutObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3'
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
}

const R2_ACCOUNT_ID_REGEX = /^[a-f0-9]{32}$/i

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) {
    throw new Response(`Falta secret ${name} en Edge Functions`, { status: 500 })
  }
  return value
}

function normalizeR2AccountId(accountId: string): string {
  if (!R2_ACCOUNT_ID_REGEX.test(accountId)) {
    throw new Response(
      'R2_ACCOUNT_ID invalido. Debe ser tu Cloudflare Account ID de 32 caracteres hexadecimales.',
      { status: 500 },
    )
  }

  return accountId.toLowerCase()
}

function getR2Config(): R2Config {
  return {
    accountId: normalizeR2AccountId(getRequiredEnv('R2_ACCOUNT_ID')),
    accessKeyId: getRequiredEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: getRequiredEnv('R2_SECRET_ACCESS_KEY'),
    bucketName: (Deno.env.get('R2_BUCKET_NAME') ?? 'ran-evidencias').trim(),
  }
}

function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

function extractBearerToken(req: Request): string {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (!token) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return token
}

function createUserScopedSupabase(token: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Response('Falta configuracion SUPABASE_URL o SUPABASE_ANON_KEY', { status: 500 })
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/\.+/g, '.')
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
    if (role === 'tecnico') {
      throw new Response('No tienes permisos para cargar evidencia de este servicio', { status: 403 })
    }
    throw new Response('Servicio no encontrado', { status: 404 })
  }
  if (role === 'tecnico' && servicio.tecnico_id !== userId) {
    throw new Response('No tienes permisos para cargar evidencia de este servicio', { status: 403 })
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const token = extractBearerToken(req)
    const { userId, role } = await requireAnyRole(req, ['admin', 'tecnico'])

    const payload = await req.json()
    const servicioId = Number(payload?.servicioId)
    const filename = typeof payload?.filename === 'string' ? payload.filename.trim() : ''
    const contentType =
      typeof payload?.contentType === 'string' && payload.contentType.length > 0
        ? payload.contentType
        : 'image/jpeg'

    if (!Number.isInteger(servicioId) || servicioId <= 0 || filename.length === 0) {
      return new Response(JSON.stringify({ error: 'servicioId y filename son requeridos' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!contentType.startsWith('image/')) {
      return new Response(JSON.stringify({ error: 'Solo se permiten imágenes' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await ensureServicioAccess(servicioId, token, userId, role)

    const r2Config = getR2Config()
    const r2Client = createR2Client(r2Config)

    const safeFilename = sanitizeFilename(filename)
    const r2Key = `evidencias/${userId}/${servicioId}/${Date.now()}-${safeFilename}`

    const command = new PutObjectCommand({
      Bucket: r2Config.bucketName,
      Key: r2Key,
      ContentType: contentType,
    })

    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 60 * 15 })

    return new Response(JSON.stringify({ uploadUrl, r2Key }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    if (err instanceof Response) {
      const message = await err.text()
      return new Response(message, {
        status: err.status,
        headers: {
          ...corsHeaders,
          'Content-Type': err.headers.get('Content-Type') ?? 'text/plain',
        },
      })
    }

    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

