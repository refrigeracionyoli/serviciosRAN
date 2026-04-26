import Dexie, { type Table } from 'dexie'
import type {
  Cierre,
  Cliente,
  Evidencia,
  InventarioTecnico,
  ItemInventario,
  MaquinaEnTaller,
  MaquinaTallerMovimiento,
  MantenimientoPoliza,
  Maquina,
  MovimientoInventario,
  Poliza,
  PolizaEstadoHistorial,
  PolizaPausa,
  Profile,
  RefaccionInventorySource,
  Servicio,
} from '@/types/domain.types'
import type { RefaccionInput } from '@/schemas/inventario.schema'

export type CachedSyncStatus = 'synced' | 'pending' | 'failed'
export type OfflineCommandStatus = 'pending' | 'syncing' | 'failed' | 'conflict' | 'done'
export type OfflineCommandType =
  | 'cliente.create'
  | 'cliente.update'
  | 'cliente.delete'
  | 'maquina.create'
  | 'maquina.update'
  | 'profile.create'
  | 'profile.update'
  | 'profile.reset_password'
  | 'servicio.create'
  | 'servicio.update'
  | 'servicio.replace_refacciones'
  | 'servicio.close'
  | 'service.complete_with_refacciones'
  | 'service.update_status'
  | 'service.add_evidencia'
  | 'service.delete_evidencia'
  | 'poliza.create'
  | 'poliza.update'
  | 'poliza.set_active'
  | 'poliza.delete'
  | 'poliza_pause.create'
  | 'poliza_pause.resume'
  | 'mantenimiento.create'
  | 'mantenimiento.update'
  | 'mantenimiento.replace_refacciones'
  | 'inventario.create'
  | 'inventario.update'
  | 'inventario.set_active'
  | 'inventario.adjust'
  | 'inventario_tecnico.upsert'
  | 'inventario_tecnico.delete'
  | 'taller.registrar_entrada'
  | 'taller.registrar_salida'
  | 'taller.reubicacion'

export interface CachedRecordBase {
  cacheKey: string
  ownerId: string
  cachedAt: string
}

export interface CachedProfileRecord extends CachedRecordBase, Profile {}

export interface CachedClienteRecord extends CachedRecordBase, Cliente {}

export interface CachedMaquinaRecord extends CachedRecordBase, Maquina {}

export interface CachedInventarioRecord extends CachedRecordBase, ItemInventario {}

export interface CachedInventarioTecnicoRecord extends CachedRecordBase, InventarioTecnico {}

export interface CachedPolizaRecord extends CachedRecordBase, Poliza {}

export interface CachedPolizaEstadoHistorialRecord extends CachedRecordBase, PolizaEstadoHistorial {}

export interface CachedPolizaPausaRecord extends CachedRecordBase, PolizaPausa {}

export interface CachedMantenimientoRecord extends CachedRecordBase, MantenimientoPoliza {}

export interface CachedCierreRecord extends CachedRecordBase, Cierre {}

export interface CachedMovimientoInventarioRecord extends CachedRecordBase, MovimientoInventario {}

export interface CachedMaquinaTallerRecord extends CachedRecordBase, MaquinaEnTaller {}

export interface CachedMaquinaTallerMovimientoRecord extends CachedRecordBase, MaquinaTallerMovimiento {}

export interface CachedServicioRecord extends CachedRecordBase, Servicio {
  pendingSync: boolean
  pendingCommandId: string | null
  offlineUpdatedAt: string | null
}

export interface CachedServicioRefaccionRecord extends CachedRecordBase, RefaccionInput {
  serviceId: number | null
  mantenimientoId: number | null
  syncStatus: CachedSyncStatus
  localCommandId: string | null
  inventory_source: RefaccionInventorySource
}

export interface CachedEvidenciaRecord extends CachedRecordBase, Evidencia {
  syncStatus: CachedSyncStatus
  localAttachmentId: string | null
  localCommandId: string | null
}

export interface OfflineAttachmentRecord {
  id: string
  ownerId: string
  commandId: string | null
  filename: string
  mimeType: string
  size: number
  blob: Blob
  sha256: string | null
  createdAt: string
}

export interface OfflineCommandRecord {
  id: string
  ownerId: string
  type: OfflineCommandType
  status: OfflineCommandStatus
  payload: unknown
  entityType: string
  entityId: string | null
  localOnlyId: string | null
  createdAt: string
  updatedAt: string
  retryCount: number
  lastError: string | null
  idempotencyKey: string
  dependsOn: string[]
}

export interface OfflineSyncLogRecord {
  id?: number
  ownerId: string
  commandId: string | null
  level: 'info' | 'error'
  message: string
  createdAt: string
}

export interface OfflineEntityLinkRecord {
  cacheKey: string
  ownerId: string
  entityType: string
  localId: string
  remoteId: string
  createdAt: string
  updatedAt: string
}

const OFFLINE_DB_NAME = 'servicios-ran-offline'
const OFFLINE_DB_HEALTH_TTL_MS = 2000
let lastOfflineDbReadyCheckAt = 0

const REQUIRED_OFFLINE_STORES = [
  'profiles',
  'clientes',
  'maquinas',
  'inventario',
  'inventarioTecnico',
  'polizas',
  'polizaEstadoHistorial',
  'polizaPausas',
  'mantenimientos',
  'cierres',
  'movimientosInventario',
  'maquinasTaller',
  'maquinasTallerMovimientos',
  'servicios',
  'servicioRefacciones',
  'evidencias',
  'attachments',
  'commands',
  'syncLog',
  'entityLinks',
] as const

class OfflineServicesRanDB extends Dexie {
  profiles!: Table<CachedProfileRecord, string>
  clientes!: Table<CachedClienteRecord, string>
  maquinas!: Table<CachedMaquinaRecord, string>
  inventario!: Table<CachedInventarioRecord, string>
  inventarioTecnico!: Table<CachedInventarioTecnicoRecord, string>
  polizas!: Table<CachedPolizaRecord, string>
  polizaEstadoHistorial!: Table<CachedPolizaEstadoHistorialRecord, string>
  polizaPausas!: Table<CachedPolizaPausaRecord, string>
  mantenimientos!: Table<CachedMantenimientoRecord, string>
  cierres!: Table<CachedCierreRecord, string>
  movimientosInventario!: Table<CachedMovimientoInventarioRecord, string>
  maquinasTaller!: Table<CachedMaquinaTallerRecord, string>
  maquinasTallerMovimientos!: Table<CachedMaquinaTallerMovimientoRecord, string>
  servicios!: Table<CachedServicioRecord, string>
  servicioRefacciones!: Table<CachedServicioRefaccionRecord, string>
  evidencias!: Table<CachedEvidenciaRecord, string>
  attachments!: Table<OfflineAttachmentRecord, string>
  commands!: Table<OfflineCommandRecord, string>
  syncLog!: Table<OfflineSyncLogRecord, number>
  entityLinks!: Table<OfflineEntityLinkRecord, string>

  constructor() {
    super(OFFLINE_DB_NAME)

    this.version(1).stores({
      profiles: '&cacheKey, ownerId, id, [ownerId+id], nombre',
      clientes: '&cacheKey, ownerId, id, [ownerId+id], nombre, codigo_cliente, activo',
      maquinas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, serie, modelo, status, activo',
      inventario: '&cacheKey, ownerId, id, [ownerId+id], nombre, activo',
      inventarioTecnico: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, fecha, [ownerId+tecnico_id], [ownerId+fecha], [ownerId+tecnico_id+fecha]',
      servicios: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, status, fecha_servicio, cliente_id, updated_at, pendingSync',
      servicioRefacciones: '&cacheKey, ownerId, serviceId, mantenimientoId, [ownerId+serviceId], [ownerId+mantenimientoId], syncStatus',
      evidencias: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, [ownerId+servicio_id], created_at, syncStatus, localCommandId',
      attachments: '&id, ownerId, commandId, [ownerId+commandId], createdAt',
      commands: '&id, ownerId, status, [ownerId+status], [ownerId+createdAt], createdAt, entityType, entityId',
      syncLog: '++id, ownerId, commandId, [ownerId+createdAt], createdAt, level',
    })

    this.version(2).stores({
      profiles: '&cacheKey, ownerId, id, [ownerId+id], nombre',
      clientes: '&cacheKey, ownerId, id, [ownerId+id], nombre, codigo_cliente, activo',
      maquinas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, serie, modelo, status, activo',
      inventario: '&cacheKey, ownerId, id, [ownerId+id], nombre, activo',
      inventarioTecnico: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, fecha, [ownerId+tecnico_id], [ownerId+fecha], [ownerId+tecnico_id+fecha]',
      polizas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, maquina_id, activa, fecha_inicio',
      mantenimientos: '&cacheKey, ownerId, id, [ownerId+id], poliza_id, cliente_id, maquina_id, tecnico_id, status, fecha_visita',
      cierres: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, tecnico_id, created_at',
      servicios: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, status, fecha_servicio, cliente_id, updated_at, pendingSync',
      servicioRefacciones: '&cacheKey, ownerId, serviceId, mantenimientoId, [ownerId+serviceId], [ownerId+mantenimientoId], syncStatus',
      evidencias: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, [ownerId+servicio_id], created_at, syncStatus, localCommandId',
      attachments: '&id, ownerId, commandId, [ownerId+commandId], createdAt',
      commands: '&id, ownerId, status, [ownerId+status], [ownerId+createdAt], createdAt, entityType, entityId',
      syncLog: '++id, ownerId, commandId, [ownerId+createdAt], createdAt, level',
    })

    this.version(3).stores({
      profiles: '&cacheKey, ownerId, id, [ownerId+id], nombre',
      clientes: '&cacheKey, ownerId, id, [ownerId+id], nombre, codigo_cliente, activo',
      maquinas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, serie, modelo, status, activo',
      inventario: '&cacheKey, ownerId, id, [ownerId+id], nombre, activo',
      inventarioTecnico: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, fecha, [ownerId+tecnico_id], [ownerId+fecha], [ownerId+tecnico_id+fecha]',
      polizas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, maquina_id, activa, fecha_inicio',
      polizaEstadoHistorial: '&cacheKey, ownerId, id, [ownerId+id], poliza_id, [ownerId+poliza_id], changed_at',
      mantenimientos: '&cacheKey, ownerId, id, [ownerId+id], poliza_id, cliente_id, maquina_id, tecnico_id, status, fecha_visita',
      cierres: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, tecnico_id, created_at',
      movimientosInventario: '&cacheKey, ownerId, id, [ownerId+id], inventario_id, [ownerId+inventario_id], tipo, created_at',
      maquinasTaller: '&cacheKey, ownerId, id, [ownerId+id], maquina_id, servicio_id, fecha_salida, status, [ownerId+maquina_id]',
      maquinasTallerMovimientos: '&cacheKey, ownerId, id, [ownerId+id], maquina_id, maquina_taller_id, servicio_id, accion, fecha_movimiento, [ownerId+maquina_id], [ownerId+maquina_taller_id]',
      servicios: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, status, fecha_servicio, cliente_id, updated_at, pendingSync',
      servicioRefacciones: '&cacheKey, ownerId, serviceId, mantenimientoId, [ownerId+serviceId], [ownerId+mantenimientoId], syncStatus',
      evidencias: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, [ownerId+servicio_id], created_at, syncStatus, localCommandId',
      attachments: '&id, ownerId, commandId, [ownerId+commandId], createdAt',
      commands: '&id, ownerId, status, [ownerId+status], [ownerId+createdAt], createdAt, entityType, entityId',
      syncLog: '++id, ownerId, commandId, [ownerId+createdAt], createdAt, level',
      entityLinks: '&cacheKey, ownerId, entityType, localId, remoteId, [ownerId+entityType], [ownerId+entityType+localId], [ownerId+entityType+remoteId]',
    })

    this.version(4).stores({
      profiles: '&cacheKey, ownerId, id, [ownerId+id], nombre',
      clientes: '&cacheKey, ownerId, id, [ownerId+id], nombre, codigo_cliente, activo',
      maquinas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, serie, modelo, status, activo',
      inventario: '&cacheKey, ownerId, id, [ownerId+id], nombre, activo',
      inventarioTecnico: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, fecha, [ownerId+tecnico_id], [ownerId+fecha], [ownerId+tecnico_id+fecha]',
      polizas: '&cacheKey, ownerId, id, [ownerId+id], cliente_id, maquina_id, activa, fecha_inicio',
      polizaEstadoHistorial: '&cacheKey, ownerId, id, [ownerId+id], poliza_id, [ownerId+poliza_id], changed_at',
      polizaPausas: '&cacheKey, ownerId, id, [ownerId+id], fecha_inicio, fecha_reanudacion',
      mantenimientos: '&cacheKey, ownerId, id, [ownerId+id], poliza_id, cliente_id, maquina_id, tecnico_id, status, fecha_visita',
      cierres: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, tecnico_id, created_at',
      movimientosInventario: '&cacheKey, ownerId, id, [ownerId+id], inventario_id, [ownerId+inventario_id], tipo, created_at',
      maquinasTaller: '&cacheKey, ownerId, id, [ownerId+id], maquina_id, servicio_id, fecha_salida, status, [ownerId+maquina_id]',
      maquinasTallerMovimientos: '&cacheKey, ownerId, id, [ownerId+id], maquina_id, maquina_taller_id, servicio_id, accion, fecha_movimiento, [ownerId+maquina_id], [ownerId+maquina_taller_id]',
      servicios: '&cacheKey, ownerId, id, [ownerId+id], tecnico_id, status, fecha_servicio, cliente_id, updated_at, pendingSync',
      servicioRefacciones: '&cacheKey, ownerId, serviceId, mantenimientoId, [ownerId+serviceId], [ownerId+mantenimientoId], syncStatus',
      evidencias: '&cacheKey, ownerId, id, [ownerId+id], servicio_id, [ownerId+servicio_id], created_at, syncStatus, localCommandId',
      attachments: '&id, ownerId, commandId, [ownerId+commandId], createdAt',
      commands: '&id, ownerId, status, [ownerId+status], [ownerId+createdAt], createdAt, entityType, entityId',
      syncLog: '++id, ownerId, commandId, [ownerId+createdAt], createdAt, level',
      entityLinks: '&cacheKey, ownerId, entityType, localId, remoteId, [ownerId+entityType], [ownerId+entityType+localId], [ownerId+entityType+remoteId]',
    })
  }
}

export const offlineDb = new OfflineServicesRanDB()

function getMissingOfflineStores(): string[] {
  const backendDb = offlineDb.backendDB()
  if (!backendDb) {
    return [...REQUIRED_OFFLINE_STORES]
  }

  return REQUIRED_OFFLINE_STORES.filter((storeName) => !backendDb.objectStoreNames.contains(storeName))
}

export async function resetOfflineDb() {
  offlineDb.close()
  await offlineDb.delete()
  await offlineDb.open()
  lastOfflineDbReadyCheckAt = Date.now()
}

export async function ensureOfflineDbReady(options?: { recover?: boolean }) {
  if (!offlineDb.isOpen()) {
    await offlineDb.open()
  }

  let missingStores = getMissingOfflineStores()
  if (missingStores.length === 0) {
    lastOfflineDbReadyCheckAt = Date.now()
    return
  }

  offlineDb.close()
  await offlineDb.open()

  missingStores = getMissingOfflineStores()
  if (missingStores.length === 0) {
    lastOfflineDbReadyCheckAt = Date.now()
    return
  }

  if (!options?.recover) {
    throw new Error(`Faltan estructuras offline requeridas: ${missingStores.join(', ')}`)
  }

  await resetOfflineDb()

  missingStores = getMissingOfflineStores()
  if (missingStores.length > 0) {
    throw new Error(`No se pudo preparar la base offline local. Faltan: ${missingStores.join(', ')}`)
  }

  lastOfflineDbReadyCheckAt = Date.now()
}

export async function ensureOfflineDbHealthy(options?: { recover?: boolean; force?: boolean }) {
  const recover = options?.recover ?? true
  const now = Date.now()

  if (!options?.force && offlineDb.isOpen() && now - lastOfflineDbReadyCheckAt < OFFLINE_DB_HEALTH_TTL_MS) {
    return
  }

  await ensureOfflineDbReady({ recover })
  lastOfflineDbReadyCheckAt = Date.now()
}
