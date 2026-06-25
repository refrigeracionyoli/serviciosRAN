import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Search } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  AdminFilterBarSkeleton,
  AdminPageLoadingSkeleton,
  AdminTableSkeleton,
} from '@/components/shared/AdminSkeletons'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { usePolizasQuery } from '@/hooks/use-polizas'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { normalizeServiceType } from '@/lib/service-types'
import { formatDate, formatMXN } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

type HistorialOrigen = 'servicio' | 'mantenimiento'

interface HistorialMaquinaRow {
  id: string
  origen: HistorialOrigen
  origenId: number
  fecha: string | null
  fechaOrden: string
  year: string
  tipo: string
  descripcion: string | null
  tecnico: string
  refacciones: number
  manoObra: number
  total: number
  aviso: string
}

function toSortableDate(value: string | null | undefined): string {
  if (!value) return '0000-00-00'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '0000-00-00'
  return parsed.toISOString().slice(0, 10)
}

function getYearFromDate(dateValue: string | null | undefined): string {
  const sortable = toSortableDate(dateValue)
  return sortable !== '0000-00-00' ? sortable.slice(0, 4) : 'Sin año'
}

function normalizeText(value: string | null | undefined): string {
  if (!value) return ''
  return value.toLowerCase()
}

function getTipoBadgeClass(tipo: string, origen: HistorialOrigen): string {
  const normalized = normalizeServiceType(tipo)

  if (origen === 'mantenimiento' || normalized.includes('MTTO')) {
    return 'border-blue-200 bg-blue-100 text-blue-800'
  }
  if (normalized.includes('INSTALACION')) {
    return 'border-green-200 bg-green-100 text-green-800'
  }
  if (normalized.includes('RETIRO')) {
    return 'border-amber-200 bg-amber-100 text-amber-800'
  }
  if (normalized.includes('GARANTIA')) {
    return 'border-violet-200 bg-violet-100 text-violet-800'
  }
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

export function MaquinaHistorialPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const maquinaId = Number(id)
  const maquinaIdValido = Number.isFinite(maquinaId) ? maquinaId : null

  const [search, setSearch] = useState('')
  const [tipoFilter, setTipoFilter] = useState<'all' | string>('all')
  const [anioFilter, setAnioFilter] = useState<'all' | string>('all')

  const { data: maquinas = [], isLoading: loadingMaquinas } = useMaquinasQuery({ includeInactive: true })
  const { data: serviciosData = [], isLoading: loadingServicios } = useServiciosQuery()
  const { data: mantenimientosData = [], isLoading: loadingMantenimientos } = useMantenimientosQuery()
  const { data: polizasData = [], isLoading: loadingPolizas } = usePolizasQuery()
  const maquina = useMemo(
    () => maquinas.find((item) => item.id === maquinaIdValido) ?? null,
    [maquinaIdValido, maquinas],
  )

  const servicios = useMemo(
    () => serviciosData.filter((servicio) => servicio.maquina_id === maquinaIdValido),
    [maquinaIdValido, serviciosData],
  )

  const mantenimientos = useMemo(
    () => mantenimientosData.filter((mantenimiento) => mantenimiento.maquina_id === maquinaIdValido),
    [maquinaIdValido, mantenimientosData],
  )

  const polizas = useMemo(
    () => polizasData.filter((poliza) => poliza.maquina_id === maquinaIdValido),
    [maquinaIdValido, polizasData],
  )

  const historialRows = useMemo(() => {
    const serviciosRows: HistorialMaquinaRow[] = servicios.map((servicio) => {
      const fecha = servicio.fecha_servicio ?? servicio.fecha_solicitud ?? toSortableDate(servicio.created_at)
      return {
        id: `servicio-${servicio.id}`,
        origen: 'servicio',
        origenId: servicio.id,
        fecha,
        fechaOrden: toSortableDate(fecha),
        year: getYearFromDate(fecha),
        tipo: servicio.tipo_servicio,
        descripcion: servicio.descripcion,
        tecnico: servicio.tecnico?.nombre ?? 'Sin técnico',
        refacciones: Number(servicio.costo_refacciones ?? 0),
        manoObra: Number(servicio.costo_mano_obra ?? 0),
        total: Number(servicio.total ?? 0),
        aviso: servicio.aviso ? String(servicio.aviso) : (servicio.orden ? String(servicio.orden) : '—'),
      }
    })

    const mantenimientosRows: HistorialMaquinaRow[] = mantenimientos.map((mantenimiento) => {
      const fecha = mantenimiento.fecha_visita ?? toSortableDate(mantenimiento.created_at)
      return {
        id: `mantenimiento-${mantenimiento.id}`,
        origen: 'mantenimiento',
        origenId: mantenimiento.id,
        fecha,
        fechaOrden: toSortableDate(fecha),
        year: getYearFromDate(fecha),
        tipo: mantenimiento.tipo_servicio,
        descripcion: mantenimiento.descripcion ?? mantenimiento.notas,
        tecnico: mantenimiento.tecnico?.nombre ?? 'Sin técnico',
        refacciones: Number(mantenimiento.costo_refacciones ?? 0),
        manoObra: Number(mantenimiento.costo_mano_obra ?? 0),
        total: Number(mantenimiento.total ?? 0),
        aviso: '—',
      }
    })

    return [...serviciosRows, ...mantenimientosRows]
      .sort((a, b) => b.fechaOrden.localeCompare(a.fechaOrden))
  }, [mantenimientos, servicios])

  const tipoOptions = useMemo(() => {
    const unique = new Set(historialRows.map((row) => row.tipo))
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
  }, [historialRows])

  const anioOptions = useMemo(() => {
    const unique = new Set(historialRows.map((row) => row.year))
    return Array.from(unique)
      .filter((year) => year !== 'Sin año')
      .sort((a, b) => b.localeCompare(a))
  }, [historialRows])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()

    return historialRows.filter((row) => {
      if (tipoFilter !== 'all' && row.tipo !== tipoFilter) return false
      if (anioFilter !== 'all' && row.year !== anioFilter) return false

      if (!term) return true

      return [
        row.tipo,
        row.descripcion,
        row.tecnico,
        row.aviso,
        row.fecha,
        formatDate(row.fecha),
      ].some((value) => normalizeText(value).includes(term))
    })
  }, [anioFilter, historialRows, search, tipoFilter])

  const polizaActiva = polizas.find((poliza) => poliza.activa) ?? polizas[0] ?? null
  const ultimoMantenimiento = historialRows.find((row) => row.origen === 'mantenimiento') ?? null
  const totalMantenimientos = historialRows.filter((row) => row.origen === 'mantenimiento').length
  const totalEventos = historialRows.length
  const isLoading = loadingMaquinas || loadingServicios || loadingMantenimientos || loadingPolizas
  const isHistoryLoading = loadingServicios || loadingMantenimientos || loadingPolizas

  if (!maquinaIdValido) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          El identificador de máquina no es válido.
        </div>
      </div>
    )
  }

  if (isLoading && !maquina) {
    return <AdminPageLoadingSkeleton />
  }

  if (!isLoading && !maquina) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          No se encontró la máquina solicitada.
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate('/catalogos/maquinas')}>
              Volver a máquinas
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/catalogos/maquinas')}
          className="rounded-lg border border-slate-200 bg-white p-2 text-ran-slate transition-colors hover:bg-ran-ice hover:text-ran-navy"
          aria-label="Volver"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <AdminBreadcrumbs
          items={['Catálogos', 'Máquinas', maquina?.serie ?? `#${maquinaIdValido}`]}
          className="mb-0"
        />
      </div>

      <div className="mb-3">
        <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">
          {maquina ? `${maquina.cliente?.nombre ?? 'Sin cliente'} — ${maquina.serie}` : 'Historial de máquina'}
        </h1>
        {maquina ? (
          <p className="mt-1 text-lg text-ran-slate">
            {`${maquina.modelo} · ${maquina.cliente?.direccion ?? 'Sin dirección'} · ${maquina.cliente?.municipio ?? 'Sin municipio'} · Tel: ${maquina.cliente?.telefono ?? '—'}`}
          </p>
        ) : (
          <Skeleton className="mt-2 h-6 w-[540px] max-w-full rounded-full" />
        )}
      </div>

      {isHistoryLoading ? (
        <>
          <section className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={2} columns={6} />
          </section>

          <AdminFilterBarSkeleton
            className="mb-3 lg:grid-cols-[1.35fr_0.9fr_0.65fr]"
            items={['', '', '']}
          />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={6} columns={6} />
          </section>
        </>
      ) : (
        <>
          <section className="mb-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="grid grid-cols-2 gap-3 text-xs text-ran-slate md:grid-cols-4 xl:grid-cols-8">
              <div>
                <p className="font-semibold uppercase">Serie</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{maquina?.serie ?? '—'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">Modelo</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{maquina?.modelo ?? '—'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">No. cliente</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{maquina?.cliente?.codigo_cliente ?? '—'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">Municipio</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{maquina?.cliente?.municipio ?? '—'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">Instalada</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{formatDate(maquina?.fecha_instalacion)}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">Póliza</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{polizaActiva?.activa ? 'Activa' : (polizaActiva ? 'Inactiva' : 'Sin póliza')}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">Último mtto</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{formatDate(ultimoMantenimiento?.fecha ?? null)}</p>
              </div>
              <div>
                <p className="font-semibold uppercase">Total eventos</p>
                <p className="mt-0.5 text-sm font-bold text-ran-navy">{totalEventos} ({totalMantenimientos} mttos)</p>
              </div>
            </div>
          </section>

          <section className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_0.9fr_0.65fr]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por fecha, tipo, técnico, descripción o aviso..."
                  className="h-11 rounded-xl border-slate-200 pl-10"
                />
              </div>

              <Select value={tipoFilter} onValueChange={setTipoFilter}>
                <SelectTrigger className="h-11 rounded-xl border-slate-200">
                  <SelectValue placeholder="Tipo: Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tipo: Todos</SelectItem>
                  {tipoOptions.map((tipo) => (
                    <SelectItem key={tipo} value={tipo}>
                      {tipo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={anioFilter} onValueChange={setAnioFilter}>
                <SelectTrigger className="h-11 rounded-xl border-slate-200">
                  <SelectValue placeholder="Año: Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Año: Todos</SelectItem>
                  {anioOptions.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <HorizontalScrollArea>
              <table className="w-full min-w-[1280px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                    <th className="px-5 py-3">Fecha</th>
                    <th className="px-3 py-3">Tipo</th>
                    <th className="px-3 py-3">Descripción</th>
                    <th className="px-3 py-3">Técnico</th>
                    <th className="px-3 py-3">Refacciones</th>
                    <th className="px-3 py-3">M. de obra</th>
                    <th className="px-3 py-3">Total</th>
                    <th className="px-3 py-3">Aviso</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                        No hay registros para los filtros aplicados.
                      </td>
                    </tr>
                  ) : filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                      <td className="px-5 py-3.5 font-semibold text-ran-navy">{formatDate(row.fecha)}</td>
                      <td className="px-3 py-3.5">
                        <Badge variant="outline" className={getTipoBadgeClass(row.tipo, row.origen)}>
                          {row.tipo}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5 text-ran-slate">{row.descripcion ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{row.tecnico}</td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{formatMXN(row.refacciones)}</td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{formatMXN(row.manoObra)}</td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{formatMXN(row.total)}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{row.aviso}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          </section>
        </>
      )}
    </div>
  )
}
