import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useServicioDetalleQuery } from '@/hooks/use-servicios'
import { RefaccionesForm } from '@/components/forms/RefaccionesForm'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { serviciosKeys } from '@/hooks/use-servicios'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import { PageLoading } from '@/components/shared/LoadingSpinner'

export function TecnicoRefaccionesPage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: servicio, isLoading } = useServicioDetalleQuery(servicioId)

  const { mutate: guardar, isPending } = useMutation({
    mutationFn: async (refacciones: RefaccionInput[]) => {
      // Insertar refacciones
      const { error: refError } = await supabase.from('servicio_refacciones').insert(
        refacciones.map((r) => ({
          servicio_id: servicioId,
          inventario_id: r.inventario_id ?? null,
          nombre_refaccion: r.nombre_refaccion,
          cantidad: r.cantidad,
          precio_unitario: r.precio_unitario,
        })),
      )
      if (refError) throw refError

      // Actualizar costo_refacciones en el servicio
      const totalRef = refacciones.reduce((sum, r) => sum + r.cantidad * r.precio_unitario, 0)
      const { error: svcError } = await supabase
        .from('servicios')
        .update({
          costo_refacciones: (servicio?.costo_refacciones ?? 0) + totalRef,
          status: 'completado',
        })
        .eq('id', servicioId)
      if (svcError) throw svcError
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serviciosKeys.detail(servicioId) })
      navigate(-1)
    },
  })

  if (isLoading) return <PageLoading />

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5 text-ran-slate" />
        </button>
        <div>
          <h2 className="font-bold text-ran-navy">Refacciones usadas</h2>
          <p className="text-xs text-ran-slate">{servicio?.cliente?.nombre ?? `Servicio #${servicioId}`}</p>
        </div>
      </div>

      <RefaccionesForm
        onSubmit={guardar}
        isLoading={isPending}
      />
    </div>
  )
}
