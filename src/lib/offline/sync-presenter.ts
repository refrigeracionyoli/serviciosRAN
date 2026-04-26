import type { OfflineCommandRecord } from '@/lib/offline/db'

export interface SyncCommandPresentation {
  title: string
  description: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function getPayload(command: OfflineCommandRecord): Record<string, unknown> | null {
  return isRecord(command.payload) ? command.payload : null
}

function getPayloadData(command: OfflineCommandRecord): Record<string, unknown> | null {
  const payload = getPayload(command)
  return payload && isRecord(payload.data) ? payload.data : null
}

function isOrdenServicioFilename(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

function getDisplayFilename(filename: string): string {
  const parts = filename.split('__')
  if (parts.length >= 3) {
    return parts.slice(2).join('__')
  }
  return filename
}

function getEntityLabel(entityType: string): string {
  if (entityType === 'cliente') return 'Cliente'
  if (entityType === 'maquina') return 'Máquina'
  if (entityType === 'profile') return 'Empleado'
  if (entityType === 'servicio') return 'Servicio'
  if (entityType === 'poliza') return 'Póliza'
  if (entityType === 'poliza_pausa') return 'Pausa de pólizas'
  if (entityType === 'mantenimiento') return 'Mantenimiento'
  if (entityType === 'inventario') return 'Refacción'
  if (entityType === 'inventario_tecnico') return 'Inventario técnico'
  if (entityType === 'evidencia') return 'Evidencia'
  if (entityType === 'maquina_taller') return 'Registro de taller'
  return 'Registro'
}

function getEntityReference(entityType: string, entityId: string | number | null | undefined): string | null {
  const label = getEntityLabel(entityType)
  if (entityId == null) return label
  return `${label} #${entityId}`
}

function formatRefaccionesCount(items: unknown): string | null {
  if (!Array.isArray(items)) return null
  return `${items.length} refacción(es)`
}

function getPrimaryDetail(command: OfflineCommandRecord): string | null {
  const payload = getPayload(command)
  const data = getPayloadData(command)

  const filename = readText(payload?.filename)
  if (filename) {
    return getDisplayFilename(filename)
  }

  const nombre = readText(data?.nombre) ?? readText(payload?.nombre)
  if (nombre) return nombre

  const correo = readText(data?.correo)
  if (correo) return correo

  const serie = readText(data?.serie)
  if (serie) return `Serie ${serie}`

  const tipoServicio = readText(data?.tipo_servicio)
  if (tipoServicio) return tipoServicio

  const serviceId = readNumber(payload?.serviceId)
  if (serviceId != null) return `Servicio #${serviceId}`

  const mantenimientoId = readNumber(payload?.mantenimientoId)
  if (mantenimientoId != null) return `Mantenimiento #${mantenimientoId}`

  const polizaId = readNumber(payload?.polizaId)
  if (polizaId != null) return `Póliza #${polizaId}`

  const pausaId = readNumber(payload?.pausaId)
  if (pausaId != null) return `Pausa #${pausaId}`

  const clienteId = readNumber(payload?.clienteId)
  if (clienteId != null) return `Cliente #${clienteId}`

  const maquinaId = readNumber(payload?.maquinaId)
  if (maquinaId != null) return `Máquina #${maquinaId}`

  const itemId = readNumber(payload?.itemId)
  if (itemId != null) return `Refacción #${itemId}`

  const inventarioId = readNumber(payload?.inventario_id) ?? readNumber(data?.inventario_id)
  if (inventarioId != null) return `Refacción #${inventarioId}`

  const registroId = readNumber(payload?.registroId)
  if (registroId != null) return `Registro #${registroId}`

  return getEntityReference(command.entityType, command.entityId)
}

function getSecondaryDetail(command: OfflineCommandRecord): string | null {
  const payload = getPayload(command)
  const data = getPayloadData(command)

  if (command.type === 'servicio.replace_refacciones') {
    return formatRefaccionesCount(payload?.items)
  }

  if (command.type === 'mantenimiento.replace_refacciones') {
    return formatRefaccionesCount(payload?.items)
  }

  if (command.type === 'service.update_status') {
    const status = readText(payload?.status)
    return status ? `Estado: ${status.replace('_', ' ')}` : null
  }

  if (command.type === 'inventario_tecnico.upsert') {
    const cantidad = readNumber(data?.cantidad)
    const fecha = readText(data?.fecha)
    if (cantidad != null && fecha) return `${cantidad} pieza(s) · ${fecha}`
    if (cantidad != null) return `${cantidad} pieza(s)`
    return fecha
  }

  if (command.type === 'inventario_tecnico.delete') {
    const cantidad = readNumber(payload?.cantidad)
    const fecha = readText(payload?.fecha)
    if (cantidad != null && fecha) return `${cantidad} pieza(s) · ${fecha}`
    if (cantidad != null) return `${cantidad} pieza(s)`
    return fecha
  }

  if (command.type === 'inventario.adjust') {
    const cantidad = readNumber(data?.cantidad)
    return cantidad != null ? `${cantidad} unidad(es)` : null
  }

  if (command.type === 'poliza.set_active') {
    return payload?.activa === false ? 'Se desactivará al sincronizar' : 'Se activará al sincronizar'
  }

  if (command.type === 'inventario.set_active') {
    return payload?.activo === false ? 'Se desactivará al sincronizar' : 'Se activará al sincronizar'
  }

  if (command.type === 'taller.registrar_entrada' || command.type === 'taller.registrar_salida' || command.type === 'taller.reubicacion') {
    const input = payload?.input
    if (isRecord(input)) {
      const orden = readText(input.orden)
      if (orden) return `Orden ${orden}`
    }
  }

  return null
}

export function getSyncCommandPresentation(command: OfflineCommandRecord): SyncCommandPresentation {
  const payload = getPayload(command)
  const data = getPayloadData(command)
  const primaryDetail = getPrimaryDetail(command)
  const secondaryDetail = getSecondaryDetail(command)

  if (command.type === 'cliente.create') {
    return { title: 'Crear cliente', description: primaryDetail }
  }

  if (command.type === 'cliente.update') {
    return { title: 'Actualizar cliente', description: primaryDetail }
  }

  if (command.type === 'cliente.delete') {
    return { title: 'Eliminar cliente', description: primaryDetail }
  }

  if (command.type === 'maquina.create') {
    return { title: 'Crear máquina', description: primaryDetail }
  }

  if (command.type === 'maquina.update') {
    return { title: 'Actualizar máquina', description: primaryDetail }
  }

  if (command.type === 'profile.create') {
    return {
      title: data?.role === 'tecnico' ? 'Crear técnico' : 'Crear empleado',
      description: primaryDetail,
    }
  }

  if (command.type === 'profile.update') {
    return {
      title: command.entityId === command.ownerId ? 'Actualizar perfil' : 'Actualizar empleado',
      description: primaryDetail,
    }
  }

  if (command.type === 'profile.reset_password') {
    return {
      title: command.entityId === command.ownerId ? 'Cambiar contraseña' : 'Cambiar contraseña de empleado',
      description: primaryDetail,
    }
  }

  if (command.type === 'servicio.create') {
    return { title: 'Crear servicio', description: primaryDetail }
  }

  if (command.type === 'servicio.update') {
    return { title: 'Actualizar servicio', description: primaryDetail }
  }

  if (command.type === 'servicio.replace_refacciones') {
    return {
      title: 'Guardar refacciones del servicio',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'servicio.close') {
    return { title: 'Cerrar servicio', description: primaryDetail }
  }

  if (command.type === 'service.complete_with_refacciones') {
    return { title: 'Completar servicio', description: primaryDetail }
  }

  if (command.type === 'service.update_status') {
    return {
      title: 'Actualizar estado del servicio',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'service.add_evidencia') {
    return {
      title: readText(payload?.filename) && isOrdenServicioFilename(readText(payload?.filename) ?? '')
        ? 'Subir orden de servicio'
        : 'Subir evidencia del servicio',
      description: [getEntityReference('servicio', readNumber(payload?.serviceId)), primaryDetail]
        .filter(Boolean)
        .join(' · ') || null,
    }
  }

  if (command.type === 'service.delete_evidencia') {
    return {
      title: 'Eliminar evidencia del servicio',
      description: getEntityReference('servicio', readNumber(payload?.serviceId)),
    }
  }

  if (command.type === 'poliza.create') {
    return { title: 'Crear póliza', description: primaryDetail }
  }

  if (command.type === 'poliza.update') {
    return { title: 'Actualizar póliza', description: primaryDetail }
  }

  if (command.type === 'poliza.set_active') {
    return {
      title: payload?.activa === false ? 'Desactivar póliza' : 'Activar póliza',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'poliza.delete') {
    return { title: 'Eliminar póliza', description: primaryDetail }
  }

  if (command.type === 'poliza_pause.create') {
    return { title: 'Pausar pólizas', description: readText(data?.fecha_inicio) ?? primaryDetail }
  }

  if (command.type === 'poliza_pause.resume') {
    return { title: 'Reanudar pólizas', description: readText(payload?.fecha_reanudacion) ?? primaryDetail }
  }

  if (command.type === 'mantenimiento.create') {
    return { title: 'Crear mantenimiento de póliza', description: primaryDetail }
  }

  if (command.type === 'mantenimiento.update') {
    return { title: 'Actualizar mantenimiento de póliza', description: primaryDetail }
  }

  if (command.type === 'mantenimiento.replace_refacciones') {
    return {
      title: 'Guardar refacciones del mantenimiento',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'inventario.create') {
    return { title: 'Crear refacción', description: primaryDetail }
  }

  if (command.type === 'inventario.update') {
    return { title: 'Actualizar refacción', description: primaryDetail }
  }

  if (command.type === 'inventario.set_active') {
    return {
      title: payload?.activo === false ? 'Desactivar refacción' : 'Activar refacción',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'inventario.adjust') {
    return {
      title: 'Ajustar inventario',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'inventario_tecnico.upsert') {
    return {
      title: 'Actualizar inventario del técnico',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'inventario_tecnico.delete') {
    return {
      title: 'Devolver refacción al inventario general',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'taller.registrar_entrada') {
    return {
      title: 'Registrar entrada a taller',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'taller.registrar_salida') {
    return {
      title: 'Registrar salida de taller',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  if (command.type === 'taller.reubicacion') {
    return {
      title: 'Reubicar máquina',
      description: [primaryDetail, secondaryDetail].filter(Boolean).join(' · ') || null,
    }
  }

  return {
    title: 'Cambio pendiente',
    description: primaryDetail,
  }
}
