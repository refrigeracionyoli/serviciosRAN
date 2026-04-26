import {
  createOfflineCommandRecord,
  findPendingEntityCreateCommandId,
  persistOfflineCommand,
} from '@/lib/offline/commands'
import {
  createLocalNumberId,
  getCachedClienteById,
  getCachedMaquinaById,
  getCachedPolizaById,
  getCachedPolizaPausaById,
  resolveLinkedNumberId,
  upsertCachedPolizaEstadoHistorial,
  upsertCachedPolizaPausas,
  upsertCachedPolizas,
  upsertEntityLink,
} from '@/lib/offline/cache'
import { offlineDb } from '@/lib/offline/db'
import { supabase } from '@/lib/supabase'
import type {
  CrearPolizaInput,
  EditarPolizaInput,
} from '@/schemas/poliza.schema'
import type {
  Poliza,
  PolizaEstadoHistorial,
  PolizaPausa,
} from '@/types/domain.types'

const SELECT_POLIZA = '*, cliente:clientes(*), maquina:maquinas(*)'
const SELECT_POLIZA_PAUSA = '*'

function getNowIso(): string {
  return new Date().toISOString()
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

function buildPolizaEstadoEvent(
  ownerId: string,
  polizaId: number,
  estado: 'activa' | 'inactiva',
): PolizaEstadoHistorial {
  return {
    id: createLocalNumberId(),
    poliza_id: polizaId,
    estado,
    changed_at: getNowIso(),
    changed_by: ownerId,
    motivo: null,
  }
}

export async function findRemotePolizaByFingerprint(
  clienteId: number | null | undefined,
  maquinaId: number | null | undefined,
  fechaInicio: string | null | undefined,
): Promise<Poliza | null> {
  if (!clienteId || !maquinaId || !fechaInicio) return null

  const { data, error } = await supabase
    .from('polizas')
    .select(SELECT_POLIZA)
    .eq('cliente_id', clienteId)
    .eq('maquina_id', maquinaId)
    .eq('fecha_inicio', fechaInicio)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw error
  return ((data ?? [])[0] ?? null) as Poliza | null
}

export interface PolizaCreatePayload {
  localId: number
  data: CrearPolizaInput
}

export interface PolizaSetActivePayload {
  polizaId: number
  activa: boolean
}

export interface PolizaUpdatePayload {
  polizaId: number
  data: EditarPolizaInput
}

export interface PolizaDeletePayload {
  polizaId: number
}

export interface CrearPolizaPausaInput {
  fecha_inicio: string
  motivo?: string | null
}

export interface PolizaPausaCreatePayload {
  localId: number
  data: CrearPolizaPausaInput
}

export interface PolizaPausaResumePayload {
  pausaId: number
  fecha_reanudacion: string
}

export async function queuePolizaCreate(ownerId: string, data: CrearPolizaInput): Promise<Poliza> {
  const localId = createLocalNumberId()
  const now = getNowIso()
  const [cliente, maquina] = await Promise.all([
    getCachedClienteById(ownerId, data.cliente_id),
    getCachedMaquinaById(ownerId, data.maquina_id),
  ])
  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'cliente', entityId: data.cliente_id },
    { entityType: 'maquina', entityId: data.maquina_id },
  ])

  const poliza: Poliza = {
    id: localId,
    cliente_id: data.cliente_id,
    maquina_id: data.maquina_id,
    activa: data.activa ?? true,
    fecha_inicio: data.fecha_inicio,
    observaciones: data.observaciones ?? null,
    created_at: now,
    cliente: cliente ?? undefined,
    maquina: maquina ?? undefined,
  }
  const historial = buildPolizaEstadoEvent(ownerId, localId, poliza.activa ? 'activa' : 'inactiva')

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'poliza.create',
    entityType: 'poliza',
    entityId: localId,
    payload: {
      localId,
      data,
    } satisfies PolizaCreatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.polizas,
      offlineDb.polizaEstadoHistorial,
      offlineDb.clientes,
      offlineDb.maquinas,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedPolizas(ownerId, [poliza])
      await upsertCachedPolizaEstadoHistorial(ownerId, [historial])
    },
  )

  return poliza
}

export async function queuePolizaSetActive(
  ownerId: string,
  polizaId: number,
  activa: boolean,
): Promise<Poliza> {
  const existing = await getCachedPolizaById(ownerId, polizaId)
  if (!existing) {
    throw new Error('No se encontró la póliza en caché local.')
  }

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'poliza', entityId: polizaId }])
  const updated: Poliza = {
    ...existing,
    activa,
  }
  const historial = buildPolizaEstadoEvent(ownerId, polizaId, activa ? 'activa' : 'inactiva')

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'poliza.set_active',
    entityType: 'poliza',
    entityId: polizaId,
    payload: {
      polizaId,
      activa,
    } satisfies PolizaSetActivePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.polizas,
      offlineDb.polizaEstadoHistorial,
      offlineDb.clientes,
      offlineDb.maquinas,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedPolizas(ownerId, [updated])
      await upsertCachedPolizaEstadoHistorial(ownerId, [historial])
    },
  )

  return updated
}

export async function queuePolizaUpdate(
  ownerId: string,
  polizaId: number,
  data: EditarPolizaInput,
): Promise<Poliza> {
  const existing = await getCachedPolizaById(ownerId, polizaId)
  if (!existing) {
    throw new Error('No se encontró la póliza en caché local.')
  }

  const [cliente, maquina] = await Promise.all([
    typeof data.cliente_id === 'number'
      ? getCachedClienteById(ownerId, data.cliente_id)
      : Promise.resolve(existing.cliente ?? null),
    typeof data.maquina_id === 'number'
      ? getCachedMaquinaById(ownerId, data.maquina_id)
      : Promise.resolve(existing.maquina ?? null),
  ])

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'poliza', entityId: polizaId },
    { entityType: 'cliente', entityId: data.cliente_id },
    { entityType: 'maquina', entityId: data.maquina_id },
  ])

  const updated: Poliza = {
    ...existing,
    ...data,
    cliente_id: typeof data.cliente_id === 'number' ? data.cliente_id : existing.cliente_id,
    maquina_id: typeof data.maquina_id === 'number' ? data.maquina_id : existing.maquina_id,
    observaciones: typeof data.observaciones === 'undefined' ? existing.observaciones : data.observaciones ?? null,
    activa: typeof data.activa === 'boolean' ? data.activa : existing.activa,
    cliente: cliente ?? undefined,
    maquina: maquina ?? undefined,
  }

  const historial = typeof data.activa === 'boolean' && data.activa !== existing.activa
    ? buildPolizaEstadoEvent(ownerId, polizaId, data.activa ? 'activa' : 'inactiva')
    : null

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'poliza.update',
    entityType: 'poliza',
    entityId: polizaId,
    payload: {
      polizaId,
      data,
    } satisfies PolizaUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.polizas,
      offlineDb.polizaEstadoHistorial,
      offlineDb.clientes,
      offlineDb.maquinas,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedPolizas(ownerId, [updated])
      if (historial) {
        await upsertCachedPolizaEstadoHistorial(ownerId, [historial])
      }
    },
  )

  return updated
}

export async function queuePolizaDelete(ownerId: string, polizaId: number): Promise<number> {
  const dependencies = await collectDependencies(ownerId, [{ entityType: 'poliza', entityId: polizaId }])
  const command = createOfflineCommandRecord({
    ownerId,
    type: 'poliza.delete',
    entityType: 'poliza',
    entityId: polizaId,
    payload: {
      polizaId,
    } satisfies PolizaDeletePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.polizas, offlineDb.polizaEstadoHistorial, async () => {
    await persistOfflineCommand(command)
    await offlineDb.polizas.delete(`${ownerId}:${polizaId}`)
    const historial = await offlineDb.polizaEstadoHistorial.where('[ownerId+poliza_id]').equals([ownerId, polizaId]).toArray()
    if (historial.length > 0) {
      await offlineDb.polizaEstadoHistorial.bulkDelete(historial.map((row) => row.cacheKey))
    }
  })

  return polizaId
}

export async function findRemotePolizaPausaByStart(fechaInicio: string): Promise<PolizaPausa | null> {
  const { data, error } = await supabase
    .from('poliza_pausas')
    .select(SELECT_POLIZA_PAUSA)
    .eq('fecha_inicio', fechaInicio)
    .is('fecha_reanudacion', null)
    .order('created_at', { ascending: true })
    .limit(1)

  if (error) throw error
  return ((data ?? [])[0] ?? null) as PolizaPausa | null
}

export async function queuePolizaPausaCreate(ownerId: string, data: CrearPolizaPausaInput): Promise<PolizaPausa> {
  const localId = createLocalNumberId()
  const now = getNowIso()
  const pausa: PolizaPausa = {
    id: localId,
    fecha_inicio: data.fecha_inicio,
    fecha_reanudacion: null,
    motivo: data.motivo?.trim() || null,
    created_at: now,
    created_by: ownerId,
    resumed_at: null,
    resumed_by: null,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'poliza_pause.create',
    entityType: 'poliza_pausa',
    entityId: localId,
    payload: {
      localId,
      data: {
        ...data,
        motivo: data.motivo?.trim() || null,
      },
    } satisfies PolizaPausaCreatePayload,
  })

  await offlineDb.transaction('rw', [offlineDb.commands, offlineDb.polizaPausas], async () => {
    await persistOfflineCommand(command)
    await upsertCachedPolizaPausas(ownerId, [pausa])
  })

  return pausa
}

export async function queuePolizaPausaResume(
  ownerId: string,
  pausaId: number,
  fechaReanudacion: string,
): Promise<PolizaPausa> {
  const existing = await getCachedPolizaPausaById(ownerId, pausaId)
  if (!existing) {
    throw new Error('No se encontró la pausa en caché local.')
  }

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'poliza_pausa', entityId: pausaId }])
  const now = getNowIso()
  const updated: PolizaPausa = {
    ...existing,
    fecha_reanudacion: fechaReanudacion,
    resumed_at: now,
    resumed_by: ownerId,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'poliza_pause.resume',
    entityType: 'poliza_pausa',
    entityId: pausaId,
    payload: {
      pausaId,
      fecha_reanudacion: fechaReanudacion,
    } satisfies PolizaPausaResumePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', [offlineDb.commands, offlineDb.polizaPausas], async () => {
    await persistOfflineCommand(command)
    await upsertCachedPolizaPausas(ownerId, [updated])
  })

  return updated
}

export async function syncPolizaCreate(ownerId: string, payload: PolizaCreatePayload) {
  const clienteId = await resolveLinkedNumberId(ownerId, 'cliente', payload.data.cliente_id)
  const maquinaId = await resolveLinkedNumberId(ownerId, 'maquina', payload.data.maquina_id)

  if (!clienteId || !maquinaId) {
    throw new Error('No se pudieron resolver las referencias de cliente o máquina para la póliza.')
  }

  const existing = await findRemotePolizaByFingerprint(clienteId, maquinaId, payload.data.fecha_inicio)
  if (existing) {
    await Promise.all([
      upsertEntityLink(ownerId, 'poliza', payload.localId, existing.id),
      upsertCachedPolizas(ownerId, [existing]),
    ])

    return existing
  }

  const { data, error } = await supabase
    .from('polizas')
    .insert({
      ...payload.data,
      cliente_id: clienteId,
      maquina_id: maquinaId,
    })
    .select(SELECT_POLIZA)
    .single()

  if (error) throw error

  const created = data as Poliza
  await Promise.all([
    upsertEntityLink(ownerId, 'poliza', payload.localId, created.id),
    upsertCachedPolizas(ownerId, [created]),
  ])

  return created
}

export async function syncPolizaUpdate(ownerId: string, payload: PolizaUpdatePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'poliza', payload.polizaId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto de la póliza.')
  }

  const data = { ...payload.data }
  if (typeof data.cliente_id === 'number') {
    data.cliente_id = await resolveLinkedNumberId(ownerId, 'cliente', data.cliente_id) ?? data.cliente_id
  }
  if (typeof data.maquina_id === 'number') {
    data.maquina_id = await resolveLinkedNumberId(ownerId, 'maquina', data.maquina_id) ?? data.maquina_id
  }

  const { data: updated, error } = await supabase
    .from('polizas')
    .update(data)
    .eq('id', remoteId)
    .select(SELECT_POLIZA)
    .single()

  if (error) throw error

  await upsertCachedPolizas(ownerId, [updated as Poliza])
  return updated as Poliza
}

export async function syncPolizaSetActive(ownerId: string, payload: PolizaSetActivePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'poliza', payload.polizaId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto de la póliza.')
  }

  const { data, error } = await supabase
    .from('polizas')
    .update({ activa: payload.activa })
    .eq('id', remoteId)
    .select(SELECT_POLIZA)
    .single()

  if (error) throw error

  const updated = data as Poliza
  await upsertCachedPolizas(ownerId, [updated])
  return updated
}

export async function syncPolizaDelete(ownerId: string, payload: PolizaDeletePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'poliza', payload.polizaId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto de la póliza.')
  }

  const { error } = await supabase
    .from('polizas')
    .delete()
    .eq('id', remoteId)

  if (error) throw error
  void ownerId
  return remoteId
}

export async function syncPolizaPausaCreate(ownerId: string, payload: PolizaPausaCreatePayload) {
  const existing = await findRemotePolizaPausaByStart(payload.data.fecha_inicio)
  if (existing) {
    await Promise.all([
      upsertEntityLink(ownerId, 'poliza_pausa', payload.localId, existing.id),
      upsertCachedPolizaPausas(ownerId, [existing]),
    ])

    return existing
  }

  const { data, error } = await supabase
    .from('poliza_pausas')
    .insert({
      fecha_inicio: payload.data.fecha_inicio,
      fecha_reanudacion: null,
      motivo: payload.data.motivo?.trim() || null,
      created_by: ownerId,
    })
    .select(SELECT_POLIZA_PAUSA)
    .single()

  if (error) throw error

  const created = data as PolizaPausa
  await Promise.all([
    upsertEntityLink(ownerId, 'poliza_pausa', payload.localId, created.id),
    upsertCachedPolizaPausas(ownerId, [created]),
  ])

  return created
}

export async function syncPolizaPausaResume(ownerId: string, payload: PolizaPausaResumePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'poliza_pausa', payload.pausaId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto de la pausa.')
  }

  const { data, error } = await supabase
    .from('poliza_pausas')
    .update({
      fecha_reanudacion: payload.fecha_reanudacion,
      resumed_at: getNowIso(),
      resumed_by: ownerId,
    })
    .eq('id', remoteId)
    .select(SELECT_POLIZA_PAUSA)
    .single()

  if (error) throw error

  const updated = data as PolizaPausa
  await upsertCachedPolizaPausas(ownerId, [updated])
  return updated
}
