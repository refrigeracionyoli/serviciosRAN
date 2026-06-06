import {
  createOfflineCommandRecord,
  findPendingEntityCreateCommandId,
  persistOfflineCommand,
} from '@/lib/offline/commands'
import {
  buildCacheKey,
  createLocalNumberId,
  getCachedClienteById,
  getCachedMaquinaById,
  getCachedProfileById,
  getCachedServicioDetalleSnapshot,
  resolveLinkedNumberId,
  upsertCachedMaquinas,
  upsertCachedMaquinasTaller,
  upsertCachedMaquinasTallerMovimientos,
  upsertEntityLink,
} from '@/lib/offline/cache'
import { offlineDb } from '@/lib/offline/db'
import { supabase } from '@/lib/supabase'
import type {
  MaquinaEnTaller,
  MaquinaTallerMovimiento,
  Servicio,
} from '@/types/domain.types'
import type {
  RegistrarEntradaTallerInput,
  RegistrarReubicacionTallerInput,
  RegistrarSalidaTallerInput,
} from '@/hooks/use-maquinas-taller'

const SELECT_MAQUINA = '*, cliente:clientes(id, nombre, codigo_cliente, direccion, municipio, telefono)'
const SELECT_MAQUINAS_TALLER = `
  *,
  maquina:maquinas(*, cliente:clientes(id, nombre, codigo_cliente)),
  cliente:clientes(id, nombre, codigo_cliente),
  servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, fecha_cierre, cliente_id, maquina_id)
`
const SELECT_MOVIMIENTOS_TALLER = `
  *,
  maquina:maquinas(id, serie, modelo, status),
  servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, fecha_cierre),
  usuario:profiles(id, nombre, correo)
`

function getNowIso(): string {
  return new Date().toISOString()
}

function toNullableText(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
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

export interface TallerRegistrarEntradaPayload {
  localId: number
  localMovementId: number
  input: RegistrarEntradaTallerInput
}

export interface TallerRegistrarSalidaPayload {
  registroId: number
  localMovementId: number
  input: RegistrarSalidaTallerInput
}

export interface TallerRegistrarReubicacionPayload {
  maquinaId: number
  localMovementId: number
  previousClienteId: number | null
  input: RegistrarReubicacionTallerInput
}

async function getCachedTallerRegistroById(ownerId: string, registroId: number): Promise<MaquinaEnTaller | null> {
  return (await offlineDb.maquinasTaller.get(buildCacheKey(ownerId, registroId))) ?? null
}

export async function queueRegistrarEntradaTaller(
  ownerId: string,
  input: RegistrarEntradaTallerInput,
): Promise<MaquinaEnTaller> {
  let servicio: Pick<Servicio, 'id' | 'orden' | 'maquina_id' | 'cliente_id' | 'tipo_servicio'> | null = null

  if (input.servicio_id) {
    const servicioData = await getCachedServicioDetalleSnapshot(ownerId, input.servicio_id)
    if (servicioData) {
      servicio = {
        id: servicioData.id,
        orden: servicioData.orden,
        maquina_id: servicioData.maquina_id,
        cliente_id: servicioData.cliente_id,
        tipo_servicio: servicioData.tipo_servicio,
      }
    }
  }

  const maquinaId = input.maquina_id ?? servicio?.maquina_id ?? null
  if (!maquinaId) {
    throw new Error('Debes seleccionar una maquina o una orden de servicio con maquina vinculada.')
  }

  const [maquinaActual, cliente] = await Promise.all([
    getCachedMaquinaById(ownerId, maquinaId),
    getCachedClienteById(ownerId, input.cliente_id ?? servicio?.cliente_id ?? 0),
  ])

  if (!maquinaActual) {
    throw new Error('No se encontró la máquina en caché local.')
  }

  const registrosAbiertos = await offlineDb.maquinasTaller
    .where('[ownerId+maquina_id]')
    .equals([ownerId, maquinaId])
    .toArray()

  const registroAbiertoLocal = registrosAbiertos.find((registro) => registro.fecha_salida === null)
  if (registroAbiertoLocal) {
    return registroAbiertoLocal
  }

  const clienteId = input.cliente_id ?? servicio?.cliente_id ?? null
  const orden = input.orden ?? servicio?.orden ?? null
  const diagnostico = toNullableText(input.diagnostico)
  const motivo = input.motivo ?? (servicio?.tipo_servicio?.toUpperCase().includes('RETIRO') ? 'retiro' : 'manual')
  const origen = motivo === 'retiro' ? 'cliente' : motivo === 'instalacion' ? 'instalacion' : 'manual'
  const localId = createLocalNumberId()
  const localMovementId = createLocalNumberId()
  const now = getNowIso()

  const registro: MaquinaEnTaller = {
    id: localId,
    maquina_id: maquinaId,
    cliente_id: clienteId,
    servicio_id: input.servicio_id ?? null,
    orden,
    fecha_entrada: input.fecha_entrada,
    fecha_salida: null,
    diagnostico,
    status: 'en_taller',
    created_at: now,
    maquina: {
      ...maquinaActual,
      status: 'en_taller',
    },
    cliente: cliente ?? undefined,
    servicio: input.servicio_id ? (await getCachedServicioDetalleSnapshot(ownerId, input.servicio_id)) ?? undefined : undefined,
  }

  const movimiento: MaquinaTallerMovimiento = {
    id: localMovementId,
    maquina_id: maquinaId,
    maquina_taller_id: localId,
    servicio_id: input.servicio_id ?? null,
    orden_servicio: orden,
    accion: 'entrada',
    motivo,
    origen,
    destino: 'taller',
    detalle: diagnostico,
    fecha_movimiento: input.fecha_entrada,
    usuario_id: ownerId,
    created_at: now,
    maquina: {
      ...maquinaActual,
      status: 'en_taller',
    },
    servicio: input.servicio_id ? (await getCachedServicioDetalleSnapshot(ownerId, input.servicio_id)) ?? undefined : undefined,
    usuario: await getCachedProfileById(ownerId, ownerId) ?? undefined,
  }

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'maquina', entityId: maquinaId },
    { entityType: 'cliente', entityId: clienteId },
    { entityType: 'servicio', entityId: input.servicio_id },
  ])

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'taller.registrar_entrada',
    entityType: 'maquina_taller',
    entityId: localId,
    payload: {
      localId,
      localMovementId,
      input,
    } satisfies TallerRegistrarEntradaPayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.maquinas,
      offlineDb.maquinasTaller,
      offlineDb.maquinasTallerMovimientos,
      offlineDb.clientes,
      offlineDb.servicios,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedMaquinas(ownerId, [{ ...maquinaActual, status: 'en_taller' }])
      await upsertCachedMaquinasTaller(ownerId, [registro])
      await upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento])
    },
  )

  return registro
}

export async function queueRegistrarSalidaTaller(
  ownerId: string,
  input: RegistrarSalidaTallerInput,
): Promise<number> {
  const registro = await getCachedTallerRegistroById(ownerId, input.registro_id)
  if (!registro) {
    throw new Error('No se encontró el registro de taller en caché local.')
  }
  if (registro.fecha_salida) {
    return input.registro_id
  }

  const maquinaActual = await getCachedMaquinaById(ownerId, registro.maquina_id)
  if (!maquinaActual) {
    throw new Error('No se encontró la máquina asociada en caché local.')
  }

  const servicio = input.servicio_id
    ? await getCachedServicioDetalleSnapshot(ownerId, input.servicio_id)
    : registro.servicio ?? null

  const clienteDestinoId = input.cliente_destino_id ?? servicio?.cliente_id ?? maquinaActual.cliente_id ?? null
  const clienteDestino = clienteDestinoId ? await getCachedClienteById(ownerId, clienteDestinoId) : null
  const detalle = toNullableText(input.detalle)
  const ordenServicio = servicio?.orden ?? registro.orden
  const localMovementId = createLocalNumberId()
  const now = getNowIso()

  const maquinaActualizada = input.tipo_salida === 'urban'
    ? {
        ...maquinaActual,
        status: 'baja' as const,
      }
    : {
        ...maquinaActual,
        status: 'operando' as const,
        cliente_id: clienteDestinoId,
        fecha_instalacion: input.fecha_salida,
        cliente: clienteDestino ?? undefined,
      }

  const registroActualizado: MaquinaEnTaller = {
    ...registro,
    fecha_salida: input.fecha_salida,
    status: 'devuelta',
    servicio_id: input.servicio_id ?? registro.servicio_id,
    diagnostico: detalle ?? registro.diagnostico,
    orden: ordenServicio ?? registro.orden,
    maquina: maquinaActualizada,
    servicio: servicio ?? registro.servicio,
  }

  const destino = input.tipo_salida === 'urban'
    ? 'URBAN'
    : clienteDestinoId
      ? `cliente:${clienteDestinoId}`
      : 'cliente'

  const movimiento: MaquinaTallerMovimiento = {
    id: localMovementId,
    maquina_id: registro.maquina_id,
    maquina_taller_id: registro.id,
    servicio_id: input.servicio_id ?? registro.servicio_id,
    orden_servicio: ordenServicio ?? registro.orden,
    accion: 'salida',
    motivo: input.tipo_salida,
    origen: 'taller',
    destino,
    detalle,
    fecha_movimiento: input.fecha_salida,
    usuario_id: ownerId,
    created_at: now,
    maquina: maquinaActualizada,
    servicio: servicio ?? registro.servicio,
    usuario: await getCachedProfileById(ownerId, ownerId) ?? undefined,
  }

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'maquina_taller', entityId: input.registro_id },
    { entityType: 'maquina', entityId: registro.maquina_id },
    { entityType: 'servicio', entityId: input.servicio_id ?? registro.servicio_id },
    { entityType: 'cliente', entityId: clienteDestinoId },
  ])

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'taller.registrar_salida',
    entityType: 'maquina_taller',
    entityId: input.registro_id,
    payload: {
      registroId: input.registro_id,
      localMovementId,
      input,
    } satisfies TallerRegistrarSalidaPayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.maquinas,
      offlineDb.maquinasTaller,
      offlineDb.maquinasTallerMovimientos,
      offlineDb.clientes,
      offlineDb.servicios,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedMaquinas(ownerId, [maquinaActualizada])
      await upsertCachedMaquinasTaller(ownerId, [registroActualizado])
      await upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento])
    },
  )

  return input.registro_id
}

export async function queueRegistrarReubicacionTaller(
  ownerId: string,
  input: RegistrarReubicacionTallerInput,
): Promise<number> {
  const maquinaActual = await getCachedMaquinaById(ownerId, input.maquina_id)
  if (!maquinaActual) {
    throw new Error('No se encontró la máquina en caché local.')
  }

  if (maquinaActual.cliente_id === input.cliente_destino_id) {
    return input.maquina_id
  }

  const clienteDestino = await getCachedClienteById(ownerId, input.cliente_destino_id)
  const localMovementId = createLocalNumberId()
  const now = getNowIso()

  const maquinaActualizada = {
    ...maquinaActual,
    cliente_id: input.cliente_destino_id,
    cliente: clienteDestino ?? undefined,
  }

  const registrosAbiertos = (await offlineDb.maquinasTaller
    .where('[ownerId+maquina_id]')
    .equals([ownerId, input.maquina_id])
    .toArray())
    .filter((registro) => registro.fecha_salida === null)
    .map((registro) => ({
      ...registro,
      cliente_id: input.cliente_destino_id,
      cliente: clienteDestino ?? undefined,
      maquina: maquinaActualizada,
    }))

  const movimiento: MaquinaTallerMovimiento = {
    id: localMovementId,
    maquina_id: input.maquina_id,
    maquina_taller_id: null,
    servicio_id: null,
    orden_servicio: null,
    accion: 'reubicacion',
    motivo: 'reubicacion',
    origen: maquinaActual.cliente_id ? `cliente:${maquinaActual.cliente_id}` : 'sin_cliente',
    destino: `cliente:${input.cliente_destino_id}`,
    detalle: toNullableText(input.detalle),
    fecha_movimiento: input.fecha_movimiento,
    usuario_id: ownerId,
    created_at: now,
    maquina: maquinaActualizada,
    usuario: await getCachedProfileById(ownerId, ownerId) ?? undefined,
  }

  const dependencies = await collectDependencies(ownerId, [
    { entityType: 'maquina', entityId: input.maquina_id },
    { entityType: 'cliente', entityId: input.cliente_destino_id },
  ])

  const command = createOfflineCommandRecord({
    ownerId,
    type: 'taller.reubicacion',
    entityType: 'maquina',
    entityId: input.maquina_id,
    payload: {
      maquinaId: input.maquina_id,
      localMovementId,
      previousClienteId: maquinaActual.cliente_id ?? null,
      input,
    } satisfies TallerRegistrarReubicacionPayload,
    dependsOn: dependencies,
  })

  await offlineDb.transaction(
    'rw',
    [
      offlineDb.commands,
      offlineDb.maquinas,
      offlineDb.maquinasTaller,
      offlineDb.maquinasTallerMovimientos,
      offlineDb.clientes,
      offlineDb.servicios,
      offlineDb.profiles,
    ],
    async () => {
      await persistOfflineCommand(command)
      await upsertCachedMaquinas(ownerId, [maquinaActualizada])
      if (registrosAbiertos.length > 0) {
        await upsertCachedMaquinasTaller(ownerId, registrosAbiertos)
      }
      await upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento])
    },
  )

  return input.maquina_id
}

export async function syncRegistrarEntradaTaller(ownerId: string, payload: TallerRegistrarEntradaPayload) {
  let servicio: Pick<Servicio, 'id' | 'orden' | 'maquina_id' | 'cliente_id' | 'tipo_servicio'> | null = null

  if (payload.input.servicio_id) {
    const remoteServicioId = await resolveLinkedNumberId(ownerId, 'servicio', payload.input.servicio_id)
    if (remoteServicioId) {
      const { data: servicioData, error: servicioError } = await supabase
        .from('servicios')
        .select('id, orden, maquina_id, cliente_id, tipo_servicio')
        .eq('id', remoteServicioId)
        .single()

      if (servicioError) throw servicioError
      servicio = servicioData
    }
  }

  const maquinaId = await resolveLinkedNumberId(ownerId, 'maquina', payload.input.maquina_id ?? servicio?.maquina_id ?? null)
  if (!maquinaId) {
    throw new Error('Debes seleccionar una maquina o una orden de servicio con maquina vinculada.')
  }

  const clienteId = await resolveLinkedNumberId(
    ownerId,
    'cliente',
    payload.input.cliente_id ?? servicio?.cliente_id ?? null,
  )
  const orden = payload.input.orden ?? servicio?.orden ?? null
  const diagnostico = toNullableText(payload.input.diagnostico)
  const motivo = payload.input.motivo ?? (servicio?.tipo_servicio?.toUpperCase().includes('RETIRO') ? 'retiro' : 'manual')
  const origen = motivo === 'retiro' ? 'cliente' : motivo === 'instalacion' ? 'instalacion' : 'manual'

  const { data: registroAbierto, error: registroAbiertoError } = await supabase
    .from('maquinas_en_taller')
    .select(SELECT_MAQUINAS_TALLER)
    .eq('maquina_id', maquinaId)
    .is('fecha_salida', null)
    .maybeSingle()

  if (registroAbiertoError) throw registroAbiertoError

  if (registroAbierto?.id) {
    await upsertCachedMaquinasTaller(ownerId, [registroAbierto as MaquinaEnTaller])
    return registroAbierto as MaquinaEnTaller
  }

  const { data: maquinaActual, error: maquinaError } = await supabase
    .from('maquinas')
    .select('status')
    .eq('id', maquinaId)
    .single()

  if (maquinaError) throw maquinaError

  const { data: created, error: insertError } = await supabase
    .from('maquinas_en_taller')
    .insert({
      maquina_id: maquinaId,
      cliente_id: clienteId,
      servicio_id: servicio?.id ?? null,
      orden,
      fecha_entrada: payload.input.fecha_entrada,
      diagnostico,
      status: 'en_taller',
    })
    .select('*, maquina:maquinas(*, cliente:clientes(id, nombre, codigo_cliente)), cliente:clientes(id, nombre, codigo_cliente), servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, fecha_cierre, cliente_id, maquina_id)')
    .single()

  if (insertError) throw insertError

  const { error: maquinaUpdateError } = await supabase
    .from('maquinas')
    .update({ status: 'en_taller' })
    .eq('id', maquinaId)

  if (maquinaUpdateError) {
    await supabase.from('maquinas_en_taller').delete().eq('id', created.id)
    throw maquinaUpdateError
  }

  const { data: userData } = await supabase.auth.getUser()
  const usuarioId = userData.user?.id ?? null

  const { data: movement, error: movementError } = await supabase
    .from('maquinas_taller_movimientos')
    .insert({
      maquina_id: maquinaId,
      maquina_taller_id: created.id,
      servicio_id: servicio?.id ?? null,
      orden_servicio: orden,
      accion: 'entrada',
      motivo,
      origen,
      destino: 'taller',
      detalle: diagnostico,
      fecha_movimiento: payload.input.fecha_entrada,
      usuario_id: usuarioId,
    })
    .select('*, maquina:maquinas(id, serie, modelo, status), servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, fecha_cierre), usuario:profiles(id, nombre, correo)')
    .single()

  if (movementError) {
    await supabase.from('maquinas').update({ status: maquinaActual.status }).eq('id', maquinaId)
    await supabase.from('maquinas_en_taller').delete().eq('id', created.id)
    throw movementError
  }

  await Promise.all([
    upsertEntityLink(ownerId, 'maquina_taller', payload.localId, created.id),
    upsertEntityLink(ownerId, 'maquina_taller_movimiento', payload.localMovementId, movement.id),
    upsertCachedMaquinasTaller(ownerId, [created as MaquinaEnTaller]),
    upsertCachedMaquinasTallerMovimientos(ownerId, [movement as MaquinaTallerMovimiento]),
  ])

  return created as MaquinaEnTaller
}

export async function syncRegistrarSalidaTaller(ownerId: string, payload: TallerRegistrarSalidaPayload) {
  const remoteRegistroId = await resolveLinkedNumberId(ownerId, 'maquina_taller', payload.registroId)
  if (!remoteRegistroId) {
    throw new Error('No se pudo resolver el identificador remoto del registro de taller.')
  }

  const { data: registro, error: registroError } = await supabase
    .from('maquinas_en_taller')
    .select('id, maquina_id, cliente_id, servicio_id, orden, fecha_salida, status, diagnostico')
    .eq('id', remoteRegistroId)
    .single()

  if (registroError) throw registroError

  const { data: maquina, error: maquinaError } = await supabase
    .from('maquinas')
    .select('status, cliente_id, fecha_instalacion')
    .eq('id', registro.maquina_id)
    .single()

  if (maquinaError) throw maquinaError

  let servicio: Pick<Servicio, 'id' | 'orden' | 'cliente_id'> | null = null
  if (payload.input.servicio_id) {
    const remoteServicioId = await resolveLinkedNumberId(ownerId, 'servicio', payload.input.servicio_id)
    if (remoteServicioId) {
      const { data: servicioData, error: servicioError } = await supabase
        .from('servicios')
        .select('id, orden, cliente_id')
        .eq('id', remoteServicioId)
        .single()

      if (servicioError) throw servicioError
      servicio = servicioData
    }
  }

  const remoteClienteDestinoId = await resolveLinkedNumberId(
    ownerId,
    'cliente',
    payload.input.cliente_destino_id ?? servicio?.cliente_id ?? maquina.cliente_id ?? null,
  )
  const ordenServicio = servicio?.orden ?? registro.orden
  const detalle = toNullableText(payload.input.detalle)
  const destino = payload.input.tipo_salida === 'urban'
    ? 'URBAN'
    : remoteClienteDestinoId
      ? `cliente:${remoteClienteDestinoId}`
      : 'cliente'

  // First-write-wins: si alguien ya cerró el registro antes, se descarta este cambio silenciosamente.
  if (registro.fecha_salida) {
    const { data: latestRegistro } = await supabase
      .from('maquinas_en_taller')
      .select(SELECT_MAQUINAS_TALLER)
      .eq('id', remoteRegistroId)
      .single()

    const { data: latestMaquina } = await supabase
      .from('maquinas')
      .select(SELECT_MAQUINA)
      .eq('id', registro.maquina_id)
      .single()

    const { data: existingMovement } = await supabase
      .from('maquinas_taller_movimientos')
      .select(SELECT_MOVIMIENTOS_TALLER)
      .eq('maquina_taller_id', remoteRegistroId)
      .eq('accion', 'salida')
      .eq('motivo', payload.input.tipo_salida)
      .eq('fecha_movimiento', payload.input.fecha_salida)
      .maybeSingle()

    await Promise.all([
      latestMaquina ? upsertCachedMaquinas(ownerId, [latestMaquina]) : Promise.resolve(),
      latestRegistro ? upsertCachedMaquinasTaller(ownerId, [latestRegistro as MaquinaEnTaller]) : Promise.resolve(),
      existingMovement
        ? Promise.all([
            upsertEntityLink(ownerId, 'maquina_taller_movimiento', payload.localMovementId, existingMovement.id),
            upsertCachedMaquinasTallerMovimientos(ownerId, [existingMovement as MaquinaTallerMovimiento]),
          ])
        : Promise.resolve(),
    ])

    return remoteRegistroId
  }

  const { error: salidaError } = await supabase
    .from('maquinas_en_taller')
    .update({
      fecha_salida: payload.input.fecha_salida,
      status: 'devuelta',
      servicio_id: servicio?.id ?? registro.servicio_id,
      diagnostico: detalle ?? registro.diagnostico,
    })
    .eq('id', remoteRegistroId)

  if (salidaError) throw salidaError

  const maquinaUpdate = payload.input.tipo_salida === 'urban'
    ? { status: 'baja' as const }
    : {
        status: 'operando' as const,
        cliente_id: remoteClienteDestinoId,
        fecha_instalacion: payload.input.fecha_salida,
      }

  const { error: maquinaUpdateError } = await supabase
    .from('maquinas')
    .update(maquinaUpdate)
    .eq('id', registro.maquina_id)

  if (maquinaUpdateError) {
    await supabase
      .from('maquinas_en_taller')
      .update({
        fecha_salida: registro.fecha_salida,
        status: registro.status,
        servicio_id: registro.servicio_id,
        diagnostico: registro.diagnostico,
      })
      .eq('id', remoteRegistroId)

    throw maquinaUpdateError
  }

  const { data: userData } = await supabase.auth.getUser()
  const usuarioId = userData.user?.id ?? null

  let movement = await supabase
    .from('maquinas_taller_movimientos')
    .select(SELECT_MOVIMIENTOS_TALLER)
    .eq('maquina_taller_id', remoteRegistroId)
    .eq('accion', 'salida')
    .eq('motivo', payload.input.tipo_salida)
    .eq('fecha_movimiento', payload.input.fecha_salida)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw error
      return data as MaquinaTallerMovimiento | null
    })

  if (!movement) {
    const { data: createdMovement, error: movementError } = await supabase
      .from('maquinas_taller_movimientos')
      .insert({
        maquina_id: registro.maquina_id,
        maquina_taller_id: remoteRegistroId,
        servicio_id: servicio?.id ?? registro.servicio_id,
        orden_servicio: ordenServicio,
        accion: 'salida',
        motivo: payload.input.tipo_salida,
        origen: 'taller',
        destino,
        detalle,
        fecha_movimiento: payload.input.fecha_salida,
        usuario_id: usuarioId,
      })
      .select(SELECT_MOVIMIENTOS_TALLER)
      .single()

    if (movementError) {
      await supabase
        .from('maquinas')
        .update({
          status: maquina.status,
          cliente_id: maquina.cliente_id,
          fecha_instalacion: maquina.fecha_instalacion,
        })
        .eq('id', registro.maquina_id)

      await supabase
        .from('maquinas_en_taller')
        .update({
          fecha_salida: registro.fecha_salida,
          status: registro.status,
          servicio_id: registro.servicio_id,
          diagnostico: registro.diagnostico,
        })
        .eq('id', remoteRegistroId)

      throw movementError
    }

    movement = createdMovement as MaquinaTallerMovimiento
  }

  const [{ data: updatedRegistro, error: updatedRegistroError }, { data: updatedMaquina, error: updatedMaquinaError }] = await Promise.all([
    supabase
      .from('maquinas_en_taller')
      .select(SELECT_MAQUINAS_TALLER)
      .eq('id', remoteRegistroId)
      .single(),
    supabase
      .from('maquinas')
      .select(SELECT_MAQUINA)
      .eq('id', registro.maquina_id)
      .single(),
  ])

  if (updatedRegistroError) throw updatedRegistroError
  if (updatedMaquinaError) throw updatedMaquinaError

  await Promise.all([
    upsertEntityLink(ownerId, 'maquina_taller_movimiento', payload.localMovementId, movement.id),
    upsertCachedMaquinas(ownerId, [updatedMaquina]),
    upsertCachedMaquinasTaller(ownerId, [updatedRegistro as MaquinaEnTaller]),
    upsertCachedMaquinasTallerMovimientos(ownerId, [movement]),
  ])

  return remoteRegistroId
}

export async function syncRegistrarReubicacionTaller(
  ownerId: string,
  payload: TallerRegistrarReubicacionPayload,
) {
  const remoteMaquinaId = await resolveLinkedNumberId(ownerId, 'maquina', payload.maquinaId)
  const remoteClienteDestinoId = await resolveLinkedNumberId(ownerId, 'cliente', payload.input.cliente_destino_id)

  if (!remoteMaquinaId || !remoteClienteDestinoId) {
    throw new Error('No se pudieron resolver las referencias remotas para la reubicación.')
  }

  const { data: maquinaActual, error: maquinaError } = await supabase
    .from('maquinas')
    .select('cliente_id')
    .eq('id', remoteMaquinaId)
    .single()

  if (maquinaError) throw maquinaError

  const destino = `cliente:${remoteClienteDestinoId}`

  const { data: existingMovement, error: existingMovementError } = await supabase
    .from('maquinas_taller_movimientos')
    .select(SELECT_MOVIMIENTOS_TALLER)
    .eq('maquina_id', remoteMaquinaId)
    .eq('accion', 'reubicacion')
    .eq('fecha_movimiento', payload.input.fecha_movimiento)
    .eq('destino', destino)
    .maybeSingle()

  if (existingMovementError) throw existingMovementError

  let movement = existingMovement as MaquinaTallerMovimiento | null

  if (maquinaActual.cliente_id === remoteClienteDestinoId) {
    if (!movement && payload.previousClienteId !== remoteClienteDestinoId) {
      const { data: userData } = await supabase.auth.getUser()
      const usuarioId = userData.user?.id ?? null
      const { data: createdMovement, error: movementError } = await supabase
        .from('maquinas_taller_movimientos')
        .insert({
          maquina_id: remoteMaquinaId,
          maquina_taller_id: null,
          servicio_id: null,
          orden_servicio: null,
          accion: 'reubicacion',
          motivo: 'reubicacion',
          origen: payload.previousClienteId ? `cliente:${String(payload.previousClienteId)}` : 'sin_cliente',
          destino,
          detalle: toNullableText(payload.input.detalle),
          fecha_movimiento: payload.input.fecha_movimiento,
          usuario_id: usuarioId,
        })
        .select(SELECT_MOVIMIENTOS_TALLER)
        .single()

      if (movementError) throw movementError
      movement = createdMovement as MaquinaTallerMovimiento
    }

    const { data: syncedMaquina } = await supabase
      .from('maquinas')
      .select(SELECT_MAQUINA)
      .eq('id', remoteMaquinaId)
      .single()

    await Promise.all([
      syncedMaquina ? upsertCachedMaquinas(ownerId, [syncedMaquina]) : Promise.resolve(),
      movement
        ? Promise.all([
            upsertEntityLink(ownerId, 'maquina_taller_movimiento', payload.localMovementId, movement.id),
            upsertCachedMaquinasTallerMovimientos(ownerId, [movement]),
          ])
        : Promise.resolve(),
    ])

    return remoteMaquinaId
  }

  // First-write-wins: si el cliente actual cambió desde que se encoló, se descarta esta reubicación.
  if (
    maquinaActual.cliente_id !== payload.previousClienteId
    && maquinaActual.cliente_id !== remoteClienteDestinoId
  ) {
    const { data: latestMaquina } = await supabase
      .from('maquinas')
      .select(SELECT_MAQUINA)
      .eq('id', remoteMaquinaId)
      .single()

    if (latestMaquina) {
      await upsertCachedMaquinas(ownerId, [latestMaquina])
    }

    return remoteMaquinaId
  }

  const { error: updateError } = await supabase
    .from('maquinas')
    .update({ cliente_id: remoteClienteDestinoId })
    .eq('id', remoteMaquinaId)

  if (updateError) throw updateError

  const { error: updateTallerError } = await supabase
    .from('maquinas_en_taller')
    .update({ cliente_id: remoteClienteDestinoId })
    .eq('maquina_id', remoteMaquinaId)
    .is('fecha_salida', null)

  if (updateTallerError) {
    await supabase
      .from('maquinas')
      .update({ cliente_id: maquinaActual.cliente_id })
      .eq('id', remoteMaquinaId)

    throw updateTallerError
  }

  if (!movement) {
    const { data: userData } = await supabase.auth.getUser()
    const usuarioId = userData.user?.id ?? null

    const { data: createdMovement, error: movementError } = await supabase
      .from('maquinas_taller_movimientos')
      .insert({
        maquina_id: remoteMaquinaId,
        maquina_taller_id: null,
        servicio_id: null,
        orden_servicio: null,
        accion: 'reubicacion',
        motivo: 'reubicacion',
        origen: maquinaActual.cliente_id ? `cliente:${String(maquinaActual.cliente_id)}` : 'sin_cliente',
        destino,
        detalle: toNullableText(payload.input.detalle),
        fecha_movimiento: payload.input.fecha_movimiento,
        usuario_id: usuarioId,
      })
      .select(SELECT_MOVIMIENTOS_TALLER)
      .single()

    if (movementError) {
      await supabase
        .from('maquinas')
        .update({ cliente_id: maquinaActual.cliente_id })
        .eq('id', remoteMaquinaId)

      await supabase
        .from('maquinas_en_taller')
        .update({ cliente_id: maquinaActual.cliente_id })
        .eq('maquina_id', remoteMaquinaId)
        .is('fecha_salida', null)

      throw movementError
    }

    movement = createdMovement as MaquinaTallerMovimiento
  }

  const [{ data: updatedMaquina, error: updatedMaquinaError }, { data: updatedRegistros, error: updatedRegistrosError }] = await Promise.all([
    supabase
      .from('maquinas')
      .select(SELECT_MAQUINA)
      .eq('id', remoteMaquinaId)
      .single(),
    supabase
      .from('maquinas_en_taller')
      .select(SELECT_MAQUINAS_TALLER)
      .eq('maquina_id', remoteMaquinaId)
      .is('fecha_salida', null),
  ])

  if (updatedMaquinaError) throw updatedMaquinaError
  if (updatedRegistrosError) throw updatedRegistrosError

  await Promise.all([
    upsertEntityLink(ownerId, 'maquina_taller_movimiento', payload.localMovementId, movement.id),
    upsertCachedMaquinas(ownerId, [updatedMaquina]),
    updatedRegistros && updatedRegistros.length > 0
      ? upsertCachedMaquinasTaller(ownerId, updatedRegistros as MaquinaEnTaller[])
      : Promise.resolve(),
    upsertCachedMaquinasTallerMovimientos(ownerId, [movement]),
  ])

  return remoteMaquinaId
}
