import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, ClipboardList, Plus } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AdminDashboardSkeleton } from '@/components/shared/AdminSkeletons'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { PageHeader } from '@/components/shared/PageHeader'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { WeeklyReportExportDialog } from '@/components/shared/WeeklyReportExportDialog'
import { useInventarioQuery } from '@/hooks/use-inventario'
import { useMaquinasEnTallerQuery } from '@/hooks/use-maquinas-taller'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import { useToast } from '@/hooks/use-toast'
import { cn, formatDate, formatMXN, formatWeek } from '@/lib/utils'
import type { WeeklyReportProgress } from '@/lib/reportes-export'
import type { FiltrosServicio, Servicio, ServicioStatus } from '@/types/domain.types'

// ─── Types ───────────────────────────────────────────────────────────────────

type DashboardRange = 'all' | 'day' | 'week' | 'month'

interface ChartBucket {
  key: string
  label: string
  value: number
}

interface RevenueBucket {
  label: string
  total: number
}

const INITIAL_WEEKLY_EXPORT_PROGRESS: WeeklyReportProgress = {
  progress: 2,
  stage: 'Generando reporte semanal',
  detail: 'Iniciando la exportación y preparando el entorno de descarga...',
  completedServices: 0,
  totalServices: 0,
}

// ─── Date helpers ────────────────────────────────────────────────────────────

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function startOfWeek(date: Date): Date {
  const dayStart = startOfDay(date)
  const day = dayStart.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  dayStart.setDate(dayStart.getDate() + diffToMonday)
  return dayStart
}

function endOfWeek(date: Date): Date {
  const saturday = startOfWeek(date)
  saturday.setDate(saturday.getDate() + 5)
  return saturday
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = value.trim()
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T00:00:00`)
    : new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function getServicioReferenceDate(servicio: Servicio): string | null {
  return servicio.fecha_servicio ?? servicio.fecha_solicitud ?? servicio.created_at ?? null
}

function isWithinRange(date: Date, range: DashboardRange, now: Date): boolean {
  if (range === 'all') return true
  if (range === 'day') return startOfDay(date).getTime() === startOfDay(now).getTime()
  if (range === 'week') {
    const currentDay = startOfDay(date).getTime()
    return currentDay >= startOfWeek(now).getTime() && currentDay <= endOfWeek(now).getTime()
  }
  return startOfDay(date).getTime() >= startOfMonth(now).getTime()
}

function getRangeLabel(range: DashboardRange): string {
  if (range === 'day') return 'hoy'
  if (range === 'week') return 'esta semana'
  if (range === 'month') return 'este mes'
  return 'todo el tiempo'
}

function getDashboardFetchStart(range: DashboardRange, now: Date): string | null {
  if (range === 'all') return null
  if (range === 'day') {
    const start = new Date(now)
    start.setDate(now.getDate() - 6)
    return formatLocalIsoDate(start)
  }
  if (range === 'week') return formatLocalIsoDate(startOfWeek(now))
  return formatLocalIsoDate(startOfMonth(now))
}

function getDashboardFetchEnd(range: DashboardRange, now: Date): string | null {
  if (range === 'all') return null
  if (range === 'month') return formatLocalIsoDate(endOfMonth(now))
  if (range === 'week') return formatLocalIsoDate(endOfWeek(now))
  return formatLocalIsoDate(now)
}

function getWeekBounds(date: Date): { inicio: string; fin: string } {
  const monday = startOfWeek(date)
  const saturday = endOfWeek(date)

  return {
    inicio: formatLocalIsoDate(monday),
    fin: formatLocalIsoDate(saturday),
  }
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

function buildServiciosFilters(input: Partial<FiltrosServicio>): FiltrosServicio {
  return {
    status: input.status ?? null,
    tecnicoId: input.tecnicoId ?? null,
    clienteId: input.clienteId ?? null,
    fechaDesde: input.fechaDesde ?? null,
    fechaHasta: input.fechaHasta ?? null,
    tipoServicio: input.tipoServicio ?? null,
    search: input.search ?? null,
  }
}

function mergeServiciosById(rows: Servicio[]): Servicio[] {
  const byId = new Map<number, Servicio>()
  for (const row of rows) {
    byId.set(row.id, row)
  }
  return Array.from(byId.values())
}

// ─── Service helpers ─────────────────────────────────────────────────────────

function getServiceTotal(servicio: Servicio): number {
  if (typeof servicio.total === 'number' && Number.isFinite(servicio.total)) return servicio.total
  const manoObra = Number(servicio.costo_mano_obra ?? 0)
  const refacciones = Number(servicio.costo_refacciones ?? 0)
  return manoObra + refacciones
}

function isFinishedStatus(status: ServicioStatus): boolean {
  return status === 'completado' || status === 'cerrado'
}

function buildStatusCounts(servicios: Servicio[]): Record<ServicioStatus, number> {
  return servicios.reduce<Record<ServicioStatus, number>>(
    (acc, s) => { acc[s.status] += 1; return acc },
    { pendiente: 0, en_ruta: 0, completado: 0, cerrado: 0 },
  )
}

// ─── Chart subtitle ──────────────────────────────────────────────────────────

function getChartSubtitle(range: DashboardRange): string {
  if (range === 'all') return 'Últimos 12 meses'
  if (range === 'month') return 'Semanas del mes actual'
  if (range === 'week') return 'Días de la semana actual'
  return 'Últimos 7 días'
}

// ─── Bucket builders ─────────────────────────────────────────────────────────

function buildCompletionBuckets(range: DashboardRange, servicios: Servicio[], now: Date): ChartBucket[] {
  const finished = servicios.filter((s) => isFinishedStatus(s.status))

  if (range === 'all') {
    const buckets: ChartBucket[] = []
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(d).replace('.', '')
      buckets.push({ key, label, value: 0 })
    }
    const map = new Map(buckets.map((b) => [b.key, b]))
    finished.forEach((s) => {
      const d = parseDate(getServicioReferenceDate(s))
      if (!d) return
      const bucket = map.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      if (bucket) bucket.value += 1
    })
    return buckets
  }

  if (range === 'month') {
    const mStart = startOfMonth(now)
    const mEnd = endOfMonth(now)
    const buckets: ChartBucket[] = []
    const cursor = new Date(mStart)
    let idx = 1
    while (cursor <= mEnd) {
      const bStart = new Date(cursor)
      const bEnd = new Date(cursor)
      bEnd.setDate(bEnd.getDate() + 6)
      if (bEnd > mEnd) bEnd.setTime(mEnd.getTime())
      buckets.push({ key: `${formatLocalIsoDate(bStart)}-${formatLocalIsoDate(bEnd)}`, label: `Sem ${idx}`, value: 0 })
      cursor.setDate(cursor.getDate() + 7)
      idx += 1
    }
    finished.forEach((s) => {
      const d = parseDate(getServicioReferenceDate(s))
      if (!d || d < mStart || d > mEnd) return
      const diff = Math.floor((startOfDay(d).getTime() - startOfDay(mStart).getTime()) / 86400000)
      const b = buckets[Math.floor(diff / 7)]
      if (b) b.value += 1
    })
    return buckets
  }

  if (range === 'week') {
    const wStart = startOfWeek(now)
    const buckets: ChartBucket[] = []
    for (let i = 0; i < 6; i += 1) {
      const d = new Date(wStart)
      d.setDate(wStart.getDate() + i)
      buckets.push({
        key: formatLocalIsoDate(d),
        label: new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(d).replace('.', ''),
        value: 0,
      })
    }
    const map = new Map(buckets.map((b) => [b.key, b]))
    finished.forEach((s) => {
      const d = parseDate(getServicioReferenceDate(s))
      if (!d) return
      const b = map.get(formatLocalIsoDate(d))
      if (b) b.value += 1
    })
    return buckets
  }

  // 'day' — last 7 days for context
  const buckets: ChartBucket[] = []
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    buckets.push({
      key: formatLocalIsoDate(d),
      label: new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit' }).format(d),
      value: 0,
    })
  }
  const map = new Map(buckets.map((b) => [b.key, b]))
  finished.forEach((s) => {
    const d = parseDate(getServicioReferenceDate(s))
    if (!d) return
    const b = map.get(formatLocalIsoDate(d))
    if (b) b.value += 1
  })
  return buckets
}

function buildRevenueBuckets(range: DashboardRange, servicios: Servicio[], now: Date): RevenueBucket[] {
  if (range === 'all') {
    const buckets: RevenueBucket[] = []
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = new Intl.DateTimeFormat('es-MX', { month: 'short' }).format(d).replace('.', '')
      buckets.push({ label, total: 0 })
      const keyRef = key // capture
      servicios.forEach((s) => {
        const sd = parseDate(getServicioReferenceDate(s))
        if (!sd) return
        if (`${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}` === keyRef) {
          buckets[buckets.length - 1].total += getServiceTotal(s)
        }
      })
    }
    return buckets
  }

  if (range === 'month') {
    const mStart = startOfMonth(now)
    const mEnd = endOfMonth(now)
    const buckets: RevenueBucket[] = []
    const cursor = new Date(mStart)
    let idx = 1
    while (cursor <= mEnd) {
      const bEnd = new Date(cursor)
      bEnd.setDate(bEnd.getDate() + 6)
      if (bEnd > mEnd) bEnd.setTime(mEnd.getTime())
      buckets.push({ label: `Sem ${idx}`, total: 0 })
      const bStart = new Date(cursor)
      servicios.forEach((s) => {
        const d = parseDate(getServicioReferenceDate(s))
        if (!d || d < bStart || d > bEnd) return
        buckets[buckets.length - 1].total += getServiceTotal(s)
      })
      cursor.setDate(cursor.getDate() + 7)
      idx += 1
    }
    return buckets
  }

  if (range === 'week') {
    const wStart = startOfWeek(now)
    const buckets: RevenueBucket[] = []
    for (let i = 0; i < 6; i += 1) {
      const d = new Date(wStart)
      d.setDate(wStart.getDate() + i)
      const iso = formatLocalIsoDate(d)
      const label = new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(d).replace('.', '')
      buckets.push({ label, total: 0 })
      servicios.forEach((s) => {
        const sd = parseDate(getServicioReferenceDate(s))
        if (!sd) return
        if (formatLocalIsoDate(sd) === iso) {
          buckets[buckets.length - 1].total += getServiceTotal(s)
        }
      })
    }
    return buckets
  }

  // day — last 7 days
  const buckets: RevenueBucket[] = []
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const iso = formatLocalIsoDate(d)
    const label = new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: '2-digit' }).format(d)
    buckets.push({ label, total: 0 })
    servicios.forEach((s) => {
      const sd = parseDate(getServicioReferenceDate(s))
      if (!sd) return
      if (formatLocalIsoDate(sd) === iso) {
        buckets[buckets.length - 1].total += getServiceTotal(s)
      }
    })
  }
  return buckets
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string
  value: string | number
  subtitle: string
  badgeLabel: string
  tone: 'navy' | 'green' | 'amber' | 'red'
}

const KPI_TONE = {
  navy:  { value: 'text-ran-navy',    badge: 'border-ran-blue/20 bg-ran-ice text-ran-navy',         bg: 'bg-white' },
  green: { value: 'text-emerald-700', badge: 'border-emerald-200 bg-emerald-100 text-emerald-700',  bg: 'bg-white' },
  amber: { value: 'text-amber-700',   badge: 'border-amber-200 bg-amber-100 text-amber-700',       bg: 'bg-white' },
  red:   { value: 'text-red-700',     badge: 'border-red-200 bg-red-100 text-red-700',             bg: 'bg-red-50/40' },
} as const

function KpiCard({ title, value, subtitle, badgeLabel, tone }: KpiCardProps) {
  const s = KPI_TONE[tone]
  return (
    <article className={cn('rounded-2xl border border-slate-200 p-4 shadow-sm', s.bg)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold', s.badge)}>
          {badgeLabel}
        </span>
      </div>
      <p className={cn('mt-3 text-3xl font-extrabold tracking-tight', s.value)}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
    </article>
  )
}

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CFG: Record<ServicioStatus, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: '#f59e0b' },
  en_ruta:    { label: 'En ruta',    color: '#3b82f6' },
  completado: { label: 'Completado', color: '#10b981' },
  cerrado:    { label: 'Cerrado',    color: '#475569' },
}

const STATUS_KEYS: ServicioStatus[] = ['pendiente', 'en_ruta', 'completado', 'cerrado']

// ─── Pie chart custom label ──────────────────────────────────────────────────

interface PieLabelProps {
  cx?: number
  cy?: number
  midAngle?: number
  innerRadius?: number
  outerRadius?: number
  percent?: number
  value?: number
}

function renderPieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }: PieLabelProps) {
  if (
    typeof cx !== 'number'
    || typeof cy !== 'number'
    || typeof midAngle !== 'number'
    || typeof innerRadius !== 'number'
    || typeof outerRadius !== 'number'
    || typeof percent !== 'number'
    || typeof value !== 'number'
  ) {
    return null
  }

  if (percent < 0.05) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={13} fontWeight={700}>
      {value}
    </text>
  )
}

// ─── Recharts tooltip ────────────────────────────────────────────────────────

interface TooltipPayload {
  name?: string
  value?: number
  color?: string
  payload?: Record<string, unknown>
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-semibold text-ran-navy">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-slate-600">
          {entry.name}: <span className="font-semibold" style={{ color: entry.color }}>{entry.value}</span>
        </p>
      ))}
    </div>
  )
}

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-semibold text-ran-navy">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-slate-600">
          Ingreso: <span className="font-semibold text-ran-navy">{formatMXN(entry.value ?? 0)}</span>
        </p>
      ))}
    </div>
  )
}

// ─── Dashboard Page ──────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [range, setRange] = useState<DashboardRange>('week')
  const [isExportingWeekly, setIsExportingWeekly] = useState(false)
  const [weeklyExportProgress, setWeeklyExportProgress] = useState<WeeklyReportProgress | null>(null)
  const weeklyExportAbortRef = useRef<AbortController | null>(null)
  const now = useMemo(() => new Date(), [])
  const todayIso = formatLocalIsoDate(now)
  const rangeLabel = getRangeLabel(range)

  const serviciosPeriodoFilters = useMemo(() => buildServiciosFilters({
    fechaDesde: getDashboardFetchStart(range, now),
    fechaHasta: getDashboardFetchEnd(range, now),
  }), [now, range])
  const serviciosPendientesFilters = useMemo(() => buildServiciosFilters({ status: 'pendiente' }), [])
  const serviciosEnRutaFilters = useMemo(() => buildServiciosFilters({ status: 'en_ruta' }), [])

  const { data: serviciosPeriodo = [], isLoading: loadingServiciosPeriodo } = useServiciosQuery(serviciosPeriodoFilters)
  const { data: serviciosPendientesRows = [], isLoading: loadingServiciosPendientes } = useServiciosQuery(serviciosPendientesFilters)
  const { data: serviciosEnRutaRows = [], isLoading: loadingServiciosEnRuta } = useServiciosQuery(serviciosEnRutaFilters)
  const { data: tecnicos = [], isLoading: loadingTecnicos } = useTecnicosQuery()
  const { data: inventario = [], isLoading: loadingInventario } = useInventarioQuery()
  const { data: maquinasEnTaller = [], isLoading: loadingMaquinasEnTaller } = useMaquinasEnTallerQuery({ soloAbiertas: true })
  const isDashboardLoading = (
    loadingServiciosPeriodo
    || loadingServiciosPendientes
    || loadingServiciosEnRuta
    || loadingTecnicos
    || loadingInventario
    || loadingMaquinasEnTaller
  )

  useEffect(() => {
    return () => {
      weeklyExportAbortRef.current?.abort()
      weeklyExportAbortRef.current = null
    }
  }, [])

  // ── Computed data ────────────────────────────────────────────────

  const serviciosAbiertosActuales = useMemo(
    () => mergeServiciosById([...serviciosPendientesRows, ...serviciosEnRutaRows]),
    [serviciosEnRutaRows, serviciosPendientesRows],
  )

  const servicios = useMemo(
    () => mergeServiciosById([...serviciosPeriodo, ...serviciosAbiertosActuales]),
    [serviciosAbiertosActuales, serviciosPeriodo],
  )

  const serviciosConFecha = useMemo(
    () => serviciosPeriodo.map((servicio) => ({
      servicio,
      fechaReferencia: parseDate(getServicioReferenceDate(servicio)),
    })),
    [serviciosPeriodo],
  )

  const serviciosFiltrados = useMemo(
    () =>
      serviciosConFecha
        .filter((item) => item.fechaReferencia && isWithinRange(item.fechaReferencia, range, now))
        .map((item) => item.servicio),
    [now, range, serviciosConFecha],
  )

  const totalPeriodo = serviciosFiltrados.length
  const statusCounts = useMemo(() => buildStatusCounts(serviciosFiltrados), [serviciosFiltrados])
  const cumplimiento = totalPeriodo
    ? Math.round(((statusCounts.completado + statusCounts.cerrado) / totalPeriodo) * 100)
    : 0
  const cumplimientoTone = cumplimiento >= 80 ? 'green' : cumplimiento >= 50 ? 'amber' : 'red'

  const chartBuckets = useMemo(
    () => buildCompletionBuckets(range, servicios, now),
    [now, range, servicios],
  )
  const totalCompletados = chartBuckets.reduce((acc, b) => acc + b.value, 0)

  const revenueBuckets = useMemo(
    () => buildRevenueBuckets(range, serviciosFiltrados, now),
    [now, range, serviciosFiltrados],
  )
  const totalRevenue = revenueBuckets.reduce((acc, b) => acc + b.total, 0)

  const pieData = useMemo(
    () => STATUS_KEYS
      .map((key) => ({ name: STATUS_CFG[key].label, value: statusCounts[key], color: STATUS_CFG[key].color }))
      .filter((d) => d.value > 0),
    [statusCounts],
  )

  const cargaTecnicos = useMemo(() => {
    const grouped = serviciosAbiertosActuales.reduce<Record<string, { pendientes: number; enRuta: number }>>((acc, s) => {
      if (!s.tecnico_id) return acc
      if (!acc[s.tecnico_id]) acc[s.tecnico_id] = { pendientes: 0, enRuta: 0 }
      if (s.status === 'pendiente') acc[s.tecnico_id].pendientes += 1
      if (s.status === 'en_ruta') acc[s.tecnico_id].enRuta += 1
      return acc
    }, {})
    return tecnicos
      .map((t) => {
        const cur = grouped[t.id] ?? { pendientes: 0, enRuta: 0 }
        return { id: t.id, nombre: t.nombre, pendientes: cur.pendientes, enRuta: cur.enRuta, abiertos: cur.pendientes + cur.enRuta }
      })
      .sort((a, b) => b.abiertos !== a.abiertos ? b.abiertos - a.abiertos : a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [serviciosAbiertosActuales, tecnicos])

  const clientesTop = useMemo(() => {
    const grouped = serviciosFiltrados.reduce<Record<string, { nombre: string; cantidad: number; total: number }>>((acc, s) => {
      const key = s.cliente?.id ? String(s.cliente.id) : 'sin-cliente'
      const nombre = s.cliente?.nombre ?? 'Sin cliente'
      if (!acc[key]) acc[key] = { nombre, cantidad: 0, total: 0 }
      acc[key].cantidad += 1
      acc[key].total += getServiceTotal(s)
      return acc
    }, {})
    return Object.values(grouped).sort((a, b) => b.cantidad - a.cantidad).slice(0, 6)
  }, [serviciosFiltrados])

  const recientes = useMemo(
    () =>
      [...serviciosFiltrados]
        .sort((a, b) => {
          const fA = parseDate(getServicioReferenceDate(a))?.getTime() ?? 0
          const fB = parseDate(getServicioReferenceDate(b))?.getTime() ?? 0
          return fA !== fB ? fB - fA : (b.id ?? 0) - (a.id ?? 0)
        })
        .slice(0, 8),
    [serviciosFiltrados],
  )

  const lowStockItems = useMemo(
    () => inventario.filter((i) => i.stock_actual <= i.stock_minimo).sort((a, b) => a.stock_actual - b.stock_actual).slice(0, 5),
    [inventario],
  )

  const serviciosPendientesAbiertos = useMemo(
    () => serviciosPendientesRows.length,
    [serviciosPendientesRows],
  )
  const serviciosPendientesPeriodo = statusCounts.pendiente

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

      const exportDate = new Date()
      const weekRange = getWeekBounds(exportDate)
      const semana = formatWeek(exportDate)

      const { exportWeeklyReportBundle } = await import('@/lib/reportes-export')
      const result = await exportWeeklyReportBundle({
        semana,
        fechaInicio: weekRange.inicio,
        fechaFin: weekRange.fin,
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

      toast({
        title: 'Error al exportar',
        description: error instanceof Error ? error.message : 'Error al exportar reporte semanal',
        variant: 'destructive',
      })
    } finally {
      weeklyExportAbortRef.current = null
      setWeeklyExportProgress(null)
      setIsExportingWeekly(false)
    }
  }

  const handleExportServicios = async () => {
    if (serviciosFiltrados.length === 0) {
      toast({ title: 'Sin datos para exportar', description: `No hay servicios registrados para ${rangeLabel}.` })
      return
    }

    try {
      const { exportServiciosExcel } = await import('@/lib/servicios-export')
      await exportServiciosExcel({
        servicios: serviciosFiltrados,
        filename: `servicios-dashboard-${range}-${todayIso}.xlsx`,
        periodLabel: `Dashboard (${rangeLabel})`,
      })
      toast({ title: 'Exportación lista', description: `Se generó el Excel con ${serviciosFiltrados.length} servicios.` })
    } catch (error) {
      toast({
        title: 'Error al exportar',
        description: error instanceof Error ? error.message : 'No fue posible generar el archivo.',
        variant: 'destructive',
      })
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  if (isDashboardLoading) {
    return (
      <div className="min-h-full bg-ran-gray pb-8">
        <PageHeader
          title="Panel principal"
          description="Resumen operativo — completados, costos, técnicos y alertas"
          actions={(
            <Select value={range} onValueChange={(v) => setRange(v as DashboardRange)}>
              <SelectTrigger className="h-10 w-[190px] rounded-lg border-slate-300 bg-white text-sm font-medium">
                <SelectValue placeholder="Rango" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el tiempo</SelectItem>
                <SelectItem value="day">Hoy</SelectItem>
                <SelectItem value="week">Esta semana</SelectItem>
                <SelectItem value="month">Este mes</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <AdminDashboardSkeleton />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-ran-gray pb-8">
      <PageHeader
        title="Panel principal"
        description="Resumen operativo — completados, costos, técnicos y alertas"
        actions={(
          <Select value={range} onValueChange={(v) => setRange(v as DashboardRange)}>
            <SelectTrigger className="h-10 w-[190px] rounded-lg border-slate-300 bg-white text-sm font-medium">
              <SelectValue placeholder="Rango" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el tiempo</SelectItem>
              <SelectItem value="day">Hoy</SelectItem>
              <SelectItem value="week">Esta semana</SelectItem>
              <SelectItem value="month">Este mes</SelectItem>
            </SelectContent>
          </Select>
        )}
      />

      <div className="space-y-4 px-6 pt-5">

        {/* ── KPI Row ───────────────────────────────────────────── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            title={`Servicios (${rangeLabel})`}
            value={totalPeriodo}
            subtitle="Total en el periodo seleccionado"
            badgeLabel="Periodo"
            tone="navy"
          />
          <KpiCard
            title="Servicios pendientes"
            value={serviciosPendientesPeriodo}
            subtitle={`Pendientes en ${rangeLabel}`}
            badgeLabel="Pendientes"
            tone="amber"
          />
          <KpiCard
            title="Cumplimiento"
            value={`${cumplimiento}%`}
            subtitle={`${statusCounts.completado + statusCounts.cerrado} finalizados`}
            badgeLabel={cumplimiento >= 80 ? 'En objetivo' : cumplimiento >= 50 ? 'Regular' : 'Bajo'}
            tone={cumplimientoTone}
          />
          <KpiCard
            title="Máquinas en taller"
            value={maquinasEnTaller.length}
            subtitle="Diagnóstico o reparación activa"
            badgeLabel="Taller"
            tone="amber"
          />
          <KpiCard
            title="Stock bajo"
            value={lowStockItems.length}
            subtitle="Artículos por debajo del mínimo"
            badgeLabel="Alerta"
            tone="red"
          />
        </div>

        {/* ── Quick actions ─────────────────────────────────────── */}
        <div className="grid gap-3 xl:grid-cols-3">
          <Button
            variant="outline"
            className="h-10 justify-start gap-2 rounded-lg border-slate-300 bg-white px-4 text-sm font-semibold text-ran-navy"
            onClick={() => navigate('/servicios/nuevo')}
          >
            <Plus className="h-4 w-4" />
            Nuevo servicio
          </Button>
          <Button
            variant="outline"
            className="h-10 justify-start gap-2 rounded-lg border-slate-300 bg-white px-4 text-sm font-semibold text-ran-navy"
            onClick={handleExportWeeklyReport}
            disabled={isExportingWeekly}
          >
            <CalendarDays className="h-4 w-4" />
            {isExportingWeekly ? 'Generando reporte semanal...' : 'Reporte semanal'}
          </Button>
          <Button
            variant="outline"
            className="h-10 justify-start gap-2 rounded-lg border-slate-300 bg-white px-4 text-sm font-semibold text-ran-navy"
            onClick={handleExportServicios}
          >
            <ClipboardList className="h-4 w-4" />
            Exportar servicios
          </Button>
        </div>

        {/* ── Servicios recientes (promoted to top) ─────────────── */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold text-ran-navy">Servicios recientes</h2>
              <p className="text-xs text-ran-slate">Los más recientes del periodo — {rangeLabel}</p>
            </div>
            <Link to="/servicios" className="inline-flex items-center gap-1 text-sm font-semibold text-ran-navy hover:text-ran-navy/80">
              Ver todos
              <ArrowRight className="h-4 w-4" />
            </Link>
          </header>
          {recientes.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-ran-slate">
              Sin servicios para el filtro actual.
            </div>
          ) : (
            <HorizontalScrollArea>
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50/80 text-ran-slate">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Orden</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Tipo</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Fecha</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Técnico</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {recientes.map((servicio) => (
                    <tr key={servicio.id} className="border-t border-slate-100 hover:bg-ran-ice/30">
                      <td className="px-4 py-2.5 font-semibold text-ran-navy">{servicio.orden ?? `#${servicio.id}`}</td>
                      <td className="px-3 py-2.5 text-ran-slate">{servicio.cliente?.nombre ?? 'Sin cliente'}</td>
                      <td className="px-3 py-2.5 text-ran-slate">{servicio.tipo_servicio}</td>
                      <td className="px-3 py-2.5 text-ran-slate">{formatDate(getServicioReferenceDate(servicio))}</td>
                      <td className="px-3 py-2.5 text-ran-slate">{servicio.tecnico?.nombre ?? '—'}</td>
                      <td className="px-3 py-2.5 text-right font-semibold text-ran-navy">{formatMXN(getServiceTotal(servicio))}</td>
                      <td className="px-3 py-2.5">
                        <ServicioStatusBadge status={servicio.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          )}
        </section>

        {/* ── Charts row: Bar chart + Pie chart ─────────────────── */}
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">

          {/* Servicios completados — Recharts BarChart */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ran-navy">Servicios completados</h2>
                <p className="text-sm text-ran-slate">{getChartSubtitle(range)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total</p>
                <p className="text-3xl font-extrabold text-ran-navy">{totalCompletados}</p>
              </div>
            </div>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartBuckets} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#5b9fd6" stopOpacity={1} />
                      <stop offset="100%" stopColor="#1b3b6f" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(27,59,111,0.04)' }} />
                  <Bar dataKey="value" name="Completados" fill="url(#barGrad)" radius={[6, 6, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Distribución por estado — Recharts PieChart */}
          <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2">
              <h2 className="text-lg font-semibold text-ran-navy">Distribución por estado</h2>
              <p className="text-sm text-ran-slate">{totalPeriodo} servicios</p>
            </div>

            <div className="flex flex-1 items-center justify-center">
              {pieData.length === 0 ? (
                <p className="text-sm text-ran-slate">Sin datos en el periodo.</p>
              ) : (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        labelLine={false}
                        label={renderPieLabel}
                        strokeWidth={0}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        verticalAlign="bottom"
                        iconType="circle"
                        iconSize={8}
                        wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── Revenue area chart + Carga técnicos ───────────────── */}
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr]">

          {/* Revenue trend — Recharts AreaChart */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-ran-navy">Ingresos por periodo</h2>
                <p className="text-sm text-ran-slate">{getChartSubtitle(range)}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Total</p>
                <p className="text-2xl font-extrabold text-ran-navy">{formatMXN(totalRevenue)}</p>
              </div>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueBuckets} margin={{ top: 8, right: 4, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`}
                  />
                  <Tooltip content={<RevenueTooltip />} cursor={{ stroke: '#10b981', strokeWidth: 1, strokeDasharray: '4 3' }} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="Ingreso"
                    stroke="#059669"
                    strokeWidth={2.5}
                    fill="url(#areaGrad)"
                    dot={{ r: 4, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#059669', strokeWidth: 2, stroke: '#fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Carga activa por técnico — compact cards */}
          <section className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-ran-navy">Carga por técnico</h2>
              <p className="text-sm text-ran-slate">Pendientes y en ruta</p>
            </div>
            {cargaTecnicos.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-ran-slate">
                Sin técnicos activos.
              </div>
            ) : (
              <div className="space-y-2.5 overflow-y-auto">
                {cargaTecnicos.map((tecnico) => (
                  <div key={tecnico.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ran-navy">{tecnico.nombre}</p>
                      <span className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
                        tecnico.abiertos > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500',
                      )}>
                        {tecnico.abiertos}
                      </span>
                    </div>
                    <div className="flex gap-3 text-[11px]">
                      <span className="flex items-center gap-1 text-amber-600">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        {tecnico.pendientes} pend.
                      </span>
                      <span className="flex items-center gap-1 text-blue-600">
                        <span className="h-2 w-2 rounded-full bg-blue-500" />
                        {tecnico.enRuta} ruta
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── Alerts + Top clients ──────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">

          {/* Alertas operativas */}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ran-navy">Alertas operativas</h2>
              <Link to="/inventario" className="text-xs font-semibold text-ran-navy hover:text-ran-navy/80">Ver inventario</Link>
            </div>
            <div className="space-y-4">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    Stock bajo
                  </span>
                </div>
                {lowStockItems.length === 0 ? (
                  <p className="text-sm text-emerald-600">Sin alertas activas.</p>
                ) : (
                  <div className="space-y-1.5">
                    {lowStockItems.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 text-sm">
                        <p className="font-semibold text-ran-navy">{item.nombre}</p>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                          {item.stock_actual} / {item.stock_minimo}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    En taller
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm">
                  <p className="font-semibold text-ran-navy">Máquinas en taller</p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                    {maquinasEnTaller.length}
                  </span>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-100 px-2.5 py-1 text-[11px] font-semibold text-orange-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                    Servicios pendientes
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-orange-100 bg-orange-50/60 px-3 py-2 text-sm">
                  <p className="font-semibold text-ran-navy">Pendientes por atender</p>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-700">
                    {serviciosPendientesAbiertos}
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Top clients */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-semibold text-ran-navy">Clientes con mayor actividad</h2>
              <p className="text-xs text-ran-slate">Filtrado por: {rangeLabel}</p>
            </header>
            {clientesTop.length === 0 ? (
              <div className="px-4 py-16 text-center text-sm text-ran-slate">Sin datos disponibles.</div>
            ) : (
              <HorizontalScrollArea>
                <table className="w-full min-w-[380px] text-sm">
                  <thead className="bg-slate-50/80 text-ran-slate">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Servicios</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Monto total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientesTop.map((cliente, i) => (
                      <tr key={cliente.nombre} className="border-t border-slate-100">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ran-ice text-[11px] font-bold text-ran-navy">{i + 1}</span>
                            <span className="font-semibold text-ran-navy">{cliente.nombre}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-ran-slate">{cliente.cantidad}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-ran-navy">{formatMXN(cliente.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HorizontalScrollArea>
            )}
          </section>
        </div>

      </div>

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
