function normalizeOrderReference(rawOrder: string | number | null | undefined): string {
  const value = typeof rawOrder === 'number' ? String(rawOrder) : (rawOrder ?? '').trim()
  if (!value) return ''

  return value.replace(/\s+/g, '-')
}

export function buildServicioOrderReference(
  order: string | number | null | undefined,
  servicioId: number | null | undefined,
): string {
  const normalizedOrder = normalizeOrderReference(order)
  if (normalizedOrder) return normalizedOrder

  const hasServicioId = typeof servicioId === 'number' && Number.isFinite(servicioId) && servicioId > 0
  return hasServicioId ? `servicio${servicioId}` : 'servicio'
}

export function buildFriendlyOrdenFilename(orderReference: string): string {
  return `${orderReference}_orden`
}

export function buildFriendlyEvidenciaFilename(orderReference: string, index: number): string {
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1
  return `${orderReference}_evidencia${safeIndex}`
}
