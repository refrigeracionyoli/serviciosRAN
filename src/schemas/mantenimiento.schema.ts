import { z } from 'zod'

const fechaVisitaSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.string().date({ message: 'Fecha de visita inválida' }).nullable(),
)

const mantenimientoSchemaBase = z.object({
  poliza_id: z.number().int().positive({ message: 'Selecciona una póliza' }),
  cliente_id: z.number().int().positive({ message: 'Selecciona un cliente' }),
  maquina_id: z.number().int().positive({ message: 'Selecciona una máquina' }),
  tecnico_id: z
    .string()
    .uuid({ message: 'Selecciona un técnico válido' })
    .optional()
    .nullable(),
  status: z.enum(['pendiente', 'en_ruta', 'realizado']).optional(),
  tipo_servicio: z.string().default('MTTO PREVENTIVO RUTA'),
  descripcion: z.string().max(500).optional().nullable(),
  fecha_visita: fechaVisitaSchema,
  costo_refacciones: z.number().nonnegative().default(0),
  costo_mano_obra: z.number().nonnegative().default(0),
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
