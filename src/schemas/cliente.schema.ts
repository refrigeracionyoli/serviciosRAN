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

function normalizeNumericInput(value: unknown): unknown {
  if (value === '' || value == null) return undefined
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isNaN(parsed) ? Number.NaN : parsed
  }
  return value
}

function normalizeNullableNumericInput(value: unknown): unknown {
  const normalized = normalizeNumericInput(value)
  return typeof normalized === 'undefined' ? null : normalized
}

const optionalNullableTelefono = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(20).optional().nullable(),
)

const optionalNullableEmail = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim()
    return normalized === '' ? null : normalized
  },
  z
    .string()
    .email({ message: 'Ingresa un correo válido, por ejemplo supervisor@cliente.com' })
    .optional()
    .nullable(),
)

export const crearClienteSchema = z.object({
  codigo_cliente: z
    .string()
    .trim()
    .min(1, { message: 'El código cliente es requerido' })
    .max(50, { message: 'El código cliente no puede exceder 50 dígitos' })
    .regex(/^\d+$/, { message: 'El código cliente solo acepta números' })
    .refine((value) => value !== '0' && /[1-9]/.test(value), {
      message: 'El código cliente debe ser un número positivo mayor a 0',
    }),
  nombre: z
    .string()
    .min(1, { message: 'El nombre es requerido' })
    .max(200),
  direccion: z.string().max(500).optional().nullable(),
  municipio: z.string().max(100).optional().nullable(),
  telefono: optionalNullableTelefono,
  correo_contacto: optionalNullableEmail,
  activo: z.boolean().default(true),
})

export const editarClienteSchema = crearClienteSchema.partial()

export const crearMaquinaSchema = z.object({
  serie: z.string().min(1, { message: 'La serie es requerida' }).max(100),
  modelo: z.string().min(1, { message: 'Ingresa el modelo o nombre de máquina' }).max(120),
  cliente_id: z.number().int().positive().optional().nullable(),
  fecha_instalacion: z.string().date().optional().nullable(),
  status: z.enum(['operando', 'en_taller', 'baja']).default('operando'),
  observaciones: z.string().max(500).optional().nullable(),
  activo: z.boolean().default(true),
})

export const editarMaquinaSchema = crearMaquinaSchema.partial()

export const cierreSchema = z.object({
  servicio_id: z.number().int().positive(),
  aviso: z.preprocess(
    normalizeNumericInput,
    z
      .number({
        required_error: 'Ingresa el aviso SAP',
        invalid_type_error: 'Ingresa el aviso SAP',
      })
      .int({ message: 'El aviso SAP debe ser un número entero' })
      .positive({ message: 'El aviso SAP debe ser mayor a 0' })
      .refine((value) => !Object.is(value, -0), { message: 'El aviso SAP debe ser mayor a 0' }),
  ),
  parte_objeto: z.string().max(50).optional().nullable(),
  causa: z.string().max(50).optional().nullable(),
  descripcion: z
    .string()
    .min(10, { message: 'La descripción debe tener al menos 10 caracteres' })
    .max(1000),
  costo_total: z.preprocess(
    normalizeNullableNumericInput,
    z
      .number({
        invalid_type_error: 'Ingresa un costo reportado válido',
      })
      .nonnegative({ message: 'El costo reportado no puede ser negativo' })
      .refine((value) => !Object.is(value, -0), { message: 'El costo reportado no puede ser negativo' })
      .optional()
      .nullable(),
  ),
  tecnico_id: z.string().uuid({ message: 'Selecciona un técnico' }),
  fecha_cierre: z
    .string()
    .date('Fecha de cierre inválida')
    .refine(isNotFutureIsoDate, { message: 'La fecha de cierre no puede ser futura' })
    .optional(),
  firma_receptor: z.string().max(200).optional().nullable(),
})

export type CrearClienteInput = z.infer<typeof crearClienteSchema>
export type EditarClienteInput = z.infer<typeof editarClienteSchema>
export type CrearMaquinaInput = z.infer<typeof crearMaquinaSchema>
export type EditarMaquinaInput = z.infer<typeof editarMaquinaSchema>
export type CierreInput = z.infer<typeof cierreSchema>
