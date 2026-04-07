import type { ColumnDef } from '@tanstack/react-table'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable } from '@/components/shared/DataTable'
import { Badge } from '@/components/ui/badge'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import type { Profile } from '@/types/domain.types'

const columns: ColumnDef<Profile>[] = [
  { accessorKey: 'nombre', header: 'Nombre' },
  { accessorKey: 'correo', header: 'Correo' },
  { accessorKey: 'telefono', header: 'Teléfono', cell: ({ row }) => row.original.telefono ?? '—' },
  { accessorKey: 'especialidad', header: 'Especialidad', cell: ({ row }) => row.original.especialidad ?? '—' },
  {
    accessorKey: 'activo',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant="outline" className={row.original.activo ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}>
        {row.original.activo ? 'Activo' : 'Inactivo'}
      </Badge>
    ),
  },
]

export function TecnicosPage() {
  const { data: tecnicos = [], isLoading } = useTecnicosQuery()

  return (
    <div>
      <PageHeader title="Técnicos" description="Usuarios con rol técnico" />
      <div className="p-6">
        <DataTable columns={columns} data={tecnicos} isLoading={isLoading} emptyTitle="Sin técnicos registrados" />
      </div>
    </div>
  )
}
