import { supabase } from './supabase'
import { getFreshAccessToken } from './edge-auth'

type R2FunctionName = 'r2-presigned-put' | 'r2-presigned-get' | 'r2-delete'
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
const EDGE_AUTH_COOLDOWN_MS = 8_000
let edgeAuthFailureUntil = 0

interface NormalizedInvokeError {
  status?: number
  message: string
  detail: string
}

function isAuthLikeFailure(error: NormalizedInvokeError): boolean {
  if (error.status === 401) {
    return true
  }

  const text = `${error.message} ${error.detail}`.toLowerCase()
  return (
    text.includes('jwt') ||
    text.includes('unauthorized') ||
    text.includes('expired') ||
    text.includes('auth')
  )
}

async function getSessionAccessToken(): Promise<string> {
  return getFreshAccessToken()
}

async function refreshSessionAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.refreshSession()
  if (error || !data.session?.access_token) {
    throw error ?? new Error('No se pudo refrescar la sesión.')
  }
  return data.session.access_token
}

async function callEdgeFunction<T>(
  functionName: R2FunctionName,
  body: Record<string, unknown>,
  accessToken: string,
  signal?: AbortSignal,
): Promise<{ data?: T; error?: NormalizedInvokeError }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).trim()
    } catch {
      detail = ''
    }

    return {
      error: {
        status: response.status,
        message: `Error HTTP ${response.status}`,
        detail: detail.length ? detail : `Falló la invocación de ${functionName}.`,
      },
    }
  }

  try {
    const data = (await response.json()) as T
    return { data }
  } catch {
    return {
      error: {
        status: response.status,
        message: `Respuesta inválida de ${functionName}`,
        detail: 'La función respondió sin JSON válido.',
      },
    }
  }
}

async function invokeFunctionWithAuthRetry<T>(
  functionName: R2FunctionName,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (Date.now() < edgeAuthFailureUntil) {
    throw new Error('Tu sesión no pudo validarse con el servidor. Cierra sesión e inicia nuevamente.')
  }

  let accessToken = await getSessionAccessToken()
  const { data, error } = await callEdgeFunction<T>(functionName, body, accessToken, signal)

  if (!error && data != null) {
    edgeAuthFailureUntil = 0
    return data
  }

  const normalized = error ?? {
    message: `Falló la invocación de ${functionName}`,
    detail: `No se recibió respuesta válida de ${functionName}.`,
  }

  if (normalized.status === 404) {
    throw new Error(getFunctionErrorMessage(functionName, normalized.detail))
  }

  if (isAuthLikeFailure(normalized)) {
    accessToken = await refreshSessionAccessToken()
    const retry = await callEdgeFunction<T>(functionName, body, accessToken, signal)
    if (!retry.error && retry.data != null) {
      edgeAuthFailureUntil = 0
      return retry.data
    }

    const retryNormalized = retry.error ?? {
      message: `Falló la invocación de ${functionName}`,
      detail: `No se recibió respuesta válida de ${functionName}.`,
    }

    if (isAuthLikeFailure(retryNormalized)) {
      edgeAuthFailureUntil = Date.now() + EDGE_AUTH_COOLDOWN_MS
      throw new Error('No se pudo validar tu sesión para procesar archivos de evidencia. Cierra sesión e inicia nuevamente.')
    }

    if (retryNormalized.status === 404) {
      throw new Error(getFunctionErrorMessage(functionName, retryNormalized.detail))
    }

    throw new Error(`Error al invocar ${functionName}: ${retryNormalized.detail}`)
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
  const accessToken = await getSessionAccessToken()
  const uploadUrl = `${supabaseUrl}/functions/v1/r2-upload?servicioId=${servicioId}&filename=${encodeURIComponent(file.name)}`

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
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
export async function getPresignedGetUrl(
  r2Key: string,
  options?: { signal?: AbortSignal },
): Promise<{ downloadUrl: string }> {
  try {
    return await invokeFunctionWithAuthRetry<{ downloadUrl: string }>('r2-presigned-get', {
      r2Key,
    }, options?.signal)
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error(getFunctionErrorMessage('r2-presigned-get'))
  }
}

/**
 * Elimina una evidencia en R2 y su registro en DB desde la Edge Function.
 * Admin puede eliminar cualquiera; técnico solo evidencias de servicios asignados.
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
