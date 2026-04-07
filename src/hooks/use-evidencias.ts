import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import imageCompression from 'browser-image-compression'
import { supabase } from '@/lib/supabase'
import { uploadEvidencia, getPresignedGetUrl, deleteEvidencia } from '@/lib/r2'
import type { Evidencia } from '@/types/domain.types'

interface PerfilCompresion {
  objetivoMB: number
  maxLadoPx: number
  calidadInicial: number
  calidadMinima: number
  limiteSuaveBytes: number
}

const PERFIL_EVIDENCIA: PerfilCompresion = {
  objetivoMB: 0.45,
  maxLadoPx: 1400,
  calidadInicial: 0.62,
  calidadMinima: 0.45,
  limiteSuaveBytes: 420 * 1024,
}

const PERFIL_ORDEN_SERVICIO: PerfilCompresion = {
  objetivoMB: 0.3,
  maxLadoPx: 1280,
  calidadInicial: 0.6,
  calidadMinima: 0.42,
  limiteSuaveBytes: 300 * 1024,
}

function isOrdenServicioUpload(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

function buildCompressedFile(blob: Blob, originalName: string): File {
  return new File([blob], originalName, { type: blob.type || 'image/jpeg' })
}

async function comprimirParaR2(file: File, esOrdenServicio: boolean): Promise<File> {
  const perfil = esOrdenServicio ? PERFIL_ORDEN_SERVICIO : PERFIL_EVIDENCIA

  try {
    const primeraPasada = await imageCompression(file, {
      maxSizeMB: perfil.objetivoMB,
      maxWidthOrHeight: perfil.maxLadoPx,
      initialQuality: perfil.calidadInicial,
      fileType: 'image/jpeg',
      useWebWorker: true,
      maxIteration: 15,
    })

    let candidato = buildCompressedFile(primeraPasada, file.name)

    // Segunda pasada opcional para exprimir más espacio cuando sigue pesado.
    if (candidato.size > perfil.limiteSuaveBytes) {
      const segundaPasada = await imageCompression(candidato, {
        maxSizeMB: Math.max(perfil.objetivoMB * 0.75, 0.2),
        maxWidthOrHeight: Math.max(perfil.maxLadoPx - 180, 960),
        initialQuality: Math.max(perfil.calidadInicial - 0.14, perfil.calidadMinima),
        fileType: 'image/jpeg',
        useWebWorker: true,
        maxIteration: 20,
      })

      const masCompacta = buildCompressedFile(segundaPasada, file.name)
      if (masCompacta.size < candidato.size) {
        candidato = masCompacta
      }
    }

    return candidato.size < file.size ? candidato : file
  } catch {
    // Si falla la compresión por formato no soportado, subimos original para no romper flujo.
    return file
  }
}

export const evidenciasKeys = {
  all: ['evidencias'] as const,
  byServicio: (servicioId: number) => ['evidencias', 'servicio', servicioId] as const,
}

export function useEvidenciasQuery(servicioId: number, enabled = true) {
  return useQuery({
    queryKey: evidenciasKeys.byServicio(servicioId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('evidencias')
        .select('*')
        .eq('servicio_id', servicioId)
        .order('orden')
      if (error) throw error
      return data as Evidencia[]
    },
    enabled: enabled && servicioId > 0,
  })
}

/** Sube un archivo de evidencia: comprime → Edge Function → R2 → registra en DB */
export function useSubirEvidenciaMutation(servicioId: number) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const getUserId = async (): Promise<string> => {
        const { data, error } = await supabase.auth.getUser()
        if (error || !data.user) throw new Error('No hay sesión activa')
        return data.user.id
      }

      let userId: string
      try {
        userId = await getUserId()
      } catch {
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()
        if (refreshError || !refreshed.session) {
          throw new Error('No hay sesión activa para registrar la evidencia')
        }
        userId = await getUserId()
      }

      // 1. Comprimir imagen
      const uploadFile = await comprimirParaR2(file, isOrdenServicioUpload(file.name))

      // 2. Subir a R2 vía Edge Function (sin CORS)
      const { r2Key } = await uploadEvidencia(servicioId, uploadFile)

      // 3. Registrar en DB
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('evidencias') as any)
        .insert({
          servicio_id: servicioId,
          r2_key: r2Key,
          r2_bucket: 'ran-evidencias',
          filename: file.name,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
          orden: 1,
          subida_por: userId,
        })
        .select()
        .single()

      if (error) throw new Error(`Error al registrar evidencia: ${error.message}`)
      if (!data) throw new Error('Error al registrar evidencia: respuesta vacía')

      return data as Evidencia
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evidenciasKeys.byServicio(servicioId) })
    },
  })
}

/** Elimina una evidencia del servicio */
export function useEliminarEvidenciaMutation(servicioId: number) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (evidenciaId: number) => {
      await deleteEvidencia(evidenciaId)

      return evidenciaId
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evidenciasKeys.byServicio(servicioId) })
    },
  })
}

/** Obtiene presigned GET URL para una evidencia */
export function useEvidenciaUrlQuery(r2Key: string | null) {
  return useQuery({
    queryKey: ['evidencias', 'url', r2Key],
    queryFn: () => getPresignedGetUrl(r2Key!),
    enabled: !!r2Key,
    staleTime: 1000 * 60 * 50,
    gcTime: 1000 * 60 * 55,
  })
}
