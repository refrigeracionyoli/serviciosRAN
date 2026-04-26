import {
  createOfflineCommandRecord,
  findPendingEntityCreateCommandId,
  persistOfflineCommand,
} from '@/lib/offline/commands'
import {
  buildCacheKey,
  createLocalNumberId,
  getCachedInventarioItemById,
  getCachedProfileById,
  resolveLinkedNumberId,
  resolveLinkedStringId,
  upsertCachedInventario,
  upsertCachedInventarioTecnico,
  upsertCachedMovimientosInventario,
  upsertEntityLink,
} from '@/lib/offline/cache'
import {
  getInventarioTecnicoAssignedTotal,
  isMissingInventarioTecnicoHistorySchemaError,
  isInventarioTecnicoReturned,
  normalizeInventarioTecnicoRow,
} from '@/lib/inventario-tecnico'
import { ensureOfflineDbReady, offlineDb } from '@/lib/offline/db'
import { getErrorMessage } from '@/lib/offline/network'
import { supabase } from '@/lib/supabase'
import type {
  AjusteInventarioInput,
  CrearItemInventarioInput,
  EditarItemInventarioInput,
  InventarioTecnicoInput,
} from '@/schemas/inventario.schema'
import type {
  InventarioTecnico,
  ItemInventario,
  MovimientoInventario,
} from '@/types/domain.types'

function getNowIso(): string {
  return new Date().toISOString()
}

const INVENTARIO_CREATE_MOVEMENT_REASON = 'Alta inicial de inventario'

async function collectDependencies(
  ownerId: string,
  refs: Array<{ entityType: string; entityId: string | number | null | undefined }>,
) {
  const values = await Promise.all(
    refs.map((ref) => findPendingEntityCreateCommandId(ownerId, ref.entityType, ref.entityId)),
  )

  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

async function buildMovimientoInventarioLocal(
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

export interface InventarioItemCreatePayload {
  localId: number
  data: CrearItemInventarioInput
  localMovementId?: number | null
}

export interface InventarioItemUpdatePayload {
  itemId: number
  data: EditarItemInventarioInput
}

export interface InventarioItemSetActivePayload {
  itemId: number
  activo: boolean
}

export interface InventarioAdjustPayload {
  data: AjusteInventarioInput
  localMovementId: number
}

export interface InventarioTecnicoUpsertPayload {
  data: InventarioTecnicoInput
  rowId: number
  localMovementId: number | null
}

export interface QueueInventarioTecnicoUpsertResult {
  row: InventarioTecnico
  commandId: string
}

export interface InventarioTecnicoDeletePayload {
  id: number
  tecnico_id: string
  inventario_id: number
  cantidad: number
  cantidad_asignada_total: number
  fecha: string
  localMovementId: number
  automatic?: boolean
}

interface InventarioTecnicoRpcResult {
  id: number
  tecnico_id: string
  inventario_id: number
  cantidad: number
  fecha: string
  next_stock: number
}

function isBrokenInventarioTecnicoRpc(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  if (code === '42702') {
    return true
  }

  const message = getErrorMessage(error, '').toLowerCase()
  return (
    message.includes('column reference "tecnico_id" is ambiguous')
    || message.includes('column reference "inventario_id" is ambiguous')
  )
}

function isMissingDeleteInventarioTecnicoAutomaticSupport(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  if (code === 'PGRST202' || code === '42883') {
    return true
  }

  const message = getErrorMessage(error, '').toLowerCase()
  return (
    message.includes('delete_inventario_tecnico_manual')
    && (
      message.includes('schema cache')
      || message.includes('could not find the function')
      || message.includes('does not exist')
    )
  )
}

function toInventarioTecnicoRpcError(error: unknown): Error {
  if (isBrokenInventarioTecnicoRpc(error)) {
    return new Error(
      'La función remota de inventario técnico sigue desactualizada. Aplica la migración 017_fix_inventario_tecnico_rpc_ambiguity.sql para sincronizar estos cambios.',
    )
  }

  if (isMissingInventarioTecnicoHistorySchemaError(error)) {
    return new Error(
      'La base remota de inventario técnico todavía no tiene soporte para historial y devoluciones preservando registros. Aplica la migración 020_inventario_tecnico_history_preserving_returns.sql.',
    )
  }

  return new Error(getErrorMessage(error, 'No se pudo sincronizar el inventario técnico.'))
}

export async function createInventarioItemRemote(
  data: CrearItemInventarioInput,
  options?: { usuarioId?: string | null },
): Promise<{ item: ItemInventario; movement: MovimientoInventario | null }> {
  const { data: createdData, error } = await supabase
    .from('inventario')
    .insert(data)
    .select()
    .single()

  if (error) throw error

  const created = createdData as ItemInventario
  let movement: MovimientoInventario | null = null

  if (Number(created.stock_actual ?? 0) > 0) {
    const { data: movementData, error: movementError } = await supabase
      .from('movimientos_inventario')
      .insert({
        inventario_id: created.id,
        tipo: 'alta_inventario',
        cantidad: created.stock_actual,
        motivo: INVENTARIO_CREATE_MOVEMENT_REASON,
        referencia_id: created.id,
        usuario_id: options?.usuarioId ?? null,
      })
      .select()
      .single()

    if (movementError) {
      try {
        await supabase
          .from('inventario')
          .delete()
          .eq('id', created.id)
      } catch {
        // Best effort rollback to keep remote data consistent.
      }

      throw movementError
    }

    movement = movementData as MovimientoInventario
  }

  return {
    item: created,
    movement,
  }
}

export async function queueInventarioItemCreate(ownerId: string, data: CrearItemInventarioInput): Promise<ItemInventario> {
  await ensureOfflineDbReady({ recover: true })

  const localId = createLocalNumberId()
  const now = getNowIso()
  const item: ItemInventario = {
    id: localId,
    nombre: data.nombre,
    descripcion: data.descripcion ?? null,
    stock_actual: data.stock_actual ?? 0,
    stock_minimo: data.stock_minimo ?? 0,
    precio_unitario: data.precio_unitario ?? null,
    activo: data.activo ?? true,
    created_at: now,
  }
  const movement = item.stock_actual > 0
    ? await buildMovimientoInventarioLocal(ownerId, {
      inventario_id: localId,
      tipo: 'alta_inventario',
      cantidad: item.stock_actual,
      motivo: INVENTARIO_CREATE_MOVEMENT_REASON,
      referencia_id: localId,
      usuario_id: ownerId,
    })
    : null

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'inventario.create',
    entityType: 'inventario',
    entityId: localId,
    payload: {
      localId,
      data,
      localMovementId: movement?.id ?? null,
    } satisfies InventarioItemCreatePayload,
  })

  await offlineDb.transaction(
    'rw',
    [offlineDb.commands, offlineDb.inventario, offlineDb.movimientosInventario, offlineDb.profiles],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedInventario(ownerId, [item])
      if (movement) {
        await upsertCachedMovimientosInventario(ownerId, [movement])
      }
    },
  )

  return item
}

export async function queueInventarioItemUpdate(
  ownerId: string,
  itemId: number,
  data: EditarItemInventarioInput,
): Promise<ItemInventario> {
  await ensureOfflineDbReady({ recover: true })

  const existing = await getCachedInventarioItemById(ownerId, itemId)
  if (!existing) {
    throw new Error('No se encontró el item en caché local.')
  }

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'inventario', entityId: itemId }])
  const updated: ItemInventario = {
    ...existing,
    ...data,
    descripcion: typeof data.descripcion === 'undefined' ? existing.descripcion : data.descripcion ?? null,
    precio_unitario: typeof data.precio_unitario === 'undefined' ? existing.precio_unitario : data.precio_unitario ?? null,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'inventario.update',
    entityType: 'inventario',
    entityId: itemId,
    payload: {
      itemId,
      data,
    } satisfies InventarioItemUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.inventario, async () => {
    await persistOfflineCommand(command)
    await upsertCachedInventario(ownerId, [updated])
  })

  return updated
}

export async function queueInventarioItemSetActive(
  ownerId: string,
  itemId: number,
  activo: boolean,
): Promise<ItemInventario> {
  return queueInventarioItemUpdate(ownerId, itemId, { activo })
}

export async function queueInventarioAdjust(ownerId: string, data: AjusteInventarioInput): Promise<number> {
  await ensureOfflineDbReady({ recover: true })

  const item = await getCachedInventarioItemById(ownerId, data.inventario_id)
  if (!item) {
    throw new Error('No se encontró el item en caché local.')
  }

  const currentStock = Number(item.stock_actual ?? 0)
  let newStock = currentStock
  if (data.tipo === 'entrada') newStock = currentStock + data.cantidad
  if (data.tipo === 'salida') {
    if (currentStock < data.cantidad) {
      throw new Error(`Stock insuficiente. Disponible: ${currentStock}.`)
    }
    newStock = currentStock - data.cantidad
  }
  if (data.tipo === 'ajuste') newStock = data.cantidad

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'inventario', entityId: data.inventario_id }])
  const movement = await buildMovimientoInventarioLocal(ownerId, {
    inventario_id: data.inventario_id,
    tipo: data.tipo,
    cantidad: data.cantidad,
    motivo: data.motivo ?? null,
    referencia_id: null,
    usuario_id: ownerId,
  })

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'inventario.adjust',
    entityType: 'inventario',
    entityId: data.inventario_id,
    payload: {
      data,
      localMovementId: movement.id,
    } satisfies InventarioAdjustPayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    offlineDb.commands,
    offlineDb.inventario,
    offlineDb.movimientosInventario,
    offlineDb.profiles,
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedInventario(ownerId, [{ ...item, stock_actual: newStock }])
      await upsertCachedMovimientosInventario(ownerId, [movement])
    },
  )

  return newStock
}

export async function queueInventarioTecnicoUpsert(
  ownerId: string,
  data: InventarioTecnicoInput,
): Promise<QueueInventarioTecnicoUpsertResult> {
  await ensureOfflineDbReady({ recover: true })

  const rows = await offlineDb.inventarioTecnico
    .where('[ownerId+tecnico_id+fecha]')
    .equals([ownerId, data.tecnico_id, data.fecha])
    .toArray()

  const existing = rows.find((row) => row.inventario_id === data.inventario_id) ?? null
  const item = await getCachedInventarioItemById(ownerId, data.inventario_id)

  if (!item) {
    throw new Error('No se encontró la refacción en caché local.')
  }

  const previousCantidad = existing && !isInventarioTecnicoReturned(existing)
    ? Number(existing.cantidad ?? 0)
    : 0
  const previousCantidadAsignada = existing
    ? getInventarioTecnicoAssignedTotal(existing)
    : 0
  const deltaCantidad = data.cantidad - previousCantidad
  const currentStock = Number(item.stock_actual ?? 0)

  if (deltaCantidad > 0 && currentStock < deltaCantidad) {
    throw new Error(`Stock insuficiente para asignar. Disponible: ${currentStock}.`)
  }

  const nextStock = deltaCantidad === 0
    ? currentStock
    : deltaCantidad > 0
      ? currentStock - deltaCantidad
      : currentStock + Math.abs(deltaCantidad)

  const nextCantidadAsignadaTotal = !existing
    ? data.cantidad
    : isInventarioTecnicoReturned(existing)
      ? previousCantidadAsignada + data.cantidad
      : deltaCantidad > 0
        ? previousCantidadAsignada + deltaCantidad
        : previousCantidadAsignada

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'inventario', entityId: data.inventario_id },
    { entityType: 'profile', entityId: data.tecnico_id },
    { entityType: 'inventario_tecnico', entityId: existing?.id ?? null },
  ])

  const tecnico = await getCachedProfileById(ownerId, data.tecnico_id)
  const rowId = existing?.id ?? createLocalNumberId()
  const nextItem: ItemInventario = {
    ...item,
    stock_actual: nextStock,
  }
  const inventarioTecnico = normalizeInventarioTecnicoRow({
    id: rowId,
    tecnico_id: data.tecnico_id,
    inventario_id: data.inventario_id,
    cantidad: data.cantidad,
    cantidad_asignada_total: nextCantidadAsignadaTotal,
    fecha: data.fecha,
    created_at: existing?.created_at ?? getNowIso(),
    devuelto_at: null,
    devuelto_automaticamente: false,
    tecnico: tecnico ?? undefined,
    item: nextItem,
  }) as InventarioTecnico

  let movement: MovimientoInventario | null = null
  if (deltaCantidad !== 0) {
    const tipoMovimiento = deltaCantidad > 0 ? 'asignacion_tecnico' : 'devolucion_tecnico'
    const cantidadMovimiento = Math.abs(deltaCantidad)
    const tecnicoNombre = tecnico?.nombre ?? data.tecnico_id
    const itemNombre = item.nombre ?? `Item ${data.inventario_id}`
    const motivoBase = deltaCantidad > 0
      ? 'Movimiento a inventario de tecnico'
      : 'Devolucion de inventario de tecnico'
    const motivo = `[INV_TECNICO:${rowId}] ${motivoBase}: ${tecnicoNombre} | ${itemNombre} | ${data.fecha}`

    movement = await buildMovimientoInventarioLocal(ownerId, {
      inventario_id: data.inventario_id,
      tipo: tipoMovimiento,
      cantidad: cantidadMovimiento,
      motivo,
      referencia_id: rowId,
      usuario_id: ownerId,
    })
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'inventario_tecnico.upsert',
    entityType: 'inventario_tecnico',
    entityId: rowId,
    payload: {
      data,
      rowId,
      localMovementId: movement?.id ?? null,
    } satisfies InventarioTecnicoUpsertPayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.inventario,
      offlineDb.inventarioTecnico,
      offlineDb.movimientosInventario,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedInventarioTecnico(ownerId, [inventarioTecnico])
      if (movement) {
        await upsertCachedMovimientosInventario(ownerId, [movement])
      }
      await upsertCachedInventario(ownerId, [nextItem])
    },
  )

  return {
    row: inventarioTecnico,
    commandId: command.id,
  }
}

export async function queueInventarioTecnicoDelete(
  ownerId: string,
  id: number,
  options?: { automatic?: boolean },
): Promise<InventarioTecnicoDeletePayload> {
  await ensureOfflineDbReady({ recover: true })

  const existing = await offlineDb.inventarioTecnico.get(`${ownerId}:${id}`)
  if (!existing) {
    throw new Error('No se encontró la asignación de inventario técnico.')
  }

  const item = await getCachedInventarioItemById(ownerId, existing.inventario_id)
  if (!item) {
    throw new Error('No se encontró la refacción en caché local.')
  }

  if (Number(existing.cantidad ?? 0) <= 0 || isInventarioTecnicoReturned(existing)) {
    throw new Error('No hay piezas activas para devolver en esta asignación.')
  }

  const tecnico = await getCachedProfileById(ownerId, existing.tecnico_id)
  const nextStock = item.stock_actual + existing.cantidad
  const motivoBase = options?.automatic
    ? 'Devolucion automatica de inventario de tecnico por cambio de dia'
    : 'Eliminacion de inventario de tecnico'
  const motivo = `[INV_TECNICO:${existing.id}] ${motivoBase}: ${tecnico?.nombre ?? existing.tecnico_id} | ${item.nombre ?? `Item ${existing.inventario_id}`} | ${existing.fecha}`
  const movement = await buildMovimientoInventarioLocal(ownerId, {
    inventario_id: existing.inventario_id,
    tipo: 'devolucion_tecnico',
    cantidad: existing.cantidad,
    motivo,
    referencia_id: existing.id,
    usuario_id: ownerId,
  })

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'inventario', entityId: existing.inventario_id },
    { entityType: 'inventario_tecnico', entityId: existing.id },
  ])

  const payload: InventarioTecnicoDeletePayload = {
    id: existing.id,
    tecnico_id: existing.tecnico_id,
    inventario_id: existing.inventario_id,
    cantidad: existing.cantidad,
    cantidad_asignada_total: getInventarioTecnicoAssignedTotal(existing),
    fecha: existing.fecha,
    localMovementId: movement.id,
    automatic: Boolean(options?.automatic),
  }

  const returnedRow = normalizeInventarioTecnicoRow({
    ...existing,
    cantidad: 0,
    cantidad_asignada_total: payload.cantidad_asignada_total,
    devuelto_at: getNowIso(),
    devuelto_automaticamente: Boolean(options?.automatic),
    tecnico: tecnico ?? existing.tecnico,
    item: {
      ...item,
      stock_actual: nextStock,
    },
  }) as InventarioTecnico

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'inventario_tecnico.delete',
    entityType: 'inventario_tecnico',
    entityId: existing.id,
    payload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.inventario,
      offlineDb.inventarioTecnico,
      offlineDb.movimientosInventario,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedInventario(ownerId, [{ ...item, stock_actual: nextStock }])
      await upsertCachedInventarioTecnico(ownerId, [returnedRow])
      await upsertCachedMovimientosInventario(ownerId, [movement])
    },
  )

  return payload
}

export async function syncInventarioItemCreate(ownerId: string, payload: InventarioItemCreatePayload) {
  const { item: created, movement } = await createInventarioItemRemote(payload.data, {
    usuarioId: ownerId,
  })

  await offlineDb.transaction(
    'rw',
    [offlineDb.entityLinks, offlineDb.inventario, offlineDb.movimientosInventario, offlineDb.profiles],
    async () => {
      await upsertEntityLink(ownerId, 'inventario', payload.localId, created.id)
      await upsertCachedInventario(ownerId, [created])

      if (movement) {
        if (payload.localMovementId) {
          await upsertEntityLink(ownerId, 'movimiento_inventario', payload.localMovementId, movement.id)
        }
        await upsertCachedMovimientosInventario(ownerId, [movement])
      }
    },
  )

  return created
}

export async function syncInventarioItemUpdate(ownerId: string, payload: InventarioItemUpdatePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'inventario', payload.itemId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del item.')
  }

  const { data, error } = await supabase
    .from('inventario')
    .update(payload.data)
    .eq('id', remoteId)
    .select()
    .single()

  if (error) throw error

  const updated = data as ItemInventario
  await upsertCachedInventario(ownerId, [updated])
  return updated
}

export async function syncInventarioItemSetActive(ownerId: string, payload: InventarioItemSetActivePayload) {
  return syncInventarioItemUpdate(ownerId, {
    itemId: payload.itemId,
    data: { activo: payload.activo },
  })
}

export async function syncInventarioAdjust(_ownerId: string, payload: InventarioAdjustPayload) {
  const remoteItemId = await resolveLinkedNumberId(_ownerId, 'inventario', payload.data.inventario_id)
  if (!remoteItemId) {
    throw new Error('No se pudo resolver el identificador remoto del item.')
  }

  const data = { ...payload.data, inventario_id: remoteItemId }
  const { data: item, error: fetchError } = await supabase
    .from('inventario')
    .select('stock_actual')
    .eq('id', data.inventario_id)
    .single()
  if (fetchError) throw fetchError

  const currentStock = Number(item.stock_actual ?? 0)

  let newStock = currentStock
  if (data.tipo === 'entrada') newStock = currentStock + data.cantidad
  if (data.tipo === 'salida') {
    if (currentStock < data.cantidad) {
      throw new Error(`Stock insuficiente. Disponible: ${currentStock}.`)
    }
    newStock = currentStock - data.cantidad
  }
  if (data.tipo === 'ajuste') newStock = data.cantidad

  const { error: stockError } = await supabase
    .from('inventario')
    .update({ stock_actual: newStock })
    .eq('id', data.inventario_id)

  if (stockError) throw stockError

  const { data: userData } = await supabase.auth.getUser()
  const usuarioId = userData.user?.id ?? null

  const { error: movError } = await supabase
    .from('movimientos_inventario')
    .insert({
      inventario_id: data.inventario_id,
      tipo: data.tipo,
      cantidad: data.cantidad,
      motivo: data.motivo ?? null,
      referencia_id: null,
      usuario_id: usuarioId,
    })

  if (movError) {
    await supabase
      .from('inventario')
      .update({ stock_actual: currentStock })
      .eq('id', data.inventario_id)

    throw movError
  }

  return newStock
}

export async function syncInventarioTecnicoUpsert(ownerId: string, payload: InventarioTecnicoUpsertPayload) {
  const tecnicoId = await resolveLinkedStringId(ownerId, 'profile', payload.data.tecnico_id)
  const inventarioId = await resolveLinkedNumberId(ownerId, 'inventario', payload.data.inventario_id)
  if (!tecnicoId || !inventarioId) {
    throw new Error('No se pudieron resolver las referencias remotas del inventario técnico.')
  }

  const data = {
    ...payload.data,
    tecnico_id: tecnicoId,
    inventario_id: inventarioId,
  }

  try {
    const { data: savedRpcData, error: rpcError } = await supabase
      .rpc('upsert_inventario_tecnico_manual', {
        p_tecnico_id: data.tecnico_id,
        p_inventario_id: data.inventario_id,
        p_cantidad: data.cantidad,
        p_fecha: data.fecha,
      })
      .single()

    if (rpcError) throw rpcError
    const savedRpc = savedRpcData as InventarioTecnicoRpcResult

    const { data: saved, error } = await supabase
      .from('inventario_tecnico')
      .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
      .eq('id', savedRpc.id)
      .single()

    if (error) throw error

    const syncedRow = {
      ...normalizeInventarioTecnicoRow(saved as InventarioTecnico),
      item: saved.item
        ? {
          ...saved.item,
          stock_actual: Number(savedRpc.next_stock ?? saved.item.stock_actual ?? 0),
        }
        : undefined,
    } as InventarioTecnico

    await offlineDb.transaction(
      'rw',
      [offlineDb.entityLinks, offlineDb.inventarioTecnico, offlineDb.inventario, offlineDb.profiles],
      async () => {
        await upsertEntityLink(ownerId, 'inventario_tecnico', payload.rowId, syncedRow.id)
        await offlineDb.inventarioTecnico.delete(buildCacheKey(ownerId, payload.rowId))
        await upsertCachedInventarioTecnico(ownerId, [syncedRow])
      },
    )

    return syncedRow
  } catch (error) {
    throw toInventarioTecnicoRpcError(error)
  }
}

export async function syncInventarioTecnicoDelete(ownerId: string, payload: InventarioTecnicoDeletePayload) {
  const remoteRowId = await resolveLinkedNumberId(ownerId, 'inventario_tecnico', payload.id)
  if (!remoteRowId) {
    throw new Error('No se pudieron resolver las referencias remotas del inventario técnico.')
  }

  try {
    let deletedRpcData: InventarioTecnicoRpcResult | null = null
    const { data: rpcData, error: rpcError } = await supabase
      .rpc('delete_inventario_tecnico_manual', {
        p_row_id: remoteRowId,
        p_automatic: Boolean(payload.automatic),
      })
      .single()

    if (rpcError) {
      if (!isMissingDeleteInventarioTecnicoAutomaticSupport(rpcError)) {
        throw rpcError
      }

      if (payload.automatic) {
        throw new Error(
          'La base remota de inventario técnico todavía no soporta devoluciones automáticas. Aplica la migración 020_inventario_tecnico_history_preserving_returns.sql para evitar devoluciones como eliminaciones manuales.',
        )
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .rpc('delete_inventario_tecnico_manual', {
          p_row_id: remoteRowId,
        })
        .single()

      if (fallbackError) throw fallbackError
      deletedRpcData = fallbackData as InventarioTecnicoRpcResult
    } else {
      deletedRpcData = rpcData as InventarioTecnicoRpcResult
    }

    const deletedRpc = deletedRpcData

    const cachedItem = await getCachedInventarioItemById(ownerId, payload.inventario_id)
    const { data: syncedRowData, error: syncedRowError } = await supabase
      .from('inventario_tecnico')
      .select('*, tecnico:profiles(id, nombre, correo), item:inventario(*)')
      .eq('id', remoteRowId)
      .maybeSingle()

    if (syncedRowError) throw syncedRowError

    await offlineDb.transaction(
      'rw',
      [offlineDb.inventario, offlineDb.inventarioTecnico],
      async () => {
        if (cachedItem) {
          await upsertCachedInventario(ownerId, [{
            ...cachedItem,
            stock_actual: Number(deletedRpc.next_stock ?? cachedItem.stock_actual ?? 0),
          }])
        }

        if (syncedRowData) {
          await upsertCachedInventarioTecnico(ownerId, [
            normalizeInventarioTecnicoRow(syncedRowData as InventarioTecnico),
          ])
        } else {
          await offlineDb.inventarioTecnico.delete(buildCacheKey(ownerId, payload.id))
          await offlineDb.inventarioTecnico.delete(buildCacheKey(ownerId, remoteRowId))
        }
      },
    )

    return Number(deletedRpc.id)
  } catch (error) {
    throw toInventarioTecnicoRpcError(error)
  }
}
