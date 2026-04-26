import type { RefaccionInput } from '@/schemas/inventario.schema'
import type {
  Cierre,
  Cliente,
  Evidencia,
  InventarioTecnico,
  ItemInventario,
  Maquina,
  MaquinaEnTaller,
  MaquinaTallerMovimiento,
  MantenimientoPoliza,
  MovimientoInventario,
  Poliza,
  PolizaEstadoHistorial,
  PolizaPausa,
  Profile,
  Servicio,
} from '@/types/domain.types'
import {
  upsertCachedClientes,
  upsertCachedCierres,
  upsertCachedEvidencias,
  upsertCachedInventario,
  upsertCachedInventarioTecnico,
  upsertCachedMaquinas,
  upsertCachedMaquinasTaller,
  upsertCachedMaquinasTallerMovimientos,
  upsertCachedMantenimientos,
  upsertCachedMovimientosInventario,
  upsertCachedPolizaEstadoHistorial,
  upsertCachedPolizaPausas,
  upsertCachedPolizas,
  upsertCachedProfiles,
  upsertCachedServicioRefacciones,
  upsertCachedServicios,
} from '@/lib/offline/cache'
import { offlineDb } from '@/lib/offline/db'
import {
  markAdminPreloadCompleted,
  readAdminPreloadState,
} from '@/lib/offline/preload-state'
import { supabase } from '@/lib/supabase'

const PRELOAD_PAGE_SIZE = 250
const PRELOAD_MIN_INTERVAL_MS = 1000 * 60 * 10
const ADMIN_BOOTSTRAP_LOOKBACK_DAYS = 45

const SELECT_MAQUINA = '*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)'
const SELECT_SERVICIO = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, role)
`
const SELECT_POLIZA = '*, cliente:clientes(*), maquina:maquinas(*)'
const SELECT_MANTENIMIENTO = `
  *,
  poliza:polizas(*),
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo)
`
const SELECT_MAQUINAS_TALLER = `
  *,
  maquina:maquinas(*, cliente:clientes(id, nombre, codigo_cliente)),
  cliente:clientes(id, nombre, codigo_cliente),
  servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, fecha_cierre, cliente_id, maquina_id)
`
const SELECT_MOVIMIENTOS_TALLER = `
  *,
  maquina:maquinas(id, serie, modelo, status),
  servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, fecha_cierre),
  usuario:profiles(id, nombre, correo)
`

const runningPreloads = new Map<string, Promise<void>>()
const lastCompletedPreloads = new Map<string, number>()

type AdminPreloadMode = 'essential' | 'full'

interface RefaccionRow {
  servicio_id: number | null
  mantenimiento_id: number | null
  inventario_id: number | null
  nombre_refaccion: string
  cantidad: number
  precio_unitario: number
  inventory_source: 'general' | 'tecnico' | null
}

function nowMs(): number {
  return Date.now()
}

function getLookbackIsoDate(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

function uniqueById<T extends { id: number | string }>(rows: T[]): T[] {
  const byId = new Map<string, T>()
  for (const row of rows) {
    byId.set(String(row.id), row)
  }
  return Array.from(byId.values())
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  onPage: (rows: T[]) => Promise<void>,
) {
  for (let from = 0; ; from += PRELOAD_PAGE_SIZE) {
    const to = from + PRELOAD_PAGE_SIZE - 1
    const rows = await fetchPage(from, to)

    if (rows.length === 0) {
      break
    }

    await onPage(rows)

    if (rows.length < PRELOAD_PAGE_SIZE) {
      break
    }

    await yieldToBrowser()
  }
}

async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = []

  await fetchAllPages(fetchPage, async (page) => {
    rows.push(...page)
  })

  return rows
}

async function preloadProfiles(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['admin', 'tecnico'])
        .order('nombre')
        .range(from, to)

      if (error) throw error
      return (data ?? []) as Profile[]
    },
    async (rows) => upsertCachedProfiles(ownerId, rows),
  )
}

async function preloadClientes(ownerId: string, options?: { activeOnly?: boolean }) {
  await fetchAllPages(
    async (from, to) => {
      let query = supabase
        .from('clientes')
        .select('*')
        .order('nombre')
        .range(from, to)

      if (options?.activeOnly) {
        query = query.eq('activo', true)
      }

      const { data, error } = await query
      if (error) throw error
      return data ?? []
    },
    async (rows) => upsertCachedClientes(ownerId, rows as Cliente[]),
  )
}

async function preloadMaquinas(ownerId: string, options?: { activeOnly?: boolean }) {
  await fetchAllPages(
    async (from, to) => {
      let query = supabase
        .from('maquinas')
        .select(SELECT_MAQUINA)
        .order('serie')
        .range(from, to)

      if (options?.activeOnly) {
        query = query.eq('activo', true)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as Maquina[]
    },
    async (rows) => upsertCachedMaquinas(ownerId, rows),
  )
}

async function preloadInventario(ownerId: string, options?: { activeOnly?: boolean }) {
  await fetchAllPages(
    async (from, to) => {
      let query = supabase
        .from('inventario')
        .select('*')
        .order('nombre')
        .range(from, to)

      if (options?.activeOnly) {
        query = query.eq('activo', true)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as ItemInventario[]
    },
    async (rows) => upsertCachedInventario(ownerId, rows),
  )
}

async function preloadInventarioTecnico(ownerId: string, options?: { activeOnly?: boolean }) {
  await fetchAllPages(
    async (from, to) => {
      let query = supabase
        .from('inventario_tecnico')
        .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (options?.activeOnly) {
        query = query.is('devuelto_at', null).gt('cantidad', 0)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as InventarioTecnico[]
    },
    async (rows) => upsertCachedInventarioTecnico(ownerId, rows),
  )
}

async function preloadServicios(ownerId: string, options?: { essential?: boolean }) {
  if (options?.essential) {
    const rows: Servicio[] = []
    const lookbackIso = getLookbackIsoDate(ADMIN_BOOTSTRAP_LOOKBACK_DAYS)

    await fetchAllPages(
      async (from, to) => {
        const { data, error } = await supabase
          .from('servicios')
          .select(SELECT_SERVICIO)
          .in('status', ['pendiente', 'en_ruta'])
          .order('created_at', { ascending: false })
          .range(from, to)

        if (error) throw error
        return (data ?? []) as Servicio[]
      },
      async (page) => {
        rows.push(...page)
      },
    )

    await fetchAllPages(
      async (from, to) => {
        const { data, error } = await supabase
          .from('servicios')
          .select(SELECT_SERVICIO)
          .gte('created_at', lookbackIso)
          .order('created_at', { ascending: false })
          .range(from, to)

        if (error) throw error
        return (data ?? []) as Servicio[]
      },
      async (page) => {
        rows.push(...page)
      },
    )

    const servicios = uniqueById(rows)
    if (servicios.length > 0) {
      await upsertCachedServicios(ownerId, servicios)
    }
    return
  }

  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('servicios')
        .select(SELECT_SERVICIO)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as Servicio[]
    },
    async (rows) => upsertCachedServicios(ownerId, rows),
  )
}

async function preloadCierres(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('cierres')
        .select('*, tecnico:profiles(id, nombre)')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as Cierre[]
    },
    async (rows) => upsertCachedCierres(ownerId, rows),
  )
}

async function preloadPolizas(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('polizas')
        .select(SELECT_POLIZA)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as Poliza[]
    },
    async (rows) => upsertCachedPolizas(ownerId, rows),
  )
}

async function preloadPolizaEstadoHistorial(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('poliza_estado_historial')
        .select('*')
        .order('changed_at', { ascending: true })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as PolizaEstadoHistorial[]
    },
    async (rows) => upsertCachedPolizaEstadoHistorial(ownerId, rows),
  )
}

async function preloadPolizaPausas(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('poliza_pausas')
        .select('*')
        .order('fecha_inicio', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as PolizaPausa[]
    },
    async (rows) => upsertCachedPolizaPausas(ownerId, rows),
  )
}

async function preloadMantenimientos(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('mantenimientos_poliza')
        .select(SELECT_MANTENIMIENTO)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as MantenimientoPoliza[]
    },
    async (rows) => upsertCachedMantenimientos(ownerId, rows),
  )
}

async function preloadMovimientosInventario(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('movimientos_inventario')
        .select('*, item:inventario(id, nombre), usuario:profiles(id, nombre)')
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as MovimientoInventario[]
    },
    async (rows) => upsertCachedMovimientosInventario(ownerId, rows),
  )
}

async function preloadMaquinasEnTaller(ownerId: string, options?: { soloAbiertas?: boolean }) {
  await fetchAllPages(
    async (from, to) => {
      let query = supabase
        .from('maquinas_en_taller')
        .select(SELECT_MAQUINAS_TALLER)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (options?.soloAbiertas) {
        query = query.is('fecha_salida', null)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as MaquinaEnTaller[]
    },
    async (rows) => upsertCachedMaquinasTaller(ownerId, rows),
  )
}

async function preloadMaquinasTallerMovimientos(ownerId: string) {
  await fetchAllPages(
    async (from, to) => {
      const { data, error } = await supabase
        .from('maquinas_taller_movimientos')
        .select(SELECT_MOVIMIENTOS_TALLER)
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) throw error
      return (data ?? []) as MaquinaTallerMovimiento[]
    },
    async (rows) => upsertCachedMaquinasTallerMovimientos(ownerId, rows),
  )
}

async function preloadServicioRefacciones(ownerId: string) {
  const rows = await collectAllPages<RefaccionRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('servicio_refacciones')
      .select('*')
      .order('id')
      .range(from, to)

    if (error) throw error
    return (data ?? []) as RefaccionRow[]
  })

  const grouped = new Map<string, {
    serviceId?: number | null
    mantenimientoId?: number | null
    items: Array<RefaccionInput & { inventory_source?: 'general' | 'tecnico' | null }>
  }>()

  rows.forEach((row) => {
    const key = row.servicio_id != null
      ? `service:${row.servicio_id}`
      : `mantenimiento:${row.mantenimiento_id}`

    const group = grouped.get(key) ?? {
      serviceId: row.servicio_id,
      mantenimientoId: row.mantenimiento_id,
      items: [],
    }

    group.items.push({
      inventario_id: row.inventario_id,
      nombre_refaccion: row.nombre_refaccion,
      cantidad: row.cantidad,
      precio_unitario: row.precio_unitario,
      inventory_source: row.inventory_source,
    })

    grouped.set(key, group)
  })

  await offlineDb.servicioRefacciones.where('ownerId').equals(ownerId).delete()

  for (const group of grouped.values()) {
    await upsertCachedServicioRefacciones(ownerId, {
      serviceId: group.serviceId,
      mantenimientoId: group.mantenimientoId,
      items: group.items,
    })
  }
}

async function preloadEvidencias(ownerId: string) {
  const rows = await collectAllPages<Evidencia>(async (from, to) => {
    const { data, error } = await supabase
      .from('evidencias')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) throw error
    return (data ?? []) as Evidencia[]
  })

  await offlineDb.evidencias.where('ownerId').equals(ownerId).delete()

  if (rows.length > 0) {
    await upsertCachedEvidencias(ownerId, rows)
  }
}

async function runAdminPreload(ownerId: string, mode: AdminPreloadMode) {
  await preloadProfiles(ownerId)
  await yieldToBrowser()
  await preloadClientes(ownerId, { activeOnly: mode === 'essential' })
  await yieldToBrowser()
  await preloadMaquinas(ownerId, { activeOnly: mode === 'essential' })
  await yieldToBrowser()
  await preloadInventario(ownerId, { activeOnly: mode === 'essential' })

  if (mode === 'full') {
    await yieldToBrowser()
    await preloadInventarioTecnico(ownerId)
  }

  await yieldToBrowser()
  await preloadServicios(ownerId, { essential: mode === 'essential' })
  await yieldToBrowser()
  await preloadMaquinasEnTaller(ownerId, { soloAbiertas: mode === 'essential' })

  if (mode === 'essential') {
    return
  }

  await yieldToBrowser()
  await preloadCierres(ownerId)
  await yieldToBrowser()
  await preloadPolizas(ownerId)
  await yieldToBrowser()
  await preloadPolizaEstadoHistorial(ownerId)
  await yieldToBrowser()
  await preloadPolizaPausas(ownerId)
  await yieldToBrowser()
  await preloadMantenimientos(ownerId)
  await yieldToBrowser()
  await preloadMovimientosInventario(ownerId)
  await yieldToBrowser()
  await preloadMaquinasTallerMovimientos(ownerId)
  await yieldToBrowser()
  await preloadServicioRefacciones(ownerId)
  await yieldToBrowser()
  await preloadEvidencias(ownerId)
}

export async function preloadAdminOfflineData(
  ownerId: string,
  options?: { force?: boolean; mode?: AdminPreloadMode },
): Promise<void> {
  if (!ownerId) return
  const mode = options?.mode ?? 'essential'

  const currentRun = runningPreloads.get(ownerId)
  if (currentRun) {
    return currentRun
  }

  const persistedState = readAdminPreloadState(ownerId)
  const lastCompletedAt = lastCompletedPreloads.get(ownerId) ?? persistedState?.completedAt ?? 0
  if (!options?.force && nowMs() - lastCompletedAt < PRELOAD_MIN_INTERVAL_MS) {
    return
  }

  const run = runAdminPreload(ownerId, mode)
    .then(() => {
      const completedAt = nowMs()
      lastCompletedPreloads.set(ownerId, completedAt)
      markAdminPreloadCompleted(ownerId, completedAt)
    })
    .finally(() => {
      runningPreloads.delete(ownerId)
    })

  runningPreloads.set(ownerId, run)
  return run
}
