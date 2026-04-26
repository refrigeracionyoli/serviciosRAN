import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import { findRemoteCierreByServicioId, queueServicioClose } from '@/lib/offline/servicios-actions'
import { isBrowserOnline, isLikelyNetworkError, isLikelyUniqueViolation } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import {
  getCachedCierreByServicioSnapshot,
  getCachedCierresSnapshot,
  getCachedEvidenciasByServicio,
  getCachedServicioDetalleSnapshot,
  isLocalNumberId,
  replaceCachedEvidenciasForServicio,
  upsertCachedCierres,
} from '@/lib/offline/cache'
import { buildServicioCompletionRequirementMessage, summarizeServicioEvidencias } from '@/lib/tecnico/servicio-evidencias'
import { formatLocalIsoDate } from '@/lib/utils'
import type { Cierre, Evidencia, Servicio } from '@/types/domain.types'
import type { CierreInput } from '@/schemas/cliente.schema'
import { serviciosKeys } from './use-servicios'

export const cierresKeys = {
  all: ['cierres'] as const,
  catalog: () => ['cierres', 'catalogo'] as const,
  byServicio: (servicioId: number) => ['cierres', 'servicio', servicioId] as const,
}

async function getServicioEvidenciasForCloseValidation(ownerId: string, servicioId: number) {
  const shouldUseLocalOnly = isLocalNumberId(servicioId) || await hasBlockingRemoteFetchCommands(
    ownerId,
    ['service.add_evidencia', 'service.delete_evidencia'],
    { entityId: servicioId },
  )

  if (shouldUseLocalOnly) {
    return getCachedEvidenciasByServicio(ownerId, servicioId)
  }

  return withOfflineFallback({
    remote: async () => {
      const { data, error } = await supabase
        .from('evidencias')
        .select('*')
        .eq('servicio_id', servicioId)
        .order('orden')

      if (error) throw error

      await replaceCachedEvidenciasForServicio(ownerId, servicioId, (data ?? []) as Evidencia[])
      return getCachedEvidenciasByServicio(ownerId, servicioId)
    },
    local: () => getCachedEvidenciasByServicio(ownerId, servicioId),
  })
}

async function assertServicioCanBeClosed(ownerId: string, servicioId: number) {
  const evidencias = await getServicioEvidenciasForCloseValidation(ownerId, servicioId)
  const summary = summarizeServicioEvidencias(evidencias)

  if (summary.puedeCompletar) {
    return
  }

  throw new Error(`No se puede cerrar el servicio. ${buildServicioCompletionRequirementMessage(summary)}`)
}

function calculateServicioTotal(servicio: Pick<Servicio, 'costo_mano_obra' | 'costo_refacciones' | 'total'>): number {
  const calculated = Number(servicio.costo_mano_obra ?? 0) + Number(servicio.costo_refacciones ?? 0)
  if (Number.isFinite(calculated)) return calculated

  const fallback = Number(servicio.total ?? 0)
  return Number.isFinite(fallback) ? fallback : 0
}

function getFechaCierreForServicio(data: CierreInput): string {
  return data.fecha_cierre ?? formatLocalIsoDate(new Date())
}

function toCierreInsertInput(data: CierreInput): Omit<CierreInput, 'fecha_cierre'> {
  const { fecha_cierre: _fechaCierre, ...cierreInput } = data
  return cierreInput
}

async function getServicioTotalForCierre(ownerId: string, servicioId: number): Promise<number | null> {
  const cached = await getCachedServicioDetalleSnapshot(ownerId, servicioId)

  if (isLocalNumberId(servicioId) || !isBrowserOnline()) {
    return cached ? calculateServicioTotal(cached) : null
  }

  try {
    const { data, error } = await supabase
      .from('servicios')
      .select('costo_mano_obra, costo_refacciones, total')
      .eq('id', servicioId)
      .single()

    if (error) throw error
    return calculateServicioTotal(data)
  } catch (error) {
    if (isLikelyNetworkError(error) && cached) {
      return calculateServicioTotal(cached)
    }

    throw error
  }
}

async function withComputedCostoTotal(
  ownerId: string,
  servicioId: number,
  data: CierreInput,
): Promise<CierreInput> {
  if (data.costo_total != null) return data

  const costoTotal = await getServicioTotalForCierre(ownerId, servicioId)
  if (costoTotal == null) return data

  return {
    ...data,
    costo_total: costoTotal,
  }
}

export function useCierreQuery(servicioId: number) {
  return useQuery({
    queryKey: cierresKeys.byServicio(servicioId),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return null

      const shouldUseLocalOnly = isLocalNumberId(servicioId) || await hasBlockingRemoteFetchCommands(
        ownerId,
        ['servicio.close'],
        { entityId: servicioId },
      )

      if (shouldUseLocalOnly) {
        return getCachedCierreByServicioSnapshot(ownerId, servicioId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('cierres')
            .select('*, tecnico:profiles(id, nombre)')
            .eq('servicio_id', servicioId)
            .maybeSingle()
          if (error) throw error

          if (data) {
            await upsertCachedCierres(ownerId, [data as Cierre])
          }

          return getCachedCierreByServicioSnapshot(ownerId, servicioId)
        },
        local: () => getCachedCierreByServicioSnapshot(ownerId, servicioId),
      })
    },
  })
}

export function useCierresCatalogoQuery() {
  return useQuery({
    queryKey: cierresKeys.catalog(),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(ownerId, ['servicio.close'])
      if (shouldUseLocalOnly) {
        return getCachedCierresSnapshot(ownerId)
      }

      return withOfflineFallback({
        remote: async () => {
          const { data, error } = await supabase
            .from('cierres')
            .select('id, servicio_id, aviso, parte_objeto, causa, descripcion, costo_total, tecnico_id, firma_receptor, created_at')
            .order('created_at', { ascending: false })
            .limit(1000)

          if (error) throw error

          await upsertCachedCierres(ownerId, data)
          return getCachedCierresSnapshot(ownerId)
        },
        local: () => getCachedCierresSnapshot(ownerId),
      })
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useCerrarServicioMutation(servicioId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CierreInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para cerrar el servicio.')
      }

      await assertServicioCanBeClosed(ownerId, servicioId)
      const cierreInput = await withComputedCostoTotal(ownerId, servicioId, data)

      if (isBrowserOnline() && !isLocalNumberId(servicioId)) {
        const fechaCierre = getFechaCierreForServicio(cierreInput)
        try {
          const existing = await findRemoteCierreByServicioId(servicioId)
          if (existing) {
            const { error: statusError } = await supabase
              .from('servicios')
              .update({
                status: 'cerrado',
                fecha_cierre: fechaCierre,
              })
              .eq('id', servicioId)
            if (statusError) throw statusError

            return existing
          }

          const { data: cierre, error: cierreError } = await supabase
            .from('cierres')
            .insert(toCierreInsertInput(cierreInput))
            .select()
            .single()
          if (cierreError) throw cierreError

          const { error: statusError } = await supabase
            .from('servicios')
            .update({
              status: 'cerrado',
              fecha_cierre: fechaCierre,
            })
            .eq('id', servicioId)
          if (statusError) throw statusError

          return cierre as Cierre
        } catch (error) {
          if (isLikelyUniqueViolation(error)) {
            const duplicated = await findRemoteCierreByServicioId(servicioId)
            if (duplicated) {
              const { error: statusError } = await supabase
                .from('servicios')
                .update({
                  status: 'cerrado',
                  fecha_cierre: fechaCierre,
                })
                .eq('id', servicioId)
              if (statusError) throw statusError

              return duplicated
            }
          }

          if (!isLikelyNetworkError(error)) throw error
        }
      }

      return queueServicioClose(ownerId, servicioId, cierreInput)
    },
    onSuccess: async (cierre) => {
      const ownerId = await getCurrentSessionUserId()
      if (ownerId) {
        await upsertCachedCierres(ownerId, [cierre])
      }
      void qc.invalidateQueries({ queryKey: serviciosKeys.detail(servicioId) })
      void qc.invalidateQueries({ queryKey: serviciosKeys.all })
      void qc.invalidateQueries({ queryKey: cierresKeys.byServicio(servicioId) })
      void qc.invalidateQueries({ queryKey: cierresKeys.catalog() })
    },
  })
}
