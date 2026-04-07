import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Search, Trash2, UserRound } from 'lucide-react'
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

function sortByItemName(rows: InventarioTecnico[]): InventarioTecnico[] {
  return [...rows].sort((a, b) => {
    const left = a.item?.nombre ?? `Item ${a.inventario_id}`
    const right = b.item?.nombre ?? `Item ${b.inventario_id}`
    return left.localeCompare(right)
  })
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

  const { data: tecnicos = [] } = useTecnicosQuery()
  const { data: inventario = [] } = useInventarioQuery()
  const { data: inventarioTecnico = [], isLoading } = useInventarioTecnicoQuery(
    fecha,
    selectedTecnicoId || undefined,
    { enabled: Boolean(selectedTecnicoId) },
  )
  const { mutate: guardarAsignacion, isPending: isSaving } = useGuardarInventarioTecnicoMutation()
  const { mutate: eliminarAsignacion, isPending: isDeleting } = useEliminarInventarioTecnicoMutation()

  const isMutating = isSaving || isDeleting

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

  const piezasTotalSeleccionadas = useMemo(() => {
    return rowsTecnicoSeleccionado.reduce((acc, row) => acc + row.cantidad, 0)
  }, [rowsTecnicoSeleccionado])

  const handleAgregarRefaccion = () => {
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
    const nextCantidad = (existingRow?.cantidad ?? 0) + parsedCantidad

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
    const editableValue = cantidadesEditables[row.id] ?? String(row.cantidad)
    const parsedCantidad = parsePositiveInt(editableValue)

    if (!parsedCantidad) {
      toast({
        title: 'Cantidad invalida',
        description: 'La cantidad debe ser mayor a 0.',
        variant: 'destructive',
      })
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
    guardarAsignacion(
      {
        tecnico_id: row.tecnico_id,
        inventario_id: row.inventario_id,
        cantidad: row.cantidad + 1,
        fecha,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Cantidad incrementada',
            description: `${row.item?.nombre ?? `Item ${row.inventario_id}`} ahora tiene ${row.cantidad + 1}.`,
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
            {tecnicosFiltrados.length === 0 ? (
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
            <EmptyState
              title="Selecciona un tecnico"
              description="Elige un tecnico de la lista para administrar sus refacciones."
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-lg font-bold text-ran-navy">
                    <UserRound className="h-4 w-4" />
                    {tecnicoSeleccionado.nombre}
                  </p>
                  <p className="text-sm text-ran-slate">{tecnicoSeleccionado.correo}</p>
                  <p className="text-xs text-ran-slate">Fecha: {formatDate(fecha)}</p>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">Piezas asignadas</p>
                  <p className="text-xl font-bold text-ran-navy">{piezasTotalSeleccionadas}</p>
                </div>
              </div>

              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-ran-navy">Agregar refaccion</p>
                <p className="mt-0.5 text-xs text-ran-slate">Si la refaccion ya existe, se suma a la cantidad actual.</p>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
                  <Select value={nuevoInventarioId || undefined} onValueChange={setNuevoInventarioId}>
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
                    min={1}
                    step={1}
                    value={nuevoCantidad}
                    onChange={(event) => setNuevoCantidad(event.target.value)}
                    className="h-10 rounded-xl bg-white"
                  />

                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-ran-navy px-4 hover:bg-ran-navy/90"
                    onClick={handleAgregarRefaccion}
                    disabled={isMutating}
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </Button>
                </div>
              </div>

              {isLoading ? (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-ran-slate">
                  Cargando refacciones del tecnico...
                </p>
              ) : rowsTecnicoSeleccionado.length === 0 ? (
                <EmptyState
                  title="Sin refacciones asignadas"
                  description="Este tecnico no tiene refacciones registradas para la fecha seleccionada."
                />
              ) : (
                <div className="space-y-2">
                  {rowsTecnicoSeleccionado.map((row) => (
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
                      </div>

                      <div className="ml-auto flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          value={cantidadesEditables[row.id] ?? String(row.cantidad)}
                          onChange={(event) => {
                            const nextValue = event.target.value
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
                          disabled={isMutating}
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
                    </article>
                  ))}
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
