import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MantenimientoStatusBadge } from '@/components/shared/StatusBadge'
import { usePolizasQuery } from '@/hooks/use-polizas'
import { useMantenimientosQuery } from '@/hooks/use-mantenimientos'
import { formatDate, formatMXN } from '@/lib/utils'

function getFechaVisitaSortValue(fechaVisita: string | null): number {
  if (!fechaVisita) return 0

  const parsed = new Date(fechaVisita)
  if (Number.isNaN(parsed.getTime())) return 0

  return parsed.getTime()
}

export function PolizaDetallePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const polizaId = Number(id)

  const { data: polizas = [], isLoading } = usePolizasQuery()
  const { data: mantenimientos = [], isLoading: loadingMantenimientos } = useMantenimientosQuery(polizaId)

  const poliza = polizas.find((item) => item.id === polizaId)

  const ultimosMantenimientos = useMemo(
    () =>
      [...mantenimientos]
        .sort((a, b) => getFechaVisitaSortValue(b.fecha_visita) - getFechaVisitaSortValue(a.fecha_visita))
        .slice(0, 8),
    [mantenimientos],
  )

  const ultimoMantenimiento = ultimosMantenimientos.find((mantenimiento) => Boolean(mantenimiento.fecha_visita)) ?? null

  if (isLoading) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          Cargando detalle de póliza...
        </div>
      </div>
    )
  }

  if (!poliza) {
    return (
      <div className="p-5 lg:p-7">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-16 text-center text-ran-slate">
          No se encontró la póliza solicitada.
          <div className="mt-4">
            <Button variant="outline" onClick={() => navigate('/polizas')}>
              Volver a pólizas
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate('/polizas')}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-ran-navy">Detalle de póliza</h1>
            <p className="mt-1 text-lg text-ran-slate">
              {poliza.cliente?.nombre ?? 'Sin sucursal'} · {poliza.maquina?.serie ?? 'Sin serie'}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => navigate(`/polizas/mantenimientos?poliza=${poliza.id}`)}
        >
          <ClipboardList className="h-4 w-4" />
          Ver mantenimientos
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-ran-navy">Establecimiento</h3>
          <div className="mt-3 space-y-2 text-sm text-ran-slate">
            <p><span className="font-semibold text-ran-navy">Código:</span> {poliza.cliente?.codigo_cliente ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Nombre:</span> {poliza.cliente?.nombre ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Dirección:</span> {poliza.cliente?.direccion ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Municipio:</span> {poliza.cliente?.municipio ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Teléfono:</span> {poliza.cliente?.telefono ?? '—'}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-ran-navy">Máquina</h3>
          <div className="mt-3 space-y-2 text-sm text-ran-slate">
            <p><span className="font-semibold text-ran-navy">Modelo:</span> {poliza.maquina?.modelo ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Serie:</span> {poliza.maquina?.serie ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Status:</span> {poliza.maquina?.status ?? '—'}</p>
            <p><span className="font-semibold text-ran-navy">Instalación:</span> {formatDate(poliza.maquina?.fecha_instalacion ?? null)}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-ran-navy">Póliza</h3>
          <div className="mt-3 space-y-2 text-sm text-ran-slate">
            <p>
              <span className="font-semibold text-ran-navy">Estado:</span>{' '}
              <Badge
                variant="outline"
                className={poliza.activa ? 'border-green-200 bg-green-100 text-green-800' : 'border-slate-200 bg-slate-100 text-slate-700'}
              >
                {poliza.activa ? 'Activa' : 'Inactiva'}
              </Badge>
            </p>
            <p><span className="font-semibold text-ran-navy">Inicio:</span> {formatDate(poliza.fecha_inicio)}</p>
            <p><span className="font-semibold text-ran-navy">Creada:</span> {formatDate(poliza.created_at)}</p>
            <p><span className="font-semibold text-ran-navy">Total mantenimientos:</span> {mantenimientos.length}</p>
            <p><span className="font-semibold text-ran-navy">Última visita:</span> {ultimoMantenimiento ? formatDate(ultimoMantenimiento.fecha_visita) : 'Sin visitas'}</p>
            <p><span className="font-semibold text-ran-navy">Observaciones:</span> {poliza.observaciones ?? 'Sin observaciones'}</p>
          </div>
        </section>
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-base font-bold text-ran-navy">Historial de mantenimientos</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs font-bold uppercase tracking-wide text-ran-slate">
                <th className="px-4 py-3">Fecha visita</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">Técnico</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Total</th>
                <th className="px-3 py-3">Notas</th>
              </tr>
            </thead>
            <tbody>
              {loadingMantenimientos && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-ran-slate">
                    Cargando mantenimientos...
                  </td>
                </tr>
              )}

              {!loadingMantenimientos && ultimosMantenimientos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-ran-slate">
                    No hay mantenimientos registrados para esta póliza.
                  </td>
                </tr>
              )}

              {!loadingMantenimientos && ultimosMantenimientos.map((mantenimiento) => (
                <tr key={mantenimiento.id} className="border-b border-slate-200 last:border-b-0 hover:bg-ran-ice/30">
                  <td className="px-4 py-3.5 font-semibold text-ran-navy">{formatDate(mantenimiento.fecha_visita)}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{mantenimiento.tipo_servicio}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{mantenimiento.tecnico?.nombre ?? 'Sin técnico'}</td>
                  <td className="px-3 py-3.5">
                    <MantenimientoStatusBadge status={mantenimiento.status} className="rounded-lg border px-3 py-1 text-xs font-semibold" />
                  </td>
                  <td className="px-3 py-3.5 font-semibold text-ran-navy">{formatMXN(mantenimiento.total ?? 0)}</td>
                  <td className="px-3 py-3.5 text-ran-slate">{mantenimiento.notas ?? 'Sin notas'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
