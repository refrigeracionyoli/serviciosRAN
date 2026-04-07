import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageLoading } from '@/components/shared/LoadingSpinner'
import { MantenimientoForm } from '@/components/forms/MantenimientoForm'
import { RefaccionesForm } from '@/components/forms/RefaccionesForm'
import { useToast } from '@/hooks/use-toast'
import { useMantenimientoDetalleQuery, useEditarMantenimientoMutation } from '@/hooks/use-mantenimientos'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMXN } from '@/lib/utils'
import type { CrearMantenimientoInput } from '@/schemas/mantenimiento.schema'
import { refaccionSchema, type RefaccionInput } from '@/schemas/inventario.schema'
import type { ServicioRefaccion } from '@/types/domain.types'

function normalizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'No se pudo actualizar el mantenimiento.'

  if (/mantenimientos_poliza_status_check|check constraint|en_ruta/i.test(message)) {
    return 'Tu base de datos no acepta el status en ruta. Aplica la migracion 005_mantenimiento_status_en_ruta.sql en Supabase y vuelve a intentar.'
  }

  return message
}

function serializeRefaccion(item: RefaccionInput): string {
  return [
    item.inventario_id ?? 'null',
    item.nombre_refaccion.trim(),
    Number(item.cantidad),
    Number(item.precio_unitario),
  ].join('|')
}

function areRefaccionesEqual(current: RefaccionInput[], previous: RefaccionInput[]): boolean {
  if (current.length !== previous.length) return false

  const left = current.map(serializeRefaccion).sort()
  const right = previous.map(serializeRefaccion).sort()

  return left.every((value, index) => value === right[index])
}

export function MantenimientoDetallePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { id } = useParams<{ id: string }>()

  const mantenimientoId = Number(id)
  const [refaccionesDraft, setRefaccionesDraft] = useState<RefaccionInput[]>([])

  const {
    data: mantenimiento,
    isLoading,
  } = useMantenimientoDetalleQuery(mantenimientoId)

  const {
    data: refacciones = [],
    isLoading: loadingRefacciones,
  } = useQuery({
    queryKey: ['mantenimiento-refacciones', mantenimientoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicio_refacciones')
        .select('*')
        .eq('mantenimiento_id', mantenimientoId)
        .order('id')

      if (error) throw error
      return data as ServicioRefaccion[]
    },
    enabled: mantenimientoId > 0,
  })

  const { mutateAsync: editarMantenimiento, isPending: isUpdating } = useEditarMantenimientoMutation()

  const { mutateAsync: guardarRefacciones, isPending: isSavingRefacciones } = useMutation({
    mutationFn: async (items: RefaccionInput[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deleteError } = await (supabase.from('servicio_refacciones') as any)
        .delete()
        .eq('mantenimiento_id', mantenimientoId)

      if (deleteError) throw deleteError

      if (items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertError } = await (supabase.from('servicio_refacciones') as any)
          .insert(
            items.map((item) => ({
              servicio_id: null,
              mantenimiento_id: mantenimientoId,
              inventario_id: item.inventario_id ?? null,
              nombre_refaccion: item.nombre_refaccion,
              cantidad: item.cantidad,
              precio_unitario: item.precio_unitario,
            })),
          )

        if (insertError) throw insertError
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mantenimiento-refacciones', mantenimientoId] })
    },
  })

  const defaultRefacciones = useMemo<RefaccionInput[]>(
    () =>
      refacciones.map((item) => ({
        inventario_id: item.inventario_id,
        nombre_refaccion: item.nombre_refaccion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
      })),
    [refacciones],
  )

  useEffect(() => {
    setRefaccionesDraft(defaultRefacciones)
  }, [defaultRefacciones])

  const totalRefacciones = useMemo(
    () =>
      refaccionesDraft.reduce((sum, item) => {
        const cantidad = Number(item.cantidad)
        const precioUnitario = Number(item.precio_unitario)
        return sum + (Number.isFinite(cantidad) ? cantidad : 0) * (Number.isFinite(precioUnitario) ? precioUnitario : 0)
      }, 0),
    [refaccionesDraft],
  )

  const handleSubmit = async (formData: CrearMantenimientoInput) => {
    const refaccionesCapturadas = refaccionesDraft
      .map((item) => ({ ...item, nombre_refaccion: item.nombre_refaccion.trim() }))
      .filter((item) => item.nombre_refaccion.length > 0)

    const refaccionInvalida = refaccionesCapturadas.find((item) => !refaccionSchema.safeParse(item).success)
    if (refaccionInvalida) {
      toast({
        title: 'Refaccion invalida',
        description: 'Revisa nombre, cantidad y precio unitario en las refacciones capturadas.',
        variant: 'destructive',
      })
      return
    }

    try {
      const refaccionesChanged = !areRefaccionesEqual(refaccionesCapturadas, defaultRefacciones)
      if (refaccionesChanged) {
        await guardarRefacciones(refaccionesCapturadas)
      }

      const fechaVisitaAjustada =
        formData.fecha_visita
        ?? (formData.status === 'realizado' ? new Date().toISOString().split('T')[0] : null)

      await editarMantenimiento({
        id: mantenimientoId,
        data: {
          ...formData,
          fecha_visita: fechaVisitaAjustada,
          costo_refacciones: totalRefacciones,
        },
      })

      toast({
        title: 'Mantenimiento actualizado',
        description: 'Se guardaron los datos y las refacciones del mantenimiento.',
      })
    } catch (error) {
      toast({
        title: 'Error al guardar mantenimiento',
        description: normalizeErrorMessage(error),
        variant: 'destructive',
      })
    }
  }

  if (isLoading) return <PageLoading />

  if (!mantenimiento) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          No se encontró el mantenimiento solicitado.
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate('/polizas/mantenimientos')}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Detalle de mantenimiento</h1>
            <p className="mt-1 text-lg text-ran-slate">
              {mantenimiento.cliente?.nombre ?? 'Sin sucursal'} · {mantenimiento.tipo_servicio}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => navigate('/polizas/mantenimientos')}
        >
          <Wrench className="h-4 w-4" />
          Volver a mantenimientos
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Datos del mantenimiento</CardTitle>
          </CardHeader>
          <CardContent>
            <MantenimientoForm
              onSubmit={handleSubmit}
              isLoading={isUpdating || isSavingRefacciones}
              mantenimiento={mantenimiento}
              requireTecnico
              hideCostoRefaccionesField
              submitLabel="Guardar cambios"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl text-ran-navy">Refacciones</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingRefacciones ? (
                <PageLoading />
              ) : (
                <RefaccionesForm
                  defaultValues={defaultRefacciones}
                  onSubmit={() => undefined}
                  onChange={setRefaccionesDraft}
                  showSubmitButton={false}
                />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl text-ran-navy">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-ran-slate">
              <p>
                <span className="font-semibold text-ran-navy">Sucursal:</span>{' '}
                {mantenimiento.cliente?.nombre ?? '—'}
              </p>
              <p>
                <span className="font-semibold text-ran-navy">Maquina:</span>{' '}
                {mantenimiento.maquina?.serie
                  ? `${mantenimiento.maquina.serie} - ${mantenimiento.maquina.modelo}`
                  : '—'}
              </p>
              <p>
                <span className="font-semibold text-ran-navy">Técnico:</span>{' '}
                {mantenimiento.tecnico?.nombre ?? 'Sin técnico'}
              </p>
              <p>
                <span className="font-semibold text-ran-navy">Visita:</span>{' '}
                {formatDate(mantenimiento.fecha_visita)}
              </p>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-blue-800">Total refacciones capturadas</p>
                <p className="text-lg font-bold text-blue-900">{formatMXN(totalRefacciones)}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
