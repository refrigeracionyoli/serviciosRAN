import type { RefaccionInput } from '@/schemas/inventario.schema'
import type {
  Cierre,
  Cliente,
  Evidencia,
  FiltrosMantenimiento,
  FiltrosServicio,
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
  ServicioRefaccion,
  ServicioStatus,
} from '@/types/domain.types'
import { clearAllCachedProfiles, clearCachedProfile } from '@/lib/offline/auth-cache'
import {
  isInventarioTecnicoReturned,
  normalizeInventarioTecnicoRow,
} from '@/lib/inventario-tecnico'
import { formatLocalIsoDate } from '@/lib/utils'
import {
  offlineDb,
  ensureOfflineDbReady,
  resetOfflineDb,
  type CachedClienteRecord,
  type CachedCierreRecord,
  type CachedEvidenciaRecord,
  type CachedInventarioRecord,
  type CachedInventarioTecnicoRecord,
  type CachedMovimientoInventarioRecord,
  type CachedPolizaEstadoHistorialRecord,
  type CachedPolizaPausaRecord,
  type CachedProfileRecord,
  type CachedServicioRecord,
  type CachedServicioRefaccionRecord,
  type CachedSyncStatus,
  type OfflineEntityLinkRecord,
  type OfflineAttachmentRecord,
} from '@/lib/offline/db'

const LOCAL_ATTACHMENT_KEY_PREFIX = 'local-attachment:'
const objectUrlCache = new Map<string, string>()

function getNowIso(): string {
  return new Date().toISOString()
}

export function buildCacheKey(ownerId: string, entityId: string | number): string {
  return `${ownerId}:${entityId}`
}

export function createOfflineId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`
}

export function createLocalEntityId(): number {
  return -Math.floor(Date.now() + Math.random() * 1_000_000)
}

export function createLocalNumberId(): number {
  const randomSuffix = Math.floor(Math.random() * 1_000_000)
  return 8_000_000_000_000_000 + (Date.now() % 1_000_000_000) * 1_000_000 + randomSuffix
}

export function isLocalNumberId(value: number | null | undefined): boolean {
  if (value == null) return false
  return value >= 8_000_000_000_000_000
}

export function createLocalUuid(): string {
  return crypto.randomUUID()
}

function hasSameEntityId(
  left: string | number | null | undefined,
  right: string | number | null | undefined,
): boolean {
  if (left == null || right == null) {
    return left == null && right == null
  }

  return String(left) === String(right)
}

function mergeClienteRelation(
  existing: Cliente | undefined,
  incoming: Cliente | undefined,
  nextClienteId: number | null | undefined,
  previousClienteId: number | null | undefined,
): Cliente | undefined {
  if (!incoming) {
    return hasSameEntityId(nextClienteId, previousClienteId) ? existing : undefined
  }

  if (!existing || !hasSameEntityId(incoming.id, existing.id)) {
    return incoming
  }

  return {
    ...existing,
    ...incoming,
  }
}

function mergeProfileRelation(
  existing: Profile | undefined,
  incoming: Profile | undefined,
  nextProfileId: string | null | undefined,
  previousProfileId: string | null | undefined,
): Profile | undefined {
  if (!incoming) {
    return hasSameEntityId(nextProfileId, previousProfileId) ? existing : undefined
  }

  if (!existing || !hasSameEntityId(incoming.id, existing.id)) {
    return incoming
  }

  return {
    ...existing,
    ...incoming,
  }
}

function mergeMaquinaRelation(
  existing: Maquina | undefined,
  incoming: Maquina | undefined,
  nextMaquinaId: number | null | undefined,
  previousMaquinaId: number | null | undefined,
): Maquina | undefined {
  if (!incoming) {
    return hasSameEntityId(nextMaquinaId, previousMaquinaId) ? existing : undefined
  }

  const base = existing && hasSameEntityId(incoming.id, existing.id) ? existing : undefined

  return {
    ...(base ?? {}),
    ...incoming,
    cliente: mergeClienteRelation(base?.cliente, incoming.cliente, incoming.cliente_id, base?.cliente_id),
  }
}

function mergePolizaRelation(
  existing: Poliza | undefined,
  incoming: Poliza | undefined,
  nextPolizaId: number | null | undefined,
  previousPolizaId: number | null | undefined,
): Poliza | undefined {
  if (!incoming) {
    return hasSameEntityId(nextPolizaId, previousPolizaId) ? existing : undefined
  }

  const base = existing && hasSameEntityId(incoming.id, existing.id) ? existing : undefined

  return {
    ...(base ?? {}),
    ...incoming,
    cliente: mergeClienteRelation(base?.cliente, incoming.cliente, incoming.cliente_id, base?.cliente_id),
    maquina: mergeMaquinaRelation(base?.maquina, incoming.maquina, incoming.maquina_id, base?.maquina_id),
  }
}

function mergeServicioRelation(
  existing: Servicio | undefined,
  incoming: Servicio | undefined,
  nextServiceId: number | null | undefined,
  previousServiceId: number | null | undefined,
): Servicio | undefined {
  if (!incoming) {
    return hasSameEntityId(nextServiceId, previousServiceId) ? existing : undefined
  }

  const base = existing && hasSameEntityId(incoming.id, existing.id) ? existing : undefined

  return {
    ...(base ?? {}),
    ...incoming,
    cliente: mergeClienteRelation(base?.cliente, incoming.cliente, incoming.cliente_id, base?.cliente_id),
    maquina: mergeMaquinaRelation(base?.maquina, incoming.maquina, incoming.maquina_id, base?.maquina_id),
    tecnico: mergeProfileRelation(base?.tecnico, incoming.tecnico, incoming.tecnico_id, base?.tecnico_id),
  }
}

function buildEntityLinkKey(ownerId: string, entityType: string, localId: string): string {
  return `${ownerId}:${entityType}:${localId}`
}

async function getEntityLinkLookup(ownerId: string, entityType: string) {
  const rows = await offlineDb.entityLinks
    .where('[ownerId+entityType]')
    .equals([ownerId, entityType])
    .toArray()

  return rows.reduce(
    (acc, row) => {
      if (row.localId === row.remoteId) {
        return acc
      }

      acc.remoteByLocal.set(row.localId, row.remoteId)
      acc.localByRemote.set(row.remoteId, row.localId)
      return acc
    },
    {
      remoteByLocal: new Map<string, string>(),
      localByRemote: new Map<string, string>(),
    },
  )
}

function filterResolvedDuplicates<T extends { id: string | number }>(
  rows: T[],
  lookup: { localByRemote: Map<string, string>; remoteByLocal: Map<string, string> },
): T[] {
  if (rows.length === 0 || lookup.localByRemote.size === 0) {
    return rows
  }

  const remoteIds = new Set(rows.map((row) => String(row.id)))
  return rows.filter((row) => {
    const remoteId = lookup.remoteByLocal.get(String(row.id))
    return !remoteId || !remoteIds.has(remoteId)
  })
}

async function computeSha256(blob: Blob): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null
  }

  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
    return Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

function mergeCachedProfileRecord(
  existing: CachedProfileRecord | undefined,
  incoming: Profile,
  ownerId: string,
  cacheKey: string,
  cachedAt: string,
): CachedProfileRecord {
  return {
    ...(existing ?? {}),
    ...incoming,
    cacheKey,
    ownerId,
    cachedAt,
  }
}

function mergeCachedClienteRecord(
  existing: CachedClienteRecord | undefined,
  incoming: Cliente,
  ownerId: string,
  cacheKey: string,
  cachedAt: string,
): CachedClienteRecord {
  return {
    ...(existing ?? {}),
    ...incoming,
    cacheKey,
    ownerId,
    cachedAt,
  }
}

function mergeCachedInventarioRecord(
  existing: CachedInventarioRecord | undefined,
  incoming: ItemInventario,
  ownerId: string,
  cacheKey: string,
  cachedAt: string,
): CachedInventarioRecord {
  return {
    ...(existing ?? {}),
    ...incoming,
    cacheKey,
    ownerId,
    cachedAt,
  }
}

function hydrateClienteFromLookup(
  relation: Cliente | undefined,
  clienteId: number | null | undefined,
  clientesById: Map<number, Cliente>,
): Cliente | undefined {
  if (typeof clienteId !== 'number') return relation

  const master = clientesById.get(clienteId)
  if (!master) return relation

  return {
    ...(relation ?? {}),
    ...master,
  }
}

function hydrateProfileFromLookup(
  relation: Profile | undefined,
  profileId: string | null | undefined,
  profilesById: Map<string, Profile>,
): Profile | undefined {
  if (!profileId) return relation

  const master = profilesById.get(profileId)
  if (!master) return relation

  return {
    ...(relation ?? {}),
    ...master,
  }
}

function hydrateInventarioFromLookup(
  relation: ItemInventario | undefined,
  inventarioId: number | null | undefined,
  inventarioById: Map<number, ItemInventario>,
): ItemInventario | undefined {
  if (typeof inventarioId !== 'number') return relation

  const master = inventarioById.get(inventarioId)
  if (!master) return relation

  return {
    ...(relation ?? {}),
    ...master,
  }
}

function hydrateMaquinaFromLookup(
  relation: Maquina | undefined,
  maquinaId: number | null | undefined,
  maquinasById: Map<number, Maquina>,
  clientesById: Map<number, Cliente>,
): Maquina | undefined {
  const master = typeof maquinaId === 'number' ? maquinasById.get(maquinaId) : undefined
  const source = master ?? relation

  if (!source) return undefined

  const merged = {
    ...source,
    ...(relation ?? {}),
    ...(master ?? {}),
  }

  return {
    ...merged,
    cliente: hydrateClienteFromLookup(merged.cliente, merged.cliente_id, clientesById),
  }
}

function hydratePolizaFromLookup(
  relation: Poliza | undefined,
  polizaId: number | null | undefined,
  polizasById: Map<number, Poliza>,
  maquinasById: Map<number, Maquina>,
  clientesById: Map<number, Cliente>,
): Poliza | undefined {
  const master = typeof polizaId === 'number' ? polizasById.get(polizaId) : undefined
  const source = master ?? relation

  if (!source) return undefined

  const merged = {
    ...source,
    ...(relation ?? {}),
    ...(master ?? {}),
  }

  return {
    ...merged,
    cliente: hydrateClienteFromLookup(merged.cliente, merged.cliente_id, clientesById),
    maquina: hydrateMaquinaFromLookup(merged.maquina, merged.maquina_id, maquinasById, clientesById),
  }
}

function hydrateServicioFromLookup(
  relation: Servicio | undefined,
  serviceId: number | null | undefined,
  serviciosById: Map<number, Servicio>,
  maquinasById: Map<number, Maquina>,
  clientesById: Map<number, Cliente>,
  profilesById: Map<string, Profile>,
): Servicio | undefined {
  const master = typeof serviceId === 'number' ? serviciosById.get(serviceId) : undefined
  const source = master ?? relation

  if (!source) return undefined

  const merged = {
    ...source,
    ...(relation ?? {}),
    ...(master ?? {}),
  }

  return {
    ...merged,
    cliente: hydrateClienteFromLookup(merged.cliente, merged.cliente_id, clientesById),
    maquina: hydrateMaquinaFromLookup(merged.maquina, merged.maquina_id, maquinasById, clientesById),
    tecnico: hydrateProfileFromLookup(merged.tecnico, merged.tecnico_id, profilesById),
  }
}

function hydrateMantenimientoFromLookup(
  relation: MantenimientoPoliza | undefined,
  maquinasById: Map<number, Maquina>,
  clientesById: Map<number, Cliente>,
  polizasById: Map<number, Poliza>,
  profilesById: Map<string, Profile>,
): MantenimientoPoliza | undefined {
  if (!relation) return undefined

  return {
    ...relation,
    cliente: hydrateClienteFromLookup(relation.cliente, relation.cliente_id, clientesById),
    maquina: hydrateMaquinaFromLookup(relation.maquina, relation.maquina_id, maquinasById, clientesById),
    poliza: hydratePolizaFromLookup(relation.poliza, relation.poliza_id, polizasById, maquinasById, clientesById),
    tecnico: hydrateProfileFromLookup(relation.tecnico, relation.tecnico_id, profilesById),
  }
}

async function getClientesLookup(ownerId: string): Promise<Map<number, Cliente>> {
  const rows = await offlineDb.clientes.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'cliente')

  return new Map(
    filterResolvedDuplicates(rows, lookup).map((row) => [row.id, row as Cliente]),
  )
}

async function getProfilesLookup(ownerId: string): Promise<Map<string, Profile>> {
  const rows = await offlineDb.profiles.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'profile')

  return new Map(
    filterResolvedDuplicates(rows, lookup).map((row) => [row.id, row as Profile]),
  )
}

async function getInventarioLookup(ownerId: string): Promise<Map<number, ItemInventario>> {
  const rows = await offlineDb.inventario.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'inventario')

  return new Map(
    filterResolvedDuplicates(rows, lookup).map((row) => [row.id, row as ItemInventario]),
  )
}

async function getMaquinasLookup(
  ownerId: string,
  clientesById: Map<number, Cliente>,
): Promise<Map<number, Maquina>> {
  const rows = await offlineDb.maquinas.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'maquina')
  const maquinas = filterResolvedDuplicates(rows, lookup)
    .map((row) => ({
      ...row,
      cliente: hydrateClienteFromLookup(row.cliente, row.cliente_id, clientesById),
    }))

  return new Map(maquinas.map((row) => [row.id, row]))
}

async function getPolizasLookup(
  ownerId: string,
  clientesById: Map<number, Cliente>,
  maquinasById: Map<number, Maquina>,
): Promise<Map<number, Poliza>> {
  const rows = await offlineDb.polizas.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'poliza')
  const polizas = filterResolvedDuplicates(rows, lookup)
    .map((row) => ({
      ...row,
      cliente: hydrateClienteFromLookup(row.cliente, row.cliente_id, clientesById),
      maquina: hydrateMaquinaFromLookup(row.maquina, row.maquina_id, maquinasById, clientesById),
    }))

  return new Map(polizas.map((row) => [row.id, row]))
}

async function getServiciosLookup(
  ownerId: string,
  clientesById: Map<number, Cliente>,
  maquinasById: Map<number, Maquina>,
  profilesById: Map<string, Profile>,
): Promise<Map<number, Servicio>> {
  const rows = await offlineDb.servicios.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'servicio')
  const servicios = filterResolvedDuplicates(rows, lookup)
    .map((row) => ({
      ...row,
      cliente: hydrateClienteFromLookup(row.cliente, row.cliente_id, clientesById),
      maquina: hydrateMaquinaFromLookup(row.maquina, row.maquina_id, maquinasById, clientesById),
      tecnico: hydrateProfileFromLookup(row.tecnico, row.tecnico_id, profilesById),
    }))

  return new Map(servicios.map((row) => [row.id, row]))
}

function normalizeInventarioTecnico(
  ownerId: string,
  rows: InventarioTecnico[],
  cachedAt: string,
): CachedInventarioTecnicoRecord[] {
  return rows.map((row) => ({
    ...normalizeInventarioTecnicoRow(row),
    cacheKey: buildCacheKey(ownerId, row.id),
    ownerId,
    cachedAt,
  }))
}

function normalizeCierres(ownerId: string, rows: Cierre[], cachedAt: string): CachedCierreRecord[] {
  return rows.map((row) => ({
    ...row,
    cacheKey: buildCacheKey(ownerId, row.id),
    ownerId,
    cachedAt,
  }))
}

function normalizePolizaEstadoHistorial(
  ownerId: string,
  rows: PolizaEstadoHistorial[],
  cachedAt: string,
): CachedPolizaEstadoHistorialRecord[] {
  return rows.map((row) => ({
    ...row,
    cacheKey: buildCacheKey(ownerId, row.id),
    ownerId,
    cachedAt,
  }))
}

function normalizePolizaPausas(
  ownerId: string,
  rows: PolizaPausa[],
  cachedAt: string,
): CachedPolizaPausaRecord[] {
  return rows.map((row) => ({
    ...row,
    cacheKey: buildCacheKey(ownerId, row.id),
    ownerId,
    cachedAt,
  }))
}

function normalizeMovimientosInventario(
  ownerId: string,
  rows: MovimientoInventario[],
  cachedAt: string,
): CachedMovimientoInventarioRecord[] {
  return rows.map((row) => ({
    ...row,
    cacheKey: buildCacheKey(ownerId, row.id),
    ownerId,
    cachedAt,
  }))
}

export async function clearOfflineState(ownerId?: string) {
  await ensureOfflineDbReady({ recover: true })

  if (!ownerId) {
    objectUrlCache.forEach((url) => URL.revokeObjectURL(url))
    objectUrlCache.clear()

    await Promise.all([
      offlineDb.profiles.clear(),
      offlineDb.clientes.clear(),
      offlineDb.maquinas.clear(),
      offlineDb.inventario.clear(),
      offlineDb.inventarioTecnico.clear(),
      offlineDb.polizas.clear(),
      offlineDb.polizaEstadoHistorial.clear(),
      offlineDb.polizaPausas.clear(),
      offlineDb.mantenimientos.clear(),
      offlineDb.cierres.clear(),
      offlineDb.movimientosInventario.clear(),
      offlineDb.maquinasTaller.clear(),
      offlineDb.maquinasTallerMovimientos.clear(),
      offlineDb.servicios.clear(),
      offlineDb.servicioRefacciones.clear(),
      offlineDb.evidencias.clear(),
      offlineDb.attachments.clear(),
      offlineDb.commands.clear(),
      offlineDb.syncLog.clear(),
      offlineDb.entityLinks.clear(),
    ])

    clearAllCachedProfiles()
    return
  }

  const attachmentIds = await offlineDb.attachments.where('ownerId').equals(ownerId).primaryKeys()
  attachmentIds.forEach((attachmentId) => {
    const objectUrl = objectUrlCache.get(attachmentId)
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrlCache.delete(attachmentId)
    }
  })

  await Promise.all([
    offlineDb.profiles.where('ownerId').equals(ownerId).delete(),
    offlineDb.clientes.where('ownerId').equals(ownerId).delete(),
    offlineDb.maquinas.where('ownerId').equals(ownerId).delete(),
    offlineDb.inventario.where('ownerId').equals(ownerId).delete(),
    offlineDb.inventarioTecnico.where('ownerId').equals(ownerId).delete(),
    offlineDb.polizas.where('ownerId').equals(ownerId).delete(),
    offlineDb.polizaEstadoHistorial.where('ownerId').equals(ownerId).delete(),
    offlineDb.polizaPausas.where('ownerId').equals(ownerId).delete(),
    offlineDb.mantenimientos.where('ownerId').equals(ownerId).delete(),
    offlineDb.cierres.where('ownerId').equals(ownerId).delete(),
    offlineDb.movimientosInventario.where('ownerId').equals(ownerId).delete(),
    offlineDb.maquinasTaller.where('ownerId').equals(ownerId).delete(),
    offlineDb.maquinasTallerMovimientos.where('ownerId').equals(ownerId).delete(),
    offlineDb.servicios.where('ownerId').equals(ownerId).delete(),
    offlineDb.servicioRefacciones.where('ownerId').equals(ownerId).delete(),
    offlineDb.evidencias.where('ownerId').equals(ownerId).delete(),
    offlineDb.attachments.where('ownerId').equals(ownerId).delete(),
    offlineDb.commands.where('ownerId').equals(ownerId).delete(),
    offlineDb.syncLog.where('ownerId').equals(ownerId).delete(),
    offlineDb.entityLinks.where('ownerId').equals(ownerId).delete(),
  ])

  clearCachedProfile(ownerId)
}

export async function forceResetOfflineState() {
  objectUrlCache.forEach((url) => URL.revokeObjectURL(url))
  objectUrlCache.clear()
  clearAllCachedProfiles()
  await resetOfflineDb()
}

export async function upsertEntityLink(
  ownerId: string,
  entityType: string,
  localId: string | number,
  remoteId: string | number,
) {
  const now = getNowIso()
  const localIdValue = String(localId)
  const remoteIdValue = String(remoteId)
  const cacheKey = buildEntityLinkKey(ownerId, entityType, localIdValue)

  // Updates against existing remote rows do not need a local->remote link.
  if (localIdValue === remoteIdValue) {
    await offlineDb.entityLinks.delete(cacheKey)
    return null
  }

  const existing = await offlineDb.entityLinks.get(cacheKey)

  const record: OfflineEntityLinkRecord = {
    cacheKey,
    ownerId,
    entityType,
    localId: localIdValue,
    remoteId: remoteIdValue,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  await offlineDb.entityLinks.put(record)
  return record
}

export async function getLinkedRemoteId(
  ownerId: string,
  entityType: string,
  localId: string | number | null | undefined,
): Promise<string | null> {
  if (localId == null) return null

  const record = await offlineDb.entityLinks.get(buildEntityLinkKey(ownerId, entityType, String(localId)))
  return record?.remoteId ?? null
}

export async function getLinkedLocalId(
  ownerId: string,
  entityType: string,
  remoteId: string | number | null | undefined,
): Promise<string | null> {
  if (remoteId == null) return null

  const record = await offlineDb.entityLinks
    .where('[ownerId+entityType+remoteId]')
    .equals([ownerId, entityType, String(remoteId)])
    .first()

  return record?.localId ?? null
}

export async function resolveLinkedNumberId(
  ownerId: string,
  entityType: string,
  value: number | null | undefined,
): Promise<number | null> {
  if (value == null) return null

  const remoteId = await getLinkedRemoteId(ownerId, entityType, value)
  if (!remoteId) return value

  const parsed = Number(remoteId)
  return Number.isFinite(parsed) ? parsed : value
}

export async function resolveLinkedStringId(
  ownerId: string,
  entityType: string,
  value: string | null | undefined,
): Promise<string | null> {
  if (!value) return null
  return (await getLinkedRemoteId(ownerId, entityType, value)) ?? value
}

export async function upsertCachedProfiles(ownerId: string, profiles: Profile[]) {
  if (profiles.length === 0) return

  const cachedAt = getNowIso()
  const cacheKeys = profiles.map((profile) => buildCacheKey(ownerId, profile.id))
  const existingRows = await offlineDb.profiles.bulkGet(cacheKeys)

  await offlineDb.profiles.bulkPut(
    profiles.map((profile, index) => mergeCachedProfileRecord(
      existingRows[index],
      profile,
      ownerId,
      cacheKeys[index],
      cachedAt,
    )),
  )
}

export async function upsertCachedProfile(ownerId: string, profile: Profile) {
  await upsertCachedProfiles(ownerId, [profile])
}

export async function getCachedProfileSnapshot(ownerId: string, profileId: string): Promise<Profile | null> {
  const record = await offlineDb.profiles.get(buildCacheKey(ownerId, profileId))
  return record ?? null
}

export async function getCachedProfilesByRole(
  ownerId: string,
  roles: Array<Profile['role']>,
  includeInactive = false,
): Promise<Profile[]> {
  const rows = await offlineDb.profiles.where('ownerId').equals(ownerId).sortBy('nombre')
  const lookup = await getEntityLinkLookup(ownerId, 'profile')
  return filterResolvedDuplicates(rows, lookup)
    .filter((row) => roles.includes(row.role) && (includeInactive || row.activo))
}

export async function upsertCachedClientes(ownerId: string, clientes: Cliente[]) {
  if (clientes.length === 0) return

  const cachedAt = getNowIso()
  const cacheKeys = clientes.map((cliente) => buildCacheKey(ownerId, cliente.id))
  const existingRows = await offlineDb.clientes.bulkGet(cacheKeys)

  await offlineDb.clientes.bulkPut(
    clientes.map((cliente, index) => mergeCachedClienteRecord(
      existingRows[index],
      cliente,
      ownerId,
      cacheKeys[index],
      cachedAt,
    )),
  )
}

export async function getCachedClientesSnapshot(ownerId: string, includeInactive = false): Promise<Cliente[]> {
  const rows = await offlineDb.clientes.where('ownerId').equals(ownerId).sortBy('nombre')
  const lookup = await getEntityLinkLookup(ownerId, 'cliente')
  return filterResolvedDuplicates(rows, lookup).filter((row) => includeInactive || row.activo)
}

export async function upsertCachedMaquinas(ownerId: string, maquinas: Maquina[]) {
  if (maquinas.length === 0) return

  const nestedClientes = maquinas
    .map((maquina) => maquina.cliente)
    .filter((cliente): cliente is Cliente => Boolean(cliente))

  if (nestedClientes.length > 0) {
    await upsertCachedClientes(ownerId, nestedClientes)
  }

  const cachedAt = getNowIso()
  const cacheKeys = maquinas.map((maquina) => buildCacheKey(ownerId, maquina.id))
  const existingRows = await offlineDb.maquinas.bulkGet(cacheKeys)

  await offlineDb.maquinas.bulkPut(
    maquinas.map((maquina, index) => ({
      ...(existingRows[index] ?? {}),
      ...maquina,
      cliente: mergeClienteRelation(
        existingRows[index]?.cliente,
        maquina.cliente,
        maquina.cliente_id,
        existingRows[index]?.cliente_id,
      ),
      cacheKey: cacheKeys[index],
      ownerId,
      cachedAt,
    })),
  )
}

export async function getCachedMaquinasSnapshot(
  ownerId: string,
  options?: { clienteId?: number; includeInactive?: boolean },
): Promise<Maquina[]> {
  const [rows, lookup, clientesById] = await Promise.all([
    offlineDb.maquinas.where('ownerId').equals(ownerId).toArray(),
    getEntityLinkLookup(ownerId, 'maquina'),
    getClientesLookup(ownerId),
  ])
  const clienteId = options?.clienteId
  const includeInactive = Boolean(options?.includeInactive)

  return filterResolvedDuplicates(rows, lookup)
    .map((row) => ({
      ...row,
      cliente: hydrateClienteFromLookup(row.cliente, row.cliente_id, clientesById),
    }))
    .filter((row) => {
      if (typeof clienteId === 'number' && row.cliente_id !== clienteId) return false
      if (!includeInactive && !row.activo) return false
      return true
    })
    .sort((left, right) => left.serie.localeCompare(right.serie, 'es', { sensitivity: 'base' }))
}

export async function upsertCachedInventario(ownerId: string, items: ItemInventario[]) {
  if (items.length === 0) return

  const cachedAt = getNowIso()
  const cacheKeys = items.map((item) => buildCacheKey(ownerId, item.id))
  const existingRows = await offlineDb.inventario.bulkGet(cacheKeys)

  await offlineDb.inventario.bulkPut(
    items.map((item, index) => mergeCachedInventarioRecord(
      existingRows[index],
      item,
      ownerId,
      cacheKeys[index],
      cachedAt,
    )),
  )
}

export async function getCachedInventarioSnapshot(ownerId: string, includeInactive = false): Promise<ItemInventario[]> {
  const rows = await offlineDb.inventario.where('ownerId').equals(ownerId).sortBy('nombre')
  const lookup = await getEntityLinkLookup(ownerId, 'inventario')
  return filterResolvedDuplicates(rows, lookup).filter((row) => includeInactive || row.activo)
}

export async function upsertCachedInventarioTecnico(ownerId: string, rows: InventarioTecnico[]) {
  if (rows.length === 0) return

  const nestedItems = rows
    .map((row) => row.item)
    .filter((item): item is ItemInventario => Boolean(item))
  const nestedProfiles = rows
    .map((row) => row.tecnico)
    .filter((profile): profile is Profile => Boolean(profile))

  await Promise.all([
    nestedItems.length > 0 ? upsertCachedInventario(ownerId, nestedItems) : Promise.resolve(),
    nestedProfiles.length > 0 ? upsertCachedProfiles(ownerId, nestedProfiles) : Promise.resolve(),
  ])

  await offlineDb.inventarioTecnico.bulkPut(normalizeInventarioTecnico(ownerId, rows, getNowIso()))
}

export async function upsertCachedPolizas(ownerId: string, polizas: Poliza[]) {
  if (polizas.length === 0) return

  const nestedClientes = polizas
    .map((poliza) => poliza.cliente)
    .filter((cliente): cliente is Cliente => Boolean(cliente))
  const nestedMaquinas = polizas
    .map((poliza) => poliza.maquina)
    .filter((maquina): maquina is Maquina => Boolean(maquina))

  await Promise.all([
    nestedClientes.length > 0 ? upsertCachedClientes(ownerId, nestedClientes) : Promise.resolve(),
    nestedMaquinas.length > 0 ? upsertCachedMaquinas(ownerId, nestedMaquinas) : Promise.resolve(),
  ])

  const cachedAt = getNowIso()
  const cacheKeys = polizas.map((poliza) => buildCacheKey(ownerId, poliza.id))
  const existingRows = await offlineDb.polizas.bulkGet(cacheKeys)

  await offlineDb.polizas.bulkPut(
    polizas.map((poliza, index) => ({
      ...(existingRows[index] ?? {}),
      ...poliza,
      cliente: mergeClienteRelation(
        existingRows[index]?.cliente,
        poliza.cliente,
        poliza.cliente_id,
        existingRows[index]?.cliente_id,
      ),
      maquina: mergeMaquinaRelation(
        existingRows[index]?.maquina,
        poliza.maquina,
        poliza.maquina_id,
        existingRows[index]?.maquina_id,
      ),
      cacheKey: cacheKeys[index],
      ownerId,
      cachedAt,
    })),
  )
}

export async function getCachedPolizasSnapshot(ownerId: string): Promise<Poliza[]> {
  const clientesById = await getClientesLookup(ownerId)
  const maquinasById = await getMaquinasLookup(ownerId, clientesById)
  const rows = await offlineDb.polizas.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'poliza')

  return filterResolvedDuplicates(rows, lookup)
    .map((row) => ({
      ...row,
      cliente: hydrateClienteFromLookup(row.cliente, row.cliente_id, clientesById),
      maquina: hydrateMaquinaFromLookup(row.maquina, row.maquina_id, maquinasById, clientesById),
    }))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function upsertCachedPolizaEstadoHistorial(ownerId: string, rows: PolizaEstadoHistorial[]) {
  if (rows.length === 0) return
  await offlineDb.polizaEstadoHistorial.bulkPut(normalizePolizaEstadoHistorial(ownerId, rows, getNowIso()))
}

export async function getCachedPolizaEstadoHistorialSnapshot(ownerId: string, polizaId?: number): Promise<PolizaEstadoHistorial[]> {
  const rows = await offlineDb.polizaEstadoHistorial.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'poliza_estado_historial')
  return filterResolvedDuplicates(rows, lookup)
    .filter((row) => (polizaId ? row.poliza_id === polizaId : true))
    .sort((left, right) => left.changed_at.localeCompare(right.changed_at))
}

export async function upsertCachedPolizaPausas(ownerId: string, rows: PolizaPausa[]) {
  if (rows.length === 0) return
  await offlineDb.polizaPausas.bulkPut(normalizePolizaPausas(ownerId, rows, getNowIso()))
}

export async function getCachedPolizaPausasSnapshot(ownerId: string): Promise<PolizaPausa[]> {
  const rows = await offlineDb.polizaPausas.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'poliza_pausa')
  return filterResolvedDuplicates(rows, lookup)
    .sort((left, right) => right.fecha_inicio.localeCompare(left.fecha_inicio))
}

export async function upsertCachedMantenimientos(ownerId: string, rows: MantenimientoPoliza[]) {
  if (rows.length === 0) return

  const nestedPolizas = rows
    .map((row) => row.poliza)
    .filter((poliza): poliza is Poliza => Boolean(poliza))
  const nestedClientes = rows
    .map((row) => row.cliente)
    .filter((cliente): cliente is Cliente => Boolean(cliente))
  const nestedMaquinas = rows
    .map((row) => row.maquina)
    .filter((maquina): maquina is Maquina => Boolean(maquina))
  const nestedTecnicos = rows
    .map((row) => row.tecnico)
    .filter((profile): profile is Profile => Boolean(profile))

  await Promise.all([
    nestedPolizas.length > 0 ? upsertCachedPolizas(ownerId, nestedPolizas) : Promise.resolve(),
    nestedClientes.length > 0 ? upsertCachedClientes(ownerId, nestedClientes) : Promise.resolve(),
    nestedMaquinas.length > 0 ? upsertCachedMaquinas(ownerId, nestedMaquinas) : Promise.resolve(),
    nestedTecnicos.length > 0 ? upsertCachedProfiles(ownerId, nestedTecnicos) : Promise.resolve(),
  ])

  const cachedAt = getNowIso()
  const cacheKeys = rows.map((row) => buildCacheKey(ownerId, row.id))
  const existingRows = await offlineDb.mantenimientos.bulkGet(cacheKeys)

  await offlineDb.mantenimientos.bulkPut(
    rows.map((row, index) => ({
      ...(existingRows[index] ?? {}),
      ...row,
      poliza: mergePolizaRelation(
        existingRows[index]?.poliza,
        row.poliza,
        row.poliza_id,
        existingRows[index]?.poliza_id,
      ),
      cliente: mergeClienteRelation(
        existingRows[index]?.cliente,
        row.cliente,
        row.cliente_id,
        existingRows[index]?.cliente_id,
      ),
      maquina: mergeMaquinaRelation(
        existingRows[index]?.maquina,
        row.maquina,
        row.maquina_id,
        existingRows[index]?.maquina_id,
      ),
      tecnico: mergeProfileRelation(
        existingRows[index]?.tecnico,
        row.tecnico,
        row.tecnico_id,
        existingRows[index]?.tecnico_id,
      ),
      cacheKey: cacheKeys[index],
      ownerId,
      cachedAt,
    })),
  )
}

export async function getCachedMantenimientosSnapshot(
  ownerId: string,
  input?: number | FiltrosMantenimiento,
): Promise<MantenimientoPoliza[]> {
  const filtros = typeof input === 'number' ? { polizaId: input } : input
  const clientesById = await getClientesLookup(ownerId)
  const maquinasById = await getMaquinasLookup(ownerId, clientesById)
  const polizasById = await getPolizasLookup(ownerId, clientesById, maquinasById)
  const profilesById = await getProfilesLookup(ownerId)
  const rows = await offlineDb.mantenimientos.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'mantenimiento')

  return filterResolvedDuplicates(rows, lookup)
    .map((row) => hydrateMantenimientoFromLookup(row, maquinasById, clientesById, polizasById, profilesById))
    .filter((row): row is MantenimientoPoliza => Boolean(row))
    .filter((row) => (filtros?.polizaId ? row.poliza_id === filtros.polizaId : true))
    .filter((row) => (filtros?.maquinaId ? row.maquina_id === filtros.maquinaId : true))
    .filter((row) => (filtros?.tecnicoId ? row.tecnico_id === filtros.tecnicoId : true))
    .filter((row) => (
      filtros?.statuses?.length ? filtros.statuses.includes(row.status) : true
    ))
    .filter((row) => {
      if (!filtros?.fechaDesde && !filtros?.fechaHasta) return true
      const fecha = row.fecha_visita ?? formatLocalIsoDate(new Date(row.created_at))
      if (filtros.fechaDesde && fecha < filtros.fechaDesde) return false
      if (filtros.fechaHasta && fecha > filtros.fechaHasta) return false
      return true
    })
    .sort((left, right) => {
      const leftDate = left.fecha_visita ?? left.created_at
      const rightDate = right.fecha_visita ?? right.created_at
      return rightDate.localeCompare(leftDate)
    })
}

export async function getCachedMantenimientoDetalleSnapshot(ownerId: string, mantenimientoId: number): Promise<MantenimientoPoliza | null> {
  const record = await offlineDb.mantenimientos.get(buildCacheKey(ownerId, mantenimientoId))
  if (!record) return null

  const clientesById = await getClientesLookup(ownerId)
  const maquinasById = await getMaquinasLookup(ownerId, clientesById)
  const polizasById = await getPolizasLookup(ownerId, clientesById, maquinasById)
  const profilesById = await getProfilesLookup(ownerId)

  return hydrateMantenimientoFromLookup(record, maquinasById, clientesById, polizasById, profilesById) ?? null
}

export async function upsertCachedCierres(ownerId: string, rows: Cierre[]) {
  if (rows.length === 0) return

  const nestedTecnicos = rows
    .map((row) => row.tecnico)
    .filter((profile): profile is Profile => Boolean(profile))

  if (nestedTecnicos.length > 0) {
    await upsertCachedProfiles(ownerId, nestedTecnicos)
  }

  await offlineDb.cierres.bulkPut(normalizeCierres(ownerId, rows, getNowIso()))
}

export async function getCachedCierresSnapshot(
  ownerId: string,
  options?: { servicioId?: number },
): Promise<Cierre[]> {
  const rows = await offlineDb.cierres.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'cierre')

  return filterResolvedDuplicates(rows, lookup)
    .filter((row) => (options?.servicioId ? row.servicio_id === options.servicioId : true))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function getCachedCierreByServicioSnapshot(ownerId: string, servicioId: number): Promise<Cierre | null> {
  const rows = await getCachedCierresSnapshot(ownerId, { servicioId })
  return rows[0] ?? null
}

export async function getCachedClienteById(ownerId: string, clienteId: number): Promise<Cliente | null> {
  const record = await offlineDb.clientes.get(buildCacheKey(ownerId, clienteId))
  return record ?? null
}

export async function getCachedMaquinaById(ownerId: string, maquinaId: number): Promise<Maquina | null> {
  const record = await offlineDb.maquinas.get(buildCacheKey(ownerId, maquinaId))
  if (!record) return null

  const clientesById = await getClientesLookup(ownerId)
  return {
    ...record,
    cliente: hydrateClienteFromLookup(record.cliente, record.cliente_id, clientesById),
  }
}

export async function getCachedInventarioItemById(ownerId: string, inventarioId: number): Promise<ItemInventario | null> {
  const record = await offlineDb.inventario.get(buildCacheKey(ownerId, inventarioId))
  return record ?? null
}

export async function getCachedPolizaById(ownerId: string, polizaId: number): Promise<Poliza | null> {
  const record = await offlineDb.polizas.get(buildCacheKey(ownerId, polizaId))
  if (!record) return null

  const clientesById = await getClientesLookup(ownerId)
  const maquinasById = await getMaquinasLookup(ownerId, clientesById)

  return {
    ...record,
    cliente: hydrateClienteFromLookup(record.cliente, record.cliente_id, clientesById),
    maquina: hydrateMaquinaFromLookup(record.maquina, record.maquina_id, maquinasById, clientesById),
  }
}

export async function getCachedPolizaPausaById(ownerId: string, pausaId: number): Promise<PolizaPausa | null> {
  const record = await offlineDb.polizaPausas.get(buildCacheKey(ownerId, pausaId))
  return record ?? null
}

export async function getCachedProfileById(ownerId: string, profileId: string): Promise<Profile | null> {
  const record = await offlineDb.profiles.get(buildCacheKey(ownerId, profileId))
  return record ?? null
}

export async function upsertCachedMovimientosInventario(ownerId: string, rows: MovimientoInventario[]) {
  if (rows.length === 0) return

  const nestedUsuarios = rows
    .map((row) => row.usuario)
    .filter((profile): profile is Profile => Boolean(profile))

  await Promise.all([
    nestedUsuarios.length > 0 ? upsertCachedProfiles(ownerId, nestedUsuarios) : Promise.resolve(),
  ])

  await offlineDb.movimientosInventario.bulkPut(normalizeMovimientosInventario(ownerId, rows, getNowIso()))
}

export async function getCachedMovimientosInventarioSnapshot(
  ownerId: string,
  inventarioId?: number,
): Promise<MovimientoInventario[]> {
  const inventarioById = await getInventarioLookup(ownerId)
  const profilesById = await getProfilesLookup(ownerId)
  const rows = await offlineDb.movimientosInventario.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'movimiento_inventario')

  return filterResolvedDuplicates(rows, lookup)
    .map((row) => ({
      ...row,
      item: hydrateInventarioFromLookup(row.item, row.inventario_id, inventarioById),
      usuario: hydrateProfileFromLookup(row.usuario, row.usuario_id, profilesById),
    }))
    .filter((row) => (inventarioId ? row.inventario_id === inventarioId : true))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function upsertCachedMaquinasTaller(ownerId: string, rows: MaquinaEnTaller[]) {
  if (rows.length === 0) return

  const nestedMaquinas = rows
    .map((row) => row.maquina)
    .filter((maquina): maquina is Maquina => Boolean(maquina))
  const nestedClientes = rows
    .map((row) => row.cliente)
    .filter((cliente): cliente is Cliente => Boolean(cliente))
  const nestedServicios = rows
    .map((row) => row.servicio)
    .filter((servicio): servicio is Servicio => Boolean(servicio))

  await Promise.all([
    nestedMaquinas.length > 0 ? upsertCachedMaquinas(ownerId, nestedMaquinas) : Promise.resolve(),
    nestedClientes.length > 0 ? upsertCachedClientes(ownerId, nestedClientes) : Promise.resolve(),
    nestedServicios.length > 0 ? upsertCachedServicios(ownerId, nestedServicios) : Promise.resolve(),
  ])

  const cachedAt = getNowIso()
  const cacheKeys = rows.map((row) => buildCacheKey(ownerId, row.id))
  const existingRows = await offlineDb.maquinasTaller.bulkGet(cacheKeys)

  await offlineDb.maquinasTaller.bulkPut(
    rows.map((row, index) => ({
      ...(existingRows[index] ?? {}),
      ...row,
      maquina: mergeMaquinaRelation(
        existingRows[index]?.maquina,
        row.maquina,
        row.maquina_id,
        existingRows[index]?.maquina_id,
      ),
      cliente: mergeClienteRelation(
        existingRows[index]?.cliente,
        row.cliente,
        row.cliente_id,
        existingRows[index]?.cliente_id,
      ),
      servicio: mergeServicioRelation(
        existingRows[index]?.servicio,
        row.servicio,
        row.servicio_id,
        existingRows[index]?.servicio_id,
      ),
      cacheKey: cacheKeys[index],
      ownerId,
      cachedAt,
    })),
  )
}

export async function replaceCachedMaquinasTallerSnapshot(
  ownerId: string,
  rows: MaquinaEnTaller[],
  options?: { soloAbiertas?: boolean; maquinaId?: number },
) {
  const remoteIds = new Set(rows.map((row) => row.id))
  if (rows.length > 0) {
    await upsertCachedMaquinasTaller(ownerId, rows)
  }

  const soloAbiertas = Boolean(options?.soloAbiertas)
  const cachedRows = await offlineDb.maquinasTaller.where('ownerId').equals(ownerId).toArray()
  const staleKeys = cachedRows
    .filter((row) => !isLocalNumberId(row.id))
    .filter((row) => (soloAbiertas ? row.fecha_salida === null : true))
    .filter((row) => (options?.maquinaId ? row.maquina_id === options.maquinaId : true))
    .filter((row) => !remoteIds.has(row.id))
    .map((row) => row.cacheKey)

  if (staleKeys.length > 0) {
    await offlineDb.maquinasTaller.bulkDelete(staleKeys)
  }
}

export async function getCachedMaquinasTallerSnapshot(
  ownerId: string,
  options?: { soloAbiertas?: boolean },
): Promise<MaquinaEnTaller[]> {
  const rows = await offlineDb.maquinasTaller.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'maquina_taller')
  const soloAbiertas = Boolean(options?.soloAbiertas)

  return filterResolvedDuplicates(rows, lookup)
    .filter((row) => (soloAbiertas ? row.fecha_salida === null : true))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function upsertCachedMaquinasTallerMovimientos(ownerId: string, rows: MaquinaTallerMovimiento[]) {
  if (rows.length === 0) return

  const nestedMaquinas = rows
    .map((row) => row.maquina)
    .filter((maquina): maquina is Maquina => Boolean(maquina))
  const nestedServicios = rows
    .map((row) => row.servicio)
    .filter((servicio): servicio is Servicio => Boolean(servicio))
  const nestedUsuarios = rows
    .map((row) => row.usuario)
    .filter((profile): profile is Profile => Boolean(profile))

  await Promise.all([
    nestedMaquinas.length > 0 ? upsertCachedMaquinas(ownerId, nestedMaquinas) : Promise.resolve(),
    nestedServicios.length > 0 ? upsertCachedServicios(ownerId, nestedServicios) : Promise.resolve(),
    nestedUsuarios.length > 0 ? upsertCachedProfiles(ownerId, nestedUsuarios) : Promise.resolve(),
  ])

  const cachedAt = getNowIso()
  const cacheKeys = rows.map((row) => buildCacheKey(ownerId, row.id))
  const existingRows = await offlineDb.maquinasTallerMovimientos.bulkGet(cacheKeys)

  await offlineDb.maquinasTallerMovimientos.bulkPut(
    rows.map((row, index) => ({
      ...(existingRows[index] ?? {}),
      ...row,
      maquina: mergeMaquinaRelation(
        existingRows[index]?.maquina,
        row.maquina,
        row.maquina_id,
        existingRows[index]?.maquina_id,
      ),
      servicio: mergeServicioRelation(
        existingRows[index]?.servicio,
        row.servicio,
        row.servicio_id,
        existingRows[index]?.servicio_id,
      ),
      usuario: mergeProfileRelation(
        existingRows[index]?.usuario,
        row.usuario,
        row.usuario_id,
        existingRows[index]?.usuario_id,
      ),
      cacheKey: cacheKeys[index],
      ownerId,
      cachedAt,
    })),
  )
}

export async function replaceCachedMaquinasTallerMovimientosSnapshot(
  ownerId: string,
  rows: MaquinaTallerMovimiento[],
  options?: { maquinaId?: number },
) {
  const remoteIds = new Set(rows.map((row) => row.id))
  if (rows.length > 0) {
    await upsertCachedMaquinasTallerMovimientos(ownerId, rows)
  }

  const cachedRows = await offlineDb.maquinasTallerMovimientos.where('ownerId').equals(ownerId).toArray()
  const staleKeys = cachedRows
    .filter((row) => !isLocalNumberId(row.id))
    .filter((row) => (options?.maquinaId ? row.maquina_id === options.maquinaId : true))
    .filter((row) => !remoteIds.has(row.id))
    .map((row) => row.cacheKey)

  if (staleKeys.length > 0) {
    await offlineDb.maquinasTallerMovimientos.bulkDelete(staleKeys)
  }
}

export async function getCachedMaquinasTallerMovimientosSnapshot(
  ownerId: string,
  maquinaId?: number,
): Promise<MaquinaTallerMovimiento[]> {
  const rows = await offlineDb.maquinasTallerMovimientos.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'maquina_taller_movimiento')

  return filterResolvedDuplicates(rows, lookup)
    .filter((row) => (maquinaId ? row.maquina_id === maquinaId : true))
    .sort((left, right) => {
      const leftDate = `${left.fecha_movimiento}|${left.created_at}`
      const rightDate = `${right.fecha_movimiento}|${right.created_at}`
      return rightDate.localeCompare(leftDate)
    })
}

export async function getCachedInventarioTecnicoSnapshot(
  ownerId: string,
  options?: {
    fecha?: string
    tecnicoId?: string
    includeReturned?: boolean
    includeZeroQuantity?: boolean
  },
): Promise<InventarioTecnico[]> {
  const inventarioById = await getInventarioLookup(ownerId)
  const profilesById = await getProfilesLookup(ownerId)
  const rows = await offlineDb.inventarioTecnico.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'inventario_tecnico')
  const includeReturned = options?.includeReturned ?? false
  const includeZeroQuantity = options?.includeZeroQuantity ?? includeReturned

  return filterResolvedDuplicates(rows, lookup)
    .map((row) => {
      const normalized = normalizeInventarioTecnicoRow(row)

      return {
        ...normalized,
      item: hydrateInventarioFromLookup(row.item, row.inventario_id, inventarioById),
      tecnico: hydrateProfileFromLookup(row.tecnico, row.tecnico_id, profilesById),
      }
    })
    .filter((row) => {
      if (options?.fecha && row.fecha !== options.fecha) return false
      if (options?.tecnicoId && row.tecnico_id !== options.tecnicoId) return false
      if (!includeReturned && isInventarioTecnicoReturned(row)) return false
      if (!includeZeroQuantity && Number(row.cantidad ?? 0) <= 0) return false
      return true
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function upsertCachedServicios(ownerId: string, servicios: Servicio[]) {
  if (servicios.length === 0) return

  const cachedAt = getNowIso()
  const nestedClientes = servicios
    .map((servicio) => servicio.cliente)
    .filter((cliente): cliente is Cliente => Boolean(cliente))
  const nestedMaquinas = servicios
    .map((servicio) => servicio.maquina)
    .filter((maquina): maquina is Maquina => Boolean(maquina))
  const nestedProfiles = servicios
    .map((servicio) => servicio.tecnico)
    .filter((profile): profile is Profile => Boolean(profile))

  await Promise.all([
    nestedClientes.length > 0 ? upsertCachedClientes(ownerId, nestedClientes) : Promise.resolve(),
    nestedMaquinas.length > 0 ? upsertCachedMaquinas(ownerId, nestedMaquinas) : Promise.resolve(),
    nestedProfiles.length > 0 ? upsertCachedProfiles(ownerId, nestedProfiles) : Promise.resolve(),
  ])

  const cacheKeys = servicios.map((servicio) => buildCacheKey(ownerId, servicio.id))
  const existingRows = await offlineDb.servicios.bulkGet(cacheKeys)

  const normalized: CachedServicioRecord[] = servicios.map((servicio, index) => {
    const existing = existingRows[index]
    const preservePending = Boolean(existing?.pendingSync)
    const mergedServicio = {
      ...(existing ?? {}),
      ...servicio,
      cliente: mergeClienteRelation(existing?.cliente, servicio.cliente, servicio.cliente_id, existing?.cliente_id),
      maquina: mergeMaquinaRelation(existing?.maquina, servicio.maquina, servicio.maquina_id, existing?.maquina_id),
      tecnico: mergeProfileRelation(existing?.tecnico, servicio.tecnico, servicio.tecnico_id, existing?.tecnico_id),
    }

    return {
      ...mergedServicio,
      status: preservePending ? existing!.status : mergedServicio.status,
      costo_refacciones: preservePending ? existing!.costo_refacciones : mergedServicio.costo_refacciones,
      total: preservePending ? existing!.total : mergedServicio.total,
      updated_at: preservePending ? existing!.updated_at : mergedServicio.updated_at,
      cacheKey: cacheKeys[index],
      ownerId,
      cachedAt,
      pendingSync: preservePending,
      pendingCommandId: preservePending ? existing!.pendingCommandId : null,
      offlineUpdatedAt: preservePending ? existing!.offlineUpdatedAt : null,
    }
  })

  await offlineDb.servicios.bulkPut(normalized)
}

export async function upsertCachedServicio(ownerId: string, servicio: Servicio) {
  await upsertCachedServicios(ownerId, [servicio])
}

function cachedServicioMatchesFilters(row: Servicio, filtros?: FiltrosServicio): boolean {
  if (filtros?.status && row.status !== filtros.status) return false
  if (filtros?.tecnicoId && row.tecnico_id !== filtros.tecnicoId) return false
  if (filtros?.clienteId && row.cliente_id !== filtros.clienteId) return false
  if (filtros?.maquinaId && row.maquina_id !== filtros.maquinaId) return false
  if (filtros?.fechaDesde && (!row.fecha_servicio || row.fecha_servicio < filtros.fechaDesde)) return false
  if (filtros?.fechaHasta && (!row.fecha_servicio || row.fecha_servicio > filtros.fechaHasta)) return false
  if (filtros?.tipoServicio && row.tipo_servicio !== filtros.tipoServicio) return false

  if (filtros?.search?.trim()) {
    const needle = filtros.search.trim().toLowerCase()
    const values = [
      row.orden?.toString() ?? '',
      row.aviso?.toString() ?? '',
      row.tipo_servicio,
      row.descripcion,
      row.cliente?.nombre,
      row.cliente?.codigo_cliente,
      row.maquina?.modelo,
      row.maquina?.serie,
      row.tecnico?.nombre,
    ]

    if (!values.some((value) => value?.toLowerCase().includes(needle))) {
      return false
    }
  }

  return true
}

export async function replaceCachedServiciosListSnapshot(
  ownerId: string,
  servicios: Servicio[],
  filtros?: FiltrosServicio,
) {
  const remoteIds = new Set(servicios.map((servicio) => servicio.id))
  if (servicios.length > 0) {
    await upsertCachedServicios(ownerId, servicios)
  }

  const rows = await offlineDb.servicios.where('ownerId').equals(ownerId).toArray()
  const staleKeys = rows
    .filter((row) => !row.pendingSync)
    .filter((row) => cachedServicioMatchesFilters(row, filtros))
    .filter((row) => !remoteIds.has(row.id))
    .map((row) => row.cacheKey)

  if (staleKeys.length > 0) {
    await offlineDb.servicios.bulkDelete(staleKeys)
  }
}

export async function getCachedServiciosSnapshot(ownerId: string, filtros?: FiltrosServicio): Promise<Servicio[]> {
  const clientesById = await getClientesLookup(ownerId)
  const maquinasById = await getMaquinasLookup(ownerId, clientesById)
  const profilesById = await getProfilesLookup(ownerId)
  const serviciosById = await getServiciosLookup(ownerId, clientesById, maquinasById, profilesById)
  const rows = await offlineDb.servicios.where('ownerId').equals(ownerId).toArray()
  const lookup = await getEntityLinkLookup(ownerId, 'servicio')

  return filterResolvedDuplicates(rows, lookup)
    .map((row) => hydrateServicioFromLookup(row, row.id, serviciosById, maquinasById, clientesById, profilesById))
    .filter((row): row is Servicio => Boolean(row))
    .filter((row) => cachedServicioMatchesFilters(row, filtros))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function getCachedServicioDetalleSnapshot(ownerId: string, serviceId: number): Promise<Servicio | null> {
  const record = await offlineDb.servicios.get(buildCacheKey(ownerId, serviceId))
  if (!record) return null

  const clientesById = await getClientesLookup(ownerId)
  const maquinasById = await getMaquinasLookup(ownerId, clientesById)
  const profilesById = await getProfilesLookup(ownerId)
  const serviciosById = await getServiciosLookup(ownerId, clientesById, maquinasById, profilesById)

  return hydrateServicioFromLookup(record, serviceId, serviciosById, maquinasById, clientesById, profilesById) ?? null
}

export async function removeCachedServicio(ownerId: string, serviceId: number): Promise<void> {
  const cierreRows = await offlineDb.cierres.where('ownerId').equals(ownerId).toArray()
  const cierreKeys = cierreRows
    .filter((row) => row.servicio_id === serviceId)
    .map((row) => row.cacheKey)

  const tallerRows = await offlineDb.maquinasTaller.where('ownerId').equals(ownerId).toArray()
  const updatedTallerRows = tallerRows
    .filter((row) => row.servicio_id === serviceId)
    .map((row) => ({
      ...row,
      servicio_id: null,
      servicio: undefined,
    }))

  const tallerMovimientoRows = await offlineDb.maquinasTallerMovimientos.where('ownerId').equals(ownerId).toArray()
  const updatedTallerMovimientoRows = tallerMovimientoRows
    .filter((row) => row.servicio_id === serviceId)
    .map((row) => ({
      ...row,
      servicio_id: null,
      servicio: undefined,
    }))

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.servicios,
      offlineDb.servicioRefacciones,
      offlineDb.evidencias,
      offlineDb.cierres,
      offlineDb.maquinasTaller,
      offlineDb.maquinasTallerMovimientos,
    ],
    async () => {
      await offlineDb.servicios.delete(buildCacheKey(ownerId, serviceId))
      await offlineDb.servicioRefacciones.where('[ownerId+serviceId]').equals([ownerId, serviceId]).delete()
      await offlineDb.evidencias.where('[ownerId+servicio_id]').equals([ownerId, serviceId]).delete()
      if (cierreKeys.length > 0) {
        await offlineDb.cierres.bulkDelete(cierreKeys)
      }
      if (updatedTallerRows.length > 0) {
        await offlineDb.maquinasTaller.bulkPut(updatedTallerRows)
      }
      if (updatedTallerMovimientoRows.length > 0) {
        await offlineDb.maquinasTallerMovimientos.bulkPut(updatedTallerMovimientoRows)
      }
    },
  )
}

function normalizeRefaccionSubtotal(item: Pick<RefaccionInput, 'cantidad' | 'precio_unitario'>): number {
  return Number(item.cantidad) * Number(item.precio_unitario)
}

function normalizeRefaccionInventorySource(
  source: RefaccionInventorySource | null | undefined,
): RefaccionInventorySource {
  return source === 'tecnico' ? 'tecnico' : 'general'
}

function buildServicioRefaccionesSnapshot(rows: CachedServicioRefaccionRecord[]): ServicioRefaccion[] {
  return rows.map((row, index) => ({
    id: index + 1,
    servicio_id: row.serviceId,
    mantenimiento_id: row.mantenimientoId,
    inventario_id: row.inventario_id ?? null,
    nombre_refaccion: row.nombre_refaccion,
    cantidad: row.cantidad,
    precio_unitario: row.precio_unitario,
    subtotal: normalizeRefaccionSubtotal(row),
    inventory_source: normalizeRefaccionInventorySource(row.inventory_source),
  }))
}

async function replaceCachedServiceRefacciones(
  ownerId: string,
  serviceId: number,
  items: Array<RefaccionInput & { inventory_source?: RefaccionInventorySource | null }>,
  syncStatus: CachedSyncStatus,
  localCommandId: string | null,
  options?: {
    replaceSource?: RefaccionInventorySource | null
  },
) {
  const replaceSource = normalizeRefaccionInventorySource(options?.replaceSource)
  if (options?.replaceSource) {
    const rows = await offlineDb.servicioRefacciones
      .where('[ownerId+serviceId]')
      .equals([ownerId, serviceId])
      .toArray()

    const cacheKeys = rows
      .filter((row) => normalizeRefaccionInventorySource(row.inventory_source) === replaceSource)
      .map((row) => row.cacheKey)

    if (cacheKeys.length > 0) {
      await offlineDb.servicioRefacciones.bulkDelete(cacheKeys)
    }
  } else {
    await offlineDb.servicioRefacciones.where('[ownerId+serviceId]').equals([ownerId, serviceId]).delete()
  }

  if (items.length === 0) return

  const cachedAt = getNowIso()
  const records: CachedServicioRefaccionRecord[] = items.map((item, index) => ({
    ...item,
    cacheKey: buildCacheKey(ownerId, `service:${serviceId}:ref:${localCommandId ?? 'synced'}:${index}`),
    ownerId,
    cachedAt,
    serviceId,
    mantenimientoId: null,
    syncStatus,
    localCommandId,
    inventory_source: normalizeRefaccionInventorySource(item.inventory_source ?? options?.replaceSource),
  }))

  await offlineDb.servicioRefacciones.bulkPut(records)
}

async function replaceCachedMantenimientoRefacciones(
  ownerId: string,
  mantenimientoId: number,
  items: Array<RefaccionInput & { inventory_source?: RefaccionInventorySource | null }>,
  syncStatus: CachedSyncStatus,
  localCommandId: string | null,
) {
  await offlineDb.servicioRefacciones.where('[ownerId+mantenimientoId]').equals([ownerId, mantenimientoId]).delete()

  if (items.length === 0) return

  const cachedAt = getNowIso()
  const records: CachedServicioRefaccionRecord[] = items.map((item, index) => ({
    ...item,
    cacheKey: buildCacheKey(ownerId, `mantenimiento:${mantenimientoId}:ref:${localCommandId ?? 'synced'}:${index}`),
    ownerId,
    cachedAt,
    serviceId: null,
    mantenimientoId,
    syncStatus,
    localCommandId,
    inventory_source: normalizeRefaccionInventorySource(item.inventory_source),
  }))

  await offlineDb.servicioRefacciones.bulkPut(records)
}

export async function upsertCachedServicioRefacciones(
  ownerId: string,
  input: {
    serviceId?: number | null
    mantenimientoId?: number | null
    items: Array<RefaccionInput & { inventory_source?: RefaccionInventorySource | null }>
    replaceSource?: RefaccionInventorySource | null
  },
) {
  if (typeof input.serviceId === 'number') {
    await replaceCachedServiceRefacciones(ownerId, input.serviceId, input.items, 'synced', null, {
      replaceSource: input.replaceSource,
    })
    return
  }

  if (typeof input.mantenimientoId === 'number') {
    await replaceCachedMantenimientoRefacciones(ownerId, input.mantenimientoId, input.items, 'synced', null)
  }
}

export async function getCachedServicioRefaccionesSnapshot(
  ownerId: string,
  serviceId: number,
  options?: {
    inventorySource?: RefaccionInventorySource | null
  },
): Promise<ServicioRefaccion[]> {
  const rows = await offlineDb.servicioRefacciones
    .where('[ownerId+serviceId]')
    .equals([ownerId, serviceId])
    .toArray()

  const inventorySource = options?.inventorySource
  const filteredRows = inventorySource
    ? rows.filter((row) => normalizeRefaccionInventorySource(row.inventory_source) === inventorySource)
    : rows

  return buildServicioRefaccionesSnapshot(filteredRows)
}

export async function getCachedMantenimientoRefaccionesSnapshot(
  ownerId: string,
  mantenimientoId: number,
): Promise<ServicioRefaccion[]> {
  const rows = await offlineDb.servicioRefacciones
    .where('[ownerId+mantenimientoId]')
    .equals([ownerId, mantenimientoId])
    .toArray()

  return buildServicioRefaccionesSnapshot(rows)
}

export async function applyLocalServiceCompletion(
  ownerId: string,
  input: {
    serviceId: number
    items: RefaccionInput[]
    commandId: string
    statusFinal: ServicioStatus
    baseCostoRefacciones: number
  },
) {
  const service = await offlineDb.servicios.get(buildCacheKey(ownerId, input.serviceId))
  const totalRefacciones = input.items.reduce(
    (sum, item) => sum + Number(item.cantidad) * Number(item.precio_unitario),
    0,
  )
  const now = getNowIso()

  if (input.items.length > 0) {
    const existingItems = await getCachedServicioRefaccionesSnapshot(ownerId, input.serviceId)
    const nextItems = [
      ...existingItems.map((item) => ({
        inventario_id: item.inventario_id,
        nombre_refaccion: item.nombre_refaccion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        inventory_source: item.inventory_source,
      })),
      ...input.items,
    ]

    await replaceCachedServiceRefacciones(ownerId, input.serviceId, nextItems, 'pending', input.commandId)
  }

  if (!service) return

  await offlineDb.servicios.put({
    ...service,
    costo_refacciones: input.baseCostoRefacciones + totalRefacciones,
    total: Number(service.costo_mano_obra ?? 0) + input.baseCostoRefacciones + totalRefacciones,
    status: input.statusFinal,
    updated_at: now,
    cachedAt: now,
    pendingSync: true,
    pendingCommandId: input.commandId,
    offlineUpdatedAt: now,
  })
}

export async function applyLocalServiceStatusUpdate(
  ownerId: string,
  input: {
    serviceId: number
    commandId: string
    status: ServicioStatus
  },
) {
  const service = await offlineDb.servicios.get(buildCacheKey(ownerId, input.serviceId))
  if (!service) return

  const now = getNowIso()
  await offlineDb.servicios.put({
    ...service,
    status: input.status,
    updated_at: now,
    cachedAt: now,
    pendingSync: true,
    pendingCommandId: input.commandId,
    offlineUpdatedAt: now,
  })
}

export async function markServiceCommandSynced(ownerId: string, serviceId: number, commandId: string) {
  const service = await offlineDb.servicios.get(buildCacheKey(ownerId, serviceId))
  if (service?.pendingCommandId === commandId) {
    await offlineDb.servicios.put({
      ...service,
      pendingSync: false,
      pendingCommandId: null,
      offlineUpdatedAt: null,
      cachedAt: getNowIso(),
    })
  }

  const refacciones = await offlineDb.servicioRefacciones
    .where('[ownerId+serviceId]')
    .equals([ownerId, serviceId])
    .toArray()

  if (refacciones.length === 0) return

  await offlineDb.servicioRefacciones.bulkPut(
    refacciones.map((row) => ({
      ...row,
      syncStatus: 'synced',
      localCommandId: row.localCommandId === commandId ? null : row.localCommandId,
      cachedAt: getNowIso(),
    })),
  )
}

export async function reconcileCachedServiceAfterSync(
  ownerId: string,
  serviceId: number,
  commandId: string,
  fields: Partial<Pick<Servicio, 'status' | 'costo_refacciones' | 'total' | 'updated_at'>>,
) {
  const service = await offlineDb.servicios.get(buildCacheKey(ownerId, serviceId))
  if (!service) return

  await offlineDb.servicios.put({
    ...service,
    ...fields,
    cachedAt: getNowIso(),
    pendingSync: service.pendingCommandId === commandId ? false : service.pendingSync,
    pendingCommandId: service.pendingCommandId === commandId ? null : service.pendingCommandId,
    offlineUpdatedAt: service.pendingCommandId === commandId ? null : service.offlineUpdatedAt,
  })
}

export async function prepareOfflineAttachment(
  ownerId: string,
  input: {
    commandId: string | null
    file: File
  },
): Promise<OfflineAttachmentRecord> {
  return {
    id: createOfflineId('attachment'),
    ownerId,
    commandId: input.commandId,
    filename: input.file.name,
    mimeType: input.file.type,
    size: input.file.size,
    blob: input.file,
    sha256: await computeSha256(input.file),
    createdAt: getNowIso(),
  }
}

export async function putOfflineAttachment(attachment: OfflineAttachmentRecord): Promise<OfflineAttachmentRecord> {
  await offlineDb.attachments.put(attachment)
  return attachment
}

export async function addOfflineAttachment(
  ownerId: string,
  input: {
    commandId: string | null
    file: File
  },
): Promise<OfflineAttachmentRecord> {
  return putOfflineAttachment(await prepareOfflineAttachment(ownerId, input))
}

export async function getOfflineAttachment(ownerId: string, attachmentId: string): Promise<OfflineAttachmentRecord | null> {
  const attachment = (await offlineDb.attachments.get(attachmentId)) ?? null
  if (!attachment) return null
  if (attachment.ownerId !== ownerId) return null
  return attachment
}

export async function removeOfflineAttachment(attachmentId: string) {
  const objectUrl = objectUrlCache.get(attachmentId)
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrlCache.delete(attachmentId)
  }

  await offlineDb.attachments.delete(attachmentId)
}

export function toLocalAttachmentKey(attachmentId: string): string {
  return `${LOCAL_ATTACHMENT_KEY_PREFIX}${attachmentId}`
}

export function parseLocalAttachmentId(r2Key: string | null | undefined): string | null {
  if (!r2Key?.startsWith(LOCAL_ATTACHMENT_KEY_PREFIX)) return null
  return r2Key.slice(LOCAL_ATTACHMENT_KEY_PREFIX.length)
}

export async function getLocalAttachmentUrl(
  ownerId: string,
  r2Key: string | null | undefined,
): Promise<string | null> {
  const attachmentId = parseLocalAttachmentId(r2Key)
  if (!attachmentId) return null

  const cachedUrl = objectUrlCache.get(attachmentId)
  if (cachedUrl) return cachedUrl

  const attachment = await getOfflineAttachment(ownerId, attachmentId)
  if (!attachment) return null

  const objectUrl = URL.createObjectURL(attachment.blob)
  objectUrlCache.set(attachmentId, objectUrl)
  return objectUrl
}

export async function addPendingLocalEvidencia(
  ownerId: string,
  input: {
    servicioId: number
    attachmentId: string
    commandId: string
    filename: string
    mimeType: string
    sizeBytes: number
    subidaPor: string | null
  },
): Promise<CachedEvidenciaRecord> {
  const now = getNowIso()
  const localEvidenceId = createLocalEntityId()
  const record: CachedEvidenciaRecord = {
    id: localEvidenceId,
    cacheKey: buildCacheKey(ownerId, localEvidenceId),
    ownerId,
    cachedAt: now,
    servicio_id: input.servicioId,
    r2_key: toLocalAttachmentKey(input.attachmentId),
    r2_bucket: 'offline-pending',
    filename: input.filename,
    mime_type: input.mimeType || 'image/jpeg',
    size_bytes: input.sizeBytes,
    orden: 1,
    subida_por: input.subidaPor,
    created_at: now,
    syncStatus: 'pending',
    localAttachmentId: input.attachmentId,
    localCommandId: input.commandId,
  }

  await offlineDb.evidencias.put(record)
  return record
}

function toCachedSyncedEvidenciaRecord(ownerId: string, evidencia: Evidencia, cachedAt: string): CachedEvidenciaRecord {
  return {
    ...evidencia,
    cacheKey: buildCacheKey(ownerId, evidencia.id),
    ownerId,
    cachedAt,
    syncStatus: 'synced',
    localAttachmentId: null,
    localCommandId: null,
  }
}

export async function upsertCachedEvidencias(ownerId: string, evidencias: Evidencia[]) {
  if (evidencias.length === 0) return

  const cachedAt = getNowIso()
  const records: CachedEvidenciaRecord[] = evidencias.map((evidencia) => toCachedSyncedEvidenciaRecord(ownerId, evidencia, cachedAt))

  await offlineDb.evidencias.bulkPut(records)
}

export async function replaceCachedEvidenciasForServicio(
  ownerId: string,
  servicioId: number,
  evidencias: Evidencia[],
) {
  const existingRows = await offlineDb.evidencias
    .where('[ownerId+servicio_id]')
    .equals([ownerId, servicioId])
    .toArray()

  const syncedCacheKeys = existingRows
    .filter((row) => row.syncStatus === 'synced')
    .map((row) => row.cacheKey)

  if (syncedCacheKeys.length > 0) {
    await offlineDb.evidencias.bulkDelete(syncedCacheKeys)
  }

  if (evidencias.length === 0) return

  const cachedAt = getNowIso()
  await offlineDb.evidencias.bulkPut(
    evidencias.map((evidencia) => toCachedSyncedEvidenciaRecord(ownerId, evidencia, cachedAt)),
  )
}

export async function replacePendingEvidenciaWithSynced(
  ownerId: string,
  localEvidenceId: number,
  syncedEvidence: Evidencia,
) {
  await offlineDb.evidencias.delete(buildCacheKey(ownerId, localEvidenceId))
  await upsertCachedEvidencias(ownerId, [syncedEvidence])
}

export async function removeCachedEvidencia(ownerId: string, evidenceId: number) {
  const cacheKey = buildCacheKey(ownerId, evidenceId)
  const record = await offlineDb.evidencias.get(cacheKey)
  if (!record) return false

  await offlineDb.evidencias.delete(cacheKey)
  if (record.localAttachmentId) {
    await removeOfflineAttachment(record.localAttachmentId)
  }

  return true
}

export async function removePendingLocalEvidencia(ownerId: string, evidenceId: number) {
  const cacheKey = buildCacheKey(ownerId, evidenceId)
  const record = await offlineDb.evidencias.get(cacheKey)
  if (!record) return null

  await offlineDb.evidencias.delete(cacheKey)
  if (record.localAttachmentId) {
    await removeOfflineAttachment(record.localAttachmentId)
  }

  return record.localCommandId
}

export async function getCachedEvidenciasByServicio(ownerId: string, servicioId: number): Promise<Evidencia[]> {
  const rows = await offlineDb.evidencias
    .where('[ownerId+servicio_id]')
    .equals([ownerId, servicioId])
    .toArray()

  return rows.sort((left, right) => {
    const orderDelta = Number(left.orden ?? 0) - Number(right.orden ?? 0)
    if (orderDelta !== 0) return orderDelta
    return left.created_at.localeCompare(right.created_at)
  })
}
