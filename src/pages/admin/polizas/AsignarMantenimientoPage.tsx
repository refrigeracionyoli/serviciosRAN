import { useMemo, useState } from 'react'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MantenimientoForm } from '@/components/forms/MantenimientoForm'
import { RefaccionesForm } from '@/components/forms/RefaccionesForm'
import { useToast } from '@/hooks/use-toast'
import { usePolizasQuery } from '@/hooks/use-polizas'
import {
  useCrearMantenimientoMutation,
  useGuardarMantenimientoRefaccionesMutation,
} from '@/hooks/use-mantenimientos'
import { formatDate, formatMXN } from '@/lib/utils'
import type { CrearMantenimientoInput } from '@/schemas/mantenimiento.schema'
import { refaccionSchema, type RefaccionInput } from '@/schemas/inventario.schema'

export function AsignarMantenimientoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()

  const polizaParam = Number(searchParams.get('poliza'))
  const initialPolizaId = Number.isFinite(polizaParam) && polizaParam > 0 ? polizaParam : null

  const [refaccionesDraft, setRefaccionesDraft] = useState<RefaccionInput[]>([])
  const { data: polizas = [] } = usePolizasQuery()
  const { mutateAsync: crearMantenimiento, isPending: isCreating } = useCrearMantenimientoMutation()
  const { mutateAsync: guardarRefacciones, isPending: isSavingRefacciones } = useGuardarMantenimientoRefaccionesMutation()

  const selectedPoliza = useMemo(
    () => polizas.find((poliza) => poliza.id === initialPolizaId),
    [initialPolizaId, polizas],
  )

  const totalRefacciones = useMemo(
    () =>
      refaccionesDraft.reduce(
        (sum, item) => {
          const cantidad = Number(item.cantidad)
          const precioUnitario = Number(item.precio_unitario)
          return sum
            + (Number.isFinite(cantidad) ? cantidad : 0)
              * (Number.isFinite(precioUnitario) ? precioUnitario : 0)
        },
        0,
      ),
    [refaccionesDraft],
  )

  const handleSubmit = async (formData: CrearMantenimientoInput) => {
    const refaccionesConCaptura = refaccionesDraft
      .map((item) => ({ ...item, nombre_refaccion: item.nombre_refaccion.trim() }))
      .filter((item) => item.nombre_refaccion.length > 0)

    const totalRefaccionesCapturadas = refaccionesConCaptura.reduce((sum, item) => {
      const cantidad = Number(item.cantidad)
      const precioUnitario = Number(item.precio_unitario)
      return sum
        + (Number.isFinite(cantidad) ? cantidad : 0)
          * (Number.isFinite(precioUnitario) ? precioUnitario : 0)
    }, 0)

    const refaccionInvalida = refaccionesConCaptura.find(
      (item) => !refaccionSchema.safeParse(item).success,
    )
    const hasInvalidInventorySelection = refaccionesConCaptura.some(
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
      const fechaVisitaAsignada =
        formData.fecha_visita
        ?? (formData.status === 'realizado' ? new Date().toISOString().split('T')[0] : null)

      const mantenimientoCreado = await crearMantenimiento({
        ...formData,
        fecha_visita: fechaVisitaAsignada,
        costo_refacciones: totalRefaccionesCapturadas,
      })

      if (refaccionesConCaptura.length > 0) {
        await guardarRefacciones({
          mantenimientoId: mantenimientoCreado.id,
          items: refaccionesConCaptura,
        })
      }

      toast({
        title: 'Mantenimiento asignado',
        description:
          refaccionesConCaptura.length > 0
            ? `Se guardo con ${refaccionesConCaptura.length} refacciones por ${formatMXN(totalRefaccionesCapturadas)}.`
            : 'Se guardo sin refacciones.',
      })

      navigate('/polizas/mantenimientos', { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo asignar el mantenimiento.'
      toast({
        title: 'Error al asignar',
        description: message,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="p-5 lg:p-7">
      <AdminBreadcrumbs items={['Pólizas', 'Mantenimientos', 'Asignar mantenimiento']} />

      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate('/polizas')}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Asignar mantenimiento</h1>
            <p className="mt-1 text-lg text-ran-slate">Registra estatus, mano de obra y refacciones para la visita.</p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => navigate('/polizas/mantenimientos')}
        >
          <ClipboardList className="h-4 w-4" />
          Ver historial
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
              isLoading={isCreating || isSavingRefacciones}
              initialPolizaId={initialPolizaId}
              requireTecnico
              hideCostoRefaccionesField
              submitLabel="Guardar asignacion"
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl text-ran-navy">Refacciones</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-ran-slate">
                Captura piezas usadas por item. El sistema calcula el total automaticamente.
              </p>
              <RefaccionesForm
                onSubmit={() => undefined}
                onChange={setRefaccionesDraft}
                showSubmitButton={false}
                requireCatalogSelection
              />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl text-ran-navy">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-ran-slate">
              <p>
                <span className="font-semibold text-ran-navy">Sucursal:</span>{' '}
                {selectedPoliza?.cliente?.nombre ?? 'Selecciona una poliza en el formulario'}
              </p>
              <p>
                <span className="font-semibold text-ran-navy">Maquina:</span>{' '}
                {selectedPoliza?.maquina?.serie
                  ? `${selectedPoliza.maquina.serie} - ${selectedPoliza.maquina.modelo}`
                  : 'Se definira al seleccionar poliza'}
              </p>
              <p>
                <span className="font-semibold text-ran-navy">Inicio de poliza:</span>{' '}
                {selectedPoliza ? formatDate(selectedPoliza.fecha_inicio) : '—'}
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
