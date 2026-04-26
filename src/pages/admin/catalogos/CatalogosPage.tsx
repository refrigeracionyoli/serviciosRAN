import { useDeferredValue, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  MoreVertical,
  Plus,
  Search,
  Eye,
  Pencil,
  Trash2,
  Power,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import {
  AdminFilterBarSkeleton,
  AdminStatsGridSkeleton,
  AdminTableSkeleton,
} from '@/components/shared/AdminSkeletons'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useClientesQuery,
  useEditarClienteMutation,
  useEliminarClienteMutation,
} from '@/hooks/use-clientes'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { useEmpleadosQuery } from '@/hooks/use-tecnicos'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { useToast } from '@/hooks/use-toast'
import type { Cliente } from '@/types/domain.types'
import { CatalogosSubNav } from './CatalogosSubNav'

const PAGE_SIZE = 10

function normalizeText(value: string | null | undefined): string {
  if (!value) return ''
  return value.toLowerCase()
}

export function CatalogosPage() {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [clienteToDelete, setClienteToDelete] = useState<Cliente | null>(null)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const { data: clientes = [], isLoading } = useClientesQuery({ includeInactive: true })
  const { data: maquinas = [], isLoading: loadingMaquinas } = useMaquinasQuery()
  const { data: empleados = [], isLoading: loadingEmpleados } = useEmpleadosQuery()
  const { data: servicios = [], isLoading: loadingServicios } = useServiciosQuery()
  const { mutate: editarCliente, isPending: isUpdatingCliente } = useEditarClienteMutation()
  const { mutate: eliminarCliente, isPending: isDeletingCliente } = useEliminarClienteMutation()
  const isPageLoading = isLoading || loadingMaquinas || loadingEmpleados || loadingServicios

  const serviciosPorCliente = useMemo(() => {
    return servicios.reduce<Record<number, number>>((acc, servicio) => {
      if (!servicio.cliente_id) return acc
      acc[servicio.cliente_id] = (acc[servicio.cliente_id] ?? 0) + 1
      return acc
    }, {})
  }, [servicios])

  const maquinasPorCliente = useMemo(() => {
    return maquinas.reduce<Record<number, number>>((acc, maquina) => {
      if (!maquina.cliente_id) return acc
      acc[maquina.cliente_id] = (acc[maquina.cliente_id] ?? 0) + 1
      return acc
    }, {})
  }, [maquinas])

  const filteredClientes = useMemo(() => {
    if (!deferredSearch) return clientes

    return clientes.filter((cliente) => [
      cliente.codigo_cliente,
      cliente.nombre,
      cliente.municipio,
      cliente.direccion,
    ].some((value) => normalizeText(value).includes(deferredSearch)))
  }, [clientes, deferredSearch])

  const { totalClientes, activos, inactivos } = useMemo(() => {
    const total = filteredClientes.length
    const active = filteredClientes.reduce((count, cliente) => (cliente.activo ? count + 1 : count), 0)
    return {
      totalClientes: total,
      activos: active,
      inactivos: total - active,
    }
  }, [filteredClientes])

  const totalPages = Math.max(1, Math.ceil(filteredClientes.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * PAGE_SIZE
  const end = start + PAGE_SIZE
  const pageRows = filteredClientes.slice(start, end)

  const handleToggleStatus = (id: number, nextStatus: boolean) => {
    editarCliente(
      { id, data: { activo: nextStatus } },
      {
        onSuccess: () => {
          toast({
            title: nextStatus ? 'Cliente activado' : 'Cliente desactivado',
            description: 'El cambio se guardó correctamente.',
          })
        },
        onError: (error) => {
          toast({
            title: 'Error al actualizar cliente',
            description: error instanceof Error ? error.message : 'No se pudo actualizar el cliente.',
            variant: 'destructive',
          })
        },
      },
    )
  }

  const handleDeleteRequest = (cliente: Cliente) => {
    const serviciosRegistrados = serviciosPorCliente[cliente.id] ?? 0
    if (serviciosRegistrados > 0) {
      toast({
        title: 'No se puede eliminar el cliente',
        description: 'Este cliente ya tiene servicios registrados.',
        variant: 'destructive',
      })
      return
    }

    setClienteToDelete(cliente)
  }

  const handleDeleteConfirm = () => {
    if (!clienteToDelete) return

    eliminarCliente(clienteToDelete.id, {
      onSuccess: () => {
        toast({
          title: 'Cliente eliminado',
          description: `${clienteToDelete.nombre} fue eliminado correctamente.`,
        })
        setClienteToDelete(null)
      },
      onError: (error) => {
        const rawMessage = error instanceof Error ? error.message : 'No se pudo eliminar el cliente.'
        const message = /(foreign key|constraint|reference|referencia)/i.test(rawMessage)
          ? 'No se puede eliminar porque el cliente tiene información relacionada en otros módulos.'
          : rawMessage

        toast({
          title: 'Error al eliminar cliente',
          description: message,
          variant: 'destructive',
        })
      },
    })
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Catálogos</h1>
          <p className="mt-1 text-lg text-ran-slate">Administra clientes, empleados, máquinas y códigos del sistema</p>
        </div>

        <div className="flex w-full items-center justify-end lg:w-auto">
          <Button
            onClick={() => navigate('/catalogos/clientes/nuevo')}
            className="h-11 rounded-xl bg-ran-navy px-6 text-base font-semibold hover:bg-ran-navy/90"
          >
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </Button>
        </div>
      </div>

      <CatalogosSubNav />

      {isPageLoading ? (
        <>
          <AdminStatsGridSkeleton count={4} className="mb-3" />
          <AdminFilterBarSkeleton className="mb-3 lg:grid-cols-1" items={['max-w-md']} />
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <AdminTableSkeleton rows={6} columns={6} />
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Clientes registrados</p>
              <p className="mt-1 text-4xl font-extrabold text-ran-navy">{totalClientes}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Activos</p>
              <p className="mt-1 text-4xl font-extrabold text-green-600">{activos}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Inactivos</p>
              <p className="mt-1 text-4xl font-extrabold text-red-600">{inactivos}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-medium text-slate-500">Empleados activos</p>
              <p className="mt-1 text-4xl font-extrabold text-ran-blue">{empleados.length}</p>
            </article>
          </div>

          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ran-slate" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder="Buscar por nombre, código o municipio..."
                className="h-11 rounded-xl border-slate-200 pl-10"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <HorizontalScrollArea>
              <table className="w-full min-w-[1180px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                    <th className="px-5 py-3">Código</th>
                    <th className="px-3 py-3">Establecimiento</th>
                    <th className="px-3 py-3">Dirección</th>
                    <th className="px-3 py-3">Municipio</th>
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Máquinas</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="w-14 px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-16 text-center text-ran-slate">
                        No hay clientes para los filtros aplicados.
                      </td>
                    </tr>
                  ) : pageRows.map((cliente) => (
                    <tr key={cliente.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                      <td className="px-5 py-3.5 font-medium text-ran-slate">{cliente.codigo_cliente}</td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{cliente.nombre}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{cliente.direccion ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{cliente.municipio ?? '—'}</td>
                      <td className="px-3 py-3.5 text-ran-slate">{cliente.telefono ?? '—'}</td>
                      <td className="px-3 py-3.5 font-semibold text-ran-navy">{maquinasPorCliente[cliente.id] ?? 0}</td>
                      <td className="px-3 py-3.5">
                        {cliente.activo ? (
                          <Badge variant="outline" className="border-green-200 bg-green-100 text-green-800">
                            Activo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-red-200 bg-red-100 text-red-700">
                            Inactivo
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-3.5">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-ran-slate hover:bg-ran-ice">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52 rounded-xl p-1.5">
                            <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/catalogos/clientes/${cliente.id}`)}>
                              <Eye className="h-4 w-4" />
                              Ver detalle
                            </DropdownMenuItem>

                            <DropdownMenuItem className="cursor-pointer" onClick={() => navigate(`/catalogos/clientes/${cliente.id}/editar`)}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuItem
                              className="cursor-pointer"
                              disabled={isUpdatingCliente}
                              onClick={() => handleToggleStatus(cliente.id, !cliente.activo)}
                            >
                              <Power className="h-4 w-4" />
                              {cliente.activo ? 'Desactivar' : 'Reactivar'}
                            </DropdownMenuItem>

                            <DropdownMenuSeparator />

                            <DropdownMenuItem
                              className="cursor-pointer text-destructive focus:text-destructive"
                              disabled={isDeletingCliente}
                              onClick={() => handleDeleteRequest(cliente)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </HorizontalScrollArea>
          </div>

          <div className="mt-4 flex flex-col gap-3 text-ran-slate sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm">
              Mostrando {filteredClientes.length ? start + 1 : 0}-{Math.min(end, filteredClientes.length)} de {filteredClientes.length} clientes
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

      <ConfirmDialog
        open={Boolean(clienteToDelete)}
        onOpenChange={(open) => {
          if (!open) setClienteToDelete(null)
        }}
        title="¿Eliminar cliente?"
        description={
          clienteToDelete
            ? `Se eliminará "${clienteToDelete.nombre}" del catálogo. Esta acción no se puede deshacer.`
            : 'Esta acción no se puede deshacer.'
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        isLoading={isDeletingCliente}
      />
    </div>
  )
}
