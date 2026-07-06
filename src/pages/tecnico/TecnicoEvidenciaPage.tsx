import { useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  FileImage,
  FileText,
  ImagePlus,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TecnicoEvidenciaSkeleton } from '@/components/shared/TecnicoSkeletons'
import { ServicioStatusBadge } from '@/components/shared/StatusBadge'
import { useToast } from '@/hooks/use-toast'
import { useCompletarServicioConRefaccionesMutation, useServicioDetalleQuery } from '@/hooks/use-servicios'
import {
  evidenciasKeys,
  useEliminarEvidenciaMutation,
  useEvidenciaUrlQuery,
  useEvidenciasQuery,
  useSubirEvidenciaMutation,
} from '@/hooks/use-evidencias'
import { getCachedEvidenciasByServicio } from '@/lib/offline/cache'
import { getErrorMessage, isBrowserOnline } from '@/lib/offline/network'
import { getCurrentSessionUserId } from '@/lib/offline/session'
import {
  buildServicioCompletionRequirementMessage,
  isOrdenServicioFilename,
  REQUIRED_SERVICE_PHOTOS,
  summarizeServicioEvidencias,
} from '@/lib/tecnico/servicio-evidencias'
import {
  buildFriendlyEvidenciaFilename,
  buildFriendlyOrdenFilename,
  buildServicioOrderReference,
} from '@/lib/evidencias-filename'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Evidencia, Servicio } from '@/types/domain.types'

interface PreviewItem {
  title: string
  downloadUrl: string
}

const EMPTY_EVIDENCIAS: Evidencia[] = []

function sanitizeFilename(name: string): string {
  const trimmed = name.trim() || 'archivo'
  return trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
}

function buildOrdenServicioFile(file: File): File {
  return new File(
    [file],
    `orden-servicio__${Date.now()}__${sanitizeFilename(file.name)}`,
    {
      type: file.type,
      lastModified: file.lastModified,
    },
  )
}

function getCompletionMessage(servicio: Servicio, syncStatus: 'pending' | 'synced' | 'failed' | 'conflict') {
  if (syncStatus === 'synced') {
    return {
      title: 'Servicio completado',
      description: `${servicio.cliente?.nombre ?? 'El servicio'} quedó marcado como completado.`,
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'pending') {
    if (isBrowserOnline()) {
      return {
        title: 'Servicio registrado',
        description: 'El cambio quedó guardado y se terminará de procesar en segundo plano.',
        variant: 'default' as const,
      }
    }

    return {
      title: 'Servicio guardado offline',
      description: 'El cambio quedó registrado localmente y se sincronizará cuando vuelva la conexión.',
      variant: 'default' as const,
    }
  }

  if (syncStatus === 'conflict') {
    return {
      title: 'Cambio marcado, pero requiere revisión',
      description: 'El servicio quedó actualizado localmente, pero la sincronización detectó un conflicto.',
      variant: 'destructive' as const,
    }
  }

  return {
    title: 'Cambio registrado con observaciones',
    description: 'El servicio quedó actualizado localmente, pero la sincronización no pudo cerrarse correctamente.',
    variant: 'destructive' as const,
  }
}

function FotoTile({
  evidencia,
  displayFilename,
  onPreview,
  onDelete,
  showDelete = true,
  disableDelete,
}: {
  evidencia: Evidencia
  displayFilename: string
  onPreview: (item: PreviewItem) => void
  onDelete: (evidencia: Evidencia) => void
  showDelete?: boolean
  disableDelete?: boolean
}) {
  const { data } = useEvidenciaUrlQuery(evidencia.r2_key, evidencia)
  const downloadUrl = data?.downloadUrl
  const isPending = evidencia.id < 0
  const canPreview = Boolean(downloadUrl && evidencia.mime_type?.startsWith('image/'))

  return (
    <div className="group relative aspect-square overflow-hidden rounded-[20px] border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => {
          if (!downloadUrl) return
          onPreview({ title: displayFilename, downloadUrl })
        }}
        disabled={!canPreview}
        className="h-full w-full text-left disabled:cursor-default"
      >
        {downloadUrl && evidencia.mime_type?.startsWith('image/') ? (
          <img
            src={downloadUrl}
            alt={displayFilename}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
            <Camera className="h-6 w-6 text-slate-400" />
            <p className="text-[11px] font-medium leading-5 text-slate-500">
              {downloadUrl ? 'Vista previa no disponible' : 'Vista previa disponible al recuperar conexión'}
            </p>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent px-2.5 py-2.5">
          <p className="truncate text-[11px] font-semibold text-white">{displayFilename}</p>
        </div>
      </button>

      {showDelete ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute right-2 top-2 h-8 w-8 rounded-full border border-white/20 bg-white/90 text-ran-red shadow-sm hover:bg-white"
          onClick={() => onDelete(evidencia)}
          disabled={disableDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : null}

      {isPending && (
        <Badge className="absolute left-2 top-2 border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100">
          Pendiente
        </Badge>
      )}
    </div>
  )
}

function OrdenServicioCard({
  evidencia,
  displayFilename,
  onDelete,
  readOnly = false,
  disableDelete,
}: {
  evidencia: Evidencia | null
  displayFilename: string
  onDelete: (evidencia: Evidencia) => void
  readOnly?: boolean
  disableDelete?: boolean
}) {
  const { data } = useEvidenciaUrlQuery(evidencia?.r2_key ?? null, evidencia)
  const downloadUrl = data?.downloadUrl
  const isPending = Boolean(evidencia && evidencia.id < 0)
  const isImage = Boolean(evidencia?.mime_type?.startsWith('image/'))

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Hoja de orden de servicio
          </p>
          <h3 className="mt-2 text-base font-extrabold text-ran-navy">
            {evidencia ? 'Archivo registrado' : 'Aún sin cargar'}
          </h3>
          <p className="mt-1 text-[13px] text-ran-slate">
            {evidencia
              ? readOnly
                ? 'El archivo quedó bloqueado porque el servicio ya fue cerrado.'
                : 'Puedes cargar una nueva versión cuando sea necesario.'
              : 'Sube foto o PDF de la orden de servicio firmada.'}
          </p>
        </div>

        {isPending && (
          <Badge className="border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100">
            Pendiente
          </Badge>
        )}
      </div>

      {evidencia ? (
        <div className="mt-4 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-ran-navy shadow-sm">
              {isImage ? <FileImage className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ran-navy">{displayFilename}</p>
              <p className="text-[11px] text-ran-slate">{formatDateTime(evidencia.created_at)}</p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1 rounded-xl"
              disabled={!downloadUrl}
              onClick={() => {
                if (!downloadUrl) return
                window.open(downloadUrl, '_blank', 'noopener,noreferrer')
              }}
            >
              <FileText className="h-4 w-4" />
              Abrir archivo
            </Button>

            {!readOnly ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl border-red-200 text-ran-red hover:bg-red-50 hover:text-ran-red"
                onClick={() => onDelete(evidencia)}
                disabled={disableDelete}
              >
                <Trash2 className="h-4 w-4" />
                Eliminar
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-[20px] border border-dashed border-slate-300 bg-slate-50/60 px-4 py-5 text-center text-[13px] text-slate-500">
          La orden todavía no se ha cargado para este servicio.
        </div>
      )}
    </div>
  )
}

export function TecnicoEvidenciaPage() {
  const { id } = useParams<{ id: string }>()
  const servicioId = Number(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [preview, setPreview] = useState<PreviewItem | null>(null)
  const [servicioPorCompletar, setServicioPorCompletar] = useState<Servicio | null>(null)
  const [activeUploader, setActiveUploader] = useState<'fotos' | 'orden' | null>(null)
  const fotosCameraInputRef = useRef<HTMLInputElement>(null)
  const fotosGalleryInputRef = useRef<HTMLInputElement>(null)
  const ordenInputRef = useRef<HTMLInputElement>(null)

  const { data: servicio, isLoading: loadingServicio } = useServicioDetalleQuery(servicioId)
  const { data: evidenciasData, isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId)
  const { mutateAsync: subirEvidencia, isPending: subiendo } = useSubirEvidenciaMutation(servicioId)
  const { mutateAsync: eliminarEvidencia, isPending: eliminandoEvidencia } = useEliminarEvidenciaMutation(servicioId)
  const { mutateAsync: completarServicio, isPending: isCompleting } = useCompletarServicioConRefaccionesMutation()
  const evidencias = evidenciasData ?? EMPTY_EVIDENCIAS
  const [evidenciaAEliminar, setEvidenciaAEliminar] = useState<Evidencia | null>(null)
  const isChangingFiles = subiendo || eliminandoEvidencia

  const refreshLocalEvidencias = async () => {
    const ownerId = await getCurrentSessionUserId()
    if (!ownerId) return EMPTY_EVIDENCIAS

    const localSnapshot = await getCachedEvidenciasByServicio(ownerId, servicioId)
    queryClient.setQueryData(evidenciasKeys.byServicio(servicioId), localSnapshot)
    return localSnapshot
  }

  const evidenciasSummary = useMemo(() => summarizeServicioEvidencias(evidencias), [evidencias])
  const ordenServicio = evidenciasSummary.ordenServicio
  const fotos = evidenciasSummary.fotos
  const orderReference = buildServicioOrderReference(servicio?.orden, servicioId)
  const ordenServicioDisplayFilename = buildFriendlyOrdenFilename(orderReference)
  const fotoDisplayFilenamesById = useMemo(() => {
    const filenames = new Map<number, string>()
    fotos.forEach((foto, index) => {
      filenames.set(foto.id, buildFriendlyEvidenciaFilename(orderReference, index + 1))
    })
    return filenames
  }, [fotos, orderReference])
  const getFriendlyFilename = (evidencia: Evidencia): string => {
    if (isOrdenServicioFilename(evidencia.filename)) return ordenServicioDisplayFilename
    return fotoDisplayFilenamesById.get(evidencia.id) ?? buildFriendlyEvidenciaFilename(orderReference, 1)
  }
  const isReadOnly = servicio?.status === 'cerrado'
  const canManageFiles = !isReadOnly && !isChangingFiles
  const puedeCerrarServicio = Boolean(servicio && servicio.status !== 'completado' && servicio.status !== 'cerrado')
  const puedeCompletar = Boolean(puedeCerrarServicio && evidenciasSummary.puedeCompletar)
  const completionRequirementMessage = buildServicioCompletionRequirementMessage(evidenciasSummary)

  const procesarCarga = async (files: File[], kind: 'fotos' | 'orden') => {
    if (files.length === 0) return
    if (isReadOnly) {
      toast({
        title: 'Servicio cerrado',
        description: 'Las evidencias de este servicio quedaron en solo lectura.',
        variant: 'destructive',
      })
      return
    }

    setActiveUploader(kind)

    try {
      const onlineAtStart = isBrowserOnline()
      let queuedCount = 0
      let processingCount = 0
      let syncedCount = 0

      for (const originalFile of files) {
        const file = kind === 'orden' ? buildOrdenServicioFile(originalFile) : originalFile
        const result = await subirEvidencia(file)

        if (result.syncStatus === 'synced') {
          syncedCount += 1
        } else if (result.syncStatus === 'pending' && onlineAtStart) {
          processingCount += 1
        } else {
          queuedCount += 1
        }
      }

      const total = files.length
      const title = queuedCount > 0
        ? kind === 'orden'
          ? 'Orden guardada localmente'
          : 'Evidencias guardadas localmente'
        : processingCount > 0
          ? kind === 'orden'
            ? 'Orden registrada'
            : 'Evidencias registradas'
        : kind === 'orden'
          ? 'Orden cargada'
          : 'Evidencias cargadas'

      const description = queuedCount > 0
        ? `${queuedCount} archivo(s) quedaron pendientes para sincronizarse.`
        : processingCount > 0
          ? `${processingCount} archivo(s) siguen procesándose en segundo plano.`
        : `${syncedCount || total} archivo(s) se guardaron correctamente.`

      await refreshLocalEvidencias()
      toast({ title, description })
    } catch (error) {
      toast({
        title: 'No se pudo guardar el archivo',
        description: getErrorMessage(error, 'Ocurrió un error al guardar la evidencia.'),
        variant: 'destructive',
      })
    } finally {
      setActiveUploader(null)
      if (fotosCameraInputRef.current) fotosCameraInputRef.current.value = ''
      if (fotosGalleryInputRef.current) fotosGalleryInputRef.current.value = ''
      if (ordenInputRef.current) ordenInputRef.current.value = ''
    }
  }

  const confirmarCompletarServicio = async () => {
    if (!servicioPorCompletar) return

    if (!evidenciasSummary.puedeCompletar) {
      toast({
        title: 'Faltan evidencias para completar',
        description: completionRequirementMessage,
        variant: 'destructive',
      })
      return
    }

    try {
      const result = await completarServicio({
        serviceId: servicioPorCompletar.id,
        items: [],
        baseCostoRefacciones: servicioPorCompletar.costo_refacciones ?? 0,
        expectedUpdatedAt: servicioPorCompletar.updated_at ?? null,
        expectedStatus: servicioPorCompletar.status ?? null,
      })

      toast(getCompletionMessage(servicioPorCompletar, result.syncStatus))
      setServicioPorCompletar(null)
    } catch (error) {
      toast({
        title: 'No se pudo completar el servicio',
        description: getErrorMessage(error, 'Ocurrió un error al actualizar el servicio.'),
        variant: 'destructive',
      })
    }
  }

  const handleConfirmarEliminarEvidencia = async () => {
    if (!evidenciaAEliminar) return
    if (isReadOnly) {
      setEvidenciaAEliminar(null)
      toast({
        title: 'Servicio cerrado',
        description: 'Las evidencias de este servicio quedaron en solo lectura.',
        variant: 'destructive',
      })
      return
    }

    try {
      await eliminarEvidencia(evidenciaAEliminar.id)
      if (preview?.downloadUrl && preview.title === getFriendlyFilename(evidenciaAEliminar)) {
        setPreview(null)
      }
      await refreshLocalEvidencias()
      toast({
        title: isOrdenServicioFilename(evidenciaAEliminar.filename)
          ? 'Orden eliminada'
          : 'Evidencia eliminada',
        description: isOrdenServicioFilename(evidenciaAEliminar.filename)
          ? 'La hoja de orden se eliminó correctamente.'
          : 'La imagen fue eliminada correctamente.',
      })
      setEvidenciaAEliminar(null)
    } catch (error) {
      toast({
        title: 'No se pudo eliminar el archivo',
        description: getErrorMessage(error, 'Ocurrió un error al eliminar la evidencia.'),
        variant: 'destructive',
      })
    }
  }

  if (loadingServicio || loadingEvidencias) {
    return <TecnicoEvidenciaSkeleton />
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

  return (
    <>
      <div className="space-y-4 px-3.5 py-4">
        <section className="overflow-hidden rounded-[24px] bg-white shadow-[0_22px_50px_-36px_rgba(15,23,42,0.4)]">
          <div className="bg-[linear-gradient(135deg,rgba(27,59,111,1),rgba(37,99,235,0.92))] px-4 py-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => navigate(-1)}
                className="h-9 w-9 rounded-xl border border-white/20 bg-white/15 text-white hover:bg-white/25 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>

              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">
                  Evidencias del servicio
                </p>
                <h1 className="mt-1.5 text-xl font-extrabold leading-tight">
                  {servicio.cliente?.nombre ?? `Servicio #${servicioId}`}
                </h1>
                <p className="mt-1 text-[13px] text-white/78">{servicio.tipo_servicio}</p>
              </div>

              <ServicioStatusBadge status={servicio.status} className="border-white/25 bg-white/15 text-white" />
            </div>

            <div className="mt-4 grid gap-1.5 text-[13px] text-white/78">
              <div>{servicio.cliente?.direccion ?? 'Sin dirección registrada'}</div>
              <div>{servicio.maquina ? `${servicio.maquina.modelo} · ${servicio.maquina.serie}` : 'Sin máquina asignada'}</div>
              <div>{formatDate(servicio.fecha_servicio)}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 px-4 py-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Fotos</p>
              <p className="mt-1.5 text-lg font-extrabold text-ran-navy">{fotos.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Orden</p>
              <p className="mt-1.5 text-lg font-extrabold text-ran-navy">{ordenServicio ? '1' : '0'}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-ran-navy">Fotos de evidencia</h2>
              <p className="text-[13px] text-ran-slate">
                {isReadOnly
                  ? 'El servicio ya está cerrado. Puedes revisar las evidencias registradas.'
                  : `Captura el estado del servicio y sus resultados. Se requiere mínimo ${REQUIRED_SERVICE_PHOTOS} foto y puedes subir más desde cámara o galería.`}
              </p>
            </div>
            {!isReadOnly ? (
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="rounded-xl"
                  onClick={() => fotosCameraInputRef.current?.click()}
                  disabled={!canManageFiles}
                >
                  {activeUploader === 'fotos' ? <Upload className="h-4 w-4 animate-pulse" /> : <Camera className="h-4 w-4" />}
                  Tomar foto
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl bg-white"
                  onClick={() => fotosGalleryInputRef.current?.click()}
                  disabled={!canManageFiles}
                >
                  {activeUploader === 'fotos' ? <Upload className="h-4 w-4 animate-pulse" /> : <ImagePlus className="h-4 w-4" />}
                  Galería
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {fotos.map((evidencia) => (
              <FotoTile
                key={evidencia.id}
                evidencia={evidencia}
                displayFilename={getFriendlyFilename(evidencia)}
                onPreview={setPreview}
                onDelete={setEvidenciaAEliminar}
                showDelete={!isReadOnly}
                disableDelete={!canManageFiles}
              />
            ))}

            {!isReadOnly ? (
              <button
                type="button"
                onClick={() => fotosGalleryInputRef.current?.click()}
                disabled={!canManageFiles}
                className="flex aspect-square flex-col items-center justify-center gap-2.5 rounded-[20px] border-2 border-dashed border-slate-300 bg-white text-ran-slate transition-colors hover:border-ran-navy hover:text-ran-navy disabled:opacity-60"
              >
                {activeUploader === 'fotos' ? (
                  <Upload className="h-6 w-6 animate-pulse" />
                ) : (
                  <ImagePlus className="h-6 w-6" />
                )}
                <span className="text-[13px] font-semibold">Desde galería</span>
              </button>
            ) : null}
          </div>

          {fotos.length === 0 && (
            <div className="rounded-[20px] border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-[13px] text-slate-500">
              Todavía no hay fotos registradas para este servicio.
            </div>
          )}
        </section>

        <OrdenServicioCard
          evidencia={ordenServicio}
          displayFilename={ordenServicioDisplayFilename}
          onDelete={setEvidenciaAEliminar}
          readOnly={isReadOnly}
          disableDelete={!canManageFiles}
        />

        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Carga de orden
              </p>
              <h3 className="mt-2 text-base font-extrabold text-ran-navy">Subir o reemplazar archivo</h3>
              <p className="mt-1 text-[13px] text-ran-slate">
                {isReadOnly
                  ? 'La hoja de orden quedó bloqueada porque el servicio ya fue cerrado.'
                  : 'La hoja de orden no se precarga como imagen; solo se guardan metadatos y el archivo nuevo queda disponible offline si se sube desde este dispositivo.'}
              </p>
            </div>

            {!isReadOnly ? (
              <Button
                type="button"
                size="sm"
                className="w-full rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95 sm:w-auto"
                onClick={() => ordenInputRef.current?.click()}
                disabled={!canManageFiles}
              >
                {activeUploader === 'orden' ? <Upload className="h-4 w-4 animate-pulse" /> : <FileText className="h-4 w-4" />}
                Subir orden
              </Button>
            ) : null}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]">
          <div className={`rounded-[20px] border px-3.5 py-3 ${
            evidenciasSummary.puedeCompletar
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
              Requisito de cierre
            </p>
            <p className="mt-1 text-[13px] font-medium leading-5">
              {completionRequirementMessage}
            </p>
          </div>

          <p className="mt-4 text-[13px] leading-6 text-slate-600">
            Las fotos y la orden se comprimen o almacenan localmente según corresponda. Si estás sin conexión, el servicio sigue funcionando y la sincronización se hará después.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => navigate(-1)}
            >
              Volver
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
              onClick={() => setServicioPorCompletar(servicio)}
              disabled={!puedeCompletar || isCompleting}
            >
              <CheckCircle2 className="h-4 w-4" />
              {servicio.status === 'cerrado'
                ? 'Servicio cerrado'
                : !puedeCerrarServicio
                ? 'Servicio completado'
                : puedeCompletar
                  ? 'Marcar como completado'
                  : 'Faltan evidencias'}
            </Button>
          </div>
        </div>

        <input
          ref={fotosCameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(event) => void procesarCarga(Array.from(event.target.files ?? []), 'fotos')}
        />

        <input
          ref={fotosGalleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => void procesarCarga(Array.from(event.target.files ?? []), 'fotos')}
        />

        <input
          ref={ordenInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(event) => void procesarCarga(Array.from(event.target.files ?? []), 'orden')}
        />
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl rounded-[24px] border-slate-200 bg-white p-0">
          <div className="overflow-hidden rounded-[24px] bg-slate-950">
            <DialogHeader className="border-b border-white/10 px-5 py-4 text-left">
              <DialogTitle className="truncate text-white">{preview?.title ?? 'Vista previa'}</DialogTitle>
            </DialogHeader>
            {preview?.downloadUrl && (
              <img
                src={preview.downloadUrl}
                alt={preview.title}
                className="max-h-[78vh] w-full object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(servicioPorCompletar)} onOpenChange={(open) => !open && setServicioPorCompletar(null)}>
        <AlertDialogContent className="max-w-sm rounded-[24px] border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>Marcar servicio como completado</AlertDialogTitle>
            <AlertDialogDescription>
              {servicioPorCompletar
                ? `Se actualizará el servicio de ${servicioPorCompletar.cliente?.nombre ?? 'este cliente'} como completado.`
                : 'Confirma para continuar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-ran-navy text-white hover:bg-ran-navy/95"
              onClick={confirmarCompletarServicio}
              disabled={isCompleting}
            >
              {isCompleting ? 'Guardando...' : 'Completar servicio'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(evidenciaAEliminar)} onOpenChange={(open) => !open && setEvidenciaAEliminar(null)}>
        <AlertDialogContent className="max-w-sm rounded-[24px] border-slate-200">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {evidenciaAEliminar && isOrdenServicioFilename(evidenciaAEliminar.filename)
                ? 'Eliminar orden de servicio'
                : 'Eliminar evidencia'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {evidenciaAEliminar
                ? isOrdenServicioFilename(evidenciaAEliminar.filename)
                  ? `Se eliminará la hoja de orden "${getFriendlyFilename(evidenciaAEliminar)}". Esta acción no se puede deshacer.`
                  : `Se eliminará la imagen "${getFriendlyFilename(evidenciaAEliminar)}". Esta acción no se puede deshacer.`
                : 'Confirma para continuar.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-xl bg-ran-red text-white hover:bg-ran-red/90"
              onClick={handleConfirmarEliminarEvidencia}
              disabled={eliminandoEvidencia || isReadOnly}
            >
              {isReadOnly ? 'Bloqueado' : eliminandoEvidencia ? 'Eliminando...' : 'Eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
