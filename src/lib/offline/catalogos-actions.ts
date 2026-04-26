import { getEdgeAuthHeaders } from '@/lib/edge-auth'
import {
  createOfflineCommandRecord,
  findPendingEntityCreateCommandId,
  persistOfflineCommand,
} from '@/lib/offline/commands'
import {
  buildCacheKey,
  createLocalNumberId,
  createLocalUuid,
  getCachedClienteById,
  getCachedMaquinaById,
  getCachedProfileById,
  getCachedServiciosSnapshot,
  isLocalNumberId,
  resolveLinkedNumberId,
  resolveLinkedStringId,
  upsertCachedClientes,
  upsertCachedMaquinas,
  upsertCachedProfiles,
  upsertEntityLink,
} from '@/lib/offline/cache'
import { offlineDb } from '@/lib/offline/db'
import { isLikelyUniqueViolation } from '@/lib/offline/network'
import { assertPasswordPolicy } from '@/lib/password-policy'
import { supabase } from '@/lib/supabase'
import type {
  CrearClienteInput,
  EditarClienteInput,
  CrearMaquinaInput,
  EditarMaquinaInput,
} from '@/schemas/cliente.schema'
import type {
  Cliente,
  Maquina,
  UserRole,
  Profile,
} from '@/types/domain.types'

function getNowIso(): string {
  return new Date().toISOString()
}

const SELECT_MAQUINA = '*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)'

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

async function hasLocalMaquinaReferences(ownerId: string, maquinaIds: Set<number>): Promise<boolean> {
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

  if (servicios.some((row) => typeof row.maquina_id === 'number' && maquinaIds.has(row.maquina_id))) return true
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

async function hasRemoteMaquinaReferences(maquinaId: number): Promise<boolean> {
  const [
    servicios,
    polizas,
    mantenimientos,
    maquinasTaller,
    maquinasTallerMovimientos,
  ] = await Promise.all([
    supabase.from('servicios').select('id').eq('maquina_id', maquinaId).limit(1),
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

async function deleteCachedMaquinas(ownerId: string, maquinaIds: Set<number>) {
  if (maquinaIds.size === 0) return
  await offlineDb.maquinas.bulkDelete(
    Array.from(maquinaIds).map((maquinaId) => buildCacheKey(ownerId, maquinaId)),
  )
}

async function deleteMaquinaEntityLinks(ownerId: string, maquinaIds: Set<number>) {
  if (maquinaIds.size === 0) return

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

export async function discardPendingInstallationMachine(ownerId: string, maquinaId: number): Promise<boolean> {
  const cachedMachine = await getCachedMaquinaById(ownerId, maquinaId)
  if (!isPendingInstallationMachine(cachedMachine)) return false

  const remoteId = await resolveLinkedNumberId(ownerId, 'maquina', maquinaId)
  const candidateIds = new Set<number>([maquinaId])
  if (remoteId) candidateIds.add(remoteId)

  if (await hasLocalMaquinaReferences(ownerId, candidateIds)) return false

  if (remoteId && !isLocalNumberId(remoteId)) {
    const { data: remoteMachine, error: remoteMachineError } = await supabase
      .from('maquinas')
      .select(SELECT_MAQUINA)
      .eq('id', remoteId)
      .maybeSingle()

    if (remoteMachineError) throw remoteMachineError

    if (remoteMachine) {
      if (!isPendingInstallationMachine(remoteMachine as Maquina)) return false
      if (await hasRemoteMaquinaReferences(remoteId)) return false

      const { error: deleteError } = await supabase
        .from('maquinas')
        .delete()
        .eq('id', remoteId)

      if (deleteError) throw deleteError
    }
  }

  await removePendingLocalMaquinaCreateCommands(ownerId, candidateIds)
  await deleteCachedMaquinas(ownerId, candidateIds)
  await deleteMaquinaEntityLinks(ownerId, candidateIds)
  return true
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

async function getProfileCreateFunctionHeaders() {
  return getEdgeAuthHeaders()
}

async function getFunctionErrorMessage(error: unknown, fallbackMessage: string): Promise<string> {
  if (error instanceof Error) {
    if (typeof (error as { context?: unknown }).context === 'undefined') {
      return error.message
    }
  }

  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const text = (await context.text()).trim()
        if (text.length) return text
      } catch {
        // Sin cuerpo utilizable en la respuesta.
      }
      return `Error ${context.status}: ${fallbackMessage}`
    }
  }

  if (error instanceof Error) return error.message
  return fallbackMessage
}

export async function findRemoteClienteByCodigo(codigoCliente: string): Promise<Cliente | null> {
  const normalized = codigoCliente.trim()
  if (!normalized) return null

  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .eq('codigo_cliente', normalized)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as Cliente | null
}

export async function findRemoteMaquinaBySerie(serie: string): Promise<Maquina | null> {
  const normalized = serie.trim()
  if (!normalized) return null

  const { data, error } = await supabase
    .from('maquinas')
    .select(SELECT_MAQUINA)
    .eq('serie', normalized)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as Maquina | null
}

export async function findRemoteProfileByCorreo(correo: string): Promise<Profile | null> {
  const normalized = correo.trim().toLowerCase()
  if (!normalized) return null

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('correo', normalized)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as Profile | null
}

export interface ClienteCreatePayload {
  localId: number
  data: CrearClienteInput
}

export interface ClienteUpdatePayload {
  clienteId: number
  data: EditarClienteInput
}

export interface ClienteDeletePayload {
  clienteId: number
}

export interface MaquinaCreatePayload {
  localId: number
  data: CrearMaquinaInput
}

export interface MaquinaUpdatePayload {
  maquinaId: number
  data: EditarMaquinaInput
}

export interface ProfileCreatePayload {
  localId: string
  data: CrearTecnicoCuentaPayload
}

export interface ProfileUpdatePayload {
  profileId: string
  data: Partial<Pick<Profile, 'nombre' | 'correo' | 'telefono' | 'activo'>>
  skipAuthUpdate?: boolean
}

export interface ProfileResetPasswordPayload {
  profileId: string
  password: string
}

export interface CrearTecnicoCuentaPayload {
  nombre: string
  correo: string
  telefono?: string | null
  activo?: boolean
  role: UserRole
  password: string
  notas?: string | null
}

export async function queueClienteCreate(ownerId: string, data: CrearClienteInput): Promise<Cliente> {
  const localId = createLocalNumberId()
  const now = getNowIso()

  const cliente: Cliente = {
    id: localId,
    codigo_cliente: data.codigo_cliente,
    nombre: data.nombre,
    direccion: data.direccion ?? null,
    municipio: data.municipio ?? null,
    telefono: data.telefono ?? null,
    correo_contacto: data.correo_contacto ?? null,
    activo: data.activo ?? true,
    created_at: now,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'cliente.create',
    entityType: 'cliente',
    entityId: localId,
    payload: {
      localId,
      data,
    } satisfies ClienteCreatePayload,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.clientes, async () => {
    await persistOfflineCommand(command)
    await upsertCachedClientes(ownerId, [cliente])
  })

  return cliente
}

export async function queueClienteUpdate(
  ownerId: string,
  clienteId: number,
  data: EditarClienteInput,
): Promise<Cliente> {
  const existing = await getCachedClienteById(ownerId, clienteId)
  if (!existing) {
    throw new Error('No se encontró el cliente en caché local.')
  }

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'cliente', entityId: clienteId }])
  const updated: Cliente = {
    ...existing,
    ...data,
    direccion: typeof data.direccion === 'undefined' ? existing.direccion : data.direccion ?? null,
    municipio: typeof data.municipio === 'undefined' ? existing.municipio : data.municipio ?? null,
    telefono: typeof data.telefono === 'undefined' ? existing.telefono : data.telefono ?? null,
    correo_contacto: typeof data.correo_contacto === 'undefined' ? existing.correo_contacto : data.correo_contacto ?? null,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'cliente.update',
    entityType: 'cliente',
    entityId: clienteId,
    payload: {
      clienteId,
      data,
    } satisfies ClienteUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.clientes, async () => {
    await persistOfflineCommand(command)
    await upsertCachedClientes(ownerId, [updated])
  })

  return updated
}

export async function queueClienteDelete(ownerId: string, clienteId: number): Promise<number> {
  const servicios = await getCachedServiciosSnapshot(ownerId)
  if (servicios.some((servicio) => servicio.cliente_id === clienteId)) {
    throw new Error('No se puede eliminar porque el cliente ya tiene servicios registrados.')
  }

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'cliente', entityId: clienteId }])
  const command = createOfflineCommandRecord({
    ownerId,
    type: 'cliente.delete',
    entityType: 'cliente',
    entityId: clienteId,
    payload: {
      clienteId,
    } satisfies ClienteDeletePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.clientes, async () => {
    await persistOfflineCommand(command)
    await offlineDb.clientes.delete(buildCacheKey(ownerId, clienteId))
  })

  return clienteId
}

export async function queueMaquinaCreate(ownerId: string, data: CrearMaquinaInput): Promise<Maquina> {
  const localId = createLocalNumberId()
  const now = getNowIso()
  const cliente = data.cliente_id ? await getCachedClienteById(ownerId, data.cliente_id) : null
  const dependencies = await collectDependencies(ownerId, [{ entityType: 'cliente', entityId: data.cliente_id }])

  const maquina: Maquina = {
    id: localId,
    serie: data.serie,
    modelo: data.modelo,
    cliente_id: data.cliente_id ?? null,
    fecha_instalacion: data.fecha_instalacion ?? null,
    status: data.status ?? 'operando',
    observaciones: data.observaciones ?? null,
    activo: data.activo ?? true,
    created_at: now,
    cliente: cliente ?? undefined,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'maquina.create',
    entityType: 'maquina',
    entityId: localId,
    payload: {
      localId,
      data,
    } satisfies MaquinaCreatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.maquinas, offlineDb.clientes, async () => {
    await persistOfflineCommand(command)
    await upsertCachedMaquinas(ownerId, [maquina])
  })

  return maquina
}

export async function queueMaquinaUpdate(
  ownerId: string,
  maquinaId: number,
  data: EditarMaquinaInput,
): Promise<Maquina> {
  const existing = await getCachedMaquinaById(ownerId, maquinaId)
  if (!existing) {
    throw new Error('No se encontró la máquina en caché local.')
  }

  const cliente = typeof data.cliente_id === 'number'
    ? await getCachedClienteById(ownerId, data.cliente_id)
    : existing.cliente ?? null
  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'maquina', entityId: maquinaId },
    { entityType: 'cliente', entityId: data.cliente_id },
  ])

  const updated: Maquina = {
    ...existing,
    ...data,
    modelo: (typeof data.modelo === 'undefined' ? existing.modelo : data.modelo),
    cliente_id: typeof data.cliente_id === 'number' ? data.cliente_id : existing.cliente_id,
    fecha_instalacion: typeof data.fecha_instalacion === 'undefined'
      ? existing.fecha_instalacion
      : data.fecha_instalacion ?? null,
    observaciones: typeof data.observaciones === 'undefined'
      ? existing.observaciones
      : data.observaciones ?? null,
    cliente: cliente ?? undefined,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'maquina.update',
    entityType: 'maquina',
    entityId: maquinaId,
    payload: {
      maquinaId,
      data,
    } satisfies MaquinaUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.maquinas, offlineDb.clientes, async () => {
    await persistOfflineCommand(command)
    await upsertCachedMaquinas(ownerId, [updated])
  })

  return updated
}

export async function queueProfileCreate(
  ownerId: string,
  data: CrearTecnicoCuentaPayload,
): Promise<Profile> {
  assertPasswordPolicy(data.password)

  const localId = createLocalUuid()
  const now = getNowIso()

  const profile: Profile = {
    id: localId,
    nombre: data.nombre,
    correo: data.correo,
    telefono: data.telefono ?? null,
    role: data.role,
    activo: data.activo ?? true,
    created_at: now,
    updated_at: now,
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'profile.create',
    entityType: 'profile',
    entityId: localId,
    payload: {
      localId,
      data,
    } satisfies ProfileCreatePayload,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.profiles, async () => {
    await persistOfflineCommand(command)
    await upsertCachedProfiles(ownerId, [profile])
  })

  return profile
}

export async function queueProfileUpdate(
  ownerId: string,
  profileId: string,
  data: Partial<Pick<Profile, 'nombre' | 'correo' | 'telefono' | 'activo'>>,
  options?: { skipAuthUpdate?: boolean },
): Promise<Profile> {
  const existing = await getCachedProfileById(ownerId, profileId)
  if (!existing) {
    throw new Error('No se encontró el empleado en caché local.')
  }

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'profile', entityId: profileId }])
  const updated: Profile = {
    ...existing,
    ...data,
    telefono: typeof data.telefono === 'undefined' ? existing.telefono : data.telefono ?? null,
    updated_at: getNowIso(),
  }

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'profile.update',
    entityType: 'profile',
    entityId: profileId,
    payload: {
      profileId,
      data,
      skipAuthUpdate: options?.skipAuthUpdate,
    } satisfies ProfileUpdatePayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction('rw', offlineDb.commands, offlineDb.profiles, async () => {
    await persistOfflineCommand(command)
    await upsertCachedProfiles(ownerId, [updated])
  })

  return updated
}

export async function queueProfileResetPassword(
  ownerId: string,
  profileId: string,
  password: string,
) {
  assertPasswordPolicy(password)

  const dependencies = await collectDependencies(ownerId, [{ entityType: 'profile', entityId: profileId }])
  const command = createOfflineCommandRecord({
    ownerId,
    type: 'profile.reset_password',
    entityType: 'profile',
    entityId: profileId,
    payload: {
      profileId,
      password,
    } satisfies ProfileResetPasswordPayload,
    dependsOn: dependencies,
  })

  await persistOfflineCommand(command)
  return command
}

export async function syncClienteCreate(ownerId: string, payload: ClienteCreatePayload) {
  const existing = await findRemoteClienteByCodigo(payload.data.codigo_cliente)
  if (existing) {
    await Promise.all([
      upsertEntityLink(ownerId, 'cliente', payload.localId, existing.id),
      upsertCachedClientes(ownerId, [existing]),
    ])

    return existing
  }

  const { data, error } = await supabase
    .from('clientes')
    .insert(payload.data)
    .select()
    .single()

  if (error) {
    if (isLikelyUniqueViolation(error)) {
      const duplicated = await findRemoteClienteByCodigo(payload.data.codigo_cliente)
      if (duplicated) {
        await Promise.all([
          upsertEntityLink(ownerId, 'cliente', payload.localId, duplicated.id),
          upsertCachedClientes(ownerId, [duplicated]),
        ])

        return duplicated
      }
    }

    throw error
  }

  const created = data as Cliente
  await Promise.all([
    upsertEntityLink(ownerId, 'cliente', payload.localId, created.id),
    upsertCachedClientes(ownerId, [created]),
  ])

  return created
}

export async function syncClienteUpdate(ownerId: string, payload: ClienteUpdatePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'cliente', payload.clienteId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del cliente.')
  }

  const { data, error } = await supabase
    .from('clientes')
    .update(payload.data)
    .eq('id', remoteId)
    .select()
    .single()

  if (error) throw error

  const updated = data as Cliente
  await upsertCachedClientes(ownerId, [updated])
  return updated
}

export async function syncClienteDelete(ownerId: string, payload: ClienteDeletePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'cliente', payload.clienteId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del cliente.')
  }

  const { count, error: countError } = await supabase
    .from('servicios')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', remoteId)

  if (countError) throw countError
  if ((count ?? 0) > 0) {
    throw new Error('No se puede eliminar porque el cliente ya tiene servicios registrados.')
  }

  const { error } = await supabase
    .from('clientes')
    .delete()
    .eq('id', remoteId)

  if (error) throw error
  return remoteId
}

export async function syncMaquinaCreate(ownerId: string, payload: MaquinaCreatePayload) {
  const clienteId = await resolveLinkedNumberId(ownerId, 'cliente', payload.data.cliente_id ?? null)
  const existing = await findRemoteMaquinaBySerie(payload.data.serie)

  if (existing) {
    await Promise.all([
      upsertEntityLink(ownerId, 'maquina', payload.localId, existing.id),
      upsertCachedMaquinas(ownerId, [existing]),
    ])

    return existing
  }

  const { data, error } = await supabase
    .from('maquinas')
    .insert({
      ...payload.data,
      cliente_id: clienteId,
    })
    .select(SELECT_MAQUINA)
    .single()

  if (error) {
    if (isLikelyUniqueViolation(error)) {
      const duplicated = await findRemoteMaquinaBySerie(payload.data.serie)
      if (duplicated) {
        await Promise.all([
          upsertEntityLink(ownerId, 'maquina', payload.localId, duplicated.id),
          upsertCachedMaquinas(ownerId, [duplicated]),
        ])

        return duplicated
      }
    }

    throw error
  }

  const created = data as Maquina
  await Promise.all([
    upsertEntityLink(ownerId, 'maquina', payload.localId, created.id),
    upsertCachedMaquinas(ownerId, [created]),
  ])

  return created
}

export async function syncMaquinaUpdate(ownerId: string, payload: MaquinaUpdatePayload) {
  const remoteId = await resolveLinkedNumberId(ownerId, 'maquina', payload.maquinaId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto de la máquina.')
  }

  const data = { ...payload.data }
  if (typeof data.cliente_id === 'number') {
    data.cliente_id = await resolveLinkedNumberId(ownerId, 'cliente', data.cliente_id) ?? data.cliente_id
  }

  const { data: updated, error } = await supabase
    .from('maquinas')
    .update(data)
    .eq('id', remoteId)
    .select('*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)')
    .single()

  if (error) throw error

  await upsertCachedMaquinas(ownerId, [updated as Maquina])
  return updated as Maquina
}

export async function syncProfileCreate(ownerId: string, payload: ProfileCreatePayload) {
  const existing = await findRemoteProfileByCorreo(payload.data.correo)
  if (existing) {
    await Promise.all([
      upsertEntityLink(ownerId, 'profile', payload.localId, existing.id),
      upsertCachedProfiles(ownerId, [existing]),
    ])

    return existing
  }

  const headers = await getProfileCreateFunctionHeaders()
  const { data, error } = await supabase.functions.invoke<{ profile: Profile }>('admin-create-tecnico', {
    body: payload.data,
    headers,
  })

  if (error) {
    const duplicated = await findRemoteProfileByCorreo(payload.data.correo)
    if (duplicated) {
      await Promise.all([
        upsertEntityLink(ownerId, 'profile', payload.localId, duplicated.id),
        upsertCachedProfiles(ownerId, [duplicated]),
      ])

      return duplicated
    }

    const message = await getFunctionErrorMessage(error, 'No se pudo crear el empleado.')
    throw new Error(message)
  }

  if (!data?.profile) {
    throw new Error('La función no devolvió el perfil del empleado creado.')
  }

  await Promise.all([
    upsertEntityLink(ownerId, 'profile', payload.localId, data.profile.id),
    upsertCachedProfiles(ownerId, [data.profile]),
  ])

  return data.profile
}

export async function syncProfileUpdate(ownerId: string, payload: ProfileUpdatePayload) {
  const remoteId = await resolveLinkedStringId(ownerId, 'profile', payload.profileId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del empleado.')
  }

  if (
    !payload.skipAuthUpdate
    && typeof payload.data.correo === 'string'
    && remoteId === ownerId
  ) {
    const { error: authError } = await supabase.auth.updateUser({
      email: payload.data.correo,
    })

    if (authError) {
      throw authError
    }
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(payload.data)
    .eq('id', remoteId)
    .select('*')
    .single()

  if (error) throw error

  const updated = data as Profile
  await upsertCachedProfiles(ownerId, [updated])
  return updated
}

export async function syncProfileResetPassword(ownerId: string, payload: ProfileResetPasswordPayload) {
  const remoteId = await resolveLinkedStringId(ownerId, 'profile', payload.profileId)
  if (!remoteId) {
    throw new Error('No se pudo resolver el identificador remoto del empleado.')
  }

  const headers = await getProfileCreateFunctionHeaders()
  const { error } = await supabase.functions.invoke('admin-reset-empleado-password', {
    body: {
      empleadoId: remoteId,
      password: payload.password,
    },
    headers,
  })

  if (error) {
    const message = await getFunctionErrorMessage(error, 'No se pudo cambiar la contraseña del empleado.')
    throw new Error(message)
  }

  void ownerId
  return remoteId
}
