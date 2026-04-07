import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Camera, FileText, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { PageLoading } from '@/components/shared/LoadingSpinner'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { ExportButton } from '@/components/shared/ExportButton'
import { useServicioDetalleQuery } from '@/hooks/use-servicios'
import { useCierreQuery } from '@/hooks/use-cierres'
import { useEvidenciaUrlQuery, useEvidenciasQuery } from '@/hooks/use-evidencias'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, formatMXN } from '@/lib/utils'
import type { Evidencia, ServicioRefaccion } from '@/types/domain.types'

interface EvidenciaPreview {
  filename: string
  downloadUrl: string
}

interface EvidenciaCardProps {
  evidencia: Evidencia
  onPreview: (preview: EvidenciaPreview) => void
}

function isOrdenServicioFilename(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

function getDisplayFilename(filename: string): string {
  const parts = filename.split('__')
  if (parts.length >= 3) {
    return parts.slice(2).join('__')
  }
  return filename
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return '—'

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}

function EvidenciaCard({ evidencia, onPreview }: EvidenciaCardProps) {
  const { data } = useEvidenciaUrlQuery(evidencia.r2_key)
  const downloadUrl = data?.downloadUrl
  const displayFilename = getDisplayFilename(evidencia.filename)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="block w-full text-left disabled:cursor-not-allowed"
        onClick={() => {
          if (!downloadUrl) return
          onPreview({ filename: displayFilename, downloadUrl })
        }}
        disabled={!downloadUrl}
      >
        <div className="relative h-36 w-full bg-slate-100">
          {downloadUrl ? (
            <img src={downloadUrl} alt={displayFilename} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Camera className="h-5 w-5 text-slate-400" />
            </div>
          )}
        </div>
      </button>

      <div className="space-y-1 px-2.5 py-2 text-xs text-ran-slate">
        <p className="truncate font-semibold text-ran-navy">{displayFilename}</p>
        <p>{formatDateTime(evidencia.created_at)}</p>
        <p>{formatBytes(evidencia.size_bytes)} · {evidencia.mime_type || 'Sin MIME'}</p>
      </div>
    </div>
  )
}

export function ServicioDetallePage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const [previewEvidencia, setPreviewEvidencia] = useState<EvidenciaPreview | null>(null)

  const { data: servicio, isLoading } = useServicioDetalleQuery(servicioId)
  const { data: cierre } = useCierreQuery(servicioId)
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId, Boolean(servicioId))

  const { data: refacciones = [], isLoading: loadingRefacciones } = useQuery({
    queryKey: ['servicio-refacciones', servicioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('servicio_refacciones')
        .select('*')
        .eq('servicio_id', servicioId)
        .order('id')
      if (error) throw error
      return data as ServicioRefaccion[]
    },
    enabled: servicioId > 0,
  })

  const totalRefacciones = refacciones.reduce(
    (sum, item) => sum + item.cantidad * item.precio_unitario,
    0,
  )

  const evidenciaOrden = useMemo(
    () =>
      evidencias
        .filter((evidencia) => isOrdenServicioFilename(evidencia.filename))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0] ?? null,
    [evidencias],
  )

  const evidenciasFotos = useMemo(
    () =>
      evidencias
        .filter((evidencia) => !isOrdenServicioFilename(evidencia.filename))
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at)),
    [evidencias],
  )

  const { data: evidenciaOrdenUrlData } = useEvidenciaUrlQuery(evidenciaOrden?.r2_key ?? null)
  const evidenciaOrdenUrl = evidenciaOrdenUrlData?.downloadUrl

  if (isLoading) return <PageLoading />
  if (!servicio) return <div className="p-6">Servicio no encontrado</div>

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/servicios')}
            className="mt-1 h-9 w-9 rounded-full border border-slate-200 bg-white text-ran-slate hover:bg-ran-ice"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-ran-navy lg:text-[2rem]">
              {servicio.orden ? `Servicio #${servicio.orden}` : 'Servicio sin orden SAP'}
            </h1>
            <p className="mt-1 text-sm text-ran-slate">
              {servicio.tipo_servicio} · {servicio.cliente?.nombre ?? 'Sin cliente'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {servicio.status !== 'cerrado' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/servicios/${servicioId}/editar`)}
              className="h-10 gap-2 rounded-xl"
            >
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
          )}
          <ExportButton
            endpoint="generar-evidencia-os"
            payload={{ servicioId }}
            filename={`evidencia-OS-${servicioId}.xlsx`}
            label="Exportar OS"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1fr]">
        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Información del servicio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Status</p>
                <ServicioStatusBadge status={servicio.status} />
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Tipo de servicio</p>
                <p className="font-medium">{servicio.tipo_servicio}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Clase orden</p>
                <p className="font-medium">{servicio.clase_orden ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Técnico</p>
                <p className="font-medium">{servicio.tecnico?.nombre ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Orden SAP</p>
                <p className="font-medium">{servicio.orden ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Aviso SAP</p>
                <p className="font-medium">{servicio.aviso ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Fecha solicitud</p>
                <p className="font-medium">{formatDate(servicio.fecha_solicitud)}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Fecha servicio</p>
                <p className="font-medium">{formatDate(servicio.fecha_servicio)}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Creado</p>
                <p className="font-medium">{formatDateTime(servicio.created_at)}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Actualizado</p>
                <p className="font-medium">{formatDateTime(servicio.updated_at)}</p>
              </div>
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-ran-slate">Descripción</p>
              <p className="text-sm leading-relaxed text-ran-slate">
                {servicio.descripcion ?? 'Sin descripción registrada.'}
              </p>
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-ran-slate">Mano de obra</p>
                <p className="mt-1 text-base font-bold text-ran-navy">{formatMXN(servicio.costo_mano_obra)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-ran-slate">Refacciones</p>
                <p className="mt-1 text-base font-bold text-ran-navy">{formatMXN(servicio.costo_refacciones)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-ran-slate">Total</p>
                <p className="mt-1 text-base font-bold text-ran-navy">{formatMXN(servicio.total ?? 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Cliente y máquina</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Código cliente</p>
                <p className="font-medium">{servicio.cliente?.codigo_cliente ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Establecimiento</p>
                <p className="font-medium">{servicio.cliente?.nombre ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Dirección</p>
                <p className="font-medium">{servicio.cliente?.direccion ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Municipio</p>
                <p className="font-medium">{servicio.cliente?.municipio ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Teléfono</p>
                <p className="font-medium">{servicio.cliente?.telefono ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Correo</p>
                <p className="font-medium">{servicio.cliente?.correo_contacto ?? '—'}</p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Modelo máquina</p>
                <p className="font-medium">{servicio.maquina?.modelo ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Serie</p>
                <p className="font-medium">{servicio.maquina?.serie ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Status máquina</p>
                <p className="font-medium">{servicio.maquina?.status ?? '—'}</p>
              </div>
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Fecha instalación</p>
                <p className="font-medium">{formatDate(servicio.maquina?.fecha_instalacion)}</p>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Observaciones máquina</p>
              <p className="font-medium">{servicio.maquina?.observaciones ?? '—'}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Componentes / Refacciones</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRefacciones ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`refaccion-skeleton-${index}`} className="h-10 animate-pulse rounded-lg bg-slate-100" />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-[1.4fr_0.45fr_0.55fr_0.55fr] gap-2 border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-wide text-ran-slate">
                  <span>Pieza</span>
                  <span>Cant.</span>
                  <span>P. Unit.</span>
                  <span>Total</span>
                </div>

                {refacciones.length === 0 ? (
                  <p className="py-5 text-sm text-ran-slate">Sin refacciones registradas.</p>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {refacciones.map((item) => (
                      <div key={item.id} className="grid grid-cols-[1.4fr_0.45fr_0.55fr_0.55fr] gap-2 py-2 text-sm text-ran-slate">
                        <span>{item.nombre_refaccion}</span>
                        <span>{item.cantidad}</span>
                        <span>{formatMXN(item.precio_unitario)}</span>
                        <span>{formatMXN(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <span className="font-semibold text-ran-slate">Total refacciones</span>
                  <span className="text-base font-extrabold text-ran-navy">{formatMXN(totalRefacciones)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Datos de cierre</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cierre ? (
              <>
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                  Servicio cerrado
                </div>

                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Fecha cierre</p>
                    <p className="font-medium">{formatDateTime(cierre.created_at)}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Técnico cierre</p>
                    <p className="font-medium">{cierre.tecnico?.nombre ?? '—'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Aviso cierre</p>
                    <p className="font-medium">{cierre.aviso ?? '—'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Parte objeto</p>
                    <p className="font-medium">{cierre.parte_objeto ?? '—'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Causa</p>
                    <p className="font-medium">{cierre.causa ?? '—'}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Firma receptor</p>
                    <p className="font-medium">{cierre.firma_receptor ?? '—'}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="mb-1 text-xs uppercase tracking-wide text-ran-slate">Descripción de cierre</p>
                  <p className="leading-relaxed text-ran-slate">{cierre.descripcion}</p>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <span className="font-semibold text-ran-slate">Costo reportado en cierre</span>
                  <span className="font-bold text-ran-navy">
                    {cierre.costo_total != null ? formatMXN(cierre.costo_total) : '—'}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-sm text-ran-slate">Servicio sin cierre registrado. El cierre se realiza desde la pantalla de edición.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Evidencias fotográficas</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingEvidencias ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={`evidencia-skeleton-${index}`} className="h-44 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : evidenciasFotos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-ran-slate">
                No hay evidencias fotográficas registradas.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {evidenciasFotos.map((evidencia) => (
                  <EvidenciaCard key={evidencia.id} evidencia={evidencia} onPreview={setPreviewEvidencia} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl text-ran-navy">Orden de servicio (hoja)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!evidenciaOrden ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-ran-slate">
                No hay hoja de orden registrada.
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="block w-full overflow-hidden rounded-xl border border-slate-200 text-left disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!evidenciaOrdenUrl) return
                    setPreviewEvidencia({
                      filename: getDisplayFilename(evidenciaOrden.filename),
                      downloadUrl: evidenciaOrdenUrl,
                    })
                  }}
                  disabled={!evidenciaOrdenUrl}
                >
                  <div className="relative h-52 w-full bg-slate-100">
                    {evidenciaOrdenUrl ? (
                      <img
                        src={evidenciaOrdenUrl}
                        alt={getDisplayFilename(evidenciaOrden.filename)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <FileText className="h-6 w-6 text-slate-400" />
                      </div>
                    )}
                  </div>
                </button>

                <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="truncate font-semibold text-ran-navy">{getDisplayFilename(evidenciaOrden.filename)}</p>
                  <p className="text-ran-slate">{formatDateTime(evidenciaOrden.created_at)}</p>
                  <p className="text-ran-slate">{formatBytes(evidenciaOrden.size_bytes)} · {evidenciaOrden.mime_type || 'Sin MIME'}</p>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-ran-slate">Mano de obra</span>
                <span className="font-medium">{formatMXN(servicio.costo_mano_obra)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ran-slate">Refacciones</span>
                <span className="font-medium">{formatMXN(servicio.costo_refacciones)}</span>
              </div>
              <div className="flex justify-between text-base">
                <span className="font-semibold text-ran-navy">Total</span>
                <span className="font-bold text-ran-navy">{formatMXN(servicio.total ?? 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(previewEvidencia)}
        onOpenChange={(open) => {
          if (!open) setPreviewEvidencia(null)
        }}
      >
        <DialogContent className="max-w-5xl p-3 sm:p-5">
          <DialogHeader>
            <DialogTitle>Vista previa de evidencia</DialogTitle>
            <DialogDescription className="truncate">{previewEvidencia?.filename}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl bg-slate-100 p-2">
            {previewEvidencia && (
              <img
                src={previewEvidencia.downloadUrl}
                alt={previewEvidencia.filename}
                className="max-h-[75vh] w-full rounded-lg object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
