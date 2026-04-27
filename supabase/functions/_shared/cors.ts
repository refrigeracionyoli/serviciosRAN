const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)

const baseCorsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  ...(allowedOrigins.length > 0 ? { Vary: 'Origin' } : {}),
}

function resolveOrigin(req: Request): string | null {
  if (allowedOrigins.length === 0) return '*'

  const requestOrigin = req.headers.get('origin')
  if (!requestOrigin) return null

  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null
}

function buildCorsHeaders(origin: string | null): HeadersInit {
  return {
    ...baseCorsHeaders,
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  }
}

export function getCorsHeaders(req: Request): HeadersInit {
  return buildCorsHeaders(resolveOrigin(req))
}

export function handleCors(req: Request): Response | null {
  const origin = resolveOrigin(req)
  if (allowedOrigins.length > 0 && req.method !== 'OPTIONS') {
    const hasOriginHeader = req.headers.has('origin')
    if (hasOriginHeader && origin === null) {
      return new Response('Forbidden origin', {
        status: 403,
        headers: buildCorsHeaders(null),
      })
    }
  }

  if (req.method === 'OPTIONS') {
    if (origin === null) {
      return new Response('Forbidden origin', {
        status: 403,
        headers: buildCorsHeaders(null),
      })
    }

    return new Response('ok', {
      headers: buildCorsHeaders(origin),
    })
  }
  return null
}
