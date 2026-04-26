import {
  replaceCachedEvidenciasForServicio,
  upsertCachedInventario,
  upsertCachedInventarioTecnico,
  upsertCachedServicioRefacciones,
  upsertCachedServicios,
} from '@/lib/offline/cache'
import { markTecnicoPreloadCompleted, readTecnicoPreloadState } from '@/lib/offline/tecnico-preload-state'
import { supabase } from '@/lib/supabase'
import { formatLocalIsoDate } from '@/lib/utils'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { Evidencia, InventarioTecnico, ItemInventario, Servicio } from '@/types/domain.types'

const PRELOAD_MIN_INTERVAL_MS = 1000 * 60 * 10
const INVENTARIO_TECNICO_PAGE_SIZE = 250

const SELECT_SERVICIO = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, role)
`

const SELECT_INVENTARIO_TECNICO = '*, tecnico:profiles(id, nombre, correo), item:inventario(*)'

const runningPreloads = new Map<string, Promise<void>>()
const lastCompletedPreloads = new Map<string, number>()

interface PreloadTecnicoOfflineDataOptions {
  fecha?: string
  force?: boolean
}

function getPreloadKey(ownerId: string, fecha: string): string {
  return `${ownerId}:${fecha}`
}

function shouldSkipRecentRun(ownerId: string, fecha: string, force = false): boolean {
  if (force) return false

  const key = getPreloadKey(ownerId, fecha)
  const persistedState = readTecnicoPreloadState(ownerId)
  const lastCompletedAt = lastCompletedPreloads.get(key) ?? persistedState?.completedAt ?? 0
  if (lastCompletedAt && Date.now() - lastCompletedAt < PRELOAD_MIN_INTERVAL_MS) {
    return true
  }

  return false
}

function groupEvidenciasByServicio(servicioIds: number[], evidencias: Evidencia[]) {
  const grouped = new Map<number, Evidencia[]>()

  for (const servicioId of servicioIds) {
    grouped.set(servicioId, [])
  }

  for (const evidencia of evidencias) {
    const rows = grouped.get(evidencia.servicio_id)
    if (!rows) continue
    rows.push(evidencia)
  }

  return grouped
}

function groupRefaccionesByServicio(
  servicioIds: number[],
  rows: Array<RefaccionInput & {
    servicio_id: number | null
    inventory_source?: 'general' | 'tecnico' | null
  }>,
) {
  const grouped = new Map<number, Array<RefaccionInput & {
    inventory_source?: 'general' | 'tecnico' | null
  }>>()

  for (const servicioId of servicioIds) {
    grouped.set(servicioId, [])
  }

  for (const row of rows) {
    if (!row.servicio_id) continue
    const current = grouped.get(row.servicio_id)
    if (!current) continue
    current.push({
      inventario_id: row.inventario_id,
      nombre_refaccion: row.nombre_refaccion,
      cantidad: row.cantidad,
      precio_unitario: row.precio_unitario,
      inventory_source: row.inventory_source,
    })
  }

  return grouped
}

async function fetchInventarioTecnicoRowsForBootstrap(
  tecnicoId: string,
  fecha: string,
): Promise<InventarioTecnico[]> {
  const rows: InventarioTecnico[] = []

  const fetchRows = async (scope: 'today' | 'stale-active') => {
    for (let from = 0; ; from += INVENTARIO_TECNICO_PAGE_SIZE) {
      const to = from + INVENTARIO_TECNICO_PAGE_SIZE - 1
      let query = supabase
        .from('inventario_tecnico')
        .select(SELECT_INVENTARIO_TECNICO)
        .eq('tecnico_id', tecnicoId)

      if (scope === 'today') {
        query = query
          .eq('fecha', fecha)
          .order('created_at', { ascending: false })
      } else {
        query = query
          .lt('fecha', fecha)
          .is('devuelto_at', null)
          .gt('cantidad', 0)
          .order('fecha', { ascending: false })
          .order('created_at', { ascending: false })
      }

      const { data, error } = await query.range(from, to)

      if (error) throw error

      const pageRows = (data ?? []) as InventarioTecnico[]
      rows.push(...pageRows)

      if (pageRows.length < INVENTARIO_TECNICO_PAGE_SIZE) {
        break
      }
    }
  }

  await fetchRows('today')
  await fetchRows('stale-active')

  const byId = new Map<number, InventarioTecnico>()
  for (const row of rows) {
    byId.set(row.id, row)
  }
  return Array.from(byId.values())
}

export async function preloadTecnicoOfflineData(
  ownerId: string,
  tecnicoId: string,
  options?: PreloadTecnicoOfflineDataOptions,
): Promise<void> {
  if (!ownerId || !tecnicoId) return

  const fecha = options?.fecha ?? formatLocalIsoDate(new Date())
  const preloadKey = getPreloadKey(ownerId, fecha)

  if (runningPreloads.has(preloadKey)) {
    return runningPreloads.get(preloadKey)!
  }

  if (shouldSkipRecentRun(ownerId, fecha, options?.force)) {
    return
  }

  const task = (async () => {
    const inventarioTecnicoPromise = fetchInventarioTecnicoRowsForBootstrap(tecnicoId, fecha)
    const [serviciosResponse, inventarioTecnicoResponse, inventarioResponse] = await Promise.all([
      supabase
        .from('servicios')
        .select(SELECT_SERVICIO)
        .eq('tecnico_id', tecnicoId)
        .eq('status', 'en_ruta')
        .gte('fecha_servicio', fecha)
        .lte('fecha_servicio', fecha)
        .order('created_at', { ascending: false }),
      inventarioTecnicoPromise,
      supabase
        .from('inventario')
        .select('*')
        .eq('activo', true)
        .order('nombre'),
    ])

    if (serviciosResponse.error) throw serviciosResponse.error
    if (inventarioResponse.error) throw inventarioResponse.error

    const servicios = (serviciosResponse.data ?? []) as Servicio[]
    const inventarioTecnico = inventarioTecnicoResponse
    const inventario = (inventarioResponse.data ?? []) as ItemInventario[]

    if (servicios.length > 0) {
      await upsertCachedServicios(ownerId, servicios)
    }

    if (inventario.length > 0) {
      await upsertCachedInventario(ownerId, inventario)
    }

    if (inventarioTecnico.length > 0) {
      await upsertCachedInventarioTecnico(ownerId, inventarioTecnico)
    }

    const servicioIds = servicios.map((servicio) => servicio.id)
    if (servicioIds.length > 0) {
      const [evidenciasResponse, refaccionesResponse] = await Promise.all([
        supabase
          .from('evidencias')
          .select('*')
          .in('servicio_id', servicioIds)
          .order('orden'),
        supabase
          .from('servicio_refacciones')
          .select('*')
          .in('servicio_id', servicioIds)
          .order('id'),
      ])

      if (evidenciasResponse.error) throw evidenciasResponse.error
      if (refaccionesResponse.error) throw refaccionesResponse.error

      const evidencias = (evidenciasResponse.data ?? []) as Evidencia[]
      const refacciones = (refaccionesResponse.data ?? []) as Array<RefaccionInput & {
        servicio_id: number | null
        inventory_source?: 'general' | 'tecnico' | null
      }>
      const evidenciasByServicio = groupEvidenciasByServicio(servicioIds, evidencias)
      const refaccionesByServicio = groupRefaccionesByServicio(servicioIds, refacciones)

      await Promise.all(
        servicioIds.flatMap((servicioId) => ([
          replaceCachedEvidenciasForServicio(ownerId, servicioId, evidenciasByServicio.get(servicioId) ?? []),
          upsertCachedServicioRefacciones(ownerId, {
            serviceId: servicioId,
            items: refaccionesByServicio.get(servicioId) ?? [],
          }),
        ])),
      )
    }

    const completedAt = Date.now()
    markTecnicoPreloadCompleted(ownerId, completedAt)
    lastCompletedPreloads.set(preloadKey, completedAt)
  })().finally(() => {
    runningPreloads.delete(preloadKey)
  })

  runningPreloads.set(preloadKey, task)
  return task
}
