import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  History,
  Minus,
  PackageCheck,
  PackagePlus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Warehouse,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { EmptyState } from '@/components/shared/EmptyState'
import { TecnicoInventarioSkeleton } from '@/components/shared/TecnicoSkeletons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/use-auth'
import {
  useEliminarInventarioTecnicoMutation,
  useInventarioQuery,
  useInventarioTecnicoQuery,
  useGuardarInventarioTecnicoMutation,
} from '@/hooks/use-inventario'
import { getInventarioTecnicoAssignedTotal, isInventarioTecnicoReturned } from '@/lib/inventario-tecnico'
import { useToast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/offline/network'
import { cn, formatDate, formatLocalIsoDate } from '@/lib/utils'
import type { InventarioTecnico } from '@/types/domain.types'

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

export function TecnicoInventarioPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toast } = useToast()

  const [fecha, setFecha] = useState(formatLocalIsoDate())
  const [search, setSearch] = useState('')
  const [nuevoInventarioId, setNuevoInventarioId] = useState('')
  const [nuevoCantidad, setNuevoCantidad] = useState('1')
  const [cantidadesEditables, setCantidadesEditables] = useState<Record<number, string>>({})
  const [rowToDelete, setRowToDelete] = useState<InventarioTecnico | null>(null)
  const today = formatLocalIsoDate()
  const isHistoryView = fecha < today

  const { data: inventarioGeneral = [], isLoading: loadingInventarioGeneral } = useInventarioQuery()
  const { data: inventarioTecnico = [], isLoading: loadingInventarioTecnico } = useInventarioTecnicoQuery(fecha, user?.id, {
    enabled: Boolean(user?.id),
    includeHistory: isHistoryView,
  })
  const { mutate: guardarAsignacion, isPending: isSaving } = useGuardarInventarioTecnicoMutation()
  const { mutate: eliminarAsignacion, isPending: isDeleting } = useEliminarInventarioTecnicoMutation()

  const isMutating = isSaving || isDeleting
  const normalizedSearch = search.trim().toLowerCase()

  const inventarioTecnicoOrdenado = useMemo(() => {
    return sortByItemName(inventarioTecnico)
  }, [inventarioTecnico])

  const rowByInventarioId = useMemo(() => {
    const grouped = new Map<number, InventarioTecnico>()
    inventarioTecnicoOrdenado.forEach((row) => {
      grouped.set(row.inventario_id, row)
    })
    return grouped
  }, [inventarioTecnicoOrdenado])

  const inventarioById = useMemo(() => {
    const grouped = new Map<number, (typeof inventarioGeneral)[number]>()
    inventarioGeneral.forEach((item) => {
      grouped.set(item.id, item)
    })
    return grouped
  }, [inventarioGeneral])

  const filteredItems = useMemo(() => {
    if (!normalizedSearch) return inventarioTecnicoOrdenado

    return inventarioTecnicoOrdenado.filter((row) => {
      return [
        row.item?.nombre ?? '',
        row.item?.descripcion ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [inventarioTecnicoOrdenado, normalizedSearch])

  const totalPiezas = useMemo(() => (
    inventarioTecnicoOrdenado.reduce((acc, row) => acc + getDisplayedCantidad(row, isHistoryView), 0)
  ), [inventarioTecnicoOrdenado, isHistoryView])

  const catalogoDisponible = useMemo(() => {
    return [...inventarioGeneral].sort((left, right) => left.nombre.localeCompare(right.nombre))
  }, [inventarioGeneral])

  const selectedInventarioItem = useMemo(() => {
    const parsedInventarioId = Number(nuevoInventarioId)
    if (!Number.isInteger(parsedInventarioId)) return null
    return inventarioById.get(parsedInventarioId) ?? null
  }, [inventarioById, nuevoInventarioId])

  const selectedInventarioMaxCantidad = selectedInventarioItem
    ? Math.max(0, Number(selectedInventarioItem.stock_actual ?? 0))
    : null
  const canAgregarRefaccion = !isMutating
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

  const setEditableCantidad = (row: InventarioTecnico, cantidad: number) => {
    const maxCantidad = getMaxCantidadForRow(row)
    setCantidadesEditables((previous) => ({
      ...previous,
      [row.id]: String(Math.min(Math.max(1, cantidad), maxCantidad)),
    }))
  }

  const getEditableCantidad = (row: InventarioTecnico): number => {
    return parsePositiveInt(cantidadesEditables[row.id] ?? String(row.cantidad)) ?? Number(row.cantidad ?? 1)
  }

  const validateStockDisponibilidad = (inventarioId: number, nextCantidad: number, previousCantidad: number) => {
    const item = inventarioById.get(inventarioId)
    if (!item) {
      toast({
        title: 'Refacción no disponible',
        description: 'No se encontró la refacción en el inventario general.',
        variant: 'destructive',
      })
      return false
    }

    const deltaCantidad = nextCantidad - previousCantidad
    if (deltaCantidad > Number(item.stock_actual ?? 0)) {
      toast({
        title: 'Stock insuficiente',
        description: `${item.nombre} solo tiene ${item.stock_actual} pieza(s) disponibles en inventario general.`,
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

    if (!user?.id) {
      toast({
        title: 'Sesión no disponible',
        description: 'No se pudo identificar tu usuario.',
        variant: 'destructive',
      })
      return
    }

    const parsedInventarioId = Number(nuevoInventarioId)
    const parsedCantidad = parsePositiveInt(nuevoCantidad)

    if (!Number.isInteger(parsedInventarioId) || parsedInventarioId < 1) {
      toast({
        title: 'Refacción inválida',
        description: 'Selecciona una refacción válida.',
        variant: 'destructive',
      })
      return
    }

    if (!parsedCantidad) {
      toast({
        title: 'Cantidad inválida',
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
        description: 'No hay piezas disponibles en inventario general.',
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
        tecnico_id: user.id,
        inventario_id: parsedInventarioId,
        cantidad: nextCantidad,
        fecha,
      },
      {
        onSuccess: () => {
          const itemNombre = inventarioById.get(parsedInventarioId)?.nombre ?? `Item ${parsedInventarioId}`
          toast({
            title: existingRow ? 'Cantidad actualizada' : 'Refacción agregada',
            description: `Ahora tienes ${nextCantidad} de ${itemNombre} en tu inventario del día.`,
          })

          setNuevoInventarioId('')
          setNuevoCantidad('1')
        },
        onError: (error) => {
          const message = getErrorMessage(error, 'No se pudo guardar el inventario técnico.')
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

    if (!user?.id) return

    const editableValue = cantidadesEditables[row.id] ?? String(row.cantidad)
    const maxCantidad = getMaxCantidadForRow(row)
    const clampedCantidad = clampCantidadInput(editableValue, maxCantidad)
    const parsedCantidad = parsePositiveInt(clampedCantidad)

    if (!parsedCantidad) {
      toast({
        title: 'Cantidad inválida',
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
        tecnico_id: user.id,
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
            description: `Se actualizó a ${parsedCantidad} para ${row.item?.nombre ?? `Item ${row.inventario_id}`}.`,
          })
        },
        onError: (error) => {
          const message = getErrorMessage(error, 'No se pudo actualizar la cantidad.')
          toast({
            title: 'Error al actualizar',
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
        onSuccess: () => {
          setRowToDelete(null)
          setCantidadesEditables((previous) => {
            const next = { ...previous }
            delete next[target.id]
            return next
          })

          toast({
            title: 'Refacción devuelta',
            description: `${target.item?.nombre ?? `Item ${target.inventario_id}`} regresó al inventario general.`,
          })
        },
        onError: (error) => {
          const message = getErrorMessage(error, 'No se pudo eliminar la refacción.')
          toast({
            title: 'Error al eliminar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  if (loadingInventarioGeneral || loadingInventarioTecnico) return <TecnicoInventarioSkeleton />

  return (
    <div className="space-y-3 px-3.5 py-4 pb-24">
      <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white shadow-[0_22px_48px_-38px_rgba(15,23,42,0.38)]">
        <div className="bg-[linear-gradient(135deg,#17345f,#2563eb)] px-4 py-4 text-white">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Regresar"
              className="h-10 w-10 shrink-0 cursor-pointer rounded-xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/85">
                  <PackageCheck className="h-3.5 w-3.5" />
                  Inventario
                </span>
                <Badge className="border-white/20 bg-white/20 text-white hover:bg-white/20">
                  {isHistoryView ? 'Historial' : 'Activo'}
                </Badge>
              </div>
              <h1 className="mt-2 text-xl font-extrabold leading-tight">
                {isHistoryView ? 'Historial' : 'Mi inventario'}
              </h1>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2.5 backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">Items</p>
              <p className="mt-1 text-xl font-extrabold leading-none text-white">{inventarioTecnicoOrdenado.length}</p>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 px-3 py-2.5 backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
                {isHistoryView ? 'Tomadas' : 'Piezas'}
              </p>
              <p className="mt-1 text-xl font-extrabold leading-none text-white">{totalPiezas}</p>
            </div>
          </div>
        </div>

        <div className="p-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
            <div className="mb-2 flex items-center gap-2 px-1 text-xs font-bold text-slate-600">
              <CalendarDays className="h-4 w-4 text-ran-blue" />
              <span>{formatDate(fecha)}</span>
            </div>
            <DatePickerInput value={fecha} onChange={(value) => setFecha(value ?? formatLocalIsoDate())} />
          </div>
        </div>
      </section>

      {isHistoryView ? (
        <section className="flex items-center justify-between gap-3 rounded-[22px] border border-slate-200 bg-white px-3.5 py-3 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.3)]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
              <History className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-ran-navy">Solo lectura</p>
              <p className="truncate text-xs font-medium text-ran-slate">{formatDate(fecha)}</p>
            </div>
          </div>
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            Histórico
          </Badge>
        </section>
      ) : (
        <section className="rounded-[24px] border border-slate-200 bg-white p-3.5 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.3)]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ran-ice text-ran-navy">
                <PackagePlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-extrabold text-ran-navy">Refacción nueva</p>
                <p className="truncate text-xs font-medium text-ran-slate">
                  {selectedInventarioItem?.nombre ?? 'Inventario general'}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                'shrink-0 border-slate-200 bg-slate-50 text-slate-700',
                selectedInventarioItem && 'border-emerald-200 bg-emerald-50 text-emerald-800',
              )}
            >
              {selectedInventarioItem ? `Stock ${selectedInventarioItem.stock_actual}` : 'Stock'}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_88px] gap-2">
            <label htmlFor="tecnico-inventario-refaccion" className="sr-only">Refacción</label>
            <Select
              key={nuevoInventarioId === '' ? 'inventario-empty' : `inventario-${nuevoInventarioId}`}
              name="inventario_general_id"
              value={nuevoInventarioId || undefined}
              onValueChange={(value) => {
                const item = inventarioById.get(Number(value))
                const maxCantidad = Math.max(0, Number(item?.stock_actual ?? 0))
                setNuevoInventarioId(value)
                setNuevoCantidad((current) => clampCantidadInput(current, maxCantidad))
              }}
            >
              <SelectTrigger
                id="tecnico-inventario-refaccion"
                className="h-11 rounded-xl border-slate-200 bg-white text-[13px] font-semibold"
              >
                <SelectValue placeholder="Refacción" />
              </SelectTrigger>
              <SelectContent>
                {catalogoDisponible.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.nombre} · Stock: {item.stock_actual}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label htmlFor="tecnico-inventario-cantidad" className="sr-only">Cantidad</label>
            <Input
              id="tecnico-inventario-cantidad"
              name="tecnico_inventario_cantidad"
              type="number"
              min={selectedInventarioMaxCantidad === 0 ? 0 : 1}
              max={selectedInventarioMaxCantidad ?? undefined}
              step={1}
              value={nuevoCantidad}
              onChange={(event) => {
                const maxCantidad = selectedInventarioMaxCantidad ?? Number.MAX_SAFE_INTEGER
                setNuevoCantidad(clampCantidadInput(event.target.value, maxCantidad))
              }}
              className="h-11 rounded-xl border-slate-200 bg-white text-center text-sm font-extrabold"
            />
          </div>

          <Button
            type="button"
            className="mt-2 h-11 w-full cursor-pointer rounded-xl bg-ran-navy text-sm font-extrabold hover:bg-ran-navy/90"
            onClick={handleAgregarRefaccion}
            disabled={!canAgregarRefaccion}
          >
            <PackagePlus className="h-4 w-4" />
            Tomar
          </Button>
        </section>
      )}

      <section className="rounded-[24px] border border-slate-200 bg-white p-3.5 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.24)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-ran-navy">Refacciones</p>
            <p className="truncate text-xs font-medium text-ran-slate">{formatDate(fecha)}</p>
          </div>
          <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
            {filteredItems.length}/{inventarioTecnicoOrdenado.length}
          </Badge>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
          <Input
            id="tecnico-inventario-busqueda"
            name="tecnico_inventario_busqueda"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar refacción"
            className="h-10 rounded-xl border-slate-200 pl-10 text-[13px] font-medium"
          />
        </div>
      </section>

      {filteredItems.length === 0 ? (
        <EmptyState
          title={isHistoryView ? 'Sin historial de inventario' : 'Sin inventario asignado'}
          description={isHistoryView
            ? `No hay movimientos de inventario técnico registrados para ${formatDate(fecha)}.`
            : `No tienes piezas asignadas para ${formatDate(fecha)}.`}
        />
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((row) => {
            const cantidadMostrada = getDisplayedCantidad(row, isHistoryView)
            const editableCantidad = getEditableCantidad(row)
            const maxCantidad = getMaxCantidadForRow(row)

            return (
              <article
                key={row.id}
                className="rounded-[22px] border border-slate-200 bg-white p-3.5 shadow-[0_14px_32px_-30px_rgba(15,23,42,0.24)] transition-colors duration-200"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ran-ice text-ran-navy">
                    <PackageCheck className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-ran-navy">
                          {row.item?.nombre ?? `Item ${row.inventario_id}`}
                        </p>
                        {row.item?.descripcion && (
                          <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-snug text-ran-slate">
                            {row.item.descripcion}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 rounded-2xl border border-ran-navy/10 bg-ran-ice px-3 py-1.5 text-center">
                        <p className="text-lg font-extrabold leading-none text-ran-navy">{cantidadMostrada}</p>
                        <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ran-slate">
                          {isHistoryView ? 'Tomadas' : 'Ruta'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="gap-1 border-slate-200 bg-slate-50 text-slate-700">
                        <CalendarDays className="h-3 w-3" />
                        {formatDate(row.fecha)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn(
                          'gap-1',
                          isHistoryView
                            ? 'border-slate-200 bg-slate-50 text-slate-700'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800',
                        )}
                      >
                        {isHistoryView ? <History className="h-3 w-3" /> : <Warehouse className="h-3 w-3" />}
                        {isHistoryView ? 'Historial' : 'Activo'}
                      </Badge>
                    </div>
                  </div>
                </div>

                {isHistoryView ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-600">
                    {getHistoryStatus(row)}
                    {Number(row.cantidad ?? 0) > 0 ? (
                      <span className="ml-1 font-bold text-ran-navy">Restantes: {row.cantidad}</span>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <div className="flex h-10 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Reducir cantidad"
                        className="h-full w-10 shrink-0 cursor-pointer rounded-none text-ran-slate hover:bg-slate-50"
                        onClick={() => setEditableCantidad(row, editableCantidad - 1)}
                        disabled={isMutating || editableCantidad <= 1}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <label htmlFor={`tecnico-inventario-row-${row.id}`} className="sr-only">Cantidad</label>
                      <Input
                        id={`tecnico-inventario-row-${row.id}`}
                        name={`tecnico_inventario_row_${row.id}`}
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
                        className="h-full min-w-0 flex-1 rounded-none border-x border-y-0 px-1 text-center text-sm font-extrabold focus-visible:ring-0 focus-visible:ring-offset-0"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Aumentar cantidad"
                        className="h-full w-10 shrink-0 cursor-pointer rounded-none text-ran-navy hover:bg-slate-50"
                        onClick={() => setEditableCantidad(row, editableCantidad + 1)}
                        disabled={isMutating || editableCantidad >= maxCantidad}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      className="h-10 cursor-pointer rounded-xl bg-ran-navy px-3 font-extrabold hover:bg-ran-navy/90"
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
                      className="col-span-2 h-10 cursor-pointer rounded-xl border-red-200 bg-red-50/60 font-bold text-ran-red hover:bg-red-50 hover:text-ran-red"
                      onClick={() => setRowToDelete(row)}
                      disabled={isMutating}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Devolver
                    </Button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(rowToDelete)}
        onOpenChange={(open) => {
          if (!open) setRowToDelete(null)
        }}
        title="Devolver refacción"
        description={rowToDelete
          ? `Se devolverá ${rowToDelete.cantidad} de ${rowToDelete.item?.nombre ?? `Item ${rowToDelete.inventario_id}`} al inventario general.`
          : 'Confirma para devolver la refacción seleccionada.'}
        confirmLabel="Devolver"
        variant="destructive"
        onConfirm={handleConfirmarEliminar}
        isLoading={isDeleting}
      />
    </div>
  )
}
