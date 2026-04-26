import type { QueryClient } from '@tanstack/react-query'
import { clientesKeys } from '@/hooks/use-clientes'
import { inventarioKeys } from '@/hooks/use-inventario'
import { maquinasKeys } from '@/hooks/use-maquinas'
import { maquinasTallerKeys } from '@/hooks/use-maquinas-taller'
import { mantenimientosKeys } from '@/hooks/use-mantenimientos'
import { polizasKeys } from '@/hooks/use-polizas'
import { normalizeServiciosListFilters, serviciosKeys } from '@/hooks/use-servicios'
import { tecnicosKeys } from '@/hooks/use-tecnicos'
import {
  getCachedClientesSnapshot,
  getCachedInventarioSnapshot,
  getCachedMaquinasSnapshot,
  getCachedMaquinasTallerMovimientosSnapshot,
  getCachedMaquinasTallerSnapshot,
  getCachedMantenimientosSnapshot,
  getCachedMovimientosInventarioSnapshot,
  getCachedPolizaEstadoHistorialSnapshot,
  getCachedPolizaPausasSnapshot,
  getCachedPolizasSnapshot,
  getCachedProfilesByRole,
  getCachedServiciosSnapshot,
} from '@/lib/offline/cache'
import { setOfflineHydratedQueryData } from '@/lib/offline/query-cache'

function buildMaquinasByCliente<T extends { cliente_id?: number | null }>(
  maquinas: T[],
  clienteIds: number[],
) {
  const grouped = new Map<number, T[]>()

  for (const clienteId of clienteIds) {
    grouped.set(clienteId, [])
  }

  for (const maquina of maquinas) {
    if (typeof maquina.cliente_id !== 'number') continue

    const rows = grouped.get(maquina.cliente_id)
    if (rows) {
      rows.push(maquina)
      continue
    }

    grouped.set(maquina.cliente_id, [maquina])
  }

  return grouped
}

export async function hydrateAdminOfflineQueryCache(ownerId: string, queryClient: QueryClient) {
  if (!ownerId) return

  const [
    servicios,
    inventarioActivo,
    inventarioCompleto,
    movimientosInventario,
    polizas,
    polizasHistorial,
    polizaPausas,
    mantenimientos,
    clientesActivos,
    clientesCompletos,
    maquinasActivas,
    maquinasCompletas,
    tecnicosActivos,
    tecnicosCompletos,
    empleadosActivos,
    empleadosCompletos,
    maquinasTallerAbiertas,
    maquinasTallerTodas,
    maquinasTallerMovimientos,
  ] = await Promise.all([
    getCachedServiciosSnapshot(ownerId),
    getCachedInventarioSnapshot(ownerId, false),
    getCachedInventarioSnapshot(ownerId, true),
    getCachedMovimientosInventarioSnapshot(ownerId),
    getCachedPolizasSnapshot(ownerId),
    getCachedPolizaEstadoHistorialSnapshot(ownerId),
    getCachedPolizaPausasSnapshot(ownerId),
    getCachedMantenimientosSnapshot(ownerId),
    getCachedClientesSnapshot(ownerId, false),
    getCachedClientesSnapshot(ownerId, true),
    getCachedMaquinasSnapshot(ownerId, { includeInactive: false }),
    getCachedMaquinasSnapshot(ownerId, { includeInactive: true }),
    getCachedProfilesByRole(ownerId, ['tecnico'], false),
    getCachedProfilesByRole(ownerId, ['tecnico'], true),
    getCachedProfilesByRole(ownerId, ['admin', 'tecnico'], false),
    getCachedProfilesByRole(ownerId, ['admin', 'tecnico'], true),
    getCachedMaquinasTallerSnapshot(ownerId, { soloAbiertas: true }),
    getCachedMaquinasTallerSnapshot(ownerId, { soloAbiertas: false }),
    getCachedMaquinasTallerMovimientosSnapshot(ownerId),
  ])
  const clienteIds = clientesCompletos.map((cliente) => cliente.id)
  const maquinasActivasPorCliente = buildMaquinasByCliente(maquinasActivas, clienteIds)
  const maquinasCompletasPorCliente = buildMaquinasByCliente(maquinasCompletas, clienteIds)

  setOfflineHydratedQueryData(queryClient, serviciosKeys.list(), servicios)
  setOfflineHydratedQueryData(
    queryClient,
    serviciosKeys.list(normalizeServiciosListFilters({
      status: null,
      tecnicoId: null,
      clienteId: null,
      fechaDesde: null,
      fechaHasta: null,
      tipoServicio: null,
      search: null,
    }) ?? undefined),
    servicios,
  )

  setOfflineHydratedQueryData(queryClient, inventarioKeys.list(false), inventarioActivo)
  setOfflineHydratedQueryData(queryClient, inventarioKeys.list(true), inventarioCompleto)
  setOfflineHydratedQueryData(queryClient, inventarioKeys.movimientos(), movimientosInventario)

  setOfflineHydratedQueryData(queryClient, polizasKeys.list(), polizas)
  setOfflineHydratedQueryData(queryClient, polizasKeys.history(undefined), polizasHistorial)
  setOfflineHydratedQueryData(queryClient, polizasKeys.pauses(), polizaPausas)
  setOfflineHydratedQueryData(queryClient, mantenimientosKeys.list(undefined), mantenimientos)

  setOfflineHydratedQueryData(queryClient, clientesKeys.list(false), clientesActivos)
  setOfflineHydratedQueryData(queryClient, clientesKeys.list(true), clientesCompletos)

  setOfflineHydratedQueryData(queryClient, maquinasKeys.list(undefined, false), maquinasActivas)
  setOfflineHydratedQueryData(queryClient, maquinasKeys.list(undefined, true), maquinasCompletas)
  for (const clienteId of clienteIds) {
    setOfflineHydratedQueryData(queryClient, maquinasKeys.list(clienteId, false), maquinasActivasPorCliente.get(clienteId) ?? [])
    setOfflineHydratedQueryData(queryClient, maquinasKeys.list(clienteId, true), maquinasCompletasPorCliente.get(clienteId) ?? [])
  }

  setOfflineHydratedQueryData(queryClient, tecnicosKeys.list(false), tecnicosActivos)
  setOfflineHydratedQueryData(queryClient, tecnicosKeys.list(true), tecnicosCompletos)
  setOfflineHydratedQueryData(queryClient, tecnicosKeys.empleadosList(false), empleadosActivos)
  setOfflineHydratedQueryData(queryClient, tecnicosKeys.empleadosList(true), empleadosCompletos)

  setOfflineHydratedQueryData(queryClient, maquinasTallerKeys.list(true), maquinasTallerAbiertas)
  setOfflineHydratedQueryData(queryClient, maquinasTallerKeys.list(false), maquinasTallerTodas)
  setOfflineHydratedQueryData(queryClient, maquinasTallerKeys.movimientos(undefined), maquinasTallerMovimientos)
}
