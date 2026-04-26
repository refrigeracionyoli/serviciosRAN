import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  CheckCircle2,
  Package2,
  Plus,
  Trash2,
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
import { EmptyState } from '@/components/shared/EmptyState'
import { TecnicoRefaccionesSkeleton } from '@/components/shared/TecnicoSkeletons'
import { MantenimientoStatusBadge } from '@/components/shared/StatusBadge'
import { useAuth } from '@/hooks/use-auth'
import { useInventarioTecnicoQuery } from '@/hooks/use-inventario'
import {
  useEditarMantenimientoMutation,
  useGuardarMantenimientoRefaccionesTecnicoMutation,
  useMantenimientoDetalleQuery,
  useMantenimientoRefaccionesQuery,
} from '@/hooks/use-mantenimientos'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage, isBrowserOnline } from '@/lib/offline/network'
import { formatDate, formatLocalIsoDate, formatMXN } from '@/lib/utils'
import type { RefaccionInput } from '@/schemas/inventario.schema'
import type { InventarioTecnico, ServicioRefaccion } from '@/types/domain.types'

interface DraftRow {
  id: string
  inventarioId: number
  cantidad: string
}

interface InventarioOption {
  inventarioId: number
  nombre: string
  precioUnitario: number
  disponible: number
  asignadoMantenimiento: number
  restanteRuta: number
}

function createDraftRow(inventarioId: number, cantidad = 1): DraftRow {
  return {
    id: crypto.randomUUID(),
    inventarioId,
    cantidad: String(cantidad),
  }
}

function buildDraftRows(refacciones: ServicioRefaccion[]) {
  return refacciones
    .filter((item): item is ServicioRefaccion & { inventario_id: number } => (
      item.inventory_source === 'tecnico' && typeof item.inventario_id === 'number'
    ))
    .map((item) => createDraftRow(item.inventario_id, item.cantidad))
}

function buildInventarioQuantityMap(items: Array<Pick<RefaccionInput, 'inventario_id' | 'cantidad'>>) {
  const quantities = new Map<number, number>()

  items.forEach((item) => {
    if (!item.inventario_id) return
    quantities.set(item.inventario_id, (quantities.get(item.inventario_id) ?? 0) + Number(item.cantidad))
  })

  return quantities
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

function getSaveMessage(syncStatus: 'pending' | 'synced' | 'failed' | 'conflict') {
  if (syncStatus === 'synced') {
    return {
      title: 'Refacciones guardadas',
      description: 'La captura del mantenimiento se guardó correctamente.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'pending') {
    return {
      title: isBrowserOnline() ? 'Cambios registrados' : 'Cambios guardados offline',
      description: isBrowserOnline()
        ? 'La actualización quedó registrada y se terminará de procesar en segundo plano.'
        : 'La actualización quedó registrada localmente y se sincronizará cuando vuelva la conexión.',
      variant: 'default' as const,
    }
  }

  return {
    title: 'Cambios guardados con observaciones',
    description: syncStatus === 'conflict'
      ? 'La captura quedó localmente, pero requiere revisión al sincronizar.'
      : 'La captura quedó localmente, pero no se pudo sincronizar de inmediato.',
    variant: 'destructive' as const,
  }
}

function normalizeTecnicoMantenimientoError(error: unknown): string {
  const message = getErrorMessage(error, 'Ocurrió un error al actualizar el mantenimiento.')
  if (/row-level security|permission denied|new row violates|is not a function|constraint|violates/i.test(message)) {
    return 'No se pudo actualizar el mantenimiento en este momento.'
  }
  return message
}

export function TecnicoMantenimientoPage() {
  const { id } = useParams<{ id: string }>()
  const mantenimientoId = Number(id)
  const navigate = useNavigate()
  const { toast } = useToast()
  const { user } = useAuth()
  const today = formatLocalIsoDate()

  const { data: mantenimiento, isLoading: loadingMantenimiento } = useMantenimientoDetalleQuery(mantenimientoId)
  const { data: refacciones = [], isLoading: loadingRefacciones } = useMantenimientoRefaccionesQuery(mantenimientoId)
  const inventarioFecha = mantenimiento?.fecha_visita ?? today
  const { data: inventarioTecnico = [], isLoading: loadingInventario } = useInventarioTecnicoQuery(inventarioFecha, user?.id, { enabled: Boolean(user?.id) })
  const { mutateAsync: guardarRefacciones, isPending: savingRefacciones } = useGuardarMantenimientoRefaccionesTecnicoMutation(mantenimientoId, user?.id, inventarioFecha)
  const { mutateAsync: editarMantenimiento, isPending: updatingMantenimiento } = useEditarMantenimientoMutation()

  const [draftRows, setDraftRows] = useState<DraftRow[]>([])

  const refaccionesTecnico = useMemo(
    () => refacciones.filter((item) => item.inventory_source === 'tecnico'),
    [refacciones],
  )
  const refaccionesNoTecnico = useMemo(
    () => refacciones.filter((item) => item.inventory_source !== 'tecnico'),
    [refacciones],
  )

  useEffect(() => {
    setDraftRows(buildDraftRows(refaccionesTecnico))
  }, [refaccionesTecnico])

  const unresolvedRows = useMemo(
    () => refaccionesTecnico.filter((item) => typeof item.inventario_id !== 'number'),
    [refaccionesTecnico],
  )

  const savedByInventarioId = useMemo(() => (
    buildInventarioQuantityMap(
      refaccionesTecnico.map((item) => ({
        inventario_id: item.inventario_id,
        cantidad: item.cantidad,
      })),
    )
  ), [refaccionesTecnico])

  const inventarioOptions = useMemo<InventarioOption[]>(() => {
    const options = new Map<number, InventarioOption>()

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
        asignadoMantenimiento: savedCantidad,
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
        asignadoMantenimiento: savedCantidad,
        restanteRuta: 0,
      })
    })

    return Array.from(options.values()).sort((left, right) => left.nombre.localeCompare(right.nombre))
  }, [inventarioTecnico, refaccionesTecnico, savedByInventarioId])

  const optionByInventarioId = useMemo(
    () => new Map(inventarioOptions.map((option) => [option.inventarioId, option])),
    [inventarioOptions],
  )

  const rowsSubtotal = useMemo(() => (
    draftRows.reduce((sum, row) => {
      const option = optionByInventarioId.get(row.inventarioId)
      const cantidad = Number(row.cantidad)
      if (!option || !Number.isFinite(cantidad) || cantidad <= 0) return sum
      return sum + (option.precioUnitario * cantidad)
    }, 0)
  ), [draftRows, optionByInventarioId])

  const subtotalNoTecnico = useMemo(() => (
    refaccionesNoTecnico.reduce(
      (sum, item) => sum + (Number(item.cantidad) * Number(item.precio_unitario)),
      0,
    )
  ), [refaccionesNoTecnico])
  const totalRefacciones = refaccionesNoTecnico.length + draftRows.length
  const subtotal = subtotalNoTecnico + rowsSubtotal
  const canEdit = mantenimiento?.status !== 'realizado'
  const isMutating = savingRefacciones || updatingMantenimiento

  if (loadingMantenimiento || loadingRefacciones || loadingInventario) {
    return <TecnicoRefaccionesSkeleton />
  }

  if (!mantenimiento) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-600">
          No se encontró la información de este mantenimiento.
        </div>
      </div>
    )
  }

  const buildPayload = () => {
    const payload: RefaccionInput[] = []
    const byInventarioId = new Map<number, number>()

    for (const row of draftRows) {
      const option = optionByInventarioId.get(row.inventarioId)
      if (!option) {
        throw new Error('Selecciona una refacción válida del inventario.')
      }

      const cantidad = Number(row.cantidad)
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw new Error(`La cantidad para ${option.nombre} debe ser mayor a 0.`)
      }

      byInventarioId.set(row.inventarioId, (byInventarioId.get(row.inventarioId) ?? 0) + cantidad)

      if ((byInventarioId.get(row.inventarioId) ?? 0) > option.disponible) {
        throw new Error(`${option.nombre} solo tiene ${option.disponible} pieza(s) disponibles en tu inventario.`)
      }

      payload.push({
        inventario_id: row.inventarioId,
        nombre_refaccion: option.nombre,
        cantidad,
        precio_unitario: option.precioUnitario,
      })
    }

    return payload
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
        description: 'Cada refacción solo puede registrarse una vez por mantenimiento.',
        variant: 'destructive',
      })
      return
    }

    setDraftRows((current) => current.map((row) => (
      row.id === rowId
        ? { ...row, inventarioId, cantidad: row.cantidad || '1' }
        : row
    )))
  }

  const handleSave = async (completeAfterSave = false) => {
    if (unresolvedRows.length > 0) {
      toast({
        title: 'Refacciones sin catálogo',
        description: 'Este mantenimiento tiene refacciones antiguas sin vínculo al inventario. Revísalas primero desde administración.',
        variant: 'destructive',
      })
      return
    }

    try {
      const payload = buildPayload()
      const saveResult = await guardarRefacciones(payload)

      toast(getSaveMessage(saveResult.syncStatus))

      if (completeAfterSave) {
        await editarMantenimiento({
          id: mantenimientoId,
          data: {
            status: 'realizado',
            fecha_visita: mantenimiento.fecha_visita ?? today,
            costo_refacciones: subtotal,
          },
        })

        toast({
          title: 'Mantenimiento realizado',
          description: 'El mantenimiento quedó marcado como realizado.',
        })
        navigate('/tecnico')
      }
    } catch (error) {
      toast({
        title: 'No se pudo guardar',
        description: normalizeTecnicoMantenimientoError(error),
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
                Mantenimiento de póliza
              </p>
              <h1 className="mt-1.5 text-xl font-extrabold leading-tight">
                {mantenimiento.cliente?.nombre ?? `Mantenimiento #${mantenimientoId}`}
              </h1>
              <p className="mt-1 text-[13px] text-white/78">{mantenimiento.tipo_servicio}</p>
            </div>

            <MantenimientoStatusBadge
              status={mantenimiento.status}
              className="border-white/25 bg-white/15 text-white"
            />
          </div>

          <div className="mt-4 grid gap-1.5 text-[13px] text-white/78">
            <div>{mantenimiento.cliente?.direccion ?? 'Sin dirección registrada'}</div>
            <div>{mantenimiento.maquina ? `${mantenimiento.maquina.modelo} · ${mantenimiento.maquina.serie}` : 'Sin máquina asignada'}</div>
            <div>{mantenimiento.fecha_visita ? formatDate(mantenimiento.fecha_visita) : 'Sin fecha programada'}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Catálogo</p>
            <p className="mt-1.5 text-lg font-extrabold text-ran-navy">{inventarioOptions.length}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Capturadas</p>
            <p className="mt-1.5 text-lg font-extrabold text-ran-navy">{totalRefacciones}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Total</p>
            <p className="mt-1.5 text-[13px] font-extrabold text-ran-navy">{formatMXN(subtotal)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Refacciones
            </p>
            <h2 className="mt-1.5 text-base font-extrabold text-ran-navy">Asignar piezas al mantenimiento</h2>
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

        {unresolvedRows.length > 0 ? (
          <div className="mt-4 rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-4 text-[13px] text-amber-800">
            Este mantenimiento tiene refacciones antiguas sin vínculo al catálogo. Revísalas primero desde administración antes de guardar cambios aquí.
          </div>
        ) : inventarioOptions.length === 0 && draftRows.length === 0 && refaccionesNoTecnico.length === 0 ? (
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
            {refaccionesNoTecnico.length > 0 && (
              <div className="space-y-2.5">
                {refaccionesNoTecnico.map((item, index) => {
                  const source = getRefaccionSourcePresentation(item.inventory_source)
                  return (
                    <article
                      key={`mantenimiento-refaccion-admin-${item.id ?? `${item.nombre_refaccion}-${index}`}`}
                      className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-ran-navy">{item.nombre_refaccion}</p>
                          <p className="mt-1 text-[13px] text-ran-slate">
                            {item.cantidad} pza(s) · {formatMXN(item.precio_unitario)}
                          </p>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${source.className}`}>
                          {source.label}
                        </span>
                      </div>
                      <p className="mt-2 text-[12px] text-slate-500">{source.description}</p>
                    </article>
                  )
                })}
              </div>
            )}

            {draftRows.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center text-[13px] text-slate-500">
                Aún no has asignado refacciones de tu inventario técnico a este mantenimiento.
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
                          name={`mantenimiento_refaccion_${row.id}`}
                          value={String(row.inventarioId)}
                          onValueChange={(value) => handleChangeInventario(row.id, Number(value))}
                          disabled={!canEdit}
                        >
                          <SelectTrigger className="mt-2 h-9 rounded-xl bg-white text-[13px]">
                            <SelectValue placeholder="Selecciona una refacción" />
                          </SelectTrigger>
                          <SelectContent>
                            {inventarioOptions.map((currentOption) => (
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
                            type="number"
                            min="1"
                            value={row.cantidad}
                            onChange={(event) => {
                              const nextValue = event.target.value
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
      </section>

      <div className="grid gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full rounded-xl"
          onClick={() => void handleSave(false)}
          disabled={!canEdit || isMutating}
        >
          <Package2 className="h-4 w-4" />
          {savingRefacciones ? 'Guardando...' : 'Guardar refacciones'}
        </Button>

        <Button
          type="button"
          size="sm"
          className="w-full rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
          onClick={() => void handleSave(true)}
          disabled={!canEdit || isMutating}
        >
          <CheckCircle2 className="h-4 w-4" />
          {updatingMantenimiento ? 'Guardando...' : 'Guardar y marcar realizado'}
        </Button>
      </div>
    </div>
  )
}
