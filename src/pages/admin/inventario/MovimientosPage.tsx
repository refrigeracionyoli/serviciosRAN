import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Search } from 'lucide-react'
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
import type { MovimientoInventario } from '@/types/domain.types'
import { InventarioSubNav } from './InventarioSubNav'

type MovimientoFilter = 'all' | 'entrada' | 'salida' | 'ajuste'

const tipoConfig = {
  entrada: { label: 'Entrada', className: 'bg-green-100 text-green-800 border-green-200' },
  salida: { label: 'Salida', className: 'bg-red-100 text-red-800 border-red-200' },
  ajuste: { label: 'Ajuste', className: 'bg-blue-100 text-blue-800 border-blue-200' },
}

type MovimientoReferenceType = 'SERVICIO' | 'MTTO' | 'INV_TECNICO'

interface ParsedReference {
  type: MovimientoReferenceType
  id: number
  detail: string
}

function parseMovimientoReference(motivo: string | null): ParsedReference | null {
  if (!motivo) return null

  const match = motivo.match(/^\[(SERVICIO|MTTO|INV_TECNICO):(\d+)\]\s*(.*)$/)
  if (!match) return null

  return {
    type: match[1] as MovimientoReferenceType,
    id: Number(match[2]),
    detail: match[3] || motivo,
  }
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
      if (tipoFilter !== 'all' && row.tipo !== tipoFilter) return false

      if (!normalizedSearch) return true

      return [
        row.item?.nombre ?? '',
        row.usuario?.nombre ?? '',
        row.motivo ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch))
    })
  }, [data, search, tipoFilter])

  const stats = useMemo(() => {
    const entradas = filteredRows.filter((row) => row.tipo === 'entrada').length
    const salidas = filteredRows.filter((row) => row.tipo === 'salida').length
    const ajustes = filteredRows.filter((row) => row.tipo === 'ajuste').length

    return {
      total: filteredRows.length,
      entradas,
      salidas,
      ajustes,
    }
  }, [filteredRows])

  const columns = useMemo<ColumnDef<MovimientoInventario>[]>(() => {
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
          const config = tipoConfig[row.original.tipo]
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
        description="Historial de entradas, salidas y ajustes registrados"
        className="mb-4 px-0 pt-0 lg:px-0 lg:pt-0"
      />

      <InventarioSubNav />

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-2xl bg-white p-3 shadow-sm lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ran-slate">Movimientos</p>
          <p className="mt-1 text-2xl font-bold text-ran-navy">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700">Entradas</p>
          <p className="mt-1 text-2xl font-bold text-green-900">{stats.entradas}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Salidas</p>
          <p className="mt-1 text-2xl font-bold text-red-900">{stats.salidas}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Ajustes</p>
          <p className="mt-1 text-2xl font-bold text-blue-900">{stats.ajustes}</p>
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
            <SelectItem value="entrada">Entradas</SelectItem>
            <SelectItem value="salida">Salidas</SelectItem>
            <SelectItem value="ajuste">Ajustes</SelectItem>
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

      <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-ran-slate">
        Los movimientos se generan automaticamente desde: asignacion a inventario tecnico, instalacion de refacciones en servicios y mantenimientos.
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
