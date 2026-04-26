import type { InventarioTecnico } from '@/types/domain.types'

function getErrorText(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase()
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '').toLowerCase()
  }
  return ''
}

export function getInventarioTecnicoAssignedTotal(row: Pick<InventarioTecnico, 'cantidad' | 'cantidad_asignada_total'>): number {
  return Math.max(
    Number(row.cantidad_asignada_total ?? 0),
    Number(row.cantidad ?? 0),
    0,
  )
}

export function isInventarioTecnicoReturned(row: Pick<InventarioTecnico, 'devuelto_at'>): boolean {
  return Boolean(row.devuelto_at)
}

export function isInventarioTecnicoActive(row: Pick<InventarioTecnico, 'cantidad' | 'devuelto_at'>): boolean {
  return !isInventarioTecnicoReturned(row) && Number(row.cantidad ?? 0) > 0
}

export function normalizeInventarioTecnicoRow<T extends Partial<InventarioTecnico>>(row: T): T & Pick<InventarioTecnico, 'cantidad_asignada_total' | 'devuelto_at' | 'devuelto_automaticamente'> {
  const cantidad = Number(row.cantidad ?? 0)
  const cantidadAsignadaTotal = getInventarioTecnicoAssignedTotal({
    cantidad,
    cantidad_asignada_total: Number(row.cantidad_asignada_total ?? 0),
  })

  return {
    ...row,
    cantidad,
    cantidad_asignada_total: cantidadAsignadaTotal,
    devuelto_at: row.devuelto_at ?? null,
    devuelto_automaticamente: Boolean(row.devuelto_automaticamente),
  }
}

export function isMissingInventarioTecnicoHistorySchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  if (code === '42703') {
    return true
  }

  const message = getErrorText(error)
  return (
    message.includes('inventario_tecnico.devuelto_at')
    || message.includes('inventario_tecnico.cantidad_asignada_total')
    || message.includes('inventario_tecnico.devuelto_automaticamente')
    || message.includes('column devuelto_at does not exist')
    || message.includes('column cantidad_asignada_total does not exist')
    || message.includes('column devuelto_automaticamente does not exist')
  )
}
