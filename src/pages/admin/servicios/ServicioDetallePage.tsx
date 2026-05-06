import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, Download, FileText, Pencil } from 'lucide-react'
import { AdminBreadcrumbs } from '@/components/shared/AdminBreadcrumbs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { AdminPageLoadingSkeleton, AdminTableSkeleton } from '@/components/shared/AdminSkeletons'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useServicioDetalleQuery, useServicioRefaccionesQuery } from '@/hooks/use-servicios'
import { useCierreQuery } from '@/hooks/use-cierres'
import { useEvidenciaUrlQuery, useEvidenciasQuery } from '@/hooks/use-evidencias'
import { useToast } from '@/hooks/use-toast'
import {
  buildFriendlyEvidenciaFilename,
  buildFriendlyOrdenFilename,
  buildServicioOrderReference,
} from '@/lib/evidencias-filename'
import { formatDate, formatDateTime, formatMXN } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { Evidencia } from '@/types/domain.types'

interface EvidenciaPreview {
  filename: string
  downloadUrl: string
}

interface EvidenciaCardProps {
  evidencia: Evidencia
  displayFilename: string
  onPreview: (preview: EvidenciaPreview) => void
}

function isOrdenServicioFilename(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

function EvidenciaCard({ evidencia, displayFilename, onPreview }: EvidenciaCardProps) {
  const { data } = useEvidenciaUrlQuery(evidencia.r2_key)
  const downloadUrl = data?.downloadUrl
  const isOrdenServicio = isOrdenServicioFilename(evidencia.filename)

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
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center">
              {isOrdenServicio ? (
                <FileText className="h-5 w-5 text-slate-400" />
              ) : (
                <Camera className="h-5 w-5 text-slate-400" />
              )}
              <p className="text-[11px] font-medium text-slate-500">Solo metadatos offline</p>
            </div>
          )}
        </div>
      </button>

      <div className="space-y-1 px-2.5 py-2 text-xs text-ran-slate">
        <p className="truncate font-semibold text-ran-navy">{displayFilename}</p>
        <p>{formatDateTime(evidencia.created_at)}</p>
      </div>
    </div>
  )
}

export function ServicioDetallePage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const { toast } = useToast()
  const [previewEvidencia, setPreviewEvidencia] = useState<EvidenciaPreview | null>(null)
  const [isExportingWorkbook, setIsExportingWorkbook] = useState(false)

  const { data: servicio, isLoading } = useServicioDetalleQuery(servicioId)
  const { data: cierre } = useCierreQuery(servicioId)
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId, Boolean(servicioId))
  const { data: refacciones = [], isLoading: loadingRefacciones } = useServicioRefaccionesQuery(servicioId)

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

  if (isLoading) return <AdminPageLoadingSkeleton />
  if (!servicio) return <div className="p-6">Servicio no encontrado</div>
  const orderReference = buildServicioOrderReference(servicio.orden, servicio.id)
  const evidenciaOrdenDisplayFilename = buildFriendlyOrdenFilename(orderReference)

  const handleExportWorkbook = async () => {
    setIsExportingWorkbook(true)

    try {
      const { exportServiceEvidenceWorkbook } = await import('@/lib/reportes-export')
      const result = await exportServiceEvidenceWorkbook({
        servicio,
        cierre: cierre ?? null,
        refacciones,
        evidencias,
      })

      toast({
        title: 'Evidencia exportada',
        description: `Se descargó ${result.filename}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar el archivo de evidencia.'
      toast({
        title: 'Error al exportar',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setIsExportingWorkbook(false)
    }
  }

  return (
    <div className="p-4 lg:p-5">
      <AdminBreadcrumbs
        items={[
          'Servicios',
          servicio.orden ? `Servicio #${servicio.orden}` : `Servicio #${servicio.id}`,
        ]}
      />

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
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/servicios/${servicioId}/editar`)}
            className="h-10 gap-2 rounded-xl"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportWorkbook}
            disabled={isExportingWorkbook || loadingRefacciones || loadingEvidencias}
            className="h-10 gap-2 rounded-xl"
          >
            <Download className="h-4 w-4" />
            {isExportingWorkbook ? 'Generando...' : 'Exportar OS'}
          </Button>
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
              <AdminTableSkeleton rows={4} columns={4} />
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
                  <Skeleton key={`evidencia-skeleton-${index}`} className="h-44 rounded-xl" />
                ))}
              </div>
            ) : evidenciasFotos.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-ran-slate">
                No hay evidencias fotográficas registradas.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {evidenciasFotos.map((evidencia, index) => (
                  <EvidenciaCard
                    key={evidencia.id}
                    evidencia={evidencia}
                    displayFilename={buildFriendlyEvidenciaFilename(orderReference, index + 1)}
                    onPreview={setPreviewEvidencia}
                  />
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
            {loadingEvidencias ? (
              <>
                <Skeleton className="h-52 rounded-xl" />
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <Skeleton className="h-4 w-48 rounded-full" />
                  <Skeleton className="h-3.5 w-32 rounded-full" />
                  <Skeleton className="h-3.5 w-40 rounded-full" />
                </div>
              </>
            ) : !evidenciaOrden ? (
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
                      filename: evidenciaOrdenDisplayFilename,
                      downloadUrl: evidenciaOrdenUrl,
                    })
                  }}
                  disabled={!evidenciaOrdenUrl}
                >
                  <div className="relative h-52 w-full bg-slate-100">
                    {evidenciaOrdenUrl ? (
                      <img
                        src={evidenciaOrdenUrl}
                        alt={evidenciaOrdenDisplayFilename}
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
                  <p className="truncate font-semibold text-ran-navy">{evidenciaOrdenDisplayFilename}</p>
                  <p className="text-ran-slate">{formatDateTime(evidenciaOrden.created_at)}</p>
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
