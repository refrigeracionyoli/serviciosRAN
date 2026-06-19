import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Camera, FileText, ImagePlus, Plus, Trash2, UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { crearServicioSchema, type CrearServicioInput } from '@/schemas/servicio.schema'
import { useTecnicosQuery } from '@/hooks/use-tecnicos'
import {
  useCrearMaquinaMutation,
  useDescartarMaquinaPendienteInstalacionMutation,
  useMaquinasQuery,
} from '@/hooks/use-maquinas'
import { useMaquinasEnTallerQuery } from '@/hooks/use-maquinas-taller'
import { useClientesQuery, useCrearClienteMutation } from '@/hooks/use-clientes'
import { useServiciosQuery } from '@/hooks/use-servicios'
import { formatMXN } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CreatableCombobox } from '@/components/shared/CreatableCombobox'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { useToast } from '@/hooks/use-toast'
import {
  crearClienteSchema,
  crearMaquinaSchema,
  type CrearClienteInput,
  type CrearMaquinaInput,
} from '@/schemas/cliente.schema'
import { REQUIRED_SERVICE_PHOTOS } from '@/lib/tecnico/servicio-evidencias'
import {
  useEvidenciasQuery,
  useEvidenciaUrlQuery,
  useSubirEvidenciaMutation,
  useEliminarEvidenciaMutation,
} from '@/hooks/use-evidencias'
import { ClienteCombobox } from './ClienteCombobox'
import type { Servicio, Cliente, Cierre, Evidencia, Maquina } from '@/types/domain.types'

interface Props {
  defaultValues?: Partial<CrearServicioInput>
  onSubmit: (data: CrearServicioInput) => void
  onDraftChange?: (draft: Partial<CrearServicioInput> | null) => void
  onCreateClienteRequest?: (draft: Partial<CrearServicioInput>) => void
  onBeforeOpenCierre?: (data: CrearServicioInput) => boolean | Promise<boolean>
  clearDraftSignal?: number
  refaccionesContent?: ReactNode
  cierreContent?: ReactNode
  canShowCierre?: boolean
  cierreHelpText?: string
  cierre?: Cierre | null
  isLoading?: boolean
  servicio?: Servicio
  formId?: string
  showSubmitButton?: boolean
  requireTecnicoParaEnRuta?: boolean
  requireFechaServicioParaCompletar?: boolean
  allowClosedServiceEvidenceChanges?: boolean
}

function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

function buildTaggedFile(file: File, prefix: 'ev-foto' | 'orden-servicio'): File {
  const taggedName = `${prefix}__${Date.now()}__${sanitizeFilename(file.name)}`
  return new File([file], taggedName, { type: file.type })
}

function sanitizePositiveIntegerInput(value: string): string {
  return value.replace(/\D+/g, '')
}

function parsePositiveIntegerField(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'string') {
    const normalized = sanitizePositiveIntegerInput(value)
    if (!normalized) return undefined
    return Number(normalized)
  }

  return undefined
}

function getDisplayFilename(filename: string): string {
  const parts = filename.split('__')
  if (parts.length >= 3) {
    return parts.slice(2).join('__')
  }
  return filename
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function compareMaquinasByModeloSerie(left: Maquina, right: Maquina): number {
  const modelCompare = left.modelo.localeCompare(right.modelo, 'es', { sensitivity: 'base' })
  if (modelCompare !== 0) return modelCompare
  return left.serie.localeCompare(right.serie, 'es', { sensitivity: 'base' })
}

function isTipoServicioMaquinaHielo(tipoServicio: string): boolean {
  return tipoServicio.trim().toUpperCase().includes('MAQUINA HIELO')
}

const EXCLUDED_LEGACY_TIPOS_SERVICIO = new Set([
  'MTTO CORRECTIVO RUTA',
  'MTTO CORRECTIVO PISO',
  'MTTO PREVENTIVO RUTA',
  'INSTALACION',
  'RETIRO',
  'ENVIO A URBAN',
  'GARANTIA',
])

function isExcludedLegacyTipoServicio(tipoServicio: string): boolean {
  return EXCLUDED_LEGACY_TIPOS_SERVICIO.has(tipoServicio.trim().toUpperCase())
}

function mergeUniqueMaquinas(maquinas: Array<Maquina | null | undefined>): Maquina[] {
  const unique = new Map<number, Maquina>()

  for (const maquina of maquinas) {
    if (!maquina) continue
    unique.set(maquina.id, maquina)
  }

  return Array.from(unique.values()).sort(compareMaquinasByModeloSerie)
}

function sanitizeCurrencyInput(value: string): string {
  const normalized = value.replace(/[^0-9.]/g, '')
  if (!normalized) return ''

  const firstDot = normalized.indexOf('.')
  if (firstDot === -1) return normalized

  const rawIntegerPart = normalized.slice(0, firstDot)
  const integerPart = rawIntegerPart.length ? rawIntegerPart : '0'
  const decimalRaw = normalized.slice(firstDot + 1).replace(/\./g, '')
  const hasTrailingDot = normalized.endsWith('.') && decimalRaw.length === 0
  const decimalPart = decimalRaw.slice(0, 2)

  if (hasTrailingDot) return `${integerPart}.`
  return decimalPart.length ? `${integerPart}.${decimalPart}` : integerPart
}

function formatCurrencyForInput(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeValue)
}

function formatCurrencyForEditing(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0
  return safeValue.toFixed(2)
}

const DEFAULT_TIPOS_SERVICIO = [
  'MTTO CORRECTIVO PISO - MAQUINA HIELO',
  'MTTO PREVENTIVO RUTA - MAQUINA HIELO',
  'INSTALACION - MAQUINA HIELO',
  'RETIRO - MAQUINA HIELO',
  'FLETE MOV GZ - MAQUINA HIELO',
]

const DEFAULT_CLASES_ORDEN = ['ZSM1', 'ZSI2']
const COSTO_MANO_OBRA_DEFAULT = 0

interface TipoServicioDefaults {
  clase_orden: string | null
  costo_mano_obra: number
}

function getTipoServicioDefaults(tipoServicio: string): TipoServicioDefaults {
  const normalized = tipoServicio.trim().toUpperCase()

  if (normalized.includes('INSTALACION') || normalized.includes('RETIRO')) {
    return {
      clase_orden: 'ZSI2',
      costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
    }
  }

  if (normalized.includes('MTTO') || normalized.includes('GARANTIA')) {
    return {
      clase_orden: 'ZSM1',
      costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
    }
  }

  return {
    clase_orden: null,
    costo_mano_obra: COSTO_MANO_OBRA_DEFAULT,
  }
}

function isOrdenServicioFilename(filename: string): boolean {
  return filename.startsWith('orden-servicio__')
}

interface EvidenciaPreview {
  filename: string
  downloadUrl: string
}

interface EvidenciaThumbnailProps {
  evidencia: Evidencia
  disableDelete?: boolean
  onRequestDelete: (evidencia: Evidencia) => void
  onPreview: (preview: EvidenciaPreview) => void
}

function EvidenciaThumbnail({
  evidencia,
  disableDelete = false,
  onRequestDelete,
  onPreview,
}: EvidenciaThumbnailProps) {
  const { data } = useEvidenciaUrlQuery(evidencia.r2_key)
  const downloadUrl = data?.downloadUrl
  const displayFilename = getDisplayFilename(evidencia.filename)
  const isOrdenServicio = isOrdenServicioFilename(evidencia.filename)

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        className="block w-full text-left disabled:cursor-not-allowed"
        onClick={() => {
          if (!downloadUrl) return
          onPreview({ filename: displayFilename, downloadUrl })
        }}
        disabled={!downloadUrl}
      >
        <div className="relative h-28 w-full bg-slate-100">
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
          <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
        </div>
      </button>

      <button
        type="button"
        className="absolute right-2 top-2 z-10 rounded-full bg-white/95 p-1.5 text-red-600 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        onClick={(event) => {
          event.stopPropagation()
          onRequestDelete(evidencia)
        }}
        disabled={disableDelete}
        aria-label={`Eliminar ${displayFilename}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <p className="truncate px-2 py-1.5 text-xs text-ran-slate">{displayFilename}</p>
      {disableDelete && (
        <div className="absolute inset-0 z-10 rounded-xl bg-white/60" />
      )}
    </div>
  )
}

export function ServicioForm({
  defaultValues,
  onSubmit,
  onDraftChange,
  onCreateClienteRequest,
  onBeforeOpenCierre,
  clearDraftSignal,
  refaccionesContent,
  cierreContent,
  canShowCierre = false,
  cierreHelpText,
  cierre,
  isLoading,
  servicio,
  formId,
  showSubmitButton = true,
  requireTecnicoParaEnRuta = false,
  requireFechaServicioParaCompletar = false,
  allowClosedServiceEvidenceChanges = false,
}: Props) {
  const [openClienteModal, setOpenClienteModal] = useState(false)
  const [openMaquinaModal, setOpenMaquinaModal] = useState(false)
  const [openCierreDialog, setOpenCierreDialog] = useState(false)
  const [costoDisplayValue, setCostoDisplayValue] = useState('')
  const [isCostoFocused, setIsCostoFocused] = useState(false)
  const [ultimaMaquinaCreada, setUltimaMaquinaCreada] = useState<Maquina | null>(null)
  const [maquinasTemporalesInstalacionIds, setMaquinasTemporalesInstalacionIds] = useState<number[]>([])
  const [dismissedInstallationMachineIds, setDismissedInstallationMachineIds] = useState<number[]>([])
  const [previewEvidencia, setPreviewEvidencia] = useState<EvidenciaPreview | null>(null)
  const [evidenciaAEliminar, setEvidenciaAEliminar] = useState<Evidencia | null>(null)
  const { toast } = useToast()
  const evidenciaFotosInputRef = useRef<HTMLInputElement>(null)
  const evidenciaOrdenInputRef = useRef<HTMLInputElement>(null)
  const ultimoDefaultTipoRef = useRef<TipoServicioDefaults | null>(null)
  const previousIsInstalacionRef = useRef<boolean | null>(null)
  const lastServicioFormResetKeyRef = useRef<string | null>(null)
  const todayIso = formatLocalIsoDate(new Date())

  const {
    register,
    handleSubmit,
    getValues,
    watch,
    setValue,
    reset,
    setError,
    trigger,
    clearErrors,
    formState: { errors, isDirty },
  } = useForm<CrearServicioInput>({
    resolver: zodResolver(crearServicioSchema),
    defaultValues: {
      tipo_servicio: '',
      costo_mano_obra: 0,
      fecha_solicitud: todayIso,
      ...defaultValues,
      ...(servicio
        ? {
            tipo_servicio: servicio.tipo_servicio,
            clase_orden: servicio.clase_orden ?? undefined,
            cliente_id: servicio.cliente_id ?? undefined,
            maquina_id: servicio.maquina_id ?? undefined,
            tecnico_id: servicio.tecnico_id ?? undefined,
            descripcion: servicio.descripcion ?? undefined,
            fecha_solicitud: servicio.fecha_solicitud ?? undefined,
            fecha_servicio: servicio.fecha_servicio ?? undefined,
            costo_mano_obra: servicio.costo_mano_obra,
            orden: servicio.orden ?? undefined,
            aviso: servicio.aviso ?? undefined,
          }
        : {}),
    },
  })

  const clienteId = watch('cliente_id')
  const maquinaId = watch('maquina_id')
  const tipoServicioValue = watch('tipo_servicio') ?? ''
  const claseOrdenValue = watch('clase_orden') ?? null
  const costoManoObra = watch('costo_mano_obra') ?? 0
  const tecnicoSeleccionado = watch('tecnico_id')
  const fechaSolicitudCapturada = watch('fecha_solicitud') ?? null
  const fechaServicioCapturada = watch('fecha_servicio') ?? null
  const isInstalacion = tipoServicioValue.trim().toUpperCase().includes('INSTALACION')
  const wasOriginalInstalacion = Boolean(servicio?.tipo_servicio?.trim().toUpperCase().includes('INSTALACION'))
  const maxFechaSolicitud = fechaServicioCapturada && fechaServicioCapturada < todayIso
    ? fechaServicioCapturada
    : todayIso
  const minFechaServicio = fechaSolicitudCapturada ?? undefined

  const { data: tecnicos = [] } = useTecnicosQuery()
  const { data: clientes = [] } = useClientesQuery()
  const { data: maquinas = [] } = useMaquinasQuery(clienteId)
  const { data: maquinasCatalogo = [] } = useMaquinasQuery()
  const { data: maquinasTallerAbiertas = [] } = useMaquinasEnTallerQuery({ soloAbiertas: true })
  const { data: serviciosRegistrados = [] } = useServiciosQuery()
  const { mutateAsync: crearCliente, isPending: isCreatingCliente } = useCrearClienteMutation()
  const { mutateAsync: crearMaquina, isPending: isCreatingMaquina } = useCrearMaquinaMutation()
  const { mutateAsync: descartarMaquinaPendienteInstalacion } = useDescartarMaquinaPendienteInstalacionMutation()
  const servicioId = servicio?.id ?? 0
  const { data: evidencias = [], isLoading: loadingEvidencias } = useEvidenciasQuery(servicioId, Boolean(servicio?.id))
  const { mutateAsync: subirEvidenciaAsync, isPending: subiendoEvidencia } = useSubirEvidenciaMutation(servicioId, {
    allowClosedServiceChanges: allowClosedServiceEvidenceChanges,
  })
  const { mutateAsync: eliminarEvidenciaAsync, isPending: eliminandoEvidencia } = useEliminarEvidenciaMutation(servicioId, {
    allowClosedServiceChanges: allowClosedServiceEvidenceChanges,
  })

  const clienteModalForm = useForm<CrearClienteInput>({
    resolver: zodResolver(crearClienteSchema),
    defaultValues: {
      codigo_cliente: '',
      nombre: '',
      direccion: null,
      municipio: null,
      telefono: null,
      correo_contacto: null,
      activo: true,
    },
  })

  const maquinaModalForm = useForm<CrearMaquinaInput>({
    resolver: zodResolver(crearMaquinaSchema),
    defaultValues: {
      serie: '',
      modelo: '',
      cliente_id: null,
      fecha_instalacion: null,
      status: 'operando',
      observaciones: null,
      activo: true,
    },
  })

  const selectedCliente = clientes.find((cliente) => cliente.id === clienteId)

  const maquinasInstalables = useMemo(() => {
    const maquinasDisponiblesEnTaller = maquinasTallerAbiertas
      .map((registro) => {
        if (registro.maquina) return registro.maquina
        return maquinasCatalogo.find((maquinaCatalogo) => maquinaCatalogo.id === registro.maquina_id) ?? null
      })

    return mergeUniqueMaquinas(maquinasDisponiblesEnTaller)
  }, [maquinasCatalogo, maquinasTallerAbiertas])

  const maquinasClienteOperativas = useMemo(
    () => maquinas.filter((maquina) => maquina.status === 'operando'),
    [maquinas],
  )

  const maquinasDisponiblesBase = isInstalacion ? maquinasInstalables : maquinasClienteOperativas
  const dismissedInstallationMachineIdsSet = useMemo(
    () => new Set(dismissedInstallationMachineIds),
    [dismissedInstallationMachineIds],
  )
  const currentServiceMachineId = useMemo(() => {
    if (typeof servicio?.maquina_id !== 'number') return null

    if (isInstalacion) {
      if (
        wasOriginalInstalacion
        && !dismissedInstallationMachineIdsSet.has(servicio.maquina_id)
      ) {
        return servicio.maquina_id
      }

      return null
    }

    return wasOriginalInstalacion ? null : servicio.maquina_id
  }, [dismissedInstallationMachineIdsSet, isInstalacion, servicio?.maquina_id, wasOriginalInstalacion])

  const maquinasDisponibles = useMemo(() => {
    const extras: Array<Maquina | null | undefined> = []

    if (currentServiceMachineId === servicio?.maquina?.id) {
      extras.push(servicio.maquina)
    } else if (typeof currentServiceMachineId === 'number') {
      extras.push(maquinasCatalogo.find((maquinaCatalogo) => maquinaCatalogo.id === currentServiceMachineId) ?? null)
    }

    if (
      ultimaMaquinaCreada
      && !dismissedInstallationMachineIdsSet.has(ultimaMaquinaCreada.id)
      && (isInstalacion || !clienteId || ultimaMaquinaCreada.cliente_id === clienteId)
    ) {
      extras.push(ultimaMaquinaCreada)
    }

    return mergeUniqueMaquinas([...maquinasDisponiblesBase, ...extras])
  }, [
    clienteId,
    currentServiceMachineId,
    dismissedInstallationMachineIdsSet,
    isInstalacion,
    maquinasCatalogo,
    maquinasDisponiblesBase,
    servicio?.maquina,
    ultimaMaquinaCreada,
  ])
  const maquinasDisponiblesIds = useMemo(
    () => new Set(maquinasDisponibles.map((maquina) => maquina.id)),
    [maquinasDisponibles],
  )
  const selectedMaquina = maquinasDisponibles.find((maquina) => maquina.id === maquinaId)
    ?? maquinasCatalogo.find((maquina) => maquina.id === maquinaId)
    ?? (ultimaMaquinaCreada?.id === maquinaId ? ultimaMaquinaCreada : undefined)
  const tiposServicioOptions = Array.from(
    new Set(
      [
        ...DEFAULT_TIPOS_SERVICIO,
        tipoServicioValue.trim(),
        ...serviciosRegistrados
          .map((servicio) => servicio.tipo_servicio?.trim())
          .filter((tipo): tipo is string => Boolean(tipo)),
      ],
    ),
  )
    .filter((tipo) => {
      if (!tipo) return false
      if (tipo === tipoServicioValue.trim()) return true
      if (isTipoServicioMaquinaHielo(tipo)) return true
      return !isExcludedLegacyTipoServicio(tipo)
    })
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))

  const clasesOrdenOptions = Array.from(
    new Set(
      [
        ...DEFAULT_CLASES_ORDEN,
        ...serviciosRegistrados
          .map((servicio) => (servicio.clase_orden as unknown as string) ?? '')
          .filter((clase): clase is string => clase.trim().length > 0),
      ],
    ),
  )
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))

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

  const fotosFaltantes = Math.max(0, REQUIRED_SERVICE_PHOTOS - evidenciasFotos.length)

  // Sincronizar formulario cuando llegan datos actualizados del servidor
  useEffect(() => {
    if (!servicio) {
      lastServicioFormResetKeyRef.current = null
      return
    }

    const resetKey = `${servicio.id}:${servicio.updated_at ?? ''}`
    if (lastServicioFormResetKeyRef.current === resetKey) return

    lastServicioFormResetKeyRef.current = resetKey
    reset({
      tipo_servicio: servicio.tipo_servicio,
      clase_orden: servicio.clase_orden ?? undefined,
      cliente_id: servicio.cliente_id ?? undefined,
      maquina_id: servicio.maquina_id ?? undefined,
      tecnico_id: servicio.tecnico_id ?? undefined,
      descripcion: servicio.descripcion ?? undefined,
      fecha_solicitud: servicio.fecha_solicitud ?? undefined,
      fecha_servicio: servicio.fecha_servicio ?? undefined,
      costo_mano_obra: servicio.costo_mano_obra,
      orden: servicio.orden ?? undefined,
      aviso: servicio.aviso ?? undefined,
    })
  }, [reset, servicio])

  // Reset maquina_id cuando cambia el cliente
  useEffect(() => {
    if (!servicio && !isInstalacion) {
      setValue('maquina_id', undefined as unknown as number)
    }
  }, [clienteId, isInstalacion, setValue, servicio])

  useEffect(() => {
    if (servicio || !tipoServicioValue) return

    const defaults = getTipoServicioDefaults(tipoServicioValue)
    const previousDefaults = ultimoDefaultTipoRef.current
    const claseActual = (getValues('clase_orden') ?? null)
    const costoActual = getValues('costo_mano_obra') ?? 0

    if (
      (!claseActual || claseActual === previousDefaults?.clase_orden)
      && defaults.clase_orden !== claseActual
    ) {
      setValue('clase_orden', defaults.clase_orden, {
        shouldValidate: true,
        shouldDirty: true,
      })
    }

    if (
      (costoActual === 0 || costoActual === previousDefaults?.costo_mano_obra)
      && defaults.costo_mano_obra !== costoActual
    ) {
      setValue('costo_mano_obra', defaults.costo_mano_obra, {
        shouldValidate: true,
        shouldDirty: true,
      })
    }

    ultimoDefaultTipoRef.current = defaults
  }, [getValues, servicio, setValue, tipoServicioValue])

  useEffect(() => {
    if (openMaquinaModal && clienteId) {
      maquinaModalForm.setValue('cliente_id', isInstalacion ? null : clienteId)
    }
  }, [clienteId, isInstalacion, maquinaModalForm, openMaquinaModal])

  useEffect(() => {
    if (!ultimaMaquinaCreada) return
    if (!isInstalacion && clienteId && ultimaMaquinaCreada.cliente_id !== clienteId) {
      setUltimaMaquinaCreada(null)
    }
  }, [clienteId, isInstalacion, ultimaMaquinaCreada])

  useEffect(() => {
    const previousIsInstalacion = previousIsInstalacionRef.current
    const selectedMachineId = getValues('maquina_id')

    if (previousIsInstalacion === null) {
      previousIsInstalacionRef.current = isInstalacion
      return
    }

    if (previousIsInstalacion && !isInstalacion) {
      if (maquinasTemporalesInstalacionIds.length > 0) {
        void Promise.all(
          maquinasTemporalesInstalacionIds.map((machineId) => descartarMaquinaPendienteInstalacion(machineId)),
        ).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'No se pudo descartar la máquina temporal.'
          toast({
            title: 'Máquina temporal no descartada',
            description: message,
            variant: 'destructive',
          })
        })

        setDismissedInstallationMachineIds((current) => {
          const next = new Set(current)
          maquinasTemporalesInstalacionIds.forEach((machineId) => next.add(machineId))
          return Array.from(next)
        })
        setMaquinasTemporalesInstalacionIds([])
      }

      if (typeof selectedMachineId === 'number' && Number.isFinite(selectedMachineId)) {
        if (
          ultimaMaquinaCreada?.id === selectedMachineId
          && !maquinasTemporalesInstalacionIds.includes(selectedMachineId)
        ) {
          void descartarMaquinaPendienteInstalacion(selectedMachineId).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : 'No se pudo descartar la máquina temporal.'
            toast({
              title: 'Máquina temporal no descartada',
              description: message,
              variant: 'destructive',
            })
          })
        }

        setDismissedInstallationMachineIds((current) => (
          current.includes(selectedMachineId) ? current : [...current, selectedMachineId]
        ))
        setValue('maquina_id', undefined as unknown as number, {
          shouldValidate: true,
          shouldDirty: true,
        })
        setUltimaMaquinaCreada((current) => (
          current?.id === selectedMachineId ? null : current
        ))
      }
    }

    if (!previousIsInstalacion && isInstalacion) {
      if (typeof selectedMachineId === 'number' && selectedMachineId > 0) {
        setValue('maquina_id', undefined as unknown as number, {
          shouldValidate: true,
          shouldDirty: true,
        })
      }
    }

    previousIsInstalacionRef.current = isInstalacion
  }, [
    descartarMaquinaPendienteInstalacion,
    getValues,
    isInstalacion,
    maquinasTemporalesInstalacionIds,
    setValue,
    toast,
    ultimaMaquinaCreada?.id,
  ])

  useEffect(() => {
    if (!maquinaId) return
    if (currentServiceMachineId != null && maquinaId === currentServiceMachineId) return
    if (maquinasDisponiblesIds.has(maquinaId)) return

    setValue('maquina_id', undefined as unknown as number, {
      shouldValidate: true,
      shouldDirty: true,
    })
  }, [currentServiceMachineId, maquinaId, maquinasDisponiblesIds, setValue])

  useEffect(() => {
    onDraftChange?.(isDirty ? ({}) : null)
  }, [isDirty, onDraftChange])

  useEffect(() => {
    if (clearDraftSignal === undefined) return
    reset(getValues())
  }, [clearDraftSignal, getValues, reset])

  const handleOpenCierreClick = () => {
    void handleSubmit(async (data) => {
      const shouldOpen = onBeforeOpenCierre
        ? await onBeforeOpenCierre(data)
        : true

      if (shouldOpen) {
        setOpenCierreDialog(true)
      }
    })()
  }

  useEffect(() => {
    if (tecnicoSeleccionado) {
      clearErrors('tecnico_id')
    }
  }, [tecnicoSeleccionado, clearErrors])

  useEffect(() => {
    if (isCostoFocused) return
    setCostoDisplayValue(formatCurrencyForInput(costoManoObra))
  }, [costoManoObra, isCostoFocused])

  useEffect(() => {
    if (!fechaSolicitudCapturada && !fechaServicioCapturada) {
      clearErrors(['fecha_solicitud', 'fecha_servicio'])
      return
    }

    void trigger(['fecha_solicitud', 'fecha_servicio'])
  }, [clearErrors, fechaServicioCapturada, fechaSolicitudCapturada, trigger])

  const handleFormSubmit = handleSubmit((data) => {
    let hasManualValidationError = false
    const resolvedMachineId = typeof data.maquina_id === 'number' ? data.maquina_id : currentServiceMachineId

    if (typeof resolvedMachineId !== 'number' || resolvedMachineId <= 0) {
      setError('maquina_id', {
        type: 'manual',
        message: 'Selecciona una máquina.',
      })
      hasManualValidationError = true
    }

    if (requireTecnicoParaEnRuta && !data.tecnico_id) {
      setError('tecnico_id', {
        type: 'manual',
        message: 'Para poner el servicio en ruta, asigna un técnico.',
      })
      hasManualValidationError = true
    }

    if (requireFechaServicioParaCompletar && !data.fecha_servicio) {
      setError('fecha_servicio', {
        type: 'manual',
        message: 'Para marcarlo como completado, captura la fecha de servicio.',
      })
      hasManualValidationError = true
    }

    if (
      isInstalacion
      && typeof data.maquina_id === 'number'
      && !maquinasDisponiblesIds.has(data.maquina_id)
      && data.maquina_id !== currentServiceMachineId
    ) {
      setError('maquina_id', {
        type: 'manual',
        message: 'Para una instalación solo puedes elegir una máquina disponible en taller o registrarla manualmente.',
      })
      hasManualValidationError = true
    }

    if (hasManualValidationError) return

    onSubmit(data)
  })

  const handleClienteChange = (id: number | null, cliente: Cliente | null) => {
    setValue('cliente_id', id ?? (undefined as unknown as number), { shouldValidate: true, shouldDirty: true })
    if (!isInstalacion) {
      setValue('maquina_id', undefined as unknown as number, { shouldValidate: true, shouldDirty: true })
    }
    void cliente
  }

  const handleCostoChange = (value: string) => {
    const sanitized = sanitizeCurrencyInput(value)
    const parsed = sanitized === '' || sanitized === '.' ? 0 : Number(sanitized)
    const safeValue = Number.isFinite(parsed) ? parsed : 0

    setCostoDisplayValue(sanitized)
    setValue('costo_mano_obra', safeValue, {
      shouldValidate: true,
      shouldDirty: true,
    })
  }

  const handleRequestCrearCliente = () => {
    if (onCreateClienteRequest) {
      onCreateClienteRequest(getValues())
      return
    }

    setOpenClienteModal(true)
  }

  const handleCrearCliente = clienteModalForm.handleSubmit(async (values) => {
    try {
      const created = await crearCliente({
        ...values,
        direccion: values.direccion || null,
        municipio: values.municipio || null,
        telefono: values.telefono || null,
        correo_contacto: values.correo_contacto || null,
      })

      setValue('cliente_id', created.id, { shouldValidate: true, shouldDirty: true })
      setValue('maquina_id', undefined as unknown as number, { shouldValidate: true, shouldDirty: true })
      setOpenClienteModal(false)
      clienteModalForm.reset()
      toast({
        title: 'Cliente creado',
        description: `${created.nombre} fue agregado al catálogo.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear el cliente.'
      toast({
        title: 'Error al crear cliente',
        description: message,
        variant: 'destructive',
      })
    }
  })

  const handleCrearMaquina = maquinaModalForm.handleSubmit(async (values) => {
    if (!clienteId) {
      toast({
        title: 'Selecciona cliente primero',
        description: 'Debes seleccionar o crear un cliente antes de registrar la máquina.',
        variant: 'destructive',
      })
      return
    }

    try {
      const creandoParaInstalacion = isInstalacion
      const created = await crearMaquina({
        ...values,
        cliente_id: creandoParaInstalacion ? null : clienteId,
        fecha_instalacion: creandoParaInstalacion ? null : values.fecha_instalacion || null,
        status: creandoParaInstalacion ? 'en_taller' : 'operando',
        observaciones: values.observaciones || null,
      })

      setUltimaMaquinaCreada(created)
      if (creandoParaInstalacion) {
        setMaquinasTemporalesInstalacionIds((current) => (
          current.includes(created.id) ? current : [...current, created.id]
        ))
      }
      setValue('maquina_id', created.id, { shouldValidate: true, shouldDirty: true })
      setOpenMaquinaModal(false)
      maquinaModalForm.reset({
        serie: '',
        modelo: '',
        cliente_id: creandoParaInstalacion ? null : clienteId,
        fecha_instalacion: null,
        status: creandoParaInstalacion ? 'en_taller' : 'operando',
        observaciones: null,
        activo: true,
      })
      toast({
        title: 'Máquina creada',
        description: creandoParaInstalacion
          ? `Serie ${created.serie} registrada como pendiente de instalación para ${selectedCliente?.nombre ?? 'el cliente seleccionado'}.`
          : `Serie ${created.serie} registrada para ${selectedCliente?.nombre ?? 'el cliente seleccionado'}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear la máquina.'
      toast({
        title: 'Error al crear máquina',
        description: message,
        variant: 'destructive',
      })
    }
  })

  const handleAgregarEvidenciasFotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return

    try {
      for (const file of files) {
        const taggedFile = buildTaggedFile(file, 'ev-foto')
        await subirEvidenciaAsync(taggedFile)
      }
      toast({
        title: 'Evidencias subidas',
        description: `${files.length} archivo(s) cargado(s) correctamente.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron subir las evidencias.'
      toast({ title: 'Error al subir evidencias', description: message, variant: 'destructive' })
    } finally {
      if (evidenciaFotosInputRef.current) evidenciaFotosInputRef.current.value = ''
    }
  }

  const handleAgregarOrdenServicio = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const taggedFile = buildTaggedFile(file, 'orden-servicio')
      await subirEvidenciaAsync(taggedFile)
      toast({
        title: 'Orden de servicio subida',
        description: 'La evidencia de la hoja de orden se guardó correctamente.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo subir la orden de servicio.'
      toast({ title: 'Error al subir orden', description: message, variant: 'destructive' })
    } finally {
      if (evidenciaOrdenInputRef.current) evidenciaOrdenInputRef.current.value = ''
    }
  }

  const handleConfirmarEliminarEvidencia = async () => {
    if (!evidenciaAEliminar) return

    try {
      await eliminarEvidenciaAsync(evidenciaAEliminar.id)
      if (previewEvidencia?.filename === getDisplayFilename(evidenciaAEliminar.filename)) {
        setPreviewEvidencia(null)
      }
      toast({
        title: isOrdenServicioFilename(evidenciaAEliminar.filename)
          ? 'Orden de servicio eliminada'
          : 'Evidencia eliminada',
        description: isOrdenServicioFilename(evidenciaAEliminar.filename)
          ? 'La hoja de orden fue eliminada correctamente.'
          : 'La imagen fue eliminada correctamente.',
      })
      setEvidenciaAEliminar(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo eliminar la evidencia.'
      toast({
        title: 'Error al eliminar evidencia',
        description: message,
        variant: 'destructive',
      })
    }
  }

  const avisoField = register('aviso', {
    setValueAs: parsePositiveIntegerField,
  })

  const ordenField = register('orden', {
    setValueAs: parsePositiveIntegerField,
  })

  return (
    <form id={formId} onSubmit={handleFormSubmit} className="space-y-3">
      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-2 xl:items-stretch">
        <section className="h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-lg font-bold text-ran-navy">Información del servicio</h3>
          <p className="mt-1 text-sm text-ran-slate">Complete la información operativa y administrativa</p>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="fecha_solicitud">Fecha solicitud *</Label>
              <input type="hidden" {...register('fecha_solicitud')} />
              <DatePickerInput
                value={fechaSolicitudCapturada}
                onChange={(value) => {
                  const safeValue = value && value > todayIso ? todayIso : value
                  setValue('fecha_solicitud', safeValue ?? '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }}
                placeholder="Seleccionar fecha solicitud"
                maxDate={maxFechaSolicitud}
              />
              {errors.fecha_solicitud && <p className="text-xs text-destructive">{errors.fecha_solicitud.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo_servicio">Tipo de servicio *</Label>
              <CreatableCombobox
                value={tipoServicioValue}
                options={tiposServicioOptions}
                onChange={(value) =>
                  setValue('tipo_servicio', value ?? '', {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Seleccionar tipo"
                searchPlaceholder="Escribe para buscar o crear tipo de servicio"
                contentClassName="sm:w-[30rem] sm:max-w-[30rem]"
              />
              {errors.tipo_servicio && <p className="text-xs text-destructive">{errors.tipo_servicio.message}</p>}
              {!errors.tipo_servicio && (
                <p className="text-xs text-ran-slate">Si no aparece en la lista, escríbelo para guardarlo en el flujo.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clase_orden">Clase de orden</Label>
              <CreatableCombobox
                value={claseOrdenValue}
                options={clasesOrdenOptions}
                onChange={(value) =>
                  setValue('clase_orden', value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                placeholder="Seleccionar clase"
                searchPlaceholder="Escribe para buscar o crear clase de orden"
                allowClear
                clearLabel="Sin clase"
              />
              <p className="text-xs text-ran-slate">También puedes capturar una clase nueva si aún no está registrada.</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="aviso">No. Aviso *</Label>
              <Input
                id="aviso"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-11 rounded-xl"
                {...avisoField}
                onChange={(event) => {
                  event.target.value = sanitizePositiveIntegerInput(event.target.value)
                  void avisoField.onChange(event)
                }}
              />
              {errors.aviso && <p className="text-xs text-destructive">{errors.aviso.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="orden">No. Orden *</Label>
              <Input
                id="orden"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-11 rounded-xl"
                {...ordenField}
                onChange={(event) => {
                  event.target.value = sanitizePositiveIntegerInput(event.target.value)
                  void ordenField.onChange(event)
                }}
              />
              {errors.orden && <p className="text-xs text-destructive">{errors.orden.message}</p>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tecnico_id">Técnico asignado</Label>
              <Select
                value={watch('tecnico_id') ?? 'none'}
                onValueChange={(value) => setValue('tecnico_id', value === 'none' ? null : value, { shouldValidate: true, shouldDirty: true })}
              >
                <SelectTrigger
                  id="tecnico_id"
                  className={`h-11 rounded-xl ${errors.tecnico_id ? 'border-destructive' : ''}`}
                >
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar por ahora</SelectItem>
                  {tecnicos.map((tecnico) => (
                    <SelectItem key={tecnico.id} value={tecnico.id}>{tecnico.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.tecnico_id ? (
                <p className="text-xs text-destructive">{errors.tecnico_id.message}</p>
              ) : (
                <p className="text-xs text-ran-slate">Puedes asignarlo después, cuando se confirme la ruta del día.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fecha_servicio">Fecha servicio</Label>
              <input type="hidden" {...register('fecha_servicio')} />
              <DatePickerInput
                value={fechaServicioCapturada}
                onChange={(value) => {
                  setValue('fecha_servicio', value, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }}
                placeholder="Seleccionar fecha servicio"
                allowClear
                minDate={minFechaServicio}
                className={errors.fecha_servicio ? 'rounded-xl border border-destructive p-0.5' : undefined}
              />
              {errors.fecha_servicio && <p className="text-xs text-destructive">{errors.fecha_servicio.message}</p>}
            </div>
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="descripcion">Descripción</Label>
            <textarea
              id="descripcion"
              {...register('descripcion')}
              rows={4}
              placeholder="Describe el trabajo a realizar..."
              className="flex w-full resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            {errors.descripcion && <p className="text-xs text-destructive">{errors.descripcion.message}</p>}
          </div>

          <div className="mt-3 space-y-1.5">
            <Label htmlFor="costo_mano_obra">Costo del servicio</Label>
            <input
              type="hidden"
              {...register('costo_mano_obra', {
                setValueAs: (value: string) => (value === '' ? 0 : Number(value)),
              })}
            />
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-ran-slate">$</span>
              <Input
                id="costo_mano_obra"
                type="text"
                inputMode="decimal"
                value={costoDisplayValue}
                onChange={(event) => handleCostoChange(event.target.value)}
                onFocus={() => {
                  setIsCostoFocused(true)
                  setCostoDisplayValue(Number(costoManoObra ?? 0) === 0 ? '' : formatCurrencyForEditing(costoManoObra))
                }}
                onBlur={() => {
                  setIsCostoFocused(false)
                  setCostoDisplayValue(formatCurrencyForInput(costoManoObra))
                }}
                placeholder="0.00"
                className="h-11 rounded-xl pl-8"
              />
            </div>
          </div>
        </section>

        <div className="flex h-full flex-col gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-ran-navy">Cliente y máquina</h3>
              <p className="mt-1 text-sm text-ran-slate">Se autollena al seleccionar cliente y máquina</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <Label className="min-w-0 inline-flex items-center gap-1 leading-none">
                  <span>Cliente</span>
                  <span className="text-ran-navy">*</span>
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 min-w-fit justify-self-end whitespace-nowrap rounded-lg px-2.5 text-xs sm:px-3 sm:text-sm"
                  onClick={handleRequestCrearCliente}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Crear cliente</span>
                </Button>
              </div>
              <ClienteCombobox value={clienteId ?? null} onChange={handleClienteChange} />
              {errors.cliente_id && <p className="text-xs text-destructive">{errors.cliente_id.message}</p>}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="codigo_cliente">Código de cliente</Label>
                <Input id="codigo_cliente" readOnly value={selectedCliente?.codigo_cliente ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nombre_cliente">Establecimiento</Label>
                <Input id="nombre_cliente" readOnly value={selectedCliente?.nombre ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="direccion_cliente">Dirección</Label>
                <Input
                  id="direccion_cliente"
                  readOnly
                  value={selectedCliente?.direccion?.trim() ? selectedCliente.direccion : ''}
                  placeholder={selectedCliente && !selectedCliente.direccion?.trim() ? 'Sin dirección registrada' : 'Se llena automáticamente'}
                  className="h-11 rounded-xl bg-slate-50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telefono_cliente">Teléfono</Label>
                <Input id="telefono_cliente" readOnly value={selectedCliente?.telefono ?? ''} placeholder="Sin teléfono registrado" className="h-11 rounded-xl bg-slate-50" />
              </div>
            </div>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <Label htmlFor="maquina_id" className="min-w-0 inline-flex items-center gap-1 leading-none">
                    <span className="sm:hidden">Máquina</span>
                    <span className="hidden sm:inline">Modelo máquina</span>
                    <span className="text-ran-navy">*</span>
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 min-w-fit justify-self-end whitespace-nowrap rounded-lg px-2.5 text-xs sm:px-3 sm:text-sm"
                    onClick={() => setOpenMaquinaModal(true)}
                    disabled={!clienteId}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="sm:hidden">Registrar</span>
                    <span className="hidden sm:inline">Registrar máquina</span>
                  </Button>
                </div>
                <Select
                  value={watch('maquina_id') ? String(watch('maquina_id')) : undefined}
                  onValueChange={(value) => setValue('maquina_id', Number(value), { shouldValidate: true, shouldDirty: true })}
                  disabled={!isInstalacion && !clienteId}
                >
                  <SelectTrigger id="maquina_id" className="h-11 rounded-xl">
                    <SelectValue placeholder={isInstalacion ? 'Seleccionar máquina de taller' : clienteId ? 'Seleccionar máquina' : 'Selecciona cliente primero'} />
                  </SelectTrigger>
                  <SelectContent className="max-w-[20rem]">
                    {maquinasDisponibles.length > 0 ? (
                      maquinasDisponibles.map((maquina) => (
                        <SelectItem key={maquina.id} value={String(maquina.id)}>{maquina.modelo}</SelectItem>
                      ))
                    ) : (
                      <div className="max-w-[18rem] px-3 py-2 text-sm leading-snug text-ran-slate">
                        {isInstalacion
                          ? 'Sin máquinas listas en taller. Usa Registrar máquina.'
                          : 'Cliente sin máquinas operando registradas. Usa Registrar máquina.'}
                      </div>
                    )}
                  </SelectContent>
                </Select>
                {errors.maquina_id && <p className="text-xs text-destructive">{errors.maquina_id.message}</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex min-h-8 items-center">
                  <Label htmlFor="serie_maquina">Serie máquina</Label>
                </div>
                <Input id="serie_maquina" readOnly value={selectedMaquina?.serie ?? ''} placeholder="Se llena automáticamente" className="h-11 rounded-xl bg-slate-50" />
              </div>
            </div>
          </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h4 className="text-base font-bold text-ran-navy">Información de cierre</h4>
            <p className="mt-1 text-xs text-ran-slate">
              Completa el cierre al finalizar el servicio.
            </p>

            {servicio?.status === 'cerrado' || Boolean(cierre) ? (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs font-semibold text-green-700">
                  Servicio cerrado ✓
                </div>
                {cierreContent ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full rounded-xl text-sm"
                    onClick={() => setOpenCierreDialog(true)}
                  >
                    Editar formulario de cierre
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <Button
                  type="button"
                  className="h-10 w-full rounded-xl bg-ran-navy text-sm hover:bg-ran-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleOpenCierreClick}
                  disabled={!canShowCierre || !cierreContent}
                >
                  Abrir formulario de cierre
                </Button>

                <div
                  className={`rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed ${
                    canShowCierre && cierreContent
                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {canShowCierre && cierreContent
                    ? cierreHelpText ?? 'Completa el formulario de cierre y da clic en "Cerrar servicio".'
                    : cierreHelpText ?? 'Cambia el status a "Completado" para poder cerrar el servicio.'}
                </div>
              </div>
            )}

            {showSubmitButton && (
              <Button type="submit" disabled={isLoading} className="mt-3 h-10 w-full rounded-xl bg-ran-navy text-sm font-semibold hover:bg-ran-navy/90">
                {isLoading ? 'Guardando...' : servicio ? 'Actualizar servicio' : 'Guardar servicio'}
              </Button>
            )}
          </section>
        </div>
      </div>

      <div className="space-y-3">
          <section className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-lg font-bold text-ran-navy">Componentes / Refacciones</h4>
            {refaccionesContent ?? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid grid-cols-[1.4fr_0.45fr_0.55fr_0.55fr] gap-2 border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-wide text-ran-slate">
                  <span>Pieza</span>
                  <span>Cant.</span>
                  <span>P. Unit.</span>
                  <span>Total</span>
                </div>
                <p className="py-5 text-sm text-ran-slate">Las refacciones se agregan al editar el servicio.</p>
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
                  <span className="font-semibold text-ran-slate">Total del servicio</span>
                  <span className="text-base font-extrabold text-ran-navy">{formatMXN(costoManoObra)}</span>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-lg font-bold text-ran-navy">Evidencias fotográficas</h4>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${fotosFaltantes === 0 ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                {evidenciasFotos.length}/{REQUIRED_SERVICE_PHOTOS} mínimo
              </span>
            </div>
            <p className="mt-1 text-sm text-ran-slate">Sube mínimo 1 foto del servicio y agrega más si es necesario.</p>

            {!servicio?.id ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-ran-slate">
                Guarda primero el servicio para habilitar la carga de evidencias.
              </div>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {loadingEvidencias ? (
                    Array.from({ length: REQUIRED_SERVICE_PHOTOS }).map((_, index) => (
                      <div key={`skeleton-${index}`} className="h-36 animate-pulse rounded-xl bg-slate-100" />
                    ))
                  ) : (
                    <>
                      {evidenciasFotos.map((evidencia) => (
                        <EvidenciaThumbnail
                          key={evidencia.id}
                          evidencia={evidencia}
                          disableDelete={eliminandoEvidencia}
                          onRequestDelete={setEvidenciaAEliminar}
                          onPreview={setPreviewEvidencia}
                        />
                      ))}
                      {Array.from({ length: Math.max(0, REQUIRED_SERVICE_PHOTOS - evidenciasFotos.length) }).map((_, index) => (
                        <div key={`placeholder-${index}`} className="flex h-36 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-ran-slate">
                          <Camera className="mb-2 h-5 w-5 text-slate-400" />
                          Evidencia pendiente
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {fotosFaltantes > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {fotosFaltantes === 1
                      ? `Falta 1 evidencia para cumplir el mínimo de ${REQUIRED_SERVICE_PHOTOS}.`
                      : `Faltan ${fotosFaltantes} evidencias para cumplir el mínimo de ${REQUIRED_SERVICE_PHOTOS}.`}
                  </div>
                )}

                <div className="mt-4">
                  <input
                    ref={evidenciaFotosInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    capture="environment"
                    className="hidden"
                    onChange={handleAgregarEvidenciasFotos}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl"
                    onClick={() => evidenciaFotosInputRef.current?.click()}
                    disabled={subiendoEvidencia}
                  >
                    <ImagePlus className="h-4 w-4" />
                    {subiendoEvidencia ? 'Subiendo...' : 'Agregar evidencias'}
                  </Button>
                </div>
              </>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h4 className="text-lg font-bold text-ran-navy">Orden de servicio (hoja)</h4>
            <p className="mt-1 text-sm text-ran-slate">Sube la evidencia separada de la hoja de orden entregada en sitio.</p>

            {!servicio?.id ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-ran-slate">
                Guarda primero el servicio para habilitar la carga de la hoja de orden.
              </div>
            ) : (
              <>
                <div className="mt-4">
                  {evidenciaOrden ? (
                    <div className="max-w-[220px]">
                      <EvidenciaThumbnail
                        evidencia={evidenciaOrden}
                        disableDelete={eliminandoEvidencia}
                        onRequestDelete={setEvidenciaAEliminar}
                        onPreview={setPreviewEvidencia}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5">
                      <p className="text-sm text-ran-slate">Aún no se ha cargado la hoja de orden.</p>
                      <FileText className="h-5 w-5 text-slate-400" />
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <input
                    ref={evidenciaOrdenInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleAgregarOrdenServicio}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl"
                    onClick={() => evidenciaOrdenInputRef.current?.click()}
                    disabled={subiendoEvidencia}
                  >
                    <UploadCloud className="h-4 w-4" />
                    {subiendoEvidencia ? 'Subiendo...' : evidenciaOrden ? 'Reemplazar hoja de orden' : 'Subir hoja de orden'}
                  </Button>
                </div>
              </>
            )}
          </section>
      </div>

      <Dialog open={openCierreDialog} onOpenChange={setOpenCierreDialog}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Formulario de cierre</DialogTitle>
            <DialogDescription>
              Completa o corrige los datos del cierre. Al guardar, el status quedará como cerrado.
            </DialogDescription>
          </DialogHeader>
          {cierreContent}
        </DialogContent>
      </Dialog>

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

      <ConfirmDialog
        open={Boolean(evidenciaAEliminar)}
        onOpenChange={(open) => {
          if (!open) setEvidenciaAEliminar(null)
        }}
        title={
          evidenciaAEliminar && isOrdenServicioFilename(evidenciaAEliminar.filename)
            ? '¿Eliminar orden de servicio?'
            : '¿Eliminar evidencia?'
        }
        description={
          evidenciaAEliminar
            ? isOrdenServicioFilename(evidenciaAEliminar.filename)
              ? `Se eliminará la hoja de orden "${getDisplayFilename(evidenciaAEliminar.filename)}". Esta acción no se puede deshacer.`
              : `Se eliminará la imagen "${getDisplayFilename(evidenciaAEliminar.filename)}". Esta acción no se puede deshacer.`
            : 'Esta acción no se puede deshacer.'
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        variant="destructive"
        onConfirm={() => {
          void handleConfirmarEliminarEvidencia()
        }}
        isLoading={eliminandoEvidencia}
      />

      <Dialog open={openClienteModal} onOpenChange={setOpenClienteModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Crear cliente</DialogTitle>
            <DialogDescription>Registra un cliente sin salir de la orden de servicio.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCrearCliente} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nuevo_codigo_cliente">Código de cliente *</Label>
                <Input
                  id="nuevo_codigo_cliente"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Ej. 300831815"
                  {...clienteModalForm.register('codigo_cliente', {
                    onChange: (event) => {
                      event.target.value = sanitizePositiveIntegerInput(event.target.value)
                    },
                  })}
                />
                {clienteModalForm.formState.errors.codigo_cliente && (
                  <p className="text-xs text-destructive">{clienteModalForm.formState.errors.codigo_cliente.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nuevo_nombre_cliente">Nombre *</Label>
                <Input id="nuevo_nombre_cliente" {...clienteModalForm.register('nombre')} placeholder="Tkt Six Centenario" />
                {clienteModalForm.formState.errors.nombre && (
                  <p className="text-xs text-destructive">{clienteModalForm.formState.errors.nombre.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nuevo_direccion_cliente">Dirección</Label>
              <Input id="nuevo_direccion_cliente" {...clienteModalForm.register('direccion')} placeholder="Dirección del establecimiento" />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="nuevo_municipio_cliente">Municipio</Label>
                <Input id="nuevo_municipio_cliente" {...clienteModalForm.register('municipio')} placeholder="Monterrey" />
              </div>

              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="nuevo_telefono_cliente">Teléfono</Label>
                <Input id="nuevo_telefono_cliente" {...clienteModalForm.register('telefono')} placeholder="81..." />
              </div>

              <div className="space-y-1.5 sm:col-span-1">
                <Label htmlFor="nuevo_correo_cliente">Correo</Label>
                <Input id="nuevo_correo_cliente" type="email" {...clienteModalForm.register('correo_contacto')} placeholder="contacto@cliente.com" />
                {clienteModalForm.formState.errors.correo_contacto && (
                  <p className="text-xs text-destructive">{clienteModalForm.formState.errors.correo_contacto.message}</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenClienteModal(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-ran-navy hover:bg-ran-navy/90" disabled={isCreatingCliente}>
                {isCreatingCliente ? 'Guardando...' : 'Guardar cliente'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={openMaquinaModal} onOpenChange={setOpenMaquinaModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Registrar máquina</DialogTitle>
            <DialogDescription>
              {isInstalacion
                ? 'La máquina quedará pendiente de instalación y solo se asignará al cliente al completar el servicio.'
                : 'La máquina se registrará para el cliente seleccionado.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCrearMaquina} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nueva_serie_maquina">Serie *</Label>
                <Input id="nueva_serie_maquina" {...maquinaModalForm.register('serie')} placeholder="Serie de la máquina" />
                {maquinaModalForm.formState.errors.serie && (
                  <p className="text-xs text-destructive">{maquinaModalForm.formState.errors.serie.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nuevo_modelo_maquina">Modelo *</Label>
                <Input
                  id="nuevo_modelo_maquina"
                  value={maquinaModalForm.watch('modelo') ?? ''}
                  onChange={(event) => maquinaModalForm.setValue('modelo', event.target.value, { shouldValidate: true, shouldDirty: true })}
                  placeholder="Escribir modelo"
                />
                {maquinaModalForm.formState.errors.modelo && (
                  <p className="text-xs text-destructive">{maquinaModalForm.formState.errors.modelo.message}</p>
                )}
              </div>
            </div>

            {!isInstalacion && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nueva_fecha_instalacion">Fecha de instalación</Label>
                  <input type="hidden" {...maquinaModalForm.register('fecha_instalacion')} />
                  <DatePickerInput
                    inputId="nueva_fecha_instalacion"
                    value={maquinaModalForm.watch('fecha_instalacion')}
                    onChange={(value) =>
                      maquinaModalForm.setValue('fecha_instalacion', value, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    placeholder="Capturar fecha de instalación"
                    allowClear
                    allowManualInput
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="nueva_observaciones_maquina">Observaciones</Label>
              <Input id="nueva_observaciones_maquina" {...maquinaModalForm.register('observaciones')} placeholder="Opcional" />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-ran-slate">
              {isInstalacion
                ? `Cliente destino del servicio: ${selectedCliente?.nombre ?? 'Sin cliente seleccionado'}`
                : `Cliente actual: ${selectedCliente?.nombre ?? 'Sin cliente seleccionado'}`}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenMaquinaModal(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                className="bg-ran-navy hover:bg-ran-navy/90"
                disabled={isCreatingMaquina || !clienteId}
              >
                {isCreatingMaquina ? 'Guardando...' : 'Guardar máquina'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </form>
  )
}
