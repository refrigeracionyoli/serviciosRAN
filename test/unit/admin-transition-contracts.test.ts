import { describe, expect, it } from 'vitest'
import { shouldValidateEvidenciasBeforeClose } from '@/hooks/use-cierres'
import { canChangeEvidenciasForServicioStatus } from '@/hooks/use-evidencias'
import { buildCierre } from '../fixtures/domain'

describe('admin transition contracts', () => {
  it('requires evidence before closing by default and allows the explicit admin bypass', () => {
    expect(shouldValidateEvidenciasBeforeClose(null)).toBe(true)
    expect(shouldValidateEvidenciasBeforeClose(null, { requireEvidenceBeforeClose: true })).toBe(true)
    expect(shouldValidateEvidenciasBeforeClose(null, { requireEvidenceBeforeClose: false })).toBe(false)
    expect(shouldValidateEvidenciasBeforeClose(buildCierre())).toBe(false)
  })

  it('keeps closed service evidence changes blocked unless the admin flow explicitly allows them', () => {
    expect(canChangeEvidenciasForServicioStatus('completado')).toBe(true)
    expect(canChangeEvidenciasForServicioStatus('cerrado')).toBe(false)
    expect(canChangeEvidenciasForServicioStatus('cerrado', { allowClosedServiceChanges: true })).toBe(true)
  })
})
