import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BarChart3, ClipboardList, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageHeader } from '@/components/shared/PageHeader'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useInventarioQuery } from '@/hooks/use-inventario'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import type { Servicio } from '@/types/domain.types'

type DashboardRange = 'day' | 'week' | 'month'

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function parseDate(value: string | null | undefined) {
  if (!value) return null

  const normalized = value.trim()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00`)
    : new Date(normalized)

  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function inRange(value: string | null | undefined, range: DashboardRange, now: Date) {
  const parsed = parseDate(value)
  if (!parsed) return false

  if (range === 'day') {
    return startOfDay(parsed).getTime() === startOfDay(now).getTime()
  }
  if (range === 'week') {
    return startOfDay(parsed).getTime() >= startOfWeek(now).getTime()
  }
  return startOfDay(parsed).getTime() >= startOfMonth(now).getTime()
}

function getServicioReferenceDate(servicio: Servicio): string | null {
  return servicio.fecha_servicio ?? servicio.fecha_solicitud ?? servicio.created_at ?? null
}

export function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('week')
  const now = new Date()

  const { data: servicios = [], isLoading } = useServiciosQuery()
  const { data: inventario = [] } = useInventarioQuery()

  const serviciosFiltrados = useMemo(
    () => servicios.filter((s) => inRange(getServicioReferenceDate(s), range, now)),
    [servicios, range, now],
  )

  const pendientes = serviciosFiltrados.filter((s) => s.status === 'pendiente').length
  const enRuta = serviciosFiltrados.filter((s) => s.status === 'en_ruta').length
  const completados = serviciosFiltrados.filter((s) => s.status === 'completado').length
  const cerrados = serviciosFiltrados.filter((s) => s.status === 'cerrado').length

  const recientes = [...serviciosFiltrados].sort((a, b) => (b.id ?? 0) - (a.id ?? 0)).slice(0, 6)

  const tecnicosActivos = [...serviciosFiltrados]
    .filter((s) => s.tecnico?.nombre)
    .reduce<Record<string, number>>((acc, s) => {
      const nombre = s.tecnico?.nombre ?? 'Sin técnico'
      acc[nombre] = (acc[nombre] ?? 0) + 1
      return acc
    }, {})

  const tecnicosList = Object.entries(tecnicosActivos).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const finalizados = completados + cerrados
  const totalServicios = Math.max(serviciosFiltrados.length, 1)
  const porcentaje = Math.round((finalizados / totalServicios) * 100)

  const rangeLabel = range === 'day' ? 'hoy' : range === 'week' ? 'esta semana' : 'este mes'

  const lowStock = inventario
    .filter((item) => item.stock_actual <= item.stock_minimo)
    .sort((a, b) => a.stock_actual - b.stock_actual)[0]

  return (
    <div className="min-h-full bg-ran-gray pb-8">
      <PageHeader
        title="Panel principal"
        description="Resumen operativo"
        actions={
          <Select value={range} onValueChange={(value) => setRange(value as DashboardRange)}>
            <SelectTrigger className="h-10 w-[160px] rounded-lg border-slate-300 bg-white text-sm font-medium">
              <SelectValue placeholder="Rango" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Hoy</SelectItem>
              <SelectItem value="week">Esta semana</SelectItem>
              <SelectItem value="month">Este mes</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="space-y-5 px-6 pt-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Pendientes</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{isLoading ? '...' : pendientes}</p>
            <p className="mt-1 text-xs text-slate-500">Por asignar</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-500">En ruta</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{isLoading ? '...' : enRuta}</p>
            <p className="mt-1 text-xs text-slate-500">Técnicos en campo</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Completados</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{isLoading ? '...' : completados}</p>
            <p className="mt-1 text-xs text-slate-500">{rangeLabel}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Cerrados</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{isLoading ? '...' : cerrados}</p>
            <p className="mt-1 text-xs text-slate-500">Aprobados</p>
          </article>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-slate-900">Servicios recientes</h2>
              <Link to="/servicios" className="inline-flex items-center gap-1 text-sm font-semibold text-ran-navy hover:text-ran-navy/80">
                Ver todos
                <ArrowRight className="h-4 w-4" />
              </Link>
            </header>

            {recientes.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm text-slate-500">
                {isLoading ? 'Cargando...' : 'Sin servicios registrados'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-100/80 text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Orden</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Técnico</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recientes.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100 text-slate-600">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{s.orden ?? `#${s.id}`}</td>
                      <td className="px-3 py-2.5">{s.cliente?.nombre ?? 'Sin cliente'}</td>
                      <td className="px-3 py-2.5">{s.tipo_servicio}</td>
                      <td className="px-3 py-2.5">{s.tecnico?.nombre ?? 'Sin técnico'}</td>
                      <td className="px-3 py-2.5"><ServicioStatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">Cumplimiento</h3>
              <p className="mt-2 text-3xl font-bold text-slate-900">{finalizados} / {totalServicios}</p>
              <p className="mt-1 text-xs text-slate-500">Servicios finalizados ({rangeLabel})</p>

              <div className="mt-3 h-2 rounded-full bg-slate-200">
                <div className="h-2 rounded-full bg-green-600" style={{ width: `${Math.min(porcentaje, 100)}%` }} />
              </div>
              <p className="mt-2 text-sm font-semibold text-green-700">{porcentaje}% completado</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-900">Técnicos activos</h3>
              <div className="mt-3 space-y-2">
                {tecnicosList.length === 0 ? (
                  <p className="text-sm text-slate-500">Sin actividad registrada</p>
                ) : (
                  tecnicosList.map(([nombre, cantidad], index) => (
                    <div key={nombre} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span className={`h-8 w-8 rounded-lg ${index % 3 === 0 ? 'bg-amber-100' : index % 3 === 1 ? 'bg-blue-100' : 'bg-emerald-100'}`} />
                        <span className="text-sm font-medium text-slate-800">{nombre}</span>
                      </div>
                      <span className="text-xl font-bold text-slate-900">{cantidad}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr_320px]">
          <Button
            variant="outline"
            className="h-10 justify-start gap-2 rounded-lg border-slate-300 bg-white px-4 text-sm font-semibold text-ran-navy"
            onClick={() => navigate('/servicios/nuevo')}
          >
            <Plus className="h-4 w-4" />
            Nuevo servicio
          </Button>
          <Button variant="outline" className="h-10 justify-start gap-2 rounded-lg border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600">
            <BarChart3 className="h-4 w-4" />
            Generar reporte semanal
          </Button>
          <Button variant="outline" className="h-10 justify-start gap-2 rounded-lg border-slate-300 bg-white px-4 text-sm font-semibold text-slate-600">
            <ClipboardList className="h-4 w-4" />
            Exportar servicios
          </Button>

          <div className="rounded-lg border border-red-200/90 bg-red-50 px-4 py-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />
              <div>
                <p className="text-sm font-bold text-red-700">Stock bajo</p>
                <p className="mt-1 text-xs text-red-600">
                  {lowStock
                    ? `${lowStock.nombre}: ${lowStock.stock_actual} uds (minimo: ${lowStock.stock_minimo})`
                    : 'Sin alertas de inventario activas'}
                </p>
                <Link to="/inventario" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-red-700 hover:text-red-800">
                  Ver inventario <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
