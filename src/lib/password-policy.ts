const INSECURE_PASSWORD_PATTERN = /(1234|password|qwerty|admin|asdf)/i

export interface PasswordPolicyValidationResult {
  valid: boolean
  errors: string[]
  complexityScore: number
}

export function validatePasswordPolicy(password: string): PasswordPolicyValidationResult {
  const value = password ?? ''
  const checks = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ]

  const complexityScore = checks.filter(Boolean).length
  const errors: string[] = []

  if (value.length < 8) {
    errors.push('La contraseña debe tener al menos 8 caracteres.')
  }

  if (complexityScore < 3) {
    errors.push('La contraseña debe incluir al menos 3 de 4 tipos: mayúsculas, minúsculas, números y símbolos.')
  }

  if (INSECURE_PASSWORD_PATTERN.test(value)) {
    errors.push('La contraseña contiene patrones inseguros. Elige una más robusta.')
  }

  return {
    valid: errors.length === 0,
    errors,
    complexityScore,
  }
}

export function getPasswordPolicyError(password: string): string | null {
  return validatePasswordPolicy(password).errors[0] ?? null
}

export function assertPasswordPolicy(password: string): string {
  const error = getPasswordPolicyError(password)
  if (error) {
    throw new Error(error)
  }

  return password
}
