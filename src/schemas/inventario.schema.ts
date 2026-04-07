import { z } from 'zod'

export const crearItemInventarioSchema = z.object({
  nombre: z.string().min(2, { message: 'El nombre debe tener al menos 2 caracteres' }).max(200),
  descripcion: z.string().max(500).optional().nullable(),
  stock_actual: z.number().int().nonnegative().default(0),
  stock_minimo: z.number().int().nonnegative().default(0),
  precio_unitario: z.number().nonnegative().optional().nullable(),
  activo: z.boolean().default(true),
})

export const editarItemInventarioSchema = crearItemInventarioSchema.partial()

export const ajusteInventarioSchema = z.object({
  inventario_id: z.number().int().positive(),
  tipo: z.enum(['entrada', 'salida', 'ajuste']),
  cantidad: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  motivo: z.string().max(500).optional().nullable(),
})

export const refaccionSchema = z.object({
  inventario_id: z.number().int().positive().optional().nullable(),
  nombre_refaccion: z.string().min(1, { message: 'Ingresa el nombre de la refacción' }).max(200),
  cantidad: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  precio_unitario: z.number().nonnegative({ message: 'El precio no puede ser negativo' }),
})

export const inventarioTecnicoSchema = z.object({
  tecnico_id: z.string().uuid(),
  inventario_id: z.number().int().positive(),
  cantidad: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  fecha: z.string().date(),
})

export type CrearItemInventarioInput = z.infer<typeof crearItemInventarioSchema>
export type EditarItemInventarioInput = z.infer<typeof editarItemInventarioSchema>
export type AjusteInventarioInput = z.infer<typeof ajusteInventarioSchema>
export type RefaccionInput = z.infer<typeof refaccionSchema>
export type InventarioTecnicoInput = z.infer<typeof inventarioTecnicoSchema>
