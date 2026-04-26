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

export const actualizarPerfilSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, { message: 'El nombre es requerido' })
    .max(120, { message: 'El nombre no puede superar 120 caracteres' }),
  correo: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'Correo inválido' })
    .max(150, { message: 'El correo no puede superar 150 caracteres' }),
  telefono: optionalNullableTelefono,
})

export const cambiarPasswordActualSchema = z.object({
  password: z
    .string()
    .min(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
    .max(100, { message: 'La contraseña no puede superar 100 caracteres' }),
  confirmar_password: z.string().min(1, { message: 'Confirma la contraseña' }),
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

export type ActualizarPerfilInput = z.infer<typeof actualizarPerfilSchema>
export type CambiarPasswordActualInput = z.infer<typeof cambiarPasswordActualSchema>
