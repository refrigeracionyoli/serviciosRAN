import { z } from 'zod'

export const crearPolizaSchema = z.object({
  cliente_id: z.number().int().positive({ message: 'Selecciona un cliente' }),
  maquina_id: z.number().int().positive({ message: 'Selecciona una máquina' }),
  fecha_inicio: z.string().date('Fecha de inicio inválida'),
  observaciones: z.string().max(500).optional().nullable(),
  activa: z.boolean().default(true),
})

export const editarPolizaSchema = crearPolizaSchema.partial()

export type CrearPolizaInput = z.infer<typeof crearPolizaSchema>
export type EditarPolizaInput = z.infer<typeof editarPolizaSchema>
