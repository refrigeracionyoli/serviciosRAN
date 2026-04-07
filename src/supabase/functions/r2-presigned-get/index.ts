// @ts-nocheck
import { corsHeaders, handleCors } from '../_shared/cors.ts'
import { requireAnyRole, type AppRole } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { GetObjectCommand, S3Client } from 'npm:@aws-sdk/client-s3'
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

async function ensureEvidenciaAccess(r2Key: string, token: string): Promise<void> {
  const supabase = createUserScopedSupabase(token)
  const { data: evidencia, error: evidenciaError } = await supabase
    .from('evidencias')
    .select('servicio_id')
    .eq('r2_key', r2Key)
    .maybeSingle()

  if (evidenciaError) throw new Response('No se pudo validar la evidencia', { status: 500 })
  if (!evidencia) throw new Response('Evidencia no encontrada', { status: 404 })
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const token = extractBearerToken(req)
    await requireAnyRole(req, ['admin', 'tecnico'])

    const payload = await req.json()
    const r2Key = typeof payload?.r2Key === 'string' ? payload.r2Key.trim() : ''

    if (!r2Key) {
      return new Response(JSON.stringify({ error: 'r2Key es requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await ensureEvidenciaAccess(r2Key, token)

    const r2Config = getR2Config()
    const r2Client = createR2Client(r2Config)

    const command = new GetObjectCommand({
      Bucket: r2Config.bucketName,
      Key: r2Key,
    })

    const downloadUrl = await getSignedUrl(r2Client, command, { expiresIn: 60 * 60 })

    return new Response(JSON.stringify({ downloadUrl }), {
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

