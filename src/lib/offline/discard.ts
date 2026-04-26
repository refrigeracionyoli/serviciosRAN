import { deleteCommand, type ServiceAddEvidenciaPayload, type ServiceCompleteWithRefaccionesPayload, type ServiceUpdateStatusPayload } from '@/lib/offline/commands'
import type { ClienteCreatePayload, MaquinaCreatePayload, ProfileCreatePayload } from '@/lib/offline/catalogos-actions'
import {
  buildCacheKey,
  isLocalNumberId,
  removeCachedEvidencia,
  removeOfflineAttachment,
} from '@/lib/offline/cache'
import { offlineDb, type OfflineCommandRecord } from '@/lib/offline/db'
import type {
  InventarioAdjustPayload,
  InventarioItemCreatePayload,
  InventarioTecnicoDeletePayload,
  InventarioTecnicoUpsertPayload,
} from '@/lib/offline/inventario-actions'
import type {
  PolizaCreatePayload,
  PolizaPausaCreatePayload,
  PolizaPausaResumePayload,
} from '@/lib/offline/polizas-actions'
import {
  restoreLocalServicioReplaceRefaccionesAfterDiscard,
  type MantenimientoCreatePayload,
  type MantenimientoReplaceRefaccionesPayload,
  type ServicioClosePayload,
  type ServicioCreatePayload,
  type ServicioReplaceRefaccionesPayload,
} from '@/lib/offline/servicios-actions'
import type {
  TallerRegistrarEntradaPayload,
  TallerRegistrarReubicacionPayload,
  TallerRegistrarSalidaPayload,
} from '@/lib/offline/taller-actions'

function getNowIso(): string {
  return new Date().toISOString()
}

async function removeInventarioMovimiento(ownerId: string, movementId: number | null | undefined) {
  if (!movementId) return
  await offlineDb.movimientosInventario.delete(buildCacheKey(ownerId, movementId))
}

async function removeTallerMovimiento(ownerId: string, movementId: number | null | undefined) {
  if (!movementId) return
  await offlineDb.maquinasTallerMovimientos.delete(buildCacheKey(ownerId, movementId))
}

async function clearPendingServiceState(ownerId: string, serviceId: number, commandId: string) {
  const cacheKey = buildCacheKey(ownerId, serviceId)
  const service = await offlineDb.servicios.get(cacheKey)
  if (service?.pendingCommandId !== commandId) return

  await offlineDb.servicios.put({
    ...service,
    pendingSync: false,
    pendingCommandId: null,
    offlineUpdatedAt: null,
    cachedAt: getNowIso(),
  })
}

async function removePendingServiceCompletionRows(ownerId: string, serviceId: number, commandId: string) {
  const rows = await offlineDb.servicioRefacciones
    .where('[ownerId+serviceId]')
    .equals([ownerId, serviceId])
    .toArray()

  const cacheKeys = rows
    .filter((row) => row.localCommandId === commandId)
    .map((row) => row.cacheKey)

  if (cacheKeys.length > 0) {
    await offlineDb.servicioRefacciones.bulkDelete(cacheKeys)
  }
}

async function collectCommandsToDiscard(ownerId: string, commandId: string): Promise<OfflineCommandRecord[]> {
  const commands = await offlineDb.commands.where('ownerId').equals(ownerId).toArray()
  const commandsById = new Map(commands.map((command) => [command.id, command]))
  const dependentsById = new Map<string, OfflineCommandRecord[]>()

  for (const command of commands) {
    for (const dependencyId of command.dependsOn) {
      const dependents = dependentsById.get(dependencyId) ?? []
      dependents.push(command)
      dependentsById.set(dependencyId, dependents)
    }
  }

  const ordered: OfflineCommandRecord[] = []
  const visited = new Set<string>()

  const visit = (currentId: string) => {
    if (visited.has(currentId)) return
    visited.add(currentId)

    const dependents = dependentsById.get(currentId) ?? []
    dependents.forEach((dependent) => visit(dependent.id))

    const command = commandsById.get(currentId)
    if (command) {
      ordered.push(command)
    }
  }

  visit(commandId)
  return ordered
}

async function cleanupDiscardedCommand(command: OfflineCommandRecord) {
  if (command.type === 'cliente.create') {
    const payload = command.payload as ClienteCreatePayload
    await offlineDb.clientes.delete(buildCacheKey(command.ownerId, payload.localId))
    return
  }

  if (command.type === 'maquina.create') {
    const payload = command.payload as MaquinaCreatePayload
    await offlineDb.maquinas.delete(buildCacheKey(command.ownerId, payload.localId))
    return
  }

  if (command.type === 'profile.create') {
    const payload = command.payload as ProfileCreatePayload
    await offlineDb.profiles.delete(buildCacheKey(command.ownerId, payload.localId))
    return
  }

  if (command.type === 'profile.reset_password') {
    return
  }

  if (command.type === 'servicio.create') {
    const payload = command.payload as ServicioCreatePayload
    await offlineDb.servicioRefacciones.where('[ownerId+serviceId]').equals([command.ownerId, payload.localId]).delete()
    await offlineDb.servicios.delete(buildCacheKey(command.ownerId, payload.localId))
    return
  }

  if (command.type === 'servicio.close') {
    const payload = command.payload as ServicioClosePayload
    await offlineDb.cierres.delete(buildCacheKey(command.ownerId, payload.localCierreId))
    return
  }

  if (command.type === 'service.update_status') {
    const payload = command.payload as ServiceUpdateStatusPayload
    await clearPendingServiceState(command.ownerId, payload.serviceId, command.id)
    return
  }

  if (command.type === 'service.complete_with_refacciones') {
    const payload = command.payload as ServiceCompleteWithRefaccionesPayload
    await removePendingServiceCompletionRows(command.ownerId, payload.serviceId, command.id)
    await clearPendingServiceState(command.ownerId, payload.serviceId, command.id)
    return
  }

  if (command.type === 'service.add_evidencia') {
    const payload = command.payload as ServiceAddEvidenciaPayload
    await removeCachedEvidencia(command.ownerId, payload.localEvidenceId)
    await removeOfflineAttachment(payload.attachmentId)
    return
  }

  if (command.type === 'poliza.create') {
    const payload = command.payload as PolizaCreatePayload
    await offlineDb.polizas.delete(buildCacheKey(command.ownerId, payload.localId))
    const historial = await offlineDb.polizaEstadoHistorial
      .where('[ownerId+poliza_id]')
      .equals([command.ownerId, payload.localId])
      .toArray()

    if (historial.length > 0) {
      await offlineDb.polizaEstadoHistorial.bulkDelete(historial.map((row) => row.cacheKey))
    }
    return
  }

  if (command.type === 'poliza_pause.create') {
    const payload = command.payload as PolizaPausaCreatePayload
    await offlineDb.polizaPausas.delete(buildCacheKey(command.ownerId, payload.localId))
    return
  }

  if (command.type === 'poliza_pause.resume') {
    const payload = command.payload as PolizaPausaResumePayload
    const cacheKey = buildCacheKey(command.ownerId, payload.pausaId)
    const existing = await offlineDb.polizaPausas.get(cacheKey)
    if (existing) {
      await offlineDb.polizaPausas.put({
        ...existing,
        fecha_reanudacion: null,
        resumed_at: null,
        resumed_by: null,
      })
    }
    return
  }

  if (command.type === 'mantenimiento.create') {
    const payload = command.payload as MantenimientoCreatePayload
    await offlineDb.servicioRefacciones.where('[ownerId+mantenimientoId]').equals([command.ownerId, payload.localId]).delete()
    await offlineDb.mantenimientos.delete(buildCacheKey(command.ownerId, payload.localId))
    return
  }

  if (command.type === 'inventario.create') {
    const payload = command.payload as InventarioItemCreatePayload
    await offlineDb.inventario.delete(buildCacheKey(command.ownerId, payload.localId))
    await removeInventarioMovimiento(command.ownerId, payload.localMovementId)
    return
  }

  if (command.type === 'inventario.adjust') {
    const payload = command.payload as InventarioAdjustPayload
    await removeInventarioMovimiento(command.ownerId, payload.localMovementId)
    return
  }

  if (command.type === 'inventario_tecnico.upsert') {
    const payload = command.payload as InventarioTecnicoUpsertPayload
    if (isLocalNumberId(payload.rowId)) {
      await offlineDb.inventarioTecnico.delete(buildCacheKey(command.ownerId, payload.rowId))
    }
    await removeInventarioMovimiento(command.ownerId, payload.localMovementId)
    return
  }

  if (command.type === 'inventario_tecnico.delete') {
    const payload = command.payload as InventarioTecnicoDeletePayload
    const cacheKey = buildCacheKey(command.ownerId, payload.id)
    const existing = await offlineDb.inventarioTecnico.get(cacheKey)
    if (existing) {
      await offlineDb.inventarioTecnico.put({
        ...existing,
        cantidad: payload.cantidad,
        cantidad_asignada_total: Math.max(
          Number(payload.cantidad_asignada_total ?? 0),
          Number(payload.cantidad ?? 0),
        ),
        devuelto_at: null,
        devuelto_automaticamente: false,
        cachedAt: getNowIso(),
      })
    } else if (isLocalNumberId(payload.id)) {
      await offlineDb.inventarioTecnico.delete(cacheKey)
    }
    await removeInventarioMovimiento(command.ownerId, payload.localMovementId)
    return
  }

  if (command.type === 'servicio.replace_refacciones') {
    const payload = command.payload as ServicioReplaceRefaccionesPayload
    await restoreLocalServicioReplaceRefaccionesAfterDiscard(command.ownerId, payload)
    await Promise.all(payload.localMovementIds.map((movementId) => removeInventarioMovimiento(command.ownerId, movementId)))
    return
  }

  if (command.type === 'mantenimiento.replace_refacciones') {
    const payload = command.payload as MantenimientoReplaceRefaccionesPayload
    await Promise.all(payload.localMovementIds.map((movementId) => removeInventarioMovimiento(command.ownerId, movementId)))
    return
  }

  if (command.type === 'taller.registrar_entrada') {
    const payload = command.payload as TallerRegistrarEntradaPayload
    await offlineDb.maquinasTaller.delete(buildCacheKey(command.ownerId, payload.localId))
    await removeTallerMovimiento(command.ownerId, payload.localMovementId)
    return
  }

  if (command.type === 'taller.registrar_salida') {
    const payload = command.payload as TallerRegistrarSalidaPayload
    await removeTallerMovimiento(command.ownerId, payload.localMovementId)
    return
  }

  if (command.type === 'taller.reubicacion') {
    const payload = command.payload as TallerRegistrarReubicacionPayload
    await removeTallerMovimiento(command.ownerId, payload.localMovementId)
  }
}

export async function discardOfflineCommand(commandId: string) {
  const command = await offlineDb.commands.get(commandId)
  if (!command) {
    return { discardedCount: 0 }
  }

  const commandsToDiscard = await collectCommandsToDiscard(command.ownerId, commandId)
  for (const target of commandsToDiscard) {
    await cleanupDiscardedCommand(target)
    await deleteCommand(target.id)
  }

  return {
    discardedCount: commandsToDiscard.length,
  }
}
