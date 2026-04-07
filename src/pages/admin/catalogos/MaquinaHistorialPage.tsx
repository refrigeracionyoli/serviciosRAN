import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable } from '@/components/shared/DataTable'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { useMaquinaTallerMovimientosQuery } from '@/hooks/use-maquinas-taller'
import { formatDate, formatMXN } from '@/lib/utils'
import type { ColumnDef } from '@tanstack/react-table'
import type { Servicio, MaquinaTallerMovimiento } from '@/types/domain.types'

const columns: ColumnDef<Servicio>[] = [
  { accessorKey: 'tipo_servicio', header: 'Tipo' },
  { accessorKey: 'tecnico_id', header: 'Técnico', cell: ({ row }) => row.original.tecnico?.nombre ?? '—' },
  { accessorKey: 'fecha_servicio', header: 'Fecha', cell: ({ row }) => formatDate(row.original.fecha_servicio) },
  { accessorKey: 'total', header: 'Total', cell: ({ row }) => formatMXN(row.original.total ?? 0) },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => <ServicioStatusBadge status={row.original.status} /> },
]

function getAccionBadgeClass(accion: MaquinaTallerMovimiento['accion']): string {
  if (accion === 'entrada') return 'border-blue-200 bg-blue-100 text-blue-800'
  if (accion === 'salida') return 'border-green-200 bg-green-100 text-green-800'
  if (accion === 'reubicacion') return 'border-amber-200 bg-amber-100 text-amber-800'
  return 'border-slate-200 bg-slate-100 text-slate-700'
}

function getAccionLabel(accion: MaquinaTallerMovimiento['accion']): string {
  if (accion === 'entrada') return 'Entrada'
  if (accion === 'salida') return 'Salida'
  if (accion === 'reubicacion') return 'Reubicación'
  return 'Nota'
}

const movimientosColumns: ColumnDef<MaquinaTallerMovimiento>[] = [
  {
    accessorKey: 'fecha_movimiento',
    header: 'Fecha',
    cell: ({ row }) => formatDate(row.original.fecha_movimiento),
  },
  {
    accessorKey: 'accion',
    header: 'Acción',
    cell: ({ row }) => (
      <Badge variant="outline" className={getAccionBadgeClass(row.original.accion)}>
        {getAccionLabel(row.original.accion)}
      </Badge>
    ),
  },
  {
    accessorKey: 'motivo',
    header: 'Motivo',
  },
  {
    id: 'origen-destino',
    header: 'Ruta',
    cell: ({ row }) => `${row.original.origen ?? 'Sin origen'} -> ${row.original.destino ?? 'Sin destino'}`,
  },
  {
    accessorKey: 'orden_servicio',
    header: 'Orden',
    cell: ({ row }) => (row.original.orden_servicio ? `#${row.original.orden_servicio}` : '—'),
  },
  {
    accessorKey: 'detalle',
    header: 'Detalle',
    cell: ({ row }) => row.original.detalle ?? '—',
  },
]

export function MaquinaHistorialPage() {
  const { id } = useParams<{ id: string }>()
  const maquinaId = Number(id)
  const maquinaIdValido = Number.isFinite(maquinaId) ? maquinaId : undefined
  const navigate = useNavigate()

  const { data: maquinas = [] } = useMaquinasQuery()
  const maquina = maquinas.find((m) => m.id === maquinaIdValido)

  const { data: servicios = [], isLoading } = useServiciosQuery()
  const historial = maquinaIdValido
    ? servicios.filter((s) => s.maquina_id === maquinaIdValido)
    : []
  const { data: movimientos = [], isLoading: loadingMovimientos } = useMaquinaTallerMovimientosQuery(maquinaIdValido)

  return (
    <div>
      <PageHeader
        title={maquina ? `Historial: ${maquina.serie}` : `Historial máquina #${id ?? '—'}`}
        description={maquina ? `${maquina.modelo} · ${maquina.cliente?.nombre ?? 'Sin cliente'}` : ''}
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
        }
      />

      <div className="space-y-6 p-6">
        <section>
          <h2 className="mb-2 text-lg font-bold text-ran-navy">Servicios relacionados</h2>
          <DataTable
            columns={columns}
            data={historial}
            isLoading={isLoading}
            emptyTitle="Sin servicios"
            emptyDescription="Esta máquina no tiene servicios registrados."
          />
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-ran-navy">Movimientos de taller</h2>
          <DataTable
            columns={movimientosColumns}
            data={movimientos}
            isLoading={loadingMovimientos}
            emptyTitle="Sin movimientos de taller"
            emptyDescription="Aún no hay entradas, salidas o reubicaciones registradas para esta máquina."
          />
        </section>
      </div>
    </div>
  )
}
