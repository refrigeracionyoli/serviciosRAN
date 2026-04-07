import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from 'react-router-dom'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable } from '@/components/shared/DataTable'
import { MaquinaStatusBadge } from '@/components/shared/StatusBadge'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { formatDate } from '@/lib/utils'
import type { Maquina } from '@/types/domain.types'

const columns: ColumnDef<Maquina>[] = [
  { accessorKey: 'serie', header: 'Serie', cell: ({ row }) => <span className="font-mono font-medium">{row.original.serie}</span> },
  { accessorKey: 'modelo', header: 'Modelo' },
  { header: 'Cliente', accessorKey: 'cliente_id', cell: ({ row }) => row.original.cliente?.nombre ?? 'Sin asignar' },
  { accessorKey: 'fecha_instalacion', header: 'Instalación', cell: ({ row }) => formatDate(row.original.fecha_instalacion) },
  { accessorKey: 'status', header: 'Status', cell: ({ row }) => <MaquinaStatusBadge status={row.original.status} /> },
  {
    id: 'acciones',
    header: '',
    cell: function ActCell({ row }) {
      const navigate = useNavigate()
      return (
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(`/catalogos/maquinas/${row.original.id}/historial`)}>
          <History className="h-3 w-3" />
          Historial
        </Button>
      )
    },
  },
]

export function MaquinasPage() {
  const { data: maquinas = [], isLoading } = useMaquinasQuery()

  return (
    <div>
      <PageHeader title="Máquinas" description="Catálogo de equipos" />
      <div className="p-6">
        <DataTable columns={columns} data={maquinas} isLoading={isLoading} emptyTitle="Sin máquinas registradas" />
      </div>
    </div>
  )
}
