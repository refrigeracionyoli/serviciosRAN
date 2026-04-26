import Dexie from 'dexie'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { ServicioStatus } from '@/types/domain.types'
import {
  addPendingLocalEvidencia,
  applyLocalServiceCompletion,
  applyLocalServiceStatusUpdate,
  createOfflineId,
  prepareOfflineAttachment,
  putOfflineAttachment,
  removeCachedEvidencia,
} from '@/lib/offline/cache'
import {
  offlineDb,
  type OfflineCommandRecord,
  type OfflineCommandStatus,
  type OfflineCommandType,
  type OfflineSyncLogRecord,
} from '@/lib/offline/db'

export interface ServiceCompleteWithRefaccionesPayload {
  serviceId: number
  items: RefaccionInput[]
  statusFinal: ServicioStatus
  baseCostoRefacciones: number
  expectedUpdatedAt: string | null
  expectedStatus: ServicioStatus | null
}

export interface ServiceUpdateStatusPayload {
  serviceId: number
  status: ServicioStatus
  expectedUpdatedAt: string | null
  expectedStatus: ServicioStatus | null
}

export interface ServiceAddEvidenciaPayload {
  serviceId: number
  attachmentId: string
  localEvidenceId: number
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedR2Key: string | null
}

export interface ServiceDeleteEvidenciaPayload {
  serviceId: number
  evidenciaId: number
}

export interface OfflineCommandSummary {
  pendingCount: number
  syncingCount: number
  failedCount: number
  conflictCount: number
  doneCount: number
}

export interface CreateOfflineCommandInput {
  ownerId: string
  type: OfflineCommandType
  entityType: string
  entityId: string | number | null
  payload?: unknown
  localOnlyId?: string | null
  dependsOn?: string[]
}

export function createOfflineCommandRecord({
  ownerId,
  type,
  entityType,
  entityId,
  payload,
  localOnlyId,
  dependsOn,
}: CreateOfflineCommandInput): OfflineCommandRecord {
  const now = new Date().toISOString()
  return {
    id: createOfflineId('cmd'),
    ownerId,
    type,
    status: 'pending',
    payload: payload ?? {},
    entityType,
    entityId: entityId === null ? null : String(entityId),
    localOnlyId: localOnlyId ?? null,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    lastError: null,
    idempotencyKey: createOfflineId('idem'),
    dependsOn: dependsOn ?? [],
  }
}

function buildBaseCommand(
  ownerId: string,
  type: OfflineCommandType,
  entityType: string,
  entityId: string | number | null,
): OfflineCommandRecord {
  return createOfflineCommandRecord({ ownerId, type, entityType, entityId })
}

export async function persistOfflineCommand(command: OfflineCommandRecord) {
  await offlineDb.commands.put(command)
  return command
}

export async function queueOfflineCommand(input: CreateOfflineCommandInput) {
  const command = createOfflineCommandRecord(input)
  await persistOfflineCommand(command)
  return command
}

export async function queueServiceCompletionCommand(
  ownerId: string,
  payload: ServiceCompleteWithRefaccionesPayload,
) {
  const command = buildBaseCommand(ownerId, 'service.complete_with_refacciones', 'servicio', payload.serviceId)
  command.payload = payload

  await offlineDb.transaction(
    'rw',
    offlineDb.commands,
    offlineDb.servicios,
    offlineDb.servicioRefacciones,
    async () => {
      await offlineDb.commands.put(command)
      await applyLocalServiceCompletion(ownerId, {
        serviceId: payload.serviceId,
        items: payload.items,
        commandId: command.id,
        statusFinal: payload.statusFinal,
        baseCostoRefacciones: payload.baseCostoRefacciones,
      })
    },
  )

  return command
}

export async function queueServiceStatusCommand(ownerId: string, payload: ServiceUpdateStatusPayload) {
  const command = buildBaseCommand(ownerId, 'service.update_status', 'servicio', payload.serviceId)
  command.payload = payload

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.servicios, async () => {
    await offlineDb.commands.put(command)
    await applyLocalServiceStatusUpdate(ownerId, {
      serviceId: payload.serviceId,
      commandId: command.id,
      status: payload.status,
    })
  })

  return command
}

export async function queueServiceAddEvidenciaCommand(
  ownerId: string,
  input: {
    serviceId: number
    file: File
    subidaPor: string | null
  },
) {
  const command = buildBaseCommand(ownerId, 'service.add_evidencia', 'evidencia', input.serviceId)
  const attachment = await prepareOfflineAttachment(ownerId, {
    commandId: command.id,
    file: input.file,
  })

  await offlineDb.transaction(
    'rw',
    offlineDb.commands,
    offlineDb.evidencias,
    offlineDb.attachments,
    async () => {
      await putOfflineAttachment(attachment)

      const localEvidence = await addPendingLocalEvidencia(ownerId, {
        servicioId: input.serviceId,
        attachmentId: attachment.id,
        commandId: command.id,
        filename: input.file.name,
        mimeType: input.file.type,
        sizeBytes: input.file.size,
        subidaPor: input.subidaPor,
      })

      const payload: ServiceAddEvidenciaPayload = {
        serviceId: input.serviceId,
        attachmentId: attachment.id,
        localEvidenceId: localEvidence.id,
        filename: input.file.name,
        mimeType: input.file.type,
        sizeBytes: input.file.size,
        uploadedR2Key: null,
      }

      command.localOnlyId = String(localEvidence.id)
      command.payload = payload

      await offlineDb.commands.put(command)
    },
  )

  return command
}

export async function queueServiceDeleteEvidenciaCommand(
  ownerId: string,
  payload: ServiceDeleteEvidenciaPayload,
) {
  const command = buildBaseCommand(ownerId, 'service.delete_evidencia', 'evidencia', payload.serviceId)
  command.localOnlyId = String(payload.evidenciaId)
  command.payload = payload

  await offlineDb.transaction(
    'rw',
    offlineDb.commands,
    offlineDb.evidencias,
    offlineDb.attachments,
    async () => {
      await offlineDb.commands.put(command)
      await removeCachedEvidencia(ownerId, payload.evidenciaId)
    },
  )

  return command
}

export async function getRetryableCommands(ownerId: string): Promise<OfflineCommandRecord[]> {
  const rows = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()
  return rows
    .filter((row) => row.status === 'pending' || row.status === 'failed')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function getRecentCommands(ownerId: string, limit = 15): Promise<OfflineCommandRecord[]> {
  const rows = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()
  return rows
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}

export async function getCommandById(commandId: string): Promise<OfflineCommandRecord | null> {
  return (await offlineDb.commands.get(commandId)) ?? null
}

export async function hasUnresolvedCommands(
  ownerId: string,
  types: readonly OfflineCommandType[],
  options?: { entityId?: string | number | null },
): Promise<boolean> {
  return hasCommandsWithStatuses(ownerId, types, ['pending', 'syncing', 'failed', 'conflict'], options)
}

export async function hasBlockingRemoteFetchCommands(
  ownerId: string,
  types: readonly OfflineCommandType[],
  options?: { entityId?: string | number | null },
): Promise<boolean> {
  return hasCommandsWithStatuses(ownerId, types, ['pending', 'syncing'], options)
}

async function hasCommandsWithStatuses(
  ownerId: string,
  types: readonly OfflineCommandType[],
  statuses: readonly OfflineCommandStatus[],
  options?: { entityId?: string | number | null },
): Promise<boolean> {
  if (types.length === 0) return false

  const targetEntityId = options?.entityId == null ? null : String(options.entityId)
  const rows = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()

  return rows.some((row) => {
    if (!types.includes(row.type)) return false
    if (!statuses.includes(row.status)) return false
    if (targetEntityId != null && row.entityId !== targetEntityId) return false
    return true
  })
}

export async function findPendingEntityCreateCommandId(
  ownerId: string,
  entityType: string,
  entityId: string | number | null | undefined,
): Promise<string | null> {
  if (entityId == null) return null

  const rows = await offlineDb.commands
    .where('[ownerId+createdAt]')
    .between([ownerId, Dexie.minKey], [ownerId, Dexie.maxKey])
    .toArray()

  const match = rows
    .filter((row) => (
      row.entityType === entityType
      && row.entityId === String(entityId)
      && row.type.endsWith('.create')
      && row.status !== 'done'
    ))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]

  return match?.id ?? null
}

export async function deleteCommand(commandId: string) {
  await offlineDb.commands.delete(commandId)
}

export async function updateCommand(
  commandId: string,
  updater: (command: OfflineCommandRecord) => OfflineCommandRecord,
) {
  const current = await offlineDb.commands.get(commandId)
  if (!current) return null

  const next = updater(current)
  await offlineDb.commands.put(next)
  return next
}

export async function setCommandStatus(
  commandId: string,
  status: OfflineCommandStatus,
  options?: { lastError?: string | null; incrementRetry?: boolean },
) {
  return updateCommand(commandId, (command) => ({
    ...command,
    status,
    lastError: typeof options?.lastError === 'undefined' ? command.lastError : options.lastError,
    retryCount: options?.incrementRetry ? command.retryCount + 1 : command.retryCount,
    updatedAt: new Date().toISOString(),
  }))
}

export async function updateCommandPayload(commandId: string, payload: unknown) {
  return updateCommand(commandId, (command) => ({
    ...command,
    payload,
    updatedAt: new Date().toISOString(),
  }))
}

export async function addSyncLog(ownerId: string, commandId: string | null, level: 'info' | 'error', message: string) {
  const entry: OfflineSyncLogRecord = {
    ownerId,
    commandId,
    level,
    message,
    createdAt: new Date().toISOString(),
  }

  await offlineDb.syncLog.add(entry)
}

export async function getSyncSummary(ownerId: string): Promise<OfflineCommandSummary> {
  const rows = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()
  return rows.reduce<OfflineCommandSummary>(
    (acc, command) => {
      if (command.status === 'pending') acc.pendingCount += 1
      if (command.status === 'syncing') acc.syncingCount += 1
      if (command.status === 'failed') acc.failedCount += 1
      if (command.status === 'conflict') acc.conflictCount += 1
      if (command.status === 'done') acc.doneCount += 1
      return acc
    },
    {
      pendingCount: 0,
      syncingCount: 0,
      failedCount: 0,
      conflictCount: 0,
      doneCount: 0,
    },
  )
}
