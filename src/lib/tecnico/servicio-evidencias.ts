import type { Evidencia } from '@/types/domain.types'

export const REQUIRED_SERVICE_PHOTOS = 1

export interface ServicioEvidenceSummary {
  fotos: Evidencia[]
  ordenServicio: Evidencia | null
  cantidadFotos: number
  faltanFotos: number
  tieneOrdenServicio: boolean
  puedeCompletar: boolean
}

export function isOrdenServicioFilename(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

export function summarizeServicioEvidencias(evidencias: Evidencia[]): ServicioEvidenceSummary {
  const ordenServicio = evidencias
    .filter((evidencia) => isOrdenServicioFilename(evidencia.filename))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null

  const fotos = evidencias
    .filter((evidencia) => !isOrdenServicioFilename(evidencia.filename))
    .sort((left, right) => left.created_at.localeCompare(right.created_at))

  const cantidadFotos = fotos.length
  const faltanFotos = Math.max(0, REQUIRED_SERVICE_PHOTOS - cantidadFotos)
  const tieneOrdenServicio = Boolean(ordenServicio)

  return {
    fotos,
    ordenServicio,
    cantidadFotos,
    faltanFotos,
    tieneOrdenServicio,
    puedeCompletar: faltanFotos === 0 && tieneOrdenServicio,
  }
}

export function buildServicioCompletionRequirementMessage(summary: ServicioEvidenceSummary): string {
  if (summary.puedeCompletar) {
    return 'Ya tienes al menos 1 foto y la orden de servicio requeridas para completar este servicio.'
  }

  const missingParts: string[] = []

  if (summary.faltanFotos > 0) {
    missingParts.push(
      `${summary.faltanFotos} foto${summary.faltanFotos === 1 ? '' : 's'} de evidencia`,
    )
  }

  if (!summary.tieneOrdenServicio) {
    missingParts.push('la orden de servicio')
  }

  if (missingParts.length === 1) {
    return `Falta ${missingParts[0]} para completar este servicio.`
  }

  const lastPart = missingParts[missingParts.length - 1] ?? 'la orden de servicio'
  return `Faltan ${missingParts.slice(0, -1).join(', ')} y ${lastPart} para completar este servicio.`
}
