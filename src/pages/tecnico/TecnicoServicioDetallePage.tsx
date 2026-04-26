import { ArrowLeft, CalendarDays, FileText, Mail, MapPin, Phone, type LucideIcon, Wrench } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { TecnicoServicioDetalleSkeleton } from '@/components/shared/TecnicoSkeletons'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useEvidenciasQuery } from '@/hooks/use-evidencias'
import { useServicioDetalleQuery, useServicioRefaccionesQuery } from '@/hooks/use-servicios'
import { buildServicioCompletionRequirementMessage, summarizeServicioEvidencias } from '@/lib/tecnico/servicio-evidencias'
import { formatDate, formatMXN } from '@/lib/utils'

function getRefaccionSourceLabel(source: 'general' | 'tecnico') {
  return source === 'tecnico' ? 'Técnico' : 'Administración'
}

function DetailCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-3.5 py-3 shadow-[0_14px_32px_-30px_rgba(15,23,42,0.28)]">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 text-[13px] font-medium leading-5 text-ran-navy">{value}</p>
    </div>
  )
}

export function TecnicoServicioDetallePage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()

  const { data: servicio, isLoading: loadingServicio } = useServicioDetalleQuery(servicioId)
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId)
  const { data: refacciones = [], isLoading: loadingRefacciones } = useServicioRefaccionesQuery(servicioId)

  if (loadingServicio || loadingEvidencias || loadingRefacciones) {
    return <TecnicoServicioDetalleSkeleton />
  }

  if (!servicio) {
    return (
      <div className="px-3.5 py-4">
        <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-5 text-center text-sm text-slate-600">
          No se encontró la información de este servicio.
        </div>
      </div>
    )
  }

  const evidenciasSummary = summarizeServicioEvidencias(evidencias)
  const requirementMessage = buildServicioCompletionRequirementMessage(evidenciasSummary)

  return (
    <div className="space-y-4 px-3.5 py-4">
      <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_20px_44px_-34px_rgba(15,23,42,0.36)]">
        <div className="bg-[linear-gradient(135deg,rgba(27,59,111,1),rgba(37,99,235,0.92))] px-4 py-4 text-white">
          <div className="flex items-start gap-3">
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={() => navigate(-1)}
              className="h-9 w-9 shrink-0 rounded-xl border border-white/20 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/72">
                Establecimiento
              </p>
              <h1 className="mt-1.5 text-xl font-extrabold leading-tight">
                {servicio.cliente?.nombre ?? `Servicio #${servicio.id}`}
              </h1>
              <p className="mt-1 text-[13px] text-white/78">{servicio.tipo_servicio}</p>
            </div>

            <ServicioStatusBadge status={servicio.status} className="border-white/20 bg-white/15 text-white" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 px-4 py-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Fotos</p>
            <p className="mt-1 text-lg font-extrabold text-ran-navy">{evidenciasSummary.cantidadFotos}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Orden</p>
            <p className="mt-1 text-lg font-extrabold text-ran-navy">{evidenciasSummary.tieneOrdenServicio ? '1' : '0'}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Fecha</p>
            <p className="mt-1 text-[13px] font-bold text-ran-navy">{formatDate(servicio.fecha_servicio)}</p>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.34)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Requisito de cierre
            </p>
            <h2 className="mt-1.5 text-base font-extrabold text-ran-navy">
              {evidenciasSummary.puedeCompletar ? 'Listo para completar' : 'Evidencia pendiente'}
            </h2>
          </div>
        </div>
        <p className="mt-2 text-[13px] leading-5 text-slate-600">{requirementMessage}</p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-ran-navy">Ubicación y contacto</h2>
          <p className="text-[13px] text-ran-slate">Datos del establecimiento para la visita.</p>
        </div>

        <div className="grid gap-2.5">
          <DetailCard icon={MapPin} label="Dirección" value={servicio.cliente?.direccion ?? 'Sin dirección registrada'} />
          <DetailCard icon={MapPin} label="Municipio" value={servicio.cliente?.municipio ?? 'Sin municipio'} />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailCard icon={Phone} label="Teléfono" value={servicio.cliente?.telefono ?? 'Sin teléfono'} />
            <DetailCard icon={Mail} label="Correo" value={servicio.cliente?.correo_contacto ?? 'Sin correo'} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-ran-navy">Equipo y orden</h2>
          <p className="text-[13px] text-ran-slate">Referencia técnica y administrativa del servicio.</p>
        </div>

        <div className="grid gap-2.5">
          <DetailCard
            icon={Wrench}
            label="Máquina"
            value={servicio.maquina ? `${servicio.maquina.modelo} · ${servicio.maquina.serie}` : 'Sin máquina asignada'}
          />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <DetailCard icon={FileText} label="Orden SAP" value={servicio.orden?.toString() ?? 'Sin orden'} />
            <DetailCard icon={FileText} label="Aviso SAP" value={servicio.aviso?.toString() ?? 'Sin aviso'} />
          </div>
          <DetailCard icon={CalendarDays} label="Fecha de servicio" value={formatDate(servicio.fecha_servicio)} />
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.34)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Descripción</p>
        <p className="mt-2 text-[13px] leading-6 text-slate-700">
          {servicio.descripcion ?? 'Sin descripción registrada para este servicio.'}
        </p>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.34)]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Refacciones</p>
          <h2 className="mt-1.5 text-base font-bold text-ran-navy">Material registrado</h2>
          <p className="mt-1 text-[13px] text-ran-slate">Incluye tanto lo capturado por administración como por el técnico.</p>
        </div>

        {refacciones.length === 0 ? (
          <div className="mt-4 rounded-[20px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-5 text-center text-[13px] text-slate-500">
            No hay refacciones registradas para este servicio.
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            {refacciones.map((item, index) => (
              <article
                key={`${item.inventory_source}-${item.inventario_id ?? item.nombre_refaccion}-${index}`}
                className="rounded-[20px] border border-slate-200 bg-slate-50/70 px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13px] font-semibold text-ran-navy">{item.nombre_refaccion}</p>
                      <span className="inline-flex rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                        {getRefaccionSourceLabel(item.inventory_source)}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-ran-slate">
                      {item.cantidad} pza(s) x {formatMXN(Number(item.precio_unitario))}
                    </p>
                  </div>
                  <p className="text-[13px] font-bold text-ran-navy">{formatMXN(Number(item.subtotal))}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-2.5 sm:grid-cols-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => navigate(`/tecnico/servicio/${servicio.id}/evidencia`)}
        >
          <FileText className="h-4 w-4" />
          Evidencia
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => navigate(`/tecnico/servicio/${servicio.id}/refacciones`)}
        >
          <Wrench className="h-4 w-4" />
          Refacciones
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
          onClick={() => navigate(-1)}
        >
          Volver
        </Button>
      </section>
    </div>
  )
}
