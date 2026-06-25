import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { maquinasKeys } from '@/hooks/use-maquinas'
import { serviciosKeys } from '@/hooks/use-servicios'
import { hasBlockingRemoteFetchCommands } from '@/lib/offline/commands'
import {
  queueRegistrarEntradaTaller,
  queueRegistrarReubicacionTaller,
  queueRegistrarSalidaTaller,
  syncRegistrarReubicacionTaller,
} from '@/lib/offline/taller-actions'
import {
  createLocalNumberId,
  getCachedMaquinasTallerMovimientosSnapshot,
  getCachedMaquinasTallerSnapshot,
  getCachedServiciosSnapshot,
  isLocalNumberId,
  replaceCachedMaquinasTallerMovimientosSnapshot,
  replaceCachedMaquinasTallerSnapshot,
  upsertCachedMaquinasTaller,
  upsertCachedMaquinasTallerMovimientos,
  upsertCachedServicios,
} from '@/lib/offline/cache'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline/network'
import { withOfflineFallback } from '@/lib/offline/query-fallback'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import { isRetiroServiceType, normalizeServiceType } from '@/lib/service-types'
import type {
  Cliente,
  Maquina,
  MaquinaEnTaller,
  MaquinaTallerMovimiento,
  Servicio,
} from '@/types/domain.types'

export const maquinasTallerKeys = {
  all: ['maquinas-taller'] as const,
  list: (soloAbiertas: boolean) => ['maquinas-taller', 'list', soloAbiertas] as const,
  movimientos: (maquinaId?: number) => ['maquinas-taller', 'movimientos', maquinaId] as const,
  servicios: (tipo: 'RETIRO' | 'INSTALACION') => ['maquinas-taller', 'servicios', tipo] as const,
}

interface MaquinasEnTallerQueryOptions {
  soloAbiertas?: boolean
}

export interface ServicioTallerOption {
  id: number
  orden: number | null
  tipo_servicio: string
  status: Servicio['status']
  fecha_servicio: string | null
  cliente_id: number | null
  maquina_id: number | null
  cliente?: Pick<Cliente, 'id' | 'nombre' | 'codigo_cliente'>
  maquina?: Pick<Maquina, 'id' | 'serie' | 'modelo' | 'status'>
}

export interface RegistrarEntradaTallerInput {
  maquina_id?: number
  cliente_id?: number | null
  servicio_id?: number | null
  fecha_entrada: string
  diagnostico?: string | null
  orden?: number | null
  motivo?: 'retiro' | 'manual' | 'instalacion'
}

export interface RegistrarSalidaTallerInput {
  registro_id: number
  tipo_salida: 'instalacion' | 'urban' | 'otro'
  servicio_id?: number | null
  cliente_destino_id?: number | null
  fecha_salida: string
  detalle?: string | null
}

export interface RegistrarReubicacionTallerInput {
  maquina_id: number
  cliente_destino_id: number
  fecha_movimiento: string
  detalle?: string | null
}

export interface EliminarMaquinaTallerInput {
  registro_id: number
}

export interface ActualizarDiagnosticoTallerInput {
  registro_id: number
  diagnostico: string | null
  fecha_movimiento?: string
}

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

const SELECT_SERVICIOS_TALLER = `
  *,
  cliente:clientes(*),
  maquina:maquinas(*),
  tecnico:profiles(id, nombre, correo, role)
`

function toNullableText(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

function getTodayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildDiagnosticChangeDetail(previousValue: string | null, nextValue: string | null): string {
  const previous = previousValue?.trim() || 'Sin diagnostico'
  const next = nextValue?.trim() || 'Sin diagnostico'
  return `Diagnostico actualizado. Anterior: ${previous} | Nuevo: ${next}`
}

function buildServicioTallerOptions(servicios: Servicio[], tipo: 'RETIRO' | 'INSTALACION'): ServicioTallerOption[] {
  const needle = normalizeServiceType(tipo)

  return servicios
    .filter((servicio) => normalizeServiceType(servicio.tipo_servicio).includes(needle))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 200)
    .map((servicio) => ({
      id: servicio.id,
      orden: servicio.orden,
      tipo_servicio: servicio.tipo_servicio,
      status: servicio.status,
      fecha_servicio: servicio.fecha_servicio,
      cliente_id: servicio.cliente_id,
      maquina_id: servicio.maquina_id,
      cliente: servicio.cliente
        ? {
            id: servicio.cliente.id,
            nombre: servicio.cliente.nombre,
            codigo_cliente: servicio.cliente.codigo_cliente,
          }
        : undefined,
      maquina: servicio.maquina
        ? {
            id: servicio.maquina.id,
            serie: servicio.maquina.serie,
            modelo: servicio.maquina.modelo,
            status: servicio.maquina.status,
          }
        : undefined,
    }))
}

export function useMaquinasEnTallerQuery(options?: MaquinasEnTallerQueryOptions) {
  const soloAbiertas = options?.soloAbiertas ?? false

  return useQuery({
    queryKey: maquinasTallerKeys.list(soloAbiertas),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(
        ownerId,
        ['taller.registrar_entrada', 'taller.registrar_salida', 'taller.reubicacion', 'servicio.update', 'servicio.close'],
      )
      if (shouldUseLocalOnly) {
        return getCachedMaquinasTallerSnapshot(ownerId, { soloAbiertas })
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('maquinas_en_taller')
            .select(SELECT_MAQUINAS_TALLER)
            .order('created_at', { ascending: false })

          if (soloAbiertas) {
            query = query.is('fecha_salida', null)
          }

          const { data, error } = await query
          if (error) throw error
          await replaceCachedMaquinasTallerSnapshot(ownerId, data as MaquinaEnTaller[], { soloAbiertas })
          return getCachedMaquinasTallerSnapshot(ownerId, { soloAbiertas })
        },
        local: () => getCachedMaquinasTallerSnapshot(ownerId, { soloAbiertas }),
      })
    },
    staleTime: 1000 * 60 * 3,
  })
}

interface MaquinaTallerMovimientosQueryOptions {
  enabled?: boolean
}

export function useMaquinaTallerMovimientosQuery(
  maquinaId?: number | null,
  options?: MaquinaTallerMovimientosQueryOptions,
) {
  return useQuery({
    queryKey: maquinasTallerKeys.movimientos(maquinaId ?? undefined),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = (maquinaId != null && isLocalNumberId(maquinaId)) || await hasBlockingRemoteFetchCommands(
        ownerId,
        ['taller.registrar_entrada', 'taller.registrar_salida', 'taller.reubicacion', 'servicio.update', 'servicio.close'],
      )
      if (shouldUseLocalOnly) {
        return getCachedMaquinasTallerMovimientosSnapshot(ownerId, maquinaId ?? undefined)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('maquinas_taller_movimientos')
            .select(SELECT_MOVIMIENTOS_TALLER)
            .order('fecha_movimiento', { ascending: false })
            .order('created_at', { ascending: false })

          if (maquinaId) {
            query = query.eq('maquina_id', maquinaId)
          }

          const { data, error } = await query
          if (error) throw error
          await replaceCachedMaquinasTallerMovimientosSnapshot(ownerId, data as MaquinaTallerMovimiento[], {
            maquinaId: maquinaId ?? undefined,
          })
          return getCachedMaquinasTallerMovimientosSnapshot(ownerId, maquinaId ?? undefined)
        },
        local: () => getCachedMaquinasTallerMovimientosSnapshot(ownerId, maquinaId ?? undefined),
      })
    },
    enabled: options?.enabled ?? true,
    staleTime: 1000 * 60 * 2,
  })
}

export function useServiciosTallerQuery(tipo: 'RETIRO' | 'INSTALACION') {
  return useQuery({
    queryKey: maquinasTallerKeys.servicios(tipo),
    queryFn: async () => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) return []

      const shouldUseLocalOnly = await hasBlockingRemoteFetchCommands(
        ownerId,
        ['servicio.create', 'servicio.update', 'servicio.close'],
      )
      if (shouldUseLocalOnly) {
        return buildServicioTallerOptions(await getCachedServiciosSnapshot(ownerId), tipo)
      }

      return withOfflineFallback({
        remote: async () => {
          let query = supabase
            .from('servicios')
            .select(SELECT_SERVICIOS_TALLER)
            .order('created_at', { ascending: false })
            .limit(200)

          if (tipo === 'INSTALACION') {
            query = query.or('tipo_servicio.ilike.%INSTALACION%,tipo_servicio.ilike.%INSTALACIÓN%')
          } else {
            query = query.ilike('tipo_servicio', `%${tipo}%`)
          }

          const { data, error } = await query

          if (error) throw error
          await upsertCachedServicios(ownerId, data as Servicio[])
          return buildServicioTallerOptions(await getCachedServiciosSnapshot(ownerId), tipo)
        },
        local: async () => buildServicioTallerOptions(await getCachedServiciosSnapshot(ownerId), tipo),
      })
    },
    staleTime: 1000 * 60 * 3,
  })
}

export function useRegistrarEntradaTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegistrarEntradaTallerInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para registrar la máquina en taller.')
      }

      if (isBrowserOnline()) {
        try {
          const hasLocalReferences = (
            (typeof input.maquina_id === 'number' && isLocalNumberId(input.maquina_id))
            || (typeof input.cliente_id === 'number' && isLocalNumberId(input.cliente_id))
            || (typeof input.servicio_id === 'number' && isLocalNumberId(input.servicio_id))
          )

          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          let servicio: Pick<Servicio, 'id' | 'orden' | 'maquina_id' | 'cliente_id' | 'tipo_servicio'> | null = null

          if (input.servicio_id) {
            const { data: servicioData, error: servicioError } = await supabase
              .from('servicios')
              .select('id, orden, maquina_id, cliente_id, tipo_servicio')
              .eq('id', input.servicio_id)
              .single()

            if (servicioError) throw servicioError
            servicio = servicioData
          }

          const maquinaId = input.maquina_id ?? servicio?.maquina_id ?? null
          if (!maquinaId) {
            throw new Error('Debes seleccionar una maquina o una orden de servicio con maquina vinculada.')
          }

          const clienteId = input.cliente_id ?? servicio?.cliente_id ?? null
          const orden = input.orden ?? servicio?.orden ?? null
          const diagnostico = toNullableText(input.diagnostico)
          const motivo = input.motivo ?? (isRetiroServiceType(servicio?.tipo_servicio) ? 'retiro' : 'manual')
          const origen = motivo === 'retiro' ? 'cliente' : motivo === 'instalacion' ? 'instalacion' : 'manual'

          const { data: registroAbierto, error: registroAbiertoError } = await supabase
            .from('maquinas_en_taller')
            .select(SELECT_MAQUINAS_TALLER)
            .eq('maquina_id', maquinaId)
            .is('fecha_salida', null)
            .maybeSingle()

          if (registroAbiertoError) throw registroAbiertoError

          if (registroAbierto?.id) {
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
              servicio_id: input.servicio_id ?? null,
              orden,
              fecha_entrada: input.fecha_entrada,
              diagnostico,
              status: 'en_taller',
            })
            .select(SELECT_MAQUINAS_TALLER)
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

          const { error: movementError } = await supabase
            .from('maquinas_taller_movimientos')
            .insert({
              maquina_id: maquinaId,
              maquina_taller_id: created.id,
              servicio_id: input.servicio_id ?? null,
              orden_servicio: orden,
              accion: 'entrada',
              motivo,
              origen,
              destino: 'taller',
              detalle: diagnostico,
              fecha_movimiento: input.fecha_entrada,
              usuario_id: usuarioId,
            })

          if (movementError) {
            await supabase.from('maquinas').update({ status: maquinaActual.status }).eq('id', maquinaId)
            await supabase.from('maquinas_en_taller').delete().eq('id', created.id)
            throw movementError
          }

          return created as MaquinaEnTaller
        } catch (error) {
          if (!(error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') && !isLikelyNetworkError(error)) {
            throw error
          }
        }
      }

      return queueRegistrarEntradaTaller(ownerId, input)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      await qc.invalidateQueries({ queryKey: ['maquinas-taller', 'movimientos'] })
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
      await qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}

export function useRegistrarSalidaTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegistrarSalidaTallerInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para registrar la salida de taller.')
      }

      if (isBrowserOnline()) {
        try {
          const hasLocalReferences = (
            isLocalNumberId(input.registro_id)
            || (typeof input.servicio_id === 'number' && isLocalNumberId(input.servicio_id))
            || (typeof input.cliente_destino_id === 'number' && isLocalNumberId(input.cliente_destino_id))
          )

          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          const { data: registro, error: registroError } = await supabase
            .from('maquinas_en_taller')
            .select('id, maquina_id, cliente_id, servicio_id, orden, fecha_salida, status, diagnostico')
            .eq('id', input.registro_id)
            .single()

          if (registroError) throw registroError
          if (registro.fecha_salida) {
            return registro.id
          }

          const { data: maquina, error: maquinaError } = await supabase
            .from('maquinas')
            .select('status, cliente_id, fecha_instalacion')
            .eq('id', registro.maquina_id)
            .single()

          if (maquinaError) throw maquinaError

          let servicio: Pick<Servicio, 'id' | 'orden' | 'cliente_id'> | null = null
          if (input.servicio_id) {
            const { data: servicioData, error: servicioError } = await supabase
              .from('servicios')
              .select('id, orden, cliente_id')
              .eq('id', input.servicio_id)
              .single()

            if (servicioError) throw servicioError
            servicio = servicioData
          }

          const clienteDestino = input.cliente_destino_id ?? servicio?.cliente_id ?? maquina.cliente_id ?? null
          const ordenServicio = servicio?.orden ?? registro.orden
          const detalle = toNullableText(input.detalle)

          const { error: salidaError } = await supabase
            .from('maquinas_en_taller')
            .update({
              fecha_salida: input.fecha_salida,
              status: 'devuelta',
              servicio_id: input.servicio_id ?? registro.servicio_id,
              diagnostico: detalle ?? registro.diagnostico,
            })
            .eq('id', registro.id)

          if (salidaError) throw salidaError

          const maquinaUpdate = input.tipo_salida === 'urban'
            ? { status: 'baja' as const }
            : {
                status: 'operando' as const,
                cliente_id: clienteDestino,
                fecha_instalacion: input.fecha_salida,
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
              .eq('id', registro.id)

            throw maquinaUpdateError
          }

          const { data: userData } = await supabase.auth.getUser()
          const usuarioId = userData.user?.id ?? null

          const clienteDestinoLabel = String(clienteDestino ?? '')
          const destino = input.tipo_salida === 'urban'
            ? 'URBAN'
            : clienteDestino
              ? `cliente:${clienteDestinoLabel}`
              : 'cliente'

          const { error: movementError } = await supabase
            .from('maquinas_taller_movimientos')
            .insert({
              maquina_id: registro.maquina_id,
              maquina_taller_id: registro.id,
              servicio_id: input.servicio_id ?? registro.servicio_id,
              orden_servicio: ordenServicio,
              accion: 'salida',
              motivo: input.tipo_salida,
              origen: 'taller',
              destino,
              detalle,
              fecha_movimiento: input.fecha_salida,
              usuario_id: usuarioId,
            })

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
              .eq('id', registro.id)

            throw movementError
          }

          return registro.id
        } catch (error) {
          if (!(error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') && !isLikelyNetworkError(error)) {
            throw error
          }
        }
      }

      return queueRegistrarSalidaTaller(ownerId, input)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      await qc.invalidateQueries({ queryKey: ['maquinas-taller', 'movimientos'] })
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
      await qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}

export function useEliminarMaquinaTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: EliminarMaquinaTallerInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para quitar la máquina de taller.')
      }

      if (!isBrowserOnline() || isLocalNumberId(input.registro_id)) {
        throw new Error('No se puede quitar una máquina de taller sin conexión. Inténtalo nuevamente con internet.')
      }

      const { data: registro, error: registroError } = await supabase
        .from('maquinas_en_taller')
        .select('id, maquina_id, cliente_id, fecha_salida, status')
        .eq('id', input.registro_id)
        .maybeSingle()

      if (registroError) throw registroError
      if (!registro) {
        return input.registro_id
      }

      if (registro.fecha_salida) {
        throw new Error('Solo se pueden quitar registros abiertos de taller.')
      }

      const { data: maquina, error: maquinaError } = await supabase
        .from('maquinas')
        .select('status, cliente_id')
        .eq('id', registro.maquina_id)
        .single()

      if (maquinaError) throw maquinaError

      const { error: maquinaUpdateError } = await supabase
        .from('maquinas')
        .update({
          status: 'operando',
          cliente_id: registro.cliente_id ?? maquina.cliente_id,
        })
        .eq('id', registro.maquina_id)

      if (maquinaUpdateError) throw maquinaUpdateError

      const rollbackMachine = async () => {
        await supabase
          .from('maquinas')
          .update({
            status: maquina.status,
            cliente_id: maquina.cliente_id,
          })
          .eq('id', registro.maquina_id)
      }

      const { error: movimientosDeleteError } = await supabase
        .from('maquinas_taller_movimientos')
        .delete()
        .eq('maquina_taller_id', registro.id)

      if (movimientosDeleteError) {
        await rollbackMachine()
        throw movimientosDeleteError
      }

      const { error: registroDeleteError } = await supabase
        .from('maquinas_en_taller')
        .delete()
        .eq('id', registro.id)

      if (registroDeleteError) {
        await rollbackMachine()
        throw registroDeleteError
      }

      return registro.id
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      await qc.invalidateQueries({ queryKey: ['maquinas-taller', 'movimientos'] })
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
      await qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}

export function useActualizarDiagnosticoTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: ActualizarDiagnosticoTallerInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para actualizar el diagnóstico.')
      }

      if (!isBrowserOnline() || isLocalNumberId(input.registro_id)) {
        throw new Error('No se puede actualizar el diagnóstico de taller sin conexión. Inténtalo nuevamente con internet.')
      }

      const diagnostico = toNullableText(input.diagnostico)

      const { data: registro, error: registroError } = await supabase
        .from('maquinas_en_taller')
        .select('id, maquina_id, servicio_id, orden, fecha_salida, status, diagnostico')
        .eq('id', input.registro_id)
        .maybeSingle()

      if (registroError) throw registroError
      if (!registro) {
        throw new Error('No se encontró el registro de taller.')
      }

      if (registro.fecha_salida) {
        throw new Error('Solo se puede actualizar el diagnóstico de máquinas abiertas en taller.')
      }

      const { data: updated, error: updateError } = await supabase
        .from('maquinas_en_taller')
        .update({ diagnostico })
        .eq('id', registro.id)
        .select(SELECT_MAQUINAS_TALLER)
        .single()

      if (updateError) throw updateError

      const { data: userData } = await supabase.auth.getUser()
      const usuarioId = userData.user?.id ?? null

      const { data: movimiento, error: movementError } = await supabase
        .from('maquinas_taller_movimientos')
        .insert({
          maquina_id: registro.maquina_id,
          maquina_taller_id: registro.id,
          servicio_id: registro.servicio_id,
          orden_servicio: registro.orden,
          accion: 'nota',
          motivo: 'diagnostico',
          origen: 'taller',
          destino: 'taller',
          detalle: buildDiagnosticChangeDetail(registro.diagnostico, diagnostico),
          fecha_movimiento: input.fecha_movimiento ?? getTodayIsoDate(),
          usuario_id: usuarioId,
        })
        .select(SELECT_MOVIMIENTOS_TALLER)
        .single()

      if (movementError) {
        await supabase
          .from('maquinas_en_taller')
          .update({ diagnostico: registro.diagnostico })
          .eq('id', registro.id)

        throw movementError
      }

      await Promise.all([
        upsertCachedMaquinasTaller(ownerId, [updated as MaquinaEnTaller]),
        movimiento
          ? upsertCachedMaquinasTallerMovimientos(ownerId, [movimiento as MaquinaTallerMovimiento])
          : Promise.resolve(),
      ])

      return updated as MaquinaEnTaller
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      await qc.invalidateQueries({ queryKey: ['maquinas-taller', 'movimientos'] })
    },
  })
}

export function useRegistrarReubicacionTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegistrarReubicacionTallerInput) => {
      const ownerId = await getCurrentSessionUserId()
      if (!ownerId) {
        throw new Error('No hay sesión activa para registrar la reubicación.')
      }

      if (isBrowserOnline()) {
        try {
          const hasLocalReferences = isLocalNumberId(input.maquina_id) || isLocalNumberId(input.cliente_destino_id)
          if (hasLocalReferences) {
            throw new Error('OFFLINE_LOCAL_REFS')
          }

          const { data: maquina, error: maquinaError } = await supabase
            .from('maquinas')
            .select('cliente_id')
            .eq('id', input.maquina_id)
            .single()

          if (maquinaError) throw maquinaError
          return syncRegistrarReubicacionTaller(ownerId, {
            maquinaId: input.maquina_id,
            localMovementId: createLocalNumberId(),
            previousClienteId: maquina.cliente_id ?? null,
            input,
          })
        } catch (error) {
          if (!(error instanceof Error && error.message === 'OFFLINE_LOCAL_REFS') && !isLikelyNetworkError(error)) {
            throw error
          }
        }
      }

      return queueRegistrarReubicacionTaller(ownerId, input)
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      await qc.invalidateQueries({ queryKey: ['maquinas-taller', 'movimientos'] })
      await qc.invalidateQueries({ queryKey: maquinasKeys.all })
    },
  })
}
