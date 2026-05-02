import { z } from 'zod'

const fechaVisitaSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.string().date('Fecha de visita inválida').nullable(),
)

function normalizeNumericInput(value: unknown): unknown {
  if (value === '' || value == null) return 0
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isNaN(parsed) ? Number.NaN : parsed
  }
  return value
}

function nonNegativeMoneyField(messages: { invalid: string; negative: string }) {
  return z.preprocess(
    normalizeNumericInput,
    z
      .number({
        invalid_type_error: messages.invalid,
      })
      .nonnegative({ message: messages.negative })
      .refine((value) => !Object.is(value, -0), {
        message: messages.negative,
      }),
  )
}

const mantenimientoSchemaBase = z.object({
  poliza_id: z
    .number({
      required_error: 'Selecciona una póliza',
      invalid_type_error: 'Selecciona una póliza',
    })
    .int()
    .positive({ message: 'Selecciona una póliza' }),
  cliente_id: z
    .number({
      required_error: 'Selecciona un cliente',
      invalid_type_error: 'Selecciona un cliente',
    })
    .int()
    .positive({ message: 'Selecciona un cliente' }),
  maquina_id: z
    .number({
      required_error: 'Selecciona una máquina',
      invalid_type_error: 'Selecciona una máquina',
    })
    .int()
    .positive({ message: 'Selecciona una máquina' }),
  tecnico_id: z
    .string()
    .uuid({ message: 'Selecciona un técnico válido' })
    .optional()
    .nullable(),
  status: z.enum(['pendiente', 'en_ruta', 'realizado']).optional(),
  tipo_servicio: z.string().default('MTTO PREVENTIVO RUTA'),
  descripcion: z.string().max(500).optional().nullable(),
  fecha_visita: fechaVisitaSchema,
  costo_refacciones: nonNegativeMoneyField({
    invalid: 'Ingresa un costo de refacciones válido',
    negative: 'El costo de refacciones no puede ser negativo',
  }).default(0),
  costo_mano_obra: nonNegativeMoneyField({
    invalid: 'Ingresa una mano de obra válida',
    negative: 'La mano de obra no puede ser negativa',
  }).default(0),
  notas: z.string().max(500).optional().nullable(),
})

export const crearMantenimientoSchema = mantenimientoSchemaBase.superRefine((data, ctx) => {
  if (!data.tecnico_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['tecnico_id'],
      message: 'Selecciona un técnico',
    })
  }
})

export const editarMantenimientoSchema = mantenimientoSchemaBase.partial().extend({
  status: z.enum(['pendiente', 'en_ruta', 'realizado']).optional(),
})

export type CrearMantenimientoInput = z.infer<typeof crearMantenimientoSchema>
export type EditarMantenimientoInput = z.infer<typeof editarMantenimientoSchema>
