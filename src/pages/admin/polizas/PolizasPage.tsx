import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  MoreVertical,
  Power,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import {
  usePolizasQuery,
  usePolizaEstadoHistorialQuery,
  useDesactivarPolizaMutation,
  useActivarPolizaMutation,
  useEliminarPolizaMutation,
} from '@/hooks/use-polizas'
import { useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { formatDate } from '@/lib/utils'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { MantenimientoStatusBadge } from '@/components/shared/StatusBadge'
import type { MantenimientoStatus, Poliza, PolizaEstado, PolizaEstadoHistorial } from '@/types/domain.types'
import { PolizasSubNav } from './PolizasSubNav'

const PAGE_SIZE = 10
const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

type DateFilterMode = 'none' | 'single' | 'range'
type PolizaEstadoFilter = 'all' | 'activa' | 'inactiva'

interface MonthCursor {
  year: number
  month: number
}

interface MonthlyCoverageSummary {
  status: MantenimientoStatus
  registros: number
}

const MAINTENIMIENTO_STATUS_PRIORITY: Record<MantenimientoStatus, number> = {
  pendiente: 1,
  en_ruta: 2,
  realizado: 3,
}

function parseIsoDateToLocalMidnight(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null

  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

function isWithinDateBounds(fecha: string, desde: string | null, hasta: string | null): boolean {
  if (!desde && !hasta) return true

  const fechaPoliza = parseIsoDateToLocalMidnight(fecha)
  if (!fechaPoliza) return false

  if (desde) {
    const fechaDesde = parseIsoDateToLocalMidnight(desde)
    if (fechaDesde && fechaPoliza < fechaDesde) return false
  }

  if (hasta) {
    const fechaHasta = parseIsoDateToLocalMidnight(hasta)
    if (fechaHasta && fechaPoliza > fechaHasta) return false
  }

  return true
}

function isDateInMonthWindow(fechaIso: string | null, year: number, month: number): boolean {
  if (!fechaIso) return false

  const fecha = parseIsoDateToLocalMidnight(fechaIso)
  if (!fecha) return false

  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 1)
  return fecha >= start && fecha < end
}

function moveMonth(cursor: MonthCursor, delta: number): MonthCursor {
  const next = new Date(cursor.year, cursor.month + delta, 1)
  return {
    year: next.getFullYear(),
    month: next.getMonth(),
  }
}

function isPolizaTrackableInMonth(poliza: Poliza, year: number, month: number): boolean {
  const fechaInicio = parseIsoDateToLocalMidnight(poliza.fecha_inicio)
  if (!fechaInicio) return false

  const monthEnd = new Date(year, month + 1, 1)
  return fechaInicio < monthEnd
}

function parseDateTime(value: string): Date | null {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function getPolizaEstadoEnMes(
  poliza: Poliza,
  historial: PolizaEstadoHistorial[],
  year: number,
  month: number,
): PolizaEstado | 'no_aplica' {
  if (!isPolizaTrackableInMonth(poliza, year, month)) return 'no_aplica'

  const monthEndExclusive = new Date(year, month + 1, 1)

  for (let index = historial.length - 1; index >= 0; index -= 1) {
    const eventDate = parseDateTime(historial[index].changed_at)
    if (!eventDate) continue
    if (eventDate < monthEndExclusive) {
      return historial[index].estado
    }
  }

  return poliza.activa ? 'activa' : 'inactiva'
}

function truncateText(text: string, maxLength = 70): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1)}…`
}

export function PolizasPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const now = new Date()
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<PolizaEstadoFilter>('all')
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('none')
  const [fechaDesde, setFechaDesde] = useState<string | null>(null)
  const [fechaHasta, setFechaHasta] = useState<string | null>(null)
  const [monthCursor, setMonthCursor] = useState<MonthCursor>(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }))
  const [page, setPage] = useState(1)
  const [polizaToDelete, setPolizaToDelete] = useState<Poliza | null>(null)

  const { data: polizas = [], isLoading } = usePolizasQuery()
  const { data: polizaEstadoHistorial = [] } = usePolizaEstadoHistorialQuery()
  const { data: mantenimientos = [] } = useMantenimientosQuery()
  const { mutate: desactivarPoliza, isPending: isDeactivating } = useDesactivarPolizaMutation()
  const { mutate: activarPoliza, isPending: isActivating } = useActivarPolizaMutation()
  const { mutate: eliminarPoliza, isPending: isDeleting } = useEliminarPolizaMutation()

  const polizaEstadoHistorialMap = useMemo(() => {
    const byPoliza = new Map<number, PolizaEstadoHistorial[]>()

    for (const event of polizaEstadoHistorial) {
      const previous = byPoliza.get(event.poliza_id) ?? []
      previous.push(event)
      byPoliza.set(event.poliza_id, previous)
    }

    for (const [, events] of byPoliza) {
      events.sort((a, b) => +new Date(a.changed_at) - +new Date(b.changed_at))
    }

    return byPoliza
  }, [polizaEstadoHistorial])

  const filteredPolizas = useMemo(() => {
    const searchText = search.trim().toLowerCase()

    return polizas.filter((poliza) => {
      if (estado === 'activa' && !poliza.activa) return false
      if (estado === 'inactiva' && poliza.activa) return false

      if (!isWithinDateBounds(poliza.fecha_inicio, fechaDesde, fechaHasta)) return false

      if (!searchText) return true

      return [
        poliza.cliente?.codigo_cliente ?? '',
        poliza.cliente?.nombre ?? '',
        poliza.cliente?.direccion ?? '',
        poliza.cliente?.municipio ?? '',
        poliza.maquina?.serie ?? '',
        poliza.maquina?.modelo ?? '',
      ].some((value) => value.toLowerCase().includes(searchText))
    })
  }, [estado, fechaDesde, fechaHasta, polizas, search])

  const mantenimientoMensualPorPoliza = useMemo(() => {
    const monthlyRows = mantenimientos.filter((mantenimiento) =>
      isDateInMonthWindow(mantenimiento.fecha_visita, monthCursor.year, monthCursor.month),
    )

    const byPoliza = new Map<number, MonthlyCoverageSummary>()
    for (const mantenimiento of monthlyRows) {
      const existingSummary = byPoliza.get(mantenimiento.poliza_id)

      if (!existingSummary) {
        byPoliza.set(mantenimiento.poliza_id, {
          status: mantenimiento.status,
          registros: 1,
        })
        continue
      }

      const nextStatus =
        MAINTENIMIENTO_STATUS_PRIORITY[mantenimiento.status] > MAINTENIMIENTO_STATUS_PRIORITY[existingSummary.status]
          ? mantenimiento.status
          : existingSummary.status

      byPoliza.set(mantenimiento.poliza_id, {
        status: nextStatus,
        registros: existingSummary.registros + 1,
      })
    }

    return byPoliza
  }, [mantenimientos, monthCursor.month, monthCursor.year])

  const monthlyStatusCounts = useMemo(() => {
    return filteredPolizas.reduce(
      (acc, poliza) => {
        const estadoEnMes = getPolizaEstadoEnMes(
          poliza,
          polizaEstadoHistorialMap.get(poliza.id) ?? [],
          monthCursor.year,
          monthCursor.month,
        )
        if (estadoEnMes !== 'activa') return acc

        const status = mantenimientoMensualPorPoliza.get(poliza.id)?.status ?? 'pendiente'
        if (status === 'realizado') acc.realizados += 1
        if (status === 'en_ruta') acc.enRuta += 1
        if (status === 'pendiente') acc.pendientes += 1
        return acc
      },
      { pendientes: 0, enRuta: 0, realizados: 0 },
    )
  }, [
    filteredPolizas,
    mantenimientoMensualPorPoliza,
    monthCursor.month,
    monthCursor.year,
    polizaEstadoHistorialMap,
  ])

  const monthlyPolizaStateCounts = useMemo(() => {
    return filteredPolizas.reduce(
      (acc, poliza) => {
        const estadoEnMes = getPolizaEstadoEnMes(
          poliza,
          polizaEstadoHistorialMap.get(poliza.id) ?? [],
          monthCursor.year,
          monthCursor.month,
        )

        if (estadoEnMes === 'activa') acc.activas += 1
        if (estadoEnMes === 'inactiva') acc.inactivas += 1

        return acc
      },
      { activas: 0, inactivas: 0 },
    )
  }, [filteredPolizas, monthCursor.month, monthCursor.year, polizaEstadoHistorialMap])

  const selectedMonthLabel = `${MONTH_LABELS[monthCursor.month]} ${monthCursor.year}`

  useEffect(() => {
    setPage(1)
  }, [dateFilterMode, estado, fechaDesde, fechaHasta, monthCursor.month, monthCursor.year, search])

  const handleDateFilterModeChange = (mode: DateFilterMode) => {
    setDateFilterMode(mode)

    if (mode === 'none') {
      setFechaDesde(null)
      setFechaHasta(null)
      return
    }

    if (mode === 'single') {
      const baseDate = fechaDesde ?? fechaHasta ?? null
      setFechaDesde(baseDate)
      setFechaHasta(baseDate)
      return
    }

    const fromDate = fechaDesde ?? fechaHasta ?? null
    setFechaDesde(fromDate)
    setFechaHasta(fechaHasta ?? null)
  }

  const activeCount = monthlyPolizaStateCounts.activas
  const inactiveCount = monthlyPolizaStateCounts.inactivas

  const totalPages = Math.max(1, Math.ceil(filteredPolizas.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageRows = filteredPolizas.slice(start, end)

  const handleDesactivar = (poliza: Poliza) => {
    if (!poliza.activa) {
      toast({
        title: 'Póliza inactiva',
        description: 'El establecimiento ya está desactivado en póliza.',
      })
      return
    }

    desactivarPoliza(poliza.id, {
      onSuccess: () => {
        toast({
          title: 'Establecimiento desactivado',
          description: `${poliza.cliente?.nombre ?? 'La sucursal'} quedó como inactiva en póliza.`,
        })
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'No se pudo desactivar la póliza.'
        toast({
          title: 'Error al desactivar',
          description: message,
          variant: 'destructive',
        })
      },
    })
  }

  const handleActivar = (poliza: Poliza) => {
    if (poliza.activa) {
      toast({
        title: 'Póliza activa',
        description: 'El establecimiento ya está activo en póliza.',
      })
      return
    }

    activarPoliza(poliza.id, {
      onSuccess: () => {
        toast({
          title: 'Establecimiento reactivado',
          description: `${poliza.cliente?.nombre ?? 'La sucursal'} volvió a activa en póliza.`,
        })
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'No se pudo reactivar la póliza.'
        toast({
          title: 'Error al reactivar',
          description: message,
          variant: 'destructive',
        })
      },
    })
  }

  const handleConfirmEliminar = () => {
    if (!polizaToDelete) return

    eliminarPoliza(polizaToDelete.id, {
      onSuccess: () => {
        toast({
          title: 'Establecimiento eliminado de póliza',
          description: `${polizaToDelete.cliente?.nombre ?? 'La sucursal'} fue eliminada correctamente.`,
        })
        setPolizaToDelete(null)
      },
      onError: (error) => {
        const rawMessage = error instanceof Error ? error.message : 'No se pudo eliminar la póliza.'
        const message = /(foreign key|constraint|reference|referencia)/i.test(rawMessage)
          ? 'No se puede eliminar porque el establecimiento ya tiene mantenimientos registrados.'
          : rawMessage

        toast({
          title: 'Error al eliminar',
          description: message,
          variant: 'destructive',
        })
      },
    })
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Sucursales en póliza</h1>
          <p className="mt-1 text-lg text-ran-slate">{filteredPolizas.length} sucursales registradas en póliza</p>
        </div>
        <Button onClick={() => navigate('/polizas/nueva')} className="h-11 rounded-xl bg-ran-navy px-6 text-base font-semibold hover:bg-ran-navy/90">
          <Plus className="h-4 w-4" />
          Nueva póliza
        </Button>
      </div>

      <PolizasSubNav />

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-ran-navy">Seguimiento mensual de establecimientos</p>
          <p className="text-sm text-ran-slate">Estado de mantenimiento para {selectedMonthLabel}</p>
        </div>
        <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => setMonthCursor((current) => moveMonth(current, -1))}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] px-3 text-center text-sm font-semibold text-ran-navy">{selectedMonthLabel}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => setMonthCursor((current) => moveMonth(current, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-[1.5fr_0.75fr_0.75fr_1.2fr]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por sucursal, código, dirección, serie o modelo..."
            className="h-11 rounded-xl border-slate-200 pl-10"
          />
        </div>

        <Select value={estado} onValueChange={(value) => setEstado(value as PolizaEstadoFilter)}>
          <SelectTrigger className="h-11 rounded-xl border-slate-200">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="activa">Solo activas</SelectItem>
            <SelectItem value="inactiva">Solo inactivas</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dateFilterMode} onValueChange={(value) => handleDateFilterModeChange(value as DateFilterMode)}>
          <SelectTrigger className="h-11 rounded-xl border-slate-200">
            <SelectValue placeholder="Filtro de fecha" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin filtro de fecha</SelectItem>
            <SelectItem value="single">Fecha exacta</SelectItem>
            <SelectItem value="range">Rango de fechas</SelectItem>
          </SelectContent>
        </Select>

        <div>
          {dateFilterMode === 'single' ? (
            <DatePickerInput
              value={fechaDesde}
              onChange={(value) => {
                setFechaDesde(value)
                setFechaHasta(value)
              }}
              placeholder="Seleccionar fecha inicio"
              allowClear
            />
          ) : dateFilterMode === 'range' ? (
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <DatePickerInput value={fechaDesde} onChange={setFechaDesde} placeholder="Desde" allowClear />
              <span className="text-xs text-ran-slate">a</span>
              <DatePickerInput value={fechaHasta} onChange={setFechaHasta} placeholder="Hasta" allowClear />
            </div>
          ) : (
            <div className="flex h-11 items-center rounded-xl border border-dashed border-slate-200 px-3 text-sm text-ran-slate">
              Sin filtro de fecha
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-800">
          Activas ({selectedMonthLabel}): {activeCount}
        </span>
        <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">
          Inactivas ({selectedMonthLabel}): {inactiveCount}
        </span>
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">
          Pendientes ({selectedMonthLabel}): {monthlyStatusCounts.pendientes}
        </span>
        <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-800">
          En ruta ({selectedMonthLabel}): {monthlyStatusCounts.enRuta}
        </span>
        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">
          Realizados ({selectedMonthLabel}): {monthlyStatusCounts.realizados}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                <th className="px-5 py-3">Sucursal</th>
                <th className="px-3 py-3">Dirección</th>
                <th className="px-3 py-3">Máquina</th>
                <th className="px-3 py-3">Fecha inicio</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Mantenimiento mensual</th>
                <th className="px-3 py-3">Observaciones</th>
                <th className="w-20 px-3 py-3" />
              </tr>
            </thead>

            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                    Cargando pólizas...
                  </td>
                </tr>
              )}

              {!isLoading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                    No hay sucursales con póliza para los filtros aplicados.
                  </td>
                </tr>
              )}

              {!isLoading && pageRows.map((poliza) => {
                const trackableInMonth = isPolizaTrackableInMonth(poliza, monthCursor.year, monthCursor.month)
                const monthlyCoverage = trackableInMonth
                  ? mantenimientoMensualPorPoliza.get(poliza.id)
                  : undefined
                const estadoEnMes = getPolizaEstadoEnMes(
                  poliza,
                  polizaEstadoHistorialMap.get(poliza.id) ?? [],
                  monthCursor.year,
                  monthCursor.month,
                )
                const activaEnMes = estadoEnMes === 'activa'

                return (
                <tr key={poliza.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                  <td className="px-5 py-3.5">
                    <p className="font-semibold text-ran-navy">{poliza.cliente?.nombre ?? 'Sin sucursal'}</p>
                    <p className="text-xs text-ran-slate">Código: {poliza.cliente?.codigo_cliente ?? '—'}</p>
                  </td>
                  <td className="px-3 py-3.5 text-ran-slate">
                    <p>{truncateText(poliza.cliente?.direccion ?? 'Sin dirección registrada')}</p>
                    <p className="text-xs">{poliza.cliente?.municipio ?? '—'}</p>
                  </td>
                  <td className="px-3 py-3.5 text-ran-slate">
                    <p className="font-semibold">{poliza.maquina?.modelo ?? '—'}</p>
                    <p className="text-xs">Serie: {poliza.maquina?.serie ?? '—'}</p>
                  </td>
                  <td className="px-3 py-3.5 text-ran-slate">{formatDate(poliza.fecha_inicio)}</td>
                  <td className="px-3 py-3.5">
                    <Badge
                      variant="outline"
                      className={poliza.activa
                        ? 'bg-green-100 text-green-800 border-green-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'}
                    >
                      {poliza.activa ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3.5">
                    {!activaEnMes || !trackableInMonth ? (
                      <Badge variant="outline" className="border-slate-200 bg-slate-100 text-slate-600">
                        {estadoEnMes === 'inactiva' ? 'Inactiva en mes' : 'No aplica'}
                      </Badge>
                    ) : (
                      (() => {
                        const statusMensual = monthlyCoverage?.status ?? 'pendiente'

                        return (
                          <div className="flex items-center gap-2">
                            <MantenimientoStatusBadge
                              status={statusMensual}
                              className="rounded-lg border px-3 py-1 text-xs font-semibold"
                            />
                            {monthlyCoverage ? (
                              <span className="text-xs font-semibold text-ran-slate">
                                {monthlyCoverage.registros} {monthlyCoverage.registros === 1 ? 'registro' : 'registros'}
                              </span>
                            ) : null}
                          </div>
                        )
                      })()
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-ran-slate">{truncateText(poliza.observaciones ?? 'Sin observaciones')}</td>
                  <td className="px-3 py-3.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-ran-slate hover:bg-ran-ice"
                          aria-label="Acciones de póliza"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/polizas/${poliza.id}`)}>
                          <Eye className="h-4 w-4" />
                          Ver detalle
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => navigate(`/polizas/asignar-mantenimiento?poliza=${poliza.id}`)}
                          disabled={!poliza.activa || !trackableInMonth}
                        >
                          <ClipboardList className="h-4 w-4" />
                          Asignar mantenimiento
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => (poliza.activa ? handleDesactivar(poliza) : handleActivar(poliza))}
                          disabled={isDeactivating || isActivating || isDeleting}
                        >
                          <Power className="h-4 w-4" />
                          {poliza.activa ? 'Desactivar' : 'Reactivar'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="cursor-pointer text-destructive focus:text-destructive"
                          onClick={() => setPolizaToDelete(poliza)}
                          disabled={isDeleting || isDeactivating || isActivating}
                        >
                          <Trash2 className="h-4 w-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-ran-slate sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Mostrando {filteredPolizas.length ? start + 1 : 0}-{Math.min(end, filteredPolizas.length)} de {filteredPolizas.length} pólizas
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(1)} disabled={currentPage === 1}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ran-navy">{currentPage}</span>
          <span className="text-sm">de {totalPages}</span>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(polizaToDelete)}
        onOpenChange={(open) => {
          if (!open) setPolizaToDelete(null)
        }}
        title="¿Eliminar establecimiento de la póliza?"
        description={
          polizaToDelete
            ? `Se eliminará "${polizaToDelete.cliente?.nombre ?? 'el establecimiento seleccionado'}" de las sucursales en póliza. Esta acción no se puede deshacer.`
            : 'Esta acción no se puede deshacer.'
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmEliminar}
        isLoading={isDeleting}
      />
    </div>
  )
}
