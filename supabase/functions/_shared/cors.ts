const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

function resolveOrigin(req: Request): string | null {
  if (allowedOrigins.length === 0) return '*'

  const requestOrigin = req.headers.get('origin')
  if (!requestOrigin) return null

  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigins.length === 1 ? allowedOrigins[0] : '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  ...(allowedOrigins.length > 0 ? { Vary: 'Origin' } : {}),
}

export function handleCors(req: Request): Response | null {
  const origin = resolveOrigin(req)
  if (allowedOrigins.length > 0 && req.method !== 'OPTIONS') {
    const hasOriginHeader = req.headers.has('origin')
    if (hasOriginHeader && origin === null) {
      return new Response('Forbidden origin', {
        status: 403,
        headers: corsHeaders,
      })
    }
  }

  if (req.method === 'OPTIONS') {
    if (origin === null) {
      return new Response('Forbidden origin', {
        status: 403,
        headers: corsHeaders,
      })
    }

    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Origin': origin,
      },
    })
  }
  return null
}
