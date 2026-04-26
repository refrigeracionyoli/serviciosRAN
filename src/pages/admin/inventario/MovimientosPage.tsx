import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import {
  AdminFilterBarSkeleton,
  AdminStatsGridSkeleton,
} from '@/components/shared/AdminSkeletons'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable } from '@/components/shared/DataTable'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useInventarioQuery, useMovimientosQuery } from '@/hooks/use-inventario'
import { formatDateTime } from '@/lib/utils'
import type { MovimientoInventario, MovimientoTipo } from '@/types/domain.types'
import { InventarioSubNav } from './InventarioSubNav'

type MovimientoFilter = 'all' | MovimientoTipo

const tipoConfig: Record<MovimientoTipo, { label: string; className: string }> = {
  entrada: { label: 'Entrada manual', className: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  salida: { label: 'Salida manual', className: 'bg-rose-50 text-rose-800 border-rose-200' },
  ajuste: { label: 'Ajuste', className: 'bg-sky-50 text-sky-800 border-sky-200' },
  alta_inventario: { label: 'Alta inventario', className: 'bg-green-50 text-green-800 border-green-200' },
  asignacion_tecnico: { label: 'Asignacion tecnico', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  devolucion_tecnico: { label: 'Devolucion tecnico', className: 'bg-cyan-50 text-cyan-800 border-cyan-200' },
  instalacion_refaccion: { label: 'Instalacion', className: 'bg-violet-50 text-violet-800 border-violet-200' },
  correccion_instalacion: { label: 'Correccion de Instalacion', className: 'bg-slate-100 text-slate-800 border-slate-300' },
}

const tipoOptions = Object.entries(tipoConfig) as Array<[MovimientoTipo, { label: string; className: string }]>

type MovimientoReferenceType = 'SERVICIO' | 'MTTO' | 'INV_TECNICO'

interface ParsedReference {
  type: MovimientoReferenceType
  id: number
  detail: string
}

function parseMovimientoReference(motivo: string | null): ParsedReference | null {
  if (!motivo) return null

  const match = /^\[(SERVICIO|MTTO|INV_TECNICO):(\d+)\]\s*(.*)$/.exec(motivo)
  if (!match) return null

  return {
    type: match[1] as MovimientoReferenceType,
    id: Number(match[2]),
    detail: match[3] || motivo,
  }
}

function getMovimientoDisplayTipo(row: MovimientoInventario): MovimientoTipo {
  const motivo = row.motivo?.toLowerCase() ?? ''
  const rawTipo = row.tipo as string

  if (rawTipo === 'reversion_instalacion') return 'correccion_instalacion'

  if (rawTipo === 'entrada' || rawTipo === 'salida') {
    if (motivo.includes('correccion de instalacion') || motivo.includes('reversion de instalacion')) return 'correccion_instalacion'
    if (motivo.includes('instalacion a')) return 'instalacion_refaccion'
    if (motivo.includes('movimiento a inventario de tecnico')) return 'asignacion_tecnico'
    if (
      motivo.includes('devolucion de inventario de tecnico')
      || motivo.includes('devolucion automatica de inventario de tecnico')
      || motivo.includes('eliminacion de inventario de tecnico')
    ) {
      return 'devolucion_tecnico'
    }
    if (motivo.includes('alta inicial de inventario')) return 'alta_inventario'
  }

  return row.tipo
}

function buildReferenceLink(reference: ParsedReference): { to: string; label: string } {
  if (reference.type === 'SERVICIO') {
    return { to: `/servicios/${reference.id}`, label: `Servicio #${reference.id}` }
  }

  if (reference.type === 'MTTO') {
    return { to: `/polizas/mantenimientos/${reference.id}`, label: `Mantenimiento #${reference.id}` }
  }

  return { to: '/inventario/tecnico', label: 'Inventario técnico' }
}

export function MovimientosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const itemParam = searchParams.get('item') ?? 'all'
  const [search, setSearch] = useState('')
  const [tipoFilter, setTipoFilter] = useState<MovimientoFilter>('all')
  const [itemFilter, setItemFilter] = useState(itemParam)

  const itemFilterId = itemFilter !== 'all' ? Number(itemFilter) : undefined
  const validItemFilterId = itemFilterId && Number.isFinite(itemFilterId) ? itemFilterId : undefined

  const { data: inventario = [] } = useInventarioQuery({ includeInactive: true })
  const { data = [], isLoading } = useMovimientosQuery(validItemFilterId)
  const isPageLoading = isLoading

  useEffect(() => {
    setItemFilter(itemParam)
  }, [itemParam])

  useEffect(() => {
    if (itemParam === itemFilter) return

    const params = new URLSearchParams(searchParams)

    if (itemFilter === 'all') {
      params.delete('item')
    } else {
      params.set('item', itemFilter)
    }

    setSearchParams(params, { replace: true })
  }, [itemFilter, itemParam, searchParams, setSearchParams])

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return data.filter((row) => {
      const displayTipo = getMovimientoDisplayTipo(row)
      if (tipoFilter !== 'all' && displayTipo !== tipoFilter) return false

      if (!normalizedSearch) return true

      return [
        row.item?.nombre ?? '',
        row.usuario?.nombre ?? '',
        row.motivo ?? '',
        tipoConfig[displayTipo].label,
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [data, search, tipoFilter])

  const stats = useMemo(() => {
    const tipos = filteredRows.map(getMovimientoDisplayTipo)
    const instalaciones = tipos.filter((tipo) => tipo === 'instalacion_refaccion').length
    const tecnico = tipos.filter((tipo) => tipo === 'asignacion_tecnico' || tipo === 'devolucion_tecnico').length
    const manuales = tipos.filter((tipo) => (
      tipo === 'entrada'
      || tipo === 'salida'
      || tipo === 'alta_inventario'
      || tipo === 'ajuste'
    )).length
    const correcciones = tipos.filter((tipo) => tipo === 'correccion_instalacion').length

    return {
      total: filteredRows.length,
      instalaciones,
      tecnico,
      manuales,
      correcciones,
    }
  }, [filteredRows])

  const columns = useMemo<Array<ColumnDef<MovimientoInventario>>>(() => {
    return [
      {
        header: 'Item',
        accessorKey: 'inventario_id',
        cell: ({ row }) => row.original.item?.nombre ?? `Item ${row.original.inventario_id}`,
      },
      {
        header: 'Tipo',
        accessorKey: 'tipo',
        cell: ({ row }) => {
          const displayTipo = getMovimientoDisplayTipo(row.original)
          const config = tipoConfig[displayTipo]
          return (
            <Badge variant="outline" className={config.className}>
              {config.label}
            </Badge>
          )
        },
      },
      {
        header: 'Cantidad',
        accessorKey: 'cantidad',
      },
      {
        header: 'Referencia',
        id: 'referencia',
        cell: ({ row }) => {
          const parsed = parseMovimientoReference(row.original.motivo)
          if (!parsed) return '—'

          const link = buildReferenceLink(parsed)
          return (
            <Link
              to={link.to}
              className="text-sm font-semibold text-ran-navy underline underline-offset-2 hover:text-ran-navy/80"
            >
              {link.label}
            </Link>
          )
        },
      },
      {
        header: 'Detalle',
        accessorKey: 'motivo',
        cell: ({ row }) => {
          const parsed = parseMovimientoReference(row.original.motivo)
          return parsed?.detail ?? row.original.motivo ?? '—'
        },
      },
      {
        header: 'Usuario',
        accessorKey: 'usuario_id',
        cell: ({ row }) => row.original.usuario?.nombre ?? '—',
      },
      {
        header: 'Fecha',
        accessorKey: 'created_at',
        cell: ({ row }) => formatDateTime(row.original.created_at),
      },
    ]
  }, [])

  return (
    <div className="p-5 lg:p-7">
      <PageHeader
        title="Movimientos de inventario"
        description="Historial de movimientos manuales, tecnicos e instalaciones"
        className="mb-4 px-0 pt-0 lg:px-0 lg:pt-0"
      />

      <InventarioSubNav />

      {isPageLoading ? (
        <>
          <AdminStatsGridSkeleton count={5} className="mb-4" />
          <AdminFilterBarSkeleton className="mb-4 lg:grid-cols-[1.6fr_1fr_1fr]" items={['', '', '']} />
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">Movimientos</p>
              <p className="mt-1 text-2xl font-bold text-ran-navy">{stats.total}</p>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Instalaciones</p>
              <p className="mt-1 text-2xl font-bold text-violet-950">{stats.instalaciones}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Inventario tecnico</p>
              <p className="mt-1 text-2xl font-bold text-amber-950">{stats.tecnico}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Manuales</p>
              <p className="mt-1 text-2xl font-bold text-emerald-950">{stats.manuales}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">Correcciones</p>
              <p className="mt-1 text-2xl font-bold text-ran-navy">{stats.correcciones}</p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-[1.6fr_1fr_1fr]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por item, usuario o motivo..."
                className="h-11 rounded-xl border-slate-200 pl-10"
              />
            </div>

            <Select value={tipoFilter} onValueChange={(value) => setTipoFilter(value as MovimientoFilter)}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {tipoOptions.map(([value, config]) => (
                  <SelectItem key={value} value={value}>{config.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={itemFilter} onValueChange={setItemFilter}>
              <SelectTrigger className="h-11 rounded-xl border-slate-200">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los items</SelectItem>
                {inventario.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ran-slate">
        Los movimientos se generan automaticamente desde: alta de inventario, ajustes manuales, asignacion o devolucion de tecnico, instalacion y correccion de refacciones.
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <DataTable
          columns={columns}
          data={filteredRows}
          isLoading={isLoading}
          emptyTitle="Sin movimientos"
          emptyDescription="No hay movimientos de inventario registrados."
          pageSize={15}
        />
      </div>
    </div>
  )
}
