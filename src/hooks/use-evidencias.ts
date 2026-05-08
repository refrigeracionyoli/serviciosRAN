import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import imageCompression from 'browser-image-compression'
import { supabase } from '@/lib/supabase'
import { deleteEvidencia, getPresignedGetUrl } from '@/lib/r2'
import { useAuth } from '@/hooks/use-auth'
import {
  deleteCommand,
  hasBlockingRemoteFetchCommands,
  queueServiceAddEvidenciaCommand,
  queueServiceDeleteEvidenciaCommand,
} from '@/lib/offline/commands'
import {
  getCachedEvidenciasByServicio,
  getCachedServicioDetalleSnapshot,
  isLocalNumberId,
  getLocalAttachmentUrl,
  removeCachedEvidencia,
  removePendingLocalEvidencia,
  replaceCachedEvidenciasForServicio,
} from '@/lib/offline/cache'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { getCurrentSessionUser } from '@/lib/offline/session'
import { settleQueuedCommand } from '@/lib/offline/sync-engine'
import type { Evidencia, ServicioStatus } from '@/types/domain.types'

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

export interface QueuedEvidenceResult {
  commandId: string
  syncStatus: 'pending' | 'synced' | 'failed' | 'conflict'
  ownerId: string
}

interface DeleteEvidenciaContext {
  previousEvidencias?: Evidencia[]
}

export interface EvidenciaMutationOptions {
  allowClosedServiceChanges?: boolean
}

export function canChangeEvidenciasForServicioStatus(
  status: ServicioStatus | null | undefined,
  options: EvidenciaMutationOptions = {},
): boolean {
  return status !== 'cerrado' || options.allowClosedServiceChanges === true
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
    return file
  }
}

export const evidenciasKeys = {
  all: ['evidencias'] as const,
  byServicio: (servicioId: number) => ['evidencias', 'servicio', servicioId] as const,
}

async function hydrateEvidenciasQueryCache(ownerId: string, servicioId: number, queryClient: QueryClient) {
  queryClient.setQueryData(
    evidenciasKeys.byServicio(servicioId),
    await getCachedEvidenciasByServicio(ownerId, servicioId),
  )
}

async function doesRemoteEvidenceExist(evidenciaId: number): Promise<boolean | null> {
  const { data, error } = await supabase
    .from('evidencias')
    .select('id')
    .eq('id', evidenciaId)
    .maybeSingle()

  if (error) {
    if (isLikelyNetworkError(error)) {
      return null
    }

    throw new Error(`No se pudo validar la eliminación de la evidencia: ${error.message}`)
  }

  return Boolean(data)
}

async function assertServicioAllowsEvidenceChanges(
  ownerId: string,
  servicioId: number,
  options: EvidenciaMutationOptions = {},
) {
  const servicio = await getCachedServicioDetalleSnapshot(ownerId, servicioId)
  if (!canChangeEvidenciasForServicioStatus(servicio?.status, options)) {
    throw new Error('Este servicio ya fue cerrado y sus evidencias quedaron bloqueadas.')
  }
}

export function useEvidenciasQuery(servicioId: number, enabled = true) {
  return useQuery({
    queryKey: evidenciasKeys.byServicio(servicioId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    queryFn: async () => {
      const currentUser = await getCurrentSessionUser()
      if (!currentUser) return []

      const shouldUseLocalOnly = isLocalNumberId(servicioId) || await hasBlockingRemoteFetchCommands(
        currentUser.id,
        ['servicio.create', 'service.add_evidencia', 'service.delete_evidencia'],
        { entityId: servicioId },
      )

      if (shouldUseLocalOnly) {
        return getCachedEvidenciasByServicio(currentUser.id, servicioId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('evidencias')
            .select('*')
            .eq('servicio_id', servicioId)
            .order('orden')
          if (error) throw error

          await replaceCachedEvidenciasForServicio(currentUser.id, servicioId, data as Evidencia[])
          return getCachedEvidenciasByServicio(currentUser.id, servicioId)
        },
        local: () => getCachedEvidenciasByServicio(currentUser.id, servicioId),
      })
    },
    enabled: enabled && servicioId > 0,
  })
}

export function useSubirEvidenciaMutation(
  servicioId: number,
  options: EvidenciaMutationOptions = {},
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File): Promise<QueuedEvidenceResult> => {
      const currentUser = await getCurrentSessionUser()
      if (!currentUser) {
        throw new Error('No hay sesión activa para registrar la evidencia.')
      }

      if (servicioId <= 0) {
        throw new Error('Guarda primero el servicio antes de cargar evidencias.')
      }

      await assertServicioAllowsEvidenceChanges(currentUser.id, servicioId, options)

      const uploadFile = await comprimirParaR2(file, isOrdenServicioUpload(file.name))
      const command = await queueServiceAddEvidenciaCommand(currentUser.id, {
        serviceId: servicioId,
        file: uploadFile,
        subidaPor: currentUser.id,
      })

      const syncStatus: QueuedEvidenceResult['syncStatus'] = isBrowserOnline()
        ? await settleQueuedCommand(command.id)
        : 'pending'

      return {
        commandId: command.id,
        syncStatus,
        ownerId: currentUser.id,
      }
    },
    onSuccess: async (result) => {
      await hydrateEvidenciasQueryCache(result.ownerId, servicioId, queryClient)
    },
  })
}

export function useEliminarEvidenciaMutation(
  servicioId: number,
  options: EvidenciaMutationOptions = {},
) {
  const queryClient = useQueryClient()
  const { user, perfil } = useAuth()

  return useMutation({
    onMutate: async (evidenciaId): Promise<DeleteEvidenciaContext> => {
      await queryClient.cancelQueries({ queryKey: evidenciasKeys.byServicio(servicioId) })

      const previousEvidencias = queryClient.getQueryData<Evidencia[]>(evidenciasKeys.byServicio(servicioId))

      queryClient.setQueryData<Evidencia[]>(
        evidenciasKeys.byServicio(servicioId),
        (current = []) => current.filter((evidencia) => evidencia.id !== evidenciaId),
      )

      return { previousEvidencias }
    },
    mutationFn: async (evidenciaId: number) => {
      if (!user?.id) {
        throw new Error('No hay sesión activa para eliminar la evidencia.')
      }

      await assertServicioAllowsEvidenceChanges(user.id, servicioId, options)

      if (evidenciaId < 0) {
        const commandId = await removePendingLocalEvidencia(user.id, evidenciaId)
        if (commandId) {
          await deleteCommand(commandId)
        }
        return evidenciaId
      }

      if (isBrowserOnline()) {
        try {
          await deleteEvidencia(evidenciaId)

          const stillExists = await doesRemoteEvidenceExist(evidenciaId)
          if (stillExists) {
            const { error: directDeleteError } = await supabase
              .from('evidencias')
              .delete()
              .eq('id', evidenciaId)

            if (directDeleteError && !isLikelyNetworkError(directDeleteError)) {
              throw new Error(`No se pudo eliminar el registro de la evidencia: ${directDeleteError.message}`)
            }

            const existsAfterFallback = await doesRemoteEvidenceExist(evidenciaId)
            if (existsAfterFallback) {
              throw new Error(
                perfil?.role === 'tecnico'
                  ? 'La imagen se eliminó del almacenamiento, pero el registro sigue existiendo en la base de datos. Aplica la migración 018_tecnico_delete_evidencias.sql o despliega la Edge Function r2-delete actualizada.'
                  : 'La imagen se eliminó del almacenamiento, pero el registro sigue existiendo en la base de datos.',
              )
            }
          }

          return evidenciaId
        } catch (error) {
          if (error instanceof Error) {
            const text = error.message.toLowerCase()
            if (text.includes('404') || text.includes('no encontrada') || text.includes('not found')) {
              return evidenciaId
            }
          }

          if (!isLikelyNetworkError(error)) throw error
        }
      }

      await queueServiceDeleteEvidenciaCommand(user.id, {
        serviceId: servicioId,
        evidenciaId,
      })
      return evidenciaId
    },
    onError: (_error, _evidenciaId, context) => {
      if (context?.previousEvidencias) {
        queryClient.setQueryData(evidenciasKeys.byServicio(servicioId), context.previousEvidencias)
      }
    },
    onSuccess: async (deletedEvidenceId) => {
      if (user?.id) {
        if (deletedEvidenceId > 0) {
          await removeCachedEvidencia(user.id, deletedEvidenceId)
        }
        await hydrateEvidenciasQueryCache(user.id, servicioId, queryClient)
      }
    },
  })
}

export function useEvidenciaUrlQuery(r2Key: string | null) {
  const { isAuthenticated, user } = useAuth()

  return useQuery({
    queryKey: ['evidencias', 'url', user?.id ?? null, r2Key],
    queryFn: async () => {
      if (!user?.id) {
        return { downloadUrl: '' }
      }

      const localUrl = await getLocalAttachmentUrl(user.id, r2Key)
      if (localUrl) {
        return { downloadUrl: localUrl }
      }

      if (!isBrowserOnline()) {
        return { downloadUrl: '' }
      }

      try {
        return await getPresignedGetUrl(r2Key!)
      } catch (error) {
        if (isLikelyNetworkError(error)) {
          return { downloadUrl: '' }
        }
        throw error
      }
    },
    enabled: Boolean(r2Key) && (isAuthenticated || Boolean(user?.id)),
    staleTime: 1000 * 60 * 50,
    gcTime: 1000 * 60 * 55,
    retry: false,
  })
}
