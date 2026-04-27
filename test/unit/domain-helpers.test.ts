import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFriendlyEvidenciaFilename, buildFriendlyOrdenFilename, buildServicioOrderReference } from '@/lib/evidencias-filename'
import {
  getInventarioTecnicoAssignedTotal,
  isInventarioTecnicoActive,
  isInventarioTecnicoReturned,
  isMissingInventarioTecnicoHistorySchemaError,
  normalizeInventarioTecnicoRow,
} from '@/lib/inventario-tecnico'
import { assertPasswordPolicy, getPasswordPolicyError, validatePasswordPolicy } from '@/lib/password-policy'
import {
  buildServicioCompletionRequirementMessage,
  REQUIRED_SERVICE_PHOTOS,
  summarizeServicioEvidencias,
} from '@/lib/tecnico/servicio-evidencias'
import { cn, formatDate, formatDateTime, formatLocalIsoDate, formatMXN, formatWeek, getWeekRange } from '@/lib/utils'
import { buildEvidencia } from '../fixtures/domain'

describe('domain helper functions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-26T12:00:00-06:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats money, dates, local ISO dates, week codes, and merged classes consistently', () => {
    expect(formatMXN(1234.5)).toContain('$1,234.50')
    expect(formatDate('2026-04-26')).toMatch(/2026/)
    expect(formatDate(null)).toBe('—')
    expect(formatDateTime('2026-04-26T18:30:00.000Z')).toMatch(/2026/)
    expect(formatLocalIsoDate(new Date('2026-04-05T10:00:00'))).toBe('2026-04-05')
    expect(formatWeek(new Date('2026-01-20T10:00:00'))).toBe('S0426')
    expect(getWeekRange(new Date('2026-04-26T10:00:00'))).toEqual({
      inicio: '2026-04-20',
      fin: '2026-04-25',
    })
    expect(cn('px-2', 'px-4', false && 'hidden')).toBe('px-4')
  })

  it('builds user-facing evidencia filenames from SAP order or service fallback references', () => {
    expect(buildServicioOrderReference(9001, 30)).toBe('9001')
    expect(buildServicioOrderReference('SAP 9001', 30)).toBe('SAP-9001')
    expect(buildServicioOrderReference(null, 30)).toBe('servicio30')
    expect(buildServicioOrderReference(null, null)).toBe('servicio')
    expect(buildFriendlyOrdenFilename('9001')).toBe('9001_orden')
    expect(buildFriendlyEvidenciaFilename('9001', 3)).toBe('9001_evidencia3')
    expect(buildFriendlyEvidenciaFilename('9001', -1)).toBe('9001_evidencia1')
  })

  it('summarizes required service evidence and explains missing closure requirements', () => {
    const photos = Array.from({ length: REQUIRED_SERVICE_PHOTOS }, (_, index) => buildEvidencia({
      id: index + 1,
      filename: `foto-${index + 1}.jpg`,
      created_at: `2026-04-20T12:0${index}:00.000Z`,
    }))
    const order = buildEvidencia({
      id: 99,
      filename: 'orden-servicio__1710000000000__firmada.jpg',
      created_at: '2026-04-20T13:00:00.000Z',
    })

    const complete = summarizeServicioEvidencias([...photos, order])
    expect(complete.cantidadFotos).toBe(4)
    expect(complete.tieneOrdenServicio).toBe(true)
    expect(complete.puedeCompletar).toBe(true)
    expect(buildServicioCompletionRequirementMessage(complete)).toContain('Ya tienes')

    const incomplete = summarizeServicioEvidencias(photos.slice(0, 2))
    expect(incomplete.faltanFotos).toBe(2)
    expect(incomplete.tieneOrdenServicio).toBe(false)
    expect(incomplete.puedeCompletar).toBe(false)
    expect(buildServicioCompletionRequirementMessage(incomplete)).toContain('Faltan 2 fotos de evidencia y la orden de servicio')
  })

  it('normalizes technician inventory history fields and detects missing-schema failures', () => {
    expect(getInventarioTecnicoAssignedTotal({ cantidad: 2, cantidad_asignada_total: 5 })).toBe(5)
    expect(getInventarioTecnicoAssignedTotal({ cantidad: 7, cantidad_asignada_total: 0 })).toBe(7)
    expect(isInventarioTecnicoReturned({ devuelto_at: '2026-04-27T00:00:00.000Z' })).toBe(true)
    expect(isInventarioTecnicoActive({ cantidad: 1, devuelto_at: null })).toBe(true)
    expect(isInventarioTecnicoActive({ cantidad: 0, devuelto_at: null })).toBe(false)

    expect(normalizeInventarioTecnicoRow({ cantidad: 3 })).toMatchObject({
      cantidad: 3,
      cantidad_asignada_total: 3,
      devuelto_at: null,
      devuelto_automaticamente: false,
    })

    expect(isMissingInventarioTecnicoHistorySchemaError({ code: '42703' })).toBe(true)
    expect(isMissingInventarioTecnicoHistorySchemaError(new Error('column devuelto_at does not exist'))).toBe(true)
    expect(isMissingInventarioTecnicoHistorySchemaError(new Error('other failure'))).toBe(false)
  })

  it('scores and rejects insecure employee passwords consistently', () => {
    expect(validatePasswordPolicy('Robusta1!')).toMatchObject({ valid: true, complexityScore: 4 })
    expect(getPasswordPolicyError('password123')).toContain('3 de 4')
    expect(getPasswordPolicyError('Password123!')).toContain('patrones inseguros')
    expect(() => assertPasswordPolicy('Robusta1!')).not.toThrow()
    expect(() => assertPasswordPolicy('admin123')).toThrow(/contraseña/i)
  })
})
