import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PageLoading } from '@/components/shared/LoadingSpinner'
import { ServicioForm } from '@/components/forms/ServicioForm'
import { RefaccionesForm } from '@/components/forms/RefaccionesForm'
import { CierreForm } from '@/components/forms/CierreForm'
import { useServicioDetalleQuery, useEditarServicioMutation } from '@/hooks/use-servicios'
import { useCierreQuery, useCerrarServicioMutation } from '@/hooks/use-cierres'
import { serviciosKeys } from '@/hooks/use-servicios'
import { useToast } from '@/hooks/use-toast'
import { supabase } from '@/lib/supabase'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { CierreInput } from '@/schemas/cliente.schema'
import type { CrearServicioInput } from '@/schemas/servicio.schema'
import type { ServicioRefaccion, ServicioStatus } from '@/types/domain.types'

const STATUS_OPTIONS: Array<{ value: ServicioStatus; label: string }> = [
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
  ].join('|')
}

function areRefaccionesEqual(current: RefaccionInput[], previous: RefaccionInput[]): boolean {
  if (current.length !== previous.length) return false

  const left = current.map(serializeRefaccion).sort()
  const right = previous.map(serializeRefaccion).sort()

  return left.every((value, index) => value === right[index])
}

export function ServicioEditarPage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [statusEdit, setStatusEdit] = useState<ServicioStatus>('pendiente')
  const [refaccionesDraft, setRefaccionesDraft] = useState<RefaccionInput[]>([])
  const [formDraft, setFormDraft] = useState<Partial<CrearServicioInput> | null>(null)
  const [clearDraftSignal, setClearDraftSignal] = useState(0)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [cierreDraft, setCierreDraft] = useState(false)
  
  // Guardar valores últimamente guardados para comparación
  const [lastSavedStatus, setLastSavedStatus] = useState<ServicioStatus | null>(null)
  const [lastSavedRefacciones, setLastSavedRefacciones] = useState<RefaccionInput[]>([])

  const { data: servicio, isLoading } = useServicioDetalleQuery(servicioId)
  const { data: cierre } = useCierreQuery(servicioId)
  const {
    mutateAsync: editarServicioAsync,
    isPending,
  } = useEditarServicioMutation(servicioId)
  const { mutate: cerrarServicio, isPending: cerrando } = useCerrarServicioMutation(servicioId)
  const { data: refacciones = [], isLoading: loadingRefacciones } = useQuery({
    queryKey: ['servicio-refacciones', servicioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicio_refacciones')
        .select('*')
        .eq('servicio_id', servicioId)
        .order('id')
      if (error) throw error
      return data as ServicioRefaccion[]
    },
  })

  const { mutateAsync: guardarRefaccionesAsync, isPending: savingRefacciones } = useMutation({
    mutationFn: async (items: RefaccionInput[]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: deleteError } = await (supabase.from('servicio_refacciones') as any)
        .delete()
        .eq('servicio_id', servicioId)
      if (deleteError) throw deleteError

      if (items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: insertError } = await (supabase.from('servicio_refacciones') as any)
          .insert(
            items.map((item) => ({
              servicio_id: servicioId,
              inventario_id: item.inventario_id ?? null,
              nombre_refaccion: item.nombre_refaccion,
              cantidad: item.cantidad,
              precio_unitario: item.precio_unitario,
            })),
          )
        if (insertError) throw insertError
      }

      const totalRefacciones = items.reduce(
        (sum, item) => sum + item.cantidad * item.precio_unitario,
        0,
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: serviceError } = await (supabase.from('servicios') as any)
        .update({ costo_refacciones: totalRefacciones })
        .eq('id', servicioId)
      if (serviceError) throw serviceError
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servicio-refacciones', servicioId] })
      qc.invalidateQueries({ queryKey: serviciosKeys.detail(servicioId) })
      qc.invalidateQueries({ queryKey: serviciosKeys.all })
    },
  })

  useEffect(() => {
    if (servicio && servicio.status !== 'cerrado') {
      setStatusEdit(servicio.status)
      setLastSavedStatus(servicio.status)
    }
  }, [servicio])

  useEffect(() => {
    if (servicio?.status !== 'cerrado') return
    navigate(`/servicios/${servicioId}`, { replace: true })
  }, [servicio?.status, navigate, servicioId])

  const defaultRefacciones = useMemo(
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
    setLastSavedRefacciones(defaultRefacciones)
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
          lastSavedRefacciones[idx] &&
          item.nombre_refaccion === lastSavedRefacciones[idx].nombre_refaccion &&
          item.cantidad === lastSavedRefacciones[idx].cantidad &&
          item.precio_unitario === lastSavedRefacciones[idx].precio_unitario &&
          item.inventario_id === lastSavedRefacciones[idx].inventario_id,
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

  if (isLoading) return <PageLoading />
  if (!servicio) return <div className="p-6">Servicio no encontrado</div>

  const handleChangeStatus = (value: ServicioStatus) => {
    setStatusEdit(value)
    setHasUnsavedChanges(true)
  }

  const handleCerrar = (data: CierreInput) => {
    cerrarServicio(data, {
      onSuccess: () => {
        setHasUnsavedChanges(false)
        navigate(`/servicios/${servicioId}`, { replace: true })
      },
    })
  }

  const canClose = servicio.status === 'completado' && !cierre

  return (
    <div className="p-4 lg:p-5">
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
            <Select value={statusEdit} onValueChange={(value) => handleChangeStatus(value as ServicioStatus)}>
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
            disabled={isPending || savingRefacciones || !hasUnsavedChanges || servicio.status === 'cerrado'}
            className="h-10 rounded-xl bg-ran-navy px-6 text-sm font-semibold hover:bg-ran-navy/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending || savingRefacciones ? 'Guardando...' : 'Actualizar servicio'}
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
          requireTecnicoParaEnRuta={statusEdit === 'en_ruta'}
          requireFechaServicioParaCompletar={statusEdit === 'completado'}
          onDraftChange={setFormDraft}
          refaccionesContent={
            <div className="mt-4">
              {loadingRefacciones ? (
                <PageLoading />
              ) : (
                <RefaccionesForm
                  defaultValues={defaultRefacciones}
                  onSubmit={() => undefined}
                  onChange={setRefaccionesDraft}
                  isLoading={savingRefacciones}
                  showSubmitButton={false}
                />
              )}
            </div>
          }
          cierreContent={
            <CierreForm
              servicioId={servicioId}
              onSubmit={handleCerrar}
              onDraftChange={() => setCierreDraft(true)}
              isLoading={cerrando}
            />
          }
          onSubmit={(data) => {
            ;(async () => {
              try {
                if (servicio.status === 'cerrado') {
                  toast({
                    title: 'Servicio cerrado',
                    description: 'Este servicio ya no puede actualizarse.',
                    variant: 'destructive',
                  })
                  navigate(`/servicios/${servicioId}`, { replace: true })
                  return
                }

                if (statusEdit === 'cerrado') {
                  toast({
                    title: 'Status inválido',
                    description: 'No se puede actualizar un servicio con status cerrado desde esta pantalla.',
                    variant: 'destructive',
                  })
                  return
                }

                await editarServicioAsync({ ...data, status: statusEdit })
                const refaccionesChanged = !areRefaccionesEqual(refaccionesDraft, lastSavedRefacciones)
                if (refaccionesChanged) {
                  await guardarRefaccionesAsync(refaccionesDraft)
                }
                
                // Guardar estos valores como los últimamente guardados
                setLastSavedStatus(statusEdit)
                setLastSavedRefacciones([...refaccionesDraft])
                
                // Limpiar drafts
                setHasUnsavedChanges(false)
                setFormDraft(null)
                setCierreDraft(false)
                setClearDraftSignal((signal) => signal + 1)
                
                toast({ title: 'Servicio actualizado', description: 'Los cambios se guardaron correctamente.' })
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Ocurrió un error al guardar.'
                toast({ title: 'Error al guardar', description: message, variant: 'destructive' })
              }
            })()
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
