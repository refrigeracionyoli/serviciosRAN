import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { AdminPageLoadingSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons'
import { ServicioForm } from '@/components/forms/ServicioForm'
import { RefaccionesForm } from '@/components/forms/RefaccionesForm'
import { CierreForm } from '@/components/forms/CierreForm'
import {
  useServicioDetalleQuery,
  useEditarServicioMutation,
  useGuardarServicioRefaccionesMutation,
  useServicioRefaccionesQuery,
} from '@/hooks/use-servicios'
import { useCierreQuery, useCerrarServicioMutation } from '@/hooks/use-cierres'
import { useEvidenciasQuery } from '@/hooks/use-evidencias'
import { useInventarioTecnicoQuery } from '@/hooks/use-inventario'
import { useToast } from '@/hooks/use-toast'
import { formatLocalIsoDate } from '@/lib/utils'
import { buildServicioCompletionRequirementMessage, summarizeServicioEvidencias } from '@/lib/tecnico/servicio-evidencias'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { CierreInput } from '@/schemas/cliente.schema'
import type { CrearServicioInput } from '@/schemas/servicio.schema'
import type { Servicio, ServicioRefaccion, ServicioStatus } from '@/types/domain.types'

type EditableServicioStatus = Exclude<ServicioStatus, 'cerrado'>

const STATUS_OPTIONS: Array<{ value: EditableServicioStatus; label: string }> = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_ruta', label: 'En ruta' },
  { value: 'completado', label: 'Completado' },
]

function serializeRefaccion(item: RefaccionInput): string {
  return [
    item.inventario_id ?? 'null',
    item.nombre_refaccion.trim(),
    Number(item.cantidad),
    Number(item.precio_unitario),
    item.inventory_source ?? 'general',
  ].join('|')
}

function areRefaccionesEqual(current: RefaccionInput[], previous: RefaccionInput[]): boolean {
  if (current.length !== previous.length) return false

  const left = current.map(serializeRefaccion).sort()
  const right = previous.map(serializeRefaccion).sort()

  return left.every((value, index) => value === right[index])
}

function calculateRefaccionesTotal(
  items: Array<Pick<RefaccionInput, 'cantidad' | 'precio_unitario'>>,
): number {
  return items.reduce(
    (sum, item) => sum + Number(item.cantidad ?? 0) * Number(item.precio_unitario ?? 0),
    0,
  )
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getSafeFechaCierre(preferredDate: string | null | undefined): string {
  const todayIso = formatLocalIsoDate(new Date())
  return preferredDate && preferredDate <= todayIso ? preferredDate : todayIso
}

function getDefaultFechaCierre(servicio: Servicio): string {
  return getSafeFechaCierre(servicio.fecha_cierre ?? servicio.fecha_servicio ?? servicio.fecha_solicitud)
}

function hasServicioDataChanges(data: CrearServicioInput, servicio: Servicio): boolean {
  return (
    data.tipo_servicio !== servicio.tipo_servicio
    || (data.clase_orden ?? null) !== (servicio.clase_orden ?? null)
    || (data.orden ?? null) !== (servicio.orden ?? null)
    || (data.aviso ?? null) !== (servicio.aviso ?? null)
    || data.cliente_id !== servicio.cliente_id
    || data.maquina_id !== servicio.maquina_id
    || (data.tecnico_id ?? null) !== (servicio.tecnico_id ?? null)
    || (data.descripcion ?? null) !== (servicio.descripcion ?? null)
    || data.fecha_solicitud !== servicio.fecha_solicitud
    || (data.fecha_servicio ?? null) !== (servicio.fecha_servicio ?? null)
    || Number(data.costo_mano_obra ?? 0) !== Number(servicio.costo_mano_obra ?? 0)
  )
}

interface CierreDefaults {
  aviso: number | null
  tecnicoId: string | null
  costoTotal: number | null
  fechaCierre: string
}

const EMPTY_REFACCIONES: ServicioRefaccion[] = []

export function ServicioEditarPage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const { toast } = useToast()
  const [statusEdit, setStatusEdit] = useState<ServicioStatus>('pendiente')
  const [refaccionesDraft, setRefaccionesDraft] = useState<RefaccionInput[]>([])
  const [formDraft, setFormDraft] = useState<Partial<CrearServicioInput> | null>(null)
  const [clearDraftSignal, setClearDraftSignal] = useState(0)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [cierreDraft, setCierreDraft] = useState(false)
  const [cierreDefaults, setCierreDefaults] = useState<CierreDefaults | null>(null)
  const lastLoadedRefaccionesRef = useRef<RefaccionInput[] | null>(null)
  
  // Guardar valores últimamente guardados para comparación
  const [lastSavedStatus, setLastSavedStatus] = useState<ServicioStatus | null>(null)
  const [lastSavedRefacciones, setLastSavedRefacciones] = useState<RefaccionInput[]>([])

  const { data: servicio, isLoading } = useServicioDetalleQuery(servicioId)
  const { data: cierre } = useCierreQuery(servicioId)
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId)
  const {
    mutateAsync: editarServicioAsync,
    isPending,
  } = useEditarServicioMutation(servicioId)
  const { mutateAsync: cerrarServicioAsync, isPending: cerrando } = useCerrarServicioMutation(servicioId)
  const { data: refaccionesData, isLoading: loadingRefacciones } = useServicioRefaccionesQuery(servicioId)
  const { mutateAsync: guardarRefaccionesAsync, isPending: savingRefacciones } = useGuardarServicioRefaccionesMutation(servicioId)
  const { data: inventarioTecnicoServicio = [] } = useInventarioTecnicoQuery(
    servicio?.fecha_servicio ?? undefined,
    servicio?.tecnico_id ?? undefined,
    { enabled: Boolean(servicio?.fecha_servicio && servicio?.tecnico_id) },
  )
  const refacciones = refaccionesData ?? EMPTY_REFACCIONES

  useEffect(() => {
    if (servicio) {
      setStatusEdit(servicio.status)
      setLastSavedStatus(servicio.status)
    }
  }, [servicio])

  const defaultRefacciones = useMemo(
    () =>
      refacciones.map((item) => ({
        inventario_id: item.inventario_id,
        nombre_refaccion: item.nombre_refaccion,
        cantidad: item.cantidad,
        precio_unitario: item.precio_unitario,
        inventory_source: item.inventory_source,
      })),
    [refacciones],
  )
  const tecnicoStockByInventarioId = useMemo(
    () => new Map(inventarioTecnicoServicio.map((row) => [row.inventario_id, Number(row.cantidad ?? 0)] as const)),
    [inventarioTecnicoServicio],
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
    setLastSavedRefacciones(defaultRefacciones)
    lastLoadedRefaccionesRef.current = defaultRefacciones
  }, [defaultRefacciones])

  // Detectar cambios sin guardar
  useEffect(() => {
    // Si hay cambios en el formulario o en el cierre
    if (formDraft || cierreDraft) {
      setHasUnsavedChanges(true)
      return
    }

    // Si hay cambios en el status (comparar contra último guardado, no contra servidor)
    if (statusEdit !== lastSavedStatus) {
      setHasUnsavedChanges(true)
      return
    }

    // Si hay cambios en refacciones (comparar contra último guardado, no contra servidor)
    if (refaccionesDraft.length !== lastSavedRefacciones.length) {
      setHasUnsavedChanges(true)
      return
    }

    if (
      refaccionesDraft.length > 0 &&
      !refaccionesDraft.every(
        (item, idx) =>
          item.nombre_refaccion === lastSavedRefacciones[idx]?.nombre_refaccion &&
          item.cantidad === lastSavedRefacciones[idx].cantidad &&
          item.precio_unitario === lastSavedRefacciones[idx].precio_unitario &&
          item.inventario_id === lastSavedRefacciones[idx].inventario_id &&
          (item.inventory_source ?? 'general') === (lastSavedRefacciones[idx].inventory_source ?? 'general'),
      )
    ) {
      setHasUnsavedChanges(true)
      return
    }

    // Sin cambios
    setHasUnsavedChanges(false)
  }, [statusEdit, refaccionesDraft, lastSavedStatus, lastSavedRefacciones, formDraft, cierreDraft])

  // Advertir si intenta salir con cambios sin guardar
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  // Detectar intentos de navegación (dropdown sidebar, links, etc)
  useEffect(() => {
    if (!hasUnsavedChanges) return

    // Interceptar clics en el documento para detectar intentos de navegación
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a, [role="menuitem"], [role="link"]')
      if (target && !target.hasAttribute('data-allow-navigate')) {
        e.preventDefault()
        e.stopPropagation()
        setShowConfirmDialog(true)
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [hasUnsavedChanges])

  const handleBackClick = () => {
    if (hasUnsavedChanges) {
      setShowConfirmDialog(true)
    } else {
      navigate(-1)
    }
  }

  const handleConfirmExit = () => {
    setShowConfirmDialog(false)
    setHasUnsavedChanges(false)
    setFormDraft(null)
    setCierreDraft(false)
    // Resetear a los valores últimamente guardados
    if (lastSavedStatus) setStatusEdit(lastSavedStatus)
    setRefaccionesDraft(lastSavedRefacciones)
    navigate(-1)
  }

  const getStatusColor = (status: ServicioStatus) => {
    const hasChanged = status !== servicio?.status
    const borderClass = hasChanged ? 'border-2 border-blue-500' : 'border-2 border-slate-200'

    switch (status) {
      case 'pendiente':
        return `${borderClass} bg-yellow-50 text-yellow-900`
      case 'en_ruta':
        return `${borderClass} bg-blue-50 text-blue-900`
      case 'completado':
        return `${borderClass} bg-green-50 text-green-900`
      default:
        return `${borderClass} bg-slate-50 text-slate-900`
    }
  }

  if (isLoading) return <AdminPageLoadingSkeleton />
  if (!servicio) return <div className="p-6">Servicio no encontrado</div>

  const evidenciasSummary = summarizeServicioEvidencias(evidencias)
  const canClose = (
    statusEdit === 'completado'
    && !cierre
    && !loadingEvidencias
    && evidenciasSummary.puedeCompletar
  )
  const cierreHelpText = loadingEvidencias
    ? 'Validando evidencias del servicio antes de permitir el cierre.'
    : statusEdit !== 'completado'
      ? 'Mantén el status en "Completado" para poder cerrar el servicio.'
      : !evidenciasSummary.puedeCompletar
        ? `Antes de cerrar el servicio: ${buildServicioCompletionRequirementMessage(evidenciasSummary)}`
        : 'Completa el formulario de cierre y da clic en "Cerrar servicio".'

  const buildCierreUpdateInput = (
    data: CrearServicioInput,
    costoTotal: number,
  ): CierreInput | null => {
    if (!cierre) return null

    const tecnicoId = cierre.tecnico_id ?? data.tecnico_id ?? servicio.tecnico_id
    const aviso = cierre.aviso ?? data.aviso ?? servicio.aviso
    if (!tecnicoId || !aviso) return null

    return {
      servicio_id: servicioId,
      aviso,
      parte_objeto: cierre.parte_objeto,
      causa: cierre.causa,
      descripcion: cierre.descripcion,
      costo_total: costoTotal,
      tecnico_id: tecnicoId,
      fecha_cierre: getSafeFechaCierre(servicio.fecha_cierre ?? data.fecha_servicio ?? data.fecha_solicitud),
      firma_receptor: cierre.firma_receptor,
    }
  }

  const handleChangeStatus = (value: EditableServicioStatus) => {
    setStatusEdit(value)
    setHasUnsavedChanges(true)
  }

  const hasInvalidGeneralRefacciones = refaccionesDraft.some(
    (item) => typeof item.inventario_id !== 'number' || item.inventario_id <= 0,
  )
  const totalRefaccionesServicio = calculateRefaccionesTotal(refaccionesDraft)
  const hasRefaccionesDraftChanges = !areRefaccionesEqual(refaccionesDraft, lastSavedRefacciones)
  const draftCostoTotal = roundCurrency(
    Number(formDraft?.costo_mano_obra ?? servicio.costo_mano_obra ?? 0) + totalRefaccionesServicio,
  )

  const buildCierreDefaults = (data: CrearServicioInput): CierreDefaults => {
    return {
      aviso: data.aviso ?? servicio.aviso ?? null,
      tecnicoId: data.tecnico_id ?? servicio.tecnico_id ?? null,
      costoTotal: roundCurrency(Number(data.costo_mano_obra ?? 0) + totalRefaccionesServicio),
      fechaCierre: getSafeFechaCierre(data.fecha_servicio ?? data.fecha_solicitud),
    }
  }

  const persistServicioChanges = async (
    data: CrearServicioInput,
    options?: { requireCompleted?: boolean; silent?: boolean },
  ): Promise<boolean> => {
    try {
      if (options?.requireCompleted && statusEdit !== 'completado') {
        toast({
          title: 'Cierre no disponible',
          description: 'El servicio debe mantenerse en status completado antes de cerrarlo.',
          variant: 'destructive',
        })
        return false
      }

      if (hasInvalidGeneralRefacciones) {
        toast({
          title: 'Refacciones incompletas',
          description: 'Cada refacción debe seleccionarse desde el inventario antes de guardar.',
          variant: 'destructive',
        })
        return false
      }

      const servicioChanged = (
        Boolean(formDraft)
        || statusEdit !== lastSavedStatus
        || hasServicioDataChanges(data, servicio)
      )
      const refaccionesChanged = !areRefaccionesEqual(refaccionesDraft, lastSavedRefacciones)
      const nextCostoTotal = roundCurrency(Number(data.costo_mano_obra ?? 0) + totalRefaccionesServicio)

      if (servicioChanged) {
        await editarServicioAsync({ ...data, status: statusEdit })
      }

      if (refaccionesChanged) {
        await guardarRefaccionesAsync(refaccionesDraft)
      }

      if (cierre && (servicioChanged || refaccionesChanged)) {
        const cierreUpdate = buildCierreUpdateInput(data, nextCostoTotal)
        if (cierreUpdate) {
          await cerrarServicioAsync(cierreUpdate)
        }
      }

      setLastSavedStatus(statusEdit)
      setLastSavedRefacciones([...refaccionesDraft])
      setHasUnsavedChanges(false)
      setFormDraft(null)
      setCierreDraft(false)
      setClearDraftSignal((signal) => signal + 1)

      if (!options?.silent && (servicioChanged || refaccionesChanged)) {
        toast({ title: 'Servicio actualizado', description: 'Los cambios se guardaron correctamente.' })
      }

      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ocurrió un error al guardar.'
      toast({ title: 'Error al guardar', description: message, variant: 'destructive' })
      return false
    }
  }

  const handleBeforeOpenCierre = async (data: CrearServicioInput) => {
    const saved = await persistServicioChanges(data, {
      requireCompleted: true,
      silent: true,
    })

    if (!saved) return false

    setCierreDefaults(buildCierreDefaults(data))
    return true
  }

  const handleCerrar = async (data: CierreInput) => {
    try {
      await cerrarServicioAsync({
        ...data,
        costo_total: data.costo_total ?? cierreDefaults?.costoTotal ?? null,
      })
      setHasUnsavedChanges(false)
      setCierreDraft(false)
      navigate(`/servicios/${servicioId}`, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el cierre.'
      toast({
        title: 'Error al guardar cierre',
        description: message,
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="p-4 lg:p-5">
      <AdminBreadcrumbs
        items={[
          'Servicios',
          servicio.orden ? `Servicio #${servicio.orden}` : `Servicio #${servicio.id}`,
          'Editar',
        ]}
      />

      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBackClick}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-ran-navy lg:text-[2rem]">Editar servicio #{servicio.orden ?? servicioId}</h1>
            <p className="mt-1 text-sm text-ran-slate">Actualiza la información del servicio</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {servicio.status === 'cerrado' ? (
            <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 text-sm font-semibold text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Cerrado
            </span>
          ) : (
            <Select value={statusEdit} onValueChange={(value) => handleChangeStatus(value as EditableServicioStatus)}>
              <SelectTrigger className={`h-10 rounded-xl px-3 text-sm font-semibold ${getStatusColor(statusEdit)}`}>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            type="submit"
            form="editar-servicio-form"
            disabled={isPending || savingRefacciones || cerrando || !hasUnsavedChanges}
            className="h-10 rounded-xl bg-ran-navy px-6 text-sm font-semibold hover:bg-ran-navy/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending || savingRefacciones || cerrando ? 'Guardando...' : 'Actualizar servicio'}
          </Button>
        </div>
      </div>

      <div>
        <ServicioForm
          formId="editar-servicio-form"
          showSubmitButton={false}
          servicio={servicio}
          cierre={cierre}
          isLoading={isPending}
          clearDraftSignal={clearDraftSignal}
          canShowCierre={canClose}
          cierreHelpText={cierreHelpText}
          requireTecnicoParaEnRuta={statusEdit === 'en_ruta'}
          requireFechaServicioParaCompletar={statusEdit === 'completado'}
          onDraftChange={setFormDraft}
          onBeforeOpenCierre={handleBeforeOpenCierre}
          refaccionesContent={
            <div className="mt-4">
              {loadingRefacciones ? (
                <AdminTableSkeleton rows={4} columns={4} />
              ) : (
                <RefaccionesForm
                  defaultValues={defaultRefacciones}
                  onSubmit={() => undefined}
                  onChange={setRefaccionesDraft}
                  isLoading={savingRefacciones}
                  tecnicoStockByInventarioId={tecnicoStockByInventarioId}
                  showSubmitButton={false}
                  requireCatalogSelection
                />
              )}
            </div>
          }
          cierreContent={
            <CierreForm
              servicioId={servicioId}
              defaultAviso={cierreDefaults?.aviso ?? cierre?.aviso ?? servicio.aviso}
              defaultTecnicoId={cierreDefaults?.tecnicoId ?? cierre?.tecnico_id ?? servicio.tecnico_id}
              defaultCostoTotal={
                cierreDefaults?.costoTotal
                ?? (formDraft || hasRefaccionesDraftChanges ? draftCostoTotal : cierre?.costo_total)
                ?? draftCostoTotal
              }
              defaultFechaCierre={cierreDefaults?.fechaCierre ?? getDefaultFechaCierre(servicio)}
              defaultDescripcion={servicio.descripcion}
              cierre={cierre}
              onSubmit={handleCerrar}
              onDraftChange={() => setCierreDraft(true)}
              isLoading={cerrando}
              submitLabel={cierre ? 'Guardar cierre' : 'Cerrar servicio'}
              loadingLabel={cierre ? 'Guardando cierre...' : 'Cerrando servicio...'}
            />
          }
          onSubmit={(data) => {
            void persistServicioChanges(data)
          }}
        />
      </div>

      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <DialogTitle className="text-ran-navy">Cambios sin guardar</DialogTitle>
            </div>
            <DialogDescription className="mt-3 text-base">
              Tienes cambios sin guardar. ¿Estás seguro de que deseas salir sin guardar?
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-4">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              className="rounded-xl"
            >
              Continuar editando
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmExit}
              className="rounded-xl"
            >
              Salir sin guardar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
