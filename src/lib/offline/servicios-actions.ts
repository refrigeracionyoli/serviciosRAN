import {
  createOfflineCommandRecord,
  findPendingEntityCreateCommandId,
  persistOfflineCommand,
} from '@/lib/offline/commands'
import {
  buildCacheKey,
  createLocalNumberId,
  getCachedClienteById,
  getCachedInventarioItemById,
  getCachedInventarioTecnicoSnapshot,
  getCachedMantenimientoDetalleSnapshot,
  getCachedMantenimientoRefaccionesSnapshot,
  getCachedMaquinaById,
  getCachedPolizaById,
  getCachedProfileById,
  getCachedServicioDetalleSnapshot,
  getCachedServicioRefaccionesSnapshot,
  isLocalNumberId,
  replaceCachedMaquinasTallerMovimientosSnapshot,
  replaceCachedMaquinasTallerSnapshot,
  resolveLinkedNumberId,
  resolveLinkedStringId,
  upsertCachedCierres,
  upsertCachedInventario,
  upsertCachedInventarioTecnico,
  upsertCachedMaquinas,
  upsertCachedMaquinasTaller,
  upsertCachedMaquinasTallerMovimientos,
  upsertCachedMantenimientos,
  upsertCachedMovimientosInventario,
  upsertCachedServicio,
  upsertCachedServicioRefacciones,
  upsertEntityLink,
} from '@/lib/offline/cache'
import {
  getInventarioTecnicoAssignedTotal,
  normalizeInventarioTecnicoRow,
} from '@/lib/inventario-tecnico'
import { assertCurrentUserCanWriteRemoteService } from '@/lib/offline/service-access'
import { offlineDb } from '@/lib/offline/db'
import { isLikelyUniqueViolation } from '@/lib/offline/network'
import {
  isInstallationServiceType,
  normalizeServiceType,
} from '@/lib/service-types'
import { supabase } from '@/lib/supabase'
import { formatLocalIsoDate } from '@/lib/utils'
import type { CierreInput } from '@/schemas/cliente.schema'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type {
  CrearMantenimientoInput,
  EditarMantenimientoInput,
} from '@/schemas/mantenimiento.schema'
import type {
  CrearServicioInput,
  EditarServicioInput,
} from '@/schemas/servicio.schema'
import type {
  Cierre,
  InventarioTecnico,
  ItemInventario,
  Maquina,
  MaquinaEnTaller,
  MaquinaTallerMovimiento,
  MantenimientoPoliza,
  MovimientoInventario,
  Servicio,
  ServicioRefaccion,
} from '@/types/domain.types'

const SELECT_SERVICIO = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, role)
`

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

function getNowIso(): string {
  return new Date().toISOString()
}

const GENERAL_SERVICE_REFACCIONES_REMOTE_FILTER = 'inventory_source.is.null,inventory_source.eq.general'

export async function findRemoteServicioByOrden(orden: number | null | undefined): Promise<Servicio | null> {
  if (typeof orden !== 'number' || !Number.isFinite(orden)) return null

  const { data, error } = await supabase
    .from('servicios')
    .select(SELECT_SERVICIO)
    .eq('orden', orden)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as Servicio | null
}

export async function findRemoteCierreByServicioId(servicioId: number | null | undefined): Promise<Cierre | null> {
  if (typeof servicioId !== 'number' || !Number.isFinite(servicioId)) return null

  const { data, error } = await supabase
    .from('cierres')
    .select('*, tecnico:profiles(id, nombre)')
    .eq('servicio_id', servicioId)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as Cierre | null
}

async function collectDependencies(
  ownerId: string,
  refs: Array<{ entityType: string; entityId: string | number | null | undefined }>,
) {
  const values = await Promise.all(
    refs.map((ref) => findPendingEntityCreateCommandId(ownerId, ref.entityType, ref.entityId)),
  )

  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function calculateRefaccionesTotal(items: RefaccionInput[]): number {
  return items.reduce((sum, item) => sum + Number(item.cantidad) * Number(item.precio_unitario), 0)
}

function calculateServicioTotal(servicio: Pick<Servicio, 'costo_mano_obra' | 'costo_refacciones' | 'total'>): number {
  const calculated = Number(servicio.costo_mano_obra ?? 0) + Number(servicio.costo_refacciones ?? 0)
  if (Number.isFinite(calculated)) return calculated

  const fallback = Number(servicio.total ?? 0)
  return Number.isFinite(fallback) ? fallback : 0
}

export type ServicioRefaccionesInventorySource = 'general' | 'tecnico'
type StoredRefaccionInput = RefaccionInput & {
  inventory_source?: ServicioRefaccionesInventorySource | null
}

interface ServicioReplaceRefaccionesRollbackSnapshot {
  previousItems: StoredRefaccionInput[]
  previousService: {
    status: Servicio['status']
    costo_refacciones: number
    total: number
    updated_at: string
  } | null
}

interface QueueServicioReplaceRefaccionesOptions {
  inventorySource?: ServicioRefaccionesInventorySource
  tecnicoId?: string | null
  inventarioFecha?: string | null
}

function normalizeInventorySource(
  source?: ServicioRefaccionesInventorySource | null,
): ServicioRefaccionesInventorySource {
  return source === 'tecnico' ? 'tecnico' : 'general'
}

function toRefaccionInputs(rows: ServicioRefaccion[]): StoredRefaccionInput[] {
  return rows.map((row) => ({
    inventario_id: row.inventario_id,
    nombre_refaccion: row.nombre_refaccion,
    cantidad: row.cantidad,
    precio_unitario: row.precio_unitario,
    inventory_source: row.inventory_source,
  }))
}

function buildInventarioQuantityMap(items: Array<Pick<RefaccionInput, 'inventario_id' | 'cantidad'>>) {
  const quantities = new Map<number, number>()

  items.forEach((item) => {
    if (!item.inventario_id) return
    quantities.set(item.inventario_id, (quantities.get(item.inventario_id) ?? 0) + Number(item.cantidad))
  })

  return quantities
}

function aggregateRefaccionesByInventario(
  items: Array<RefaccionInput & { inventory_source?: ServicioRefaccionesInventorySource | null }>,
): StoredRefaccionInput[] {
  const byInventarioId = new Map<number, StoredRefaccionInput>()
  const withoutInventarioId: StoredRefaccionInput[] = []

  for (const item of items) {
    if (!item.inventario_id) {
      withoutInventarioId.push({ ...item })
      continue
    }

    const existing = byInventarioId.get(item.inventario_id)
    if (!existing) {
      byInventarioId.set(item.inventario_id, { ...item })
      continue
    }

    byInventarioId.set(item.inventario_id, {
      ...existing,
      nombre_refaccion: existing.nombre_refaccion || item.nombre_refaccion,
      cantidad: Number(existing.cantidad) + Number(item.cantidad),
      precio_unitario: existing.precio_unitario ?? item.precio_unitario,
      inventory_source: normalizeInventorySource(existing.inventory_source ?? item.inventory_source),
    })
  }

  return [...byInventarioId.values(), ...withoutInventarioId]
}

function isGeneralInventorySource(source?: ServicioRefaccionesInventorySource | null): boolean {
  return normalizeInventorySource(source) === 'general'
}

function toStoredRefaccionInput(row: Pick<ServicioRefaccion, 'inventario_id' | 'nombre_refaccion' | 'cantidad' | 'precio_unitario' | 'inventory_source'>): StoredRefaccionInput {
  return {
    inventario_id: row.inventario_id,
    nombre_refaccion: row.nombre_refaccion,
    cantidad: row.cantidad,
    precio_unitario: row.precio_unitario,
    inventory_source: normalizeInventorySource(row.inventory_source),
  }
}

function buildRefaccionContext(input: {
  servicio?: Servicio | null
  mantenimiento?: MantenimientoPoliza | null
  serviceId?: number | null
  mantenimientoId?: number | null
}) {
  if (input.servicio) {
    const servicio = input.servicio
    const cliente = servicio.cliente
    const maquina = servicio.maquina
    return {
      refKey: `[SERVICIO:${input.serviceId ?? servicio.id}]`,
      referenciaId: input.serviceId ?? servicio.id,
      ubicacion: [
        cliente?.codigo_cliente ?? 'SIN_CODIGO',
        cliente?.nombre ?? 'SIN_ESTABLECIMIENTO',
        cliente?.direccion ?? 'SIN_DIRECCION',
        cliente?.municipio ?? 'SIN_MUNICIPIO',
        maquina?.modelo ?? '',
        maquina?.serie ?? '',
      ].join(' | '),
    }
  }

  if (input.mantenimiento) {
    const mantenimiento = input.mantenimiento
    const cliente = mantenimiento.cliente
    const maquina = mantenimiento.maquina
    return {
      refKey: `[MTTO:${input.mantenimientoId ?? mantenimiento.id}]`,
      referenciaId: input.mantenimientoId ?? mantenimiento.id,
      ubicacion: [
        cliente?.codigo_cliente ?? 'SIN_CODIGO',
        cliente?.nombre ?? 'SIN_ESTABLECIMIENTO',
        cliente?.direccion ?? 'SIN_DIRECCION',
        cliente?.municipio ?? 'SIN_MUNICIPIO',
        maquina?.modelo ?? '',
        maquina?.serie ?? '',
      ].join(' | '),
    }
  }

  return {
    refKey: input.serviceId != null ? `[SERVICIO:${input.serviceId}]` : `[MTTO:${input.mantenimientoId ?? 0}]`,
    referenciaId: input.serviceId ?? input.mantenimientoId ?? null,
    ubicacion: 'SIN_REFERENCIA',
  }
}

async function buildMovimientoLocal(
  ownerId: string,
  input: Omit<MovimientoInventario, 'id' | 'created_at' | 'item' | 'usuario'>,
): Promise<MovimientoInventario> {
  const [item, usuario] = await Promise.all([
    getCachedInventarioItemById(ownerId, input.inventario_id),
    input.usuario_id ? getCachedProfileById(ownerId, input.usuario_id) : Promise.resolve(null),
  ])

  return {
    ...input,
    id: createLocalNumberId(),
    created_at: getNowIso(),
    item: item ?? undefined,
    usuario: usuario ?? undefined,
  }
}

async function applyLocalRefaccionesChange(
  ownerId: string,
  input: {
    serviceId?: number | null
    mantenimientoId?: number | null
    items: StoredRefaccionInput[]
    recordMovements?: boolean
  },
) {
  const previous = typeof input.serviceId === 'number'
    ? await getCachedServicioRefaccionesSnapshot(ownerId, input.serviceId)
    : await getCachedMantenimientoRefaccionesSnapshot(ownerId, input.mantenimientoId!)
  const previousItems = toRefaccionInputs(previous)
  const replacesAllServiceSources = typeof input.serviceId === 'number'
    && input.items.some((item) => typeof item.inventory_source !== 'undefined' && item.inventory_source !== null)
  const previousGeneralItems = previous.filter((item) => normalizeInventorySource(item.inventory_source) === 'general')
  const previousNonGeneralItems = previous
    .filter((item) => normalizeInventorySource(item.inventory_source) !== 'general')
    .map(toStoredRefaccionInput)
  const nextItems = replacesAllServiceSources
    ? input.items.map((item) => ({
      ...item,
      inventory_source: normalizeInventorySource(item.inventory_source),
    }))
    : input.items
  const nextGeneralItems = nextItems.filter((item) => normalizeInventorySource(item.inventory_source) === 'general')
  const nextNonGeneralItems = replacesAllServiceSources
    ? nextItems.filter((item) => normalizeInventorySource(item.inventory_source) !== 'general')
    : previousNonGeneralItems

  const [servicio, mantenimiento] = await Promise.all([
    typeof input.serviceId === 'number' ? getCachedServicioDetalleSnapshot(ownerId, input.serviceId) : Promise.resolve(null),
    typeof input.mantenimientoId === 'number'
      ? getCachedMantenimientoDetalleSnapshot(ownerId, input.mantenimientoId)
      : Promise.resolve(null),
  ])

  const context = buildRefaccionContext({
    servicio,
    mantenimiento,
    serviceId: input.serviceId,
    mantenimientoId: input.mantenimientoId,
  })

  const stockChanges = new Map<number, number>()
  previousGeneralItems.forEach((item) => {
    if (!item.inventario_id) return
    stockChanges.set(item.inventario_id, (stockChanges.get(item.inventario_id) ?? 0) + item.cantidad)
  })
  nextGeneralItems.forEach((item) => {
    if (!item.inventario_id) return
    stockChanges.set(item.inventario_id, (stockChanges.get(item.inventario_id) ?? 0) - item.cantidad)
  })

  const affectedIds = Array.from(stockChanges.keys())
  const cachedItems = await Promise.all(affectedIds.map((inventarioId) => getCachedInventarioItemById(ownerId, inventarioId)))
  const updatedItems: ItemInventario[] = []

  affectedIds.forEach((inventarioId, index) => {
    const item = cachedItems[index]
    if (!item) {
      throw new Error(`No se encontró el item de inventario ${inventarioId} en caché local.`)
    }

    const nextStock = item.stock_actual + (stockChanges.get(inventarioId) ?? 0)
    if (nextStock < 0) {
      throw new Error(`Stock insuficiente para inventario_id=${inventarioId}.`)
    }

    updatedItems.push({
      ...item,
      stock_actual: nextStock,
    })
  })

  const movementRows: MovimientoInventario[] = []

  if (input.recordMovements !== false) {
    for (const item of previousGeneralItems) {
      if (!item.inventario_id) continue
      movementRows.push(await buildMovimientoLocal(ownerId, {
        inventario_id: item.inventario_id,
        tipo: 'correccion_instalacion',
        cantidad: item.cantidad,
        motivo: `${context.refKey} Corrección de instalación a ${context.ubicacion}`,
        referencia_id: context.referenciaId,
        usuario_id: ownerId,
      }))
    }

    for (const item of nextGeneralItems) {
      if (!item.inventario_id) continue
      movementRows.push(await buildMovimientoLocal(ownerId, {
        inventario_id: item.inventario_id,
        tipo: 'instalacion_refaccion',
        cantidad: item.cantidad,
        motivo: `${context.refKey} Instalación a ${context.ubicacion}`,
        referencia_id: context.referenciaId,
        usuario_id: ownerId,
      }))
    }
  }

  if (updatedItems.length > 0) {
    await upsertCachedInventario(ownerId, updatedItems)
  }

  if (movementRows.length > 0) {
    await upsertCachedMovimientosInventario(ownerId, movementRows)
  }

  if (typeof input.serviceId === 'number') {
    await upsertCachedServicioRefacciones(ownerId, {
      serviceId: input.serviceId,
      items: replacesAllServiceSources ? nextItems : nextGeneralItems,
      replaceSource: replacesAllServiceSources ? undefined : 'general',
    })
  } else {
    await upsertCachedServicioRefacciones(ownerId, {
      mantenimientoId: input.mantenimientoId,
      items: input.items,
    })
  }

  const totalRefacciones = calculateRefaccionesTotal(
    typeof input.serviceId === 'number'
      ? [...nextNonGeneralItems, ...nextGeneralItems]
      : input.items,
  )
  if (servicio) {
    await upsertCachedServicio(ownerId, {
      ...servicio,
      costo_refacciones: totalRefacciones,
      total: Number(servicio.costo_mano_obra ?? 0) + totalRefacciones,
      updated_at: getNowIso(),
    })
  }

  if (mantenimiento) {
    await upsertCachedMantenimientos(ownerId, [{
      ...mantenimiento,
      costo_refacciones: totalRefacciones,
      total: Number(mantenimiento.costo_mano_obra ?? 0) + totalRefacciones,
    }])
  }

  return {
    movementIds: movementRows.map((row) => row.id),
    totalRefacciones,
    rollback: {
      previousItems,
      previousService: servicio
        ? {
          status: servicio.status,
          costo_refacciones: Number(servicio.costo_refacciones ?? 0),
          total: Number(servicio.total ?? Number(servicio.costo_mano_obra ?? 0) + Number(servicio.costo_refacciones ?? 0)),
          updated_at: servicio.updated_at,
        }
        : null,
    } satisfies ServicioReplaceRefaccionesRollbackSnapshot,
  }
}

async function applyLocalTecnicoServiceRefaccionesChange(
  ownerId: string,
  input: {
    serviceId: number
    items: StoredRefaccionInput[]
    tecnicoId: string
    inventarioFecha?: string | null
  },
) {
  const servicio = await getCachedServicioDetalleSnapshot(ownerId, input.serviceId)
  const inventarioFecha = input.inventarioFecha ?? servicio?.fecha_servicio ?? getNowIso().slice(0, 10)
  const previousItems = toRefaccionInputs(await getCachedServicioRefaccionesSnapshot(ownerId, input.serviceId))
  const previousTecnicoItems = previousItems.filter((item) => normalizeInventorySource(item.inventory_source) === 'tecnico')
  const incomingItems = input.items.some((item) => item.inventory_source)
    ? input.items.filter((item) => normalizeInventorySource(item.inventory_source) === 'tecnico')
    : input.items
  const nextTecnicoItems = incomingItems.map((item) => ({
    ...item,
    inventory_source: 'tecnico' as const,
  }))
  const previousByInventarioId = buildInventarioQuantityMap(previousTecnicoItems)
  const nextByInventarioId = buildInventarioQuantityMap(nextTecnicoItems)
  const inventarioTecnico = await getCachedInventarioTecnicoSnapshot(ownerId, {
    fecha: inventarioFecha,
    tecnicoId: input.tecnicoId,
    includeZeroQuantity: true,
  })
  const inventarioTecnicoById = new Map(
    inventarioTecnico.map((row) => [row.inventario_id, row] as const),
  )
  const affectedIds = Array.from(new Set([
    ...previousByInventarioId.keys(),
    ...nextByInventarioId.keys(),
  ]))

  const tecnico = await getCachedProfileById(ownerId, input.tecnicoId)
  const upserts: InventarioTecnico[] = []

  for (const inventarioId of affectedIds) {
    const currentRow = inventarioTecnicoById.get(inventarioId) ?? null
    const currentCantidad = currentRow?.cantidad ?? 0
    const previousCantidad = previousByInventarioId.get(inventarioId) ?? 0
    const nextCantidadAsignada = nextByInventarioId.get(inventarioId) ?? 0
    const nextCantidadDisponible = currentCantidad + previousCantidad - nextCantidadAsignada

    if (nextCantidadDisponible < 0) {
      const item = await getCachedInventarioItemById(ownerId, inventarioId)
      throw new Error(`Stock insuficiente en inventario del técnico para ${item?.nombre ?? `Item ${inventarioId}`}.`)
    }

    if (!currentRow && nextCantidadDisponible === 0) {
      continue
    }

    const item = currentRow?.item ?? await getCachedInventarioItemById(ownerId, inventarioId)
    if (!item) {
      throw new Error(`No se encontró la refacción ${inventarioId} en caché local.`)
    }

    upserts.push(normalizeInventarioTecnicoRow({
      id: currentRow?.id ?? createLocalNumberId(),
      tecnico_id: input.tecnicoId,
      inventario_id: inventarioId,
      cantidad: nextCantidadDisponible,
      cantidad_asignada_total: currentRow
        ? getInventarioTecnicoAssignedTotal(currentRow)
        : nextCantidadDisponible,
      fecha: inventarioFecha,
      created_at: currentRow?.created_at ?? getNowIso(),
      devuelto_at: null,
      devuelto_automaticamente: false,
      tecnico: currentRow?.tecnico ?? tecnico ?? undefined,
      item,
    }))
  }

  if (upserts.length > 0) {
    await upsertCachedInventarioTecnico(ownerId, upserts)
  }

  await upsertCachedServicioRefacciones(ownerId, {
    serviceId: input.serviceId,
    items: nextTecnicoItems,
    replaceSource: 'tecnico',
  })

  const allServicioItems = await getCachedServicioRefaccionesSnapshot(ownerId, input.serviceId)
  const totalRefacciones = calculateRefaccionesTotal(allServicioItems)
  if (servicio) {
    await upsertCachedServicio(ownerId, {
      ...servicio,
      costo_refacciones: totalRefacciones,
      total: Number(servicio.costo_mano_obra ?? 0) + totalRefacciones,
      updated_at: getNowIso(),
    })
  }

  return {
    movementIds: [] as number[],
    totalRefacciones,
    inventarioFecha,
    rollback: {
      previousItems,
      previousService: servicio
        ? {
          status: servicio.status,
          costo_refacciones: Number(servicio.costo_refacciones ?? 0),
          total: Number(servicio.total ?? Number(servicio.costo_mano_obra ?? 0) + Number(servicio.costo_refacciones ?? 0)),
          updated_at: servicio.updated_at,
        }
        : null,
    } satisfies ServicioReplaceRefaccionesRollbackSnapshot,
  }
}

export async function restoreLocalServicioReplaceRefaccionesAfterDiscard(
  ownerId: string,
  payload: ServicioReplaceRefaccionesPayload,
) {
  if (!payload.rollback) return

  if (normalizeInventorySource(payload.inventorySource) === 'tecnico') {
    if (!payload.tecnicoId) return

    await applyLocalTecnicoServiceRefaccionesChange(ownerId, {
      serviceId: payload.serviceId,
      items: payload.rollback.previousItems,
      tecnicoId: payload.tecnicoId,
      inventarioFecha: payload.inventarioFecha,
    })
  } else {
    await applyLocalRefaccionesChange(ownerId, {
      serviceId: payload.serviceId,
      items: payload.rollback.previousItems,
      recordMovements: false,
    })
  }

  if (!payload.rollback.previousService) return

  const servicio = await getCachedServicioDetalleSnapshot(ownerId, payload.serviceId)
  if (!servicio) return

  await upsertCachedServicio(ownerId, {
    ...servicio,
    status: payload.rollback.previousService.status,
    costo_refacciones: payload.rollback.previousService.costo_refacciones,
    total: payload.rollback.previousService.total,
    updated_at: payload.rollback.previousService.updated_at,
  })
}

function isTerminalServiceStatus(status: Servicio['status'] | null | undefined): boolean {
  return status === 'completado' || status === 'cerrado'
}

function isPendingInstallationMachine(machine: Maquina | null | undefined): machine is Maquina {
  return Boolean(
    machine
    && machine.activo
    && machine.status === 'en_taller'
    && machine.cliente_id == null
    && !machine.fecha_instalacion,
  )
}

function getCommandPayloadDataMaquinaId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = (payload as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return null
  const maquinaId = (data as { maquina_id?: unknown }).maquina_id
  return typeof maquinaId === 'number' ? maquinaId : null
}

function getServiceWorkshopDate(service: Pick<Servicio, 'fecha_servicio'>): string {
  return service.fecha_servicio ?? getNowIso().slice(0, 10)
}

function buildWorkshopDetail(
  fallback: string,
  serviceId: number,
  description: string | null | undefined,
): string {
  return description ?? `${fallback} #${serviceId}`
}

async function findLatestOpenTallerRecord(ownerId: string, maquinaId: number): Promise<MaquinaEnTaller | null> {
  const rows = await offlineDb.maquinasTaller
    .where('[ownerId+maquina_id]')
    .equals([ownerId, maquinaId])
    .toArray()

  return rows
    .filter((row) => row.fecha_salida === null)
    .sort((left, right) => {
      const leftKey = `${left.fecha_entrada}|${left.id}`
      const rightKey = `${right.fecha_entrada}|${right.id}`
      return rightKey.localeCompare(leftKey)
    })[0] ?? null
}

async function findServiceWorkshopMovement(
  ownerId: string,
  serviceId: number,
  accion: MaquinaTallerMovimiento['accion'],
  motivo: string,
): Promise<MaquinaTallerMovimiento | null> {
  const rows = await offlineDb.maquinasTallerMovimientos
    .where('servicio_id')
    .equals(serviceId)
    .toArray()

  return rows.find((row) => row.ownerId === ownerId && row.accion === accion && row.motivo === motivo) ?? null
}

async function applyLocalServiceWorkshopSync(
  ownerId: string,
  previous: Servicio,
  updated: Servicio,
) {
  if (!updated.maquina_id) return
  if (!isTerminalServiceStatus(updated.status) || isTerminalServiceStatus(previous.status)) return

  const maquinaActual = updated.maquina ?? await getCachedMaquinaById(ownerId, updated.maquina_id)
  if (!maquinaActual) return

  const fechaMovimiento = getServiceWorkshopDate(updated)
  const servicioSnapshot: Servicio = updated
  const cliente = updated.cliente_id ? await getCachedClienteById(ownerId, updated.cliente_id) : null
  const usuario = await getCachedProfileById(ownerId, ownerId)
  const tipoServicio = normalizeServiceType(updated.tipo_servicio)

  if (tipoServicio.includes('URBAN')) {
    const existingMovement = await findServiceWorkshopMovement(ownerId, updated.id, 'salida', 'urban')
    if (existingMovement) return

    const openRecord = await findLatestOpenTallerRecord(ownerId, updated.maquina_id)
    const record: MaquinaEnTaller = openRecord
      ? {
          ...openRecord,
          fecha_salida: openRecord.fecha_salida ?? fechaMovimiento,
          status: 'devuelta',
          servicio_id: openRecord.servicio_id ?? updated.id,
          diagnostico: openRecord.diagnostico ?? updated.descripcion ?? null,
          maquina: {
            ...maquinaActual,
            status: 'baja',
          },
          cliente: openRecord.cliente ?? cliente ?? undefined,
          servicio: servicioSnapshot,
        }
      : {
          id: createLocalNumberId(),
          maquina_id: updated.maquina_id,
          cliente_id: updated.cliente_id,
          servicio_id: updated.id,
          orden: updated.orden,
          fecha_entrada: fechaMovimiento,
          fecha_salida: fechaMovimiento,
          diagnostico: buildWorkshopDetail('Salida a Urban por servicio', updated.id, updated.descripcion),
          status: 'devuelta',
          created_at: getNowIso(),
          maquina: {
            ...maquinaActual,
            status: 'baja',
          },
          cliente: cliente ?? undefined,
          servicio: servicioSnapshot,
        }

    const movimiento: MaquinaTallerMovimiento = {
      id: createLocalNumberId(),
      maquina_id: updated.maquina_id,
      maquina_taller_id: record.id,
      servicio_id: updated.id,
      orden_servicio: updated.orden,
      accion: 'salida',
      motivo: 'urban',
      origen: 'taller',
      destino: 'URBAN',
      detalle: buildWorkshopDetail('Salida automatica a Urban por servicio', updated.id, updated.descripcion),
      fecha_movimiento: fechaMovimiento,
      usuario_id: ownerId,
      created_at: getNowIso(),
      maquina: {
        ...maquinaActual,
        status: 'baja',
      },
      servicio: servicioSnapshot,
      usuario: usuario ?? undefined,
    }

    await Promise.all([
      upsertCachedMaquinas(ownerId, [{
        ...maquinaActual,
        status: 'baja',
      }]),
      upsertCachedMaquinasTaller(ownerId, [record]),
      upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento]),
    ])
    return
  }

  if (tipoServicio.includes('RETIRO')) {
    const existingMovement = await findServiceWorkshopMovement(ownerId, updated.id, 'entrada', 'retiro')
    if (existingMovement) return

    const openRecord = await findLatestOpenTallerRecord(ownerId, updated.maquina_id)
    const maquinaEnTaller: Maquina = {
      ...maquinaActual,
      status: 'en_taller',
      cliente_id: null,
      cliente: undefined,
    }
    const record: MaquinaEnTaller = openRecord
      ? {
          ...openRecord,
          servicio_id: openRecord.servicio_id ?? updated.id,
          orden: openRecord.orden ?? updated.orden,
          diagnostico: openRecord.diagnostico ?? updated.descripcion ?? null,
          status: 'en_taller',
          maquina: maquinaEnTaller,
          cliente: openRecord.cliente ?? cliente ?? undefined,
          servicio: servicioSnapshot,
        }
      : {
          id: createLocalNumberId(),
          maquina_id: updated.maquina_id,
          cliente_id: updated.cliente_id,
          servicio_id: updated.id,
          orden: updated.orden,
          fecha_entrada: fechaMovimiento,
          fecha_salida: null,
          diagnostico: buildWorkshopDetail('Ingreso por retiro de servicio', updated.id, updated.descripcion),
          status: 'en_taller',
          created_at: getNowIso(),
          maquina: maquinaEnTaller,
          cliente: cliente ?? undefined,
          servicio: servicioSnapshot,
        }

    const movimiento: MaquinaTallerMovimiento = {
      id: createLocalNumberId(),
      maquina_id: updated.maquina_id,
      maquina_taller_id: record.id,
      servicio_id: updated.id,
      orden_servicio: updated.orden,
      accion: 'entrada',
      motivo: 'retiro',
      origen: 'cliente',
      destino: 'taller',
      detalle: buildWorkshopDetail('Entrada automatica por retiro', updated.id, updated.descripcion),
      fecha_movimiento: fechaMovimiento,
      usuario_id: ownerId,
      created_at: getNowIso(),
      maquina: maquinaEnTaller,
      servicio: servicioSnapshot,
      usuario: usuario ?? undefined,
    }

    await Promise.all([
      upsertCachedMaquinas(ownerId, [maquinaEnTaller]),
      upsertCachedMaquinasTaller(ownerId, [record]),
      upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento]),
    ])
    return
  }

  if (tipoServicio.includes('INSTALACION')) {
    const openRecord = await findLatestOpenTallerRecord(ownerId, updated.maquina_id)
    const nextClienteId = updated.cliente_id ?? maquinaActual.cliente_id
    const nextCliente = nextClienteId ? (cliente ?? await getCachedClienteById(ownerId, nextClienteId)) : null
    const updatedMaquina: Maquina = {
      ...maquinaActual,
      status: 'operando',
      cliente_id: nextClienteId,
      fecha_instalacion: updated.fecha_servicio ?? maquinaActual.fecha_instalacion,
      cliente: nextCliente ?? maquinaActual.cliente,
    }

    const tallerUpdates = openRecord
      ? upsertCachedMaquinasTaller(ownerId, [{
          ...openRecord,
          fecha_salida: openRecord.fecha_salida ?? fechaMovimiento,
          status: 'devuelta',
          servicio_id: openRecord.servicio_id ?? updated.id,
          diagnostico: openRecord.diagnostico ?? updated.descripcion ?? null,
          maquina: updatedMaquina,
          cliente: openRecord.cliente ?? nextCliente ?? undefined,
          servicio: servicioSnapshot,
        }])
      : Promise.resolve()

    const movimiento: MaquinaTallerMovimiento = {
      id: createLocalNumberId(),
      maquina_id: updated.maquina_id,
      maquina_taller_id: openRecord?.id ?? null,
      servicio_id: updated.id,
      orden_servicio: updated.orden,
      accion: 'salida',
      motivo: 'instalacion',
      origen: openRecord ? 'taller' : 'externo',
      destino: updated.cliente_id == null ? 'cliente' : `cliente:${updated.cliente_id}`,
      detalle: buildWorkshopDetail('Salida automatica por instalacion', updated.id, updated.descripcion),
      fecha_movimiento: fechaMovimiento,
      usuario_id: ownerId,
      created_at: getNowIso(),
      maquina: updatedMaquina,
      servicio: servicioSnapshot,
      usuario: usuario ?? undefined,
    }

    await Promise.all([
      upsertCachedMaquinas(ownerId, [updatedMaquina]),
      tallerUpdates,
      upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento]),
    ])
  }
}

export async function reconcileServiceWorkshopSnapshotsAfterSync(
  ownerId: string,
  localServiceId: number,
  remoteService: Pick<Servicio, 'maquina_id'>,
) {
  try {
    const tempRows = await offlineDb.maquinasTaller.where('ownerId').equals(ownerId).toArray()
    const tempMovimientos = await offlineDb.maquinasTallerMovimientos.where('ownerId').equals(ownerId).toArray()

    const tempRowKeys = tempRows
      .filter((row) => row.servicio_id === localServiceId && isLocalNumberId(row.id))
      .map((row) => row.cacheKey)
    const tempMovimientoKeys = tempMovimientos
      .filter((row) => row.servicio_id === localServiceId && isLocalNumberId(row.id))
      .map((row) => row.cacheKey)

    if (tempRowKeys.length > 0) {
      await offlineDb.maquinasTaller.bulkDelete(tempRowKeys)
    }
    if (tempMovimientoKeys.length > 0) {
      await offlineDb.maquinasTallerMovimientos.bulkDelete(tempMovimientoKeys)
    }

    if (!remoteService.maquina_id) return

    const [maquinaResult, tallerResult, movimientosResult] = await Promise.all([
      supabase
        .from('maquinas')
        .select('*, cliente:clientes(*)')
        .eq('id', remoteService.maquina_id)
        .single(),
      supabase
        .from('maquinas_en_taller')
        .select(SELECT_MAQUINAS_TALLER)
        .eq('maquina_id', remoteService.maquina_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('maquinas_taller_movimientos')
        .select(SELECT_MOVIMIENTOS_TALLER)
        .eq('maquina_id', remoteService.maquina_id)
        .order('fecha_movimiento', { ascending: false })
        .order('created_at', { ascending: false }),
    ])

    if (!maquinaResult.error && maquinaResult.data) {
      await upsertCachedMaquinas(ownerId, [maquinaResult.data as Maquina])
    }
    if (!tallerResult.error) {
      await replaceCachedMaquinasTallerSnapshot(ownerId, (tallerResult.data ?? []) as MaquinaEnTaller[], {
        maquinaId: remoteService.maquina_id,
      })
    }
    if (!movimientosResult.error) {
      await replaceCachedMaquinasTallerMovimientosSnapshot(ownerId, (movimientosResult.data ?? []) as MaquinaTallerMovimiento[], {
        maquinaId: remoteService.maquina_id,
      })
    }
  } catch {
    // La sincronización principal ya ocurrió; no bloqueamos por una reconciliación de caché.
  }
}

async function hasLocalPendingInstallationMachineReferences(
  ownerId: string,
  maquinaIds: Set<number>,
  ignoredServiceId: number,
): Promise<boolean> {
  const [
    servicios,
    polizas,
    mantenimientos,
    maquinasTaller,
    maquinasTallerMovimientos,
    commands,
  ] = await Promise.all([
    offlineDb.servicios.where('ownerId').equals(ownerId).toArray(),
    offlineDb.polizas.where('ownerId').equals(ownerId).toArray(),
    offlineDb.mantenimientos.where('ownerId').equals(ownerId).toArray(),
    offlineDb.maquinasTaller.where('ownerId').equals(ownerId).toArray(),
    offlineDb.maquinasTallerMovimientos.where('ownerId').equals(ownerId).toArray(),
    offlineDb.commands.where('ownerId').equals(ownerId).toArray(),
  ])

  if (servicios.some((row) => row.id !== ignoredServiceId && typeof row.maquina_id === 'number' && maquinaIds.has(row.maquina_id))) return true
  if (polizas.some((row) => maquinaIds.has(row.maquina_id))) return true
  if (mantenimientos.some((row) => maquinaIds.has(row.maquina_id))) return true
  if (maquinasTaller.some((row) => maquinaIds.has(row.maquina_id))) return true
  if (maquinasTallerMovimientos.some((row) => maquinaIds.has(row.maquina_id))) return true

  return commands.some((command) => (
    command.status !== 'done'
    && command.type !== 'maquina.create'
    && (
      (command.entityType === 'maquina' && command.entityId != null && maquinaIds.has(Number(command.entityId)))
      || (() => {
        const maquinaId = getCommandPayloadDataMaquinaId(command.payload)
        return typeof maquinaId === 'number' && maquinaIds.has(maquinaId)
      })()
    )
  ))
}

async function removePendingLocalMaquinaCreateCommands(ownerId: string, maquinaIds: Set<number>) {
  const commands = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()
  const commandIds = commands
    .filter((command) => (
      command.type === 'maquina.create'
      && command.status !== 'done'
      && command.entityId != null
      && maquinaIds.has(Number(command.entityId))
    ))
    .map((command) => command.id)

  if (commandIds.length > 0) {
    await offlineDb.commands.bulkDelete(commandIds)
  }
}

async function deletePendingInstallationMachineCache(ownerId: string, maquinaIds: Set<number>) {
  if (maquinaIds.size === 0) return

  await offlineDb.maquinas.bulkDelete(
    Array.from(maquinaIds).map((maquinaId) => buildCacheKey(ownerId, maquinaId)),
  )

  const idValues = new Set(Array.from(maquinaIds).map(String))
  const links = await offlineDb.entityLinks
    .where('[ownerId+entityType]')
    .equals([ownerId, 'maquina'])
    .toArray()

  const linkKeys = links
    .filter((link) => idValues.has(link.localId) || idValues.has(link.remoteId))
    .map((link) => link.cacheKey)

  if (linkKeys.length > 0) {
    await offlineDb.entityLinks.bulkDelete(linkKeys)
  }
}

async function maybeDeletePendingInstallationMachineLocal(
  ownerId: string,
  previous: Servicio,
  updated: Servicio,
) {
  if (!isInstallationServiceType(previous.tipo_servicio) || isInstallationServiceType(updated.tipo_servicio)) return
  if (!previous.maquina_id) return
  if (updated.maquina_id === previous.maquina_id) return

  const machine = previous.maquina ?? await getCachedMaquinaById(ownerId, previous.maquina_id)
  if (!isPendingInstallationMachine(machine)) return

  const remoteId = await resolveLinkedNumberId(ownerId, 'maquina', previous.maquina_id)
  const candidateIds = new Set<number>([previous.maquina_id])
  if (remoteId) candidateIds.add(remoteId)

  if (await hasLocalPendingInstallationMachineReferences(ownerId, candidateIds, previous.id)) return

  await removePendingLocalMaquinaCreateCommands(ownerId, candidateIds)
  await deletePendingInstallationMachineCache(ownerId, candidateIds)
}

async function hasRemotePendingInstallationMachineReferences(
  maquinaId: number,
  ignoredServiceId: number,
): Promise<boolean> {
  const [
    servicios,
    polizas,
    mantenimientos,
    maquinasTaller,
    maquinasTallerMovimientos,
  ] = await Promise.all([
    supabase
      .from('servicios')
      .select('id')
      .eq('maquina_id', maquinaId)
      .neq('id', ignoredServiceId)
      .limit(1),
    supabase.from('polizas').select('id').eq('maquina_id', maquinaId).limit(1),
    supabase.from('mantenimientos_poliza').select('id').eq('maquina_id', maquinaId).limit(1),
    supabase.from('maquinas_en_taller').select('id').eq('maquina_id', maquinaId).limit(1),
    supabase.from('maquinas_taller_movimientos').select('id').eq('maquina_id', maquinaId).limit(1),
  ])

  const firstError = [
    servicios.error,
    polizas.error,
    mantenimientos.error,
    maquinasTaller.error,
    maquinasTallerMovimientos.error,
  ].find(Boolean)
  if (firstError) throw firstError

  return [
    servicios.data,
    polizas.data,
    mantenimientos.data,
    maquinasTaller.data,
    maquinasTallerMovimientos.data,
  ].some((rows) => (rows ?? []).length > 0)
}

async function maybeDeletePendingInstallationMachineRemote(
  ownerId: string,
  previous: Servicio,
  updated: Servicio,
) {
  if (!isInstallationServiceType(previous.tipo_servicio) || isInstallationServiceType(updated.tipo_servicio)) return
  if (!previous.maquina_id) return
  if (updated.maquina_id === previous.maquina_id) return

  const { data: machineRow, error: machineError } = await supabase
    .from('maquinas')
    .select('*, cliente:clientes(*)')
    .eq('id', previous.maquina_id)
    .maybeSingle()

  if (machineError || !machineRow) return

  const machine = machineRow as Maquina
  if (!isPendingInstallationMachine(machine)) return

  try {
    if (await hasRemotePendingInstallationMachineReferences(previous.maquina_id, updated.id)) return
  } catch {
    return
  }

  const { error: deleteError } = await supabase
    .from('maquinas')
    .delete()
    .eq('id', previous.maquina_id)

  if (deleteError) return

  await deletePendingInstallationMachineCache(ownerId, new Set([previous.maquina_id]))
}

export interface ServicioCreatePayload {
  localId: number
  data: CrearServicioInput
}

export interface ServicioUpdatePayload {
  serviceId: number
  data: EditarServicioInput
}

export interface ServicioReplaceRefaccionesPayload {
  serviceId: number
  items: StoredRefaccionInput[]
  localMovementIds: number[]
  inventorySource?: ServicioRefaccionesInventorySource
  tecnicoId?: string | null
  inventarioFecha?: string | null
  rollback?: ServicioReplaceRefaccionesRollbackSnapshot | null
}

export interface ServicioClosePayload {
  serviceId: number
  data: CierreInput
  localCierreId: number
  fechaCierre?: string | null
}

export interface MantenimientoCreatePayload {
  localId: number
  data: CrearMantenimientoInput
}

export interface MantenimientoUpdatePayload {
  mantenimientoId: number
  data: EditarMantenimientoInput
}

function getFechaCierreForServicio(data: CierreInput): string {
  return data.fecha_cierre ?? formatLocalIsoDate(new Date())
}

function toCierreInsertInput(data: CierreInput): Omit<CierreInput, 'fecha_cierre'> {
  const { fecha_cierre: _fechaCierre, ...cierreInput } = data
  return cierreInput
}

export interface MantenimientoReplaceRefaccionesPayload {
  mantenimientoId: number
  items: StoredRefaccionInput[]
  localMovementIds: number[]
}

export async function queueServicioCreate(ownerId: string, data: CrearServicioInput): Promise<Servicio> {
  const localId = createLocalNumberId()
  const now = getNowIso()
  const [cliente, maquina, tecnico] = await Promise.all([
    getCachedClienteById(ownerId, data.cliente_id),
    getCachedMaquinaById(ownerId, data.maquina_id),
    data.tecnico_id ? getCachedProfileById(ownerId, data.tecnico_id) : Promise.resolve(null),
  ])
  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'cliente', entityId: data.cliente_id },
    { entityType: 'maquina', entityId: data.maquina_id },
    { entityType: 'profile', entityId: data.tecnico_id },
  ])

  const servicio: Servicio = {
    id: localId,
    orden: data.orden ?? null,
    aviso: data.aviso ?? null,
    clase_orden: (data.clase_orden ?? null) as Servicio['clase_orden'],
    tipo_servicio: data.tipo_servicio as Servicio['tipo_servicio'],
    cliente_id: data.cliente_id,
    maquina_id: data.maquina_id,
    tecnico_id: data.tecnico_id ?? null,
    descripcion: data.descripcion ?? null,
    fecha_solicitud: data.fecha_solicitud,
    fecha_servicio: data.fecha_servicio ?? null,
    fecha_cierre: null,
    status: 'pendiente',
    costo_refacciones: 0,
    costo_mano_obra: data.costo_mano_obra ?? 0,
    total: Number(data.costo_mano_obra ?? 0),
    created_at: now,
    updated_at: now,
    cliente: cliente ?? undefined,
    maquina: maquina ?? undefined,
    tecnico: tecnico ?? undefined,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'servicio.create',
    entityType: 'servicio',
    entityId: localId,
    payload: {
      localId,
      data,
    } satisfies ServicioCreatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [offlineDb.commands, offlineDb.servicios, offlineDb.clientes, offlineDb.maquinas, offlineDb.profiles],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedServicio(ownerId, servicio)
    },
  )

  return servicio
}

export async function queueServicioUpdate(
  ownerId: string,
  serviceId: number,
  data: EditarServicioInput,
): Promise<Servicio> {
  const existing = await getCachedServicioDetalleSnapshot(ownerId, serviceId)
  if (!existing) {
    throw new Error('No se encontró el servicio en caché local.')
  }

  const [cliente, maquina, tecnico] = await Promise.all([
    typeof data.cliente_id === 'number' ? getCachedClienteById(ownerId, data.cliente_id) : Promise.resolve(existing.cliente ?? null),
    typeof data.maquina_id === 'number' ? getCachedMaquinaById(ownerId, data.maquina_id) : Promise.resolve(existing.maquina ?? null),
    data.tecnico_id ? getCachedProfileById(ownerId, data.tecnico_id) : Promise.resolve(existing.tecnico ?? null),
  ])

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'servicio', entityId: serviceId },
    { entityType: 'cliente', entityId: data.cliente_id },
    { entityType: 'maquina', entityId: data.maquina_id },
    { entityType: 'profile', entityId: data.tecnico_id },
  ])

  const nextCostoRefacciones = existing.costo_refacciones

  const updated: Servicio = {
    ...existing,
    ...data,
    tipo_servicio: (typeof data.tipo_servicio === 'undefined'
      ? existing.tipo_servicio
      : data.tipo_servicio) as Servicio['tipo_servicio'],
    cliente_id: typeof data.cliente_id === 'number' ? data.cliente_id : existing.cliente_id,
    maquina_id: typeof data.maquina_id === 'number' ? data.maquina_id : existing.maquina_id,
    tecnico_id: typeof data.tecnico_id === 'undefined' ? existing.tecnico_id : data.tecnico_id ?? null,
    descripcion: typeof data.descripcion === 'undefined' ? existing.descripcion : data.descripcion ?? null,
    fecha_servicio: typeof data.fecha_servicio === 'undefined' ? existing.fecha_servicio : data.fecha_servicio ?? null,
    clase_orden: (typeof data.clase_orden === 'undefined'
      ? existing.clase_orden
      : data.clase_orden ?? null) as Servicio['clase_orden'],
    fecha_cierre: existing.fecha_cierre,
    costo_refacciones: nextCostoRefacciones,
    total: Number(data.costo_mano_obra ?? existing.costo_mano_obra ?? 0) + nextCostoRefacciones,
    updated_at: getNowIso(),
    cliente: cliente ?? undefined,
    maquina: maquina ?? undefined,
    tecnico: tecnico ?? undefined,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'servicio.update',
    entityType: 'servicio',
    entityId: serviceId,
    payload: {
      serviceId,
      data,
    } satisfies ServicioUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.entityLinks,
      offlineDb.servicios,
      offlineDb.clientes,
      offlineDb.maquinas,
      offlineDb.polizas,
      offlineDb.mantenimientos,
      offlineDb.profiles,
      offlineDb.maquinasTaller,
      offlineDb.maquinasTallerMovimientos,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedServicio(ownerId, updated)
      await applyLocalServiceWorkshopSync(ownerId, existing, updated)
      await maybeDeletePendingInstallationMachineLocal(ownerId, existing, updated)
    },
  )

  return updated
}

export async function queueServicioReplaceRefaccionesCommand(
  ownerId: string,
  serviceId: number,
  items: RefaccionInput[],
  options?: QueueServicioReplaceRefaccionesOptions,
): Promise<{ commandId: string }> {
  const inventorySource = normalizeInventorySource(options?.inventorySource)
  const commandItems = inventorySource === 'tecnico'
    ? aggregateRefaccionesByInventario(items).map((item) => ({
      ...item,
      inventory_source: 'tecnico' as const,
    }))
    : items
  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'servicio', entityId: serviceId },
    ...commandItems.map((item) => ({ entityType: 'inventario', entityId: item.inventario_id })),
    ...(inventorySource === 'tecnico' ? [{ entityType: 'profile', entityId: options?.tecnicoId }] : []),
  ])

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'servicio.replace_refacciones',
    entityType: 'servicio',
    entityId: serviceId,
    payload: {
      serviceId,
      items: commandItems,
      localMovementIds: [],
      inventorySource,
      tecnicoId: options?.tecnicoId ?? null,
      inventarioFecha: options?.inventarioFecha ?? null,
      rollback: null,
    } satisfies ServicioReplaceRefaccionesPayload,
    dependsOn: dependencies,
  })

  const localRefaccionesResult = await offlineDb.transaction(
    'rw',
    inventorySource === 'tecnico'
      ? [
        offlineDb.commands,
        offlineDb.entityLinks,
        offlineDb.inventario,
        offlineDb.inventarioTecnico,
        offlineDb.servicios,
        offlineDb.servicioRefacciones,
        offlineDb.clientes,
        offlineDb.maquinas,
        offlineDb.profiles,
      ]
      : [
        offlineDb.commands,
        offlineDb.entityLinks,
        offlineDb.inventario,
        offlineDb.movimientosInventario,
        offlineDb.servicios,
        offlineDb.servicioRefacciones,
        offlineDb.clientes,
        offlineDb.maquinas,
        offlineDb.profiles,
      ],
    async () => {
      await persistOfflineCommand(command)
      if (inventorySource === 'tecnico') {
        if (!options?.tecnicoId) {
          throw new Error('No se pudo determinar el técnico para asignar refacciones al servicio.')
        }

        return applyLocalTecnicoServiceRefaccionesChange(ownerId, {
          serviceId,
          items: commandItems,
          tecnicoId: options.tecnicoId,
          inventarioFecha: options.inventarioFecha,
        })
      }

      return applyLocalRefaccionesChange(ownerId, { serviceId, items: commandItems })
    },
  )
  const movementIds = localRefaccionesResult.movementIds
  const tecnicoLocalResult = localRefaccionesResult as {
    inventarioFecha?: string | null
    rollback?: ServicioReplaceRefaccionesRollbackSnapshot | null
  }
  const inventarioFecha = typeof tecnicoLocalResult.inventarioFecha === 'string'
    ? tecnicoLocalResult.inventarioFecha
    : options?.inventarioFecha ?? null
  const rollback = tecnicoLocalResult.rollback ?? null

  command.payload = {
    serviceId,
    items: commandItems,
    localMovementIds: movementIds,
    inventorySource,
    tecnicoId: options?.tecnicoId ?? null,
    inventarioFecha: inventarioFecha ?? null,
    rollback,
  } satisfies ServicioReplaceRefaccionesPayload
  await persistOfflineCommand(command)

  return { commandId: command.id }
}

export async function queueServicioReplaceRefacciones(
  ownerId: string,
  serviceId: number,
  items: RefaccionInput[],
  options?: QueueServicioReplaceRefaccionesOptions,
): Promise<ServicioRefaccion[]> {
  await queueServicioReplaceRefaccionesCommand(ownerId, serviceId, items, options)
  return getCachedServicioRefaccionesSnapshot(ownerId, serviceId)
}

export async function queueServicioClose(
  ownerId: string,
  serviceId: number,
  data: CierreInput,
): Promise<Cierre> {
  const servicio = await getCachedServicioDetalleSnapshot(ownerId, serviceId)
  if (!servicio) {
    throw new Error('No se encontró el servicio en caché local.')
  }

  const tecnico = data.tecnico_id ? await getCachedProfileById(ownerId, data.tecnico_id) : null
  const localCierreId = createLocalNumberId()
  const fechaCierre = getFechaCierreForServicio(data)
  const cierre: Cierre = {
    id: localCierreId,
    servicio_id: serviceId,
    aviso: data.aviso ?? null,
    parte_objeto: data.parte_objeto ?? null,
    causa: data.causa ?? null,
    descripcion: data.descripcion,
    costo_total: data.costo_total ?? calculateServicioTotal(servicio),
    tecnico_id: data.tecnico_id ?? null,
    firma_receptor: data.firma_receptor ?? null,
    created_at: getNowIso(),
    servicio,
    tecnico: tecnico ?? undefined,
  }

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'servicio', entityId: serviceId },
    { entityType: 'profile', entityId: data.tecnico_id },
  ])

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'servicio.close',
    entityType: 'servicio',
    entityId: serviceId,
    payload: {
      serviceId,
      data,
      localCierreId,
      fechaCierre,
    } satisfies ServicioClosePayload,
    dependsOn: dependencies,
  })

  const closedService: Servicio = {
    ...servicio,
    fecha_cierre: fechaCierre,
    status: 'cerrado',
    updated_at: getNowIso(),
  }

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.cierres,
      offlineDb.servicios,
      offlineDb.clientes,
      offlineDb.maquinas,
      offlineDb.profiles,
      offlineDb.maquinasTaller,
      offlineDb.maquinasTallerMovimientos,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedCierres(ownerId, [cierre])
      await upsertCachedServicio(ownerId, closedService)
      await applyLocalServiceWorkshopSync(ownerId, servicio, closedService)
    },
  )

  return cierre
}

export async function queueMantenimientoCreate(
  ownerId: string,
  data: CrearMantenimientoInput,
): Promise<MantenimientoPoliza> {
  const localId = createLocalNumberId()
  const now = getNowIso()
  const [poliza, cliente, maquina, tecnico] = await Promise.all([
    getCachedPolizaById(ownerId, data.poliza_id),
    getCachedClienteById(ownerId, data.cliente_id),
    getCachedMaquinaById(ownerId, data.maquina_id),
    data.tecnico_id ? getCachedProfileById(ownerId, data.tecnico_id) : Promise.resolve(null),
  ])
  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'poliza', entityId: data.poliza_id },
    { entityType: 'cliente', entityId: data.cliente_id },
    { entityType: 'maquina', entityId: data.maquina_id },
    { entityType: 'profile', entityId: data.tecnico_id },
  ])

  const mantenimiento: MantenimientoPoliza = {
    id: localId,
    poliza_id: data.poliza_id,
    cliente_id: data.cliente_id,
    maquina_id: data.maquina_id,
    tecnico_id: data.tecnico_id ?? null,
    tipo_servicio: data.tipo_servicio,
    descripcion: data.descripcion ?? null,
    fecha_visita: data.fecha_visita ?? null,
    status: data.status ?? 'pendiente',
    costo_refacciones: data.costo_refacciones ?? 0,
    costo_mano_obra: data.costo_mano_obra ?? 0,
    total: Number(data.costo_mano_obra ?? 0) + Number(data.costo_refacciones ?? 0),
    notas: data.notas ?? null,
    created_at: now,
    poliza: poliza ?? undefined,
    cliente: cliente ?? undefined,
    maquina: maquina ?? undefined,
    tecnico: tecnico ?? undefined,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'mantenimiento.create',
    entityType: 'mantenimiento',
    entityId: localId,
    payload: {
      localId,
      data,
    } satisfies MantenimientoCreatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.mantenimientos,
      offlineDb.polizas,
      offlineDb.clientes,
      offlineDb.maquinas,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedMantenimientos(ownerId, [mantenimiento])
    },
  )

  return mantenimiento
}

export async function queueMantenimientoUpdate(
  ownerId: string,
  mantenimientoId: number,
  data: EditarMantenimientoInput,
): Promise<MantenimientoPoliza> {
  const existing = await getCachedMantenimientoDetalleSnapshot(ownerId, mantenimientoId)
  if (!existing) {
    throw new Error('No se encontró el mantenimiento en caché local.')
  }

  const [poliza, cliente, maquina, tecnico] = await Promise.all([
    typeof data.poliza_id === 'number' ? getCachedPolizaById(ownerId, data.poliza_id) : Promise.resolve(existing.poliza ?? null),
    typeof data.cliente_id === 'number' ? getCachedClienteById(ownerId, data.cliente_id) : Promise.resolve(existing.cliente ?? null),
    typeof data.maquina_id === 'number' ? getCachedMaquinaById(ownerId, data.maquina_id) : Promise.resolve(existing.maquina ?? null),
    data.tecnico_id ? getCachedProfileById(ownerId, data.tecnico_id) : Promise.resolve(existing.tecnico ?? null),
  ])

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'mantenimiento', entityId: mantenimientoId },
    { entityType: 'poliza', entityId: data.poliza_id },
    { entityType: 'cliente', entityId: data.cliente_id },
    { entityType: 'maquina', entityId: data.maquina_id },
    { entityType: 'profile', entityId: data.tecnico_id },
  ])

  const nextCostoRefacciones = typeof data.costo_refacciones === 'number'
    ? data.costo_refacciones
    : existing.costo_refacciones

  const updated: MantenimientoPoliza = {
    ...existing,
    ...data,
    poliza_id: typeof data.poliza_id === 'number' ? data.poliza_id : existing.poliza_id,
    cliente_id: typeof data.cliente_id === 'number' ? data.cliente_id : existing.cliente_id,
    maquina_id: typeof data.maquina_id === 'number' ? data.maquina_id : existing.maquina_id,
    tecnico_id: typeof data.tecnico_id === 'undefined' ? existing.tecnico_id : data.tecnico_id ?? null,
    descripcion: typeof data.descripcion === 'undefined' ? existing.descripcion : data.descripcion ?? null,
    fecha_visita: typeof data.fecha_visita === 'undefined' ? existing.fecha_visita : data.fecha_visita ?? null,
    notas: typeof data.notas === 'undefined' ? existing.notas : data.notas ?? null,
    costo_refacciones: nextCostoRefacciones,
    total: Number(data.costo_mano_obra ?? existing.costo_mano_obra ?? 0) + nextCostoRefacciones,
    poliza: poliza ?? undefined,
    cliente: cliente ?? undefined,
    maquina: maquina ?? undefined,
    tecnico: tecnico ?? undefined,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'mantenimiento.update',
    entityType: 'mantenimiento',
    entityId: mantenimientoId,
    payload: {
      mantenimientoId,
      data,
    } satisfies MantenimientoUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.mantenimientos,
      offlineDb.polizas,
      offlineDb.clientes,
      offlineDb.maquinas,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedMantenimientos(ownerId, [updated])
    },
  )

  return updated
}

export async function queueMantenimientoReplaceRefacciones(
  ownerId: string,
  mantenimientoId: number,
  items: RefaccionInput[],
): Promise<ServicioRefaccion[]> {
  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'mantenimiento', entityId: mantenimientoId },
    ...items.map((item) => ({ entityType: 'inventario', entityId: item.inventario_id })),
  ])

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'mantenimiento.replace_refacciones',
    entityType: 'mantenimiento',
    entityId: mantenimientoId,
    payload: {
      mantenimientoId,
      items,
      localMovementIds: [],
    } satisfies MantenimientoReplaceRefaccionesPayload,
    dependsOn: dependencies,
  })

  const localMantenimientoRefaccionesResult: Awaited<ReturnType<typeof applyLocalRefaccionesChange>> = await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.entityLinks,
      offlineDb.inventario,
      offlineDb.movimientosInventario,
      offlineDb.mantenimientos,
      offlineDb.servicioRefacciones,
      offlineDb.polizas,
      offlineDb.clientes,
      offlineDb.maquinas,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      return applyLocalRefaccionesChange(ownerId, { mantenimientoId, items })
    },
  )
  const { movementIds } = localMantenimientoRefaccionesResult

  command.payload = {
    mantenimientoId,
    items,
    localMovementIds: movementIds,
  } satisfies MantenimientoReplaceRefaccionesPayload
  await persistOfflineCommand(command)

  return getCachedMantenimientoRefaccionesSnapshot(ownerId, mantenimientoId)
}

export async function syncServicioCreate(ownerId: string, payload: ServicioCreatePayload) {
  const clienteId = await resolveLinkedNumberId(ownerId, 'cliente', payload.data.cliente_id)
  const maquinaId = await resolveLinkedNumberId(ownerId, 'maquina', payload.data.maquina_id)
  const tecnicoId = await resolveLinkedStringId(ownerId, 'profile', payload.data.tecnico_id ?? null)

  if (!clienteId || !maquinaId) {
    throw new Error('No se pudieron resolver las referencias remotas del servicio.')
  }

  const existing = await findRemoteServicioByOrden(payload.data.orden ?? null)
  if (existing) {
    await Promise.all([
      upsertEntityLink(ownerId, 'servicio', payload.localId, existing.id),
      upsertCachedServicio(ownerId, existing),
    ])

    return existing
  }

  const { data, error } = await supabase
    .from('servicios')
    .insert({
      ...payload.data,
      cliente_id: clienteId,
      maquina_id: maquinaId,
      tecnico_id: tecnicoId,
    })
    .select(SELECT_SERVICIO)
    .single()

  if (error) {
    if (isLikelyUniqueViolation(error)) {
      const duplicated = await findRemoteServicioByOrden(payload.data.orden ?? null)
      if (duplicated) {
        await Promise.all([
          upsertEntityLink(ownerId, 'servicio', payload.localId, duplicated.id),
          upsertCachedServicio(ownerId, duplicated),
        ])

        return duplicated
      }
    }

    throw error
  }

  const created = data as Servicio
  await Promise.all([
    upsertEntityLink(ownerId, 'servicio', payload.localId, created.id),
    upsertCachedServicio(ownerId, created),
  ])

  return created
}

export async function syncServicioUpdate(ownerId: string, payload: ServicioUpdatePayload) {
  const remoteServiceId = await resolveLinkedNumberId(ownerId, 'servicio', payload.serviceId)
  if (!remoteServiceId) {
    throw new Error('No se pudo resolver el identificador remoto del servicio.')
  }

  const previousService = await getCachedServicioDetalleSnapshot(ownerId, payload.serviceId)
  const data = { ...payload.data }
  if (typeof data.cliente_id === 'number') {
    data.cliente_id = await resolveLinkedNumberId(ownerId, 'cliente', data.cliente_id) ?? data.cliente_id
  }
  if (typeof data.maquina_id === 'number') {
    data.maquina_id = await resolveLinkedNumberId(ownerId, 'maquina', data.maquina_id) ?? data.maquina_id
  }
  if (data.tecnico_id) {
    data.tecnico_id = await resolveLinkedStringId(ownerId, 'profile', data.tecnico_id) ?? data.tecnico_id
  }

  const { data: updated, error } = await supabase
    .from('servicios')
    .update(data)
    .eq('id', remoteServiceId)
    .select(SELECT_SERVICIO)
    .single()

  if (error) throw error

  const syncedService = updated as Servicio
  await upsertCachedServicio(ownerId, syncedService)
  if (previousService) {
    await maybeDeletePendingInstallationMachineRemote(ownerId, previousService, syncedService)
  }
  await reconcileServiceWorkshopSnapshotsAfterSync(ownerId, payload.serviceId, syncedService)
  return syncedService
}

export async function syncServicioReplaceRefacciones(ownerId: string, payload: ServicioReplaceRefaccionesPayload) {
  const remoteServiceId = await resolveLinkedNumberId(ownerId, 'servicio', payload.serviceId)
  if (!remoteServiceId) {
    throw new Error('No se pudo resolver el identificador remoto del servicio.')
  }

  await assertCurrentUserCanWriteRemoteService(remoteServiceId)

  const inventorySource = normalizeInventorySource(payload.inventorySource)
  const resolvedItems = await Promise.all(
    payload.items.map(async (item) => ({
      ...item,
      inventario_id: await resolveLinkedNumberId(ownerId, 'inventario', item.inventario_id ?? null),
    })),
  )
  const items = inventorySource === 'tecnico'
    ? aggregateRefaccionesByInventario(resolvedItems).map((item) => ({
      ...item,
      inventory_source: 'tecnico' as const,
    }))
    : resolvedItems
  const currentUserId = ownerId

  if (inventorySource === 'tecnico') {
    const remoteTecnicoId = await resolveLinkedStringId(ownerId, 'profile', payload.tecnicoId)
    const inventarioFecha = payload.inventarioFecha ?? getNowIso().slice(0, 10)

    if (!remoteTecnicoId) {
      throw new Error('No se pudo resolver el técnico remoto para asignar refacciones.')
    }

    const rpcItems = items.map((item) => ({
      inventario_id: item.inventario_id,
      nombre_refaccion: item.nombre_refaccion,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
    }))
    const { data: refaccionesRows, error: rpcError } = await supabase.rpc('replace_servicio_refacciones_tecnico', {
      p_servicio_id: remoteServiceId,
      p_tecnico_id: remoteTecnicoId,
      p_fecha: inventarioFecha,
      p_items: rpcItems,
    })

    if (rpcError) throw rpcError

    const previousRollbackItems = await Promise.all(
      (payload.rollback?.previousItems ?? []).map(async (item) => ({
        ...item,
        inventario_id: await resolveLinkedNumberId(ownerId, 'inventario', item.inventario_id ?? null),
      })),
    )
    const affectedIds = Array.from(new Set([
      ...items.map((item) => item.inventario_id).filter((id): id is number => typeof id === 'number'),
      ...previousRollbackItems.map((item) => item.inventario_id).filter((id): id is number => typeof id === 'number'),
    ]))

    if (affectedIds.length > 0) {
      const { data: inventarioTecnicoRows, error: inventarioTecnicoError } = await supabase
        .from('inventario_tecnico')
        .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
        .eq('tecnico_id', remoteTecnicoId)
        .eq('fecha', inventarioFecha)
        .in('inventario_id', affectedIds)

      if (inventarioTecnicoError) throw inventarioTecnicoError
      await upsertCachedInventarioTecnico(ownerId, (inventarioTecnicoRows ?? []) as InventarioTecnico[])
    }

    const syncedRefacciones = (refaccionesRows ?? []) as ServicioRefaccion[]
    await upsertCachedServicioRefacciones(ownerId, {
      serviceId: payload.serviceId,
      items: syncedRefacciones.map(toStoredRefaccionInput),
    })

    const { data: updatedService, error: updatedServiceError } = await supabase
      .from('servicios')
      .select(SELECT_SERVICIO)
      .eq('id', remoteServiceId)
      .single()

    if (updatedServiceError) throw updatedServiceError
    await upsertCachedServicio(ownerId, updatedService as Servicio)

    return remoteServiceId
  }

    const [cachedServicio, existingRowsResult] = await Promise.all([
      getCachedServicioDetalleSnapshot(ownerId, payload.serviceId),
      supabase.from('servicio_refacciones')
        .select('inventario_id, nombre_refaccion, cantidad, precio_unitario, inventory_source')
        .eq('servicio_id', remoteServiceId),
    ])

    if (existingRowsResult.error) throw existingRowsResult.error

    const existingRows = (existingRowsResult.data ?? []) as Array<
      Pick<ServicioRefaccion, 'inventario_id' | 'nombre_refaccion' | 'cantidad' | 'precio_unitario' | 'inventory_source'>
    >
    const hasExplicitItemSources = items.some((item) => (
      typeof item.inventory_source !== 'undefined' && item.inventory_source !== null
    ))
    const previousItems = existingRows.map(toStoredRefaccionInput)
    const previousGeneralItems = previousItems.filter((row) => isGeneralInventorySource(row.inventory_source))
    const existingNonGeneralItems = previousItems.filter((row) => !isGeneralInventorySource(row.inventory_source))
    const nextItems = hasExplicitItemSources
      ? items.map((item) => ({
        ...item,
        inventory_source: normalizeInventorySource(item.inventory_source),
      }))
      : items.map((item) => ({
        ...item,
        inventory_source: 'general' as const,
      }))
    const nextGeneralItems = nextItems.filter((item) => isGeneralInventorySource(item.inventory_source))
    const nextNonGeneralItems = hasExplicitItemSources
      ? nextItems.filter((item) => !isGeneralInventorySource(item.inventory_source))
      : existingNonGeneralItems
    const nextPersistedItems = hasExplicitItemSources
      ? nextItems
      : [...existingNonGeneralItems, ...nextGeneralItems]
    const context = buildRefaccionContext({
      servicio: cachedServicio,
      serviceId: remoteServiceId,
    })

    const stockChanges = new Map<number, number>()
    previousGeneralItems.forEach((item) => {
      if (!item.inventario_id) return
      stockChanges.set(item.inventario_id, (stockChanges.get(item.inventario_id) ?? 0) + Number(item.cantidad))
    })
    nextGeneralItems.forEach((item) => {
      if (!item.inventario_id) return
      stockChanges.set(item.inventario_id, (stockChanges.get(item.inventario_id) ?? 0) - Number(item.cantidad))
    })

    const affectedIds = Array.from(stockChanges.keys())
    const originalInventarioById = new Map<number, ItemInventario>()
    const updatedInventario: ItemInventario[] = []

    if (affectedIds.length > 0) {
      const { data: inventarioRows, error: inventarioError } = await supabase
        .from('inventario')
        .select('*')
        .in('id', affectedIds)

      if (inventarioError) throw inventarioError

      const inventarioById = new Map(
        ((inventarioRows ?? []) as ItemInventario[]).map((row) => [row.id, row] as const),
      )

      for (const inventarioId of affectedIds) {
        const item = inventarioById.get(inventarioId)
        if (!item) {
          throw new Error(`No se encontró el item de inventario ${inventarioId} en el servidor.`)
        }

        const delta = stockChanges.get(inventarioId) ?? 0
        const nextStock = Number(item.stock_actual ?? 0) + delta
        if (nextStock < 0) {
          throw new Error(`Stock insuficiente para ${item.nombre}. Disponible: ${item.stock_actual}.`)
        }

        originalInventarioById.set(inventarioId, item)
        updatedInventario.push({
          ...item,
          stock_actual: nextStock,
        })
      }
    }

    type RemoteInventarioTecnicoSnapshot = Pick<
      InventarioTecnico,
      'id' | 'inventario_id' | 'cantidad' | 'cantidad_asignada_total' | 'devuelto_at' | 'devuelto_automaticamente'
    >

    const previousTecnicoItems = existingNonGeneralItems.filter((item) => normalizeInventorySource(item.inventory_source) === 'tecnico')
    const nextTecnicoItems = nextNonGeneralItems.filter((item) => normalizeInventorySource(item.inventory_source) === 'tecnico')
    const previousTecnicoByInventarioId = buildInventarioQuantityMap(previousTecnicoItems)
    const nextTecnicoByInventarioId = buildInventarioQuantityMap(nextTecnicoItems)
    const tecnicoAffectedIds = hasExplicitItemSources
      ? Array.from(new Set([
        ...previousTecnicoByInventarioId.keys(),
        ...nextTecnicoByInventarioId.keys(),
      ]))
      : []
    const originalInventarioTecnicoById = new Map<number, RemoteInventarioTecnicoSnapshot | null>()
    const nextInventarioTecnicoRows: Array<{
      tecnico_id: string
      inventario_id: number
      cantidad: number
      cantidad_asignada_total: number
      fecha: string
      devuelto_at: null
      devuelto_automaticamente: false
    }> = []
    let remoteTecnicoIdForRefacciones: string | null = null
    let inventarioFechaForTecnico: string | null = null

    if (tecnicoAffectedIds.length > 0) {
      let servicioTecnicoId = payload.tecnicoId ?? cachedServicio?.tecnico_id ?? null
      let servicioFecha = payload.inventarioFecha ?? cachedServicio?.fecha_servicio ?? null

      if (!servicioTecnicoId || !servicioFecha) {
        const { data: servicioAssignment, error: servicioAssignmentError } = await supabase
          .from('servicios')
          .select('tecnico_id, fecha_servicio')
          .eq('id', remoteServiceId)
          .single()

        if (servicioAssignmentError) throw servicioAssignmentError
        servicioTecnicoId = servicioTecnicoId ?? servicioAssignment?.tecnico_id ?? null
        servicioFecha = servicioFecha ?? servicioAssignment?.fecha_servicio ?? null
      }

      remoteTecnicoIdForRefacciones = await resolveLinkedStringId(ownerId, 'profile', servicioTecnicoId)
      inventarioFechaForTecnico = servicioFecha ?? getNowIso().slice(0, 10)

      if (!remoteTecnicoIdForRefacciones) {
        throw new Error('No se pudo determinar el técnico para modificar refacciones de inventario técnico.')
      }

      const { data: inventarioTecnicoRows, error: inventarioTecnicoError } = await supabase
        .from('inventario_tecnico')
        .select('id, inventario_id, cantidad, cantidad_asignada_total, devuelto_at, devuelto_automaticamente')
        .eq('tecnico_id', remoteTecnicoIdForRefacciones)
        .eq('fecha', inventarioFechaForTecnico)
        .is('devuelto_at', null)
        .in('inventario_id', tecnicoAffectedIds)

      if (inventarioTecnicoError) throw inventarioTecnicoError

      const inventarioTecnicoById = new Map(
        ((inventarioTecnicoRows ?? []) as RemoteInventarioTecnicoSnapshot[])
          .map((row) => [row.inventario_id, row] as const),
      )

      for (const inventarioId of tecnicoAffectedIds) {
        const currentRow = inventarioTecnicoById.get(inventarioId) ?? null
        originalInventarioTecnicoById.set(inventarioId, currentRow)

        const currentCantidad = currentRow?.cantidad ?? 0
        const previousCantidad = previousTecnicoByInventarioId.get(inventarioId) ?? 0
        const nextCantidadAsignada = nextTecnicoByInventarioId.get(inventarioId) ?? 0
        const nextCantidadDisponible = currentCantidad + previousCantidad - nextCantidadAsignada

        if (nextCantidadDisponible < 0) {
          throw new Error(`Inventario técnico insuficiente para sincronizar la refacción ${inventarioId}.`)
        }

        if (!currentRow && nextCantidadDisponible === 0) {
          continue
        }

        nextInventarioTecnicoRows.push({
          tecnico_id: remoteTecnicoIdForRefacciones,
          inventario_id: inventarioId,
          cantidad: nextCantidadDisponible,
          cantidad_asignada_total: currentRow
            ? getInventarioTecnicoAssignedTotal(normalizeInventarioTecnicoRow(currentRow))
            : nextCantidadDisponible,
          fecha: inventarioFechaForTecnico,
          devuelto_at: null,
          devuelto_automaticamente: false,
        })
      }
    }

    const movementPayload = [
      ...previousGeneralItems
        .filter((item) => item.inventario_id != null)
        .map((item) => ({
          inventario_id: item.inventario_id!,
          tipo: 'correccion_instalacion' as const,
          cantidad: Number(item.cantidad),
          motivo: `${context.refKey} Corrección de instalación a ${context.ubicacion}`,
          referencia_id: remoteServiceId,
          usuario_id: currentUserId,
        })),
      ...nextGeneralItems
        .filter((item) => item.inventario_id != null)
        .map((item) => ({
          inventario_id: item.inventario_id!,
          tipo: 'instalacion_refaccion' as const,
          cantidad: Number(item.cantidad),
          motivo: `${context.refKey} Instalación a ${context.ubicacion}`,
          referencia_id: remoteServiceId,
          usuario_id: currentUserId,
        })),
    ]

    let refaccionesUpdated = false
    let inventarioUpdated = false
    let tecnicoInventoryUpdated = false
    let costoActualizado = false
    let syncedMovementIds: number[] = []
    const previousTotalRefacciones = calculateRefaccionesTotal(previousItems)

    const rollbackRemoteState = async () => {
      if (syncedMovementIds.length > 0) {
        await supabase
          .from('movimientos_inventario')
          .delete()
          .in('id', syncedMovementIds)
      }

      if (costoActualizado) {
        await supabase
          .from('servicios')
          .update({ costo_refacciones: previousTotalRefacciones })
          .eq('id', remoteServiceId)
      }

      if (inventarioUpdated && originalInventarioById.size > 0) {
        for (const [inventarioId, item] of originalInventarioById.entries()) {
          await supabase
            .from('inventario')
            .update({ stock_actual: item.stock_actual })
            .eq('id', inventarioId)
        }
      }

      if (tecnicoInventoryUpdated && remoteTecnicoIdForRefacciones && inventarioFechaForTecnico) {
        for (const [inventarioId, row] of originalInventarioTecnicoById.entries()) {
          if (row) {
            await supabase
              .from('inventario_tecnico')
              .update({
                cantidad: row.cantidad,
                cantidad_asignada_total: row.cantidad_asignada_total,
                devuelto_at: row.devuelto_at,
                devuelto_automaticamente: row.devuelto_automaticamente,
              })
              .eq('id', row.id)
          } else {
            await supabase
              .from('inventario_tecnico')
              .delete()
              .eq('tecnico_id', remoteTecnicoIdForRefacciones)
              .eq('inventario_id', inventarioId)
              .eq('fecha', inventarioFechaForTecnico)
          }
        }
      }

      if (refaccionesUpdated) {
        let rollbackDeleteQuery = supabase.from('servicio_refacciones')
          .delete()
          .eq('servicio_id', remoteServiceId)

        if (!hasExplicitItemSources) {
          rollbackDeleteQuery = rollbackDeleteQuery.or(GENERAL_SERVICE_REFACCIONES_REMOTE_FILTER)
        }

        const deleteRollback = await rollbackDeleteQuery
        const rollbackItems = hasExplicitItemSources ? previousItems : previousGeneralItems

        if (!deleteRollback.error && rollbackItems.length > 0) {
          await supabase.from('servicio_refacciones')
            .insert(
              rollbackItems.map((item) => ({
                servicio_id: remoteServiceId,
                inventario_id: item.inventario_id ?? null,
                nombre_refaccion: item.nombre_refaccion,
                cantidad: item.cantidad,
                precio_unitario: item.precio_unitario,
                inventory_source: normalizeInventorySource(item.inventory_source),
              })),
            )
        }
      }
    }

    let syncedMovements: MovimientoInventario[] = []
    const totalRefacciones = calculateRefaccionesTotal(nextPersistedItems)

    try {
      let deleteRefaccionesQuery = supabase.from('servicio_refacciones')
        .delete()
        .eq('servicio_id', remoteServiceId)

      if (!hasExplicitItemSources) {
        deleteRefaccionesQuery = deleteRefaccionesQuery.or(GENERAL_SERVICE_REFACCIONES_REMOTE_FILTER)
      }

      const { error: deleteGeneralError } = await deleteRefaccionesQuery
      if (deleteGeneralError) throw deleteGeneralError
      refaccionesUpdated = true

      const insertItems = hasExplicitItemSources ? nextPersistedItems : nextGeneralItems
      if (insertItems.length > 0) {
        const { error: insertGeneralError } = await supabase.from('servicio_refacciones')
          .insert(
            insertItems.map((item) => ({
              servicio_id: remoteServiceId,
              inventario_id: item.inventario_id ?? null,
              nombre_refaccion: item.nombre_refaccion,
              cantidad: item.cantidad,
              precio_unitario: item.precio_unitario,
              inventory_source: normalizeInventorySource(item.inventory_source),
            })),
          )

        if (insertGeneralError) throw insertGeneralError
      }

      for (const item of updatedInventario) {
        const { error: updateInventarioError } = await supabase
          .from('inventario')
          .update({ stock_actual: item.stock_actual })
          .eq('id', item.id)

        if (updateInventarioError) throw updateInventarioError
      }
      inventarioUpdated = updatedInventario.length > 0

      for (const item of nextInventarioTecnicoRows) {
        const originalRow = originalInventarioTecnicoById.get(item.inventario_id) ?? null

        if (originalRow) {
          const { error: updateInventarioTecnicoError } = await supabase
            .from('inventario_tecnico')
            .update(item)
            .eq('id', originalRow.id)

          if (updateInventarioTecnicoError) throw updateInventarioTecnicoError
        } else {
          const { error: upsertInventarioTecnicoError } = await supabase
            .from('inventario_tecnico')
            .upsert(item, { onConflict: 'tecnico_id,inventario_id,fecha' })

          if (upsertInventarioTecnicoError) throw upsertInventarioTecnicoError
        }
      }
      tecnicoInventoryUpdated = nextInventarioTecnicoRows.length > 0

      if (movementPayload.length > 0) {
        const { data: movementRows, error: movementError } = await supabase.from('movimientos_inventario')
          .insert(movementPayload)
          .select('*')

        if (movementError) throw movementError
        syncedMovements = (movementRows ?? []) as MovimientoInventario[]
        syncedMovementIds = syncedMovements.map((movement) => movement.id)
      }

      const { error: serviceError } = await supabase.from('servicios')
        .update({ costo_refacciones: totalRefacciones })
        .eq('id', remoteServiceId)

      if (serviceError) throw serviceError
      costoActualizado = true
    } catch (error) {
      await rollbackRemoteState()
      throw error
    }

    if (updatedInventario.length > 0) {
      await upsertCachedInventario(ownerId, updatedInventario)
    }
    if (syncedMovements.length > 0) {
      await upsertCachedMovimientosInventario(ownerId, syncedMovements)
    }

    await upsertCachedServicioRefacciones(ownerId, {
      serviceId: payload.serviceId,
      items: nextPersistedItems,
    })

    const servicio = cachedServicio ?? await getCachedServicioDetalleSnapshot(ownerId, payload.serviceId)
    if (servicio) {
      await upsertCachedServicio(ownerId, {
        ...servicio,
        costo_refacciones: totalRefacciones,
        total: Number(servicio.costo_mano_obra ?? 0) + totalRefacciones,
        updated_at: getNowIso(),
      })
    }

    return remoteServiceId
}

export async function syncServicioClose(ownerId: string, payload: ServicioClosePayload) {
  const remoteServiceId = await resolveLinkedNumberId(ownerId, 'servicio', payload.serviceId)
  const remoteTecnicoId = await resolveLinkedStringId(ownerId, 'profile', payload.data.tecnico_id)
  const fechaCierre = payload.fechaCierre ?? getFechaCierreForServicio(payload.data)

  if (!remoteServiceId || !remoteTecnicoId) {
    throw new Error('No se pudieron resolver las referencias remotas para cerrar el servicio.')
  }

  const existingCierre = await findRemoteCierreByServicioId(remoteServiceId)
  if (existingCierre) {
    const { data: currentService, error: currentServiceError } = await supabase
      .from('servicios')
      .select(SELECT_SERVICIO)
      .eq('id', remoteServiceId)
      .single()

    if (currentServiceError) throw currentServiceError

    let syncedService = currentService as Servicio
    if (syncedService.status !== 'cerrado' || syncedService.fecha_cierre !== fechaCierre) {
      const { data: closedService, error: closeError } = await supabase
        .from('servicios')
        .update({
          status: 'cerrado',
          fecha_cierre: fechaCierre,
        })
        .eq('id', remoteServiceId)
        .select(SELECT_SERVICIO)
        .single()

      if (closeError) throw closeError
      syncedService = closedService as Servicio
    }

    await Promise.all([
      upsertCachedCierres(ownerId, [existingCierre]),
      upsertCachedServicio(ownerId, syncedService),
    ])
    await reconcileServiceWorkshopSnapshotsAfterSync(ownerId, payload.serviceId, syncedService)
    return existingCierre
  }

  const { data: cierre, error: cierreError } = await supabase
    .from('cierres')
    .insert({
      ...toCierreInsertInput(payload.data),
      servicio_id: remoteServiceId,
      tecnico_id: remoteTecnicoId,
    })
    .select()
    .single()

  if (cierreError) {
    if (isLikelyUniqueViolation(cierreError)) {
      const duplicated = await findRemoteCierreByServicioId(remoteServiceId)
      if (duplicated) {
        const { data: updatedService, error: duplicatedServiceError } = await supabase
          .from('servicios')
          .select(SELECT_SERVICIO)
          .eq('id', remoteServiceId)
          .single()

        if (duplicatedServiceError) throw duplicatedServiceError

        let syncedService = updatedService as Servicio
        if (syncedService.status !== 'cerrado' || syncedService.fecha_cierre !== fechaCierre) {
          const { data: closedService, error: closeError } = await supabase
            .from('servicios')
            .update({
              status: 'cerrado',
              fecha_cierre: fechaCierre,
            })
            .eq('id', remoteServiceId)
            .select(SELECT_SERVICIO)
            .single()

          if (closeError) throw closeError
          syncedService = closedService as Servicio
        }

        await Promise.all([
          upsertCachedCierres(ownerId, [duplicated]),
          upsertCachedServicio(ownerId, syncedService),
        ])
        await reconcileServiceWorkshopSnapshotsAfterSync(ownerId, payload.serviceId, syncedService)
        return duplicated
      }
    }

    throw cierreError
  }

  const { error: statusError } = await supabase
    .from('servicios')
    .update({
      status: 'cerrado',
      fecha_cierre: fechaCierre,
    })
    .eq('id', remoteServiceId)
  if (statusError) throw statusError

  const { data: updatedService, error: serviceError } = await supabase
    .from('servicios')
    .select(SELECT_SERVICIO)
    .eq('id', remoteServiceId)
    .single()
  if (serviceError) throw serviceError

  const syncedService = updatedService as Servicio
  await Promise.all([
    upsertCachedCierres(ownerId, [cierre as Cierre]),
    upsertCachedServicio(ownerId, syncedService),
  ])
  await reconcileServiceWorkshopSnapshotsAfterSync(ownerId, payload.serviceId, syncedService)
  return cierre as Cierre
}

export async function syncMantenimientoCreate(ownerId: string, payload: MantenimientoCreatePayload) {
  const polizaId = await resolveLinkedNumberId(ownerId, 'poliza', payload.data.poliza_id)
  const clienteId = await resolveLinkedNumberId(ownerId, 'cliente', payload.data.cliente_id)
  const maquinaId = await resolveLinkedNumberId(ownerId, 'maquina', payload.data.maquina_id)
  const tecnicoId = await resolveLinkedStringId(ownerId, 'profile', payload.data.tecnico_id ?? null)

  if (!polizaId || !clienteId || !maquinaId) {
    throw new Error('No se pudieron resolver las referencias remotas del mantenimiento.')
  }

  const { data, error } = await supabase
    .from('mantenimientos_poliza')
    .insert({
      ...payload.data,
      poliza_id: polizaId,
      cliente_id: clienteId,
      maquina_id: maquinaId,
      tecnico_id: tecnicoId,
    })
    .select(SELECT_MANTENIMIENTO)
    .single()
  if (error) throw error

  const created = data as MantenimientoPoliza
  await Promise.all([
    upsertEntityLink(ownerId, 'mantenimiento', payload.localId, created.id),
    upsertCachedMantenimientos(ownerId, [created]),
  ])

  return created
}

export async function syncMantenimientoUpdate(ownerId: string, payload: MantenimientoUpdatePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'mantenimiento', payload.mantenimientoId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del mantenimiento.')
  }

  const data = { ...payload.data }
  if (typeof data.poliza_id === 'number') {
    data.poliza_id = await resolveLinkedNumberId(ownerId, 'poliza', data.poliza_id) ?? data.poliza_id
  }
  if (typeof data.cliente_id === 'number') {
    data.cliente_id = await resolveLinkedNumberId(ownerId, 'cliente', data.cliente_id) ?? data.cliente_id
  }
  if (typeof data.maquina_id === 'number') {
    data.maquina_id = await resolveLinkedNumberId(ownerId, 'maquina', data.maquina_id) ?? data.maquina_id
  }
  if (data.tecnico_id) {
    data.tecnico_id = await resolveLinkedStringId(ownerId, 'profile', data.tecnico_id) ?? data.tecnico_id
  }

  const { data: updated, error } = await supabase
    .from('mantenimientos_poliza')
    .update(data)
    .eq('id', remoteId)
    .select(SELECT_MANTENIMIENTO)
    .single()
  if (error) throw error

  await upsertCachedMantenimientos(ownerId, [updated as MantenimientoPoliza])
  return updated as MantenimientoPoliza
}

export async function syncMantenimientoReplaceRefacciones(
  ownerId: string,
  payload: MantenimientoReplaceRefaccionesPayload,
) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'mantenimiento', payload.mantenimientoId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del mantenimiento.')
  }

  const items = await Promise.all(
    payload.items.map(async (item) => ({
      ...item,
      inventario_id: await resolveLinkedNumberId(ownerId, 'inventario', item.inventario_id ?? null),
    })),
  )

  const { error: deleteError } = await supabase.from('servicio_refacciones')
    .delete()
    .eq('mantenimiento_id', remoteId)

  if (deleteError) throw deleteError

  if (items.length > 0) {
    const { error: insertError } = await supabase.from('servicio_refacciones')
      .insert(
        items.map((item) => ({
          servicio_id: null,
          mantenimiento_id: remoteId,
          inventario_id: item.inventario_id ?? null,
          nombre_refaccion: item.nombre_refaccion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          inventory_source: 'general',
        })),
      )

    if (insertError) throw insertError
  }

  return remoteId
}
