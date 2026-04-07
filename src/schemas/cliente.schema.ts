import { z } from 'zod'

const optionalNullableTelefono = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(20).optional().nullable(),
)

const optionalNullableEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().email({ message: 'Correo inválido' }).optional().nullable(),
)

export const crearClienteSchema = z.object({
  codigo_cliente: z
    .string()
    .min(1, { message: 'El código es requerido' })
    .max(50),
  nombre: z
    .string()
    .min(2, { message: 'El nombre debe tener al menos 2 caracteres' })
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
  aviso: z.number().int().positive().optional().nullable(),
  parte_objeto: z.string().max(50).optional().nullable(),
  causa: z.string().max(50).optional().nullable(),
  descripcion: z
    .string()
    .min(10, { message: 'La descripción debe tener al menos 10 caracteres' })
    .max(1000),
  costo_total: z.number().nonnegative().optional().nullable(),
  tecnico_id: z.string().uuid({ message: 'Selecciona un técnico' }),
  firma_receptor: z.string().max(200).optional().nullable(),
})

export type CrearClienteInput = z.infer<typeof crearClienteSchema>
export type EditarClienteInput = z.infer<typeof editarClienteSchema>
export type CrearMaquinaInput = z.infer<typeof crearMaquinaSchema>
export type EditarMaquinaInput = z.infer<typeof editarMaquinaSchema>
export type CierreInput = z.infer<typeof cierreSchema>
