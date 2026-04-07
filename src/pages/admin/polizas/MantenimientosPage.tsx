import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Eye,
  MoreVertical,
  Route,
  Search,
  Undo2,
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
import { MantenimientoStatusBadge } from '@/components/shared/StatusBadge'
import {
  useMantenimientosQuery,
  useEditarMantenimientoMutation,
} from '@/hooks/use-mantenimientos'
import { usePolizasQuery } from '@/hooks/use-polizas'
import { useToast } from '@/hooks/use-toast'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { formatDate, formatMXN } from '@/lib/utils'
import type { EditarMantenimientoInput } from '@/schemas/mantenimiento.schema'
import type { MantenimientoPoliza, MantenimientoStatus } from '@/types/domain.types'
import { PolizasSubNav } from './PolizasSubNav'

const PAGE_SIZE = 10

type DateFilterMode = 'none' | 'single' | 'range'
type MantenimientoStatusFilter = 'all' | 'pendiente' | 'en_ruta' | 'realizado'

const MAINTENIMIENTO_STATUS_LABELS: Record<MantenimientoStatus, string> = {
  pendiente: 'Pendiente',
  en_ruta: 'En ruta',
  realizado: 'Realizado',
}

function normalizeMantenimientoErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'No se pudo actualizar el mantenimiento.'

  if (/mantenimientos_poliza_status_check|check constraint|en_ruta/i.test(message)) {
    return 'Tu base de datos no acepta el status en ruta. Aplica la migracion 005_mantenimiento_status_en_ruta.sql y vuelve a intentar.'
  }

  return message
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

  const fechaMantenimiento = parseIsoDateToLocalMidnight(fecha)
  if (!fechaMantenimiento) return false

  if (desde) {
    const fechaDesde = parseIsoDateToLocalMidnight(desde)
    if (fechaDesde && fechaMantenimiento < fechaDesde) return false
  }

  if (hasta) {
    const fechaHasta = parseIsoDateToLocalMidnight(hasta)
    if (fechaHasta && fechaMantenimiento > fechaHasta) return false
  }

  return true
}

export function MantenimientosPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const polizaParam = searchParams.get('poliza')
  const parsedPolizaParam = polizaParam ? Number(polizaParam) : null
  const initialPolizaId = parsedPolizaParam && Number.isFinite(parsedPolizaParam) ? parsedPolizaParam : null

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<MantenimientoStatusFilter>('all')
  const [selectedPolizaId, setSelectedPolizaId] = useState<number | null>(initialPolizaId)
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('none')
  const [fechaDesde, setFechaDesde] = useState<string | null>(null)
  const [fechaHasta, setFechaHasta] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const { data = [], isLoading } = useMantenimientosQuery()
  const { data: polizas = [] } = usePolizasQuery()
  const { mutate: actualizarMantenimiento, isPending: isUpdating } = useEditarMantenimientoMutation()

  const filteredMantenimientos = useMemo(() => {
    const searchText = search.trim().toLowerCase()

    return data.filter((mantenimiento) => {
      if (status !== 'all' && mantenimiento.status !== status) return false
      if (selectedPolizaId && mantenimiento.poliza_id !== selectedPolizaId) return false
      if (!isWithinDateBounds(mantenimiento.fecha_visita, fechaDesde, fechaHasta)) return false

      if (!searchText) return true

      return [
        mantenimiento.cliente?.codigo_cliente ?? '',
        mantenimiento.cliente?.nombre ?? '',
        mantenimiento.maquina?.serie ?? '',
        mantenimiento.maquina?.modelo ?? '',
        mantenimiento.tecnico?.nombre ?? '',
        mantenimiento.tipo_servicio,
      ].some((value) => value.toLowerCase().includes(searchText))
    })
  }, [data, fechaDesde, fechaHasta, search, selectedPolizaId, status])

  useEffect(() => {
    const params = new URLSearchParams()

    if (selectedPolizaId) {
      params.set('poliza', String(selectedPolizaId))
    }

    setSearchParams(params, { replace: true })
  }, [selectedPolizaId, setSearchParams])

  useEffect(() => {
    setPage(1)
  }, [dateFilterMode, fechaDesde, fechaHasta, search, selectedPolizaId, status])

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

  const totalPendientes = filteredMantenimientos.filter((mantenimiento) => mantenimiento.status === 'pendiente').length
  const totalEnRuta = filteredMantenimientos.filter((mantenimiento) => mantenimiento.status === 'en_ruta').length
  const totalRealizados = filteredMantenimientos.filter((mantenimiento) => mantenimiento.status === 'realizado').length

  const totalPages = Math.max(1, Math.ceil(filteredMantenimientos.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageRows = filteredMantenimientos.slice(start, end)

  const handleQuickStatusUpdate = (mantenimiento: MantenimientoPoliza, nextStatus: MantenimientoStatus) => {
    if (mantenimiento.status === nextStatus) return

    if (nextStatus === 'en_ruta' && !mantenimiento.tecnico_id) {
      toast({
        title: 'Técnico requerido',
        description: 'Asigna un técnico desde el detalle del mantenimiento antes de marcar en ruta.',
        variant: 'destructive',
      })
      return
    }

    const data: EditarMantenimientoInput = {
      status: nextStatus,
      ...(nextStatus === 'realizado' && !mantenimiento.fecha_visita
        ? { fecha_visita: new Date().toISOString().split('T')[0] }
        : {}),
    }

    actualizarMantenimiento(
      {
        id: mantenimiento.id,
        data,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Status actualizado',
            description: `${mantenimiento.cliente?.nombre ?? 'El mantenimiento'} cambió a ${MAINTENIMIENTO_STATUS_LABELS[nextStatus].toLowerCase()}.`,
          })
        },
        onError: (error) => {
          const message = normalizeMantenimientoErrorMessage(error)
          toast({
            title: 'Error al actualizar status',
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
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Mantenimientos de póliza</h1>
          <p className="mt-1 text-lg text-ran-slate">{filteredMantenimientos.length} mantenimientos registrados</p>
        </div>
      </div>

      <PolizasSubNav />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-[1.5fr_0.95fr_0.75fr_0.75fr_1.25fr]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por sucursal, técnico, máquina o tipo..."
            className="h-11 rounded-xl border-slate-200 pl-10"
          />
        </div>

        <Select
          value={selectedPolizaId ? String(selectedPolizaId) : 'all'}
          onValueChange={(value) => setSelectedPolizaId(value === 'all' ? null : Number(value))}
        >
          <SelectTrigger className="h-11 rounded-xl border-slate-200">
            <SelectValue placeholder="Sucursal en póliza" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sucursales</SelectItem>
            {polizas.map((poliza) => (
              <SelectItem key={poliza.id} value={String(poliza.id)}>
                {poliza.cliente?.nombre ?? `Sucursal ${poliza.cliente_id}`} · {poliza.maquina?.serie ?? 'Sin serie'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(value) => setStatus(value as MantenimientoStatusFilter)}>
          <SelectTrigger className="h-11 rounded-xl border-slate-200">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="pendiente">Pendiente</SelectItem>
            <SelectItem value="en_ruta">En ruta</SelectItem>
            <SelectItem value="realizado">Realizado</SelectItem>
          </SelectContent>
        </Select>

        <Select value={dateFilterMode} onValueChange={(value) => handleDateFilterModeChange(value as DateFilterMode)}>
          <SelectTrigger className="h-11 rounded-xl border-slate-200">
            <SelectValue placeholder="Filtro de fecha" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin fecha</SelectItem>
            <SelectItem value="single">Fecha exacta</SelectItem>
            <SelectItem value="range">Rango</SelectItem>
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
              placeholder="Seleccionar visita"
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
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-800">Pendientes: {totalPendientes}</span>
        <span className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-800">En ruta: {totalEnRuta}</span>
        <span className="rounded-lg border border-green-200 bg-green-50 px-3 py-1 font-semibold text-green-800">Realizados: {totalRealizados}</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                <th className="px-5 py-3">Fecha visita</th>
                <th className="px-3 py-3">Sucursal</th>
                <th className="px-3 py-3">Máquina</th>
                <th className="px-3 py-3">Técnico</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">Total</th>
                <th className="px-3 py-3">Status</th>
                <th className="w-16 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                    Cargando mantenimientos...
                  </td>
                </tr>
              )}

              {!isLoading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                    No hay mantenimientos para los filtros aplicados.
                  </td>
                </tr>
              )}

              {!isLoading && pageRows.map((mantenimiento) => (
                <tr key={mantenimiento.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                  <td className="px-5 py-3.5 font-semibold text-ran-navy">{formatDate(mantenimiento.fecha_visita)}</td>
                  <td className="px-3 py-3.5 text-ran-slate">
                    <p>{mantenimiento.cliente?.nombre ?? 'Sin sucursal'}</p>
                    <p className="text-xs">Código: {mantenimiento.cliente?.codigo_cliente ?? '—'}</p>
                  </td>
                  <td className="px-3 py-3.5 text-ran-slate">
                    <p className="font-semibold">{mantenimiento.maquina?.modelo ?? '—'}</p>
                    <p className="text-xs">Serie: {mantenimiento.maquina?.serie ?? '—'}</p>
                  </td>
                  <td className="px-3 py-3.5 text-ran-slate">{mantenimiento.tecnico?.nombre ?? 'Sin técnico'}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{mantenimiento.tipo_servicio}</td>
                  <td className="px-3 py-3.5 font-semibold text-ran-navy">{formatMXN(mantenimiento.total ?? 0)}</td>
                  <td className="px-3 py-3.5">
                    <MantenimientoStatusBadge status={mantenimiento.status} className="rounded-lg border px-3 py-1 text-xs font-semibold" />
                  </td>
                  <td className="px-3 py-3.5">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-lg text-ran-slate hover:bg-ran-ice"
                          aria-label="Acciones de mantenimiento"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 rounded-xl p-1.5">
                        <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/polizas/mantenimientos/${mantenimiento.id}`)}>
                          <Eye className="h-4 w-4" />
                          Ver y editar mantenimiento
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => handleQuickStatusUpdate(mantenimiento, 'en_ruta')}
                          disabled={mantenimiento.status === 'en_ruta' || isUpdating}
                        >
                          <Route className="h-4 w-4" />
                          Marcar en ruta
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => handleQuickStatusUpdate(mantenimiento, 'realizado')}
                          disabled={mantenimiento.status === 'realizado' || isUpdating}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Marcar realizado
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => handleQuickStatusUpdate(mantenimiento, 'pendiente')}
                          disabled={mantenimiento.status === 'pendiente' || isUpdating}
                        >
                          <Undo2 className="h-4 w-4" />
                          Volver pendiente
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onClick={() => navigate(`/polizas?search=${encodeURIComponent(mantenimiento.cliente?.nombre ?? '')}`)}
                        >
                          <Search className="h-4 w-4" />
                          Ver en pólizas
                        </DropdownMenuItem>
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
          Mostrando {filteredMantenimientos.length ? start + 1 : 0}-{Math.min(end, filteredMantenimientos.length)} de {filteredMantenimientos.length} mantenimientos
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
    </div>
  )
}
