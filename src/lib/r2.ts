import { supabase } from './supabase'

type R2FunctionName = 'r2-presigned-put' | 'r2-presigned-get' | 'r2-delete'

interface NormalizedInvokeError {
  status?: number
  message: string
  detail: string
}

async function normalizeInvokeError(error: unknown): Promise<NormalizedInvokeError> {
  let message = 'Error desconocido al invocar Edge Function'
  let detail = ''
  let status: number | undefined

  if (error instanceof Error) {
    message = error.message
  }

  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      status = context.status
      try {
        detail = await context.text()
      } catch {
        detail = ''
      }
    }
  }

  return {
    status,
    message,
    detail: detail.trim().length > 0 ? detail : message,
  }
}

function isAuthLikeFailure(error: NormalizedInvokeError): boolean {
  if (error.status === 401 || error.status === 403) {
    return true
  }

  const text = `${error.message} ${error.detail}`.toLowerCase()
  return (
    text.includes('jwt') ||
    text.includes('unauthorized') ||
    text.includes('forbidden') ||
    text.includes('expired') ||
    text.includes('auth')
  )
}

async function invokeFunctionWithAuthRetry<T>(
  functionName: R2FunctionName,
  body: Record<string, unknown>,
): Promise<T> {
  const invoke = () =>
    supabase.functions.invoke<T>(functionName, {
      body,
    })

  let { data, error } = await invoke()

  if (!error && data != null) {
    return data
  }

  let normalized = await normalizeInvokeError(error)

  if (isAuthLikeFailure(normalized)) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
    if (!refreshError && refreshed.session) {
      ;({ data, error } = await invoke())
      if (!error && data != null) {
        return data
      }
      normalized = await normalizeInvokeError(error)
    }
  }

  if (normalized.status === 404) {
    throw new Error(getFunctionErrorMessage(functionName, normalized.detail))
  }

  if (isAuthLikeFailure(normalized)) {
    throw new Error(`Tu sesión no es válida o expiró. Detalle: ${normalized.detail}`)
  }

  throw new Error(`Error al invocar ${functionName}: ${normalized.detail}`)
}

function getFunctionErrorMessage(functionName: string, responseText?: string): string {
  const base = `La Edge Function "${functionName}" no está disponible en este proyecto de Supabase.`
  const deployHint = 'Despliega las funciones de R2 en Supabase (r2-upload, r2-presigned-get y r2-delete) y verifica los secrets de R2.'

  if (responseText && responseText.trim().length > 0) {
    return `${base} ${deployHint} Detalle: ${responseText}`
  }

  return `${base} ${deployHint}`
}

/**
 * Sube un archivo de evidencia a Cloudflare R2 a través de la Edge Function r2-upload.
 * La subida ocurre server-side — el browser nunca contacta R2 directamente (sin CORS).
 */
export async function uploadEvidencia(
  servicioId: number,
  file: File,
): Promise<{ r2Key: string }> {
  const getValidSession = async () => {
    let { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      session = refreshed.session
    }
    if (!session) throw new Error('No hay sesión activa para subir evidencias')
    return session
  }

  const session = await getValidSession()
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const uploadUrl = `${supabaseUrl}/functions/v1/r2-upload?servicioId=${servicioId}&filename=${encodeURIComponent(file.name)}`

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': file.type,
    },
    body: file,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Error al subir evidencia (${response.status}): ${text}`)
  }

  return response.json() as Promise<{ r2Key: string }>
}

/**
 * Solicita una presigned GET URL para ver una imagen desde Cloudflare R2.
 * La URL expira en 1 hora.
 * Solo puede llamarse con sesión de admin válida.
 */
export async function getPresignedGetUrl(r2Key: string): Promise<{ downloadUrl: string }> {
  try {
    return await invokeFunctionWithAuthRetry<{ downloadUrl: string }>('r2-presigned-get', {
      r2Key,
    })
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(getFunctionErrorMessage('r2-presigned-get'))
  }
}

/**
 * Elimina una evidencia en R2 y su registro en DB desde la Edge Function.
 * Solo admin puede ejecutar esta operación.
 */
export async function deleteEvidencia(evidenciaId: number): Promise<{ success: boolean; evidenciaId: number }> {
  try {
    return await invokeFunctionWithAuthRetry<{ success: boolean; evidenciaId: number }>('r2-delete', {
      evidenciaId,
    })
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(getFunctionErrorMessage('r2-delete'))
  }
}
