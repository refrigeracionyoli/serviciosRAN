import { getCorsHeaders, handleCors } from '../_shared/cors.ts'
import { requireRole } from '../_shared/auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'npm:aws4fetch'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const R2_ACCOUNT_ID_REGEX = /^[a-f0-9]{32}$/i

interface ServicioDeleteResult {
  servicio_id: number
  evidencias_count: number
  refacciones_count: number
  cierres_count: number
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Response(`Falta secret ${name} en Edge Functions`, { status: 500 })
  return value
}

function createUserScopedSupabase(token: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Response('Falta configuracion SUPABASE_URL o SUPABASE_ANON_KEY', { status: 500 })
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

async function getServicioEvidencias(servicioId: number, token: string) {
  const supabase = createUserScopedSupabase(token)
  const { data, error } = await supabase
    .from('evidencias')
    .select('id, r2_key')
    .eq('servicio_id', servicioId)

  if (error) {
    throw new Response(`No se pudieron cargar evidencias del servicio: ${error.message}`, { status: 500 })
  }

  return data ?? []
}

async function deleteFromR2(r2Key: string): Promise<void> {
  const accountId = getRequiredEnv('R2_ACCOUNT_ID').toLowerCase()
  if (!R2_ACCOUNT_ID_REGEX.test(accountId)) {
    throw new Response('R2_ACCOUNT_ID invalido', { status: 500 })
  }

  const accessKeyId = getRequiredEnv('R2_ACCESS_KEY_ID')
  const secretAccessKey = getRequiredEnv('R2_SECRET_ACCESS_KEY')
  const bucketName = (Deno.env.get('R2_BUCKET_NAME') ?? 'ran-evidencias').trim()

  const aws = new AwsClient({
    accessKeyId,
    secretAccessKey,
    region: 'auto',
    service: 's3',
  })

  const r2Url = `https://${accountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}`
  const deleteResponse = await aws.fetch(r2Url, { method: 'DELETE' })

  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    const errorText = await deleteResponse.text()
    throw new Response(`Error al eliminar en R2 (${deleteResponse.status}): ${errorText}`, {
      status: 500,
    })
  }
}

async function deleteServicioInDatabase(
  servicioId: number,
  token: string,
  dryRun: boolean,
): Promise<ServicioDeleteResult> {
  const supabase = createUserScopedSupabase(token)
  const { data, error } = await supabase
    .rpc('delete_servicio_completo', { p_servicio_id: servicioId, p_dry_run: dryRun })
    .single()

  if (error) {
    throw new Response(`No se pudo eliminar el servicio en la base de datos: ${error.message}`, { status: 500 })
  }

  return data as ServicioDeleteResult
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse
  const corsHeaders = getCorsHeaders(req)

  try {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders })
    }

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    await requireRole(req, 'admin')

    const payload = await req.json()
    const servicioId = Number(payload?.servicioId)

    if (!Number.isInteger(servicioId) || servicioId <= 0) {
      return new Response(JSON.stringify({ error: 'servicioId es requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const evidencias = await getServicioEvidencias(servicioId, token)
    await deleteServicioInDatabase(servicioId, token, true)

    for (const evidencia of evidencias) {
      await deleteFromR2(evidencia.r2_key)
    }

    const deleted = await deleteServicioInDatabase(servicioId, token, false)

    return new Response(JSON.stringify({
      success: true,
      servicioId,
      evidenciasDeleted: deleted.evidencias_count,
      refaccionesDeleted: deleted.refacciones_count,
      cierresDeleted: deleted.cierres_count,
      r2Deleted: evidencias.length,
    }), {
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
