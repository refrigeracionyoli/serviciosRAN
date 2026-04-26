import { z } from 'zod'
import { getPasswordPolicyError } from '@/lib/password-policy'

const optionalNullableTelefono = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .min(8, { message: 'El teléfono debe tener al menos 8 caracteres' })
    .max(20, { message: 'El teléfono no puede superar 20 caracteres' })
    .optional()
    .nullable(),
)

const optionalNullableNotas = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().max(500, { message: 'Las notas no pueden superar 500 caracteres' }).optional().nullable(),
)

export const crearTecnicoSchema = z.object({
  nombre: z
    .string()
    .min(1, { message: 'El nombre es requerido' })
    .max(120, { message: 'El nombre no puede superar 120 caracteres' }),
  telefono: optionalNullableTelefono,
  correo: z.string().email({ message: 'Correo inválido' }).max(150),
  role: z.enum(['tecnico', 'admin']).default('tecnico'),
  activo: z.boolean().default(true),
  password: z
    .string()
    .min(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
    .max(100, { message: 'La contraseña no puede superar 100 caracteres' }),
  confirmar_password: z.string().min(1, { message: 'Confirma la contraseña' }),
  notas: optionalNullableNotas,
}).superRefine((data, context) => {
  const passwordError = getPasswordPolicyError(data.password)
  if (passwordError) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: passwordError,
    })
  }

  if (data.password !== data.confirmar_password) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmar_password'],
      message: 'Las contraseñas no coinciden',
    })
  }
})

export type CrearTecnicoInput = z.infer<typeof crearTecnicoSchema>
