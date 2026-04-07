import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { maquinasKeys } from '@/hooks/use-maquinas'
import { serviciosKeys } from '@/hooks/use-servicios'
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

const SELECT_MAQUINAS_TALLER = `
  *,
  maquina:maquinas(*, cliente:clientes(id, nombre, codigo_cliente)),
  cliente:clientes(id, nombre, codigo_cliente),
  servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio, cliente_id, maquina_id)
`

const SELECT_MOVIMIENTOS_TALLER = `
  *,
  maquina:maquinas(id, serie, modelo, status),
  servicio:servicios(id, orden, tipo_servicio, status, fecha_servicio),
  usuario:profiles(id, nombre, correo)
`

function toNullableText(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim()
  return normalized.length ? normalized : null
}

export function useMaquinasEnTallerQuery(options?: MaquinasEnTallerQueryOptions) {
  const soloAbiertas = options?.soloAbiertas ?? false

  return useQuery({
    queryKey: maquinasTallerKeys.list(soloAbiertas),
    queryFn: async () => {
      let query = supabase
        .from('maquinas_en_taller')
        .select(SELECT_MAQUINAS_TALLER)
        .order('created_at', { ascending: false })

      if (soloAbiertas) {
        query = query.is('fecha_salida', null)
      }

      const { data, error } = await query
      if (error) throw error
      return data as MaquinaEnTaller[]
    },
    staleTime: 1000 * 60 * 3,
  })
}

export function useMaquinaTallerMovimientosQuery(maquinaId?: number) {
  return useQuery({
    queryKey: maquinasTallerKeys.movimientos(maquinaId),
    queryFn: async () => {
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
      return data as MaquinaTallerMovimiento[]
    },
    enabled: Boolean(maquinaId),
    staleTime: 1000 * 60 * 2,
  })
}

export function useServiciosTallerQuery(tipo: 'RETIRO' | 'INSTALACION') {
  return useQuery({
    queryKey: maquinasTallerKeys.servicios(tipo),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicios')
        .select('id, orden, tipo_servicio, status, fecha_servicio, cliente_id, maquina_id, cliente:clientes(id, nombre, codigo_cliente), maquina:maquinas(id, serie, modelo, status)')
        .ilike('tipo_servicio', `%${tipo}%`)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) throw error
      return data as ServicioTallerOption[]
    },
    staleTime: 1000 * 60 * 3,
  })
}

export function useRegistrarEntradaTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegistrarEntradaTallerInput) => {
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
      const motivo = input.motivo ?? (servicio?.tipo_servicio?.toUpperCase().includes('RETIRO') ? 'retiro' : 'manual')
      const origen = motivo === 'retiro' ? 'cliente' : motivo === 'instalacion' ? 'instalacion' : 'manual'

      const { data: registroAbierto } = await supabase
        .from('maquinas_en_taller')
        .select('id')
        .eq('maquina_id', maquinaId)
        .is('fecha_salida', null)
        .maybeSingle()

      if (registroAbierto?.id) {
        throw new Error('La maquina ya tiene un registro abierto en taller.')
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
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      qc.invalidateQueries({ queryKey: maquinasKeys.all })
      qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}

export function useRegistrarSalidaTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegistrarSalidaTallerInput) => {
      const { data: registro, error: registroError } = await supabase
        .from('maquinas_en_taller')
        .select('id, maquina_id, cliente_id, servicio_id, orden, fecha_salida, status, diagnostico')
        .eq('id', input.registro_id)
        .single()

      if (registroError) throw registroError

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

      const destino = input.tipo_salida === 'urban'
        ? 'URBAN'
        : clienteDestino
          ? `cliente:${clienteDestino}`
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
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      qc.invalidateQueries({ queryKey: maquinasKeys.all })
      qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })
}

export function useRegistrarReubicacionTallerMutation() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async (input: RegistrarReubicacionTallerInput) => {
      const { data: maquina, error: maquinaError } = await supabase
        .from('maquinas')
        .select('cliente_id')
        .eq('id', input.maquina_id)
        .single()

      if (maquinaError) throw maquinaError

      const { error: updateError } = await supabase
        .from('maquinas')
        .update({ cliente_id: input.cliente_destino_id })
        .eq('id', input.maquina_id)

      if (updateError) throw updateError

      await supabase
        .from('maquinas_en_taller')
        .update({ cliente_id: input.cliente_destino_id })
        .eq('maquina_id', input.maquina_id)
        .is('fecha_salida', null)

      const { data: userData } = await supabase.auth.getUser()
      const usuarioId = userData.user?.id ?? null

      const { error: movementError } = await supabase
        .from('maquinas_taller_movimientos')
        .insert({
          maquina_id: input.maquina_id,
          maquina_taller_id: null,
          servicio_id: null,
          orden_servicio: null,
          accion: 'reubicacion',
          motivo: 'reubicacion',
          origen: maquina.cliente_id ? `cliente:${maquina.cliente_id}` : 'sin_cliente',
          destino: `cliente:${input.cliente_destino_id}`,
          detalle: toNullableText(input.detalle),
          fecha_movimiento: input.fecha_movimiento,
          usuario_id: usuarioId,
        })

      if (movementError) {
        await supabase
          .from('maquinas')
          .update({ cliente_id: maquina.cliente_id })
          .eq('id', input.maquina_id)

        throw movementError
      }

      return input.maquina_id
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: maquinasTallerKeys.all })
      qc.invalidateQueries({ queryKey: maquinasKeys.all })
    },
  })
}
