import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUpDown,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  Filter,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { AdminFilterBarSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons'
import { DateRangePickerInput } from '@/components/shared/DateRangePickerInput'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { WeeklyReportExportDialog } from '@/components/shared/WeeklyReportExportDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useToast } from '@/hooks/use-toast'
import { useFiltrosStore } from '@/stores/filtros.store'
import { formatDate, formatMXN, formatWeek } from '@/lib/utils'
import type { WeeklyReportProgress } from '@/lib/reportes-export'
import type { ClaseOrden, Servicio, ServicioStatus, TipoServicio } from '@/types/domain.types'

const PAGE_SIZE = 10

type DateFilterField = 'servicio' | 'solicitud' | 'actividad'
type SortDirection = 'asc' | 'desc'
type ServicioSortKey = 'fecha_solicitud' | 'fecha_servicio' | 'status' | 'tipo_servicio' | 'clase_orden'

interface ServicioSortState {
  key: ServicioSortKey
  direction: SortDirection
}

interface StatusFilterOption {
  value: ServicioStatus
  label: string
}

interface SortOption {
  value: ServicioSortKey
  label: string
}

interface WeeklyReportWeekOption {
  value: string
  label: string
}

const STATUS_FILTER_OPTIONS: StatusFilterOption[] = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_ruta', label: 'En ruta' },
  { value: 'completado', label: 'Completado' },
  { value: 'cerrado', label: 'Cerrado' },
]

const DATE_FIELD_OPTIONS: Array<{ value: DateFilterField; label: string }> = [
  { value: 'actividad', label: 'Servicio o solicitud' },
  { value: 'servicio', label: 'Fecha servicio' },
  { value: 'solicitud', label: 'Fecha solicitud' },
]

const SORT_OPTIONS: SortOption[] = [
  { value: 'fecha_servicio', label: 'F. Servicio' },
  { value: 'fecha_solicitud', label: 'F. Solicitud' },
  { value: 'status', label: 'Status' },
  { value: 'tipo_servicio', label: 'Tipo' },
  { value: 'clase_orden', label: 'Clase' },
]

const STATUS_SORT_WEIGHT: Record<ServicioStatus, number> = {
  pendiente: 1,
  en_ruta: 2,
  completado: 3,
  cerrado: 4,
}

const INITIAL_WEEKLY_EXPORT_PROGRESS: WeeklyReportProgress = {
  progress: 2,
  stage: 'Generando reporte semanal',
  detail: 'Iniciando la exportación y preparando el entorno de descarga...',
  completedServices: 0,
  totalServices: 0,
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === 'AbortError'
  ) || (
    error instanceof Error && error.name === 'AbortError'
  )
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseIsoDateToLocalMidnight(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, month - 1, day)

  if (
    Number.isNaN(parsed.getTime())
    || parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null
  }

  return parsed
}

function isWithinDateBounds(fecha: string | null, desde: string | null, hasta: string | null): boolean {
  if (!desde && !hasta) return true
  if (!fecha) return false

  const fechaServicio = parseIsoDateToLocalMidnight(fecha)
  if (!fechaServicio) return false

  if (desde) {
    const fechaDesde = parseIsoDateToLocalMidnight(desde)
    if (fechaDesde && fechaServicio < fechaDesde) return false
  }

  if (hasta) {
    const fechaHasta = parseIsoDateToLocalMidnight(hasta)
    if (fechaHasta && fechaServicio > fechaHasta) return false
  }

  return true
}

function getServicioDateForFilter(servicio: Servicio, field: DateFilterField): string | null {
  if (field === 'servicio') return servicio.fecha_servicio
  if (field === 'solicitud') return servicio.fecha_solicitud
  return servicio.fecha_servicio ?? servicio.fecha_solicitud
}

function getServicioSortValue(servicio: Servicio, key: ServicioSortKey): string | number | null {
  if (key === 'fecha_solicitud') return servicio.fecha_solicitud
  if (key === 'fecha_servicio') return servicio.fecha_servicio
  if (key === 'status') return STATUS_SORT_WEIGHT[servicio.status]
  if (key === 'tipo_servicio') return servicio.tipo_servicio
  return servicio.clase_orden
}

function sortServicios(rows: Servicio[], sort: ServicioSortState | null): Servicio[] {
  if (!sort) return rows

  const directionMultiplier = sort.direction === 'asc' ? 1 : -1

  return [...rows].sort((left, right) => {
    const leftValue = getServicioSortValue(left, sort.key)
    const rightValue = getServicioSortValue(right, sort.key)
    const leftMissing = leftValue === null || leftValue === ''
    const rightMissing = rightValue === null || rightValue === ''

    if (leftMissing && rightMissing) return (right.created_at ?? '').localeCompare(left.created_at ?? '')
    if (leftMissing) return 1
    if (rightMissing) return -1

    const result = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), 'es', { sensitivity: 'base', numeric: true })

    if (result !== 0) return result * directionMultiplier
    return (right.created_at ?? '').localeCompare(left.created_at ?? '')
  })
}

function getWeekBounds(isoDate: string): { inicio: string; fin: string } {
  const selectedDate = parseIsoDateToLocalMidnight(isoDate) ?? new Date()
  const day = selectedDate.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(selectedDate)
  monday.setDate(selectedDate.getDate() + diffToMonday)

  const saturday = new Date(monday)
  saturday.setDate(monday.getDate() + 5)

  return {
    inicio: formatLocalIsoDate(monday),
    fin: formatLocalIsoDate(saturday),
  }
}

function formatDateRangeLabel(desde: string | null, hasta: string | null): string {
  if (!desde || !hasta) return 'Sin semana'
  return `${formatDate(desde)} - ${formatDate(hasta)}`
}

function getWeekCode(anchorIsoDate: string): string {
  const weekRange = getWeekBounds(anchorIsoDate)
  const weekDate = parseIsoDateToLocalMidnight(weekRange.inicio) ?? new Date()
  return formatWeek(weekDate)
}

function getWeeklyReportLabel(anchorIsoDate: string): string {
  const weekRange = getWeekBounds(anchorIsoDate)
  return `${getWeekCode(anchorIsoDate)} · ${formatDateRangeLabel(weekRange.inicio, weekRange.fin)}`
}

function buildWeeklyReportWeekOptions(todayIso: string): WeeklyReportWeekOption[] {
  const currentWeekStart = getWeekBounds(todayIso).inicio
  const cursor = parseIsoDateToLocalMidnight(currentWeekStart) ?? new Date()
  const options: WeeklyReportWeekOption[] = []

  for (let index = 0; index < 104; index += 1) {
    const value = formatLocalIsoDate(cursor)
    options.push({
      value,
      label: getWeeklyReportLabel(value),
    })
    cursor.setDate(cursor.getDate() - 7)
  }

  return options
}

function getMonthBounds(isoDate: string): { inicio: string; fin: string } {
  const selectedDate = parseIsoDateToLocalMidnight(isoDate) ?? new Date()
  const firstDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  const lastDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0)

  return {
    inicio: formatLocalIsoDate(firstDay),
    fin: formatLocalIsoDate(lastDay),
  }
}

function MultiFilterDropdown<TValue extends string>({
  label,
  allLabel,
  selectedLabel,
  options,
  selectedValues,
  onToggle,
  onClear,
}: {
  label: string
  allLabel: string
  selectedLabel: string
  options: Array<{ value: TValue; label: string }>
  selectedValues: TValue[]
  onToggle: (value: TValue) => void
  onClear: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 justify-between rounded-xl border-slate-200 px-3 font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <Filter className="h-4 w-4 shrink-0 text-ran-slate" />
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ran-slate" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[22rem] w-64 rounded-xl p-2">
        <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-ran-slate">{label}</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selectedValues.includes(option.value)}
            onCheckedChange={() => onToggle(option.value)}
            onSelect={(event) => event.preventDefault()}
            className="cursor-pointer rounded-lg"
          >
            <span className="truncate">{option.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer rounded-lg" onClick={onClear}>
          {allLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ServiciosPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const [isExportingWeekly, setIsExportingWeekly] = useState(false)
  const [weeklyExportProgress, setWeeklyExportProgress] = useState<WeeklyReportProgress | null>(null)
  const weeklyExportAbortRef = useRef<AbortController | null>(null)
  const filtros = useFiltrosStore()
  const todayIso = formatLocalIsoDate(new Date())
  const [weeklyReportWeekStart, setWeeklyReportWeekStart] = useState(() => getWeekBounds(todayIso).inicio)
  const deferredSearch = useDeferredValue((filtros.search ?? '').trim().toLowerCase())
  const [statusFilters, setStatusFilters] = useState<ServicioStatus[]>(() => (filtros.status ? [filtros.status] : []))
  const [tipoFilters, setTipoFilters] = useState<TipoServicio[]>(() => (filtros.tipoServicio ? [filtros.tipoServicio] : []))
  const [claseFilters, setClaseFilters] = useState<ClaseOrden[]>([])
  const [dateFilterField, setDateFilterField] = useState<DateFilterField>('actividad')
  const [sortState, setSortState] = useState<ServicioSortState | null>(null)
  const weeklyReportWeekOptions = useMemo(() => buildWeeklyReportWeekOptions(todayIso), [todayIso])
  const weeklyReportLabel = getWeeklyReportLabel(weeklyReportWeekStart)

  const { data: servicios = [], isLoading } = useServiciosQuery()
  const isPageLoading = isLoading

  const tipoServicioOptions = useMemo<Array<{ value: TipoServicio; label: string }>>(() => {
    const values = new Set<TipoServicio>()
    servicios.forEach((servicio) => {
      if (servicio.tipo_servicio) values.add(servicio.tipo_servicio)
    })
    return Array.from(values)
      .sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' }))
      .map((tipo) => ({ value: tipo, label: tipo }))
  }, [servicios])

  const claseOrdenOptions = useMemo<Array<{ value: ClaseOrden; label: string }>>(() => {
    const values = new Set<ClaseOrden>()
    servicios.forEach((servicio) => {
      if (servicio.clase_orden) values.add(servicio.clase_orden)
    })
    return Array.from(values)
      .sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' }))
      .map((clase) => ({ value: clase, label: clase }))
  }, [servicios])

  const tecnicoOptions = useMemo(() => {
    const values = new Map<string, string>()
    servicios.forEach((servicio) => {
      if (servicio.tecnico_id) {
        values.set(servicio.tecnico_id, servicio.tecnico?.nombre ?? servicio.tecnico_id)
      }
    })
    return Array.from(values.entries())
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((left, right) => left.nombre.localeCompare(right.nombre, 'es', { sensitivity: 'base' }))
  }, [servicios])

  const filteredServicios = useMemo(() => {
    return servicios.filter((servicio) => {
      const matchesStatus = statusFilters.length === 0 || statusFilters.includes(servicio.status)
      const matchesTipo = tipoFilters.length === 0 || tipoFilters.includes(servicio.tipo_servicio)
      const matchesClase = claseFilters.length === 0 || (servicio.clase_orden ? claseFilters.includes(servicio.clase_orden) : false)
      const matchesTecnico = !filtros.tecnicoId || servicio.tecnico_id === filtros.tecnicoId
      const matchesSearch = !deferredSearch || [
        servicio.orden?.toString() ?? '',
        servicio.aviso?.toString() ?? '',
        servicio.clase_orden ?? '',
        servicio.tipo_servicio ?? '',
        servicio.cliente?.codigo_cliente ?? '',
        servicio.cliente?.nombre ?? '',
        servicio.cliente?.municipio ?? '',
        servicio.maquina?.modelo ?? '',
        servicio.maquina?.serie ?? '',
        servicio.tecnico?.nombre ?? '',
      ].some((value) => value.toLowerCase().includes(deferredSearch))

      const fecha = getServicioDateForFilter(servicio, dateFilterField)
      const matchesDate = isWithinDateBounds(fecha, filtros.fechaDesde, filtros.fechaHasta)

      return matchesStatus && matchesTipo && matchesClase && matchesTecnico && matchesSearch && matchesDate
    })
  }, [
    claseFilters,
    dateFilterField,
    deferredSearch,
    filtros.fechaDesde,
    filtros.fechaHasta,
    filtros.tecnicoId,
    servicios,
    statusFilters,
    tipoFilters,
  ])

  const sortedServicios = useMemo(() => sortServicios(filteredServicios, sortState), [filteredServicios, sortState])

  useEffect(() => {
    setPage(1)
  }, [
    claseFilters,
    dateFilterField,
    filtros.fechaDesde,
    filtros.fechaHasta,
    filtros.search,
    filtros.tecnicoId,
    sortedServicios.length,
    sortState,
    statusFilters,
    tipoFilters,
  ])

  useEffect(() => {
    return () => {
      weeklyExportAbortRef.current?.abort()
      weeklyExportAbortRef.current = null
    }
  }, [])

  const handleToggleStatusFilter = (status: ServicioStatus) => {
    setStatusFilters((current) => (
      current.includes(status)
        ? current.filter((value) => value !== status)
        : [...current, status]
    ))
  }

  const handleToggleTipoFilter = (tipo: TipoServicio) => {
    setTipoFilters((current) => (
      current.includes(tipo)
        ? current.filter((value) => value !== tipo)
        : [...current, tipo]
    ))
  }

  const handleToggleClaseFilter = (clase: ClaseOrden) => {
    setClaseFilters((current) => (
      current.includes(clase)
        ? current.filter((value) => value !== clase)
        : [...current, clase]
    ))
  }

  const handleSortKeyChange = (value: string) => {
    if (value === 'none') {
      setSortState(null)
      return
    }

    setSortState((current) => ({
      key: value as ServicioSortKey,
      direction: current?.key === value ? current.direction : 'asc',
    }))
  }

  const handleToggleSortDirection = () => {
    setSortState((current) => {
      if (!current) return current
      return {
        ...current,
        direction: current.direction === 'asc' ? 'desc' : 'asc',
      }
    })
  }

  const handleSetDateRange = (from: string | null, to: string | null) => {
    filtros.setFiltros({
      fechaDesde: from,
      fechaHasta: to ?? from,
    })
  }

  const handleDateShortcut = (shortcut: 'today' | 'week' | 'month') => {
    if (shortcut === 'today') {
      handleSetDateRange(todayIso, todayIso)
      return
    }

    if (shortcut === 'week') {
      const weekRange = getWeekBounds(todayIso)
      handleSetDateRange(weekRange.inicio, weekRange.fin)
      return
    }

    const monthRange = getMonthBounds(todayIso)
    handleSetDateRange(monthRange.inicio, monthRange.fin)
  }

  const handleClearFilters = () => {
    filtros.setFiltros({
      status: null,
      search: null,
      tecnicoId: null,
      tipoServicio: null,
      fechaDesde: null,
      fechaHasta: null,
    })
    setStatusFilters([])
    setTipoFilters([])
    setClaseFilters([])
    setDateFilterField('actividad')
    setSortState(null)
  }

  const statusFilterLabel = statusFilters.length === 0
    ? 'Todos los status'
    : statusFilters.length === 1
      ? STATUS_FILTER_OPTIONS.find((option) => option.value === statusFilters[0])?.label ?? '1 status'
      : `${statusFilters.length} status`

  const tipoFilterLabel = tipoFilters.length === 0
    ? 'Todos los tipos'
    : tipoFilters.length === 1
      ? tipoFilters[0]
      : `${tipoFilters.length} tipos`

  const claseFilterLabel = claseFilters.length === 0
    ? 'Todas las clases'
    : claseFilters.length === 1
      ? claseFilters[0]
      : `${claseFilters.length} clases`

  const hasActiveFilters = Boolean(
    (filtros.search ?? '').trim()
    || filtros.tecnicoId
    || filtros.fechaDesde
    || filtros.fechaHasta
    || statusFilters.length > 0
    || tipoFilters.length > 0
    || claseFilters.length > 0,
  )

  const totalPages = Math.max(1, Math.ceil(sortedServicios.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageRows = sortedServicios.slice(start, end)

  const handleExportListado = async () => {
    if (sortedServicios.length === 0) {
      toast({
        title: 'Sin datos para exportar',
        description: 'No hay servicios en el listado actual.',
      })
      return
    }

    const periodLabel = (() => {
      if (filtros.fechaDesde && filtros.fechaHasta) {
        if (filtros.fechaDesde === filtros.fechaHasta) {
          return `Día ${formatDate(filtros.fechaDesde)}`
        }
        return `Rango ${formatDate(filtros.fechaDesde)} al ${formatDate(filtros.fechaHasta)}`
      }
      if (filtros.fechaDesde) {
        return `Desde ${formatDate(filtros.fechaDesde)}`
      }
      if (filtros.fechaHasta) {
        return `Hasta ${formatDate(filtros.fechaHasta)}`
      }
      return 'Todos los registros filtrados'
    })()

    const safeStatus = statusFilters.length === 1 ? statusFilters[0] : statusFilters.length > 1 ? 'varios-status' : 'todos'
    const filename = `servicios-${safeStatus}-${todayIso}.xlsx`

    try {
      const { exportServiciosExcel } = await import('@/lib/servicios-export')
      await exportServiciosExcel({
        servicios: sortedServicios,
        filename,
        periodLabel,
      })

      toast({
        title: 'Exportación lista',
        description: `Se generó el Excel con ${sortedServicios.length} servicios.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible generar el archivo.'
      toast({
        title: 'Error al exportar',
        description: message,
        variant: 'destructive',
      })
    }
  }

  const handleCancelWeeklyExport = () => {
    weeklyExportAbortRef.current?.abort()
  }

  const handleExportWeeklyReport = async () => {
    if (isExportingWeekly) return

    setIsExportingWeekly(true)
    setWeeklyExportProgress(INITIAL_WEEKLY_EXPORT_PROGRESS)

    const abortController = new AbortController()
    weeklyExportAbortRef.current = abortController

    try {
      await waitForNextPaint()

      const weekRange = getWeekBounds(weeklyReportWeekStart)
      const semana = getWeekCode(weeklyReportWeekStart)

      const { exportWeeklyReportBundle } = await import('@/lib/reportes-export')
      const result = await exportWeeklyReportBundle({
        semana,
        fechaInicio: weekRange.inicio,
        fechaFin: weekRange.fin,
        tecnicoId: filtros.tecnicoId,
        clienteId: filtros.clienteId,
        tipoServicios: tipoFilters,
        clasesOrden: claseFilters,
      }, {
        signal: abortController.signal,
        onProgress: (progress) => {
          setWeeklyExportProgress(progress)
        },
      })

      toast({
        title: 'Reporte semanal generado',
        description: `Se descargó ${result.filename} con ${result.totalServicios} servicio(s).`,
      })
    } catch (error) {
      if (isAbortLikeError(error)) {
        toast({
          title: 'Descarga cancelada',
          description: 'La generación del reporte semanal se canceló antes de completarse.',
        })
        return
      }

      const message = error instanceof Error ? error.message : 'Error al exportar reporte semanal'
      toast({
        title: 'Error al exportar',
        description: message,
        variant: 'destructive',
      })
    } finally {
      weeklyExportAbortRef.current = null
      setWeeklyExportProgress(null)
      setIsExportingWeekly(false)
    }
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Servicios</h1>
          {isPageLoading ? (
            <Skeleton className="mt-2 h-6 w-56 rounded-full" />
          ) : (
            <p className="mt-1 text-lg text-ran-slate">{sortedServicios.length} servicios registrados</p>
          )}
        </div>

        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-end lg:w-auto">
          <div className="w-full sm:w-[18rem]">
            <Select value={weeklyReportWeekStart} onValueChange={setWeeklyReportWeekStart}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200 bg-white">
                <SelectValue placeholder="Semana reporte" />
              </SelectTrigger>
              <SelectContent className="max-h-[22rem]">
                {weeklyReportWeekOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 min-w-[148px] justify-between rounded-xl px-4 text-base">
                <span className="font-semibold">Exportar</span>
                <ChevronDown className="h-4 w-4 text-ran-slate" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[310px] rounded-xl p-2">
              <DropdownMenuItem className="gap-3 rounded-lg p-3" onClick={handleExportListado}>
                <Download className="h-4 w-4 text-ran-navy" />
                <div>
                  <p className="font-semibold text-ran-navy">Excel del listado actual</p>
                  <p className="text-xs text-ran-slate">Exporta según los filtros aplicados</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-3 rounded-lg p-3" onClick={handleExportWeeklyReport} disabled={isExportingWeekly}>
                <CalendarDays className="h-4 w-4 text-ran-navy" />
                <div>
                  <p className="font-semibold text-ran-navy">
                    {isExportingWeekly ? 'Generando reporte semanal...' : 'Reporte semanal + evidencias'}
                  </p>
                  <p className="text-xs text-ran-slate">{weeklyReportLabel}</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={() => navigate('/servicios/nuevo')}
            className="h-11 rounded-xl bg-ran-navy px-6 text-base font-semibold hover:bg-ran-navy/90"
          >
            <Plus className="h-4 w-4" />
            Nuevo servicio
          </Button>
        </div>
      </div>

      {isPageLoading ? (
        <>
          <AdminFilterBarSkeleton
            className="mb-4 md:grid-cols-2 xl:grid-cols-[1.4fr_0.95fr_1.15fr_0.85fr_1.15fr]"
            items={['', '', '', '', '']}
          />
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={6} columns={6} />
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 rounded-2xl bg-white p-3 shadow-sm">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[1.4fr_0.95fr_1.15fr_0.85fr_1.15fr]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                <Input
                  value={filtros.search ?? ''}
                  onChange={(event) => filtros.setFiltro('search', event.target.value || null)}
                  placeholder="Buscar por orden, cliente, técnico, tipo o máquina..."
                  className="h-11 rounded-xl border-slate-200 pl-10"
                />
              </div>

              <MultiFilterDropdown
                label="Status"
                allLabel="Todos los status"
                selectedLabel={statusFilterLabel}
                options={STATUS_FILTER_OPTIONS}
                selectedValues={statusFilters}
                onToggle={handleToggleStatusFilter}
                onClear={() => setStatusFilters([])}
              />

              <MultiFilterDropdown
                label="Tipo"
                allLabel="Todos los tipos"
                selectedLabel={tipoFilterLabel}
                options={tipoServicioOptions}
                selectedValues={tipoFilters}
                onToggle={handleToggleTipoFilter}
                onClear={() => setTipoFilters([])}
              />

              <MultiFilterDropdown
                label="Clase"
                allLabel="Todas las clases"
                selectedLabel={claseFilterLabel}
                options={claseOrdenOptions}
                selectedValues={claseFilters}
                onToggle={handleToggleClaseFilter}
                onClear={() => setClaseFilters([])}
              />

              <Select
                value={filtros.tecnicoId ?? 'all'}
                onValueChange={(value) => filtros.setFiltro('tecnicoId', value === 'all' ? null : value)}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200">
                  <SelectValue placeholder="Técnico" />
                </SelectTrigger>
                <SelectContent className="max-h-[22rem]">
                  <SelectItem value="all">Todos los técnicos</SelectItem>
                  {tecnicoOptions.map((tecnico) => (
                    <SelectItem key={tecnico.id} value={tecnico.id}>{tecnico.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-3 flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[13rem_minmax(16rem,1fr)] xl:min-w-[33rem]">
                <Select value={dateFilterField} onValueChange={(value) => setDateFilterField(value as DateFilterField)}>
                  <SelectTrigger className="h-11 rounded-xl border-slate-200">
                    <SelectValue placeholder="Fecha" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FIELD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <DateRangePickerInput
                  from={filtros.fechaDesde}
                  to={filtros.fechaHasta}
                  onChange={handleSetDateRange}
                  placeholder="Fechas"
                  allowClear
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" className="h-10 rounded-xl px-3" onClick={() => handleDateShortcut('today')}>
                  Hoy
                </Button>
                <Button type="button" variant="outline" className="h-10 rounded-xl px-3" onClick={() => handleDateShortcut('week')}>
                  Semana
                </Button>
                <Button type="button" variant="outline" className="h-10 rounded-xl px-3" onClick={() => handleDateShortcut('month')}>
                  Mes
                </Button>

                {hasActiveFilters && (
                  <Button type="button" variant="ghost" className="h-10 rounded-xl px-3 text-ran-slate" onClick={handleClearFilters}>
                    <X className="h-4 w-4" />
                    Limpiar
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-ran-slate">Listado</p>
                <p className="text-sm font-semibold text-ran-navy">{sortedServicios.length} servicios en la tabla</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-ran-navy shadow-sm">
                  <ArrowUpDown className="h-4 w-4 text-ran-slate" />
                  Ordenar
                </div>

                <Select value={sortState?.key ?? 'none'} onValueChange={handleSortKeyChange}>
                  <SelectTrigger className="h-10 w-full rounded-xl border-slate-200 bg-white font-semibold text-ran-navy shadow-sm sm:w-[13.5rem]">
                    <SelectValue placeholder="Sin orden" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin orden</SelectItem>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {sortState && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl border-slate-200 bg-white px-3 font-semibold text-ran-navy shadow-sm"
                      onClick={handleToggleSortDirection}
                      aria-label={sortState.direction === 'desc' ? 'Orden descendente' : 'Orden ascendente'}
                    >
                      {sortState.direction === 'desc' ? (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          Desc.
                        </>
                      ) : (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          Asc.
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl text-ran-slate hover:bg-white hover:text-ran-navy"
                      onClick={() => setSortState(null)}
                      aria-label="Quitar orden"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            <HorizontalScrollArea>
              <table className="w-full min-w-[1700px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                    <th className="px-5 py-3">Orden</th>
                    <th className="px-3 py-3">Aviso</th>
                    <th className="px-3 py-3">Clase</th>
                    <th className="min-w-[240px] px-3 py-3">Tipo</th>
                    <th className="px-3 py-3">Cód. Cte.</th>
                    <th className="px-3 py-3">Cliente</th>
                    <th className="px-3 py-3">Municipio</th>
                    <th className="px-3 py-3">Máquina</th>
                    <th className="px-3 py-3">Técnico</th>
                    <th className="px-3 py-3">F. Solicitud</th>
                    <th className="px-3 py-3">F. Servicio</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Total</th>
                    <th className="w-14 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-4 py-16 text-center text-ran-slate">
                        No hay servicios para los filtros aplicados.
                      </td>
                    </tr>
                  )}

                  {pageRows.map((servicio) => (
                    <tr key={servicio.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                      <td className="px-5 py-3.5 font-extrabold text-ran-navy">{servicio.orden ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{servicio.aviso ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{servicio.clase_orden ?? '—'}</td>
                      <td className="min-w-[240px] whitespace-normal px-3 py-3.5 font-semibold leading-snug text-ran-slate">{servicio.tipo_servicio}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{servicio.cliente?.codigo_cliente ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{servicio.cliente?.nombre ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{servicio.cliente?.municipio ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">
                        <p className="font-semibold">{servicio.maquina?.modelo ?? '—'}</p>
                        <p className="text-xs">Serie: {servicio.maquina?.serie ?? '—'}</p>
                      </td>
                      <td className="px-3 py-3.5 text-ran-slate">{servicio.tecnico?.nombre ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{formatDate(servicio.fecha_solicitud)}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{formatDate(servicio.fecha_servicio)}</td>
                      <td className="px-3 py-3.5">
                        <ServicioStatusBadge status={servicio.status} className="rounded-lg border px-3 py-1 text-xs font-semibold" />
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{formatMXN(servicio.total ?? 0)}</td>
                      <td className="px-3 py-3.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ran-slate hover:bg-ran-ice">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
                            <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/servicios/${servicio.id}`)}>
                              <Eye className="h-4 w-4" />
                              Ver detalle
                            </DropdownMenuItem>
                            {servicio.status !== 'cerrado' && (
                              <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/servicios/${servicio.id}/editar`)}>
                                <Pencil className="h-4 w-4" />
                                Editar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          </div>

          <div className="mt-4 flex flex-col gap-3 text-ran-slate sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Mostrando {sortedServicios.length ? start + 1 : 0}-{Math.min(end, sortedServicios.length)} de {sortedServicios.length} servicios
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(1)} disabled={currentPage === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ran-navy">
                {currentPage}
              </span>
              <span className="text-sm">de {totalPages}</span>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <WeeklyReportExportDialog
        open={Boolean(weeklyExportProgress)}
        progress={weeklyExportProgress?.progress ?? INITIAL_WEEKLY_EXPORT_PROGRESS.progress}
        stage={weeklyExportProgress?.stage ?? INITIAL_WEEKLY_EXPORT_PROGRESS.stage}
        detail={weeklyExportProgress?.detail ?? INITIAL_WEEKLY_EXPORT_PROGRESS.detail}
        completedServices={weeklyExportProgress?.completedServices ?? 0}
        totalServices={weeklyExportProgress?.totalServices ?? 0}
        onCancel={handleCancelWeeklyExport}
      />
    </div>
  )
}
