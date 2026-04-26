import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AdminPageLoadingSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons'
import { HorizontalScrollArea } from '@/components/shared/HorizontalScrollArea'
import { useClienteDetalleQuery } from '@/hooks/use-clientes'
import { useMaquinasQuery } from '@/hooks/use-maquinas'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { formatDate } from '@/lib/utils'

export function ClienteDetallePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const clienteId = Number(id)
  const clienteIdValido = Number.isFinite(clienteId) ? clienteId : undefined

  const { data: cliente, isLoading } = useClienteDetalleQuery(clienteIdValido)
  const { data: maquinas = [], isLoading: loadingMaquinas } = useMaquinasQuery(clienteIdValido)
  const { data: servicios = [], isLoading: loadingServicios } = useServiciosQuery(
    clienteIdValido ? { clienteId: clienteIdValido } : undefined,
  )

  if (isLoading) {
    return <AdminPageLoadingSkeleton />
  }

  if (!cliente) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          No se encontró el cliente solicitado.
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate('/catalogos')}>
              Volver a catálogos
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <AdminBreadcrumbs items={['Catálogos', 'Clientes', cliente.nombre]} />

      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate('/catalogos')}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Detalle de cliente</h1>
            <p className="mt-1 text-lg text-ran-slate">{cliente.nombre}</p>
          </div>
        </div>

        <Button
          type="button"
          className="h-11 rounded-xl bg-ran-navy px-6 text-base font-semibold hover:bg-ran-navy/90"
          onClick={() => navigate(`/catalogos/clientes/${cliente.id}/editar`)}
        >
          <Pencil className="h-4 w-4" />
          Editar cliente
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
          <h3 className="text-base font-bold text-ran-navy">Datos del establecimiento</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-ran-slate lg:grid-cols-2">
            <p><span className="font-semibold text-ran-navy">Código:</span> {cliente.codigo_cliente}</p>
            <p><span className="font-semibold text-ran-navy">Nombre:</span> {cliente.nombre}</p>
            <p><span className="font-semibold text-ran-navy">Dirección:</span> {cliente.direccion ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Municipio:</span> {cliente.municipio ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Teléfono:</span> {cliente.telefono ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Correo:</span> {cliente.correo_contacto ?? '—'}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-ran-navy">Resumen</h3>
          <div className="mt-3 space-y-2 text-sm text-ran-slate">
            <p><span className="font-semibold text-ran-navy">Estado:</span>{' '}
              <Badge
                variant="outline"
                className={cliente.activo ? 'border-green-200 bg-green-100 text-green-800' : 'border-red-200 bg-red-100 text-red-700'}
              >
                {cliente.activo ? 'Activo' : 'Inactivo'}
              </Badge>
            </p>
            <p><span className="font-semibold text-ran-navy">Máquinas:</span> {maquinas.length}</p>
            <p><span className="font-semibold text-ran-navy">Servicios:</span> {servicios.length}</p>
            <p><span className="font-semibold text-ran-navy">Alta:</span> {formatDate(cliente.created_at)}</p>
          </div>
        </section>
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-bold text-ran-navy">Máquinas instaladas</h3>
        </div>
        <HorizontalScrollArea>
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                <th className="px-4 py-3">Serie</th>
                <th className="px-3 py-3">Modelo</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Instalación</th>
              </tr>
            </thead>
            <tbody>
              {loadingMaquinas && (
                <tr>
                  <td colSpan={4} className="px-4 py-4">
                    <AdminTableSkeleton rows={4} columns={4} />
                  </td>
                </tr>
              )}
              {!loadingMaquinas && maquinas.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-ran-slate">
                    Este cliente no tiene máquinas registradas.
                  </td>
                </tr>
              )}
              {!loadingMaquinas && maquinas.map((maquina) => (
                <tr key={maquina.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                  <td className="px-4 py-3.5 font-mono font-semibold text-ran-navy">{maquina.serie}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{maquina.modelo}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{maquina.status}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{formatDate(maquina.fecha_instalacion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HorizontalScrollArea>
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-bold text-ran-navy">Servicios recientes</h3>
        </div>
        <HorizontalScrollArea>
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                <th className="px-4 py-3">Orden</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">Máquina</th>
                <th className="px-3 py-3">Técnico</th>
                <th className="px-3 py-3">Fecha</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loadingServicios && (
                <tr>
                  <td colSpan={6} className="px-4 py-4">
                    <AdminTableSkeleton rows={4} columns={6} />
                  </td>
                </tr>
              )}
              {!loadingServicios && servicios.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-ran-slate">
                    Este cliente no tiene servicios registrados.
                  </td>
                </tr>
              )}
              {!loadingServicios && servicios.slice(0, 8).map((servicio) => (
                <tr key={servicio.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                  <td className="px-4 py-3.5 font-semibold text-ran-navy">{servicio.orden ? `#${servicio.orden}` : `#${servicio.id}`}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{servicio.tipo_servicio}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{servicio.maquina?.serie ?? '—'}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{servicio.tecnico?.nombre ?? 'Sin asignar'}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{formatDate(servicio.fecha_servicio)}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{servicio.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HorizontalScrollArea>
      </section>
    </div>
  )
}
