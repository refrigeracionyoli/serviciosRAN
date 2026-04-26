import { hasUnresolvedCommands } from '@/lib/offline/commands'
import {
  buildCacheKey,
  getCachedInventarioTecnicoSnapshot,
  isLocalNumberId,
  upsertCachedInventarioTecnico,
} from '@/lib/offline/cache'
import { isInventarioTecnicoActive, isMissingInventarioTecnicoHistorySchemaError } from '@/lib/inventario-tecnico'
import { ensureOfflineDbReady, offlineDb } from '@/lib/offline/db'
import {
  queueInventarioTecnicoDelete,
  type InventarioTecnicoDeletePayload,
} from '@/lib/offline/inventario-actions'
import { isBrowserOnline } from '@/lib/offline/network'
import { flushPendingCommandsOnline, type SyncRunResult } from '@/lib/offline/sync-engine'
import { supabase } from '@/lib/supabase'
import type { InventarioTecnico, UserRole } from '@/types/domain.types'

const STALE_ROWS_PAGE_SIZE = 250
const STALE_DELETE_COMMANDS = ['inventario_tecnico.delete'] as const
const AUTO_RETURN_FRESH_ASSIGNMENT_GRACE_MS = 12 * 60 * 60 * 1000

function isBeforeIsoDate(left: string, right: string): boolean {
  return left < right
}

function sortStaleRows(rows: InventarioTecnico[]): InventarioTecnico[] {
  return [...rows].sort((left, right) => {
    const leftKey = `${left.fecha}|${left.created_at}|${left.id}`
    const rightKey = `${right.fecha}|${right.created_at}|${right.id}`
    return leftKey.localeCompare(rightKey)
  })
}

function buildAssignmentKey(row: Pick<InventarioTecnico, 'tecnico_id' | 'inventario_id' | 'fecha'>): string {
  return `${row.tecnico_id}:${row.inventario_id}:${row.fecha}`
}

function isFreshAssignment(row: Pick<InventarioTecnico, 'created_at'>, nowMs: number): boolean {
  const createdAtMs = Date.parse(row.created_at)
  if (!Number.isFinite(createdAtMs)) return false

  return nowMs - createdAtMs < AUTO_RETURN_FRESH_ASSIGNMENT_GRACE_MS
}

function matchesActorScope(row: InventarioTecnico, actorRole: UserRole, actorId: string): boolean {
  return actorRole === 'admin' || row.tecnico_id === actorId
}

async function fetchRemoteStaleInventarioTecnicoRows(
  actorRole: UserRole,
  actorId: string,
  today: string,
): Promise<InventarioTecnico[]> {
  const rows: InventarioTecnico[] = []

  for (let from = 0; ; from += STALE_ROWS_PAGE_SIZE) {
    const to = from + STALE_ROWS_PAGE_SIZE - 1
    let query = supabase
      .from('inventario_tecnico')
      .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
      .lt('fecha', today)
      .is('devuelto_at', null)
      .gt('cantidad', 0)
      .order('fecha', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, to)

    if (actorRole !== 'admin') {
      query = query.eq('tecnico_id', actorId)
    }

    const { data, error } = await query
    if (error) throw error

    const pageRows = (data ?? []) as InventarioTecnico[]
    rows.push(...pageRows)

    if (pageRows.length < STALE_ROWS_PAGE_SIZE) {
      break
    }
  }

  return rows
}

async function cleanupRemoteOrphansFromLocalCache(
  ownerId: string,
  rows: InventarioTecnico[],
): Promise<number> {
  if (rows.length === 0) return 0

  const deletableRows: InventarioTecnico[] = []
  for (const row of rows) {
    const hasDeletePending = await hasUnresolvedCommands(ownerId, [...STALE_DELETE_COMMANDS], {
      entityId: row.id,
    })

    if (!hasDeletePending) {
      deletableRows.push(row)
    }
  }

  if (deletableRows.length === 0) return 0

  await offlineDb.inventarioTecnico.bulkDelete(
    deletableRows.map((row) => buildCacheKey(ownerId, row.id)),
  )

  return deletableRows.length
}

async function cleanupResolvedLocalDuplicates(
  ownerId: string,
  localRows: InventarioTecnico[],
  remoteRows: InventarioTecnico[],
): Promise<number> {
  if (localRows.length === 0 || remoteRows.length === 0) {
    return 0
  }

  const remoteAssignmentKeys = new Set(remoteRows.map((row) => buildAssignmentKey(row)))
  const duplicateLocalRows = localRows.filter((row) => (
    isLocalNumberId(row.id) && remoteAssignmentKeys.has(buildAssignmentKey(row))
  ))

  if (duplicateLocalRows.length === 0) {
    return 0
  }

  await offlineDb.inventarioTecnico.bulkDelete(
    duplicateLocalRows.map((row) => buildCacheKey(ownerId, row.id)),
  )

  return duplicateLocalRows.length
}

function isDeletePayloadForAssignment(
  payload: unknown,
  row: Pick<InventarioTecnico, 'tecnico_id' | 'inventario_id' | 'fecha'>,
): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const value = payload as Partial<InventarioTecnicoDeletePayload>
  return (
    value.tecnico_id === row.tecnico_id
    && Number(value.inventario_id) === Number(row.inventario_id)
    && value.fecha === row.fecha
  )
}

function isUpsertPayloadForAssignment(
  payload: unknown,
  row: Pick<InventarioTecnico, 'tecnico_id' | 'inventario_id' | 'fecha'>,
): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false
  }

  const data = (payload as { data?: Partial<InventarioTecnico> }).data
  if (typeof data !== 'object' || data === null) {
    return false
  }

  return (
    data.tecnico_id === row.tecnico_id
    && Number(data.inventario_id) === Number(row.inventario_id)
    && data.fecha === row.fecha
  )
}

async function hasUnresolvedWriteForAssignment(
  ownerId: string,
  row: Pick<InventarioTecnico, 'tecnico_id' | 'inventario_id' | 'fecha'>,
): Promise<boolean> {
  const commands = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()
  return commands.some((command) => {
    if (command.status === 'done') return false

    if (command.type === 'inventario_tecnico.delete') {
      return isDeletePayloadForAssignment(command.payload, row)
    }

    if (command.type === 'inventario_tecnico.upsert') {
      return isUpsertPayloadForAssignment(command.payload, row)
    }

    return false
  })
}

function buildCandidateRows(
  staleLocalRows: InventarioTecnico[],
  staleRemoteRows: InventarioTecnico[],
): InventarioTecnico[] {
  const rowsByAssignment = new Map<string, InventarioTecnico>()

  for (const row of staleRemoteRows) {
    rowsByAssignment.set(buildAssignmentKey(row), row)
  }

  for (const row of staleLocalRows) {
    const assignmentKey = buildAssignmentKey(row)
    if (!rowsByAssignment.has(assignmentKey)) {
      rowsByAssignment.set(assignmentKey, row)
    }
  }

  return Array.from(rowsByAssignment.values())
}

export interface AutoReturnInventarioTecnicoOptions {
  ownerId: string
  actorId: string
  actorRole: UserRole
  today: string
}

export interface AutoReturnInventarioTecnicoResult {
  queuedCount: number
  cleanedOrphanCount: number
  syncResult: SyncRunResult | null
}

export async function autoReturnInventarioTecnicoRows({
  ownerId,
  actorId,
  actorRole,
  today,
}: AutoReturnInventarioTecnicoOptions): Promise<AutoReturnInventarioTecnicoResult> {
  await ensureOfflineDbReady({ recover: true })

  const cachedRows = await getCachedInventarioTecnicoSnapshot(ownerId)
  const staleLocalRows = cachedRows.filter((row) => (
    matchesActorScope(row, actorRole, actorId)
    && isBeforeIsoDate(row.fecha, today)
    && isInventarioTecnicoActive(row)
  ))

  let staleRemoteRows: InventarioTecnico[] = []
  let cleanedOrphanCount = 0
  let remoteHistorySchemaUnavailable = false

  if (isBrowserOnline()) {
    try {
      staleRemoteRows = await fetchRemoteStaleInventarioTecnicoRows(actorRole, actorId, today)

      if (staleRemoteRows.length > 0) {
        await upsertCachedInventarioTecnico(ownerId, staleRemoteRows)
      }

      const remoteIds = new Set(staleRemoteRows.map((row) => String(row.id)))
      const localRemoteOrphans = staleLocalRows.filter((row) => (
        !isLocalNumberId(row.id) && !remoteIds.has(String(row.id))
      ))

      cleanedOrphanCount = await cleanupRemoteOrphansFromLocalCache(ownerId, localRemoteOrphans)
      cleanedOrphanCount += await cleanupResolvedLocalDuplicates(ownerId, staleLocalRows, staleRemoteRows)
    } catch (error) {
      if (!isMissingInventarioTecnicoHistorySchemaError(error)) {
        throw error
      }

      remoteHistorySchemaUnavailable = true
      staleRemoteRows = []
    }
  }

  const candidateRows = isBrowserOnline() && !remoteHistorySchemaUnavailable
    ? buildCandidateRows(
      staleLocalRows.filter((row) => isLocalNumberId(row.id)),
      staleRemoteRows,
    )
    : staleLocalRows

  const nowMs = Date.now()
  let queuedCount = 0
  for (const row of sortStaleRows(candidateRows)) {
    if (isFreshAssignment(row, nowMs)) {
      continue
    }

    const hasDeletePending = await hasUnresolvedCommands(ownerId, [...STALE_DELETE_COMMANDS], {
      entityId: row.id,
    })

    if (hasDeletePending || await hasUnresolvedWriteForAssignment(ownerId, row)) {
      continue
    }

    try {
      await queueInventarioTecnicoDelete(ownerId, row.id, { automatic: true })
      queuedCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.toLowerCase().includes('no se encontró la asignación de inventario técnico')) {
        continue
      }
      throw error
    }
  }

  let syncResult: SyncRunResult | null = null
  if (queuedCount > 0 && isBrowserOnline() && !remoteHistorySchemaUnavailable) {
    syncResult = await flushPendingCommandsOnline()
  }

  return {
    queuedCount,
    cleanedOrphanCount,
    syncResult,
  }
}
