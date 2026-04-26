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
    .date('Fecha de servicio inválida')
    .optional()
    .nullable(),
)

function requiredPositiveIntegerField(label: string) {
  return z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const normalized = value.trim()
        if (!normalized) return undefined
        if (!/^\d+$/.test(normalized)) return Number.NaN
        return Number(normalized)
      }

      if (typeof value === 'number') return value
      return undefined
    },
    z
      .number({
        required_error: `${label} es obligatorio`,
        invalid_type_error: `${label} debe contener solo números`,
      })
      .int({ message: `${label} debe ser un número entero` })
      .positive({ message: `${label} debe ser mayor a 0` }),
  )
}

function requiredPositiveIdField(message: string) {
  return z.preprocess(
    (value) => {
      if (typeof value === 'string') {
        const normalized = value.trim()
        if (!normalized) return undefined
        return Number(normalized)
      }

      return value
    },
    z
      .number({
        required_error: message,
        invalid_type_error: message,
      })
      .int({ message })
      .positive({ message }),
  )
}

function validateServiceDateOrder(
  data: {
    fecha_solicitud?: string | null
    fecha_servicio?: string | null
  },
  ctx: z.RefinementCtx,
) {
  if (!data.fecha_solicitud || !data.fecha_servicio) return
  if (data.fecha_servicio >= data.fecha_solicitud) return

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['fecha_solicitud'],
    message: 'La fecha de solicitud no puede ser posterior a la fecha de servicio',
  })

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['fecha_servicio'],
    message: 'La fecha de servicio no puede ser anterior a la fecha de solicitud',
  })
}

const servicioBaseSchema = z.object({
  tipo_servicio: z.string().min(1, { message: 'Selecciona o captura un tipo de servicio' }).max(120),
  clase_orden: optionalNullableText,
  orden: requiredPositiveIntegerField('El No. de orden'),
  aviso: requiredPositiveIntegerField('El No. de aviso'),
  cliente_id: requiredPositiveIdField('Selecciona un cliente'),
  maquina_id: requiredPositiveIdField('Selecciona una máquina'),
  tecnico_id: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().uuid({ message: 'Técnico inválido' }).optional().nullable(),
  ),
  descripcion: optionalNullableDescripcion,
  fecha_solicitud: z
    .string()
    .date('Fecha de solicitud inválida')
    .refine(isNotFutureIsoDate, { message: 'La fecha de solicitud no puede ser futura' }),
  fecha_servicio: optionalNullableDate,
  costo_mano_obra: z.number().nonnegative().default(0),
  // total NO va aquí — columna generada en DB
})

export const crearServicioSchema = servicioBaseSchema.superRefine(validateServiceDateOrder)

export const editarServicioSchema = servicioBaseSchema.partial().extend({
  status: z
    .enum(['pendiente', 'en_ruta', 'completado'])
    .optional(),
  // El admin puede cambiar a 'cerrado' pero eso se hace desde CierreForm
}).superRefine(validateServiceDateOrder)

export const cambiarStatusSchema = z.object({
  status: z.enum(['pendiente', 'en_ruta', 'completado']),
})

export type CrearServicioInput = z.infer<typeof crearServicioSchema>
export type EditarServicioInput = z.infer<typeof editarServicioSchema>
export type CambiarStatusInput = z.infer<typeof cambiarStatusSchema>
