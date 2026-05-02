function getRawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return ''
}

export function getSpanishErrorMessage(error: unknown, fallback: string): string {
  const message = getRawErrorMessage(error)
  if (!message) return fallback

  if (/duplicate key|unique constraint|violates unique/i.test(message)) {
    if (/maquinas|serie/i.test(message)) {
      return 'Ya existe una máquina con esa serie.'
    }
    if (/clientes|codigo_cliente/i.test(message)) {
      return 'Ya existe un cliente con ese código.'
    }
    if (/polizas/i.test(message)) {
      return 'Ya existe una póliza para ese establecimiento y máquina.'
    }
    return 'Ya existe un registro con esos datos.'
  }

  if (/foreign key|violates foreign key|is not present in table/i.test(message)) {
    if (/maquina/i.test(message)) return 'Selecciona una máquina válida.'
    if (/cliente/i.test(message)) return 'Selecciona un cliente válido.'
    return 'Revisa las referencias seleccionadas.'
  }

  if (/row-level security|permission denied|not authorized|no autorizado/i.test(message)) {
    return 'No tienes permisos para realizar esta acción.'
  }

  if (/check constraint|violates check constraint/i.test(message)) {
    return 'Revisa los datos capturados antes de continuar.'
  }

  return message
}
