import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  Package2,
  Plus,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/shared/EmptyState'
import { TecnicoRefaccionesSkeleton } from '@/components/shared/TecnicoSkeletons'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/hooks/use-auth'
import { useEvidenciasQuery } from '@/hooks/use-evidencias'
import { useInventarioTecnicoQuery } from '@/hooks/use-inventario'
import {
  useCompletarServicioConRefaccionesMutation,
  useGuardarServicioRefaccionesTecnicoMutation,
  useServicioDetalleQuery,
  useServicioRefaccionesQuery,
} from '@/hooks/use-servicios'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage, isBrowserOnline } from '@/lib/offline/network'
import { buildServicioCompletionRequirementMessage, summarizeServicioEvidencias } from '@/lib/tecnico/servicio-evidencias'
import { formatDate, formatLocalIsoDate, formatMXN } from '@/lib/utils'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { InventarioTecnico, ServicioRefaccion } from '@/types/domain.types'

interface DraftRow {
  id: string
  inventarioId: number
  cantidad: string
}

interface InventarioTecnicoOption {
  inventarioId: number
  nombre: string
  precioUnitario: number
  disponible: number
  asignadoServicio: number
  restanteRuta: number
}

const EMPTY_REFACCIONES: ServicioRefaccion[] = []

function createDraftRow(inventarioId: number, cantidad = 1): DraftRow {
  return {
    id: crypto.randomUUID(),
    inventarioId,
    cantidad: String(cantidad),
  }
}

function buildInventarioQuantityMap(items: Array<Pick<RefaccionInput, 'inventario_id' | 'cantidad'>>) {
  const quantities = new Map<number, number>()

  items.forEach((item) => {
    if (!item.inventario_id) return
    quantities.set(item.inventario_id, (quantities.get(item.inventario_id) ?? 0) + Number(item.cantidad))
  })

  return quantities
}

function buildDraftRows(refacciones: ServicioRefaccion[]) {
  return refacciones
    .filter((item) => item.inventory_source === 'tecnico' && typeof item.inventario_id === 'number')
    .map((item) => createDraftRow(item.inventario_id!, item.cantidad))
}

function areDraftRowsEquivalent(left: DraftRow[], right: DraftRow[]) {
  if (left.length !== right.length) return false

  return left.every((row, index) => {
    const nextRow = right[index]
    return row.inventarioId === nextRow.inventarioId && row.cantidad === nextRow.cantidad
  })
}

function clampDraftCantidad(rawValue: string, maxCantidad: number): string {
  if (rawValue.trim() === '') return ''

  const parsed = Number(rawValue)
  if (!Number.isFinite(parsed)) return '1'

  const normalized = Math.max(1, Math.trunc(parsed))
  const safeMax = Math.max(1, Math.trunc(maxCantidad))
  return String(Math.min(normalized, safeMax))
}

function getSaveMessage(syncStatus: 'pending' | 'synced' | 'failed' | 'conflict') {
  if (syncStatus === 'synced') {
    return {
      title: 'Refacciones asignadas',
      description: 'La asignación quedó guardada correctamente.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'pending') {
    if (isBrowserOnline()) {
      return {
        title: 'Refacciones guardadas',
        description: 'La asignación quedó registrada y se terminará de procesar en segundo plano.',
        variant: 'default' as const,
      }
    }

    return {
      title: 'Refacciones guardadas offline',
      description: 'La asignación quedó registrada localmente y se sincronizará después.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'conflict') {
    return {
      title: 'Asignación guardada con conflicto',
      description: 'La captura quedó localmente, pero requiere revisión al sincronizar.',
      variant: 'destructive' as const,
    }
  }

  return {
    title: 'Asignación guardada con observaciones',
    description: 'La captura quedó localmente, pero no se pudo sincronizar de inmediato.',
    variant: 'destructive' as const,
  }
}

function getCompletionMessage(syncStatus: 'pending' | 'synced' | 'failed' | 'conflict') {
  if (syncStatus === 'synced') {
    return {
      title: 'Servicio completado',
      description: 'El servicio quedó marcado como completado.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'pending') {
    if (isBrowserOnline()) {
      return {
        title: 'Servicio registrado',
        description: 'El cierre quedó guardado y se terminará de procesar en segundo plano.',
        variant: 'default' as const,
      }
    }

    return {
      title: 'Servicio guardado offline',
      description: 'El cierre quedó pendiente y se sincronizará cuando vuelva la conexión.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'conflict') {
    return {
      title: 'Servicio marcado con conflicto',
      description: 'El cambio quedó localmente, pero requiere revisión al sincronizar.',
      variant: 'destructive' as const,
    }
  }

  return {
    title: 'Servicio marcado con observaciones',
    description: 'El cierre quedó localmente, pero no se pudo sincronizar de inmediato.',
    variant: 'destructive' as const,
  }
}

function normalizeInventarioTecnicoRows(rows: InventarioTecnico[]) {
  return [...rows].sort((left, right) => {
    const leftName = left.item?.nombre ?? `Item ${left.inventario_id}`
    const rightName = right.item?.nombre ?? `Item ${right.inventario_id}`
    return leftName.localeCompare(rightName)
  })
}

function getRefaccionSourcePresentation(source: ServicioRefaccion['inventory_source']) {
  return source === 'tecnico'
    ? {
      label: 'Técnico',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      description: 'Tomada desde el inventario del técnico.',
    }
    : {
      label: 'Administración',
      className: 'border-sky-200 bg-sky-50 text-sky-700',
      description: 'Registrada previamente por administración.',
    }
}

export function TecnicoRefaccionesPage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()

  const { data: servicio, isLoading: loadingServicio } = useServicioDetalleQuery(servicioId)
  const { data: refaccionesQueryData, isLoading: loadingRefacciones } = useServicioRefaccionesQuery(servicioId)
  const refaccionesData = refaccionesQueryData ?? EMPTY_REFACCIONES
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId)
  const inventarioFecha = servicio?.fecha_servicio ?? formatLocalIsoDate()
  const {
    data: inventarioTecnico = [],
    isLoading: loadingInventario,
  } = useInventarioTecnicoQuery(inventarioFecha, user?.id, { enabled: Boolean(user?.id) })
  const { mutateAsync: guardarRefacciones, isPending: savingRefacciones } =
    useGuardarServicioRefaccionesTecnicoMutation(servicioId, user?.id, inventarioFecha)
  const { mutateAsync: completarServicio, isPending: completingServicio } =
    useCompletarServicioConRefaccionesMutation()

  const [draftRows, setDraftRows] = useState<DraftRow[]>([])

  const refaccionesTecnico = useMemo(() => (
    refaccionesData.filter((item) => item.inventory_source === 'tecnico')
  ), [refaccionesData])
  const refaccionesNoTecnico = useMemo(() => (
    refaccionesData.filter((item) => item.inventory_source !== 'tecnico')
  ), [refaccionesData])

  useEffect(() => {
    const nextRows = buildDraftRows(refaccionesTecnico)
    setDraftRows((currentRows) => (
      areDraftRowsEquivalent(currentRows, nextRows) ? currentRows : nextRows
    ))
  }, [refaccionesTecnico])

  const savedByInventarioId = useMemo(() => (
    buildInventarioQuantityMap(
      refaccionesTecnico.map((item) => ({
        inventario_id: item.inventario_id,
        cantidad: item.cantidad,
      })),
    )
  ), [refaccionesTecnico])

  const inventarioOptions = useMemo<InventarioTecnicoOption[]>(() => {
    const options = new Map<number, InventarioTecnicoOption>()

    normalizeInventarioTecnicoRows(inventarioTecnico).forEach((row) => {
      const savedCantidad = savedByInventarioId.get(row.inventario_id) ?? 0
      const restanteRuta = Number(row.cantidad ?? 0)
      const disponible = restanteRuta + savedCantidad

      if (disponible <= 0 && savedCantidad <= 0) return

      options.set(row.inventario_id, {
        inventarioId: row.inventario_id,
        nombre: row.item?.nombre ?? `Item ${row.inventario_id}`,
        precioUnitario: Number(row.item?.precio_unitario ?? 0),
        disponible,
        asignadoServicio: savedCantidad,
        restanteRuta,
      })
    })

    refaccionesTecnico.forEach((item) => {
      if (!item.inventario_id || options.has(item.inventario_id)) return

      const savedCantidad = savedByInventarioId.get(item.inventario_id) ?? item.cantidad
      options.set(item.inventario_id, {
        inventarioId: item.inventario_id,
        nombre: item.nombre_refaccion,
        precioUnitario: Number(item.precio_unitario ?? 0),
        disponible: savedCantidad,
        asignadoServicio: savedCantidad,
        restanteRuta: 0,
      })
    })

    return Array.from(options.values()).sort((left, right) => left.nombre.localeCompare(right.nombre))
  }, [inventarioTecnico, refaccionesTecnico, savedByInventarioId])

  const optionByInventarioId = useMemo(() => (
    new Map(inventarioOptions.map((option) => [option.inventarioId, option]))
  ), [inventarioOptions])

  const rowsSubtotal = useMemo(() => {
    return draftRows.reduce((sum, row) => {
      const option = optionByInventarioId.get(row.inventarioId)
      const cantidad = Number(row.cantidad)
      if (!option || !Number.isFinite(cantidad) || cantidad <= 0) return sum
      return sum + (option.precioUnitario * cantidad)
    }, 0)
  }, [draftRows, optionByInventarioId])
  const subtotalNoTecnico = useMemo(() => {
    return refaccionesNoTecnico.reduce(
      (sum, item) => sum + (Number(item.cantidad) * Number(item.precio_unitario)),
      0,
    )
  }, [refaccionesNoTecnico])
  const totalRefaccionesVisibles = refaccionesNoTecnico.length + draftRows.length
  const subtotalVisible = subtotalNoTecnico + rowsSubtotal

  const totalDisponible = useMemo(() => {
    return inventarioTecnico.reduce((sum, row) => sum + Number(row.cantidad ?? 0), 0)
  }, [inventarioTecnico])

  const evidenciasSummary = useMemo(() => summarizeServicioEvidencias(evidencias), [evidencias])
  const completionRequirementMessage = buildServicioCompletionRequirementMessage(evidenciasSummary)
  const canEdit = servicio?.status !== 'cerrado'
  const canComplete = servicio?.status !== 'completado' && servicio?.status !== 'cerrado'
  const isMutating = savingRefacciones || completingServicio

  if (loadingServicio || loadingRefacciones || loadingInventario || loadingEvidencias) {
    return <TecnicoRefaccionesSkeleton />
  }

  if (!servicio) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-600">
          No se encontró la información de este servicio.
        </div>
      </div>
    )
  }

  const buildPayload = () => {
    const payloadDraft: RefaccionInput[] = []
    const draftByInventarioId = new Map<number, number>()

    draftRows.forEach((row) => {
      const option = optionByInventarioId.get(row.inventarioId)
      if (!option) {
        throw new Error('Selecciona una refacción válida de tu inventario técnico.')
      }

      const cantidad = Number(row.cantidad)
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error(`La cantidad para ${option.nombre} debe ser mayor a 0.`)
      }

      const nextCantidad = (draftByInventarioId.get(row.inventarioId) ?? 0) + cantidad
      if (nextCantidad > option.disponible) {
        throw new Error(`${option.nombre} solo tiene ${option.disponible} pieza(s) disponibles en tu inventario.`)
      }

      draftByInventarioId.set(row.inventarioId, nextCantidad)
      payloadDraft.push({
        inventario_id: row.inventarioId,
        nombre_refaccion: option.nombre,
        cantidad,
        precio_unitario: option.precioUnitario,
      })
    })

    return payloadDraft
  }

  const handleAddRow = () => {
    const selectedIds = new Set(draftRows.map((row) => row.inventarioId))
    const nextOption = inventarioOptions.find((option) => !selectedIds.has(option.inventarioId))

    if (!nextOption) {
      toast({
        title: 'Sin más refacciones disponibles',
        description: 'Ya agregaste todas las refacciones disponibles de tu inventario técnico.',
      })
      return
    }

    setDraftRows((current) => [...current, createDraftRow(nextOption.inventarioId)])
  }

  const handleChangeInventario = (rowId: string, inventarioId: number) => {
    const duplicated = draftRows.some((row) => row.id !== rowId && row.inventarioId === inventarioId)
    if (duplicated) {
      toast({
        title: 'Refacción duplicada',
        description: 'Cada refacción solo puede registrarse una vez por servicio en esta pantalla.',
        variant: 'destructive',
      })
      return
    }

    const option = optionByInventarioId.get(inventarioId)
    setDraftRows((current) => current.map((row) => (
      row.id === rowId
        ? {
            ...row,
            inventarioId,
            cantidad: option ? clampDraftCantidad(row.cantidad || '1', option.disponible) : row.cantidad || '1',
          }
        : row
    )))
  }

  const handleSave = async (completeAfterSave = false) => {
    if (!canEdit) {
      toast({
        title: 'Servicio cerrado',
        description: 'Este servicio ya no admite cambios.',
        variant: 'destructive',
      })
      return
    }

    try {
      const payload = buildPayload()
      const saveResult = await guardarRefacciones(payload)
      toast(getSaveMessage(saveResult.syncStatus))

      if (completeAfterSave) {
        if (saveResult.syncStatus === 'failed' || saveResult.syncStatus === 'conflict') {
          return
        }

        if (!evidenciasSummary.puedeCompletar) {
          toast({
            title: 'Faltan evidencias para completar',
            description: completionRequirementMessage,
            variant: 'destructive',
          })
          return
        }

        const totalAfterSave = subtotalNoTecnico + payload.reduce(
          (sum, item) => sum + Number(item.cantidad) * Number(item.precio_unitario),
          0,
        )

        const completionResult = await completarServicio({
          serviceId: servicioId,
          items: [],
          baseCostoRefacciones: totalAfterSave,
          expectedUpdatedAt: null,
          expectedStatus: servicio.status ?? null,
        })

        toast(getCompletionMessage(completionResult.syncStatus))
        navigate(-1)
      }
    } catch (error) {
      toast({
        title: 'No se pudo guardar',
        description: getErrorMessage(error, 'Ocurrió un error al guardar refacciones.'),
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4 px-3.5 py-4">
      <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_22px_50px_-36px_rgba(15,23,42,0.4)]">
        <div className="bg-[linear-gradient(135deg,rgba(27,59,111,1),rgba(37,99,235,0.92))] px-4 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={() => navigate(-1)}
              className="h-9 w-9 rounded-xl border border-white/20 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/70">
                Refacciones del servicio
              </p>
              <h1 className="mt-1.5 text-xl font-extrabold leading-tight">
                {servicio.cliente?.nombre ?? `Servicio #${servicioId}`}
              </h1>
              <p className="mt-1 text-[13px] text-white/78">{servicio.tipo_servicio}</p>
            </div>

            <ServicioStatusBadge
              status={servicio.status}
              className="border-white/25 bg-white/15 text-white"
            />
          </div>

          <div className="mt-4 grid gap-1.5 text-[13px] text-white/78">
            <div>{servicio.cliente?.direccion ?? 'Sin dirección registrada'}</div>
            <div>{servicio.maquina ? `${servicio.maquina.modelo} · ${servicio.maquina.serie}` : 'Sin máquina asignada'}</div>
            <div>{formatDate(servicio.fecha_servicio)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Ruta</p>
            <p className="mt-1.5 text-lg font-extrabold text-ran-navy">{totalDisponible}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Registradas</p>
            <p className="mt-1.5 text-lg font-extrabold text-ran-navy">{totalRefaccionesVisibles}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Total</p>
            <p className="mt-1.5 text-[13px] font-extrabold text-ran-navy">{formatMXN(subtotalVisible)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Inventario técnico
            </p>
            <h2 className="mt-1.5 text-base font-extrabold text-ran-navy">Asignar piezas al servicio</h2>
            <p className="mt-1 text-[13px] text-ran-slate">
              Solo puedes usar refacciones que ya tomaste en tu inventario del día.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full rounded-xl sm:w-auto"
            onClick={handleAddRow}
            disabled={!canEdit || inventarioOptions.length === 0}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>

        {inventarioOptions.length === 0 && draftRows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Sin inventario técnico disponible"
              description="Primero toma refacciones desde tu tab de inventario para poder asignarlas aquí."
              action={(
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => navigate('/tecnico/inventario')}
                >
                  Ver mi inventario
                </Button>
              )}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {draftRows.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center text-[13px] text-slate-500">
                Aún no has asignado refacciones de tu inventario técnico a este servicio.
              </div>
            ) : (
              draftRows.map((row) => {
                const option = optionByInventarioId.get(row.inventarioId)
                if (!option) return null

                return (
                  <article
                    key={row.id}
                    className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5"
                  >
                    <div className="grid gap-3">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Refacción
                        </p>
                        <Select
                          name={`servicio_refaccion_${row.id}`}
                          value={String(row.inventarioId)}
                          onValueChange={(value) => handleChangeInventario(row.id, Number(value))}
                          disabled={!canEdit}
                        >
                          <SelectTrigger className="mt-2 h-9 rounded-xl bg-white text-[13px]">
                            <SelectValue placeholder="Selecciona una refacción" />
                          </SelectTrigger>
                          <SelectContent>
                            {inventarioOptions
                              .filter((currentOption) => (
                                currentOption.inventarioId === row.inventarioId
                                || !draftRows.some((draftRow) => (
                                  draftRow.id !== row.id
                                  && draftRow.inventarioId === currentOption.inventarioId
                                ))
                              ))
                              .map((currentOption) => (
                                <SelectItem
                                  key={currentOption.inventarioId}
                                  value={String(currentOption.inventarioId)}
                                >
                                  {currentOption.nombre}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-[1fr_auto] gap-3">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Cantidad
                          </p>
                          <Input
                            id={`servicio-refaccion-cantidad-${row.id}`}
                            name={`servicio_refaccion_cantidad_${row.id}`}
                            type="number"
                            min="1"
                            max={option.disponible}
                            value={row.cantidad}
                            onChange={(event) => {
                              const nextValue = clampDraftCantidad(event.target.value, option.disponible)
                              setDraftRows((current) => current.map((currentRow) => (
                                currentRow.id === row.id
                                  ? { ...currentRow, cantidad: nextValue }
                                  : currentRow
                              )))
                            }}
                            className="mt-2 h-9 rounded-xl bg-white text-[13px]"
                            disabled={!canEdit}
                          />
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-5 h-9 w-9 rounded-xl text-destructive hover:text-destructive"
                          onClick={() => setDraftRows((current) => current.filter((currentRow) => currentRow.id !== row.id))}
                          disabled={!canEdit}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px]">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Disponible total
                          </p>
                          <p className="mt-1 font-semibold text-ran-navy">{option.disponible}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Restante en ruta
                          </p>
                          <p className="mt-1 font-semibold text-ran-navy">{option.restanteRuta}</p>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        )}

        <Separator className="my-4" />

        <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-white p-2.5 text-ran-navy">
              <Package2 className="h-4.5 w-4.5" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-ran-navy">Inventario del día: {formatDate(inventarioFecha)}</p>
              <p className="mt-1 text-[13px] text-ran-slate">
                Si te faltan piezas, regresa a tu inventario y tómales cantidad desde el inventario general antes de continuar.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Resumen del servicio
          </p>
          <h3 className="mt-1.5 text-base font-extrabold text-ran-navy">Refacciones ya registradas</h3>
          <p className="mt-1 text-[13px] text-ran-slate">
            Se muestran todas las refacciones guardadas para este servicio, incluso las que capturó administración.
          </p>
        </div>

        {refaccionesData.length === 0 ? (
          <div className="mt-4 rounded-[20px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center text-[13px] text-slate-500">
            Aún no hay refacciones registradas para este servicio.
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {refaccionesData.map((item, index) => {
              const source = getRefaccionSourcePresentation(item.inventory_source)
              const subtotal = Number(item.cantidad) * Number(item.precio_unitario)

              return (
                <article
                  key={`${item.inventory_source}-${item.inventario_id ?? item.nombre_refaccion}-${index}`}
                  className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[13px] font-semibold text-ran-navy">{item.nombre_refaccion}</p>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${source.className}`}>
                          {source.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] text-ran-slate">{source.description}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-[13px] font-bold text-ran-navy">{item.cantidad} pza(s)</p>
                      <p className="mt-1 text-[12px] text-ran-slate">{formatMXN(subtotal)}</p>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-ran-ice/70 p-2.5 text-ran-navy">
            <Wrench className="h-4.5 w-4.5" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Guardado del servicio
            </p>
            <h3 className="mt-1.5 text-base font-extrabold text-ran-navy">Registrar refacciones utilizadas</h3>
            <p className="mt-1 text-[13px] text-ran-slate">
              Guarda las piezas usadas y, si ya terminaste, marca el servicio como completado.
            </p>
          </div>
        </div>

        <div className={`mt-4 rounded-[20px] border px-3.5 py-3 ${
          evidenciasSummary.puedeCompletar
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-900'
        }`}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
            Requisito de cierre
          </p>
          <p className="mt-1 text-[13px] font-medium leading-5">
            {completionRequirementMessage}
          </p>
          {!evidenciasSummary.puedeCompletar && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 rounded-xl border-white/60 bg-white/70 text-amber-950 hover:bg-white"
              onClick={() => navigate(`/tecnico/servicio/${servicio.id}/evidencia`)}
            >
              <Camera className="h-4 w-4" />
              Ir a evidencia
            </Button>
          )}
        </div>

        <div className="mt-4 grid gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 rounded-xl"
            onClick={() => handleSave(false)}
            disabled={isMutating || !canEdit}
          >
            Guardar refacciones
          </Button>

          <Button
            type="button"
            size="sm"
            className="h-10 rounded-xl bg-ran-navy hover:bg-ran-navy/90"
            onClick={() => handleSave(true)}
            disabled={isMutating || !canComplete || !evidenciasSummary.puedeCompletar}
          >
            Guardar y completar servicio
          </Button>
        </div>
      </section>
    </div>
  )
}
