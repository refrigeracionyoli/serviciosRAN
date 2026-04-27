import { beforeEach, describe, expect, it } from 'vitest'
import {
  createOfflineCommandRecord,
  deleteCommand,
  findPendingEntityCreateCommandId,
  getCommandById,
  getRecentCommands,
  getRetryableCommands,
  getSyncSummary,
  hasBlockingRemoteFetchCommands,
  hasUnresolvedCommands,
  persistOfflineCommand,
  queueOfflineCommand,
  queueServiceAddEvidenciaCommand,
  queueServiceCompletionCommand,
  queueServiceStatusCommand,
  setCommandStatus,
  updateCommandPayload,
} from '@/lib/offline/commands'
import {
  clearOfflineState,
  getCachedEvidenciasByServicio,
  getCachedServicioDetalleSnapshot,
  getCachedServicioRefaccionesSnapshot,
  getOfflineAttachment,
  upsertCachedServicio,
} from '@/lib/offline/cache'
import { OWNER_ID, buildOfflineCommand, buildServicio } from '../fixtures/domain'

describe('offline command queue', () => {
  beforeEach(async () => {
    await clearOfflineState()
  })

  it('creates, persists, updates, and summarizes command records by status', async () => {
    const pending = createOfflineCommandRecord({
      ownerId: OWNER_ID,
      type: 'cliente.create',
      entityType: 'cliente',
      entityId: -1,
      payload: { data: { nombre: 'Cliente offline' } },
      localOnlyId: '-1',
    })
    const failed = buildOfflineCommand({
      id: 'cmd_failed',
      status: 'failed',
      type: 'servicio.update',
      entityType: 'servicio',
      entityId: '30',
      createdAt: '2026-04-20T13:00:00.000Z',
      updatedAt: '2026-04-20T13:00:00.000Z',
    })

    await persistOfflineCommand(pending)
    await persistOfflineCommand(failed)
    await setCommandStatus(pending.id, 'syncing')
    await updateCommandPayload(pending.id, { data: { nombre: 'Actualizado' } })

    expect(await getCommandById(pending.id)).toMatchObject({
      status: 'syncing',
      payload: { data: { nombre: 'Actualizado' } },
    })
    expect(await getRetryableCommands(OWNER_ID)).toEqual([expect.objectContaining({ id: 'cmd_failed' })])
    expect(await getRecentCommands(OWNER_ID, 2)).toHaveLength(2)
    expect(await getSyncSummary(OWNER_ID)).toMatchObject({
      pendingCount: 0,
      syncingCount: 1,
      failedCount: 1,
      conflictCount: 0,
    })
    expect(await hasUnresolvedCommands(OWNER_ID, ['servicio.update'], { entityId: 30 })).toBe(true)
    expect(await hasBlockingRemoteFetchCommands(OWNER_ID, ['servicio.update'], { entityId: 30 })).toBe(false)
  })

  it('tracks dependencies for pending local entity creation commands', async () => {
    const command = await queueOfflineCommand({
      ownerId: OWNER_ID,
      type: 'maquina.create',
      entityType: 'maquina',
      entityId: -20,
      localOnlyId: '-20',
      payload: { data: { serie: 'LOCAL-20' } },
    })

    expect(await findPendingEntityCreateCommandId(OWNER_ID, 'maquina', -20)).toBe(command.id)

    await deleteCommand(command.id)
    expect(await getCommandById(command.id)).toBeNull()
  })

  it('applies optimistic local service status and completion changes', async () => {
    await upsertCachedServicio(OWNER_ID, buildServicio({ id: 30, status: 'en_ruta', costo_refacciones: 100, total: 100 }))

    const statusCommand = await queueServiceStatusCommand(OWNER_ID, {
      serviceId: 30,
      status: 'completado',
      expectedUpdatedAt: '2026-04-20T12:00:00.000Z',
      expectedStatus: 'en_ruta',
    })
    expect(await getCachedServicioDetalleSnapshot(OWNER_ID, 30)).toMatchObject({
      status: 'completado',
      pendingSync: true,
      pendingCommandId: statusCommand.id,
    })

    const completionCommand = await queueServiceCompletionCommand(OWNER_ID, {
      serviceId: 30,
      items: [
        { inventario_id: 50, nombre_refaccion: 'Filtro', cantidad: 2, precio_unitario: 150 },
      ],
      statusFinal: 'completado',
      baseCostoRefacciones: 100,
      expectedUpdatedAt: '2026-04-20T12:00:00.000Z',
      expectedStatus: 'en_ruta',
    })

    expect(await getCommandById(completionCommand.id)).toMatchObject({ type: 'service.complete_with_refacciones' })
    expect(await getCachedServicioDetalleSnapshot(OWNER_ID, 30)).toMatchObject({
      status: 'completado',
      costo_refacciones: 400,
      total: 400,
    })
    expect(await getCachedServicioRefaccionesSnapshot(OWNER_ID, 30)).toEqual([
      expect.objectContaining({ nombre_refaccion: 'Filtro', cantidad: 2, inventory_source: 'general' }),
    ])
  })

  it('queues local evidence files with pending cached evidence and attachment blobs', async () => {
    const file = new File(['evidencia'], 'foto.jpg', { type: 'image/jpeg' })
    const command = await queueServiceAddEvidenciaCommand(OWNER_ID, {
      serviceId: 30,
      file,
      subidaPor: OWNER_ID,
    })

    const persisted = await getCommandById(command.id)
    const evidencias = await getCachedEvidenciasByServicio(OWNER_ID, 30)
    const attachment = await getOfflineAttachment(OWNER_ID, (persisted?.payload as { attachmentId: string }).attachmentId)

    expect(persisted).toMatchObject({ type: 'service.add_evidencia', entityType: 'evidencia' })
    expect(evidencias).toEqual([
      expect.objectContaining({ filename: 'foto.jpg', syncStatus: 'pending', localCommandId: command.id }),
    ])
    expect(attachment).toMatchObject({ filename: 'foto.jpg', mimeType: 'image/jpeg', commandId: command.id })
  })
})
