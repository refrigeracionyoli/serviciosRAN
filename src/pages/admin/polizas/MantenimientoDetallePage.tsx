import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Wrench } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminPageLoadingSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons'
import { MantenimientoForm } from '@/components/forms/MantenimientoForm'
import { RefaccionesForm } from '@/components/forms/RefaccionesForm'
import { useToast } from '@/hooks/use-toast'
import {
  useEditarMantenimientoMutation,
  useGuardarMantenimientoRefaccionesMutation,
  useMantenimientoDetalleQuery,
  useMantenimientoRefaccionesQuery,
} from '@/hooks/use-mantenimientos'
import { formatDate, formatMXN } from '@/lib/utils'
import type { CrearMantenimientoInput } from '@/schemas/mantenimiento.schema'
import { refaccionSchema, type RefaccionInput } from '@/schemas/inventario.schema'

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

const EMPTY_REFACCIONES: RefaccionInput[] = []

export function MantenimientoDetallePage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { id } = useParams<{ id: string }>()

  const mantenimientoId = Number(id)
  const [refaccionesDraft, setRefaccionesDraft] = useState<RefaccionInput[]>([])
  const lastLoadedRefaccionesRef = useRef<RefaccionInput[] | null>(null)

  const {
    data: mantenimiento,
    isLoading,
  } = useMantenimientoDetalleQuery(mantenimientoId)

  const {
    data: refaccionesData,
    isLoading: loadingRefacciones,
  } = useMantenimientoRefaccionesQuery(mantenimientoId)
  const refacciones = refaccionesData ?? EMPTY_REFACCIONES

  const { mutateAsync: editarMantenimiento, isPending: isUpdating } = useEditarMantenimientoMutation()
  const { mutateAsync: guardarRefacciones, isPending: isSavingRefacciones } = useGuardarMantenimientoRefaccionesMutation()

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
    const previousLoaded = lastLoadedRefaccionesRef.current
    const hasRemoteChanges = !previousLoaded || !areRefaccionesEqual(previousLoaded, defaultRefacciones)

    if (!hasRemoteChanges) return

    setRefaccionesDraft((current) => {
      if (previousLoaded && !areRefaccionesEqual(current, previousLoaded)) {
        return current
      }

      return defaultRefacciones
    })
    lastLoadedRefaccionesRef.current = defaultRefacciones
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
    const hasInvalidInventorySelection = refaccionesCapturadas.some(
      (item) => typeof item.inventario_id !== 'number' || item.inventario_id <= 0,
    )
    if (refaccionInvalida) {
      toast({
        title: 'Refaccion invalida',
        description: 'Revisa nombre, cantidad y precio unitario en las refacciones capturadas.',
        variant: 'destructive',
      })
      return
    }

    if (hasInvalidInventorySelection) {
      toast({
        title: 'Refacciones incompletas',
        description: 'Cada refacción debe seleccionarse desde el inventario antes de guardar.',
        variant: 'destructive',
      })
      return
    }

    try {
      const refaccionesChanged = !areRefaccionesEqual(refaccionesCapturadas, defaultRefacciones)
      if (refaccionesChanged) {
        await guardarRefacciones({
          mantenimientoId,
          items: refaccionesCapturadas,
        })
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

  if (isLoading) return <AdminPageLoadingSkeleton />

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
      <AdminBreadcrumbs
        items={['Pólizas', 'Mantenimientos', mantenimiento.cliente?.nombre ?? 'Mantenimiento']}
      />

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
                <AdminTableSkeleton rows={4} columns={4} />
              ) : (
                <RefaccionesForm
                  defaultValues={defaultRefacciones}
                  onSubmit={() => undefined}
                  onChange={setRefaccionesDraft}
                  showSubmitButton={false}
                  requireCatalogSelection
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
