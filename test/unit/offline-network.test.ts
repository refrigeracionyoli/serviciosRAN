import { describe, expect, it, vi } from 'vitest'
import {
  getErrorMessage,
  isBrowserOnline,
  isLikelyAuthError,
  isLikelyNetworkError,
  isLikelyUniqueViolation,
} from '@/lib/offline/network'

function setNavigatorOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

describe('offline network error classification', () => {
  it('uses navigator state as the first offline signal', () => {
    setNavigatorOnline(false)
    expect(isBrowserOnline()).toBe(false)
    expect(isLikelyNetworkError(new Error('anything'))).toBe(true)
  })

  it('classifies common fetch, auth, and unique-constraint failures', () => {
    setNavigatorOnline(true)

    expect(isLikelyNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(isLikelyNetworkError('Network request failed')).toBe(true)
    expect(isLikelyNetworkError(new Error('valid application error'))).toBe(false)

    expect(isLikelyAuthError(new Error('JWT expired'))).toBe(true)
    expect(isLikelyAuthError(new Error('refresh token not found'))).toBe(true)
    expect(isLikelyAuthError(new Error('Stock insuficiente'))).toBe(false)

    expect(isLikelyUniqueViolation({ code: '23505' })).toBe(true)
    expect(isLikelyUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(true)
    expect(isLikelyUniqueViolation(new Error('row-level security denied'))).toBe(false)
  })

  it('extracts useful error messages with a safe fallback', () => {
    expect(getErrorMessage(new Error('Mensaje real'), 'Fallback')).toBe('Mensaje real')
    expect(getErrorMessage({ error: 'Mensaje en error' }, 'Fallback')).toBe('Mensaje en error')
    expect(getErrorMessage('', 'Fallback')).toBe('Fallback')
    expect(getErrorMessage(null, 'Fallback')).toBe('Fallback')
  })
})
