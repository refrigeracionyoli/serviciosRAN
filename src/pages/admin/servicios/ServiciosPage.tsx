import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  MoreVertical,
  Pencil,
  Plus,
  Search,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { DateRangePickerInput } from '@/components/shared/DateRangePickerInput'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useToast } from '@/hooks/use-toast'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { exportServiciosExcel } from '@/lib/servicios-export'
import { supabase } from '@/lib/supabase'
import { useFiltrosStore } from '@/stores/filtros.store'
import { formatDate, formatMXN, formatWeek } from '@/lib/utils'
import type { Servicio } from '@/types/domain.types'

const PAGE_SIZE = 10

type DateFilterMode = 'none' | 'single' | 'range'

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getTipoServicioCorto(tipoServicio: Servicio['tipo_servicio']): string {
  if (tipoServicio.startsWith('MTTO')) return 'MTTO'
  if (tipoServicio === 'INSTALACION') return 'INST'
  if (tipoServicio === 'GARANTIA') return 'GARANTIA'
  return tipoServicio
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

function getWeekBounds(isoDate: string): { inicio: string; fin: string } {
  const selectedDate = parseIsoDateToLocalMidnight(isoDate) ?? new Date()
  const day = selectedDate.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(selectedDate)
  monday.setDate(selectedDate.getDate() + diffToMonday)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  return {
    inicio: formatLocalIsoDate(monday),
    fin: formatLocalIsoDate(sunday),
  }
}

export function ServiciosPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const filtros = useFiltrosStore()
  const todayIso = formatLocalIsoDate(new Date())
  const [isExportingWeekly, setIsExportingWeekly] = useState(false)
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>(() => {
    if (filtros.fechaDesde && filtros.fechaHasta) {
      return filtros.fechaDesde === filtros.fechaHasta ? 'single' : 'range'
    }
    if (filtros.fechaDesde || filtros.fechaHasta) return 'single'
    return 'none'
  })

  const { data: servicios = [], isLoading } = useServiciosQuery({
    status: filtros.status,
    tecnicoId: filtros.tecnicoId,
    tipoServicio: filtros.tipoServicio,
  })

  const filteredServicios = useMemo(() => {
    const search = (filtros.search ?? '').trim().toLowerCase()

    return servicios.filter((servicio) => {
      const matchesSearch = !search || [
        servicio.orden?.toString() ?? '',
        servicio.aviso?.toString() ?? '',
        servicio.cliente?.codigo_cliente ?? '',
        servicio.cliente?.nombre ?? '',
        servicio.tecnico?.nombre ?? '',
      ].some((value) => value.toLowerCase().includes(search))

      const fecha = servicio.fecha_servicio ?? servicio.fecha_solicitud
      const matchesDate = isWithinDateBounds(fecha, filtros.fechaDesde, filtros.fechaHasta)

      return matchesSearch && matchesDate
    })
  }, [filtros.fechaDesde, filtros.fechaHasta, filtros.search, servicios])

  useEffect(() => {
    setPage(1)
  }, [filtros.fechaDesde, filtros.fechaHasta, filtros.search, filtros.status, filteredServicios.length])

  useEffect(() => {
    const safeDesde = filtros.fechaDesde && filtros.fechaDesde > todayIso ? todayIso : filtros.fechaDesde
    const safeHasta = filtros.fechaHasta && filtros.fechaHasta > todayIso ? todayIso : filtros.fechaHasta

    if (safeDesde !== filtros.fechaDesde) {
      filtros.setFiltro('fechaDesde', safeDesde)
    }

    if (safeHasta !== filtros.fechaHasta) {
      filtros.setFiltro('fechaHasta', safeHasta)
    }
  }, [filtros, filtros.fechaDesde, filtros.fechaHasta, todayIso])

  const handleDateFilterModeChange = (mode: DateFilterMode) => {
    setDateFilterMode(mode)

    if (mode === 'none') {
      filtros.setFiltro('fechaDesde', null)
      filtros.setFiltro('fechaHasta', null)
      return
    }

    if (mode === 'single') {
      const baseDate = filtros.fechaDesde ?? filtros.fechaHasta ?? null
      filtros.setFiltro('fechaDesde', baseDate)
      filtros.setFiltro('fechaHasta', baseDate)
      return
    }

    if (mode === 'range') {
      const fromDate = filtros.fechaDesde ?? filtros.fechaHasta ?? null
      const toDate = filtros.fechaHasta ?? null
      filtros.setFiltro('fechaDesde', fromDate)
      filtros.setFiltro('fechaHasta', toDate)
    }
  }

  const totalPages = Math.max(1, Math.ceil(filteredServicios.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageRows = filteredServicios.slice(start, end)

  const handleExportListado = () => {
    if (filteredServicios.length === 0) {
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

    const safeStatus = filtros.status ?? 'todos'
    const filename = `servicios-${safeStatus}-${todayIso}.xlsx`

    exportServiciosExcel({
      servicios: filteredServicios,
      filename,
      periodLabel,
    })

    toast({
      title: 'Exportación lista',
      description: `Se generó el Excel con ${filteredServicios.length} servicios.`,
    })
  }

  const handleExportWeeklyReport = async () => {
    setIsExportingWeekly(true)

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Sin sesión activa')

      const anchorDate = filtros.fechaDesde ?? filtros.fechaHasta ?? todayIso
      const weekRange = getWeekBounds(anchorDate)
      const weekDate = parseIsoDateToLocalMidnight(anchorDate) ?? new Date()
      const semana = formatWeek(weekDate)

      const statuses = filtros.status === 'completado' || filtros.status === 'cerrado'
        ? [filtros.status]
        : ['completado', 'cerrado']

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const response = await fetch(`${supabaseUrl}/functions/v1/generar-reporte-semanal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          semana,
          fechaInicio: weekRange.inicio,
          fechaFin: weekRange.fin,
          statuses,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'No fue posible generar el reporte semanal')
      }

      const blob = await response.blob()
      const fileUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = fileUrl
      anchor.download = `reporte-semanal-${semana}.xlsx`
      anchor.click()
      URL.revokeObjectURL(fileUrl)

      toast({
        title: 'Reporte semanal generado',
        description: `Se descargó el reporte de la semana ${semana}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al exportar reporte semanal'
      toast({
        title: 'Error al exportar',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setIsExportingWeekly(false)
    }
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Servicios</h1>
          <p className="mt-1 text-lg text-ran-slate">{filteredServicios.length} servicios registrados</p>
        </div>
        <div className="flex w-full items-center justify-end gap-3 lg:w-auto">
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
                  <p className="text-xs text-ran-slate">Usa la semana de la fecha filtrada (o hoy)</p>
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

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-[1.6fr_0.75fr_0.75fr_1.2fr]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
          <Input
            value={filtros.search ?? ''}
            onChange={(event) => filtros.setFiltro('search', event.target.value || null)}
            placeholder="Buscar por orden, cliente, técnico o código..."
            className="h-11 rounded-xl border-slate-200 pl-10"
          />
        </div>

        <Select
          value={filtros.status ?? 'all'}
          onValueChange={(value) => filtros.setFiltro('status', value === 'all' ? null : value as typeof filtros.status)}
        >
          <SelectTrigger className="h-11 rounded-xl border-slate-200">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Status</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="en_ruta">En ruta</SelectItem>
            <SelectItem value="completado">Completado</SelectItem>
            <SelectItem value="cerrado">Cerrado</SelectItem>
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
              value={filtros.fechaDesde}
              onChange={(value) => {
                const safeValue = value && value > todayIso ? todayIso : value
                filtros.setFiltro('fechaDesde', safeValue)
                filtros.setFiltro('fechaHasta', safeValue)
              }}
              placeholder="Seleccionar fecha"
              maxDate={todayIso}
              allowClear
            />
          ) : dateFilterMode === 'range' ? (
            <DateRangePickerInput
              from={filtros.fechaDesde}
              to={filtros.fechaHasta}
              onChange={(from, to) => {
                const safeFrom = from && from > todayIso ? todayIso : from
                const safeTo = to && to > todayIso ? todayIso : to

                filtros.setFiltro('fechaDesde', safeFrom)
                filtros.setFiltro('fechaHasta', safeTo)
              }}
              placeholder="Seleccionar rango"
              maxDate={todayIso}
              allowClear
            />
          ) : (
            <div className="flex h-11 items-center rounded-xl border border-dashed border-slate-200 px-3 text-sm text-ran-slate">
              Sin filtro de fecha
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1700px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                <th className="px-5 py-3">Orden</th>
                <th className="px-3 py-3">Aviso</th>
                <th className="px-3 py-3">Clase</th>
                <th className="px-3 py-3">Tipo</th>
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
              {isLoading && (
                <tr>
                  <td colSpan={14} className="px-4 py-16 text-center text-ran-slate">
                    Cargando servicios...
                  </td>
                </tr>
              )}

              {!isLoading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={14} className="px-4 py-16 text-center text-ran-slate">
                    No hay servicios para los filtros aplicados.
                  </td>
                </tr>
              )}

              {!isLoading && pageRows.map((servicio) => (
                <tr key={servicio.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                  <td className="px-5 py-3.5 font-extrabold text-ran-navy">{servicio.orden ?? '—'}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{servicio.aviso ?? '—'}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{servicio.clase_orden ?? '—'}</td>
                  <td className="px-3 py-3.5 font-semibold text-ran-slate">{getTipoServicioCorto(servicio.tipo_servicio)}</td>
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
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-ran-slate sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Mostrando {filteredServicios.length ? start + 1 : 0}-{Math.min(end, filteredServicios.length)} de {filteredServicios.length} servicios
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(1)} disabled={currentPage === 1}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ran-navy">
            {currentPage}
          </span>
          <span className="text-sm">de {totalPages}</span>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
