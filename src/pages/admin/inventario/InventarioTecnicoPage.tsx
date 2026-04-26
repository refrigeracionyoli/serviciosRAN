import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Search, Trash2, UserRound } from 'lucide-react'
import { AdminCardListSkeleton } from '@/components/shared/AdminSkeletons'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useEliminarInventarioTecnicoMutation,
  useInventarioQuery,
  useInventarioTecnicoQuery,
  useGuardarInventarioTecnicoMutation,
} from '@/hooks/use-inventario'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import { getInventarioTecnicoAssignedTotal, isInventarioTecnicoReturned } from '@/lib/inventario-tecnico'
import { useToast } from '@/hooks/use-toast'
import { cn, formatDate } from '@/lib/utils'
import type { InventarioTecnico } from '@/types/domain.types'
import { InventarioSubNav } from './InventarioSubNav'

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function includesNormalized(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

function clampCantidadInput(value: string, maxCantidad: number, minCantidad = 1): string {
  if (value.trim() === '') return ''

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ''

  const normalizedMax = Math.max(0, Math.floor(maxCantidad))
  const normalizedMin = normalizedMax <= 0 ? 0 : minCantidad
  const nextCantidad = Math.floor(parsed)

  if (nextCantidad < normalizedMin) return String(normalizedMin)
  if (nextCantidad > normalizedMax) return String(normalizedMax)
  return String(nextCantidad)
}

function sortByItemName(rows: InventarioTecnico[]): InventarioTecnico[] {
  return [...rows].sort((a, b) => {
    const left = a.item?.nombre ?? `Item ${a.inventario_id}`
    const right = b.item?.nombre ?? `Item ${b.inventario_id}`
    return left.localeCompare(right)
  })
}

function getDisplayedCantidad(row: InventarioTecnico, isHistoryView: boolean): number {
  return isHistoryView
    ? getInventarioTecnicoAssignedTotal(row)
    : Number(row.cantidad ?? 0)
}

function getHistoryStatus(row: InventarioTecnico): string {
  if (isInventarioTecnicoReturned(row)) {
    return row.devuelto_automaticamente
      ? 'Devuelta automáticamente al inventario general al iniciar el siguiente día.'
      : 'Devuelta manualmente al inventario general.'
  }

  if (Number(row.cantidad ?? 0) <= 0) {
    return 'Consumida o asignada completamente durante la jornada.'
  }

  return `Cerró con ${row.cantidad} pieza(s) restantes.`
}

export function InventarioTecnicoPage() {
  const { toast } = useToast()
  const [fecha, setFecha] = useState(formatLocalIsoDate(new Date()))
  const [searchTecnico, setSearchTecnico] = useState('')
  const [selectedTecnicoId, setSelectedTecnicoId] = useState('')
  const [nuevoInventarioId, setNuevoInventarioId] = useState('')
  const [nuevoCantidad, setNuevoCantidad] = useState('1')
  const [cantidadesEditables, setCantidadesEditables] = useState<Record<number, string>>({})
  const [rowToDelete, setRowToDelete] = useState<InventarioTecnico | null>(null)

  const normalizedSearchTecnico = searchTecnico.trim().toLowerCase()
  const today = formatLocalIsoDate(new Date())
  const isHistoryView = fecha < today

  const { data: tecnicos = [], isLoading: loadingTecnicos } = useTecnicosQuery()
  const { data: inventario = [], isLoading: loadingInventario } = useInventarioQuery()
  const { data: inventarioTecnico = [], isLoading } = useInventarioTecnicoQuery(
    fecha,
    selectedTecnicoId || undefined,
    {
      enabled: Boolean(selectedTecnicoId),
      includeHistory: isHistoryView,
    },
  )
  const { mutate: guardarAsignacion, isPending: isSaving } = useGuardarInventarioTecnicoMutation()
  const { mutate: eliminarAsignacion, isPending: isDeleting } = useEliminarInventarioTecnicoMutation()

  const isMutating = isSaving || isDeleting
  const isRowsLoading = loadingInventario || (Boolean(selectedTecnicoId) && isLoading)
  const isPageLoading = loadingTecnicos || loadingInventario

  const tecnicosFiltrados = useMemo(() => {
    return tecnicos.filter((tecnico) => {
      if (!normalizedSearchTecnico) return true

      return includesNormalized(tecnico.nombre, normalizedSearchTecnico)
        || includesNormalized(tecnico.correo, normalizedSearchTecnico)
    })
  }, [normalizedSearchTecnico, tecnicos])

  useEffect(() => {
    if (tecnicosFiltrados.length === 0) {
      setSelectedTecnicoId('')
      return
    }

    const selectedExists = tecnicosFiltrados.some((tecnico) => tecnico.id === selectedTecnicoId)

    if (!selectedExists) {
      setSelectedTecnicoId(tecnicosFiltrados[0].id)
    }
  }, [selectedTecnicoId, tecnicosFiltrados])

  useEffect(() => {
    setCantidadesEditables({})
    setRowToDelete(null)
  }, [fecha, selectedTecnicoId])

  const tecnicoSeleccionado = useMemo(() => {
    return tecnicos.find((tecnico) => tecnico.id === selectedTecnicoId) ?? null
  }, [selectedTecnicoId, tecnicos])

  const rowsTecnicoSeleccionado = useMemo(() => {
    return sortByItemName(inventarioTecnico)
  }, [inventarioTecnico])

  const rowByInventarioId = useMemo(() => {
    const grouped = new Map<number, InventarioTecnico>()
    for (const row of rowsTecnicoSeleccionado) {
      grouped.set(row.inventario_id, row)
    }
    return grouped
  }, [rowsTecnicoSeleccionado])

  const inventarioById = useMemo(() => {
    const grouped = new Map<number, (typeof inventario)[number]>()
    for (const item of inventario) {
      grouped.set(item.id, item)
    }
    return grouped
  }, [inventario])

  const piezasTotalSeleccionadas = useMemo(() => {
    return rowsTecnicoSeleccionado.reduce((acc, row) => acc + getDisplayedCantidad(row, isHistoryView), 0)
  }, [isHistoryView, rowsTecnicoSeleccionado])

  const selectedInventarioItem = useMemo(() => {
    const parsedInventarioId = Number(nuevoInventarioId)
    if (!Number.isInteger(parsedInventarioId)) return null
    return inventarioById.get(parsedInventarioId) ?? null
  }, [inventarioById, nuevoInventarioId])

  const selectedInventarioMaxCantidad = selectedInventarioItem
    ? Math.max(0, Number(selectedInventarioItem.stock_actual ?? 0))
    : null
  const canAgregarRefaccion = !isMutating
    && Boolean(selectedTecnicoId)
    && Boolean(selectedInventarioItem)
    && selectedInventarioMaxCantidad !== null
    && selectedInventarioMaxCantidad > 0
    && parsePositiveInt(nuevoCantidad) !== null

  const getAvailableStock = (inventarioId: number): number => {
    return Math.max(0, Number(inventarioById.get(inventarioId)?.stock_actual ?? 0))
  }

  const getMaxCantidadForRow = (row: InventarioTecnico): number => {
    return Number(row.cantidad ?? 0) + getAvailableStock(row.inventario_id)
  }

  const validateStockDisponibilidad = (inventarioId: number, nextCantidad: number, previousCantidad: number) => {
    const item = inventarioById.get(inventarioId)
    if (!item) {
      toast({
        title: 'Refaccion no disponible',
        description: 'No se encontró la refacción en el inventario local.',
        variant: 'destructive',
      })
      return false
    }

    const deltaCantidad = nextCantidad - previousCantidad
    if (deltaCantidad > item.stock_actual) {
      toast({
        title: 'Stock insuficiente',
        description: `${item.nombre} solo tiene ${item.stock_actual} pieza(s) disponibles en inventario.`,
        variant: 'destructive',
      })
      return false
    }

    return true
  }

  const handleAgregarRefaccion = () => {
    if (isHistoryView) {
      toast({
        title: 'Vista histórica',
        description: 'Las fechas pasadas solo se pueden consultar.',
      })
      return
    }

    if (!selectedTecnicoId) {
      toast({
        title: 'Selecciona un tecnico',
        description: 'Primero elige un tecnico en la lista.',
        variant: 'destructive',
      })
      return
    }

    const parsedInventarioId = Number(nuevoInventarioId)
    const parsedCantidad = parsePositiveInt(nuevoCantidad)

    if (!Number.isInteger(parsedInventarioId) || parsedInventarioId < 1) {
      toast({
        title: 'Refaccion invalida',
        description: 'Selecciona una refaccion valida.',
        variant: 'destructive',
      })
      return
    }

    if (!parsedCantidad) {
      toast({
        title: 'Cantidad invalida',
        description: 'La cantidad debe ser mayor a 0.',
        variant: 'destructive',
      })
      return
    }

    const existingRow = rowByInventarioId.get(parsedInventarioId)
    const maxCantidadAgregar = getAvailableStock(parsedInventarioId)
    if (maxCantidadAgregar <= 0) {
      setNuevoCantidad('0')
      toast({
        title: 'Stock insuficiente',
        description: 'No hay piezas disponibles en inventario.',
        variant: 'destructive',
      })
      return
    }

    const cantidadAgregar = Math.min(parsedCantidad, maxCantidadAgregar)
    if (cantidadAgregar !== parsedCantidad) {
      setNuevoCantidad(String(cantidadAgregar))
    }

    const nextCantidad = (existingRow?.cantidad ?? 0) + cantidadAgregar
    if (!validateStockDisponibilidad(parsedInventarioId, nextCantidad, existingRow?.cantidad ?? 0)) {
      return
    }

    guardarAsignacion(
      {
        tecnico_id: selectedTecnicoId,
        inventario_id: parsedInventarioId,
        cantidad: nextCantidad,
        fecha,
      },
      {
        onSuccess: () => {
          const itemNombre = inventario.find((item) => item.id === parsedInventarioId)?.nombre ?? `Item ${parsedInventarioId}`

          toast({
            title: existingRow ? 'Cantidad actualizada' : 'Refaccion agregada',
            description: `${tecnicoSeleccionado?.nombre ?? 'Tecnico'} ahora tiene ${nextCantidad} de ${itemNombre}.`,
          })

          setNuevoInventarioId('')
          setNuevoCantidad('1')
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'No se pudo guardar el inventario tecnico.'
          toast({
            title: 'Error al guardar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleGuardarCantidad = (row: InventarioTecnico) => {
    if (isHistoryView) {
      toast({
        title: 'Vista histórica',
        description: 'Las fechas pasadas solo se pueden consultar.',
      })
      return
    }

    const editableValue = cantidadesEditables[row.id] ?? String(row.cantidad)
    const maxCantidad = getMaxCantidadForRow(row)
    const clampedCantidad = clampCantidadInput(editableValue, maxCantidad)
    const parsedCantidad = parsePositiveInt(clampedCantidad)

    if (!parsedCantidad) {
      toast({
        title: 'Cantidad invalida',
        description: 'La cantidad debe ser mayor a 0.',
        variant: 'destructive',
      })
      return
    }

    if (clampedCantidad !== editableValue) {
      setCantidadesEditables((previous) => ({
        ...previous,
        [row.id]: clampedCantidad,
      }))
    }

    if (!validateStockDisponibilidad(row.inventario_id, parsedCantidad, row.cantidad)) {
      return
    }

    guardarAsignacion(
      {
        tecnico_id: row.tecnico_id,
        inventario_id: row.inventario_id,
        cantidad: parsedCantidad,
        fecha,
      },
      {
        onSuccess: () => {
          setCantidadesEditables((previous) => {
            const next = { ...previous }
            delete next[row.id]
            return next
          })

          toast({
            title: 'Cantidad actualizada',
            description: `Se actualizo a ${parsedCantidad} para ${row.item?.nombre ?? `Item ${row.inventario_id}`}.`,
          })
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'No se pudo actualizar la cantidad.'
          toast({
            title: 'Error al actualizar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleSubirUnaPieza = (row: InventarioTecnico) => {
    if (isHistoryView) {
      toast({
        title: 'Vista histórica',
        description: 'Las fechas pasadas solo se pueden consultar.',
      })
      return
    }

    const maxCantidad = getMaxCantidadForRow(row)
    const nextCantidad = Math.min(row.cantidad + 1, maxCantidad)
    if (nextCantidad === row.cantidad) {
      return
    }

    if (!validateStockDisponibilidad(row.inventario_id, nextCantidad, row.cantidad)) {
      return
    }

    guardarAsignacion(
      {
        tecnico_id: row.tecnico_id,
        inventario_id: row.inventario_id,
        cantidad: nextCantidad,
        fecha,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Cantidad incrementada',
            description: `${row.item?.nombre ?? `Item ${row.inventario_id}`} ahora tiene ${nextCantidad}.`,
          })
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'No se pudo incrementar la cantidad.'
          toast({
            title: 'Error al incrementar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleConfirmarEliminar = () => {
    if (!rowToDelete) return

    if (isHistoryView) {
      setRowToDelete(null)
      toast({
        title: 'Vista histórica',
        description: 'Las fechas pasadas solo se pueden consultar.',
      })
      return
    }

    const target = rowToDelete

    eliminarAsignacion(
      { id: target.id },
      {
        onSuccess: (deleted) => {
          setRowToDelete(null)
          setCantidadesEditables((previous) => {
            const next = { ...previous }
            delete next[target.id]
            return next
          })

          toast({
            title: 'Refaccion eliminada del tecnico',
            description: `Se elimino ${deleted.itemNombre} de ${deleted.tecnicoNombre}.`,
          })
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'No se pudo eliminar la refaccion.'
          toast({
            title: 'Error al eliminar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Inventario por tecnico</h1>
        <p className="mt-1 text-lg text-ran-slate">Selecciona un tecnico para ver y editar sus refacciones del dia.</p>
      </div>

      <InventarioSubNav />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Fecha de inventario</Label>
              <DatePickerInput value={fecha} onChange={(value) => setFecha(value ?? formatLocalIsoDate(new Date()))} />
            </div>

            <div className="space-y-1.5">
              <Label>Buscar tecnico</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                <Input
                  value={searchTecnico}
                  onChange={(event) => setSearchTecnico(event.target.value)}
                  placeholder="Nombre o correo..."
                  className="h-10 rounded-xl border-slate-200 pl-10"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {loadingTecnicos ? (
              <AdminCardListSkeleton count={5} />
            ) : tecnicosFiltrados.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-ran-slate">
                No hay tecnicos con ese filtro.
              </p>
            ) : (
              tecnicosFiltrados.map((tecnico) => {
                const isSelected = tecnico.id === selectedTecnicoId

                return (
                  <button
                    key={tecnico.id}
                    type="button"
                    className={cn(
                      'w-full rounded-xl border px-3 py-2 text-left transition-colors',
                      isSelected
                        ? 'border-ran-navy/25 bg-ran-ice/70'
                        : 'border-slate-200 bg-white hover:bg-ran-ice/35',
                    )}
                    onClick={() => setSelectedTecnicoId(tecnico.id)}
                  >
                    <p className="truncate text-sm font-semibold text-ran-navy">{tecnico.nombre}</p>
                    <p className="truncate text-xs text-ran-slate">{tecnico.correo}</p>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {!tecnicoSeleccionado ? (
            isPageLoading ? (
              <AdminCardListSkeleton count={4} />
            ) : (
              <EmptyState
                title="Selecciona un tecnico"
                description="Elige un tecnico de la lista para administrar sus refacciones."
              />
            )
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-lg font-bold text-ran-navy">
                    <UserRound className="h-4 w-4" />
                    {tecnicoSeleccionado.nombre}
                  </p>
                  <p className="text-sm text-ran-slate">{tecnicoSeleccionado.correo}</p>
                  <p className="text-xs text-ran-slate">
                    Fecha: {formatDate(fecha)}
                    {isHistoryView ? ' · Historial de solo lectura' : ''}
                  </p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">
                    {isHistoryView ? 'Piezas tomadas' : 'Piezas asignadas'}
                  </p>
                  <p className="text-xl font-bold text-ran-navy">{piezasTotalSeleccionadas}</p>
                </div>
              </div>

              {isHistoryView ? (
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-sm font-semibold text-ran-navy">Historial del inventario técnico</p>
                  <p className="mt-0.5 text-xs text-ran-slate">
                    Esta vista conserva lo que el técnico tomó ese día, incluso si después se devolvió automáticamente o se consumió en servicios.
                  </p>
                </div>
              ) : (
                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-ran-navy">Agregar refaccion</p>
                  <p className="mt-0.5 text-xs text-ran-slate">Si la refaccion ya existe, se suma a la cantidad actual.</p>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
                    <Select
                      key={nuevoInventarioId === '' ? 'inventario-empty' : `inventario-${nuevoInventarioId}`}
                      value={nuevoInventarioId || undefined}
                      onValueChange={(value) => {
                        const item = inventarioById.get(Number(value))
                        const maxCantidad = Math.max(0, Number(item?.stock_actual ?? 0))
                        setNuevoInventarioId(value)
                        setNuevoCantidad((current) => clampCantidadInput(current, maxCantidad))
                      }}
                    >
                      <SelectTrigger className="h-10 rounded-xl bg-white">
                        <SelectValue placeholder="Seleccionar refaccion" />
                      </SelectTrigger>
                      <SelectContent>
                        {inventario.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.nombre} · Stock: {item.stock_actual}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      type="number"
                      min={selectedInventarioMaxCantidad === 0 ? 0 : 1}
                      max={selectedInventarioMaxCantidad ?? undefined}
                      step={1}
                      value={nuevoCantidad}
                      onChange={(event) => {
                        const maxCantidad = selectedInventarioMaxCantidad ?? Number.MAX_SAFE_INTEGER
                        setNuevoCantidad(clampCantidadInput(event.target.value, maxCantidad))
                      }}
                      className="h-10 rounded-xl bg-white"
                    />

                    <Button
                      type="button"
                      className="h-10 rounded-xl bg-ran-navy px-4 hover:bg-ran-navy/90"
                      onClick={handleAgregarRefaccion}
                      disabled={!canAgregarRefaccion}
                    >
                      <Plus className="h-4 w-4" />
                      Agregar
                    </Button>
                  </div>
                </div>
              )}

              {isRowsLoading ? (
                <AdminCardListSkeleton count={4} />
              ) : rowsTecnicoSeleccionado.length === 0 ? (
                <EmptyState
                  title={isHistoryView ? 'Sin historial de refacciones' : 'Sin refacciones asignadas'}
                  description={isHistoryView
                    ? 'Este tecnico no tiene movimientos de inventario técnico registrados para la fecha seleccionada.'
                    : 'Este tecnico no tiene refacciones registradas para la fecha seleccionada.'}
                />
              ) : (
                <div className="space-y-2">
                  {rowsTecnicoSeleccionado.map((row) => {
                    const cantidadMostrada = getDisplayedCantidad(row, isHistoryView)
                    const maxCantidad = getMaxCantidadForRow(row)
                    const editableCantidad = parsePositiveInt(cantidadesEditables[row.id] ?? String(row.cantidad))
                      ?? Number(row.cantidad ?? 1)

                    return (
                      <article
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ran-navy">
                            {row.item?.nombre ?? `Item ${row.inventario_id}`}
                          </p>
                          <p className="truncate text-xs text-ran-slate">
                            {row.item?.descripcion ?? 'Sin descripcion'}
                          </p>
                          {isHistoryView ? (
                            <p className="mt-1 text-xs text-ran-slate">
                              {getHistoryStatus(row)}
                            </p>
                          ) : null}
                        </div>

                        {isHistoryView ? (
                          <div className="ml-auto text-right">
                            <p className="text-lg font-bold text-ran-navy">{cantidadMostrada}</p>
                            <p className="text-xs text-ran-slate">tomadas ese día</p>
                            {Number(row.cantidad ?? 0) > 0 ? (
                              <p className="mt-1 text-xs text-ran-slate">
                                Restantes al cierre: {row.cantidad}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <div className="ml-auto flex items-center gap-2">
                            <Input
                              type="number"
                              min={1}
                              max={maxCantidad}
                              step={1}
                              value={cantidadesEditables[row.id] ?? String(row.cantidad)}
                              onChange={(event) => {
                                const nextValue = clampCantidadInput(event.target.value, maxCantidad)
                                setCantidadesEditables((previous) => ({
                                  ...previous,
                                  [row.id]: nextValue,
                                }))
                              }}
                              className="h-9 w-24 rounded-lg"
                            />

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-lg"
                              onClick={() => handleGuardarCantidad(row)}
                              disabled={isMutating}
                            >
                              <Save className="h-4 w-4" />
                              Guardar
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-lg"
                              onClick={() => handleSubirUnaPieza(row)}
                              disabled={isMutating || editableCantidad >= maxCantidad}
                            >
                              +1
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-9 rounded-lg border-red-200 text-ran-red hover:bg-red-50 hover:text-ran-red"
                              onClick={() => setRowToDelete(row)}
                              disabled={isMutating}
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </Button>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(rowToDelete)}
        onOpenChange={(open) => {
          if (!open) setRowToDelete(null)
        }}
        title="Eliminar refaccion del tecnico"
        description={rowToDelete
          ? `Se devolvera ${rowToDelete.cantidad} de ${rowToDelete.item?.nombre ?? `Item ${rowToDelete.inventario_id}`} al inventario general.`
          : 'Confirma para eliminar la refaccion seleccionada.'}
        confirmLabel="Eliminar"
        variant="destructive"
        onConfirm={handleConfirmarEliminar}
        isLoading={isDeleting}
      />
    </div>
  )
}
