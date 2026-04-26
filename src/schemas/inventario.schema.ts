import { z } from 'zod'

function normalizeNumericInput(value: unknown): unknown {
  if (value == null) return undefined
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (!normalized) return undefined
    const parsed = Number(normalized)
    return Number.isNaN(parsed) ? Number.NaN : parsed
  }
  return value
}

function requiredNonNegativeIntField(fieldLabel: string) {
  return z.preprocess(
    normalizeNumericInput,
    z
      .number({
        required_error: `El ${fieldLabel} es obligatorio`,
        invalid_type_error: `Ingresa un ${fieldLabel} válido`,
      })
      .int({ message: `El ${fieldLabel} debe ser un número entero` })
      .nonnegative({ message: `El ${fieldLabel} no puede ser negativo` })
      .refine((value) => !Object.is(value, -0), { message: `El ${fieldLabel} no puede ser negativo` }),
  )
}

const optionalNullablePrecioUnitarioField = z.preprocess(
  (value) => {
    const normalized = normalizeNumericInput(value)
    return typeof normalized === 'undefined' ? null : normalized
  },
  z
    .number({
      invalid_type_error: 'Ingresa un precio unitario válido',
    })
    .nonnegative({ message: 'El precio unitario no puede ser negativo' })
    .refine((value) => !Object.is(value, -0), { message: 'El precio unitario no puede ser negativo' })
    .nullable(),
)

export const crearItemInventarioSchema = z.object({
  nombre: z.string().min(2, { message: 'El nombre debe tener al menos 2 caracteres' }).max(200),
  descripcion: z.string().max(500).optional().nullable(),
  stock_actual: requiredNonNegativeIntField('stock actual'),
  stock_minimo: requiredNonNegativeIntField('stock mínimo'),
  precio_unitario: optionalNullablePrecioUnitarioField.optional(),
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
  inventory_source: z.enum(['general', 'tecnico']).optional().nullable(),
})

export const inventarioTecnicoSchema = z.object({
  tecnico_id: z.string().uuid(),
  inventario_id: z.number().int().positive(),
  cantidad: z.number().int().positive({ message: 'La cantidad debe ser mayor a 0' }),
  fecha: z.string().date(),
})

export interface CrearItemInventarioInput {
  nombre: string
  descripcion?: string | null
  stock_actual: number
  stock_minimo: number
  precio_unitario?: number | null
  activo: boolean
}

export type EditarItemInventarioInput = Partial<CrearItemInventarioInput>
export type AjusteInventarioInput = z.infer<typeof ajusteInventarioSchema>
export type RefaccionInput = z.infer<typeof refaccionSchema>
export type InventarioTecnicoInput = z.infer<typeof inventarioTecnicoSchema>
