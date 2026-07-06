import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  History,
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
  AdminFilterBarSkeleton,
  AdminStatsGridSkeleton,
  AdminTableSkeleton,
} from '@/components/shared/AdminSkeletons'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { MaquinaStatusBadge } from '@/components/shared/StatusBadge'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { useServiciosMachineActivityQuery, type ServicioMachineActivity } from '@/hooks/use-servicios'
import { formatLocalIsoDate } from '@/lib/utils'
import type { MaquinaStatus } from '@/types/domain.types'
import { CatalogosSubNav } from './CatalogosSubNav'

const PAGE_SIZE = 10

type MaquinaStatusFilter = 'all' | MaquinaStatus
type ModeloFilter = 'all' | 'KM901' | 'MS1500' | 'SD1002' | 'KM1300'

function normalizeText(value: string | null | undefined): string {
  if (!value) return ''
  return value.toLowerCase()
}

function parseActivityDate(value: string | null | undefined): Date | null {
  if (!value) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isSameMonth(value: string | null | undefined, reference: Date): boolean {
  const date = parseActivityDate(value)
  if (!date) return false

  return date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
}

function isHistoricalExcelImport(servicio: ServicioMachineActivity): boolean {
  return servicio.status === 'cerrado'
    && servicio.tecnico_id == null
    && Number(servicio.costo_refacciones ?? 0) === 0
    && Number(servicio.costo_mano_obra ?? 0) === 0
}

export function MaquinasPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [modelo, setModelo] = useState<ModeloFilter>('all')
  const [status, setStatus] = useState<MaquinaStatusFilter>('all')
  const [page, setPage] = useState(1)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())
  const activityReferenceDate = useMemo(() => new Date(), [])
  const activityMonthStart = formatLocalIsoDate(new Date(
    activityReferenceDate.getFullYear(),
    activityReferenceDate.getMonth(),
    1,
  ))
  const activityMonthEnd = formatLocalIsoDate(new Date(
    activityReferenceDate.getFullYear(),
    activityReferenceDate.getMonth() + 1,
    0,
  ))

  const { data: maquinas = [], isLoading } = useMaquinasQuery({ includeInactive: true })
  const { data: servicios = [], isLoading: loadingServicios } = useServiciosMachineActivityQuery(
    activityMonthStart,
    activityMonthEnd,
  )
  const { data: mantenimientos = [], isLoading: loadingMantenimientos } = useMantenimientosQuery({
    fechaDesde: activityMonthStart,
    fechaHasta: activityMonthEnd,
  })
  const isPageLoading = isLoading || loadingServicios || loadingMantenimientos
  const maquinasInstaladas = useMemo(
    () => maquinas.filter((maquina) => maquina.activo && maquina.status === 'operando' && maquina.cliente_id != null),
    [maquinas],
  )

  const actividadMes = useMemo(() => {
    const rows = [
      ...servicios
        .filter((servicio) => (
          servicio.maquina_id
          && !isHistoricalExcelImport(servicio)
          && isSameMonth(servicio.fecha_servicio ?? servicio.fecha_solicitud ?? servicio.created_at, activityReferenceDate)
        ))
        .map((servicio) => ({ maquina_id: servicio.maquina_id })),
      ...mantenimientos
        .filter((mantenimiento) => mantenimiento.maquina_id && isSameMonth(mantenimiento.fecha_visita ?? mantenimiento.created_at, activityReferenceDate))
        .map((mantenimiento) => ({ maquina_id: mantenimiento.maquina_id })),
    ]

    const porMaquina = rows.reduce<Record<number, number>>((acc, row) => {
      if (!row.maquina_id) return acc
      acc[row.maquina_id] = (acc[row.maquina_id] ?? 0) + 1
      return acc
    }, {})

    return {
      total: rows.length,
      porMaquina,
    }
  }, [activityReferenceDate, mantenimientos, servicios])

  const filteredMaquinas = useMemo(() => {
    return maquinasInstaladas.filter((maquina) => {
      if (modelo !== 'all' && maquina.modelo !== modelo) return false
      if (status !== 'all' && maquina.status !== status) return false

      if (!deferredSearch) return true

      return [
        maquina.serie,
        maquina.modelo,
        maquina.cliente?.codigo_cliente,
        maquina.cliente?.nombre,
        maquina.cliente?.direccion,
        maquina.cliente?.municipio,
        maquina.cliente?.telefono,
      ].some((value) => normalizeText(value).includes(deferredSearch))
    })
  }, [deferredSearch, maquinasInstaladas, modelo, status])

  const { totalMaquinas, operando, enTaller } = useMemo(() => {
    let operandoCount = 0
    let enTallerCount = 0
    for (const maquina of maquinasInstaladas) {
      if (maquina.status === 'operando') operandoCount += 1
      if (maquina.status === 'en_taller') enTallerCount += 1
    }
    return {
      totalMaquinas: maquinasInstaladas.length,
      operando: operandoCount,
      enTaller: enTallerCount,
    }
  }, [maquinasInstaladas])

  const totalPages = Math.max(1, Math.ceil(filteredMaquinas.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const endIndex = startIndex + PAGE_SIZE
  const pageRows = filteredMaquinas.slice(startIndex, endIndex)

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Catálogos</h1>
        <p className="mt-1 text-lg text-ran-slate">Registro de máquinas instaladas en establecimientos con póliza</p>
      </div>

      <CatalogosSubNav />

      {isPageLoading ? (
        <>
          <AdminStatsGridSkeleton count={4} className="mb-3" />
          <AdminFilterBarSkeleton className="mb-3 lg:grid-cols-[1.7fr_0.8fr_0.8fr]" items={['', '', '']} />
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={6} columns={6} />
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Máquinas registradas</p>
              <p className="mt-1 text-4xl font-extrabold text-ran-navy">{totalMaquinas}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Operando</p>
              <p className="mt-1 text-4xl font-extrabold text-green-600">{operando}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">En taller</p>
              <p className="mt-1 text-4xl font-extrabold text-amber-600">{enTaller}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Mttos este mes</p>
              <p className="mt-1 text-4xl font-extrabold text-ran-blue">{actividadMes.total}</p>
            </article>
          </div>

          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.7fr_0.8fr_0.8fr]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(1)
                  }}
                  placeholder="Buscar por serie, modelo o establecimiento..."
                  className="h-11 rounded-xl border-slate-200 pl-10"
                />
              </div>

              <Select
                value={modelo}
                onValueChange={(value) => {
                  setModelo(value as ModeloFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200">
                  <SelectValue placeholder="Modelo: Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Modelo: Todos</SelectItem>
                  <SelectItem value="KM901">KM901</SelectItem>
                  <SelectItem value="MS1500">MS1500</SelectItem>
                  <SelectItem value="SD1002">SD1002</SelectItem>
                  <SelectItem value="KM1300">KM1300</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value as MaquinaStatusFilter)
                  setPage(1)
                }}
              >
                <SelectTrigger className="h-11 rounded-xl border-slate-200">
                  <SelectValue placeholder="Status: Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Status: Todos</SelectItem>
                  <SelectItem value="operando">Operando</SelectItem>
                  <SelectItem value="en_taller">En taller</SelectItem>
                  <SelectItem value="baja">Baja</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <HorizontalScrollArea>
              <table className="w-full min-w-[1220px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                    <th className="px-5 py-3">No. Serie</th>
                    <th className="px-3 py-3">Modelo</th>
                    <th className="px-3 py-3">Establecimiento</th>
                    <th className="px-3 py-3">Dirección</th>
                    <th className="px-3 py-3">Municipio</th>
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Historial</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                        No hay máquinas para los filtros aplicados.
                      </td>
                    </tr>
                  ) : pageRows.map((maquina) => (
                    <tr key={maquina.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                      <td className="px-5 py-3.5 font-semibold text-ran-navy">{maquina.serie}</td>
                      <td className="px-3 py-3.5">
                        <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-ran-navy">
                          {maquina.modelo}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{maquina.cliente?.nombre ?? 'Sin asignar'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{maquina.cliente?.direccion ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{maquina.cliente?.municipio ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{maquina.cliente?.telefono ?? '—'}</td>
                      <td className="px-3 py-3.5">
                        <MaquinaStatusBadge status={maquina.status} />
                      </td>
                      <td className="px-3 py-3.5">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg border-slate-200 px-3 text-xs font-semibold text-ran-navy hover:bg-ran-ice"
                          onClick={() => navigate(`/catalogos/maquinas/${maquina.id}/historial`)}
                        >
                          <History className="h-3.5 w-3.5" />
                          Ver historial
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          </div>

          <div className="mt-4 flex flex-col gap-3 text-ran-slate sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Mostrando {filteredMaquinas.length ? startIndex + 1 : 0}-{Math.min(endIndex, filteredMaquinas.length)} de {filteredMaquinas.length} máquinas
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(1)} disabled={currentPage === 1}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-ran-navy">
                {currentPage}
              </span>
              <span className="text-sm">de {totalPages}</span>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
