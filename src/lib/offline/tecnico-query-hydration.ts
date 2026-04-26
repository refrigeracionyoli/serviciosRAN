import type { QueryClient } from '@tanstack/react-query'
import { evidenciasKeys } from '@/hooks/use-evidencias'
import { inventarioKeys } from '@/hooks/use-inventario'
import { serviciosKeys } from '@/hooks/use-servicios'
import {
  getCachedEvidenciasByServicio,
  getCachedInventarioSnapshot,
  getCachedInventarioTecnicoSnapshot,
  getCachedServicioDetalleSnapshot,
  getCachedServicioRefaccionesSnapshot,
  getCachedServiciosSnapshot,
} from '@/lib/offline/cache'
import { setOfflineHydratedQueryData } from '@/lib/offline/query-cache'
import { formatLocalIsoDate } from '@/lib/utils'

export interface HydrateTecnicoOfflineQueryCacheOptions {
  fecha?: string
  tecnicoId?: string
}

export async function hydrateTecnicoOfflineQueryCache(
  ownerId: string,
  queryClient: QueryClient,
  options?: HydrateTecnicoOfflineQueryCacheOptions,
) {
  if (!ownerId) return

  const fecha = options?.fecha ?? formatLocalIsoDate(new Date())
  const tecnicoId = options?.tecnicoId ?? ownerId
  const filtrosServicios = {
    status: 'en_ruta' as const,
    tecnicoId,
    clienteId: null,
    fechaDesde: fecha,
    fechaHasta: fecha,
    tipoServicio: null,
    search: null,
  }

  const [serviciosHoy, inventarioActivo, inventarioTecnicoHoy] = await Promise.all([
    getCachedServiciosSnapshot(ownerId, filtrosServicios),
    getCachedInventarioSnapshot(ownerId, false),
    getCachedInventarioTecnicoSnapshot(ownerId, { fecha, tecnicoId }),
  ])

  setOfflineHydratedQueryData(queryClient, serviciosKeys.list(filtrosServicios), serviciosHoy)
  setOfflineHydratedQueryData(queryClient, inventarioKeys.list(false), inventarioActivo)
  setOfflineHydratedQueryData(queryClient, inventarioKeys.tecnico(fecha, tecnicoId), inventarioTecnicoHoy)

  await Promise.all(
    serviciosHoy.map(async (servicio) => {
      const [detalle, evidencias, refacciones] = await Promise.all([
        getCachedServicioDetalleSnapshot(ownerId, servicio.id),
        getCachedEvidenciasByServicio(ownerId, servicio.id),
        getCachedServicioRefaccionesSnapshot(ownerId, servicio.id),
      ])

      setOfflineHydratedQueryData(queryClient, serviciosKeys.detail(servicio.id), detalle ?? servicio)
      setOfflineHydratedQueryData(queryClient, evidenciasKeys.byServicio(servicio.id), evidencias)
      setOfflineHydratedQueryData(queryClient, serviciosKeys.refacciones(servicio.id), refacciones)
    }),
  )
}
