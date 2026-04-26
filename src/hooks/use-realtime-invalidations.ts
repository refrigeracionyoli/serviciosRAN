import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { cierresKeys } from '@/hooks/use-cierres'
import { clientesKeys } from '@/hooks/use-clientes'
import { evidenciasKeys } from '@/hooks/use-evidencias'
import { inventarioKeys } from '@/hooks/use-inventario'
import { mantenimientosKeys } from '@/hooks/use-mantenimientos'
import { maquinasKeys } from '@/hooks/use-maquinas'
import { maquinasTallerKeys } from '@/hooks/use-maquinas-taller'
import { polizasKeys } from '@/hooks/use-polizas'
import { useAuth } from '@/hooks/use-auth'
import { serviciosKeys } from '@/hooks/use-servicios'
import { tecnicosKeys } from '@/hooks/use-tecnicos'
import { supabase } from '@/lib/supabase'

export function useRealtimeInvalidations() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  useEffect(() => {
    if (!user?.id) return undefined

    const invalidateActive = (queryKey: QueryKey) => {
      void queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
    }

    const invalidateInventario = () => {
      invalidateActive(inventarioKeys.all)
      void queryClient.refetchQueries({ queryKey: inventarioKeys.tecnicoRoot, type: 'active' })
    }

    const invalidateServicios = () => {
      invalidateActive(serviciosKeys.all)
    }

    const invalidateCatalogos = () => {
      invalidateActive(clientesKeys.all)
      invalidateActive(maquinasKeys.all)
      invalidateActive(tecnicosKeys.all)
      invalidateServicios()
      invalidateActive(polizasKeys.all)
      invalidateActive(mantenimientosKeys.all)
    }

    const invalidateTaller = () => {
      invalidateActive(maquinasTallerKeys.all)
      invalidateActive(maquinasKeys.all)
      invalidateServicios()
    }

    const channel = supabase
      .channel(`realtime-invalidations:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios' }, () => {
        invalidateServicios()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'evidencias' }, () => {
        invalidateActive(evidenciasKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => {
        invalidateCatalogos()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maquinas' }, () => {
        invalidateActive(maquinasKeys.all)
        invalidateServicios()
        invalidateActive(polizasKeys.all)
        invalidateActive(mantenimientosKeys.all)
        invalidateActive(maquinasTallerKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        invalidateActive(tecnicosKeys.all)
        invalidateServicios()
        invalidateActive(mantenimientosKeys.all)
        invalidateActive(cierresKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario' }, () => {
        invalidateInventario()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventario_tecnico' }, () => {
        invalidateInventario()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'movimientos_inventario' }, () => {
        invalidateInventario()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicio_refacciones' }, () => {
        invalidateInventario()
        invalidateActive(['servicio-refacciones'])
        invalidateActive(['mantenimiento-refacciones'])
        invalidateServicios()
        invalidateActive(mantenimientosKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'polizas' }, () => {
        invalidateActive(polizasKeys.all)
        invalidateActive(mantenimientosKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poliza_estado_historial' }, () => {
        invalidateActive(polizasKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'poliza_pausas' }, () => {
        invalidateActive(polizasKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mantenimientos_poliza' }, () => {
        invalidateActive(mantenimientosKeys.all)
        invalidateActive(polizasKeys.all)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cierres' }, () => {
        invalidateActive(cierresKeys.all)
        invalidateServicios()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maquinas_en_taller' }, () => {
        invalidateTaller()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'maquinas_taller_movimientos' }, () => {
        invalidateTaller()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient, user?.id])
}
