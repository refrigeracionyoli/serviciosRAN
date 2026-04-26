import { supabase } from '@/lib/supabase'
import { deleteEvidencia, uploadEvidencia } from '@/lib/r2'
import { assertCurrentUserCanWriteRemoteService } from '@/lib/offline/service-access'
import {
  addSyncLog,
  getCommandById,
  getRetryableCommands,
  setCommandStatus,
  updateCommandPayload,
  type ServiceAddEvidenciaPayload,
  type ServiceCompleteWithRefaccionesPayload,
  type ServiceDeleteEvidenciaPayload,
  type ServiceUpdateStatusPayload,
} from '@/lib/offline/commands'
import {
  syncClienteCreate,
  syncClienteDelete,
  syncClienteUpdate,
  syncMaquinaCreate,
  syncMaquinaUpdate,
  syncProfileCreate,
  syncProfileResetPassword,
  syncProfileUpdate,
  type ClienteCreatePayload,
  type ClienteDeletePayload,
  type ClienteUpdatePayload,
  type MaquinaCreatePayload,
  type MaquinaUpdatePayload,
  type ProfileCreatePayload,
  type ProfileResetPasswordPayload,
  type ProfileUpdatePayload,
} from '@/lib/offline/catalogos-actions'
import {
  syncInventarioAdjust,
  syncInventarioItemCreate,
  syncInventarioItemSetActive,
  syncInventarioItemUpdate,
  syncInventarioTecnicoDelete,
  syncInventarioTecnicoUpsert,
  type InventarioAdjustPayload,
  type InventarioItemCreatePayload,
  type InventarioItemSetActivePayload,
  type InventarioItemUpdatePayload,
  type InventarioTecnicoDeletePayload,
  type InventarioTecnicoUpsertPayload,
} from '@/lib/offline/inventario-actions'
import {
  syncPolizaCreate,
  syncPolizaDelete,
  syncPolizaPausaCreate,
  syncPolizaPausaResume,
  syncPolizaSetActive,
  syncPolizaUpdate,
  type PolizaCreatePayload,
  type PolizaDeletePayload,
  type PolizaPausaCreatePayload,
  type PolizaPausaResumePayload,
  type PolizaSetActivePayload,
  type PolizaUpdatePayload,
} from '@/lib/offline/polizas-actions'
import {
  syncMantenimientoCreate,
  syncMantenimientoReplaceRefacciones,
  syncMantenimientoUpdate,
  syncServicioClose,
  syncServicioCreate,
  syncServicioReplaceRefacciones,
  syncServicioUpdate,
  type MantenimientoCreatePayload,
  type MantenimientoReplaceRefaccionesPayload,
  type MantenimientoUpdatePayload,
  type ServicioClosePayload,
  type ServicioCreatePayload,
  type ServicioReplaceRefaccionesPayload,
  type ServicioUpdatePayload,
} from '@/lib/offline/servicios-actions'
import {
  syncRegistrarEntradaTaller,
  syncRegistrarReubicacionTaller,
  syncRegistrarSalidaTaller,
  type TallerRegistrarEntradaPayload,
  type TallerRegistrarReubicacionPayload,
  type TallerRegistrarSalidaPayload,
} from '@/lib/offline/taller-actions'
import {
  getErrorMessage,
  isBrowserOnline,
  isLikelyAuthError,
  isLikelyNetworkError,
} from '@/lib/offline/network'
import { getCurrentSessionUser } from '@/lib/offline/session'
import {
  buildCacheKey,
  getOfflineAttachment,
  markServiceCommandSynced,
  reconcileCachedServiceAfterSync,
  removeOfflineAttachment,
  replacePendingEvidenciaWithSynced,
} from '@/lib/offline/cache'
import { ensureOfflineDbHealthy, offlineDb } from '@/lib/offline/db'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { Evidencia, ServicioStatus } from '@/types/domain.types'

class SyncConflictError extends Error {}

export interface SyncRunResult {
  syncedCount: number
  blockedByAuth: boolean
  conflictCount: number
  stoppedByNetwork: boolean
}

export type QueuedCommandSyncStatus = 'pending' | 'synced' | 'failed' | 'conflict'

let syncPromise: Promise<SyncRunResult> | null = null

function serializeRefaccion(item: Pick<RefaccionInput, 'inventario_id' | 'nombre_refaccion' | 'cantidad' | 'precio_unitario'>): string {
  return [
    item.inventario_id ?? 'null',
    item.nombre_refaccion.trim(),
    Number(item.cantidad),
    Number(item.precio_unitario),
  ].join('|')
}

function getMissingRefacciones(
  desired: RefaccionInput[],
  existing: Array<Pick<RefaccionInput, 'inventario_id' | 'nombre_refaccion' | 'cantidad' | 'precio_unitario'>>,
): { missing: RefaccionInput[]; hasExtras: boolean } {
  const existingCounts = new Map<string, number>()
  const desiredCounts = new Map<string, number>()

  existing.forEach((item) => {
    const key = serializeRefaccion(item)
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1)
  })

  desired.forEach((item) => {
    const key = serializeRefaccion(item)
    desiredCounts.set(key, (desiredCounts.get(key) ?? 0) + 1)
  })

  const missing: RefaccionInput[] = []
  desired.forEach((item) => {
    const key = serializeRefaccion(item)
    const count = existingCounts.get(key) ?? 0
    if (count > 0) {
      existingCounts.set(key, count - 1)
      return
    }
    missing.push(item)
  })

  const hasExtras = Array.from(existingCounts.values()).some((count) => count > 0)
  return { missing, hasExtras }
}

async function syncServiceStatus(
  ownerId: string,
  commandId: string,
  payload: ServiceUpdateStatusPayload,
) {
  const current = await assertCurrentUserCanWriteRemoteService(payload.serviceId)
  if (current.status === 'cerrado') {
    throw new SyncConflictError('El servicio ya fue cerrado y no puede actualizarse offline.')
  }

  if (
    payload.expectedUpdatedAt
    && current.updated_at !== payload.expectedUpdatedAt
    && payload.expectedStatus
    && current.status !== payload.expectedStatus
  ) {
    throw new SyncConflictError('El servicio cambió en el servidor antes de sincronizarse.')
  }

  const { data: updated, error: updateError } = await supabase
    .from('servicios')
    .update({ status: payload.status })
    .eq('id', payload.serviceId)
    .select('id, status, costo_refacciones, total, updated_at')
    .single()

  if (updateError) throw updateError

  await reconcileCachedServiceAfterSync(ownerId, payload.serviceId, commandId, {
    status: updated.status as ServicioStatus,
    costo_refacciones: Number(updated.costo_refacciones ?? 0),
    total: Number(updated.total ?? 0),
    updated_at: updated.updated_at,
  })
}

async function syncServiceCompletion(
  ownerId: string,
  commandId: string,
  payload: ServiceCompleteWithRefaccionesPayload,
) {
  const current = await assertCurrentUserCanWriteRemoteService(payload.serviceId)
  if (current.status === 'cerrado') {
    throw new SyncConflictError('El servicio ya fue cerrado y no admite captura offline pendiente.')
  }

  if (
    payload.expectedUpdatedAt
    && current.updated_at !== payload.expectedUpdatedAt
    && payload.expectedStatus
    && current.status !== payload.expectedStatus
  ) {
    throw new SyncConflictError('El servicio cambió en el servidor antes de sincronizar las refacciones.')
  }

  const { data: existingRows, error: existingError } = await supabase.from('servicio_refacciones')
    .select('inventario_id, nombre_refaccion, cantidad, precio_unitario')
    .eq('servicio_id', payload.serviceId)

  if (existingError) throw existingError

  const { missing, hasExtras } = getMissingRefacciones(payload.items, existingRows ?? [])
  if (hasExtras && payload.baseCostoRefacciones <= 0) {
    throw new SyncConflictError('El servicio ya tiene refacciones en el servidor y no se pudo conciliar la captura offline.')
  }

  if (missing.length > 0) {
    const { error: insertError } = await supabase.from('servicio_refacciones')
      .insert(
        missing.map((item) => ({
          servicio_id: payload.serviceId,
          inventario_id: item.inventario_id ?? null,
          nombre_refaccion: item.nombre_refaccion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          inventory_source: 'general',
        })),
      )

    if (insertError) throw insertError
  }

  const totalPayload = payload.items.reduce(
    (sum, item) => sum + Number(item.cantidad) * Number(item.precio_unitario),
    0,
  )
  const targetCostoRefacciones = Math.max(
    Number(current.costo_refacciones ?? 0),
    Number(payload.baseCostoRefacciones ?? 0) + totalPayload,
  )

  const { data: updated, error: updateError } = await supabase
    .from('servicios')
    .update({
      costo_refacciones: targetCostoRefacciones,
      status: payload.statusFinal,
    })
    .eq('id', payload.serviceId)
    .select('id, status, costo_refacciones, total, updated_at')
    .single()

  if (updateError) throw updateError

  await reconcileCachedServiceAfterSync(ownerId, payload.serviceId, commandId, {
    status: updated.status as ServicioStatus,
    costo_refacciones: Number(updated.costo_refacciones ?? 0),
    total: Number(updated.total ?? 0),
    updated_at: updated.updated_at,
  })
  await markServiceCommandSynced(ownerId, payload.serviceId, commandId)
}

async function syncServiceEvidencia(
  ownerId: string,
  commandId: string,
  payload: ServiceAddEvidenciaPayload,
) {
  await assertCurrentUserCanWriteRemoteService(payload.serviceId)

  const attachment = await getOfflineAttachment(ownerId, payload.attachmentId)
  if (!attachment) {
    throw new Error('No se encontró el archivo local de la evidencia pendiente.')
  }

  let uploadedR2Key = payload.uploadedR2Key

  if (!uploadedR2Key) {
    const uploadFile = new File([attachment.blob], attachment.filename, {
      type: attachment.mimeType || 'image/jpeg',
    })
    const uploadResult = await uploadEvidencia(payload.serviceId, uploadFile)
    uploadedR2Key = uploadResult.r2Key

    await updateCommandPayload(commandId, {
      ...payload,
      uploadedR2Key,
    })
  }

  const currentUser = await getCurrentSessionUser()
  if (!currentUser) {
    throw new Error('No hay sesión activa para sincronizar evidencias pendientes.')
  }

  const { data: existing, error: existingError } = await supabase.from('evidencias')
    .select('*')
    .eq('servicio_id', payload.serviceId)
    .eq('r2_key', uploadedR2Key)
    .maybeSingle()

  if (existingError) throw existingError

  let syncedEvidence: Evidencia | null = existing as Evidencia | null

  if (!syncedEvidence) {
    const { data: inserted, error: insertError } = await supabase.from('evidencias')
      .insert({
        servicio_id: payload.serviceId,
        r2_key: uploadedR2Key,
        r2_bucket: 'ran-evidencias',
        filename: payload.filename,
        mime_type: payload.mimeType || 'image/jpeg',
        size_bytes: payload.sizeBytes,
        orden: 1,
        subida_por: currentUser.id,
      })
      .select('*')
      .single()

    if (insertError) throw insertError
    syncedEvidence = inserted as Evidencia
  }

  await replacePendingEvidenciaWithSynced(ownerId, payload.localEvidenceId, syncedEvidence)
  await removeOfflineAttachment(payload.attachmentId)
}

async function syncServiceDeleteEvidencia(
  _ownerId: string,
  _commandId: string,
  payload: ServiceDeleteEvidenciaPayload,
) {
  await assertCurrentUserCanWriteRemoteService(payload.serviceId)

  try {
    await deleteEvidencia(payload.evidenciaId)
  } catch (error) {
    if (error instanceof Error) {
      const text = error.message.toLowerCase()
      if (text.includes('404') || text.includes('no encontrada') || text.includes('not found')) {
        return
      }
    }

    throw error
  }
}

async function removeLocalInventarioMovimientos(ownerId: string, movementIds: number[]) {
  if (movementIds.length === 0) return
  await offlineDb.movimientosInventario.bulkDelete(movementIds.map((movementId) => buildCacheKey(ownerId, movementId)))
}

async function removeLocalCierre(ownerId: string, cierreId: number | null | undefined) {
  if (!cierreId) return
  await offlineDb.cierres.delete(buildCacheKey(ownerId, cierreId))
}

async function areCommandDependenciesReady(commandId: string) {
  const command = await getCommandById(commandId)
  if (!command) return false
  if (command.dependsOn.length === 0) return true

  const dependencies = await Promise.all(command.dependsOn.map((dependencyId) => getCommandById(dependencyId)))
  return dependencies.every((dependency) => dependency?.status === 'done')
}

async function runCommand(commandId: string) {
  const command = await getCommandById(commandId)
  if (!command) {
    return {
      ownerId: null,
      outcome: 'missing',
      message: null,
    } as const
  }

  await setCommandStatus(commandId, 'syncing', { lastError: null })

  try {
    if (command.type === 'service.update_status') {
      await syncServiceStatus(command.ownerId, command.id, command.payload as ServiceUpdateStatusPayload)
    } else if (command.type === 'service.complete_with_refacciones') {
      await syncServiceCompletion(
        command.ownerId,
        command.id,
        command.payload as ServiceCompleteWithRefaccionesPayload,
      )
    } else if (command.type === 'service.add_evidencia') {
      await syncServiceEvidencia(command.ownerId, command.id, command.payload as ServiceAddEvidenciaPayload)
    } else if (command.type === 'service.delete_evidencia') {
      await syncServiceDeleteEvidencia(
        command.ownerId,
        command.id,
        command.payload as ServiceDeleteEvidenciaPayload,
      )
    } else if (command.type === 'cliente.create') {
      await syncClienteCreate(command.ownerId, command.payload as ClienteCreatePayload)
    } else if (command.type === 'cliente.update') {
      await syncClienteUpdate(command.ownerId, command.payload as ClienteUpdatePayload)
    } else if (command.type === 'cliente.delete') {
      await syncClienteDelete(command.ownerId, command.payload as ClienteDeletePayload)
    } else if (command.type === 'maquina.create') {
      await syncMaquinaCreate(command.ownerId, command.payload as MaquinaCreatePayload)
    } else if (command.type === 'maquina.update') {
      await syncMaquinaUpdate(command.ownerId, command.payload as MaquinaUpdatePayload)
    } else if (command.type === 'profile.create') {
      await syncProfileCreate(command.ownerId, command.payload as ProfileCreatePayload)
    } else if (command.type === 'profile.update') {
      await syncProfileUpdate(command.ownerId, command.payload as ProfileUpdatePayload)
    } else if (command.type === 'profile.reset_password') {
      await syncProfileResetPassword(command.ownerId, command.payload as ProfileResetPasswordPayload)
    } else if (command.type === 'inventario.create') {
      await syncInventarioItemCreate(command.ownerId, command.payload as InventarioItemCreatePayload)
    } else if (command.type === 'inventario.update') {
      await syncInventarioItemUpdate(command.ownerId, command.payload as InventarioItemUpdatePayload)
    } else if (command.type === 'inventario.set_active') {
      await syncInventarioItemSetActive(command.ownerId, command.payload as InventarioItemSetActivePayload)
    } else if (command.type === 'inventario.adjust') {
      const payload = command.payload as InventarioAdjustPayload
      await syncInventarioAdjust(command.ownerId, payload)
      await removeLocalInventarioMovimientos(command.ownerId, [payload.localMovementId])
    } else if (command.type === 'inventario_tecnico.upsert') {
      const payload = command.payload as InventarioTecnicoUpsertPayload
      await syncInventarioTecnicoUpsert(command.ownerId, payload)
      if (payload.localMovementId) {
        await removeLocalInventarioMovimientos(command.ownerId, [payload.localMovementId])
      }
    } else if (command.type === 'inventario_tecnico.delete') {
      const payload = command.payload as InventarioTecnicoDeletePayload
      await syncInventarioTecnicoDelete(command.ownerId, payload)
      await removeLocalInventarioMovimientos(command.ownerId, [payload.localMovementId])
    } else if (command.type === 'poliza.create') {
      await syncPolizaCreate(command.ownerId, command.payload as PolizaCreatePayload)
    } else if (command.type === 'poliza.update') {
      await syncPolizaUpdate(command.ownerId, command.payload as PolizaUpdatePayload)
    } else if (command.type === 'poliza.set_active') {
      await syncPolizaSetActive(command.ownerId, command.payload as PolizaSetActivePayload)
    } else if (command.type === 'poliza.delete') {
      await syncPolizaDelete(command.ownerId, command.payload as PolizaDeletePayload)
    } else if (command.type === 'poliza_pause.create') {
      await syncPolizaPausaCreate(command.ownerId, command.payload as PolizaPausaCreatePayload)
    } else if (command.type === 'poliza_pause.resume') {
      await syncPolizaPausaResume(command.ownerId, command.payload as PolizaPausaResumePayload)
    } else if (command.type === 'servicio.create') {
      await syncServicioCreate(command.ownerId, command.payload as ServicioCreatePayload)
    } else if (command.type === 'servicio.update') {
      await syncServicioUpdate(command.ownerId, command.payload as ServicioUpdatePayload)
    } else if (command.type === 'servicio.replace_refacciones') {
      const payload = command.payload as ServicioReplaceRefaccionesPayload
      await syncServicioReplaceRefacciones(command.ownerId, payload)
      await removeLocalInventarioMovimientos(command.ownerId, payload.localMovementIds)
    } else if (command.type === 'servicio.close') {
      const payload = command.payload as ServicioClosePayload
      await syncServicioClose(command.ownerId, payload)
      await removeLocalCierre(command.ownerId, payload.localCierreId)
    } else if (command.type === 'mantenimiento.create') {
      await syncMantenimientoCreate(command.ownerId, command.payload as MantenimientoCreatePayload)
    } else if (command.type === 'mantenimiento.update') {
      await syncMantenimientoUpdate(command.ownerId, command.payload as MantenimientoUpdatePayload)
    } else if (command.type === 'mantenimiento.replace_refacciones') {
      const payload = command.payload as MantenimientoReplaceRefaccionesPayload
      await syncMantenimientoReplaceRefacciones(command.ownerId, payload)
      await removeLocalInventarioMovimientos(command.ownerId, payload.localMovementIds)
    } else if (command.type === 'taller.registrar_entrada') {
      await syncRegistrarEntradaTaller(command.ownerId, command.payload as TallerRegistrarEntradaPayload)
    } else if (command.type === 'taller.registrar_salida') {
      await syncRegistrarSalidaTaller(command.ownerId, command.payload as TallerRegistrarSalidaPayload)
    } else if (command.type === 'taller.reubicacion') {
      await syncRegistrarReubicacionTaller(command.ownerId, command.payload as TallerRegistrarReubicacionPayload)
    } else {
      throw new Error(`Tipo de comando offline no soportado: ${command.type}`)
    }

    await setCommandStatus(commandId, 'done', { lastError: null })
    await addSyncLog(command.ownerId, command.id, 'info', `Sincronizado: ${command.type}`)

    return {
      ownerId: command.ownerId,
      outcome: 'synced',
      message: null,
    } as const
  } catch (error) {
    const message = getErrorMessage(error, 'No se pudo sincronizar el comando offline.')

    if (isLikelyNetworkError(error)) {
      await setCommandStatus(commandId, 'pending', { lastError: null })
      await addSyncLog(command.ownerId, command.id, 'info', `Se pausó por red: ${command.type}`)
      return {
        ownerId: command.ownerId,
        outcome: 'network',
        message,
      } as const
    }

    if (error instanceof SyncConflictError) {
      await setCommandStatus(commandId, 'conflict', {
        lastError: message,
        incrementRetry: true,
      })
      await addSyncLog(command.ownerId, command.id, 'error', message)
      return {
        ownerId: command.ownerId,
        outcome: 'conflict',
        message,
      } as const
    }

    if (isLikelyAuthError(error)) {
      await setCommandStatus(commandId, 'failed', {
        lastError: message,
        incrementRetry: true,
      })
      await addSyncLog(command.ownerId, command.id, 'error', message)
      return {
        ownerId: command.ownerId,
        outcome: 'auth',
        message,
      } as const
    }

    await setCommandStatus(commandId, 'failed', {
      lastError: message,
      incrementRetry: true,
    })
    await addSyncLog(command.ownerId, command.id, 'error', message)
    return {
      ownerId: command.ownerId,
      outcome: 'failed',
      message,
    } as const
  }
}

async function doSyncPendingCommands(): Promise<SyncRunResult> {
  const currentUser = await getCurrentSessionUser()
  if (!currentUser) {
    return {
      syncedCount: 0,
      blockedByAuth: true,
      conflictCount: 0,
      stoppedByNetwork: false,
    }
  }

  await ensureOfflineDbHealthy()
  const commands = await getRetryableCommands(currentUser.id)
  let syncedCount = 0
  let blockedByAuth = false
  let conflictCount = 0
  let stoppedByNetwork = false

  for (const command of commands) {
    const dependenciesReady = await areCommandDependenciesReady(command.id)
    if (!dependenciesReady) {
      continue
    }

    const result = await runCommand(command.id)

    if (result.outcome === 'synced') {
      syncedCount += 1
      continue
    }

    if (result.outcome === 'network') {
      stoppedByNetwork = true
      break
    }

    if (result.outcome === 'auth') {
      blockedByAuth = true
      break
    }

    if (result.outcome === 'conflict') {
      conflictCount += 1
    }
  }

  return {
    syncedCount,
    blockedByAuth,
    conflictCount,
    stoppedByNetwork,
  }
}

export async function syncPendingCommands(): Promise<SyncRunResult> {
  if (syncPromise) return syncPromise

  syncPromise = doSyncPendingCommands().finally(() => {
    syncPromise = null
  })

  return syncPromise
}

export async function flushPendingCommandsOnline(): Promise<SyncRunResult> {
  const firstRun = await syncPendingCommands()
  if (!isBrowserOnline()) {
    return firstRun
  }

  return syncPendingCommands()
}

function mapQueuedCommandStatus(status: string | null | undefined): QueuedCommandSyncStatus {
  if (status === 'done') return 'synced'
  if (status === 'failed') return 'failed'
  if (status === 'conflict') return 'conflict'
  return 'pending'
}

export async function settleQueuedCommand(commandId: string): Promise<QueuedCommandSyncStatus> {
  if (!isBrowserOnline()) {
    return 'pending'
  }

  await flushPendingCommandsOnline()
  const latest = await getCommandById(commandId)
  return mapQueuedCommandStatus(latest?.status)
}
