import { z } from 'zod'

function getTodayIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isNotFutureIsoDate(value: string): boolean {
  return value <= getTodayIsoDate()
}

const optionalNullableText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(120).optional().nullable(),
)

const optionalNullableDescripcion = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(500, { message: 'La descripción no puede superar 500 caracteres' }).optional().nullable(),
)

const optionalNullableDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .date({ message: 'Fecha de servicio inválida' })
    .refine(isNotFutureIsoDate, { message: 'La fecha de servicio no puede ser futura' })
    .optional()
    .nullable(),
)

export const crearServicioSchema = z.object({
  tipo_servicio: z.string().min(1, { message: 'Selecciona o captura un tipo de servicio' }).max(120),
  clase_orden: optionalNullableText,
  orden: z.number().int().positive().optional().nullable(),
  aviso: z.number().int().positive().optional().nullable(),
  cliente_id: z.number().int().positive({ message: 'Selecciona un cliente' }),
  maquina_id: z.number().int().positive({ message: 'Selecciona una máquina' }),
  tecnico_id: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().uuid({ message: 'Técnico inválido' }).optional().nullable(),
  ),
  descripcion: optionalNullableDescripcion,
  fecha_solicitud: z
    .string()
    .date({ message: 'Fecha de solicitud inválida' })
    .refine(isNotFutureIsoDate, { message: 'La fecha de solicitud no puede ser futura' }),
  fecha_servicio: optionalNullableDate,
  costo_mano_obra: z.number().nonnegative().default(0),
  // total NO va aquí — columna generada en DB
})

export const editarServicioSchema = crearServicioSchema.partial().extend({
  status: z
    .enum(['pendiente', 'en_ruta', 'completado'])
    .optional(),
  // El admin puede cambiar a 'cerrado' pero eso se hace desde CierreForm
})

export const cambiarStatusSchema = z.object({
  status: z.enum(['pendiente', 'en_ruta', 'completado']),
})

export type CrearServicioInput = z.infer<typeof crearServicioSchema>
export type EditarServicioInput = z.infer<typeof editarServicioSchema>
export type CambiarStatusInput = z.infer<typeof cambiarStatusSchema>
