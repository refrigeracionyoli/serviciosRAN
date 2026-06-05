import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cierresKeys } from '@/hooks/use-cierres'
import { evidenciasKeys } from '@/hooks/use-evidencias'
import { inventarioKeys } from '@/hooks/use-inventario'
import { mantenimientosKeys } from '@/hooks/use-mantenimientos'
import { maquinasTallerKeys } from '@/hooks/use-maquinas-taller'
import { polizasKeys } from '@/hooks/use-polizas'
import { serviciosKeys } from '@/hooks/use-servicios'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, () => void>()
  const channel = {
    on: vi.fn((_event: string, filter: { table: string }, callback: () => void) => {
      handlers.set(filter.table, callback)
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  return {
    handlers,
    channel,
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  }
})

vi.mock('@/lib/supabase', () => ({ supabase: mocks.supabase }))
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

describe('useRealtimeInvalidations', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.handlers.clear()
    mocks.channel.on.mockClear()
    mocks.channel.subscribe.mockClear()
    mocks.supabase.channel.mockClear()
    mocks.supabase.removeChannel.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes to every realtime table and removes the channel on unmount', async () => {
    const { useRealtimeInvalidations } = await import('@/hooks/use-realtime-invalidations')
    const queryClient = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { unmount } = renderHook(() => useRealtimeInvalidations(), { wrapper })

    await waitFor(() => expect(mocks.supabase.channel).toHaveBeenCalledWith('realtime-invalidations:user-1'))
    expect(mocks.channel.subscribe).toHaveBeenCalled()
    expect(Array.from(mocks.handlers.keys()).sort()).toEqual([
      'cierres',
      'clientes',
      'evidencias',
      'inventario',
      'inventario_tecnico',
      'mantenimientos_poliza',
      'maquinas',
      'maquinas_en_taller',
      'maquinas_taller_movimientos',
      'movimientos_inventario',
      'poliza_estado_historial',
      'poliza_pausas',
      'polizas',
      'profiles',
      'servicio_refacciones',
      'servicios',
    ].sort())

    unmount()
    expect(mocks.supabase.removeChannel).toHaveBeenCalledWith(mocks.channel)
  })

  it('invalidates service, evidence, inventory, and related catalog queries by table event', async () => {
    const { useRealtimeInvalidations } = await import('@/hooks/use-realtime-invalidations')
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useRealtimeInvalidations(), { wrapper })
    await waitFor(() => expect(mocks.handlers.has('servicios')).toBe(true))
    vi.useFakeTimers()

    mocks.handlers.get('servicios')?.()
    expect(invalidateSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: serviciosKeys.all, refetchType: 'active' })

    mocks.handlers.get('evidencias')?.()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: evidenciasKeys.all, refetchType: 'active' })

    mocks.handlers.get('inventario')?.()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: inventarioKeys.all, refetchType: 'active' })
    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: inventarioKeys.tecnicoRoot, type: 'active' })

    mocks.handlers.get('servicio_refacciones')?.()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['servicio-refacciones'], refetchType: 'active' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['mantenimiento-refacciones'], refetchType: 'active' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: mantenimientosKeys.all, refetchType: 'active' })

    mocks.handlers.get('maquinas_en_taller')?.()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: maquinasTallerKeys.all, refetchType: 'active' })

    mocks.handlers.get('poliza_pausas')?.()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: polizasKeys.all, refetchType: 'active' })

    mocks.handlers.get('cierres')?.()
    vi.advanceTimersByTime(5000)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: cierresKeys.all, refetchType: 'active' })
  })

  it('coalesces repeated realtime events into one active refetch per query key', async () => {
    const { useRealtimeInvalidations } = await import('@/hooks/use-realtime-invalidations')
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    renderHook(() => useRealtimeInvalidations(), { wrapper })
    await waitFor(() => expect(mocks.handlers.has('servicios')).toBe(true))
    vi.useFakeTimers()

    mocks.handlers.get('servicios')?.()
    vi.advanceTimersByTime(2500)
    mocks.handlers.get('servicios')?.()
    vi.advanceTimersByTime(4999)
    expect(invalidateSpy).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: serviciosKeys.all, refetchType: 'active' })
  })
})
