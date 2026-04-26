import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  MoreVertical,
  PauseCircle,
  Power,
  PlayCircle,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  AdminFilterBarSkeleton,
  AdminStatsGridSkeleton,
  AdminTableSkeleton,
} from '@/components/shared/AdminSkeletons'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  usePolizasQuery,
  usePolizaEstadoHistorialQuery,
  usePolizaPausasQuery,
  useCrearPolizaPausaMutation,
  useReanudarPolizaPausaMutation,
  useDesactivarPolizaMutation,
  useActivarPolizaMutation,
  useEliminarPolizaMutation,
} from '@/hooks/use-polizas'
import { useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { cn, formatDate, formatLocalIsoDate } from '@/lib/utils'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { Skeleton } from '@/components/ui/skeleton'
import type { MantenimientoStatus, Poliza, PolizaEstado, PolizaEstadoHistorial, PolizaPausa } from '@/types/domain.types'
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

interface StatusPillPresentation {
  label: string
  className: string
  dotClassName: string
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

function getMonthWindow(year: number, month: number) {
  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 1),
  }
}

function getMonthStartIso(year: number, month: number): string {
  return formatLocalIsoDate(new Date(year, month, 1))
}

function isPolizaPausaActiveInMonth(pausa: PolizaPausa, year: number, month: number): boolean {
  const pauseStart = parseIsoDateToLocalMidnight(pausa.fecha_inicio)
  if (!pauseStart) return false

  const pauseEndExclusive = pausa.fecha_reanudacion
    ? parseIsoDateToLocalMidnight(pausa.fecha_reanudacion)
    : null
  const { start: monthStart, end: monthEnd } = getMonthWindow(year, month)

  return pauseStart < monthEnd && (!pauseEndExclusive || pauseEndExclusive > monthStart)
}

function canResumePauseFromMonth(pausa: PolizaPausa, year: number, month: number): boolean {
  if (pausa.fecha_reanudacion) return false

  const pauseStart = parseIsoDateToLocalMidnight(pausa.fecha_inicio)
  if (!pauseStart) return false

  const { start: monthStart } = getMonthWindow(year, month)
  return monthStart >= pauseStart
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

function getYearFromDateValue(value: string | null): number | null {
  if (!value) return null

  const parsed = parseIsoDateToLocalMidnight(value) ?? parseDateTime(value)
  if (!parsed) return null

  return parsed.getFullYear()
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

function getPolizaEstadoPresentation(estado: PolizaEstado | 'no_aplica'): StatusPillPresentation {
  if (estado === 'activa') {
    return {
      label: 'Activa',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      dotClassName: 'bg-emerald-500',
    }
  }

  if (estado === 'inactiva') {
    return {
      label: 'Inactiva',
      className: 'border-slate-200 bg-slate-50 text-slate-700',
      dotClassName: 'bg-slate-400',
    }
  }

  return {
    label: 'No vigente',
    className: 'border-slate-200 bg-white text-slate-600',
    dotClassName: 'bg-slate-300',
  }
}

function getMantenimientoPresentation(status: MantenimientoStatus): StatusPillPresentation {
  if (status === 'realizado') {
    return {
      label: 'Realizado',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      dotClassName: 'bg-emerald-500',
    }
  }

  if (status === 'en_ruta') {
    return {
      label: 'En ruta',
      className: 'border-sky-200 bg-sky-50 text-sky-800',
      dotClassName: 'bg-sky-500',
    }
  }

  return {
    label: 'Pendiente',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    dotClassName: 'bg-amber-500',
  }
}

function getPausedPresentation(): StatusPillPresentation {
  return {
    label: 'Pausada',
    className: 'border-orange-200 bg-orange-50 text-orange-800',
    dotClassName: 'bg-orange-500',
  }
}

function getMonthlyTrackingPresentation(
  estadoEnMes: PolizaEstado | 'no_aplica',
  trackableInMonth: boolean,
  monthPaused: boolean,
  monthlyCoverage?: MonthlyCoverageSummary,
): StatusPillPresentation {
  if (!trackableInMonth || estadoEnMes === 'no_aplica') {
    return getPolizaEstadoPresentation('no_aplica')
  }

  if (estadoEnMes === 'inactiva') {
    return {
      label: 'Inactiva en mes',
      className: 'border-slate-200 bg-slate-50 text-slate-700',
      dotClassName: 'bg-slate-400',
    }
  }

  if (monthPaused) {
    return getPausedPresentation()
  }

  return getMantenimientoPresentation(monthlyCoverage?.status ?? 'pendiente')
}

function StatusPill({ label, className, dotClassName }: StatusPillPresentation) {
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-2 whitespace-nowrap rounded-full border px-2.5 text-xs font-bold',
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotClassName)} />
      {label}
    </span>
  )
}

export function PolizasPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()
  const [search, setSearch] = useState('')
  const [estado, setEstado] = useState<PolizaEstadoFilter>('all')
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('none')
  const [fechaDesde, setFechaDesde] = useState<string | null>(null)
  const [fechaHasta, setFechaHasta] = useState<string | null>(null)
  const [monthCursor, setMonthCursor] = useState<MonthCursor>(() => ({
    year: currentYear,
    month: currentMonth,
  }))
  const [page, setPage] = useState(1)
  const [polizaToDelete, setPolizaToDelete] = useState<Poliza | null>(null)
  const [openPauseDialog, setOpenPauseDialog] = useState(false)
  const [pauseMotivo, setPauseMotivo] = useState('')
  const [pauseToResume, setPauseToResume] = useState<PolizaPausa | null>(null)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const { data: polizas = [], isLoading } = usePolizasQuery()
  const { data: polizaEstadoHistorial = [], isLoading: loadingEstadoHistorial } = usePolizaEstadoHistorialQuery()
  const { data: polizaPausas = [], isLoading: loadingPolizaPausas } = usePolizaPausasQuery()
  const { data: mantenimientos = [], isLoading: loadingMantenimientos } = useMantenimientosQuery()
  const { mutate: crearPolizaPausa, isPending: isCreatingPause } = useCrearPolizaPausaMutation()
  const { mutate: reanudarPolizaPausa, isPending: isResumingPause } = useReanudarPolizaPausaMutation()
  const { mutate: desactivarPoliza, isPending: isDeactivating } = useDesactivarPolizaMutation()
  const { mutate: activarPoliza, isPending: isActivating } = useActivarPolizaMutation()
  const { mutate: eliminarPoliza, isPending: isDeleting } = useEliminarPolizaMutation()
  const isPageLoading = isLoading || loadingEstadoHistorial || loadingPolizaPausas || loadingMantenimientos

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
    return polizas.filter((poliza) => {
      if (estado === 'activa' && !poliza.activa) return false
      if (estado === 'inactiva' && poliza.activa) return false

      if (!isWithinDateBounds(poliza.fecha_inicio, fechaDesde, fechaHasta)) return false

      if (!deferredSearch) return true

      return [
        poliza.cliente?.codigo_cliente ?? '',
        poliza.cliente?.nombre ?? '',
        poliza.cliente?.direccion ?? '',
        poliza.cliente?.municipio ?? '',
        poliza.maquina?.serie ?? '',
        poliza.maquina?.modelo ?? '',
      ].some((value) => value.toLowerCase().includes(deferredSearch))
    })
  }, [deferredSearch, estado, fechaDesde, fechaHasta, polizas])

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

  const selectedMonthPause = useMemo(() => {
    return polizaPausas.find((pausa) =>
      isPolizaPausaActiveInMonth(pausa, monthCursor.year, monthCursor.month),
    ) ?? null
  }, [monthCursor.month, monthCursor.year, polizaPausas])

  const openPause = useMemo(() => {
    return polizaPausas.find((pausa) => !pausa.fecha_reanudacion) ?? null
  }, [polizaPausas])

  const selectedMonthPaused = Boolean(selectedMonthPause)
  const canPauseSelectedMonth = !selectedMonthPaused && !openPause
  const canResumeSelectedMonth = Boolean(
    openPause && canResumePauseFromMonth(openPause, monthCursor.year, monthCursor.month),
  )

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

        if (selectedMonthPaused) {
          acc.pausadas += 1
          return acc
        }

        const status = mantenimientoMensualPorPoliza.get(poliza.id)?.status ?? 'pendiente'
        if (status === 'realizado') acc.realizados += 1
        if (status === 'en_ruta') acc.enRuta += 1
        if (status === 'pendiente') acc.pendientes += 1
        return acc
      },
      { pausadas: 0, pendientes: 0, enRuta: 0, realizados: 0 },
    )
  }, [
    filteredPolizas,
    mantenimientoMensualPorPoliza,
    monthCursor.month,
    monthCursor.year,
    polizaEstadoHistorialMap,
    selectedMonthPaused,
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
  const selectedMonthStartIso = getMonthStartIso(monthCursor.year, monthCursor.month)
  const pauseStateLabel = selectedMonthPaused
    ? 'Pausa global'
    : openPause
      ? `Pausa desde ${formatDate(openPause.fecha_inicio)}`
      : 'Sin pausa'

  const yearOptions = useMemo(() => {
    const years = new Set<number>([
      currentYear - 1,
      currentYear,
      currentYear + 1,
      monthCursor.year,
    ])

    for (const poliza of polizas) {
      const year = getYearFromDateValue(poliza.fecha_inicio)
      if (year) years.add(year)
    }

    for (const mantenimiento of mantenimientos) {
      const year = getYearFromDateValue(mantenimiento.fecha_visita)
      if (year) years.add(year)
    }

    for (const event of polizaEstadoHistorial) {
      const year = getYearFromDateValue(event.changed_at)
      if (year) years.add(year)
    }

    return [...years].sort((a, b) => b - a)
  }, [currentYear, mantenimientos, monthCursor.year, polizaEstadoHistorial, polizas])

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

  const handleCreatePause = () => {
    if (!canPauseSelectedMonth) return

    crearPolizaPausa(
      {
        fecha_inicio: selectedMonthStartIso,
        motivo: pauseMotivo.trim() || null,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Pólizas pausadas',
            description: `El seguimiento queda en pausa desde ${selectedMonthLabel}.`,
          })
          setOpenPauseDialog(false)
          setPauseMotivo('')
        },
        onError: (error) => {
          const rawMessage = error instanceof Error ? error.message : 'No se pudo pausar la póliza.'
          const message = /(poliza_pausas_no_overlap|overlap|conflict|exclusion)/i.test(rawMessage)
            ? 'Ya existe una pausa que cruza con ese mes.'
            : rawMessage

          toast({
            title: 'Error al pausar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleResumePause = () => {
    if (!pauseToResume) return

    reanudarPolizaPausa(
      {
        id: pauseToResume.id,
        fecha_reanudacion: selectedMonthStartIso,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Pólizas reanudadas',
            description: `El seguimiento vuelve a contar desde ${selectedMonthLabel}.`,
          })
          setPauseToResume(null)
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'No se pudo reanudar la póliza.'
          toast({
            title: 'Error al reanudar',
            description: message,
            variant: 'destructive',
          })
        },
      },
    )
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
          {isPageLoading ? (
            <Skeleton className="mt-2 h-6 w-64 rounded-full" />
          ) : (
            <p className="mt-1 text-lg text-ran-slate">{filteredPolizas.length} sucursales registradas en póliza</p>
          )}
        </div>
        <Button onClick={() => navigate('/polizas/nueva')} className="h-11 rounded-xl bg-ran-navy px-6 text-base font-semibold hover:bg-ran-navy/90">
          <Plus className="h-4 w-4" />
          Nueva póliza
        </Button>
      </div>

      <PolizasSubNav />

      {isPageLoading ? (
        <>
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-56 rounded-full" />
              <Skeleton className="h-4 w-40 rounded-full" />
            </div>
            <Skeleton className="h-10 w-[188px] rounded-xl" />
          </div>

          <AdminFilterBarSkeleton
            className="mb-4 lg:grid-cols-[1.5fr_0.75fr_0.75fr_1.2fr]"
            items={['', '', '', '']}
          />
          <AdminStatsGridSkeleton
            count={6}
            className="mb-4"
            columnsClassName="md:grid-cols-2 xl:grid-cols-6"
          />
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={6} columns={6} />
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ran-ice text-ran-navy">
                <CalendarDays className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-ran-navy">Seguimiento mensual</p>
                  <span
                    className={cn(
                      'inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-bold',
                      selectedMonthPaused
                        ? 'border-orange-200 bg-orange-50 text-orange-800'
                        : openPause
                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                          : 'border-slate-200 bg-slate-50 text-slate-600',
                    )}
                  >
                    {pauseStateLabel}
                  </span>
                </div>
                <p className="truncate text-lg font-extrabold text-ran-navy">{selectedMonthLabel}</p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2 sm:grid-cols-[170px_110px]">
                <Select
                  value={String(monthCursor.month)}
                  onValueChange={(value) => {
                    const month = Number(value)
                    setMonthCursor((current) => ({
                      ...current,
                      month: Number.isInteger(month) ? month : current.month,
                    }))
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                    <SelectValue placeholder="Mes" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_LABELS.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={String(monthCursor.year)}
                  onValueChange={(value) => {
                    const year = Number(value)
                    setMonthCursor((current) => ({
                      ...current,
                      year: Number.isInteger(year) ? year : current.year,
                    }))
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl border-slate-200 bg-white">
                    <SelectValue placeholder="Año" />
                  </SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-slate-200 px-3 font-semibold text-ran-navy hover:bg-ran-ice"
                  onClick={() => setMonthCursor({ year: currentYear, month: currentMonth })}
                >
                  Actual
                </Button>

                {canResumeSelectedMonth && openPause ? (
                  <Button
                    type="button"
                    className="h-10 rounded-xl bg-ran-navy px-3 font-semibold hover:bg-ran-navy/90"
                    disabled={isCreatingPause || isResumingPause}
                    onClick={() => setPauseToResume(openPause)}
                  >
                    <PlayCircle className="h-4 w-4" />
                    Reanudar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-orange-200 px-3 font-semibold text-orange-800 hover:bg-orange-50"
                    disabled={!canPauseSelectedMonth || isCreatingPause || isResumingPause}
                    onClick={() => setOpenPauseDialog(true)}
                  >
                    <PauseCircle className="h-4 w-4" />
                    Pausar
                  </Button>
                )}
              </div>
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

          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Activas
              </div>
              <p className="mt-2 text-2xl font-extrabold leading-none text-ran-navy">{activeCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                Inactivas
              </div>
              <p className="mt-2 text-2xl font-extrabold leading-none text-ran-navy">{inactiveCount}</p>
            </div>
            <div className="rounded-2xl border border-orange-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-orange-700">
                <span className="h-2 w-2 rounded-full bg-orange-500" />
                Pausadas
              </div>
              <p className="mt-2 text-2xl font-extrabold leading-none text-ran-navy">{monthlyStatusCounts.pausadas}</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-700">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Pendientes
              </div>
              <p className="mt-2 text-2xl font-extrabold leading-none text-ran-navy">{monthlyStatusCounts.pendientes}</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-700">
                <span className="h-2 w-2 rounded-full bg-sky-500" />
                En ruta
              </div>
              <p className="mt-2 text-2xl font-extrabold leading-none text-ran-navy">{monthlyStatusCounts.enRuta}</p>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Realizados
              </div>
              <p className="mt-2 text-2xl font-extrabold leading-none text-ran-navy">{monthlyStatusCounts.realizados}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <HorizontalScrollArea>
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
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                        No hay sucursales con póliza para los filtros aplicados.
                      </td>
                    </tr>
                  ) : pageRows.map((poliza) => {
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
                    const estadoPresentation = getPolizaEstadoPresentation(estadoEnMes)
                    const monthlyPresentation = getMonthlyTrackingPresentation(
                      estadoEnMes,
                      trackableInMonth,
                      selectedMonthPaused,
                      monthlyCoverage,
                    )

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
                          <StatusPill {...estadoPresentation} />
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-2">
                            <StatusPill {...monthlyPresentation} />
                            {monthlyCoverage && estadoEnMes === 'activa' && !selectedMonthPaused ? (
                              <span className="text-xs font-semibold text-ran-slate">
                                {monthlyCoverage.registros} {monthlyCoverage.registros === 1 ? 'registro' : 'registros'}
                              </span>
                            ) : null}
                          </div>
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
                                disabled={estadoEnMes !== 'activa' || !trackableInMonth || selectedMonthPaused}
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
            </HorizontalScrollArea>
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
        </>
      )}

      <Dialog
        open={openPauseDialog}
        onOpenChange={(open) => {
          setOpenPauseDialog(open)
          if (!open) setPauseMotivo('')
        }}
      >
        <DialogContent className="rounded-2xl border-slate-200 sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-ran-navy">Pausar pólizas</DialogTitle>
            <DialogDescription>{selectedMonthLabel}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="poliza-pausa-motivo" className="text-sm font-semibold text-ran-navy">
              Motivo
            </Label>
            <Input
              id="poliza-pausa-motivo"
              value={pauseMotivo}
              onChange={(event) => setPauseMotivo(event.target.value)}
              placeholder="Temporada baja, acuerdo comercial..."
              className="h-11 rounded-xl border-slate-200"
              maxLength={160}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl border-slate-200"
              disabled={isCreatingPause}
              onClick={() => setOpenPauseDialog(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="rounded-xl bg-ran-navy hover:bg-ran-navy/90"
              disabled={isCreatingPause || !canPauseSelectedMonth}
              onClick={handleCreatePause}
            >
              {isCreatingPause ? 'Pausando…' : 'Pausar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pauseToResume)}
        onOpenChange={(open) => {
          if (!open) setPauseToResume(null)
        }}
        title="¿Reanudar pólizas?"
        description={`El seguimiento mensual volverá a contar desde ${selectedMonthLabel}.`}
        confirmLabel="Reanudar"
        cancelLabel="Cancelar"
        onConfirm={handleResumePause}
        isLoading={isResumingPause}
      />

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
